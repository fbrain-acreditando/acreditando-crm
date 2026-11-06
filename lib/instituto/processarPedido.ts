/**
 * @fileoverview O pedido da loja do Instituto vira card da Fernanda — story 2.64
 * (AC3–AC11). A rota `app/api/public/v1/instituto-leads/route.ts` é casca; a
 * regra mora aqui. Molde: `lib/meta-form/processarLead.ts` (2.59) — o DESENHO
 * (variantes do telefone, card aberto, nota determinística, releitura, lista
 * branca, ensaio), não o domínio.
 *
 * Ordem de decisão do card (AC5 — a 1ª linha que casar vence):
 *
 * | Situação do contato | Ação | `acao` |
 * |---|---|---|
 * | contato novo | cria contato + card em "Produtos de treinamento" | `criou_contato_e_card` |
 * | tem card em "Produtos de treinamento" | reaproveita o mais antigo + nota "Pediu também" | `reaproveitou_card` |
 * | tem card aberto em outra etapa | cria o 2º card (D7); o outro não é tocado | `segundo_card` |
 * | só cards em Ganho · Perdido · Clientes · Produto vendido | cria card novo | `criou_card` |
 *
 * (A idempotência pela `Idempotency-Key` — AC8 — fica na rota.)
 *
 * Regras que NÃO se negociam aqui:
 *   • telefone do contato achado NUNCA muda; nome/e-mail/origem só se vazios (AC4);
 *   • `POST /contacts` não é usado (apaga `source`/`notes`);
 *   • card de reabilitação nunca é tocado (D7) e o card reaproveitado não muda
 *     etapa, valor, título nem dono (AC5);
 *   • nenhuma coluna de estrelas (`lead_score*`, `pontuada_pela_ia_em`) é escrita (AC6);
 *   • toda leitura filtra `organization_id` e `deleted_at` (o admin client ignora RLS);
 *   • sucesso só depois de RELER o card e a nota (AC9, Rule 7);
 *   • log só com lista branca: ids, códigos, contagens, `acao` (AC10).
 *
 * @module lib/instituto/processarPedido
 */

import { randomUUID } from 'node:crypto';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { z } from 'zod';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { isBlank } from '@/lib/ai/extraction/customFields.schemas';
import { extractSafePgFields, isAmbiguousDbError, isTransientDbError } from '@/lib/public-api/db-errors';
import { comRetry } from '@/lib/public-api/retry';
import { BOARD_ACREDITANDO } from '@/lib/deals/cardAberto';
import { paraE164, variantesDoTelefone } from '@/lib/meta-form/telefone';
import { uuidDeterministico } from '@/lib/meta-form/processarLead';
import { sanitizeUrl } from '@/lib/utils/sanitize';
import {
  CAMPO_AVISO_EM,
  CAMPO_AVISO_VERSAO,
  CAMPO_ORIGEM,
  CAMPO_PARA_QUEM,
  CAMPO_PRODUTO,
  DONA_DOS_PEDIDOS_DA_LOJA,
  ETAPA_PRODUTOS_DE_TREINAMENTO,
  ETAPAS_FECHADAS_PARA_A_LOJA,
  ORIGEM_LP_INSTITUTO,
  PERFIS_DA_LOJA,
  PRODUTOS_DA_LOJA,
  SLUGS_DOS_PRODUTOS,
  SOURCE_LP_INSTITUTO,
  VALORES_DOS_PERFIS,
  VERSOES_DO_AVISO_ACEITAS,
  precoEmReais,
  type PerfilDaLoja,
  type SlugDoProduto,
} from '@/lib/instituto/catalogo';

// =============================================================================
// Contrato (AC3, AC8)
// =============================================================================

/** Chave de idempotência é por endpoint — ver `public_api_idempotency`. */
export const INSTITUTO_ENDPOINT = 'POST /instituto-leads';
const ROTA = 'POST /api/public/v1/instituto-leads';

/**
 * Ids das chaves de API autorizadas nesta rota (AC2, D11). Lista separada por
 * vírgula em `INSTITUTO_LEADS_API_KEY_IDS` (variável da Vercel). Vazia ou
 * ausente ⇒ lista vazia ⇒ a rota recusa TUDO (falha fechada, nunca aberta).
 */
