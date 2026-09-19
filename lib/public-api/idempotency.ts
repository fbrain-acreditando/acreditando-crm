/**
 * @fileoverview Idempotência da API pública — story 2.49.
 *
 * O n8n faz retry. Sem esta camada, um retry de rede escreve no deal duas
 * vezes — e a segunda escrita responde DIFERENTE da primeira, porque a regra
 * "não sobrescreve campo já preenchido" agora encontra o campo preenchido pela
 * própria primeira tentativa. O chamador vê duas respostas contraditórias para
 * a mesma intenção.
 *
 * O padrão é o mesmo do dedupe de `supabase/functions/webhook-in/index.ts:209-249`:
 *
 *   INSERT primeiro → violação de unique → SELECT do registro guardado
 *     • `request_hash` igual     ⇒ REPLAY: devolve a resposta guardada
 *     • `request_hash` diferente ⇒ 409 IDEMPOTENCY_CONFLICT
 *
 * INSERT-primeiro e não "SELECT, e se não existir INSERT": só o índice unique
 * do banco é atômico. Dois retries simultâneos passariam ambos pelo SELECT.
 *
 * ⚠️ `createStaticAdminClient` IGNORA RLS. Toda query daqui filtra
 * `organization_id` explicitamente — a tabela guarda corpo de resposta e um
 * vazamento entre organizações aqui seria vazamento de dado de lead.
 *
 * @module lib/public-api/idempotency
 */

import { createHash } from 'node:crypto';
import { createStaticAdminClient } from '@/lib/supabase/server';

const TABLE = 'public_api_idempotency';

/**
 * Hash estável do corpo da requisição.
 *
 * Canonicaliza as chaves em ordem alfabética antes de serializar: o n8n pode
 * reenviar o MESMO payload com as chaves em outra ordem, e isso não é um corpo
 * diferente — tratar como conflito seria recusar um retry legítimo.
 */
