/**
 * Story 2.51 — "O erro que ninguém viu" (AC8).
 *
 * Prova, com `fetch` nunca tocado e Supabase mockado, que:
 *   1. erro passageiro é retentado e o lead entra mesmo assim;
 *   2. erro passageiro persistente devolve `request_id` e a contagem de tentativas;
 *   3. FK inválida vira 422 INVALID_REFERENCE sem NENHUMA retentativa;
 *   4. a mesma `Idempotency-Key` duas vezes cria UM negócio;
 *   5. 🔒 o log de erro não carrega nome, e-mail nem telefone do lead;
 *   6. erro AMBÍGUO (a conexão caiu) é resolvido lendo o negócio de volta —
 *      nunca repetindo o INSERT no escuro. (ACHADO 1+2 do QA)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5';
const BOARD_ID = 'b2c3d4e5-f6a7-4b8c-9d0e-f1a2b3c4d5e6';
const STAGE_ID = 'c3d4e5f6-a7b8-4c9d-8e0f-a1b2c3d4e5f6';
const CONTACT_ID = 'd4e5f6a7-b8c9-4d0e-8f1a-b2c3d4e5f6a7';
const DEAL_ID = 'e5f6a7b8-c9d0-4e1f-8a2b-c3d4e5f6a7b8';

const LEAD = { name: 'Maria Aparecida Silva', email: 'maria.silva@exemplo.com', phone: '11987654321' };

const AUTH_OK = {
  ok: true as const,
  organizationId: ORG_ID,
  organizationName: 'Org Test',
  apiKeyId: 'key-id-1',
  apiKeyPrefix: 'test_',
};

const DEAL_ROW = {
  id: DEAL_ID,
  title: 'Lead da LP',
  value: 0,
  board_id: BOARD_ID,
  stage_id: STAGE_ID,
  contact_id: CONTACT_ID,
  client_company_id: null,
  is_won: false,
  is_lost: false,
  loss_reason: null,
  closed_at: null,
  created_at: '2026-09-18T00:00:00Z',
  updated_at: '2026-09-18T00:00:00Z',
};

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock('@/lib/public-api/auth', () => ({ authPublicApi: vi.fn() }));

vi.mock('@/lib/public-api/resolve', () => ({
  resolveBoardIdFromKey: vi.fn(async () => BOARD_ID),
  resolveFirstStageId: vi.fn(async () => STAGE_ID),
}));

/** Resultado do INSERT do deal: cada teste empilha o que quiser. */
const dealSingle = vi.fn(async () => ({ data: DEAL_ROW, error: null as unknown }));
/** Resultado da LEITURA DE VOLTA (verificação pós-erro ambíguo). */
const dealVerificacao = vi.fn(async () => ({ data: [] as unknown[], error: null as unknown }));
const dealInsert = vi.fn();

/**
 * Filtros aplicados na ÚLTIMA leitura de volta — ACHADO 4 da rodada 3 do QA.
 *
 * O mock antigo engolia os argumentos de `eq()` e `gte()`: QA-1 e QA-2 passariam
 * intactos mesmo se `verificarInsertDeal` não filtrasse por `organization_id`,
 * `title` ou `created_at` — ou seja, exercitavam o caminho sem provar nada sobre
 * ele. Agora cada filtro é registrado e há teste que os confere um a um.
 */
let filtrosVerificacao: Array<[string, string, unknown]> = [];

/**
 * Builder de `deals`. O caminho do UPSERT termina em `.single()`; o da
 * verificação é aguardado direto (`await query`) e cai no `then`.
 */
class DealsBuilder {
  /** Só a leitura de volta encadeia filtros; o upsert vai direto ao `single()`. */
  private escrevendo = false;

  insert(row: unknown) {
    this.escrevendo = true;
    dealInsert(row);
    return this;
  }
  /** Story 2.51 rodada 3: o insert virou upsert com id determinístico. */
  upsert(row: unknown, opts?: unknown) {
    this.escrevendo = true;
    dealInsert(row, opts);
    return this;
  }
  select() {
    if (!this.escrevendo) filtrosVerificacao = [];
    return this;
  }
  eq(coluna: string, valor: unknown) {
    if (!this.escrevendo) filtrosVerificacao.push(['eq', coluna, valor]);
    return this;
  }
  gte(coluna: string, valor: unknown) {
    if (!this.escrevendo) filtrosVerificacao.push(['gte', coluna, valor]);
    return this;
  }
  limit() {
    return this;
  }
  single() {
    return dealSingle();
  }
  then<TR>(onOk: (v: unknown) => TR, onErr?: (e: unknown) => TR) {
    return dealVerificacao().then(onOk, onErr);
  }
}

