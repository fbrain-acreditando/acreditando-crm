/**
 * @fileoverview Log estruturado de erro da API pública — story 2.51.
 *
 * Uma linha, um JSON. O que existia antes — `console.error('[API] Database
 * error:', error)` — imprimia um objeto que o coletor de log recorta e que
 * ninguém consegue correlacionar com a reclamação "o lead sumiu às 13h47".
 * Agora toda falha carrega `request_id`, e esse mesmo id vai no corpo da
 * resposta: é por ele que se liga a queixa ao erro real.
 *
 * 🔒 **Nada do texto do Postgres é copiado por padrão.** O payload é montado a
 * partir de {@link extractSafePgFields}, que extrai só identificadores (código,
 * constraint, colunas, relação). `details` e `hint` viram um booleano
 * (`details_tinha_valor`) — eles são exatamente onde o Postgres cola o valor
 * que violou a constraint (`Key (email)=(maria@x.com)`).
 *
 * @module lib/public-api/errorLog
 */

import { extractSafePgFields } from '@/lib/public-api/db-errors';

/**
 * Onde a requisição estava quando quebrou.
 *
 * Não existe `auth`: a autenticação falha antes de qualquer acesso ao banco e
 * responde pelo caminho de `authPublicApi`, sem passar por aqui. O valor estava
 * no tipo sem nenhum emissor (ACHADO 8 do QA) — tipo que descreve algo que não
 * acontece é documentação errada.
 */
export type PublicApiEtapa =
  | 'resolve_board'
  | 'resolve_stage'
  | 'upsert_contact'
  | 'insert_deal'
  | 'verificar_insert'
  | 'idempotency';

export interface PublicApiErrorLogInput {
  requestId: string;
  /** Rota no formato `POST /api/public/v1/deals`. */
  rota: string;
  etapa: PublicApiEtapa;
  /** Número da tentativa em que o erro aconteceu (1 = primeira). */
  tentativa: number;
  erro: unknown;
  /** AC6 — contato criado/atualizado que ficou sem negócio. */
  contatoOrfao?: string | null;
  /** Campos extras, sempre não sensíveis (ids, nomes de campo, flags). */
  extra?: Record<string, unknown>;
}

function montarPayload(evento: string, input: PublicApiErrorLogInput) {
  const seguro = extractSafePgFields(input.erro);
  return {
    evento,
    request_id: input.requestId,
    rota: input.rota,
    etapa: input.etapa,
    tentativa: input.tentativa,
    code: seguro.code,
    constraint: seguro.constraint,
    colunas: seguro.colunas,
    relacao: seguro.relacao,
    message: seguro.message,
    ...(seguro.message_suprimida ? { message_suprimida: true } : {}),
    details_tinha_valor: seguro.details_tinha_valor,
    ...(input.contatoOrfao ? { contato_orfao: input.contatoOrfao } : {}),
    ...(input.extra ?? {}),
  };
}

/** Falha final: a requisição vai devolver erro. Uma linha, JSON, em `console.error`. */
export function logPublicApiDbError(input: PublicApiErrorLogInput): void {
  console.error(JSON.stringify(montarPayload('public_api_db_error', input)));
}

/** Falha que será retentada. `console.warn` porque ainda pode terminar em 201. */
export function logPublicApiDbRetry(input: PublicApiErrorLogInput & { esperaMs: number }): void {
  console.warn(
    JSON.stringify({
      ...montarPayload('public_api_db_retry', input),
      espera_ms: input.esperaMs,
    })
  );
}

/**
 * Uma reserva de idempotência abandonada foi ASSUMIDA por esta requisição.
 *
 * Story 2.51, ACHADO 1 da rodada 3. Não é erro — é o destravamento de uma chave
 * que ficou presa. Vai em `console.warn` porque merece ser notado: se aparecer
 * com frequência, alguma requisição está morrendo antes de finalizar.
 */
export function logPublicApiReservaAssumida(input: {
  requestId: string;
  rota: string;
  etapa: PublicApiEtapa;
}): void {
  console.warn(
    JSON.stringify({
      evento: 'public_api_idempotency_reserva_assumida',
      request_id: input.requestId,
      rota: input.rota,
      etapa: input.etapa,
      reserva_expirada_assumida: true,
    })
  );
}

/**
 * A escrita falhou mas a leitura de volta encontrou o registro: **commitou**.
 *
 * Não é erro — é a prova de que o retry cego teria duplicado o negócio. Vai em
 * `console.warn` porque a requisição termina em 201.
 */
export function logPublicApiEscritaConfirmada(input: {
  requestId: string;
  rota: string;
  tentativa: number;
  erro: unknown;
  dealId: string | null;
}): void {
  const seguro = extractSafePgFields(input.erro);
  console.warn(
    JSON.stringify({
      evento: 'public_api_db_escrita_confirmada',
      request_id: input.requestId,
      rota: input.rota,
      etapa: 'insert_deal',
      tentativa: input.tentativa,
      code: seguro.code,
      message: seguro.message,
      ...(seguro.message_suprimida ? { message_suprimida: true } : {}),
      escrita_confirmada_por_leitura: true,
      deal_id: input.dealId,
    })
  );
}
