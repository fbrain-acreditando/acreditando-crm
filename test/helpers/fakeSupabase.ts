/**
 * Supabase em memória para testes de comportamento — story 2.59.
 *
 * Não é um mock que devolve o que o teste quer ouvir: guarda linhas de verdade
 * e aplica as TRAVAS que decidem o comportamento em produção, para que o teste
 * possa RELER o estado e afirmar o valor (AC geral da 2.59, Rule 7):
 *
 *   • PK de cada tabela (upsert por `id`, `ignoreDuplicates`);
 *   • `deals_meta_leadgen_id_uidx` — um leadgen id por card VIVO por organização (23505);
 *   • trigger `check_deal_duplicate` — mesmo contato + mesmo estágio + card aberto (23505);
 *   • UNIQUE de `public_api_idempotency` (organization_id, endpoint, idempotency_key);
 *   • `find_or_create_contact` (busca por telefone vivo, senão cria).
 *
 * Suporta o subconjunto do query builder que o código da 2.59 e o módulo de
 * idempotência usam. Filtro desconhecido LANÇA — teste que passa por um filtro
 * ignorado não prova nada.
 */

type Linha = Record<string, any>;
type Filtro = (l: Linha) => boolean;

export interface ErroFake {
  code?: string;
  message?: string;
  details?: string;
}

function valorDe(l: Linha, col: string): any {
  const j = col.match(/^([a-z_]+)->([A-Za-z0-9_]+)$/);
  if (j) {
    const obj = l[j[1]];
    return obj && typeof obj === 'object' ? (obj[j[2]] ?? null) : null;
  }
  const m = col.match(/^([a-z_]+)->>([A-Za-z0-9_]+)$/);
  if (m) {
    const obj = l[m[1]];
    const v = obj && typeof obj === 'object' ? obj[m[2]] : undefined;
    return v === undefined || v === null ? null : String(v);
  }
  return l[col];
}

function comparar(a: any, b: any): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  return a < b ? -1 : 1;
}

function parseOr(expr: string): Filtro {
  const partes = expr.split(',').map((p) => {
    const m = p.match(/^([a-zA-Z_]+)\.(is|eq|neq)\.(.*)$/);
    if (!m) throw new Error(`fakeSupabase: or() não suportado: ${p}`);
    const [, col, op, val] = m;
    return (l: Linha) => {
      const v = l[col];
      if (op === 'is') return val === 'null' ? v === null || v === undefined : false;
      if (op === 'eq') return String(v ?? '') === val && v !== null && v !== undefined;
      return v !== null && v !== undefined && String(v) !== val;
    };
  });
  return (l) => partes.some((f) => f(l));
}

export class FakeSupabase {
  tabelas: Record<string, Linha[]> = {
    contacts: [],
    deals: [],
    activities: [],
    board_stages: [],
    public_api_idempotency: [],
  };

  /** Erros a injetar: chave `tabela:operacao` (operacao = select|insert|update|upsert|delete|rpc). */
  private erros: Record<string, ErroFake[]> = {};
  /** Chamadas de escrita, para o teste afirmar o que foi (e o que NÃO foi) escrito. */
  escritas: Array<{ tabela: string; op: string; payload: any }> = [];
  rpcChamadas: Array<{ fn: string; args: any }> = [];

  /** Roda `fn` imediatamente ANTES da próxima operação `op` em `tabela` (ex.: edição simultânea). */
  private intercept: Record<string, Array<() => void>> = {};
  antesDaProxima(tabela: string, op: string, fn: () => void) {
    (this.intercept[`${tabela}:${op}`] ??= []).push(fn);
  }
  rodarIntercept(tabela: string, op: string) {
    const fila = this.intercept[`${tabela}:${op}`];
    if (fila && fila.length) fila.shift()!();
  }

  falharProxima(tabela: string, op: string, erro: ErroFake) {
    (this.erros[`${tabela}:${op}`] ??= []).push(erro);
  }

  private tirarErro(tabela: string, op: string): ErroFake | null {
    const fila = this.erros[`${tabela}:${op}`];
    return fila && fila.length ? fila.shift()! : null;
  }

  from(tabela: string) {
    if (!this.tabelas[tabela]) this.tabelas[tabela] = [];
    return new FakeQuery(this, tabela);
  }

