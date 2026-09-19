import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authPublicApi } from '@/lib/public-api/auth';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { decodeOffsetCursor, encodeOffsetCursor, parseLimit } from '@/lib/public-api/cursor';
import { sanitizePostgrestValue } from '@/lib/utils/sanitize';
import { resolveBoardIdFromKey, resolveFirstStageId } from '@/lib/public-api/resolve';
import { normalizeEmail, normalizePhone, normalizeText } from '@/lib/public-api/sanitize';
import { sanitizeUUID } from '@/lib/supabase/utils';
import {
  classifyDbError,
  isAmbiguousDbError,
  isTransientDbError,
  messageForDbErrorCode,
} from '@/lib/public-api/db-errors';
import { comRetry } from '@/lib/public-api/retry';
import {
  logPublicApiDbError,
  logPublicApiDbRetry,
  logPublicApiEscritaConfirmada,
  logPublicApiReservaAssumida,
} from '@/lib/public-api/errorLog';
import {
  beginIdempotency,
  finalizeIdempotency,
  hashRequestBody,
  releaseIdempotency,
  type IdempotencyRef,
} from '@/lib/public-api/idempotency';

export const runtime = 'nodejs';

/** Chave de idempotência é por endpoint — ver `public_api_idempotency`. */
export const DEALS_CREATE_ENDPOINT = 'POST /deals';

const ROTA = 'POST /api/public/v1/deals';

/** Colunas do negócio devolvidas ao cliente — as mesmas no insert e na verificação. */
const CAMPOS_DEAL =
  'id,title,value,board_id,stage_id,contact_id,client_company_id,is_won,is_lost,loss_reason,closed_at,created_at,updated_at';

const ContactInlineSchema = z.object({
  name: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  role: z.string().optional(),
  client_company_id: z.string().uuid().optional(),
}).strict();

const DealCreateSchema = z.object({
  title: z.string().min(1),
  value: z.number().optional(),
  board_id: z.string().uuid().optional(),
  board_key: z.string().min(1).optional(),
  stage_id: z.string().uuid().optional(),
  contact_id: z.string().uuid().optional(),
  contact: ContactInlineSchema.optional(),
  client_company_id: z.string().uuid().optional(),
}).strict();

export async function GET(request: Request) {
  const auth = await authPublicApi(request);
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();
  const boardId = sanitizeUUID(url.searchParams.get('board_id'));
  const boardKey = (url.searchParams.get('board_key') || '').trim();
  const stageId = sanitizeUUID(url.searchParams.get('stage_id'));
  const contactId = sanitizeUUID(url.searchParams.get('contact_id'));
  const clientCompanyId = sanitizeUUID(url.searchParams.get('client_company_id'));
  const status = (url.searchParams.get('status') || '').trim(); // open|won|lost
  const updatedAfter = (url.searchParams.get('updated_after') || '').trim();
  const limit = parseLimit(url.searchParams.get('limit'));
  const offset = decodeOffsetCursor(url.searchParams.get('cursor'));

  const sb = createStaticAdminClient();

  let resolvedBoardId = boardId;
  if (!resolvedBoardId && boardKey) {
    resolvedBoardId = await resolveBoardIdFromKey({ organizationId: auth.organizationId, boardKey });
  }

  let query = sb
    .from('deals')
    .select('id,title,value,board_id,stage_id,contact_id,client_company_id,is_won,is_lost,loss_reason,closed_at,created_at,updated_at', { count: 'exact' })
    .eq('organization_id', auth.organizationId)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false });

  if (resolvedBoardId) query = query.eq('board_id', resolvedBoardId);
  if (stageId) query = query.eq('stage_id', stageId);
  if (contactId) query = query.eq('contact_id', contactId);
  if (clientCompanyId) query = query.eq('client_company_id', clientCompanyId);
  if (updatedAfter) query = query.gte('updated_at', updatedAfter);
  if (q) {
    const safeQ = sanitizePostgrestValue(q)
    if (safeQ) query = query.ilike('title', `%${safeQ}%`);
  }

  if (status === 'open') query = query.eq('is_won', false).eq('is_lost', false);
  if (status === 'won') query = query.eq('is_won', true);
  if (status === 'lost') query = query.eq('is_lost', true);

  const from = offset;
  const to = offset + limit - 1;
  const { data, count, error } = await query.range(from, to);
  if (error) {
    console.error('[API] Database error:', error)
    return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 })
  }

  const total = count ?? 0;
  const nextOffset = to + 1;
  const nextCursor = nextOffset < total ? encodeOffsetCursor(nextOffset) : null;

  return NextResponse.json({
    data: (data || []).map((d: any) => ({
      id: d.id,
      title: d.title,
      value: Number(d.value ?? 0),
      board_id: d.board_id,
      stage_id: d.stage_id,
      contact_id: d.contact_id,
      client_company_id: d.client_company_id ?? null,
      is_won: !!d.is_won,
      is_lost: !!d.is_lost,
      loss_reason: d.loss_reason ?? null,
      closed_at: d.closed_at ?? null,
      created_at: d.created_at,
      updated_at: d.updated_at,
    })),
    nextCursor,
  });
}