export function hashRequestBody(body: unknown): string {
  return createHash('sha256').update(canonicalize(body)).digest('hex');
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`);
  return `{${entries.join(',')}}`;
}

/**
 * Idade a partir da qual uma reserva sem resposta é considerada ABANDONADA —
 * story 2.51, ACHADO 1 da rodada 3 do QA.
 *
 * A janela é escolhida para caber entre dois limites:
 *  • **maior** que o tempo máximo que uma execução da rota pode durar (o teto de
 *    uma serverless function é da ordem de segundos a poucos minutos) — abaixo
 *    disso, assumir a reserva atropelaria uma requisição ainda VIVA e criaria o
 *    negócio duplicado que a chave existe para evitar;
 *  • **menor** que qualquer paciência humana — a chave da LP é
 *    `email + whatsapp + dia` (AC7), então uma reserva presa condena todo
 *    reenvio daquele visitante até a virada do dia. Quinze minutos é o pior caso
 *    de espera; 24 horas seria o lead perdido.
 */
export const JANELA_RESERVA_ABANDONADA_MS = 15 * 60 * 1000;

export type IdempotencyOutcome =
  /**
   * Chave nova (ou reserva abandonada assumida): registrada, o chamador deve
   * processar e depois gravar a resposta.
   */
  | { kind: 'proceed'; reservaExpiradaAssumida?: boolean }
  /** Mesma chave, mesmo corpo: devolve o que já foi respondido, sem escrever de novo. */
  | { kind: 'replay'; status: number; body: unknown }
  /** Mesma chave, corpo diferente: 409. */
  | { kind: 'conflict' }
  /** Erro de banco — o chamador decide (aqui: 500). */
  | { kind: 'error'; message: string };

export interface IdempotencyRef {
  organizationId: string;
  endpoint: string;
  idempotencyKey: string;
  requestHash: string;
}

/**
 * Reserva a chave. Chamar ANTES de qualquer escrita no deal.
 *
 * O registro nasce com `response_status = 0` e `response_body = {}` —
 * placeholder que `finalizeIdempotency` substitui pela resposta real.
 */
export async function beginIdempotency(ref: IdempotencyRef): Promise<IdempotencyOutcome> {
  const sb = createStaticAdminClient();

  const { error: insertError } = await sb.from(TABLE).insert({
    organization_id: ref.organizationId,
    endpoint: ref.endpoint,
    idempotency_key: ref.idempotencyKey,
    request_hash: ref.requestHash,
    response_status: 0,
    response_body: {},
    // Explícito (a coluna tem default `now()`) porque é ESTE valor que decide,
    // no retry seguinte, se a reserva ainda está viva ou já foi abandonada.
    created_at: new Date().toISOString(),
  });

  if (!insertError) return { kind: 'proceed' };

  // Só a violação de unique é idempotência; o resto é erro de verdade.
  const message = String(insertError.message || '').toLowerCase();
  const isUniqueViolation =
    (insertError as { code?: string }).code === '23505' ||
    message.includes('duplicate') ||
    message.includes('unique');
  if (!isUniqueViolation) return { kind: 'error', message: insertError.message };

  const { data: existing, error: selectError } = await sb
    .from(TABLE)
    .select('request_hash,response_status,response_body,created_at')
    .eq('organization_id', ref.organizationId)
    .eq('endpoint', ref.endpoint)
    .eq('idempotency_key', ref.idempotencyKey)
    .maybeSingle();

  if (selectError) return { kind: 'error', message: selectError.message };
  if (!existing) {
    // O unique disparou mas a linha sumiu (corrida com purga). Sem registro
    // para comparar, o seguro é processar — a alternativa é recusar um pedido
    // válido por causa de um estado que já não existe.
    return { kind: 'proceed' };
  }

  const row = existing as {
    request_hash: string;
    response_status: number;
    response_body: unknown;
    created_at?: string | null;
  };

  if (!row.response_status) {
    // A primeira tentativa reservou a chave e ainda não terminou — ou MORREU no
    // meio. Os dois casos são indistinguíveis daqui; o que os separa é o tempo.
    //
    // A reserva velha é assumida (ACHADO 1 da rodada 3): sem isto, uma reserva
    // que ficou para trás (a function morreu antes de finalizar, ou o caminho
    // `escrita_indeterminada` a manteve de propósito) devolveria
    // `IDEMPOTENCY_IN_PROGRESS` a TODO reenvio daquele visitante até a virada do
    // dia — o lead nunca entraria, e ninguém seria avisado.
    const limite = new Date(Date.now() - JANELA_RESERVA_ABANDONADA_MS).toISOString();
    if (row.created_at && row.created_at < limite) {
      // ⚠️ O take-over é CONDICIONAL NO BANCO. Um "SELECT e depois UPDATE" seria
      // exatamente a corrida que a tabela existe para impedir: dois reenvios
      // simultâneos leriam a mesma reserva velha e os dois criariam um negócio.
      // Só sai daqui com `proceed` quem o UPDATE de fato pegou (1 linha).
      const { data: assumidas, error: takeoverError } = await sb
        .from(TABLE)
        .update({
          request_hash: ref.requestHash,
          response_body: {},
          created_at: new Date().toISOString(),
        })
        .eq('organization_id', ref.organizationId)
        .eq('endpoint', ref.endpoint)
        .eq('idempotency_key', ref.idempotencyKey)
        .eq('response_status', 0)
        .lt('created_at', limite)
        .select('id');

      if (takeoverError) return { kind: 'error', message: takeoverError.message };
      if (((assumidas as unknown[] | null)?.length ?? 0) === 1) {
        return { kind: 'proceed', reservaExpiradaAssumida: true };
      }
      // 0 linhas: outro processo assumiu (ou finalizou) primeiro. Cai adiante —
      // quem perdeu a corrida espera, não escreve.
    }

    if (row.request_hash !== ref.requestHash) return { kind: 'conflict' };

    // Devolver 409 mentiria sobre a causa; devolver a resposta guardada é
    // impossível — ela não existe. 202-like: replay do estado "em curso".
    return {
      kind: 'replay',
      status: 409,
      body: { error: 'Request with this Idempotency-Key is still in progress', code: 'IDEMPOTENCY_IN_PROGRESS' },
    };
  }

  if (row.request_hash !== ref.requestHash) return { kind: 'conflict' };

  return { kind: 'replay', status: row.response_status, body: row.response_body };
}

/**
 * Grava a resposta na chave reservada, para que o próximo retry a devolva.
 *
 * Best-effort de propósito: se esta gravação falhar, a escrita no deal já
 * aconteceu e o chamador precisa devolver 200 mesmo assim. O custo é um retry
 * eventualmente reprocessar — nunca um sucesso virar erro.
 */
export async function finalizeIdempotency(
  ref: IdempotencyRef,
  response: { status: number; body: unknown }
): Promise<void> {
  const sb = createStaticAdminClient();
  const { error } = await sb
    .from(TABLE)
    .update({ response_status: response.status, response_body: response.body })
    .eq('organization_id', ref.organizationId)
    .eq('endpoint', ref.endpoint)
    .eq('idempotency_key', ref.idempotencyKey)
    .select('id');

  if (error) {
    console.error('[public-api/idempotency] falha ao gravar a resposta:', error.message);
  }
}

/**
 * Libera a chave reservada, para que um retry POSTERIOR possa tentar de novo.
 *
 * Story 2.51. Guardar um **5xx** como resposta idempotente seria pior que não
 * ter idempotência: a LP deriva a chave de `email + whatsapp + dia` (AC7), então
 * toda retentativa do mesmo visitante no mesmo dia receberia o mesmo 500 de
 * volta — o lead ficaria perdido até a virada do dia. Falha definitiva (4xx) e
 * sucesso continuam guardados; só o 5xx solta a chave.
 *
 * Best-effort: se a exclusão falhar, o pior caso é o próximo retry receber
 * `IDEMPOTENCY_IN_PROGRESS` — nunca um negócio duplicado.
 */
export async function releaseIdempotency(ref: IdempotencyRef): Promise<void> {
  const sb = createStaticAdminClient();
  const { error } = await sb
    .from(TABLE)
    .delete()
    .eq('organization_id', ref.organizationId)
    .eq('endpoint', ref.endpoint)
    .eq('idempotency_key', ref.idempotencyKey)
    .eq('response_status', 0);

  if (error) {
    console.error('[public-api/idempotency] falha ao liberar a chave:', error.message);
  }
}