  async rpc(fn: string, args: any) {
    this.rpcChamadas.push({ fn, args });
    const erro = this.tirarErro(fn, 'rpc');
    if (erro) return { data: null, error: erro };
    if (fn !== 'find_or_create_contact') throw new Error(`fakeSupabase: rpc ${fn} não suportada`);
    const org = args.p_organization_id;
    const phone = args.p_phone;
    if (phone) {
      // Versão em produção desde a 2.56: ignora deletado E mesclado.
      const achados = this.tabelas.contacts
        .filter((c) => c.organization_id === org && c.phone === phone && !c.deleted_at && !c.merged_into_id)
        .sort((a, b) => comparar(a.created_at, b.created_at));
      if (achados[0]) return { data: achados[0].id, error: null };
    }
    const id = crypto.randomUUID();
    this.tabelas.contacts.push({
      id,
      organization_id: org,
      name: args.p_name,
      phone: phone ?? null,
      source: args.p_source,
      email: null,
      deleted_at: null,
      merged_into_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    this.escritas.push({ tabela: 'contacts', op: 'rpc_insert', payload: { id } });
    return { data: id, error: null };
  }

  /** Travas do banco. Devolve o erro que o Postgres daria, ou null. */
  verificarRestricoes(tabela: string, linha: Linha, opts: { ehInsert: boolean; ignorar?: Linha }): ErroFake | null {
    if (tabela === 'deals') {
      const lg = linha.custom_fields?.metaLeadgenId;
      if (lg !== undefined && lg !== null && !linha.deleted_at) {
        const outro = this.tabelas.deals.find(
          (d) =>
            d.id !== linha.id &&
            d.organization_id === linha.organization_id &&
            !d.deleted_at &&
            d.custom_fields?.metaLeadgenId !== undefined &&
            String(d.custom_fields.metaLeadgenId) === String(lg)
        );
        if (outro) {
          return {
            code: '23505',
            message: 'duplicate key value violates unique constraint "deals_meta_leadgen_id_uidx"',
          };
        }
      }
      // trigger check_deal_duplicate (BEFORE INSERT OR UPDATE)
      if (linha.contact_id && !linha.is_won && !linha.is_lost) {
        const dup = this.tabelas.deals.find(
          (d) =>
            d.contact_id === linha.contact_id &&
            d.stage_id === linha.stage_id &&
            !d.deleted_at &&
            !d.is_won &&
            !d.is_lost &&
            (opts.ehInsert || d.id !== linha.id)
        );
        if (dup) return { code: '23505', message: 'Já existe um negócio para este contato no estágio' };
      }
    }
    if (tabela === 'public_api_idempotency') {
      const dup = this.tabelas.public_api_idempotency.find(
        (r) =>
          r !== linha &&
          r !== opts.ignorar &&
          r.organization_id === linha.organization_id &&
          r.endpoint === linha.endpoint &&
          r.idempotency_key === linha.idempotency_key
      );
      if (dup) return { code: '23505', message: 'duplicate key value violates unique constraint' };
    }
    return null;
  }

  aplicarEscrita(q: FakeQuery): { data: any; error: ErroFake | null } {
    const tabela = q.tabela;
    const linhas = this.tabelas[tabela];
    const op = q.op!;
    this.rodarIntercept(tabela, op);
    const erro = this.tirarErro(tabela, op);
    if (erro) return { data: null, error: erro };

    if (op === 'insert' || op === 'upsert') {
      const entradas = Array.isArray(q.payload) ? q.payload : [q.payload];
      const resultado: Linha[] = [];
      for (const bruto of entradas) {
        const nova: Linha = { ...bruto };
        if (!nova.id) nova.id = crypto.randomUUID();
        const existente = linhas.find((l) => l.id === nova.id);
        if (existente) {
          if (op === 'insert') return { data: null, error: { code: '23505', message: 'duplicate pkey' } };
          if (q.opcoesUpsert?.ignoreDuplicates) continue;
          // INSERT … ON CONFLICT: o trigger BEFORE INSERT roda como INSERT.
          const e = this.verificarRestricoes(tabela, { ...existente, ...nova }, { ehInsert: true, ignorar: existente });
          if (e) return { data: null, error: e };
          Object.assign(existente, nova);
          resultado.push(existente);
          continue;
        }
        const e = this.verificarRestricoes(tabela, nova, { ehInsert: true });
        if (e) return { data: null, error: e };
        linhas.push(nova);
        resultado.push(nova);
      }
      this.escritas.push({ tabela, op, payload: q.payload });
      return { data: resultado.map((l) => ({ ...l })), error: null };
    }

    const alvo = linhas.filter((l) => q.filtros.every((f) => f(l)));

    if (op === 'update') {
      for (const l of alvo) {
        const e = this.verificarRestricoes(tabela, { ...l, ...q.payload }, { ehInsert: false, ignorar: l });
        if (e) return { data: null, error: e };
      }
      for (const l of alvo) Object.assign(l, JSON.parse(JSON.stringify(q.payload)));
      this.escritas.push({ tabela, op, payload: q.payload });
      return { data: alvo.map((l) => ({ ...l })), error: null };
    }

    if (op === 'delete') {
      this.tabelas[tabela] = linhas.filter((l) => !alvo.includes(l));
      this.escritas.push({ tabela, op, payload: null });
      return { data: alvo, error: null };
    }
    throw new Error(`fakeSupabase: op ${op}`);
  }

  executarLeitura(q: FakeQuery): { data: Linha[]; error: ErroFake | null } {
    const erro = this.tirarErro(q.tabela, 'select');
    if (erro) return { data: [], error: erro };
    let r = this.tabelas[q.tabela].filter((l) => q.filtros.every((f) => f(l)));
    for (const [col, asc] of q.ordem) {
      r = [...r].sort((a, b) => (asc ? 1 : -1) * comparar(a[col], b[col]));
    }
    if (q.limite !== null) r = r.slice(0, q.limite);
    return { data: JSON.parse(JSON.stringify(r)), error: null };
  }
}

export class FakeQuery {
  op: 'select' | 'insert' | 'update' | 'upsert' | 'delete' | null = null;
  payload: any = null;
  opcoesUpsert: { onConflict?: string; ignoreDuplicates?: boolean } | null = null;
  filtros: Filtro[] = [];
  ordem: Array<[string, boolean]> = [];
  limite: number | null = null;
  private querRetorno = false;

  constructor(
    private db: FakeSupabase,
    public tabela: string
  ) {}

  select(_cols?: string) {
    if (!this.op) this.op = 'select';
    else this.querRetorno = true;
    return this;
  }
  insert(p: any) {
    this.op = 'insert';
    this.payload = p;
    return this;
  }
  upsert(p: any, opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    this.op = 'upsert';
    this.payload = p;
    this.opcoesUpsert = opts ?? null;
    return this;
  }
  update(p: any) {
    this.op = 'update';
    this.payload = p;
    return this;
  }
  delete() {
    this.op = 'delete';
    return this;
  }
  eq(col: string, val: any) {
    this.filtros.push((l) => {
      const v = valorDe(l, col);
      return v !== null && v !== undefined && String(v) === String(val);
    });
    return this;
  }
  neq(col: string, val: any) {
    this.filtros.push((l) => String(valorDe(l, col)) !== String(val));
    return this;
  }
  is(col: string, val: null) {
    if (val !== null) throw new Error('fakeSupabase: is() só com null');
    this.filtros.push((l) => valorDe(l, col) === null || valorDe(l, col) === undefined);
    return this;
  }
  in(col: string, vals: any[]) {
    this.filtros.push((l) => vals.map(String).includes(String(valorDe(l, col))));
    return this;
  }
  filter(col: string, op: string, val: string) {
    if (op !== 'cs') throw new Error(`fakeSupabase: filter ${op} não suportado`);
    const alvo = JSON.parse(val) as unknown[];
    this.filtros.push((l) => {
      const v = valorDe(l, col);
      return Array.isArray(v) && alvo.every((x) => v.map(String).includes(String(x)));
    });
    return this;
  }
  lt(col: string, val: any) {
    this.filtros.push((l) => comparar(valorDe(l, col), val) < 0);
    return this;
  }
  or(expr: string) {
    this.filtros.push(parseOr(expr));
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.ordem.push([col, opts?.ascending !== false]);
    return this;
  }
  limit(n: number) {
    this.limite = n;
    return this;
  }

  private executar(): { data: any; error: ErroFake | null } {
    if (this.op === 'select') return this.db.executarLeitura(this);
    return this.db.aplicarEscrita(this);
  }

  async maybeSingle() {
    const r = this.executar();
    if (r.error) return { data: null, error: r.error };
    const arr = (r.data as any[]) ?? [];
    return { data: arr[0] ?? null, error: null };
  }
  async single() {
    const r = this.executar();
    if (r.error) return { data: null, error: r.error };
    const arr = (r.data as any[]) ?? [];
    if (arr.length !== 1) return { data: null, error: { code: 'PGRST116', message: 'not single' } };
    return { data: arr[0], error: null };
  }
  then<T>(ok: (v: { data: any; error: ErroFake | null }) => T, fail?: (e: unknown) => T) {
    try {
      const r = this.executar();
      // Sem `.select()` numa escrita, o PostgREST devolve data = null.
      const data = this.op !== 'select' && !this.querRetorno ? null : r.data;
      return Promise.resolve({ data, error: r.error }).then(ok, fail);
    } catch (e) {
      return Promise.reject(e).then(ok, fail);
    }
  }
}