const contactBuilder = {
  select: () => contactBuilder,
  eq: () => contactBuilder,
  is: () => contactBuilder,
  or: () => contactBuilder,
  maybeSingle: async () => ({ data: null, error: null }),
  update: () => contactBuilder,
  insert: () => contactBuilder,
  single: async () => ({ data: { id: CONTACT_ID }, error: null }),
};

/** Tabela de idempotência de verdade, em memória — o unique index é o que importa. */
type LinhaIdem = {
  organization_id: string;
  endpoint: string;
  idempotency_key: string;
  request_hash: string;
  response_status: number;
  response_body: unknown;
  created_at?: string;
};
const linhasIdem: LinhaIdem[] = [];

class FakeIdemBuilder {
  private op: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private payload: Record<string, unknown> | null = null;
  private filtros: Record<string, unknown> = {};
  /** `created_at < X` — o take-over da reserva abandonada depende dele. */
  private menorQue: Array<[string, unknown]> = [];

  insert(row: Record<string, unknown>) {
    this.op = 'insert';
    this.payload = row;
    return this;
  }
  update(row: Record<string, unknown>) {
    this.op = 'update';
    this.payload = row;
    return this;
  }
  delete() {
    this.op = 'delete';
    return this;
  }
  select() {
    return this;
  }
  eq(coluna: string, valor: unknown) {
    this.filtros[coluna] = valor;
    return this;
  }
  lt(coluna: string, valor: unknown) {
    this.menorQue.push([coluna, valor]);
    return this;
  }
  maybeSingle() {
    return this.executar();
  }
  then<TR>(onOk: (v: unknown) => TR, onErr?: (e: unknown) => TR) {
    return this.executar().then(onOk, onErr);
  }

  private casa(linha: LinhaIdem) {
    const porIgualdade = Object.entries(this.filtros).every(
      ([k, v]) => (linha as Record<string, unknown>)[k] === v
    );
    const porMenorQue = this.menorQue.every(
      ([k, v]) => String((linha as Record<string, unknown>)[k] ?? '') < String(v)
    );
    return porIgualdade && porMenorQue;
  }

  private async executar(): Promise<{ data: unknown; error: unknown }> {
    if (this.op === 'insert') {
      const novo = this.payload as unknown as LinhaIdem;
      const existe = linhasIdem.some(
        (l) =>
          l.organization_id === novo.organization_id &&
          l.endpoint === novo.endpoint &&
          l.idempotency_key === novo.idempotency_key
      );
      if (existe) {
        return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
      }
      linhasIdem.push({ ...novo });
      return { data: null, error: null };
    }
    if (this.op === 'update') {
      // Devolve as linhas REALMENTE afetadas: é a contagem que o take-over usa
      // para saber se ganhou ou perdeu a corrida.
      const afetadas = linhasIdem.filter((l) => this.casa(l));
      afetadas.forEach((l) => Object.assign(l, this.payload));
      return { data: afetadas.map(() => ({ id: 'x' })), error: null };
    }
    if (this.op === 'delete') {
      for (let i = linhasIdem.length - 1; i >= 0; i -= 1) {
        if (this.casa(linhasIdem[i])) linhasIdem.splice(i, 1);
      }
      return { data: null, error: null };
    }
    return { data: linhasIdem.find((l) => this.casa(l)) ?? null, error: null };
  }
}

const supabaseMock = {
  from: (table: string) => {
    if (table === 'deals') return new DealsBuilder();
    if (table === 'contacts') return contactBuilder;
    if (table === 'public_api_idempotency') return new FakeIdemBuilder();
    throw new Error(`Tabela inesperada: ${table}`);
  },
};

vi.mock('@/lib/supabase/server', () => ({
  createStaticAdminClient: vi.fn(() => supabaseMock),
}));

