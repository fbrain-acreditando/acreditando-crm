/**
 * Story 2.56 — achado BAIXA-8 do @qa: o briefing lia "uma conversa qualquer".
 *
 * `buildDealContext` buscava a conversa do card com `.limit(1)` **sem
 * `.order()`**. Isso era inofensivo enquanto um card tinha uma conversa só — e
 * a guarda de card aberto do AC3 acabou com essa premissa: agora a conversa
 * nova **reusa** o card em vez de criar outro, então vários threads apontam
 * para o mesmo `deal_id`.
 *
 * Sem ordenação, o briefing podia resumir a conversa ANTIGA, de um atendimento
 * já encerrado. Erro calado: o texto sai bonito, só que sobre a thread errada.
 */
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { selecionarConversaDoDeal } from '@/lib/ai/briefing/briefing.service';

const DEAL = 'e5f6a7b8-c9d0-4e1f-8a2b-c3d4e5f6a7b8';

interface Conversa {
  id: string;
  metadata: Record<string, unknown>;
  last_message_at: string | null;
  created_at: string;
}

/** Falso que ORDENA de verdade — senão o teste não provaria a ordenação. */
function fakeSupabase(linhas: Conversa[]) {
  const ordens: Array<[string, boolean, boolean | undefined]> = [];

  const query = {
    select: () => query,
    contains(_col: string, val: Record<string, unknown>) {
      filtroDeal = val.deal_id as string;
      return query;
    },
    order(col: string, opts: { ascending: boolean; nullsFirst?: boolean }) {
      ordens.push([col, opts.ascending, opts.nullsFirst]);
      return query;
    },
    async limit(n: number) {
      const cmp = (a: Conversa, b: Conversa) => {
        for (const [col, asc, nullsFirst] of ordens) {
          const va = (a as unknown as Record<string, string | null>)[col];
          const vb = (b as unknown as Record<string, string | null>)[col];
          if (va === vb) continue;
          if (va === null) return nullsFirst ? -1 : 1;
          if (vb === null) return nullsFirst ? 1 : -1;
          return asc ? va.localeCompare(vb) : vb.localeCompare(va);
        }
        return 0;
      };
      const achadas = linhas
        .filter((l) => l.metadata.deal_id === filtroDeal)
        .sort(cmp)
        .slice(0, n);
      return { data: achadas.map((l) => ({ id: l.id })), error: null };
    },
  };

  let filtroDeal: string | null = null;
  return {
    client: { from: () => query } as unknown as SupabaseClient,
    ordens,
  };
}

const ANTIGA: Conversa = {
  id: 'conv-antiga',
  metadata: { deal_id: DEAL },
  last_message_at: '2026-07-01T10:00:00Z',
  created_at: '2026-07-01T09:00:00Z',
};
const RECENTE: Conversa = {
  id: 'conv-recente',
  metadata: { deal_id: DEAL },
  last_message_at: '2026-09-24T18:00:00Z',
  created_at: '2026-09-24T17:00:00Z',
};

describe('BAIXA-8 — o briefing lê a conversa MAIS RECENTE do card', () => {
  it('com duas conversas no mesmo card, escolhe a da última mensagem', async () => {
    const { client } = fakeSupabase([ANTIGA, RECENTE]);

    const { data } = await selecionarConversaDoDeal(client, DEAL);

    expect(data).toEqual([{ id: 'conv-recente' }]);
  });

  it('a ordem de chegada das linhas não decide nada', async () => {
    const { client } = fakeSupabase([RECENTE, ANTIGA]);

    const { data } = await selecionarConversaDoDeal(client, DEAL);

    expect(data).toEqual([{ id: 'conv-recente' }]);
  });

  it('conversa sem mensagem nenhuma não ganha da que tem fala recente', async () => {
    const semMensagem: Conversa = {
      id: 'conv-sem-mensagem',
      metadata: { deal_id: DEAL },
      last_message_at: null,
      created_at: '2026-09-25T08:00:00Z',
    };
    const { client } = fakeSupabase([semMensagem, RECENTE]);

    const { data } = await selecionarConversaDoDeal(client, DEAL);

    expect(data).toEqual([{ id: 'conv-recente' }]);
  });

  it('só conversas sem mensagem: desempata pela criação mais nova', async () => {
    const velha: Conversa = {
      id: 'conv-velha',
      metadata: { deal_id: DEAL },
      last_message_at: null,
      created_at: '2026-01-01T00:00:00Z',
    };
    const nova: Conversa = {
      id: 'conv-nova',
      metadata: { deal_id: DEAL },
      last_message_at: null,
      created_at: '2026-09-25T00:00:00Z',
    };
    const { client } = fakeSupabase([velha, nova]);

    const { data } = await selecionarConversaDoDeal(client, DEAL);

    expect(data).toEqual([{ id: 'conv-nova' }]);
  });

  it('conversa de OUTRO card não entra', async () => {
    const deOutro: Conversa = {
      id: 'conv-de-outro',
      metadata: { deal_id: 'outro-deal' },
      last_message_at: '2026-09-25T23:00:00Z',
      created_at: '2026-09-25T22:00:00Z',
    };
    const { client } = fakeSupabase([deOutro, ANTIGA]);

    const { data } = await selecionarConversaDoDeal(client, DEAL);

    expect(data).toEqual([{ id: 'conv-antiga' }]);
  });

  it('a consulta pede ordenação explícita — o `.limit(1)` sozinho nao vale', async () => {
    const { client, ordens } = fakeSupabase([RECENTE]);

    await selecionarConversaDoDeal(client, DEAL);

    expect(ordens[0][0]).toBe('last_message_at');
    expect(ordens[0][1]).toBe(false);
    expect(ordens[1][0]).toBe('created_at');
  });
});
