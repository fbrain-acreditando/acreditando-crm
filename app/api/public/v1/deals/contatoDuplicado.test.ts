/**
 * Story 2.56 — AC7, teste 10: `POST /api/public/v1/deals` com DOIS contatos de
 * mesmo telefone **não estoura**.
 *
 * ## Por que este teste existe
 *
 * A busca do contato (`app/api/public/v1/deals/route.ts`, `upsertContactForDeal`)
 * terminava em `.maybeSingle()`. `.maybeSingle()` aceita 0 ou 1 linha e
 * **estoura PGRST116 com 2** — e dois contatos com o mesmo telefone são estado
 * POSSÍVEL neste CRM: a feature de dedup + merge existe exatamente porque
 * duplicata acontece (story 2.6 mediu 138 pares num dia).
 *
 * Efeito: a rota pública devolvia erro num cenário legítimo, e o lead da landing
 * page se perdia. A story 2.56 aumenta a chance de dois contatos com o mesmo
 * telefone conviverem (é o que o mapa de alias faz reusar), então este caminho
 * virou teste obrigatório.
 *
 * ## O mock imita o PostgREST DE VERDADE
 *
 * Se `maybeSingle()` aqui devolvesse a primeira linha em vez de estourar, o
 * teste passaria mesmo com o defeito vivo. Por isso o falso reproduz a regra
 * real: **2+ linhas sem `limit(1)` ⇒ erro PGRST116**.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5';
const BOARD_ID = 'b2c3d4e5-f6a7-4b8c-9d0e-f1a2b3c4d5e6';
const STAGE_ID = 'c3d4e5f6-a7b8-4c9d-8e0f-a1b2c3d4e5f6';
const DEAL_ID = 'e5f6a7b8-c9d0-4e1f-8a2b-c3d4e5f6a7b8';

const TELEFONE = '11987654321';

/** Dois contatos, mesmo telefone. O mais ANTIGO é o critério de desempate. */
const CONTATO_ANTIGO = { id: '11111111-1111-4111-8111-111111111111', created_at: '2026-01-01T00:00:00Z', merged_into_id: null, deleted_at: null, phone: `+55${TELEFONE}`, email: null };
const CONTATO_NOVO = { id: '22222222-2222-4222-8222-222222222222', created_at: '2026-09-01T00:00:00Z', merged_into_id: null, deleted_at: null, phone: `+55${TELEFONE}`, email: null };

let contatos: Array<Record<string, unknown>> = [];
/** O contato escolhido pela rota — é o que o teste 10 precisa inspecionar. */
let contatoEscolhido: string | null = null;

vi.mock('@/lib/public-api/auth', () => ({ authPublicApi: vi.fn() }));
vi.mock('@/lib/public-api/resolve', () => ({
  resolveBoardIdFromKey: vi.fn(async () => BOARD_ID),
  resolveFirstStageId: vi.fn(async () => STAGE_ID),
}));

/** Builder de `contacts` com a semântica real de `maybeSingle()`. */
class ContactsBuilder {
  private op: 'select' | 'insert' | 'update' = 'select';
  private payload: Record<string, unknown> | null = null;
  private eqs: Array<[string, unknown]> = [];
  private isNulls: string[] = [];
  private orExpr: string | null = null;
  private lim: number | null = null;
  private asc = true;

  select() {
    return this;
  }
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
  eq(col: string, val: unknown) {
    this.eqs.push([col, val]);
    return this;
  }
  is(col: string, _val: null) {
    this.isNulls.push(col);
    return this;
  }
  or(expr: string) {
    this.orExpr = expr;
    return this;
  }
  order(_col: string, opts?: { ascending?: boolean }) {
    this.asc = opts?.ascending !== false;
    return this;
  }
  limit(n: number) {
    this.lim = n;
    return this;
  }

  private filtrar() {
    let linhas = contatos.filter((l) =>
      this.eqs.every(([c, v]) => l[c] === v) && this.isNulls.every((c) => l[c] === null)
    );
    if (this.orExpr) {
      const alvos = this.orExpr.split(',').map((p) => {
        const [col, , val] = p.split('.');
        return [col, val] as const;
      });
      linhas = linhas.filter((l) => alvos.some(([c, v]) => l[c] === v || `+55${v}` === l[c]));
    }
    linhas = linhas.sort((a, b) =>
      this.asc
        ? String(a.created_at).localeCompare(String(b.created_at))
        : String(b.created_at).localeCompare(String(a.created_at))
    );
    return this.lim === null ? linhas : linhas.slice(0, this.lim);
  }

