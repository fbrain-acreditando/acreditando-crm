/**
 * @fileoverview O lead do Formulário Meta entra no card da Fernanda — story 2.59
 * (AC2–AC7, AC10, AC12; T3.2–T3.7).
 *
 * Um lead do formulário `[ACREDITANDO] Qualificação WPP` chega (pelo n8n a cada
 * 5 min, ou pelo script do CSV) e cai num destes caminhos:
 *
 * | Situação | Ação | `acao` |
 * |---|---|---|
 * | card já tem este `metaLeadgenId` | nada a gravar (garante a nota) | `ja_processado` |
 * | contato achado **e** card aberto | completa só os campos vazios | `completou` |
 * | contato achado, só cards terminais | cria card em "Lead novo" | `criou_card` |
 * | sem contato, lead com < 10 min | não grava nada, responde 202 | `aguardando` |
 * | sem contato, lead com ≥ 10 min | cria contato + card em "Lead novo" | `criou_contato_e_card` |
 *
 * Regras que NÃO se negociam aqui:
 *   • campo já preenchido NUNCA é sobrescrito (F2) — nem pela resposta, nem pelo rastreio;
 *   • o formulário NÃO mexe na nota/estrelas (F3, AC6): nenhuma coluna `lead_score*`
 *     nem `pontuada_pela_ia_em` aparece em escrita alguma deste módulo;
 *   • telefone e origem do contato achado nunca são trocados (AC5, P3);
 *   • `POST /contacts` não é usado (apaga `source`/`notes`, R10);
 *   • toda leitura filtra `organization_id` e `deleted_at` (o admin client ignora RLS);
 *   • sucesso só depois de RELER o card (Rule 7) — "a API respondeu" não prova nada;
 *   • log só com lista branca: ids, contagens, códigos (AC12).
 *
 * @module lib/meta-form/processarLead
 */

import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { isBlank } from '@/lib/ai/extraction/customFields.schemas';
import { extractSafePgFields, isAmbiguousDbError, isTransientDbError } from '@/lib/public-api/db-errors';
import { comRetry } from '@/lib/public-api/retry';
import {
  BOARD_ACREDITANDO,
  ESTAGIO_LEAD_NOVO_ACREDITANDO,
  escolherCardAberto,
} from '@/lib/deals/cardAberto';
import { variantesDoTelefone } from '@/lib/meta-form/telefone';
import {
  LIMITE_VALOR_CAMPO,
  traduzirLead,
  type CampoPulado,
  type LeadTraduzido,
} from '@/lib/meta-form/traducao';

// =============================================================================
// Contrato
// =============================================================================

/** Chave de idempotência é por endpoint — ver `public_api_idempotency`. */
export const META_FORM_ENDPOINT = 'POST /meta-form-leads';

/** Carência antes de criar contato novo: o lead costuma chamar no WhatsApp no mesmo minuto. */
export const CARENCIA_MS = 10 * 60 * 1000;

/** Origem do contato NOVO vindo do formulário (P3). */
export const SOURCE_META_FORM = 'meta_form';

/** Texto da opção de `origemDoLead` — tem de bater, com acento, com a migration. */
export const ORIGEM_FORMULARIO_META = 'Formulário Meta';

/** Título da nota do histórico — neutro, sem diagnóstico (P2). */
export const TITULO_DA_NOTA = 'Respostas do Formulário Meta';

const ROTA = 'POST /api/public/v1/meta-form-leads';

/** Folga para decidir se o contato devolvido pela função acabou de nascer. */
const JANELA_CONTATO_NOVO_MS = 2 * 60 * 1000;

const Texto = z.string().max(500);

export const MetaFormLeadSchema = z
  .object({
    leadgen_id: z.string().min(1).max(40),
    created_time: z.string().min(1).max(40),
    form_id: Texto.optional(),
    campaign_id: Texto.optional(),
    campaign_name: Texto.optional(),
    ad_id: Texto.optional(),
    ad_name: Texto.optional(),
    field_data: z
      .array(
        z
          .object({
            name: z.string().min(1).max(300),
            values: z.array(z.string().max(1000)).max(10),
          })
          .strict()
      )
      .min(1)
      .max(50),
  })
  .strict();

export type MetaFormLeadInput = z.infer<typeof MetaFormLeadSchema>;