// ---------------------------------------------------------------------------
import { DEALS_CREATE_ENDPOINT, POST } from '@/app/api/public/v1/deals/route';
import { authPublicApi } from '@/lib/public-api/auth';
import { hashRequestBody } from '@/lib/public-api/idempotency';

/** Passageiro INEQUÍVOCO: o statement foi cancelado, nada commitou. */
const ERRO_TRANSITORIO = { code: '57014', message: 'canceling statement due to statement timeout', details: null, hint: null };
/** Passageiro AMBÍGUO: a conexão caiu; pode ter commitado do outro lado. */
const ERRO_AMBIGUO = { code: '08006', message: 'connection failure', details: null, hint: null };
const ERRO_FK = {
  code: '23503',
  message: 'insert or update on table "deals" violates foreign key constraint "deals_board_id_fkey"',
  details: `Key (board_id)=(${BOARD_ID}) is not present in table "boards".`,
  hint: null,
};
/** Definitivo no resolve: o board realmente não existe / acesso negado. */
const ERRO_DEFINITIVO = { code: '42P01', message: 'relation does not exist', details: null, hint: null };

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request('http://localhost/api/public/v1/deals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
  );
}

const PAYLOAD_BASE = { title: 'Lead da LP', board_id: BOARD_ID, stage_id: STAGE_ID, contact_id: CONTACT_ID };
const CHAVE = { 'Idempotency-Key': 'lead-maria-2026-09-18' };
/** O mesmo hash que a rota calcula para `PAYLOAD_BASE`. */
const HASH_BASE = hashRequestBody(PAYLOAD_BASE);

let erros: string[] = [];
let avisos: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authPublicApi).mockResolvedValue(AUTH_OK);
  dealSingle.mockResolvedValue({ data: DEAL_ROW, error: null });
  dealVerificacao.mockResolvedValue({ data: [], error: null });
  linhasIdem.length = 0;
  filtrosVerificacao = [];
  erros = [];
  avisos = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    erros.push(args.map(String).join(' '));
  });
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    avisos.push(args.map(String).join(' '));
  });
});

const linhasJson = (linhas: string[]) => linhas.map((l) => JSON.parse(l));

describe('AC8.1 — erro passageiro uma vez: retenta e o lead entra', () => {
  it('devolve 201 e registra 1 retentativa', async () => {
    dealSingle
      .mockResolvedValueOnce({ data: null, error: ERRO_TRANSITORIO })
      .mockResolvedValueOnce({ data: DEAL_ROW, error: null });

    const res = await post(PAYLOAD_BASE);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.action).toBe('created');
    expect(dealSingle).toHaveBeenCalledTimes(2);
    // 57014 é inequívoco: não gasta uma leitura de volta.
    expect(dealVerificacao).not.toHaveBeenCalled();

    const retentativas = linhasJson(avisos).filter((l) => l.evento === 'public_api_db_retry');
    expect(retentativas).toHaveLength(1);
    expect(retentativas[0]).toMatchObject({ etapa: 'insert_deal', tentativa: 1, code: '57014' });
  });
});

describe('AC8.2 — erro passageiro nas 3 tentativas', () => {
  it('devolve 500 com request_id e loga tentativa 3', async () => {
    dealSingle.mockResolvedValue({ data: null, error: ERRO_TRANSITORIO });

    const res = await post(PAYLOAD_BASE);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.code).toBe('DB_ERROR');
    expect(body.request_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(dealSingle).toHaveBeenCalledTimes(3);

    const final = linhasJson(erros).find((l) => l.evento === 'public_api_db_error');
    expect(final).toMatchObject({
      etapa: 'insert_deal',
      tentativa: 3,
      code: '57014',
      request_id: body.request_id,
      classe: 'transitorio',
    });
  });
});

describe('AC8.3 — erro definitivo não é retentado', () => {
  it('23503 vira 422 INVALID_REFERENCE em UMA tentativa', async () => {
    dealSingle.mockResolvedValue({ data: null, error: ERRO_FK });

    const res = await post(PAYLOAD_BASE);
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.code).toBe('INVALID_REFERENCE');
    expect(body.field).toBe('board_id');
    expect(body.request_id).toBeTruthy();
    expect(dealSingle).toHaveBeenCalledTimes(1);
    expect(avisos).toHaveLength(0); // zero retentativa
    expect(dealVerificacao).not.toHaveBeenCalled();
  });
});

