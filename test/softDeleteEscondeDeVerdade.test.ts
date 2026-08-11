/**
 * Story 2.25 — o soft delete precisa ESCONDER.
 *
 * Contexto do defeito: `deleted_at` era escrito e ninguém lia. A story 2.16
 * marcou 431 leads como excluídos, reportou "read-back 8/8" — e a Fernanda
 * continuou vendo os 431, porque nenhuma consulta do caminho da tela filtrava
 * o campo. Foi preciso a 2.24 apagar fisicamente para obter o efeito que o
 * soft delete deveria ter dado.
 *
 * ⚠️ ESTRATÉGIA DE TESTE — por que não `expect(builder.is).toHaveBeenCalled()`:
 * asserção sobre a chamada testa a IMPLEMENTAÇÃO, e passa se alguém chamar
 * `.is()` na coluna errada. Aqui o mock **se comporta como o Postgres**: o fake
 * builder guarda os filtros e os APLICA sobre um fixture. Se o serviço não
 * filtrar `deleted_at`, a linha excluída volta e o teste falha — que é
 * exatamente o que acontece com o código anterior a esta story.
 *
 * Foi essa a lição do dry-run reprovado na 2.24: teste que passa sem exercitar
 * o caminho é teste que mente.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const BOARD_ID = 'b0a1c2d3-e4f5-4a6b-8c7d-e8f9a0b1c2d3';
const STAGE_ID = '51a2b3c4-d5e6-4f7a-8b9c-d0e1f2a3b4c5';
const CONTACT_ID = 'c0n7a c70'.replace(/\s/g, '') + '-0000-4000-8000-000000000001';
const DEAL_VIVO = 'd1110000-0000-4000-8000-000000000001';
const DEAL_MORTO = 'd2220000-0000-4000-8000-000000000002';

/** Fixture: um deal vivo e um soft-deleted, tudo o mais idêntico. */
const LINHAS = [
  {
    id: DEAL_VIVO,
    title: 'Lead de agosto',
    board_id: BOARD_ID,
    stage_id: STAGE_ID,
    contact_id: CONTACT_ID,
    organization_id: 'org-1',
    value: 0,
    deleted_at: null,
    created_at: '2026-08-05T10:00:00Z',
    updated_at: '2026-08-05T10:00:00Z',
    deal_items: [],
  },
  {
    id: DEAL_MORTO,
    title: 'Lead de julho (excluído)',
    board_id: BOARD_ID,
    stage_id: STAGE_ID,
    contact_id: CONTACT_ID,
    organization_id: 'org-1',
    value: 0,
    deleted_at: '2026-08-10T15:45:06.803837Z',
    created_at: '2026-07-15T10:00:00Z',
    updated_at: '2026-08-10T15:45:06.803837Z',
    deal_items: [],
  },
];

/**
 * Fake builder que APLICA os filtros, em vez de só registrá-los.
 * Suporta o subconjunto usado pelos serviços: select/eq/is/order/limit/
 * abortSignal/maybeSingle, e é `await`-ável como o PostgrestBuilder.
 */
function criarBuilder(linhas: Record<string, unknown>[], opts?: { head?: boolean }) {
  let atual = [...linhas];
  let contar = false;

  const builder: Record<string, unknown> = {
    select: (_cols?: string, o?: { count?: string; head?: boolean }) => {
      if (o?.count) contar = true;
      return builder;
    },
    eq: (col: string, val: unknown) => {
      atual = atual.filter(r => r[col] === val);
      return builder;
    },
    is: (col: string, val: unknown) => {
      atual = atual.filter(r => (r[col] ?? null) === val);
      return builder;
    },
    order: () => builder,
    limit: () => builder,
    abortSignal: () => builder,
    maybeSingle: async () => ({ data: atual[0] ?? null, error: null }),
    single: async () => ({ data: atual[0] ?? null, error: null }),
    then: (resolve: (v: unknown) => unknown) =>
      resolve({
        data: opts?.head ? null : atual,
        count: contar ? atual.length : null,
        error: null,
      }),
  };
  return builder;
}

let dealsLinhas = LINHAS;
const mockSupabase = {
  from: vi.fn((table: string) => {
    if (table === 'deals') return criarBuilder(dealsLinhas);
    // deal_items e demais tabelas: vazio é suficiente para estes casos
    return criarBuilder([]);
  }),
  auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'u1' } } })) },
};

vi.mock('@/lib/supabase/client', () => ({
  get supabase() {
    return mockSupabase;
  },
}));

import { dealsService } from '@/lib/supabase/deals';
import { boardsService } from '@/lib/supabase/boards';
import { contactsService } from '@/lib/supabase/contacts';

beforeEach(() => {
  vi.clearAllMocks();
  dealsLinhas = LINHAS;
});

describe('story 2.25 — leituras da UI respeitam deleted_at', () => {
  it('getAll não devolve o deal excluído ao board', async () => {
    const { data, error } = await dealsService.getAll();

    expect(error).toBeNull();
    const ids = (data ?? []).map(d => d.id);
    expect(ids).toContain(DEAL_VIVO);
    // 🎯 A asserção que falha com o código de antes desta story.
    expect(ids).not.toContain(DEAL_MORTO);
    expect(data).toHaveLength(1);
  });

  it('getById de um deal excluído devolve null — e não erro', async () => {
    const { data, error } = await dealsService.getById(DEAL_MORTO);

    expect(data).toBeNull();
    // "Não encontrado" não é falha: antes da guarda, o transformDeal recebia
    // null e estourava, transformando "não existe" em "deu erro".
    expect(error).toBeNull();
  });

  it('getById de um deal vivo continua abrindo', async () => {
    const { data, error } = await dealsService.getById(DEAL_VIVO);

    expect(error).toBeNull();
    expect(data?.id).toBe(DEAL_VIVO);
  });

  it('boards.canDelete não conta card excluído como impedimento', async () => {
    const { canDelete, dealCount, error } = await boardsService.canDelete(BOARD_ID);

    expect(error).toBeNull();
    expect(dealCount).toBe(1); // só o vivo
    expect(canDelete).toBe(false);
  });

  it('board sem deals VIVOS pode ser excluído, mesmo com cards soft-deleted', async () => {
    dealsLinhas = LINHAS.filter(r => r.deleted_at !== null); // só o morto

    const { canDelete, dealCount } = await boardsService.canDelete(BOARD_ID);

    // 🎯 Com o código de antes: dealCount = 1 e canDelete = false — o board
    // ficava impossível de excluir por causa de um card que não existe.
    expect(dealCount).toBe(0);
    expect(canDelete).toBe(true);
  });

  it('deleteStage não é bloqueado por card excluído', async () => {
    dealsLinhas = LINHAS.filter(r => r.deleted_at !== null); // só o morto

    const { error } = await boardsService.deleteStage(STAGE_ID);

    // Antes: "Não é possível excluir este estágio. Existem 1 deal(s) nele."
    expect(error?.message ?? '').not.toMatch(/não é possível excluir este estágio/i);
  });

  it('hasDeals não soma deals excluídos no aviso ao usuário', async () => {
    const { hasDeals, dealCount, deals, error } =
      await contactsService.hasDeals(CONTACT_ID);

    expect(error).toBeNull();
    expect(dealCount).toBe(1);
    expect(hasDeals).toBe(true);
    expect(deals.map(d => d.id)).not.toContain(DEAL_MORTO);
  });
});