export type Acao = 'completou' | 'criou_card' | 'criou_contato_e_card' | 'ja_processado' | 'aguardando';

export interface CorpoResposta {
  acao: Acao;
  contact_id: string | null;
  deal_id: string | null;
  campos_gravados: string[];
  campos_pulados: CampoPulado[];
  request_id: string;
  [k: string]: unknown;
}

/** O que a rota faz com a reserva de idempotência depois. */
export type DestinoDaChave = 'finalizar' | 'liberar' | 'manter';

export interface ResultadoDoLead {
  status: number;
  body: Record<string, unknown>;
  chave: DestinoDaChave;
}

// =============================================================================
// Utilidades puras
// =============================================================================

/** `l:1234…` (CSV) ou `1234…` (Graph API) ⇒ só dígitos. `null` se não for id. */
export function normalizarLeadgenId(bruto: string): string | null {
  const s = bruto.trim().replace(/^l:/i, '');
  return /^\d{5,30}$/.test(s) ? s : null;
}

/** Tira o prefixo de tipo do CSV (`ag:`, `c:`, `as:`, `f:`). */
function semPrefixo(v: string | undefined): string {
  return String(v ?? '').trim().replace(/^[a-z]{1,3}:/i, '');
}

/** `id · nome` do rastreio (AC3, `02-…` §3.2). Vazio ⇒ `null`. */
export function rotuloDeRastreio(id?: string, nome?: string): string | null {
  const partes = [semPrefixo(id), String(nome ?? '').trim()].filter(Boolean);
  if (partes.length === 0) return null;
  return partes.join(' · ').slice(0, LIMITE_VALOR_CAMPO);
}

/**
 * UUID determinístico a partir de um texto (formato v4-compatível).
 *
 * É o que torna "uma nota por leadgen id" (AC4) verdade **por construção**: o
 * reenvio gera o MESMO id, e o `upsert … ignoreDuplicates` não cria a segunda.
 */