/**
 * ACHADO 1+2 do QA — o remédio da duplicação.
 *
 * "A API respondeu erro" não é prova de que nada foi escrito, do mesmo jeito que
 * "a API respondeu OK" não é prova de que foi. O estado real é LIDO DE VOLTA.
 */
describe('QA-1 — INSERT commitou e a resposta se perdeu', () => {
  it('a verificação acha o negócio ⇒ 201, UM insert, ZERO retentativa', async () => {
    dealSingle.mockResolvedValue({ data: null, error: ERRO_AMBIGUO });
    dealVerificacao.mockResolvedValue({ data: [DEAL_ROW], error: null });

    const res = await post(PAYLOAD_BASE);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.id).toBe(DEAL_ID);
    expect(body.escrita_confirmada_por_leitura).toBe(true);
    expect(dealSingle).toHaveBeenCalledTimes(1); // NÃO repetiu o INSERT
    expect(dealVerificacao).toHaveBeenCalledTimes(1);

    const confirmacao = linhasJson(avisos).find((l) => l.evento === 'public_api_db_escrita_confirmada');
    expect(confirmacao).toMatchObject({ escrita_confirmada_por_leitura: true, deal_id: DEAL_ID });
    expect(linhasJson(avisos).some((l) => l.evento === 'public_api_db_retry')).toBe(false);
  });
});

describe('QA-2 — INSERT falhou de verdade', () => {
  it('verificação volta vazia ⇒ retenta e cria UM negócio', async () => {
    dealSingle
      .mockResolvedValueOnce({ data: null, error: ERRO_AMBIGUO })
      .mockResolvedValueOnce({ data: DEAL_ROW, error: null });
    dealVerificacao.mockResolvedValue({ data: [], error: null });

    const res = await post(PAYLOAD_BASE);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.escrita_confirmada_por_leitura).toBeUndefined();
    expect(dealSingle).toHaveBeenCalledTimes(2);
    expect(dealVerificacao).toHaveBeenCalledTimes(1);
    expect(dealInsert).toHaveBeenCalledTimes(2); // 2 tentativas, 1 negócio criado
  });
});

describe('QA-3 — 3 falhas ambíguas com verificação vazia', () => {
  it('devolve 500 e LIBERA a chave (está provado que nada foi escrito)', async () => {
    dealSingle.mockResolvedValue({ data: null, error: ERRO_AMBIGUO });
    dealVerificacao.mockResolvedValue({ data: [], error: null });

    const res = await post(PAYLOAD_BASE, CHAVE);

    expect(res.status).toBe(500);
    expect(dealSingle).toHaveBeenCalledTimes(3);
    expect(dealVerificacao).toHaveBeenCalledTimes(3);
    expect(linhasIdem).toHaveLength(0); // chave liberada

    // E o reenvio consegue criar o lead.
    dealSingle.mockResolvedValue({ data: DEAL_ROW, error: null });
    expect((await post(PAYLOAD_BASE, CHAVE)).status).toBe(201);
  });
});

describe('QA-4 — 3 falhas ambíguas e a verificação também falha', () => {
  it('devolve 500 e MANTÉM a chave — duplicar é pior que atrasar', async () => {
    dealSingle.mockResolvedValue({ data: null, error: ERRO_AMBIGUO });
    dealVerificacao
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: null, error: { code: '08006', message: 'connection failure' } });

    const res = await post(PAYLOAD_BASE, CHAVE);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.code).toBe('DB_ERROR');
    expect(dealSingle).toHaveBeenCalledTimes(3);
    expect(linhasIdem).toHaveLength(1); // chave MANTIDA
    expect(linhasIdem[0].response_status).toBe(0);

    const final = linhasJson(erros).find(
      (l) => l.evento === 'public_api_db_error' && l.etapa === 'insert_deal'
    );
    expect(final.escrita_indeterminada).toBe(true);

    // O reenvio NÃO cria um segundo negócio: cai em IDEMPOTENCY_IN_PROGRESS.
    dealSingle.mockResolvedValue({ data: DEAL_ROW, error: null });
    const reenvio = await post(PAYLOAD_BASE, CHAVE);
    expect(reenvio.status).toBe(409);
    expect((await reenvio.json()).code).toBe('IDEMPOTENCY_IN_PROGRESS');
  });
});