  async maybeSingle() {
    const linhas = this.filtrar();
    // 🔴 A regra REAL do PostgREST. Sem ela o teste não provaria nada.
    if (linhas.length > 1) {
      return {
        data: null,
        error: {
          code: 'PGRST116',
          message: 'JSON object requested, multiple (or no) rows returned',
          details: `Results contain ${linhas.length} rows`,
        },
      };
    }
    return { data: linhas[0] ?? null, error: null };
  }

  async single() {
    if (this.op === 'insert') {
      const novo = { id: '33333333-3333-4333-8333-333333333333', ...this.payload };
      contatos.push(novo);
      contatoEscolhido = novo.id as string;
      return { data: { id: novo.id }, error: null };
    }
    if (this.op === 'update') {
      const alvo = this.eqs.find(([c]) => c === 'id')?.[1] as string;
      contatoEscolhido = alvo;
      return { data: { id: alvo }, error: null };
    }
    const linhas = this.filtrar();
    return { data: linhas[0] ?? null, error: null };
  }
}

class DealsBuilder {
  upsert() {
    return this;
  }
  insert() {
    return this;
  }
  select() {
    return this;
  }
  eq() {
    return this;
  }
  gte() {
    return this;
  }
  order() {
    return this;
  }
  limit() {
    return this;
  }
  async single() {
    return {
      data: {
        id: DEAL_ID,
        title: 'Lead da LP',
        value: 0,
        board_id: BOARD_ID,
        stage_id: STAGE_ID,
        contact_id: contatoEscolhido,
        client_company_id: null,
        is_won: false,
        is_lost: false,
        loss_reason: null,
        closed_at: null,
        created_at: '2026-09-25T00:00:00Z',
        updated_at: '2026-09-25T00:00:00Z',
      },
      error: null,
    };
  }
  then<TR>(onOk: (v: unknown) => TR) {
    return Promise.resolve({ data: [], error: null }).then(onOk);
  }
}

const idem: Array<Record<string, unknown>> = [];
class IdemBuilder {
  private op: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private payload: Record<string, unknown> | null = null;
  private filtros: Record<string, unknown> = {};
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
  eq(col: string, val: unknown) {
    this.filtros[col] = val;
    return this;
  }
  lt() {
    return this;
  }
  maybeSingle() {
    return this.executar();
  }
  then<TR>(onOk: (v: unknown) => TR) {
    return this.executar().then(onOk);
  }
  private casa(l: Record<string, unknown>) {
    return Object.entries(this.filtros).every(([k, v]) => l[k] === v);
  }
  private async executar() {
    if (this.op === 'insert') {
      idem.push({ ...(this.payload as Record<string, unknown>) });
      return { data: null, error: null };
    }
    if (this.op === 'update') {
      const alvo = idem.filter((l) => this.casa(l));
      alvo.forEach((l) => Object.assign(l, this.payload));
      return { data: alvo.map(() => ({ id: 'x' })), error: null };
    }
    if (this.op === 'delete') {
      for (let i = idem.length - 1; i >= 0; i -= 1) if (this.casa(idem[i])) idem.splice(i, 1);
      return { data: null, error: null };
    }
    return { data: idem.find((l) => this.casa(l)) ?? null, error: null };
  }
}

vi.mock('@/lib/supabase/server', () => ({
  createStaticAdminClient: vi.fn(() => ({
    from: (table: string) => {
      if (table === 'contacts') return new ContactsBuilder();
      if (table === 'deals') return new DealsBuilder();
      if (table === 'public_api_idempotency') return new IdemBuilder();
      throw new Error(`Tabela inesperada: ${table}`);
    },
  })),
}));

// ---------------------------------------------------------------------------
import { POST } from '@/app/api/public/v1/deals/route';
import { authPublicApi } from '@/lib/public-api/auth';

function post(body: unknown) {
  return POST(
    new Request('http://localhost/api/public/v1/deals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authPublicApi).mockResolvedValue({
    ok: true,
    organizationId: ORG_ID,
    organizationName: 'Org Test',
    apiKeyId: 'key-id-1',
    apiKeyPrefix: 'test_',
  } as never);
  contatos = [];
  contatoEscolhido = null;
  idem.length = 0;
});

