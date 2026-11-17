/**
 * Story 2.74 — a cadeia de chamadas ao Supabase:
 *   • AC2 `searchForBoard`: deleted_at, organization_id e board_id sempre;
 *     limit(50); sem contato achado não há `contact_id.in`; erro volta em `error`.
 *   • AC6/C1 `getAll`: sem opção continua por `created_at`; com 'atividade' é
 *     `updated_at` + `created_at`, antes do `limit(1000)`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Chamada = [metodo: string, ...args: unknown[]];
interface Consulta {
  tabela: string;
  chamadas: Chamada[];
}

const h = vi.hoisted(() => ({
  consultas: [] as Consulta[],
  /** Resposta por tabela (a última chamada da cadeia resolve com isto). */
  respostas: {} as Record<string, { data: unknown; error: unknown }>,
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
            const resposta = h.respostas[tabela] ?? { data: [], error: null };
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

import { dealsService, LIMITE_DEALS_DO_QUADRO } from './deals';

const BOARD = '33333333-3333-4333-8333-333333333333';
const CONTATO = '44444444-4444-4444-8444-444444444444';
const ORG = '66666666-6666-4666-8666-666666666666';

const LINHA_DEAL = {
  id: '55555555-5555-4555-8555-555555555555',
  organization_id: 'org-1',
  title: 'Joana - WhatsApp',
  value: 0,
  probability: 0,
  priority: 'medium',
  board_id: BOARD,
  stage_id: 'stage-1',
  contact_id: CONTATO,
  tags: [],
  custom_fields: {},
  created_at: '2026-08-10T10:00:00Z',
  updated_at: '2026-11-16T10:00:00Z',
  deal_items: [],
};

const consultaDe = (tabela: string) => h.consultas.filter(c => c.tabela === tabela);
const metodos = (c: Consulta) => c.chamadas.map(([m]) => m);
const argsDe = (c: Consulta, metodo: string) => c.chamadas.filter(([m]) => m === metodo).map(([, ...a]) => a);

beforeEach(() => {
  h.consultas.length = 0;
  h.respostas = {
    profiles: { data: { organization_id: ORG }, error: null },
    contacts: { data: [{ id: CONTATO }], error: null },
    deals: { data: [LINHA_DEAL], error: null },
  };
});