export function uuidDeterministico(semente: string): string {
  const h = createHash('sha256').update(semente).digest('hex').slice(0, 32).split('');
  h[12] = '4';
  h[16] = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  const s = h.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

export function idDaNota(organizationId: string, leadgenId: string): string {
  return uuidDeterministico(`meta-form-nota:${organizationId}:${leadgenId}`);
}

/** Data/hora em pt-BR, fuso de São Paulo, para a nota. */
function dataHoraBR(iso: string): string {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/**
 * Descrição da nota (AC4, P2): TODAS as respostas como a pessoa marcou,
 * inclusive as que não entraram no card por já estarem preenchidas.
 * Sem nome, telefone nem e-mail (esses moram no contato).
 */
export function montarDescricaoDaNota(opts: {
  traduzido: LeadTraduzido;
  enviadoEm: string;
  camposJaPreenchidos: string[];
}): string {
  const linhas: string[] = [];
  linhas.push(`Enviado em ${dataHoraBR(opts.enviadoEm)} pelo formulário instantâneo da Meta.`);
  linhas.push('');
  for (const r of opts.traduzido.respostasParaNota) {
    linhas.push(`• ${r.pergunta} ${r.resposta}`);
  }
  if (opts.camposJaPreenchidos.length > 0) {
    linhas.push('');
    linhas.push(
      `Já estavam preenchidos no card e não foram alterados: ${opts.camposJaPreenchidos.join(', ')}.`
    );
  }
  return linhas.join('\n');
}

// =============================================================================
// Log — lista branca (AC12)
// =============================================================================

type Etapa =
  | 'validar_quadro'
  | 'buscar_ja_processado'
  | 'buscar_contato'
  | 'criar_contato'
  | 'atualizar_contato'
  | 'buscar_card'
  | 'completar_card'
  | 'criar_card'
  | 'gravar_nota'
  | 'reler_card';

/** Só ids, contagens e códigos. Nunca texto do payload nem `details` do Postgres. */
export function logMetaFormErro(input: {
  requestId: string;
  etapa: Etapa;
  erro: unknown;
  extra?: Record<string, string | number | boolean | null>;
}): void {
  const seguro = extractSafePgFields(input.erro);
  console.error(
    JSON.stringify({
      evento: 'meta_form_lead_erro',
      request_id: input.requestId,
      rota: ROTA,
      etapa: input.etapa,
      code: seguro.code,
      constraint: seguro.constraint,
      colunas: seguro.colunas,
      relacao: seguro.relacao,
      message: seguro.message,
      ...(seguro.message_suprimida ? { message_suprimida: true } : {}),
      details_tinha_valor: seguro.details_tinha_valor,
      ...(input.extra ?? {}),
    })
  );
}

// =============================================================================
// Processamento
// =============================================================================

class ErroDeEtapa extends Error {
  constructor(
    public etapa: Etapa,
    public causa: unknown
  ) {
    super(`falha em ${etapa}`);
  }
}

function ehViolacaoDeUnicidade(erro: unknown): boolean {
  return !!erro && typeof erro === 'object' && String((erro as { code?: unknown }).code ?? '') === '23505';
}

interface Contexto {
  sb: any;
  organizationId: string;
  requestId: string;
  leadgenId: string;
  input: MetaFormLeadInput;
  traduzido: LeadTraduzido;
  rastreio: Record<string, string>;
  agoraIso: string;
}

/** Card vivo que já carrega este leadgen id (AC10, camada 2). */
async function buscarCardDoLeadgen(ctx: Contexto): Promise<{ id: string; contact_id: string | null } | null> {
  const { data, error } = await ctx.sb
    .from('deals')
    .select('id,contact_id')
    .eq('organization_id', ctx.organizationId)
    .is('deleted_at', null)
    .eq('custom_fields->>metaLeadgenId', ctx.leadgenId)
    .limit(1);
  if (error) throw new ErroDeEtapa('buscar_ja_processado', error);
  const linha = (data as Array<{ id: string; contact_id: string | null }> | null)?.[0];
  return linha ?? null;
}

/**
 * AC5 — contato VIVO por telefone (com e sem o 9º dígito); e-mail só por último.
 * Empate ⇒ o mais antigo.
 */
async function buscarContato(ctx: Contexto): Promise<{ id: string } | null> {
  const tel = variantesDoTelefone(ctx.traduzido.contato.telefone);
  if (tel) {
    const { data, error } = await ctx.sb
      .from('contacts')
      .select('id,created_at')
      .eq('organization_id', ctx.organizationId)
      .is('deleted_at', null)
      .is('merged_into_id', null)
      .in('phone', tel.variantes)
      .order('created_at', { ascending: true })
      .limit(1);
    if (error) throw new ErroDeEtapa('buscar_contato', error);
    const achado = (data as Array<{ id: string }> | null)?.[0];
    if (achado) return { id: achado.id };
  }

  const email = ctx.traduzido.contato.email;
  if (email) {
    const { data, error } = await ctx.sb
      .from('contacts')
      .select('id,created_at')
      .eq('organization_id', ctx.organizationId)
      .is('deleted_at', null)
      .is('merged_into_id', null)
      .eq('email', email)
      .order('created_at', { ascending: true })
      .limit(1);
    if (error) throw new ErroDeEtapa('buscar_contato', error);
    const achado = (data as Array<{ id: string }> | null)?.[0];
    if (achado) return { id: achado.id };
  }
  return null;
}

/** AC3 — card aberto do contato no quadro Acreditando (mesma regra da 2.56). */
async function buscarCardAberto(ctx: Contexto, contactId: string) {
  const { data, error } = await ctx.sb
    .from('deals')
    .select('id,stage_id,created_at')
    .eq('organization_id', ctx.organizationId)
    .eq('contact_id', contactId)
    .eq('board_id', BOARD_ACREDITANDO)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(50);
  if (error) throw new ErroDeEtapa('buscar_card', error);
  return escolherCardAberto(BOARD_ACREDITANDO, (data as any[]) ?? []);
}

/**
 * T3.6b / R11 — depois do `find_or_create_contact`, relê o contato e, se ele
 * estiver mesclado, SEGUE `merged_into_id` até o vivo. Nunca card em contato morto.
 *
 * (Em produção a função já filtra `merged_into_id IS NULL` desde a 2.56 —
 * conferido em 29/09 —, mas o repositório da `main` ainda tem a versão antiga.
 * A defesa aqui vale para as duas.)
 */
async function resolverContatoVivo(
  ctx: Contexto,
  contactId: string
): Promise<{ id: string; source: string | null; created_at: string | null; name: string | null }> {
  let atual = contactId;
  for (let i = 0; i < 5; i++) {
    const { data, error } = await ctx.sb
      .from('contacts')
      .select('id,name,source,created_at,deleted_at,merged_into_id')
      .eq('organization_id', ctx.organizationId)
      .eq('id', atual)
      .maybeSingle();
    if (error) throw new ErroDeEtapa('criar_contato', error);
    if (!data) throw new ErroDeEtapa('criar_contato', { code: 'CONTATO_SUMIU' });
    if (data.merged_into_id) {
      atual = data.merged_into_id;
      continue;
    }
    if (data.deleted_at) throw new ErroDeEtapa('criar_contato', { code: 'CONTATO_EXCLUIDO' });
    return { id: data.id, source: data.source ?? null, created_at: data.created_at ?? null, name: data.name ?? null };
  }
  throw new ErroDeEtapa('criar_contato', { code: 'CADEIA_DE_MESCLA_LONGA' });
}

/** AC7 / P3 — contato novo por `find_or_create_contact` (trava contra corrida). */
async function criarContato(ctx: Contexto) {
  const tel = variantesDoTelefone(ctx.traduzido.contato.telefone);
  const nome = ctx.traduzido.contato.nome || 'Sem nome (Formulário Meta)';
  const { data, error } = await ctx.sb.rpc('find_or_create_contact', {
    p_organization_id: ctx.organizationId,
    p_phone: tel?.principal ?? null,
    p_name: nome,
    p_source: SOURCE_META_FORM,
  });
  if (error) throw new ErroDeEtapa('criar_contato', error);
  const id = typeof data === 'string' ? data : null;
  if (!id) throw new ErroDeEtapa('criar_contato', { code: 'RPC_SEM_ID' });
  const vivo = await resolverContatoVivo(ctx, id);

  // A função pode ter ACHADO um contato (corrida com o WhatsApp). Nesse caso ele
  // é "existente": mantém origem e nome, com os mesmos cuidados do AC7.
  // "Novo" = nasceu agora, com a origem do formulário. Comparação por instante
  // (não por texto: o banco devolve `+00:00`, o Node `Z`) e com folga para a
  // diferença de relógio entre servidor e banco.
  const criadoEm = vivo.created_at ? new Date(vivo.created_at).getTime() : NaN;
  const novo =
    vivo.source === SOURCE_META_FORM &&
    Number.isFinite(criadoEm) &&
    criadoEm >= new Date(ctx.agoraIso).getTime() - JANELA_CONTATO_NOVO_MS;
  if (!novo) await completarContatoExistente(ctx, vivo.id);
  if (!ctx.traduzido.contato.email) return { id: vivo.id, novo };

  // E-mail só em contato que acabou de nascer e só se vazio (a função não recebe e-mail).
  if (novo) {
    const { error: e2 } = await ctx.sb
      .from('contacts')
      .update({ email: ctx.traduzido.contato.email })
      .eq('organization_id', ctx.organizationId)
      .eq('id', vivo.id)
      .or('email.is.null,email.eq.')
      .select('id');
    if (e2) throw new ErroDeEtapa('atualizar_contato', e2);
  }
  return { id: vivo.id, novo };
}

/**
 * AC5 / AC7 / P3 — contato achado: telefone NUNCA muda; nome só se vazio;
 * `source` vira `meta_form` só se vazio. Atualização pontual (efeito do PATCH),
 * cada uma condicionada no banco ao campo estar vazio — sem ler-e-escrever.
 */
async function completarContatoExistente(ctx: Contexto, contactId: string): Promise<void> {
  const nome = ctx.traduzido.contato.nome;
  if (nome) {
    const { error } = await ctx.sb
      .from('contacts')
      .update({ name: nome, updated_at: ctx.agoraIso })
      .eq('organization_id', ctx.organizationId)
      .eq('id', contactId)
      .or('name.is.null,name.eq.')
      .select('id');
    if (error) throw new ErroDeEtapa('atualizar_contato', error);
  }
  const { error } = await ctx.sb
    .from('contacts')
    .update({ source: SOURCE_META_FORM, updated_at: ctx.agoraIso })
    .eq('organization_id', ctx.organizationId)
    .eq('id', contactId)
    .or('source.is.null,source.eq.')
    .select('id');
  if (error) throw new ErroDeEtapa('atualizar_contato', error);
}

/** Valores a gravar no card: respostas traduzidas + rastreio. */
function valoresParaOCard(ctx: Contexto): Record<string, string> {
  return { ...ctx.traduzido.campos, ...ctx.rastreio };
}

function proveniencia(ctx: Contexto, valor: string) {
  // Mesma forma de `aiExtraction.ts:221-227`, com a origem certa.
  return {
    value: valor,
    confidence: 1,
    reasoning: 'meta_form',
    extractedAt: ctx.agoraIso,
    source: 'meta_form',
    leadgenId: ctx.leadgenId,
  };
}

/**
 * AC3 — completa o card aberto: só campo vazio; nada de estágio/título/dono/nota.
 *
 * Escrita condicionada ao `updated_at` lido (compare-and-swap): se a Fernanda
 * salvou o card entre a leitura e a escrita, relê e recalcula — nunca grava por
 * cima do que ela acabou de digitar com a foto velha do card.
 */
async function completarCard(ctx: Contexto, dealId: string) {
  const valores = valoresParaOCard(ctx);
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    const { data: deal, error } = await ctx.sb
      .from('deals')
      .select('id,custom_fields,ai_extracted,updated_at')
      .eq('organization_id', ctx.organizationId)
      .eq('id', dealId)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw new ErroDeEtapa('completar_card', error);
    if (!deal) throw new ErroDeEtapa('completar_card', { code: 'CARD_SUMIU' });

    const atuais = (deal.custom_fields as Record<string, unknown>) ?? {};
    const extraido = (deal.ai_extracted as Record<string, unknown>) ?? {};
    const proxFields: Record<string, unknown> = { ...atuais };
    const proxProv: Record<string, unknown> = { ...((extraido.customFields as Record<string, unknown>) ?? {}) };
    const gravados: string[] = [];
    const jaPreenchidos: string[] = [];

    for (const [chave, valor] of Object.entries(valores)) {
      if (!isBlank(atuais[chave])) {
        jaPreenchidos.push(chave);
        continue;
      }
      proxFields[chave] = valor;
      proxProv[chave] = proveniencia(ctx, valor);
      gravados.push(chave);
    }

    const patch: Record<string, unknown> = { updated_at: ctx.agoraIso };
    if (gravados.length > 0) {
      patch.custom_fields = proxFields;
      patch.ai_extracted = { ...extraido, customFields: proxProv, customFieldsLastExtractedAt: ctx.agoraIso };
    }

    let q = ctx.sb
      .from('deals')
      .update(patch)
      .eq('organization_id', ctx.organizationId)
      .eq('id', dealId)
      .is('deleted_at', null);
    if (deal.updated_at) q = q.eq('updated_at', deal.updated_at);
    const { data: escrito, error: eUp } = await q.select('id');

    if (eUp) {
      if (ehViolacaoDeUnicidade(eUp)) return { conflitoDeLeadgen: true as const };
      throw new ErroDeEtapa('completar_card', eUp);
    }
    if ((escrito as unknown[] | null)?.length === 1) {
      return { conflitoDeLeadgen: false as const, gravados, jaPreenchidos };
    }
    // 0 linhas: o card mudou entre ler e escrever. Relê e tenta de novo.
  }
  throw new ErroDeEtapa('completar_card', { code: 'CARD_MUDANDO_SEM_PARAR' });
}

/**
 * AC7 — cria o card em "Lead novo". Id gerado ANTES do laço + upsert por id
 * (padrão de `deals/route.ts:544-566`): a retentativa escreve a MESMA linha.
 * Erro ambíguo ⇒ relê por id antes de repetir (`:233-267`).
 */
async function criarCard(ctx: Contexto, contactId: string, nomeDoContato: string | null) {
  const valores = valoresParaOCard(ctx);
  const provs: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(valores)) provs[k] = proveniencia(ctx, v);

  const nome = (ctx.traduzido.contato.nome || nomeDoContato || '').trim() || 'Sem nome';
  const idDoDeal = randomUUID();
  const payload = {
    id: idDoDeal,
    organization_id: ctx.organizationId,
    title: `${nome} - Formulário Meta`.slice(0, 200),
    value: 0,
    board_id: BOARD_ACREDITANDO,
    stage_id: ESTAGIO_LEAD_NOVO_ACREDITANDO,
    contact_id: contactId,
    is_won: false,
    is_lost: false,
    custom_fields: valores,
    ai_extracted: { customFields: provs, customFieldsLastExtractedAt: ctx.agoraIso },
    created_at: ctx.agoraIso,
    updated_at: ctx.agoraIso,
  };

  type Tentativa =
    | { tipo: 'ok' }
    | { tipo: 'unico' }
    | { tipo: 'falhou'; erro: unknown; podeRetentar: boolean };

  const { resultado } = await comRetry<Tentativa>(
    async () => {
      const r = await ctx.sb.from('deals').upsert(payload, { onConflict: 'id' }).select('id');
      if (!r.error) return { tipo: 'ok' };
      if (ehViolacaoDeUnicidade(r.error)) return { tipo: 'unico' };
      if (!isTransientDbError(r.error)) return { tipo: 'falhou', erro: r.error, podeRetentar: false };
      if (!isAmbiguousDbError(r.error)) return { tipo: 'falhou', erro: r.error, podeRetentar: true };
      // Ambíguo: pode ter commitado. Lê de volta pelo id antes de repetir.
      const v = await ctx.sb
        .from('deals')
        .select('id')
        .eq('organization_id', ctx.organizationId)
        .eq('id', idDoDeal)
        .limit(1);
      if (!v.error && (v.data as unknown[] | null)?.length) return { tipo: 'ok' };
      if (!v.error) return { tipo: 'falhou', erro: r.error, podeRetentar: true };
      return { tipo: 'falhou', erro: r.error, podeRetentar: false };
    },
    { deveRetentar: (t) => t.tipo === 'falhou' && t.podeRetentar }
  );

  if (resultado.tipo === 'falhou') throw new ErroDeEtapa('criar_card', resultado.erro);
  if (resultado.tipo === 'unico') return { dealId: null as string | null, conflito: true as const, idTentado: idDoDeal };
  return { dealId: idDoDeal, conflito: false as const, gravados: Object.keys(valores) };
}

