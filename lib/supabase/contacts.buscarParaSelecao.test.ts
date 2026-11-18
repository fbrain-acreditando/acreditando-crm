/**
 * Story 2.76 (AC2, D4) — serviços que buscam contato no BANCO:
 * `buscarParaSelecao` (seleção de contato e Inbox por nome) e as duas
 * consultas do Inbox (`getComAniversario`, `getClientesParaResgate`).
 * Afirma os VALORES passados ao cliente Supabase simulado.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Chamada = [metodo: string, ...args: unknown[]];
interface Consulta {
  tabela: string;
  chamadas: Chamada[];
}

const ORG = 'org-de-teste';

const h = vi.hoisted(() => ({
  consultas: [] as Consulta[],
  usuario: { id: 'user-1' } as { id: string } | null,
  orgDoPerfil: 'org-de-teste' as string | null,
  respostaContatos: { data: [] as unknown[], error: null as unknown },
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
            const resposta =
              tabela === 'profiles'
                ? { data: h.orgDoPerfil ? { organization_id: h.orgDoPerfil } : null, error: null }
                : h.respostaContatos;
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
      auth: { getUser: async () => ({ data: { user: h.usuario } }) },
      from: (tabela: string) => construtor(tabela),
    },
  };
});

import { contactsService, LIMITE_DAS_CONSULTAS_DO_INBOX } from './contacts';

const consultasDeContatos = () => h.consultas.filter(c => c.tabela === 'contacts');
const args = (c: Consulta, metodo: string) => c.chamadas.filter(([m]) => m === metodo).map(([, ...a]) => a);

const linha = (id: string) => ({
  id,
  organization_id: ORG,
  name: 'Contato de Teste',
  email: '',
  phone: '',
  status: 'ACTIVE',
  stage: 'CUSTOMER',
  created_at: '2026-01-01T00:00:00Z',
});

beforeEach(() => {
  h.consultas.length = 0;
  h.usuario = { id: 'user-1' };
  h.orgDoPerfil = ORG;
  h.respostaContatos = { data: [linha('c-1')], error: null };
});

describe('contactsService.buscarParaSelecao (story 2.76, AC2)', () => {
  it('monta a consulta com deleted_at, organização, filtro, ordem, limite 8 e signal', async () => {
    const controle = new AbortController();
    const { data, error } = await contactsService.buscarParaSelecao('Ana', { signal: controle.signal });

    expect(error).toBeNull();
    expect(data?.map(c => c.id)).toEqual(['c-1']);
    const [c] = consultasDeContatos();
    expect(consultasDeContatos()).toHaveLength(1);
    expect(args(c, 'select')).toEqual([['*']]);
    expect(args(c, 'is')).toEqual([['deleted_at', null]]);
    expect(args(c, 'eq')).toEqual([['organization_id', ORG]]);
    expect(args(c, 'or')).toEqual([['name.ilike.%Ana%,email.ilike.%Ana%']]);
    expect(args(c, 'order')).toEqual([['updated_at', { ascending: false }]]);
    expect(args(c, 'limit')).toEqual([[8]]);
    expect(args(c, 'abortSignal')).toEqual([[controle.signal]]);
  });

  it('limite 1 quando pedido (Inbox por nome)', async () => {
    await contactsService.buscarParaSelecao('Ana', { limite: 1 });
    expect(args(consultasDeContatos()[0], 'limit')).toEqual([[1]]);
  });

  it.each(['ab', '%', ''])('filtro null (%j) → não consulta e devolve lista vazia', async termo => {
    const r = await contactsService.buscarParaSelecao(termo);
    expect(r).toEqual({ data: [], error: null });
    expect(h.consultas).toHaveLength(0);
  });

  it('erro do banco → { data: null, error }, sem lançar', async () => {
    const erro = new Error('falhou');
    h.respostaContatos = { data: null as unknown as unknown[], error: erro };
    const r = await contactsService.buscarParaSelecao('Ana');
    expect(r).toEqual({ data: null, error: erro });
  });

  it('sem organização → { data: null, error } e não consulta contatos', async () => {
    h.orgDoPerfil = null;
    const r = await contactsService.buscarParaSelecao('Ana');
    expect(r.data).toBeNull();
    expect(r.error).toBeInstanceOf(Error);
    expect(consultasDeContatos()).toHaveLength(0);
  });

  it('sem usuário → { data: null, error }', async () => {
    h.usuario = null;
    const r = await contactsService.buscarParaSelecao('Ana');
    expect(r.data).toBeNull();
    expect(r.error).toBeInstanceOf(Error);
  });
});

describe('consultas do Inbox (story 2.76, D4)', () => {
  it('aniversário: org, deleted_at, birth_date não nulo, teto 1.000', async () => {
    const r = await contactsService.getComAniversario();
    expect(r.error).toBeNull();
    const [c] = consultasDeContatos();
    expect(args(c, 'is')).toEqual([['deleted_at', null]]);
    expect(args(c, 'eq')).toEqual([['organization_id', ORG]]);
    expect(args(c, 'not')).toEqual([['birth_date', 'is', null]]);
    expect(args(c, 'limit')).toEqual([[LIMITE_DAS_CONSULTAS_DO_INBOX]]);
    expect(LIMITE_DAS_CONSULTAS_DO_INBOX).toBe(1000);
  });

  it('resgate: ACTIVE + CUSTOMER + interação nula ou anterior ao limite', async () => {
    const limite = '2026-10-18T03:00:00.000Z';
    await contactsService.getClientesParaResgate(limite);
    const [c] = consultasDeContatos();
    expect(args(c, 'eq')).toEqual([
      ['organization_id', ORG],
      ['status', 'ACTIVE'],
      ['stage', 'CUSTOMER'],
    ]);
    expect(args(c, 'or')).toEqual([[`last_interaction.is.null,last_interaction.lt.${limite}`]]);
    expect(args(c, 'limit')).toEqual([[1000]]);
  });

  it('resgate com data inválida → erro, sem consultar', async () => {
    const r = await contactsService.getClientesParaResgate('não é data');
    expect(r.data).toBeNull();
    expect(r.error).toBeInstanceOf(Error);
  });

  it('consulta cheia (1.000 linhas) → console.error só com a contagem', async () => {
    const espiao = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.respostaContatos = {
      data: Array.from({ length: 1000 }, (_, i) => ({ ...linha(`c-${i}`), name: 'Nome Que Não Pode Vazar' })),
      error: null,
    };
    await contactsService.getClientesParaResgate('2026-10-18T03:00:00.000Z');
    expect(espiao).toHaveBeenCalledTimes(1);
    expect(espiao.mock.calls[0]).toEqual(['[inbox] consulta de contatos "resgate" atingiu o teto', { linhas: 1000 }]);
    expect(JSON.stringify(espiao.mock.calls)).not.toContain('Nome Que Não Pode Vazar');
    espiao.mockRestore();
  });
});