async function upsertContactForDeal(opts: {
  organizationId: string;
  contact: z.infer<typeof ContactInlineSchema>;
}) {
  const sb = createStaticAdminClient();
  const email = normalizeEmail(opts.contact.email);
  const phone = normalizePhone(opts.contact.phone);
  const name = normalizeText(opts.contact.name);
  if (!email && !phone) {
    throw new Error('Provide contact.email or contact.phone');
  }

  let lookup = sb
    .from('contacts')
    .select('id')
    .eq('organization_id', opts.organizationId)
    .is('deleted_at', null);
  if (email && phone) lookup = lookup.or(`email.eq.${email},phone.eq.${phone}`);
  else if (email) lookup = lookup.eq('email', email);
  else lookup = lookup.eq('phone', phone);

  const existing = await lookup.maybeSingle();
  if (existing.error) throw existing.error;

  const now = new Date().toISOString();
  const base: any = {
    organization_id: opts.organizationId,
    email,
    phone,
    role: normalizeText(opts.contact.role),
    client_company_id: sanitizeUUID(opts.contact.client_company_id) || null,
    updated_at: now,
  };

  if (existing.data?.id) {
    if (name) base.name = name;
    const { data, error } = await sb.from('contacts').update(base).eq('id', existing.data.id).select('id').single();
    if (error) throw error;
    return data.id as string;
  }

  if (!name) throw new Error('contact.name is required to create a new contact');
  const insert = {
    ...base,
    name,
    created_at: now,
    status: 'ACTIVE',
    stage: 'LEAD',
  };
  const { data, error } = await sb.from('contacts').insert(insert).select('id').single();
  if (error) throw error;
  return data.id as string;
}

/**
 * A escrita aconteceu? — leitura de volta depois de erro **ambíguo**.
 *
 * Story 2.51, ACHADO 1+2 do QA. Um `08006` ou um `fetch failed` significam "a
 * conexão caiu", não "o INSERT falhou": o Postgres pode ter commitado e só a
 * resposta ter se perdido. Repetir o comando nesse estado cria um SEGUNDO
 * negócio — e liberar a chave de idempotência cria um terceiro no reenvio.
 *
 * É a mesma doutrina que já vale para as campanhas do Meta: **"a API respondeu
 * OK" nunca é prova; o estado real é lido de volta.** Aqui vale ao contrário —
 * "a API respondeu erro" também não é prova.
 *
 * A busca usa os campos que a própria requisição acabou de escrever, com
 * `created_at >= marcoTemporal` (capturado antes do INSERT) para não confundir
 * com um negócio igual criado ontem.
 */
async function verificarInsertDeal(opts: {
  organizationId: string;
  boardId: string;
  title: string;
  /**
   * OBRIGATÓRIO — ACHADO 3 do QA. Era opcional, e com ele ausente o filtro caía
   * para `org + board + title + janela`: dois visitantes com o mesmo título (a LP
   * manda um título fixo) na mesma janela e a verificação devolveria o negócio de
   * OUTRA PESSOA como se fosse o desta requisição. Hoje o contato é sempre
   * resolvido antes do INSERT; o tipo passa a garantir que continue assim.
   */
  contactId: string;
  marcoTemporal: string;
}): Promise<
  | { estado: 'encontrado'; deal: Record<string, unknown> }
  | { estado: 'ausente' }
  | { estado: 'indeterminado'; erro: unknown }