/**
 * ACHADO 4 da rodada 3 — a verificação precisa PROVAR o filtro.
 *
 * QA-1 e QA-2 mostram que a leitura de volta é chamada; não mostram que ela
 * procura o negócio CERTO. Um filtro a menos aqui devolveria o negócio de outra
 * pessoa (ou de ontem) como se fosse desta requisição — e o 201 sairia com o id
 * errado, que é o pior desfecho possível: silencioso e convincente.
 */
describe('QA-1b — a leitura de volta filtra pelos 5 campos', () => {
  it('org + board + title + contact + created_at, com os valores desta requisição', async () => {
    dealSingle.mockResolvedValue({ data: null, error: ERRO_AMBIGUO });
    dealVerificacao.mockResolvedValue({ data: [DEAL_ROW], error: null });

    const antes = new Date().toISOString();
    await post(PAYLOAD_BASE);

    expect(filtrosVerificacao).toEqual([
      ['eq', 'organization_id', ORG_ID],
      ['eq', 'board_id', BOARD_ID],
      ['eq', 'title', PAYLOAD_BASE.title],
      ['eq', 'contact_id', CONTACT_ID],
      ['gte', 'created_at', expect.any(String)],
    ]);

    // O marco temporal é o desta requisição, não uma constante qualquer.
    const marco = filtrosVerificacao.find(([, coluna]) => coluna === 'created_at')![2] as string;
    expect(marco >= antes).toBe(true);
    expect(marco <= new Date().toISOString()).toBe(true);
  });
});

/**
 * ACHADO 2 da rodada 3 — a duplicidade morre por construção.
 *
 * Antes, "não duplicou" dependia de a leitura de volta acertar. Com o id gerado
 * uma vez e `upsert(onConflict: 'id')`, as três tentativas escrevem a MESMA
 * linha: mesmo que a verificação erre, o banco não tem como criar um irmão.
 */
describe('QA-7 — todas as tentativas escrevem a mesma linha', () => {
  it('o id do negócio é gerado uma vez e repetido em todo retry', async () => {
    dealSingle
      .mockResolvedValueOnce({ data: null, error: ERRO_AMBIGUO })
      .mockResolvedValueOnce({ data: null, error: ERRO_TRANSITORIO })
      .mockResolvedValueOnce({ data: DEAL_ROW, error: null });
    dealVerificacao.mockResolvedValue({ data: [], error: null });

    const res = await post(PAYLOAD_BASE);

    expect(res.status).toBe(201);
    expect(dealInsert).toHaveBeenCalledTimes(3);

    const ids = dealInsert.mock.calls.map(([row]) => (row as { id: string }).id);
    expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Set(ids).size).toBe(1); // um id só nas 3 tentativas

    // E o conflito é resolvido pela PK — nunca por um segundo INSERT.
    for (const [, opts] of dealInsert.mock.calls) {
      expect(opts).toEqual({ onConflict: 'id' });
    }
  });

  it('requisições diferentes recebem ids diferentes', async () => {
    await post(PAYLOAD_BASE);
    await post({ ...PAYLOAD_BASE, title: 'Outro lead' });

    const ids = dealInsert.mock.calls.map(([row]) => (row as { id: string }).id);
    expect(new Set(ids).size).toBe(2);
  });
});

/**
 * ACHADO 1 da rodada 3 — a chave presa deixa de prender o lead o dia inteiro.
 *
 * A chave da LP é `email + whatsapp + dia`: uma reserva que nunca foi finalizada
 * condenava TODO reenvio daquele visitante até a virada do dia.
 */