export function chavesAutorizadas(valor = process.env.INSTITUTO_LEADS_API_KEY_IDS): string[] {
  return String(valor ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** `instituto:` + 64 hexadecimais. Quem monta é o n8n (receita da 2.65, AC4). */
export const FORMATO_DA_CHAVE = /^instituto:[0-9a-f]{64}$/;

/** Título da nota — neutro (AC7). */
export const TITULO_DA_NOTA = 'Pedido da loja do Instituto';

/** RPC da 2.63 (mesma trava do webhook do WhatsApp — `contact.ts`). */
export const RPC_CONTATO_POR_VARIANTES = 'find_or_create_contact_por_variantes';

const LIMITE_DA_PAGINA = 300;

/**
 * QA M1 (05/11): a MESMA regra de e-mail da página (`site/api/lead.js`, `validar`,
 * e `site/app.js`). Um e-mail que a página aceita nunca pode virar 422 aqui —
 * senão o pedido não vira card e só sobra um alerta no Telegram.
 */
export const REGRA_DO_EMAIL_DA_PAGINA = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

/**
 * Normaliza como a página (`limpar(…, 160).toLowerCase()`) e tira o ponto do fim
 * (`nome@gmail.com.`, comum no teclado do celular) quando o resto continua válido.
 * Devolve `null` se a página também recusaria.
 */
export function normalizarEmail(bruto: string): string | null {
  const e = String(bruto ?? '').trim().replace(/\s+/g, ' ').slice(0, 160).toLowerCase();
  if (!REGRA_DO_EMAIL_DA_PAGINA.test(e)) return null;
  const semPontoNoFim = e.replace(/\.+$/, '');
  return REGRA_DO_EMAIL_DA_PAGINA.test(semPontoNoFim) ? semPontoNoFim : e;
}

export const PedidoSchema = z
  .object({
    nome: z.string().trim().min(1).max(120),
    email: z
      .string()
      .max(400)
      .transform((v, ctx) => {
        const e = normalizarEmail(v);
        if (!e) {
          ctx.addIssue({ code: 'custom', message: 'email fora da regra da página' });
          return z.NEVER;
        }
        return e;
      }),
    whatsapp: z.string().trim().min(8).max(30),
    perfil: z.enum(VALORES_DOS_PERFIS),
    produto: z.enum(SLUGS_DOS_PRODUTOS),
    consentimento: z
      .object({
        aceito: z.literal(true),
        texto_versao: z.enum(VERSOES_DO_AVISO_ACEITAS),
        aceito_em: z.iso.datetime({ offset: true }),
      })
      .strict(),
    pagina: z
      .string()
      .max(LIMITE_DA_PAGINA)
      .refine((v) => v.startsWith('https://') && sanitizeUrl(v) === v, { message: 'pagina precisa ser https://' })
      .optional(),
  })
  .strict();

export type PedidoDaLoja = z.infer<typeof PedidoSchema>;

/** Códigos de erro do 422 — o n8n (2.65 AC6) põe o código no alerta. */
export type CodigoDeValidacao =
  | 'CAMPO_A_MAIS'
  | 'PRODUTO_DESCONHECIDO'
  | 'PERFIL_DESCONHECIDO'
  | 'AVISO_NAO_ACEITO'
  | 'VERSAO_DO_AVISO_DESCONHECIDA'
  | 'AVISO_DATA_INVALIDA'
  | 'TELEFONE_INVALIDO'
  | 'EMAIL_INVALIDO'
  | 'NOME_INVALIDO'
  | 'PAGINA_INVALIDA'
  | 'VALIDATION_ERROR';

/**
 * QA M2 (05/11): o que define "o mesmo pedido" para a idempotência — telefone
 * (E.164) + produto. A `Idempotency-Key` (2.65 AC4) já leva o dia; a data/hora do
 * aviso, a página, o perfil e o e-mail NÃO entram: reenvio e clique duplo do
 * mesmo pedido no mesmo dia devolvem o card já criado, com sucesso (nunca 409
 * `IDEMPOTENCY_CONFLICT` nem alerta falso).
 */
export function impressaoDoPedido(pedido: PedidoDaLoja, telefone: string): { telefone: string; produto: string } {
  return { telefone, produto: pedido.produto };
}

export type ResultadoDaValidacao =
  | { ok: true; pedido: PedidoDaLoja; telefone: string }
  | { ok: false; code: CodigoDeValidacao; campos: string[] };

function codigoDoErro(issue: z.core.$ZodIssue): CodigoDeValidacao {
  if (issue.code === 'unrecognized_keys') return 'CAMPO_A_MAIS';
  const [p0, p1] = issue.path.map(String);
  if (p0 === 'produto') return 'PRODUTO_DESCONHECIDO';
  if (p0 === 'perfil') return 'PERFIL_DESCONHECIDO';
  if (p0 === 'consentimento' && p1 === 'aceito') return 'AVISO_NAO_ACEITO';
  if (p0 === 'consentimento' && p1 === 'texto_versao') return 'VERSAO_DO_AVISO_DESCONHECIDA';
  if (p0 === 'consentimento' && p1 === 'aceito_em') return 'AVISO_DATA_INVALIDA';
  if (p0 === 'consentimento') return 'AVISO_NAO_ACEITO';
  if (p0 === 'whatsapp') return 'TELEFONE_INVALIDO';
  if (p0 === 'email') return 'EMAIL_INVALIDO';
  if (p0 === 'nome') return 'NOME_INVALIDO';
  if (p0 === 'pagina') return 'PAGINA_INVALIDA';
  return 'VALIDATION_ERROR';
}

/**
 * Celular/fixo BR válido em E.164 (AC3). `55DD9XXXXXXXX` (o formato da
 * página) também vale. Devolve `null` se não for número BR válido.
 */
export function telefoneBrDoPedido(entrada: string): string | null {
  const e164 = paraE164(entrada);
  if (!e164 || !/^\+55\d{10,11}$/.test(e164)) return null;
  return parsePhoneNumberFromString(e164)?.isValid() ? e164 : null;
}

/** AC3 — valida o corpo; o erro diz só o CÓDIGO e o caminho, nunca o valor recebido. */
export function validarPedido(raw: unknown): ResultadoDaValidacao {
  const r = PedidoSchema.safeParse(raw);
  if (!r.success) {
    // Campo a mais vence: é sinal de contrato divergente (nome antigo, ex.: `para_quem`).
    const issue = r.error.issues.find((i) => i.code === 'unrecognized_keys') ?? r.error.issues[0];
    return {
      ok: false,
      code: codigoDoErro(issue),
      campos: r.error.issues.map((i) => i.path.join('.') || (i.code === 'unrecognized_keys' ? (i as { keys?: string[] }).keys?.join(',') ?? '' : '')),
    };
  }
  const telefone = telefoneBrDoPedido(r.data.whatsapp);
  if (!telefone) return { ok: false, code: 'TELEFONE_INVALIDO', campos: ['whatsapp'] };
  return { ok: true, pedido: r.data, telefone };
}

// =============================================================================
// Respostas
// =============================================================================

export type Acao = 'criou_contato_e_card' | 'reaproveitou_card' | 'segundo_card' | 'criou_card';

/** O que a rota faz com a reserva de idempotência depois. */
export type DestinoDaChave = 'finalizar' | 'liberar';

export interface ResultadoDoPedido {
  status: number;
  body: Record<string, unknown>;
  chave: DestinoDaChave;
}

// =============================================================================
// Nota (AC7)
// =============================================================================

export function idDaNota(organizationId: string, idempotencyKey: string): string {
  return uuidDeterministico(`instituto-nota:${organizationId}:${idempotencyKey}`);
}

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
 * Texto da nota (AC7, E3): produto e preço, para quem é, versão e data/hora do
 * aviso de privacidade, página de origem (ou "não informada", E6) e data/hora do
 * pedido. Sem telefone e sem e-mail (moram no contato). A palavra
 * "consentimento" não aparece (E3: a base legal é execução de contrato).
 */
export function montarDescricaoDaNota(opts: {
  pedido: PedidoDaLoja;
  recebidoEm: string;
  reaproveitado: boolean;
  /** AC4 caso 3 (decisão do Filipe, 05/11). */
  emailEmOutroContato?: boolean;
}): string {
  const produto = PRODUTOS_DA_LOJA[opts.pedido.produto as SlugDoProduto];
  const linhaProduto = `${produto.nome} (${precoEmReais(produto.preco)})`;
  return [
    opts.reaproveitado ? `Pediu também: ${linhaProduto}` : `Produto: ${linhaProduto}`,
    `Para quem é o produto? ${PERFIS_DA_LOJA[opts.pedido.perfil as PerfilDaLoja]}`,
    `Aviso de privacidade: versão ${opts.pedido.consentimento.texto_versao}, registrado em ${dataHoraBR(opts.pedido.consentimento.aceito_em)}`,
    `Página de origem: ${opts.pedido.pagina ?? 'não informada'}`,
    `Pedido recebido em ${dataHoraBR(opts.recebidoEm)} pela loja do site do Instituto.`,
    ...(opts.emailEmOutroContato
      ? ['Atenção: o e-mail informado também está em outro contato do CRM, com outro telefone. O pedido ficou no contato do WhatsApp digitado.']
      : []),
  ].join('\n');
}

// =============================================================================
// Log — lista branca (AC10)
// =============================================================================

type Etapa =
  | 'validar_quadro'
  | 'buscar_contato'
  | 'criar_contato'
  | 'atualizar_contato'
  | 'buscar_card'
  | 'completar_card'
  | 'criar_card'
  | 'gravar_nota'
  | 'reler_card';

/** Só ids, contagens e códigos. Nunca texto do pedido nem `details` do Postgres. */
export function logPedidoErro(input: {
  requestId: string;
  etapa: Etapa | 'idempotencia';
  erro: unknown;
  extra?: Record<string, string | number | boolean | null>;
}): void {
  const seguro = extractSafePgFields(input.erro);
  console.error(
    JSON.stringify({
      evento: 'instituto_pedido_erro',
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
  idempotencyKey: string;
  pedido: PedidoDaLoja;
  telefone: string;
  agoraIso: string;
  /** AC4 caso 3: o e-mail do pedido está num contato com outro telefone. */
  emailEmOutroContato?: boolean;
}

interface CardDoContato {
  id: string;
  stage_id: string | null;
  created_at: string | null;
}

/**
 * AC4 (decisão do Filipe, 05/11 — M3 do QA): **o telefone manda.**
 *   1. contato VIVO pelo telefone, com e sem o 9º dígito (empate ⇒ o mais antigo);
 *   2. senão, pelo e-mail (o mais antigo) — só é reaproveitado se **não tiver
 *      telefone** (o telefone digitado é gravado nele, só se vazio) ou se tiver o
 *      **mesmo** telefone numa das variantes;
 *   3. se o contato do e-mail tiver **outro** telefone, ele NÃO é usado: a rota cria
 *      o contato pelo telefone digitado (RPC da 2.63) e a nota avisa que o e-mail
 *      também está em outro contato (sem mostrar o telefone dele).
 */
export type ContatoAchado = { id: string; por: 'telefone' | 'email_sem_telefone' | 'email_mesmo_telefone' };

export function mesmoTelefone(telefoneDoContato: string | null | undefined, telefoneDigitado: string): boolean {
  const a = variantesDoTelefone(telefoneDoContato ?? '');
  const b = variantesDoTelefone(telefoneDigitado);
  if (!a || !b) return false;
  return a.variantes.some((v) => b.variantes.includes(v));
}

async function buscarContato(ctx: Contexto): Promise<ContatoAchado | null> {
  const tel = variantesDoTelefone(ctx.telefone);
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
    if (achado) return { id: achado.id, por: 'telefone' };
  }
  const { data, error } = await ctx.sb
    .from('contacts')
    .select('id,phone,created_at')
    .eq('organization_id', ctx.organizationId)
    .is('deleted_at', null)
    .is('merged_into_id', null)
    .eq('email', ctx.pedido.email)
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) throw new ErroDeEtapa('buscar_contato', error);
  const porEmail = (data as Array<{ id: string; phone: string | null }> | null)?.[0];
  if (!porEmail) return null;
  if (isBlank(porEmail.phone)) return { id: porEmail.id, por: 'email_sem_telefone' };
  if (mesmoTelefone(porEmail.phone, ctx.telefone)) return { id: porEmail.id, por: 'email_mesmo_telefone' };
  // Caso 3: o e-mail é de um contato com OUTRO telefone — o telefone manda.
  ctx.emailEmOutroContato = true;
  return null;
}

/** Relê o contato e, se vier mesclado, SEGUE `merged_into_id` até o vivo (R11 da 2.59). */
async function resolverContatoVivo(ctx: Contexto, contactId: string): Promise<{ id: string; name: string | null }> {
  let atual = contactId;
  for (let i = 0; i < 5; i++) {
    const { data, error } = await ctx.sb
      .from('contacts')
      .select('id,name,deleted_at,merged_into_id')
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
    return { id: data.id, name: data.name ?? null };
  }
  throw new ErroDeEtapa('criar_contato', { code: 'CADEIA_DE_MESCLA_LONGA' });
}

/**
 * AC4 — contato achado: telefone NUNCA muda; nome, e-mail e `source` só se
 * vazios. Cada escrita é condicionada no banco ao campo estar vazio (sem
 * ler-e-escrever).
 */
async function completarContatoExistente(ctx: Contexto, contactId: string): Promise<void> {
  const soSeVazio = async (coluna: 'name' | 'email' | 'source' | 'phone', valor: string) => {
    const { error } = await ctx.sb
      .from('contacts')
      .update({ [coluna]: valor, updated_at: ctx.agoraIso })
      .eq('organization_id', ctx.organizationId)
      .eq('id', contactId)
      .or(`${coluna}.is.null,${coluna}.eq.`)
      .select('id');
    if (error) throw new ErroDeEtapa('atualizar_contato', error);
  };
  await soSeVazio('name', ctx.pedido.nome);
  await soSeVazio('email', ctx.pedido.email);
  await soSeVazio('source', SOURCE_LP_INSTITUTO);
  // AC4 caso 2: contato achado pelo e-mail sem telefone ganha o telefone digitado
  // (com o 9º dígito), só se vazio. Contato com telefone NUNCA tem o telefone trocado.
  const tel = variantesDoTelefone(ctx.telefone);
  await soSeVazio('phone', tel?.principal ?? ctx.telefone);
}

/**
 * AC4 — nenhum contato achado: cria pela RPC da 2.63, com o telefone COM o 9º
 * dígito e `p_source = 'lp_instituto'`. A RPC reconfere o telefone (exato →
 * variante) sob a trava pela forma canônica — fecha a corrida com o webhook do
 * WhatsApp. Se ela ACHAR um contato (corrida), ele é tratado como existente.
 */
async function criarContato(ctx: Contexto): Promise<{ id: string; novo: boolean }> {
  const tel = variantesDoTelefone(ctx.telefone);
  const { data, error } = await ctx.sb.rpc(RPC_CONTATO_POR_VARIANTES, {
    p_organization_id: ctx.organizationId,
    p_phone: tel?.principal ?? ctx.telefone,
    p_name: ctx.pedido.nome,
    p_source: SOURCE_LP_INSTITUTO,
  });
  if (error) throw new ErroDeEtapa('criar_contato', error);
  // RETURNS TABLE ⇒ o PostgREST devolve uma lista de linhas.
  const linha = (Array.isArray(data) ? data[0] : data) as { contact_id?: string; casou_por?: string } | null;
  if (!linha?.contact_id) throw new ErroDeEtapa('criar_contato', { code: 'RPC_SEM_ID' });
  const vivo = await resolverContatoVivo(ctx, linha.contact_id);
  const novo = linha.casou_por === 'criado' && vivo.id === linha.contact_id;
  if (novo) {
    // A RPC não recebe e-mail: grava agora, só se vazio.
    const { error: e2 } = await ctx.sb
      .from('contacts')
      .update({ email: ctx.pedido.email, updated_at: ctx.agoraIso })
      .eq('organization_id', ctx.organizationId)
      .eq('id', vivo.id)
      .or('email.is.null,email.eq.')
      .select('id');
    if (e2) throw new ErroDeEtapa('atualizar_contato', e2);
  } else {
    await completarContatoExistente(ctx, vivo.id);
  }
  return { id: vivo.id, novo };
}

/** Cards VIVOS do contato no quadro Acreditando, do mais antigo ao mais novo. */
async function cardsDoContato(ctx: Contexto, contactId: string): Promise<CardDoContato[]> {
  const { data, error } = await ctx.sb
    .from('deals')
    .select('id,stage_id,created_at')
    .eq('organization_id', ctx.organizationId)
    .eq('contact_id', contactId)
    .eq('board_id', BOARD_ACREDITANDO)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(100);
  if (error) throw new ErroDeEtapa('buscar_card', error);
  return (data as CardDoContato[] | null) ?? [];
}

export type DecisaoDoCard =
  | { tipo: 'reaproveitar'; dealId: string }
  | { tipo: 'segundo_card' }
  | { tipo: 'criar' };

/**
 * AC5 — a decisão, pura (para teste e mutação). Por uuid, nunca por nome.
 * "Produto vendido" é FECHADO aqui (E8), ao contrário da guarda do WhatsApp.
 */
export function decidirCard(cards: ReadonlyArray<CardDoContato>): DecisaoDoCard {
  const ordenados = [...cards].sort((a, b) => {
    const ca = a.created_at ?? '';
    const cb = b.created_at ?? '';
    return ca < cb ? -1 : ca > cb ? 1 : 0;
  });
  const deProduto = ordenados.find((c) => c.stage_id === ETAPA_PRODUTOS_DE_TREINAMENTO);
  if (deProduto) return { tipo: 'reaproveitar', dealId: deProduto.id };
  // Card sem etapa conta como aberto (mesma leitura da guarda da 2.56).
  const abertoEmOutra = ordenados.some((c) => !c.stage_id || !ETAPAS_FECHADAS_PARA_A_LOJA.includes(c.stage_id));
  if (abertoEmOutra) return { tipo: 'segundo_card' };
  return { tipo: 'criar' };
}

function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] || 'Sem nome';
}

/** AC6 — o que o card criado carrega. */
export function camposDoCardNovo(pedido: PedidoDaLoja): Record<string, string> {
  return {
    [CAMPO_PRODUTO]: PRODUTOS_DA_LOJA[pedido.produto as SlugDoProduto].nome,
    [CAMPO_PARA_QUEM]: PERFIS_DA_LOJA[pedido.perfil as PerfilDaLoja],
    [CAMPO_AVISO_EM]: pedido.consentimento.aceito_em,
    [CAMPO_AVISO_VERSAO]: pedido.consentimento.texto_versao,
    [CAMPO_ORIGEM]: ORIGEM_LP_INSTITUTO,
  };
}

/**
 * AC5/AC6 — cria o card em "Produtos de treinamento". Id gerado ANTES do laço +
 * upsert por id: a retentativa escreve a MESMA linha. Erro ambíguo ⇒ relê por
 * id antes de repetir.
 */
async function criarCard(ctx: Contexto, contactId: string): Promise<{ dealId: string } | { conflito: true }> {
  const produto = PRODUTOS_DA_LOJA[ctx.pedido.produto as SlugDoProduto];
  const idDoDeal = randomUUID();
  const payload = {
    id: idDoDeal,
    organization_id: ctx.organizationId,
    title: `${primeiroNome(ctx.pedido.nome)} — ${produto.nome} (LP Instituto)`.slice(0, 200),
    value: produto.preco,
    board_id: BOARD_ACREDITANDO,
    stage_id: ETAPA_PRODUTOS_DE_TREINAMENTO,
    contact_id: contactId,
    owner_id: DONA_DOS_PEDIDOS_DA_LOJA,
    is_won: false,
    is_lost: false,
    custom_fields: camposDoCardNovo(ctx.pedido),
    created_at: ctx.agoraIso,
    updated_at: ctx.agoraIso,
  };

  type Tentativa = { tipo: 'ok' } | { tipo: 'unico' } | { tipo: 'falhou'; erro: unknown; podeRetentar: boolean };

  const { resultado } = await comRetry<Tentativa>(
    async () => {
      const r = await ctx.sb.from('deals').upsert(payload, { onConflict: 'id' }).select('id');
      if (!r.error) return { tipo: 'ok' };
      if (ehViolacaoDeUnicidade(r.error)) return { tipo: 'unico' };
      if (!isTransientDbError(r.error)) return { tipo: 'falhou', erro: r.error, podeRetentar: false };
      if (!isAmbiguousDbError(r.error)) return { tipo: 'falhou', erro: r.error, podeRetentar: true };
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
  if (resultado.tipo === 'unico') return { conflito: true };
  return { dealId: idDoDeal };
}

/**
 * AC5 — card reaproveitado: só `produtoDeTreinamento` se estiver vazio
 * (e nada mais: etapa, valor, título e dono ficam). Escrita condicionada ao
 * campo vazio no momento — se a Fernanda preencheu, fica o dela.
 */
async function completarCardReaproveitado(ctx: Contexto, dealId: string): Promise<void> {
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    const { data: deal, error } = await ctx.sb
      .from('deals')
      .select('id,custom_fields,updated_at')
      .eq('organization_id', ctx.organizationId)
      .eq('id', dealId)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw new ErroDeEtapa('completar_card', error);
    if (!deal) throw new ErroDeEtapa('completar_card', { code: 'CARD_SUMIU' });
    const atuais = (deal.custom_fields as Record<string, unknown>) ?? {};
    if (!isBlank(atuais[CAMPO_PRODUTO])) return;

    let q = ctx.sb
      .from('deals')
      .update({
        custom_fields: { ...atuais, [CAMPO_PRODUTO]: PRODUTOS_DA_LOJA[ctx.pedido.produto as SlugDoProduto].nome },
        updated_at: ctx.agoraIso,
      })
      .eq('organization_id', ctx.organizationId)
      .eq('id', dealId)
      .is('deleted_at', null);
    if (deal.updated_at) q = q.eq('updated_at', deal.updated_at);
    const { data: escrito, error: eUp } = await q.select('id');
    if (eUp) throw new ErroDeEtapa('completar_card', eUp);
    if ((escrito as unknown[] | null)?.length === 1) return;
    // 0 linhas: o card mudou entre ler e escrever. Relê e tenta de novo.
  }
  throw new ErroDeEtapa('completar_card', { code: 'CARD_MUDANDO_SEM_PARAR' });
}

/** AC7 — UMA nota por pedido (id determinístico pela Idempotency-Key + ignoreDuplicates). */
async function gravarNota(ctx: Contexto, dealId: string, contactId: string, reaproveitado: boolean): Promise<string> {
  const id = idDaNota(ctx.organizationId, ctx.idempotencyKey);
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
        description: montarDescricaoDaNota({
          pedido: ctx.pedido,
          recebidoEm: ctx.agoraIso,
          reaproveitado,
          emailEmOutroContato: ctx.emailEmOutroContato,
        }),
        date: ctx.agoraIso,
        completed: true,
        created_at: ctx.agoraIso,
      },
      { onConflict: 'id', ignoreDuplicates: true }
    )
    .select('id');
  if (error) throw new ErroDeEtapa('gravar_nota', error);
  return id;
}