> {
  const sb = createStaticAdminClient();
  const query = sb
    .from('deals')
    .select(CAMPOS_DEAL)
    .eq('organization_id', opts.organizationId)
    .eq('board_id', opts.boardId)
    .eq('title', opts.title)
    .eq('contact_id', opts.contactId)
    .gte('created_at', opts.marcoTemporal)
    .limit(1);

  const { data, error } = await query;
  if (error) return { estado: 'indeterminado', erro: error };

  const linha = (data as Record<string, unknown>[] | null)?.[0];
  return linha ? { estado: 'encontrado', deal: linha } : { estado: 'ausente' };
}

/** Resultado de uma tentativa de INSERT já resolvida quanto à ambiguidade. */
type TentativaInsert =
  /** Deu certo de primeira. */
  | { tipo: 'ok'; deal: Record<string, unknown> }
  /** Deu erro, mas a leitura de volta achou o negócio: commitou. */
  | { tipo: 'confirmado_por_leitura'; deal: Record<string, unknown>; erro: unknown }
  /** Falhou. `podeRetentar` só é `true` quando está PROVADO que nada foi escrito. */
  | { tipo: 'falhou'; erro: unknown; podeRetentar: boolean; indeterminado: boolean };

/**
 * POST /api/public/v1/deals — story 2.51.
 *
 * O que mudou: toda falha carrega `request_id` (no log E na resposta), erro
 * passageiro é retentado até 2 vezes, erro definitivo para de se disfarçar de
 * `DB_ERROR` e `Idempotency-Key` (opcional) impede que o retry crie dois
 * negócios. **Sem o header, o comportamento é o mesmo de antes.**
 */