const PAYLOAD = {
  title: 'Lead da LP',
  board_id: BOARD_ID,
  stage_id: STAGE_ID,
  contact: { name: 'Maria Aparecida Silva', phone: TELEFONE },
};

describe('AC7 teste 10 — dois contatos com o mesmo telefone', () => {
  it('NÃO estoura: devolve 201 e escolhe o contato mais antigo', async () => {
    contatos = [
      { ...CONTATO_NOVO, organization_id: ORG_ID },
      { ...CONTATO_ANTIGO, organization_id: ORG_ID },
    ];

    const res = await post(PAYLOAD);

    expect(res.status).toBe(201);
    expect(contatoEscolhido).toBe(CONTATO_ANTIGO.id);
  });

  it('o mock reproduz o defeito: sem limit(1), 2 linhas dariam PGRST116', async () => {
    // Controle do controle — se este teste passar a falhar, o falso deixou de
    // imitar o PostgREST e o teste acima vira decoração.
    contatos = [
      { ...CONTATO_NOVO, organization_id: ORG_ID },
      { ...CONTATO_ANTIGO, organization_id: ORG_ID },
    ];
    const b = new ContactsBuilder();
    const r = await b
      .select()
      .eq('organization_id', ORG_ID)
      .is('deleted_at', null)
      .eq('phone', `+55${TELEFONE}`)
      .maybeSingle();

    expect(r.error?.code).toBe('PGRST116');
  });

  it('contato já MESCLADO não é escolhido (AC7 teste 9, mesma trava)', async () => {
    contatos = [
      {
        ...CONTATO_ANTIGO,
        organization_id: ORG_ID,
        merged_into_id: CONTATO_NOVO.id,
      },
      { ...CONTATO_NOVO, organization_id: ORG_ID },
    ];

    const res = await post(PAYLOAD);

    expect(res.status).toBe(201);
    expect(contatoEscolhido).toBe(CONTATO_NOVO.id);
  });

  it('um contato só continua funcionando como antes', async () => {
    contatos = [{ ...CONTATO_ANTIGO, organization_id: ORG_ID }];

    const res = await post(PAYLOAD);

    expect(res.status).toBe(201);
    expect(contatoEscolhido).toBe(CONTATO_ANTIGO.id);
  });

  it('nenhum contato ⇒ cria um novo, como antes', async () => {
    contatos = [];

    const res = await post(PAYLOAD);

    expect(res.status).toBe(201);
    expect(contatoEscolhido).toBe('33333333-3333-4333-8333-333333333333');
  });
});

describe('MEDIA-5 — e-mail vence telefone, e nao em silencio', () => {
  const PAYLOAD_EMAIL_E_FONE = {
    title: 'Lead da LP',
    board_id: BOARD_ID,
    stage_id: STAGE_ID,
    contact: { name: 'Maria Aparecida Silva', email: 'maria@exemplo.com', phone: TELEFONE },
  };

  it('contato que casa por E-MAIL vence o mais velho que casa por telefone', async () => {
    contatos = [
      // Mais velho, casa so por telefone — antes ganhava so por ser antigo.
      { ...CONTATO_ANTIGO, organization_id: ORG_ID, email: null },
      // Mais novo, casa por e-mail — e-mail e a chave mais forte.
      { ...CONTATO_NOVO, organization_id: ORG_ID, email: 'maria@exemplo.com', phone: null },
    ];

    const res = await post(PAYLOAD_EMAIL_E_FONE);

    expect(res.status).toBe(201);
    expect(contatoEscolhido).toBe(CONTATO_NOVO.id);
  });

  it('sem ninguem por e-mail, cai para o telefone', async () => {
    contatos = [{ ...CONTATO_ANTIGO, organization_id: ORG_ID, email: null }];

    const res = await post(PAYLOAD_EMAIL_E_FONE);

    expect(res.status).toBe(201);
    expect(contatoEscolhido).toBe(CONTATO_ANTIGO.id);
  });

  it('dois contatos com o MESMO e-mail tambem nao estouram', async () => {
    contatos = [
      { ...CONTATO_NOVO, organization_id: ORG_ID, email: 'maria@exemplo.com', phone: null },
      { ...CONTATO_ANTIGO, organization_id: ORG_ID, email: 'maria@exemplo.com', phone: null },
    ];

    const res = await post(PAYLOAD_EMAIL_E_FONE);

    expect(res.status).toBe(201);
    expect(contatoEscolhido).toBe(CONTATO_ANTIGO.id);
  });
});