/**
 * AC9 — relê o card (etapa, dono, `produtoDeTreinamento`, `value`) e a nota
 * antes de dizer "ok". Card criado: cada valor tem de ser EXATAMENTE o
 * pretendido. Card reaproveitado: vivo, na etapa de produto, com produto
 * preenchido (o valor/dono são os da Fernanda — não comparamos com o pedido).
 */
async function relerCardENota(
  ctx: Contexto,
  dealId: string,
  notaId: string,
  esperado: 'criado' | 'reaproveitado'
): Promise<void> {
  const { data, error } = await ctx.sb
    .from('deals')
    .select('id,stage_id,owner_id,value,custom_fields')
    .eq('organization_id', ctx.organizationId)
    .eq('id', dealId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new ErroDeEtapa('reler_card', error);
  if (!data) throw new ErroDeEtapa('reler_card', { code: 'READBACK_DIVERGENTE', motivo: 'card_nao_relido' });
  const cf = (data.custom_fields as Record<string, unknown>) ?? {};

  const divergentes: string[] = [];
  if (esperado === 'criado') {
    const produto = PRODUTOS_DA_LOJA[ctx.pedido.produto as SlugDoProduto];
    if (data.stage_id !== ETAPA_PRODUTOS_DE_TREINAMENTO) divergentes.push('stage_id');
    if (data.owner_id !== DONA_DOS_PEDIDOS_DA_LOJA) divergentes.push('owner_id');
    if (Number(data.value) !== produto.preco) divergentes.push('value');
    for (const [k, v] of Object.entries(camposDoCardNovo(ctx.pedido))) if (cf[k] !== v) divergentes.push(k);
  } else if (isBlank(cf[CAMPO_PRODUTO])) {
    divergentes.push(CAMPO_PRODUTO);
  }
  if (divergentes.length > 0) {
    throw new ErroDeEtapa('reler_card', { code: 'READBACK_DIVERGENTE', quantidade: divergentes.length });
  }

  const { data: nota, error: eNota } = await ctx.sb
    .from('activities')
    .select('id,deal_id')
    .eq('organization_id', ctx.organizationId)
    .eq('id', notaId)
    .limit(1);
  if (eNota) throw new ErroDeEtapa('reler_card', eNota);
  const n = (nota as Array<{ id: string; deal_id: string }> | null)?.[0];
  if (!n || n.deal_id !== dealId) throw new ErroDeEtapa('reler_card', { code: 'READBACK_DIVERGENTE', motivo: 'nota' });
}

export interface OpcoesDoProcessamento {
  organizationId: string;
  pedido: PedidoDaLoja;
  /** Telefone já validado e em E.164 (`validarPedido`). */
  telefone: string;
  idempotencyKey: string;
  requestId: string;
  /** Ensaio (AC11): decide e responde a ação PREVISTA, sem gravar nada. */
  ensaio?: boolean;
  agora?: () => Date;
}

export async function processarPedidoDaLoja(opts: OpcoesDoProcessamento): Promise<ResultadoDoPedido> {
  const agora = (opts.agora ?? (() => new Date()))();
  const requestId = opts.requestId;
  const ctx: Contexto = {
    sb: createStaticAdminClient(),
    organizationId: opts.organizationId,
    requestId,
    idempotencyKey: opts.idempotencyKey,
    pedido: opts.pedido,
    telefone: opts.telefone,
    agoraIso: agora.toISOString(),
  };

  /** AC9 — sucesso SEM nome, telefone, e-mail ou "para quem". */
  const responder = (status: number, acao: Acao, contactId: string | null, dealId: string | null): ResultadoDoPedido => ({
    status,
    body: {
      acao,
      deal_id: dealId,
      contact_id: contactId,
      request_id: requestId,
      ...(opts.ensaio ? { ensaio: true } : {}),
    },
    chave: 'finalizar',
  });

  let acaoPrevista: Acao | null = null;
  try {
    // 0. A etapa "Produtos de treinamento" existe no quadro desta organização
    //    (sem a migration aplicada, a rota não grava nada).
    const { data: etapa, error: eEt } = await ctx.sb
      .from('board_stages')
      .select('id,board_id')
      .eq('organization_id', ctx.organizationId)
      .eq('id', ETAPA_PRODUTOS_DE_TREINAMENTO)
      .eq('board_id', BOARD_ACREDITANDO)
      .maybeSingle();
    if (eEt) throw new ErroDeEtapa('validar_quadro', eEt);
    if (!etapa) {
      logPedidoErro({ requestId, etapa: 'validar_quadro', erro: { code: 'ETAPA_AUSENTE' } });
      return {
        status: 503,
        body: { error: 'Stage not available', code: 'ETAPA_AUSENTE', request_id: requestId },
        chave: 'liberar',
      };
    }

    // 1. Contato (AC4)
    const achado = await buscarContato(ctx);
    if (!achado) {
      if (opts.ensaio) return responder(200, 'criou_contato_e_card', null, null);
    } else if (!opts.ensaio) {
      await completarContatoExistente(ctx, achado.id);
    }

    let contactId: string;
    let contatoNovo = false;
    if (achado) {
      contactId = achado.id;
    } else {
      const criado = await criarContato(ctx);
      contactId = criado.id;
      contatoNovo = criado.novo;
    }

    // 2. Card (AC5)
    const decisao = decidirCard(await cardsDoContato(ctx, contactId));
    acaoPrevista =
      decisao.tipo === 'reaproveitar'
        ? 'reaproveitou_card'
        : decisao.tipo === 'segundo_card'
          ? 'segundo_card'
          : contatoNovo
            ? 'criou_contato_e_card'
            : 'criou_card';

    if (opts.ensaio) return responder(200, acaoPrevista, contactId, decisao.tipo === 'reaproveitar' ? decisao.dealId : null);

    if (decisao.tipo === 'reaproveitar') {
      await completarCardReaproveitado(ctx, decisao.dealId);
      const notaId = await gravarNota(ctx, decisao.dealId, contactId, true);
      await relerCardENota(ctx, decisao.dealId, notaId, 'reaproveitado');
      return responder(200, 'reaproveitou_card', contactId, decisao.dealId);
    }

    const criado = await criarCard(ctx, contactId);
    if ('conflito' in criado) {
      // 23505 do trigger `check_deal_duplicate` (mesmo contato + mesma etapa,
      // card aberto): NUNCA concluir "já processado" pelo código. Relê e decide.
      const relido = decidirCard(await cardsDoContato(ctx, contactId));
      if (relido.tipo === 'reaproveitar') {
        await completarCardReaproveitado(ctx, relido.dealId);
        const notaId = await gravarNota(ctx, relido.dealId, contactId, true);
        await relerCardENota(ctx, relido.dealId, notaId, 'reaproveitado');
        return responder(200, 'reaproveitou_card', contactId, relido.dealId);
      }
      logPedidoErro({ requestId, etapa: 'criar_card', erro: { code: '23505' }, extra: { motivo: 'check_deal_duplicate' } });
      return {
        status: 409,
        body: { error: 'Contact already has an open deal in the target stage', code: 'CONFLICT', request_id: requestId },
        chave: 'liberar',
      };
    }

    const notaId = await gravarNota(ctx, criado.dealId, contactId, false);
    await relerCardENota(ctx, criado.dealId, notaId, 'criado');
    return responder(201, acaoPrevista, contactId, criado.dealId);
  } catch (e) {
    const etapa = e instanceof ErroDeEtapa ? e.etapa : 'buscar_card';
    const causa = e instanceof ErroDeEtapa ? e.causa : e;
    const readback =
      !!causa && typeof causa === 'object' && (causa as { code?: unknown }).code === 'READBACK_DIVERGENTE';
    logPedidoErro({ requestId, etapa, erro: causa, extra: { acao_prevista: acaoPrevista } });
    return {
      status: 500,
      body: {
        error: 'Internal server error',
        code: readback ? 'READBACK_DIVERGENTE' : 'DB_ERROR',
        request_id: requestId,
        etapa,
      },
      // Libera a chave (AC8): reenviar é seguro — contato é achado, card de
      // produto é reaproveitado, a nota tem id fixo pela chave.
      chave: 'liberar',
    };
  }
}