/** AC4 — UMA nota por leadgen id, por construção (id determinístico + ignoreDuplicates). */
async function gravarNota(ctx: Contexto, dealId: string, contactId: string, camposJaPreenchidos: string[]) {
  const id = idDaNota(ctx.organizationId, ctx.leadgenId);
  const descricao = montarDescricaoDaNota({
    traduzido: ctx.traduzido,
    enviadoEm: ctx.input.created_time,
    camposJaPreenchidos,
  });
  const { error } = await ctx.sb
    .from('activities')
    .upsert(
      {
        id,
        organization_id: ctx.organizationId,
        deal_id: dealId,
        contact_id: contactId,
        type: 'NOTE',
        title: TITULO_DA_NOTA,
        description: descricao,
        date: new Date(ctx.input.created_time).toISOString(),
        completed: true,
        created_at: ctx.agoraIso,
      },
      { onConflict: 'id', ignoreDuplicates: true }
    )
    .select('id');
  if (error) throw new ErroDeEtapa('gravar_nota', error);

  // Read-back: a nota existe (seja desta chamada, seja de uma anterior).
  const { data, error: e2 } = await ctx.sb
    .from('activities')
    .select('id')
    .eq('organization_id', ctx.organizationId)
    .eq('id', id)
    .limit(1);
  if (e2) throw new ErroDeEtapa('gravar_nota', e2);
  if (!(data as unknown[] | null)?.length) throw new ErroDeEtapa('gravar_nota', { code: 'NOTA_NAO_RELIDA' });
}