describe('QA-8 — reserva de idempotência abandonada', () => {
  const reservaPresa = (created_at: string, request_hash = HASH_BASE) => {
    linhasIdem.push({
      organization_id: ORG_ID,
      endpoint: DEALS_CREATE_ENDPOINT,
      idempotency_key: CHAVE['Idempotency-Key'],
      request_hash,
      response_status: 0,
      response_body: {},
      created_at,
    });
  };

  it('com menos de 15 min continua IDEMPOTENCY_IN_PROGRESS', async () => {
    reservaPresa(new Date(Date.now() - 5 * 60_000).toISOString());

    const res = await post(PAYLOAD_BASE, CHAVE);

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('IDEMPOTENCY_IN_PROGRESS');
    expect(dealInsert).not.toHaveBeenCalled();
  });

  it('com mais de 15 min a reserva é assumida e o lead entra', async () => {
    // Hash diferente de propósito: reserva abandonada é assumida mesmo quando a
    // tentativa que morreu carregava outro corpo — senão o 409 CONFLICT prenderia
    // o lead pelo mesmo motivo que o IN_PROGRESS prendia.
    reservaPresa(new Date(Date.now() - 20 * 60_000).toISOString(), 'hash-da-tentativa-que-morreu');

    const res = await post(PAYLOAD_BASE, CHAVE);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.id).toBe(DEAL_ID);
    expect(dealInsert).toHaveBeenCalledTimes(1);

    // A reserva foi assumida por ESTA requisição, não duplicada.
    expect(linhasIdem).toHaveLength(1);
    expect(linhasIdem[0].response_status).toBe(201);
    expect(linhasIdem[0].request_hash).not.toBe('hash-da-tentativa-que-morreu');

    const assumida = linhasJson(avisos).find(
      (l) => l.evento === 'public_api_idempotency_reserva_assumida'
    );
    expect(assumida).toMatchObject({ reserva_expirada_assumida: true, etapa: 'idempotency' });
  });

  it('quem perde a corrida do take-over não escreve', async () => {
    reservaPresa(new Date(Date.now() - 20 * 60_000).toISOString());
    // Simula o concorrente que assumiu primeiro: a reserva já está fresca.
    linhasIdem[0].created_at = new Date().toISOString();

    const res = await post(PAYLOAD_BASE, CHAVE);

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('IDEMPOTENCY_IN_PROGRESS');
    expect(dealInsert).not.toHaveBeenCalled();
  });
});

describe('AC4 / QA-6 — resolve que falha por erro PASSAGEIRO', () => {
  it('board_key com erro transitório persistente vira 503 e libera a chave', async () => {
    const { resolveBoardIdFromKey } = await import('@/lib/public-api/resolve');
    vi.mocked(resolveBoardIdFromKey).mockRejectedValue(ERRO_TRANSITORIO);

    const res = await post({ title: 'Lead', board_key: 'vendas', contact_id: CONTACT_ID }, CHAVE);
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.code).toBe('DB_UNAVAILABLE');
    expect(body.request_id).toBeTruthy();
    expect(resolveBoardIdFromKey).toHaveBeenCalledTimes(3); // retentou
    expect(dealInsert).not.toHaveBeenCalled(); // nada foi escrito
    expect(linhasIdem).toHaveLength(0); // chave liberada — o reenvio tem chance
  });

  it('stage com erro transitório persistente vira 503', async () => {
    const { resolveFirstStageId } = await import('@/lib/public-api/resolve');
    vi.mocked(resolveFirstStageId).mockRejectedValue(ERRO_TRANSITORIO);

    const res = await post({ title: 'Lead', board_id: BOARD_ID, contact_id: CONTACT_ID });
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.code).toBe('DB_UNAVAILABLE');
    expect(linhasJson(erros)[0]).toMatchObject({ etapa: 'resolve_stage', classe: 'transitorio' });
  });

  it('erro DEFINITIVO no resolve continua 422 INVALID_BOARD, sem retentativa', async () => {
    const { resolveBoardIdFromKey } = await import('@/lib/public-api/resolve');
    vi.mocked(resolveBoardIdFromKey).mockRejectedValue(ERRO_DEFINITIVO);

    const res = await post({ title: 'Lead', board_key: 'vendas', contact_id: CONTACT_ID });
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.code).toBe('INVALID_BOARD');
    expect(resolveBoardIdFromKey).toHaveBeenCalledTimes(1);
  });
});