export async function POST(request: Request) {
  const requestId = randomUUID();

  const auth = await authPublicApi(request);
  if (!auth.ok) {
    return NextResponse.json({ ...auth.body, request_id: requestId }, { status: auth.status });
  }

  const erroSimples = (status: number, error: string, code: string, extra?: Record<string, unknown>) =>
    NextResponse.json({ error, code, request_id: requestId, ...(extra ?? {}) }, { status });

  const raw = await request.json().catch(() => null);
  const parsed = DealCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return erroSimples(422, 'Invalid payload', 'VALIDATION_ERROR');
  }

  // Idempotência: a reserva vem ANTES de qualquer escrita — replay não reprocessa.
  const idempotencyKey = request.headers.get('idempotency-key')?.trim() || '';
  const ref: IdempotencyRef | null = idempotencyKey
    ? {
        organizationId: auth.organizationId,
        endpoint: DEALS_CREATE_ENDPOINT,
        idempotencyKey,
        requestHash: hashRequestBody(raw),
      }
    : null;

  if (ref) {
    const outcome = await beginIdempotency(ref);
    if (outcome.kind === 'replay') {
      const body = (outcome.body ?? {}) as Record<string, unknown>;
      return NextResponse.json({ ...body, idempotent_replay: true }, { status: outcome.status });
    }
    if (outcome.kind === 'conflict') {
      return erroSimples(409, 'Idempotency key reused with different payload', 'IDEMPOTENCY_CONFLICT');
    }
    if (outcome.kind === 'error') {
      logPublicApiDbError({
        requestId,
        rota: ROTA,
        etapa: 'idempotency',
        tentativa: 1,
        erro: { message: outcome.message },
      });
      return erroSimples(500, 'Internal server error', 'DB_ERROR');
    }
    if (outcome.kind === 'proceed' && outcome.reservaExpiradaAssumida) {
      // A chave estava presa numa reserva que nunca foi finalizada. Esta
      // requisição a assumiu — o lead deixa de esperar a virada do dia.
      logPublicApiReservaAssumida({ requestId, rota: ROTA, etapa: 'idempotency' });
    }
  }

  /**
   * Resposta terminal.
   *
   * - **2xx / 4xx** ficam guardados na chave (o retry recebe a mesma resposta).
   * - **5xx libera a chave por padrão**, senão um erro passageiro condenaria
   *   todo retry do dia — a LP deriva a chave de e-mail + whatsapp + data (AC7).
   * - **`liberarChave: false`** mantém a chave reservada mesmo em 5xx. É o caso
   *   em que NÃO foi possível provar que a escrita não aconteceu (ACHADO 1+2 do
   *   QA): o próximo reenvio recebe `IDEMPOTENCY_IN_PROGRESS` em vez de criar um
   *   negócio duplicado. **Duplicar é pior que atrasar.**
   */
  const responder = async (
    status: number,
    body: Record<string, unknown>,
    opts?: { liberarChave?: boolean }
  ) => {
    if (ref) {
      const liberar = opts?.liberarChave ?? status >= 500;
      if (liberar) await releaseIdempotency(ref);
      else if (status < 500) await finalizeIdempotency(ref, { status, body });
      // 5xx com a chave mantida: fica `response_status = 0` de propósito.
    }
    return NextResponse.json(body, { status });
  };

  const erro = (
    status: number,
    error: string,
    code: string,
    extra?: Record<string, unknown>,
    opts?: { liberarChave?: boolean }
  ) => responder(status, { error, code, request_id: requestId, ...(extra ?? {}) }, opts);

  const sb = createStaticAdminClient();

  /**
   * Resolve com retentativa — ACHADO 3 do QA.
   *
   * Antes, QUALQUER exceção do resolve virava `422 INVALID_BOARD`, e o 4xx era
   * gravado na chave de idempotência: um blip de conexão de 2 segundos fazia o
   * visitante receber "board inválido" pelas 24 h seguintes, sobre um board que
   * existe. Agora o erro é classificado — passageiro retenta e, se persistir,
   * vira 503 com a chave liberada (nada foi escrito); só o erro definitivo, ou
   * o board que realmente não existe (resolve devolve `null`), continua 422.
   */
  const resolverComRetry = async (
    etapa: 'resolve_board' | 'resolve_stage',
    fn: () => Promise<string | null>
  ): Promise<{ valor: string | null; erro: unknown }> => {
    const { resultado } = await comRetry(
      async (): Promise<{ valor: string | null; erro: unknown }> => {
        try {
          return { valor: await fn(), erro: null };
        } catch (e) {
          return { valor: null, erro: e };
        }
      },
      {
        deveRetentar: (r) => !!r.erro && isTransientDbError(r.erro),
        aoRetentar: ({ tentativa, esperaMs, resultado: r }) =>
          logPublicApiDbRetry({ requestId, rota: ROTA, etapa, tentativa, erro: r.erro, esperaMs }),
      }
    );
    return resultado;
  };

  // --- board -------------------------------------------------------------
  let boardId = sanitizeUUID(parsed.data.board_id);
  if (!boardId && parsed.data.board_key) {
    const boardKey = parsed.data.board_key;
    const r = await resolverComRetry('resolve_board', () =>
      resolveBoardIdFromKey({ organizationId: auth.organizationId, boardKey })
    );
    if (r.erro) {
      // Antes: `throw` sem try/catch ⇒ 500 do Next, sem corpo JSON. (AC4)
      const transitorio = isTransientDbError(r.erro);
      logPublicApiDbError({
        requestId,
        rota: ROTA,
        etapa: 'resolve_board',
        tentativa: 3,
        erro: r.erro,
        extra: { classe: transitorio ? 'transitorio' : 'definitivo' },
      });
      if (transitorio) {
        return erro(503, 'Board lookup temporarily unavailable', 'DB_UNAVAILABLE', { field: 'board_key' });
      }
      return erro(422, 'Could not resolve board', 'INVALID_BOARD', { field: 'board_key' });
    }
    boardId = r.valor;
  }
  if (!boardId) {
    return erro(422, 'Provide board_id or board_key', 'VALIDATION_ERROR');
  }

  // --- stage -------------------------------------------------------------
  const boardIdResolvido = boardId;
  let stageId = sanitizeUUID(parsed.data.stage_id);
  if (!stageId) {
    const r = await resolverComRetry('resolve_stage', () =>
      resolveFirstStageId({ organizationId: auth.organizationId, boardId: boardIdResolvido })
    );
    if (r.erro) {
      const transitorio = isTransientDbError(r.erro);
      logPublicApiDbError({
        requestId,
        rota: ROTA,
        etapa: 'resolve_stage',
        tentativa: 3,
        erro: r.erro,
        extra: { classe: transitorio ? 'transitorio' : 'definitivo' },
      });
      if (transitorio) {
        return erro(503, 'Stage lookup temporarily unavailable', 'DB_UNAVAILABLE', { field: 'stage_id' });
      }
      return erro(422, 'Could not resolve stage', 'INVALID_STAGE', { field: 'stage_id' });
    }
    stageId = r.valor;
  }
  if (!stageId) {
    return erro(422, 'No stages found for board', 'VALIDATION_ERROR');
  }

  // --- contato -----------------------------------------------------------
  let contactId = sanitizeUUID(parsed.data.contact_id);
  /** AC6: só é órfão o contato que ESTA requisição criou/atualizou. */
  let contatoDestaRequisicao: string | null = null;
  if (!contactId && parsed.data.contact) {
    const contatoPedido = parsed.data.contact;
    /** Erro do Postgres e erro de validação viravam o MESMO 422 VALIDATION_ERROR. */
    const ehErroDeBanco = (e: unknown) => !!e && typeof e === 'object' && ('code' in e || 'details' in e);

    /**
     * ACHADO 5 do QA: o upsert de contato também tem direito a retentativa.
     *
     * É o mais seguro dos três pontos de escrita — ele faz o SELECT antes, então
     * a segunda tentativa encontra o contato que a primeira criou e faz UPDATE
     * em vez de um segundo INSERT. A própria função é a verificação.
     */
    const { resultado } = await comRetry(
      async (): Promise<{ id: string | null; erro: unknown }> => {
        try {
          return { id: await upsertContactForDeal({ organizationId: auth.organizationId, contact: contatoPedido }), erro: null };
        } catch (e) {
          return { id: null, erro: e };
        }
      },
      {
        deveRetentar: (r) => !!r.erro && ehErroDeBanco(r.erro) && isTransientDbError(r.erro),
        aoRetentar: ({ tentativa, esperaMs, resultado: r }) =>
          logPublicApiDbRetry({ requestId, rota: ROTA, etapa: 'upsert_contact', tentativa, erro: r.erro, esperaMs }),
      }
    );

    if (!resultado.erro) {
      contactId = resultado.id;
      contatoDestaRequisicao = contactId;
    } else {
      const e = resultado.erro as { message?: string };
      if (!ehErroDeBanco(e)) {
        return erro(422, e?.message || 'Invalid contact', 'VALIDATION_ERROR');
      }
      const classificado = classifyDbError(e);
      logPublicApiDbError({
        requestId,
        rota: ROTA,
        etapa: 'upsert_contact',
        tentativa: 1,
        erro: e,
        extra: { classe: classificado.classe, campo: classificado.campo },
      });
      return erro(
        classificado.status,
        messageForDbErrorCode(classificado.code, classificado.campo),
        classificado.code,
        classificado.campo ? { field: classificado.campo } : undefined
      );
    }
  }
  if (!contactId) {
    return erro(422, 'Provide contact_id or contact', 'VALIDATION_ERROR');
  }

  // --- insert do negócio -------------------------------------------------
  /** Capturado ANTES do INSERT: é o piso do `created_at` na leitura de volta. */
  const marcoTemporal = new Date().toISOString();
  const titulo = parsed.data.title.trim();
  const value = Number(parsed.data.value ?? 0);
  /** Narrowing para a verificação (ACHADO 3): `let` não narra dentro do closure. */
  const contatoResolvido: string = contactId;
  /**
   * Id do negócio gerado AQUI, uma vez só, antes do laço — ACHADO 2 do QA.
   *
   * `deals.id` é `uuid primary key default gen_random_uuid()`
   * (`20251201000000_schema_init.sql`): passar o id explicitamente é legítimo, o
   * default só preenche quando a coluna vem ausente.
   *
   * Com o id fixo e `upsert(onConflict: 'id')`, a retentativa escreve
   * **literalmente a mesma linha**: se a primeira tentativa commitou e só a
   * resposta se perdeu, a segunda encontra a PK e atualiza a mesma linha em vez
   * de criar um irmão. Duplicidade deixa de depender de a leitura de volta
   * acertar — deixa de ser possível por construção. A verificação continua como
   * segunda linha de defesa (é ela que devolve o negócio certo no 201).
   */
  const idDoDeal = randomUUID();
  const insertPayload: any = {
    id: idDoDeal,
    organization_id: auth.organizationId,
    title: titulo,
    value,
    board_id: boardId,
    stage_id: stageId,
    contact_id: contactId,
    client_company_id: sanitizeUUID(parsed.data.client_company_id) || null,
    is_won: false,
    is_lost: false,
    created_at: marcoTemporal,
    updated_at: marcoTemporal,
  };

  const { resultado, tentativas } = await comRetry<TentativaInsert>(
    async (): Promise<TentativaInsert> => {
      const r = await sb
        .from('deals')
        .upsert(insertPayload, { onConflict: 'id' })
        .select(CAMPOS_DEAL)
        .single();
      if (!r.error) return { tipo: 'ok', deal: r.data as Record<string, unknown> };

      // Definitivo: nada foi escrito e repetir não muda nada.
      if (!isTransientDbError(r.error)) {
        return { tipo: 'falhou', erro: r.error, podeRetentar: false, indeterminado: false };
      }

      // Transitório INEQUÍVOCO (57014, 53300): não commitou. Retenta direto.
      if (!isAmbiguousDbError(r.error)) {
        return { tipo: 'falhou', erro: r.error, podeRetentar: true, indeterminado: false };
      }

      // Transitório AMBÍGUO: pode ter commitado. Lê de volta antes de tocar de novo.
      const verificacao = await verificarInsertDeal({
        organizationId: auth.organizationId,
        boardId: insertPayload.board_id,
        title: titulo,
        contactId: contatoResolvido,
        marcoTemporal,
      });

      if (verificacao.estado === 'encontrado') {
        return { tipo: 'confirmado_por_leitura', deal: verificacao.deal, erro: r.error };
      }
      if (verificacao.estado === 'ausente') {
        return { tipo: 'falhou', erro: r.error, podeRetentar: true, indeterminado: false };
      }

      // Nem a verificação respondeu. Parar aqui é a única saída que não duplica.
      logPublicApiDbError({
        requestId,
        rota: ROTA,
        etapa: 'verificar_insert',
        tentativa: 1,
        erro: verificacao.erro,
        extra: { escrita_indeterminada: true },
      });
      return { tipo: 'falhou', erro: r.error, podeRetentar: false, indeterminado: true };
    },
    {
      deveRetentar: (r) => r.tipo === 'falhou' && r.podeRetentar,
      aoRetentar: ({ tentativa, esperaMs, resultado: r }) =>
        logPublicApiDbRetry({
          requestId,
          rota: ROTA,
          etapa: 'insert_deal',
          tentativa,
          erro: r.tipo === 'falhou' ? r.erro : null,
          esperaMs,
        }),
    }
  );

  if (resultado.tipo === 'confirmado_por_leitura') {
    // A escrita ACONTECEU — só a resposta se perdeu. 201 é o resultado que o
    // cliente esperava; retentar aqui seria criar o segundo negócio.
    logPublicApiEscritaConfirmada({
      requestId,
      rota: ROTA,
      tentativa: tentativas,
      erro: resultado.erro,
      dealId: (resultado.deal.id as string) ?? null,
    });
    return responder(201, {
      data: resultado.deal,
      action: 'created',
      request_id: requestId,
      escrita_confirmada_por_leitura: true,
    });
  }

  if (resultado.tipo === 'falhou') {
    const classificado = classifyDbError(resultado.erro);
    logPublicApiDbError({
      requestId,
      rota: ROTA,
      etapa: 'insert_deal',
      tentativa: tentativas,
      erro: resultado.erro,
      contatoOrfao: contatoDestaRequisicao,
      extra: {
        classe: classificado.classe,
        campo: classificado.campo,
        ...(resultado.indeterminado ? { escrita_indeterminada: true } : {}),
      },
    });
    return erro(
      classificado.status,
      messageForDbErrorCode(classificado.code, classificado.campo),
      classificado.code,
      classificado.campo ? { field: classificado.campo } : undefined,
      // Indeterminado = não foi possível provar que nada foi escrito ⇒ a chave
      // FICA reservada. Liberar aqui transformaria o reenvio num duplicado.
      resultado.indeterminado ? { liberarChave: false } : undefined
    );
  }

  return responder(201, { data: resultado.deal, action: 'created', request_id: requestId });
}