describe('AC2 — dealsService.searchForBoard', () => {
  it('🎯 duas consultas, com deleted_at + organization_id nas duas, board_id nos cards e limit(50)', async () => {
    const { data, error } = await dealsService.searchForBoard(BOARD, 'Joana');
    expect(error).toBeNull();
    expect(data?.map(d => d.title)).toEqual(['Joana - WhatsApp']);

    const [contatos] = consultaDe('contacts');
    expect(argsDe(contatos, 'select')).toEqual([['id']]);
    expect(argsDe(contatos, 'is')).toEqual([['deleted_at', null]]);
    expect(argsDe(contatos, 'eq')).toEqual([['organization_id', ORG]]);
    expect(argsDe(contatos, 'or')).toEqual([['name.ilike.%Joana%']]);
    expect(argsDe(contatos, 'limit')).toEqual([[200]]);

    const [cards] = consultaDe('deals');
    expect(argsDe(cards, 'is')).toEqual([['deleted_at', null]]);
    expect(argsDe(cards, 'eq')).toEqual([
      ['organization_id', ORG],
      ['board_id', BOARD],
    ]);
    expect(argsDe(cards, 'or')).toEqual([[`title.ilike.%Joana%,contact_id.in.(${CONTATO})`]]);
    expect(argsDe(cards, 'order')).toEqual([['updated_at', { ascending: false }]]);
    expect(argsDe(cards, 'limit')).toEqual([[50]]);
  });

  it('sem contato achado → a 2ª consulta vai só com o título (sem contact_id.in)', async () => {
    h.respostas.contacts = { data: [], error: null };
    await dealsService.searchForBoard(BOARD, 'Joana');
    const [cards] = consultaDe('deals');
    expect(argsDe(cards, 'or')).toEqual([['title.ilike.%Joana%']]);
    expect(JSON.stringify(cards.chamadas)).not.toContain('contact_id.in');
  });

  it('telefone → filtro pelos 8 últimos dígitos na consulta de contatos', async () => {
    await dealsService.searchForBoard(BOARD, '(11) 91234-5678');
    const [contatos] = consultaDe('contacts');
    expect(argsDe(contatos, 'or')).toEqual([['name.ilike.%11 91234-5678%,phone.ilike.%12345678%']]);
  });

  it('termo curto (ab) → não consulta o banco', async () => {
    const { data, error } = await dealsService.searchForBoard(BOARD, 'ab');
    expect(data).toEqual([]);
    expect(error).toBeNull();
    expect(consultaDe('contacts')).toHaveLength(0);
    expect(consultaDe('deals')).toHaveLength(0);
  });

  it('erro do Supabase volta como `error`, sem lançar (contatos e cards)', async () => {
    h.respostas.contacts = { data: null, error: new Error('falhou contatos') };
    await expect(dealsService.searchForBoard(BOARD, 'Joana')).resolves.toMatchObject({
      data: null,
      error: { message: 'falhou contatos' },
    });

    h.respostas.contacts = { data: [], error: null };
    h.respostas.deals = { data: null, error: new Error('falhou cards') };
    await expect(dealsService.searchForBoard(BOARD, 'Joana')).resolves.toMatchObject({
      data: null,
      error: { message: 'falhou cards' },
    });
  });

  it('repassa o AbortSignal às duas consultas', async () => {
    const controle = new AbortController();
    await dealsService.searchForBoard(BOARD, 'Joana', { signal: controle.signal });
    expect(argsDe(consultaDe('contacts')[0], 'abortSignal')).toEqual([[controle.signal]]);
    expect(argsDe(consultaDe('deals')[0], 'abortSignal')).toEqual([[controle.signal]]);
  });
});

describe('AC2 — sem service role nos arquivos da busca', () => {
  it('buscaDeCards.ts, deals.ts e o hook não importam staticAdminClient nem chave secreta', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const arquivos = [
      'lib/supabase/buscaDeCards.ts',
      'lib/supabase/deals.ts',
      'lib/query/hooks/enriquecerDeals.ts',
      'lib/query/acrescentarAoQuadro.ts',
      'features/boards/hooks/useCardsDoBanco.ts',
    ];
    for (const arquivo of arquivos) {
      const fonte = readFileSync(join(process.cwd(), arquivo), 'utf8');
      expect(fonte, arquivo).not.toMatch(/staticAdminClient|SUPABASE_SECRET_KEY|SERVICE_ROLE/);
    }
  });
});

describe('AC6 / C1 — ordem da carga do getAll', () => {
  it('🎯 sem opção continua por created_at (painel, atividades, prefetch do useDeals)', async () => {
    await dealsService.getAll();
    const [cards] = consultaDe('deals');
    expect(argsDe(cards, 'order')).toEqual([['created_at', { ascending: false }]]);
    expect(argsDe(cards, 'limit')).toEqual([[LIMITE_DEALS_DO_QUADRO]]);
  });

  it("🎯 'atividade': updated_at e depois created_at, ANTES do limit(1000)", async () => {
    await dealsService.getAll({ ordem: 'atividade' });
    const [cards] = consultaDe('deals');
    expect(argsDe(cards, 'order')).toEqual([
      ['updated_at', { ascending: false }],
      ['created_at', { ascending: false }],
    ]);
    const m = metodos(cards);
    expect(m.lastIndexOf('order')).toBeLessThan(m.indexOf('limit'));
    expect(argsDe(cards, 'limit')).toEqual([[1000]]);
    expect(argsDe(cards, 'is')).toEqual([['deleted_at', null]]);
  });

  it("'criacao' explícito = o padrão", async () => {
    await dealsService.getAll({ ordem: 'criacao' });
    expect(argsDe(consultaDe('deals')[0], 'order')).toEqual([['created_at', { ascending: false }]]);
  });
});