/** T3.7 — relê o card e confirma que cada campo "gravado" tem o valor pretendido. */
async function relerCard(ctx: Contexto, dealId: string, gravados: string[]) {
  const { data, error } = await ctx.sb
    .from('deals')
    .select('id,contact_id,custom_fields')
    .eq('organization_id', ctx.organizationId)
    .eq('id', dealId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new ErroDeEtapa('reler_card', error);
  if (!data) throw new ErroDeEtapa('reler_card', { code: 'CARD_NAO_RELIDO' });
  const cf = (data.custom_fields as Record<string, unknown>) ?? {};
  const valores = valoresParaOCard(ctx);
  const divergentes = gravados.filter((k) => cf[k] !== valores[k]);
  if (divergentes.length > 0) {
    throw new ErroDeEtapa('reler_card', { code: 'READBACK_DIVERGENTE', quantidade: divergentes.length });
  }
  return data as { id: string; contact_id: string };
}

export interface OpcoesDoProcessamento {
  organizationId: string;
  input: MetaFormLeadInput;
  requestId: string;
  /** Relógio injetável (teste de carência, AC7). */
  agora?: () => Date;
  /** Ensaio (AC9): decide e responde a ação PREVISTA, sem gravar nada. */
  ensaio?: boolean;
}

export async function processarLeadDoFormulario(opts: OpcoesDoProcessamento): Promise<ResultadoDoLead> {
  const agora = (opts.agora ?? (() => new Date()))();
  const requestId = opts.requestId;

  const leadgenId = normalizarLeadgenId(opts.input.leadgen_id);
  const enviadoEm = new Date(opts.input.created_time);
  if (!leadgenId || Number.isNaN(enviadoEm.getTime())) {
    return {
      status: 422,
      body: { error: 'Invalid leadgen_id or created_time', code: 'VALIDATION_ERROR', request_id: requestId },
      chave: 'finalizar',
    };
  }

  const traduzido = traduzirLead(opts.input.field_data);
  const rastreio: Record<string, string> = { origemDoLead: ORIGEM_FORMULARIO_META, metaLeadgenId: leadgenId };
  const campanha = rotuloDeRastreio(opts.input.campaign_id, opts.input.campaign_name);
  const anuncio = rotuloDeRastreio(opts.input.ad_id, opts.input.ad_name);
  if (campanha) rastreio.metaCampanha = campanha;
  if (anuncio) rastreio.metaAnuncio = anuncio;

  const ctx: Contexto = {
    sb: createStaticAdminClient(),
    organizationId: opts.organizationId,
    requestId,
    leadgenId,
    input: opts.input,
    traduzido,
    rastreio,
    agoraIso: agora.toISOString(),
  };

  const responder = (
    status: number,
    acao: Acao,
    extra: Partial<CorpoResposta>,
    chave: DestinoDaChave = 'finalizar'
  ): ResultadoDoLead => ({
    status,
    body: {
      acao,
      contact_id: extra.contact_id ?? null,
      deal_id: extra.deal_id ?? null,
      campos_gravados: extra.campos_gravados ?? [],
      campos_pulados: extra.campos_pulados ?? [],
      request_id: requestId,
      ...(opts.ensaio ? { ensaio: true } : {}),
      ...Object.fromEntries(
        Object.entries(extra).filter(
          ([k]) => !['contact_id', 'deal_id', 'campos_gravados', 'campos_pulados'].includes(k)
        )
      ),
    },
    chave,
  });

  const pulados = (jaPreenchidos: string[] = []): CampoPulado[] => [
    ...traduzido.pulados,
    ...jaPreenchidos.map((campo) => ({ campo, motivo: 'campo_ja_preenchido' as const })),
  ];

  /** Card do leadgen já existe: garante a nota e devolve o mesmo deal_id (AC10). */
  const jaProcessado = async (card: { id: string; contact_id: string | null }) => {
    if (!opts.ensaio && card.contact_id) await gravarNota(ctx, card.id, card.contact_id, []);
    return responder(200, 'ja_processado', { contact_id: card.contact_id, deal_id: card.id });
  };

  try {
    // 0. O quadro e o "Lead novo" pertencem a esta organização (id relido do banco).
    const { data: estagio, error: eEst } = await ctx.sb
      .from('board_stages')
      .select('id,board_id')
      .eq('organization_id', ctx.organizationId)
      .eq('id', ESTAGIO_LEAD_NOVO_ACREDITANDO)
      .eq('board_id', BOARD_ACREDITANDO)
      .maybeSingle();
    if (eEst) throw new ErroDeEtapa('validar_quadro', eEst);
    if (!estagio) {
      return {
        status: 422,
        body: { error: 'Board not available for this organization', code: 'INVALID_BOARD', request_id: requestId },
        chave: 'finalizar',
      };
    }

    // 1. Já processado? (camada 2 da idempotência)
    const doLeadgen = await buscarCardDoLeadgen(ctx);
    if (doLeadgen) return await jaProcessado(doLeadgen);

    // 2. Contato (telefone com e sem 9; e-mail por último)
    let contato = await buscarContato(ctx);
    let contatoNovo = false;

    if (!contato) {
      // 3. Carência (AC7): o lead costuma chamar no WhatsApp no mesmo minuto.
      const idadeMs = agora.getTime() - enviadoEm.getTime();
      if (idadeMs < CARENCIA_MS) {
        return responder(
          202,
          'aguardando',
          { tentar_depois_de: new Date(enviadoEm.getTime() + CARENCIA_MS).toISOString() },
          // A reserva é LIBERADA: o reenvio do n8n em 5 min precisa ser processado,
          // não receber replay deste 202 nem IDEMPOTENCY_IN_PROGRESS (R2 do @po).
          'liberar'
        );
      }
      if (opts.ensaio) return responder(200, 'criou_contato_e_card', {});
      const criado = await criarContato(ctx);
      contato = { id: criado.id };
      contatoNovo = criado.novo;
    } else if (!opts.ensaio) {
      await completarContatoExistente(ctx, contato.id);
    }

    // 4. Card aberto? completa. Senão, cria em "Lead novo".
    const escolha = await buscarCardAberto(ctx, contato.id);

    if (opts.ensaio) {
      return responder(200, escolha.temCardAberto ? 'completou' : 'criou_card', {});
    }

    if (escolha.temCardAberto) {
      const r = await completarCard(ctx, escolha.dealId);
      if (r.conflitoDeLeadgen) {
        const dono = await buscarCardDoLeadgen(ctx);
        if (dono) return await jaProcessado(dono);
        throw new ErroDeEtapa('completar_card', { code: '23505' });
      }
      await gravarNota(ctx, escolha.dealId, contato.id, r.jaPreenchidos);
      await relerCard(ctx, escolha.dealId, r.gravados);
      return responder(200, 'completou', {
        contact_id: contato.id,
        deal_id: escolha.dealId,
        campos_gravados: r.gravados,
        campos_pulados: pulados(r.jaPreenchidos),
      });
    }

    const { data: contatoLido } = await ctx.sb
      .from('contacts')
      .select('name')
      .eq('organization_id', ctx.organizationId)
      .eq('id', contato.id)
      .maybeSingle();
    const criado = await criarCard(ctx, contato.id, (contatoLido?.name as string | null) ?? null);
    if (criado.conflito) {
      // 23505 tem DOIS donos: o índice do leadgen (reenvio concorrente) e o
      // trigger `check_deal_duplicate` (mesmo contato, mesmo estágio). Só a
      // releitura pelo leadgen distingue — nunca concluir pelo código.
      const dono = await buscarCardDoLeadgen(ctx);
      if (dono) return await jaProcessado(dono);
      logMetaFormErro({ requestId, etapa: 'criar_card', erro: { code: '23505' }, extra: { motivo: 'check_deal_duplicate' } });
      return {
        status: 409,
        body: {
          error: 'Contact already has an open deal in the target stage',
          code: 'CONFLICT',
          request_id: requestId,
        },
        chave: 'finalizar',
      };
    }
    await gravarNota(ctx, criado.dealId!, contato.id, []);
    await relerCard(ctx, criado.dealId!, criado.gravados);
    return responder(201, contatoNovo ? 'criou_contato_e_card' : 'criou_card', {
      contact_id: contato.id,
      deal_id: criado.dealId,
      campos_gravados: criado.gravados,
      campos_pulados: pulados(),
    });
  } catch (e) {
    const etapa = e instanceof ErroDeEtapa ? e.etapa : 'buscar_card';
    const causa = e instanceof ErroDeEtapa ? e.causa : e;
    logMetaFormErro({ requestId, etapa, erro: causa, extra: { leadgen_id: leadgenId } });
    return {
      status: 500,
      body: { error: 'Internal server error', code: 'DB_ERROR', request_id: requestId, etapa },
      // Libera a chave: o reenvio é seguro (campo preenchido é pulado, card do
      // leadgen é achado, nota tem id fixo) e o lead não pode ficar preso.
      chave: 'liberar',
    };
  }
}
