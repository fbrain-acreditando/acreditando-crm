/**
 * Story 2.75 (AC8) — `getByIds` de contatos e de empresas em lotes.
 *
 * Medido em produção: 988 ids numa URL só → HTTP 400 no PostgREST, e o
 * `enriquecerDeals` engolia o erro (todos os cards com "Sem contato").
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Chamada = [metodo: string, ...args: unknown[]];
interface Consulta {
  tabela: string;
  chamadas: Chamada[];
}

const h = vi.hoisted(() => ({
  consultas: [] as Consulta[],
  /** Monta a resposta a partir dos ids pedidos no `.in('id', …)`. */
  responder: (_tabela: string, _ids: string[]): { data: unknown; error: unknown } => ({ data: [], error: null }),
}));

vi.mock('./client', () => {
  const construtor = (tabela: string) => {
    const consulta: Consulta = { tabela, chamadas: [] };
    h.consultas.push(consulta);
    const proxy: any = new Proxy(
      {},
      {
        get(_alvo, prop: string) {
          if (prop === 'then') {
            const inArgs = consulta.chamadas.find(([m]) => m === 'in');
            const ids = (inArgs?.[2] as string[]) ?? [];
            const resposta = h.responder(tabela, ids);
            return (resolve: (v: unknown) => void) => resolve(resposta);
          }
          return (...args: unknown[]) => {
            consulta.chamadas.push([prop, ...args]);
            return proxy;
          };
        },
      }
    );
    return proxy;
  };
  return {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
      from: (tabela: string) => construtor(tabela),
    },
  };
});

import { contactsService, companiesService, TAMANHO_DO_LOTE_DE_IDS } from './contacts';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const MIL_IDS = Array.from({ length: 1000 }, (_, i) => uuid(i + 1));

const linhaContato = (id: string) => ({
  id,
  organization_id: 'org-1',
  name: 'Contato de Teste',
  email: '',
  phone: '',
  status: 'ACTIVE',
  stage: 'lc-1',
  created_at: '2026-01-01T00:00:00Z',
});
const linhaEmpresa = (id: string) => ({ id, organization_id: 'org-1', name: 'Empresa de Teste', created_at: '2026-01-01T00:00:00Z' });

const idsPedidos = (c: Consulta) => (c.chamadas.find(([m]) => m === 'in')?.[2] as string[]) ?? [];

beforeEach(() => {
  h.consultas.length = 0;
  h.responder = (tabela, ids) => ({
    data: ids.map(id => (tabela === 'contacts' ? linhaContato(id) : linhaEmpresa(id))),
    error: null,
  });
});

describe.each([
  ['contactsService', 'contacts', () => contactsService] as const,
  ['companiesService', 'crm_companies', () => companiesService] as const,
])('%s.getByIds em lotes (story 2.75, AC8)', (_nome, tabela, servico) => {
  it('o lote é de 150 ids', () => {
    expect(TAMANHO_DO_LOTE_DE_IDS).toBe(150);
  });

  it('1.000 ids → 7 chamadas, cada uma com ≤150 ids, e o resultado junta todos', async () => {
    const { data, error } = await servico().getByIds(MIL_IDS);
    expect(error).toBeNull();

    const consultas = h.consultas.filter(c => c.tabela === tabela);
    expect(consultas).toHaveLength(Math.ceil(1000 / 150));
    for (const c of consultas) expect(idsPedidos(c).length).toBeLessThanOrEqual(150);
    // cada id pedido exatamente uma vez
    const todosPedidos = consultas.flatMap(idsPedidos);
    expect(todosPedidos).toHaveLength(1000);
    expect(new Set(todosPedidos)).toEqual(new Set(MIL_IDS));

    expect(data).toHaveLength(1000);
    expect(new Set(data!.map(d => d.id))).toEqual(new Set(MIL_IDS));
  });

  it('deduplica os ids pedidos e o resultado', async () => {
    // o "servidor" devolve a mesma linha duas vezes
    h.responder = (t, ids) => ({
      data: ids.flatMap(id => {
        const l = t === 'contacts' ? linhaContato(id) : linhaEmpresa(id);
        return [l, l];
      }),
      error: null,
    });
    const ids = [uuid(1), uuid(1), uuid(2), '', uuid(2)];
    const { data } = await servico().getByIds(ids);
    const consultas = h.consultas.filter(c => c.tabela === tabela);
    expect(consultas).toHaveLength(1);
    expect(idsPedidos(consultas[0])).toEqual([uuid(1), uuid(2)]);
    expect(data!.map(d => d.id)).toEqual([uuid(1), uuid(2)]);
  });

  it('erro em UM lote → data null e error preenchido (nada de lista parcial)', async () => {
    const loteRuim = MIL_IDS[450];
    h.responder = (t, ids) =>
      ids.includes(loteRuim)
        ? { data: null, error: new Error('Bad Request') }
        : { data: ids.map(id => (t === 'contacts' ? linhaContato(id) : linhaEmpresa(id))), error: null };

    const { data, error } = await servico().getByIds(MIL_IDS);
    expect(data).toBeNull();
    expect(error).toBeInstanceOf(Error);
    expect(error!.message).toBe('Bad Request');
  });

  it('o signal vai para todas as chamadas', async () => {
    const controller = new AbortController();
    await servico().getByIds(MIL_IDS, { signal: controller.signal });
    const consultas = h.consultas.filter(c => c.tabela === tabela);
    expect(consultas).toHaveLength(7);
    for (const c of consultas) {
      const abort = c.chamadas.find(([m]) => m === 'abortSignal');
      expect(abort?.[1]).toBe(controller.signal);
    }
  });

  it('lista vazia → [] sem consultar', async () => {
    const { data, error } = await servico().getByIds([]);
    expect(data).toEqual([]);
    expect(error).toBeNull();
    expect(h.consultas).toHaveLength(0);
  });
});

it('contatos: o filtro deleted_at continua em cada lote', async () => {
  await contactsService.getByIds(MIL_IDS);
  const consultas = h.consultas.filter(c => c.tabela === 'contacts');
  for (const c of consultas) {
    expect(c.chamadas).toContainEqual(['is', 'deleted_at', null]);
  }
});