describe('AC8.4 — mesma Idempotency-Key duas vezes', () => {
  it('cria UM negócio e devolve a mesma resposta', async () => {
    const primeira = await post(PAYLOAD_BASE, CHAVE);
    const corpo1 = await primeira.json();
    const segunda = await post(PAYLOAD_BASE, CHAVE);
    const corpo2 = await segunda.json();

    expect(primeira.status).toBe(201);
    expect(segunda.status).toBe(201);
    expect(dealSingle).toHaveBeenCalledTimes(1); // UM insert
    expect(corpo2.idempotent_replay).toBe(true);
    expect(corpo2.data.id).toBe(corpo1.data.id);
  });

  it('mesma chave com corpo diferente devolve 409', async () => {
    await post(PAYLOAD_BASE, CHAVE);

    const res = await post({ ...PAYLOAD_BASE, title: 'Outro lead' }, CHAVE);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('falha 5xx provadamente sem escrita libera a chave — o retry seguinte cria o lead', async () => {
    dealSingle.mockResolvedValue({ data: null, error: ERRO_TRANSITORIO });

    const falhou = await post(PAYLOAD_BASE, CHAVE);
    expect(falhou.status).toBe(500);
    expect(linhasIdem).toHaveLength(0);

    dealSingle.mockResolvedValue({ data: DEAL_ROW, error: null });
    const res = await post(PAYLOAD_BASE, CHAVE);
    expect(res.status).toBe(201);
  });

  it('sem o header, o comportamento é o de antes (nada gravado na tabela)', async () => {
    const res = await post(PAYLOAD_BASE);
    expect(res.status).toBe(201);
    expect(linhasIdem).toHaveLength(0);
  });
});

describe('AC8.5 / QA-5 — 🔒 o log não carrega dado do lead', () => {
  it('nome, e-mail e telefone não aparecem em nenhuma linha de log', async () => {
    dealSingle.mockResolvedValue({
      data: null,
      error: {
        code: '23505',
        message: 'duplicate key value violates unique constraint "deals_contact_id_key"',
        details: `Key (email)=(${LEAD.email}) already exists. Failing row contains (${DEAL_ID}, ${LEAD.name}, ${LEAD.phone}).`,
        hint: `Try again with ${LEAD.phone}`,
      },
    });

    const res = await post({ title: 'Lead da LP', board_id: BOARD_ID, stage_id: STAGE_ID, contact: LEAD });
    const body = await res.json();

    expect(res.status).toBe(409);

    const tudoQueFoiLogado = [...erros, ...avisos].join('\n');
    expect(tudoQueFoiLogado).not.toContain(LEAD.name);
    expect(tudoQueFoiLogado).not.toContain(LEAD.email);
    expect(tudoQueFoiLogado).not.toContain(LEAD.phone);
    // ...mas o que interessa para depurar continua lá:
    const final = linhasJson(erros).find((l) => l.evento === 'public_api_db_error');
    expect(final.colunas).toEqual(['email']);
    expect(final.constraint).toBe('deals_contact_id_key');
    expect(final.details_tinha_valor).toBe(true);
    expect(final.code).toBe('23505');
    expect(final.request_id).toBe(body.request_id);
  });

  it.each([
    ['Failing row com parênteses aninhados', `Failing row contains (${DEAL_ID}, Lead da LP (Instagram), ${LEAD.name}, ${LEAD.email}, ${LEAD.phone})`],
    ['duplicate key com valor solto', `duplicate key (${LEAD.name}) something`],
    ['valor entre aspas', `invalid input syntax for type uuid: "${LEAD.name}"`],
  ])('os 3 formatos que quebraram a redação antiga: %s', async (_titulo, message) => {
    dealSingle.mockResolvedValue({ data: null, error: { code: '23505', message } });

    await post(PAYLOAD_BASE);

    const tudoQueFoiLogado = [...erros, ...avisos].join('\n');
    expect(tudoQueFoiLogado).not.toContain(LEAD.name);
    expect(tudoQueFoiLogado).not.toContain(LEAD.email);
    expect(tudoQueFoiLogado).not.toContain(LEAD.phone);
    expect(tudoQueFoiLogado).not.toContain('Instagram');
  });

  it('AC6 — o contato que ficou sem negócio aparece no log como contato_orfao', async () => {
    dealSingle.mockResolvedValue({ data: null, error: ERRO_FK });

    await post({ title: 'Lead da LP', board_id: BOARD_ID, stage_id: STAGE_ID, contact: LEAD });

    const final = linhasJson(erros).find((l) => l.evento === 'public_api_db_error');
    expect(final.contato_orfao).toBe(CONTACT_ID);
  });
});
