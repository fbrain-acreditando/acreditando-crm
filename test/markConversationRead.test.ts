/**
 * Reprodução do bug relatado em 30/07: "após abrir a conversa, ela continua com
 * o ícone mostrando o número de mensagens não visualizadas".
 *
 * Causa: o `onMutate` de `useMarkConversationRead` fazia `setQueriesData` sobre
 * o PREFIXO `['messagingConversations']` — que casa com a lista (array), com
 * `detail(id)` (objeto) e com `unreadCount()` (número) — e chamava `old.map`
 * sem checar se era array. O `TypeError` dentro do `onMutate` impede o TanStack
 * de executar a `mutationFn` (query-core 5.x: `onMutate` é aguardado ANTES do
 * retryer), então o `UPDATE ... SET unread_count = 0` nunca chegava ao banco.
 *
 * O teste exercita a mutation real com um QueryClient de verdade e os três
 * caches populados — exatamente o estado da tela quando o efeito dispara.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// --- "Banco" fake -----------------------------------------------------------
type UpdateCall = { table: string; values: Record<string, unknown>; id: string };

const updateCalls: UpdateCall[] = [];
let affectedRows: { id: string }[] = [{ id: 'conv-1' }];
let updateError: { message: string } | null = null;

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      update: (values: Record<string, unknown>) => ({
        eq: (_column: string, id: string) => {
          updateCalls.push({ table, values, id });
          return {
            select: async () => ({ data: affectedRows, error: updateError }),
          };
        },
      }),
    }),
  },
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' }, loading: false, profile: { organization_id: 'org-1' } }),
}));

import { useMarkConversationRead } from '@/lib/query/hooks/useConversationsQuery';
import { queryKeys } from '@/lib/query';

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

/** Popula os três caches como a tela de mensagens os tem ao abrir a conversa. */
function seedCaches(queryClient: QueryClient) {
  queryClient.setQueryData(queryKeys.messagingConversations.filtered({}), [
    { id: 'conv-1', unreadCount: 3 },
    { id: 'conv-2', unreadCount: 1 },
  ]);
  // Cache de OBJETO — é dele que sai o `unreadCount > 0` que autoriza a mutation.
  queryClient.setQueryData(queryKeys.messagingConversations.detail('conv-1'), {
    id: 'conv-1',
    unreadCount: 3,
  });
  // Cache de NÚMERO — badge do menu lateral.
  queryClient.setQueryData(queryKeys.messagingConversations.unreadCount(), 2);
}

beforeEach(() => {
  updateCalls.length = 0;
  affectedRows = [{ id: 'conv-1' }];
  updateError = null;
});

describe('useMarkConversationRead', () => {
  it('escreve no banco mesmo com os caches de detail (objeto) e unreadCount (número) populados', async () => {
    const queryClient = makeClient();
    seedCaches(queryClient);

    const { result } = renderHook(() => useMarkConversationRead(), {
      wrapper: wrapperFor(queryClient),
    });

    result.current.mutate('conv-1');

    // O coração do bug: antes da correção o onMutate estourava e a mutationFn
    // nunca era chamada — nenhum UPDATE saía daqui.
    await waitFor(() => expect(updateCalls).toHaveLength(1));
    expect(updateCalls[0]).toMatchObject({
      table: 'messaging_conversations',
      values: { unread_count: 0 },
      id: 'conv-1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('zera o badge da lista sem corromper os caches não-array', async () => {
    const queryClient = makeClient();
    seedCaches(queryClient);

    const { result } = renderHook(() => useMarkConversationRead(), {
      wrapper: wrapperFor(queryClient),
    });

    result.current.mutate('conv-1');

    await waitFor(() => expect(updateCalls).toHaveLength(1));

    const list = queryClient.getQueryData<Array<{ id: string; unreadCount: number }>>(
      queryKeys.messagingConversations.filtered({})
    );
    expect(list?.find((c) => c.id === 'conv-1')?.unreadCount).toBe(0);
    // A outra conversa não pode ser afetada.
    expect(list?.find((c) => c.id === 'conv-2')?.unreadCount).toBe(1);

    // Detail zerado (evita o efeito da MessagingPage redisparar).
    const detail = queryClient.getQueryData<{ id: string; unreadCount: number }>(
      queryKeys.messagingConversations.detail('conv-1')
    );
    expect(detail?.unreadCount).toBe(0);

    // O cache numérico continua número — não pode virar array nem quebrar.
    const unread = queryClient.getQueryData(queryKeys.messagingConversations.unreadCount());
    expect(typeof unread).toBe('number');
  });

  it('falha alto quando nenhuma linha é atualizada (bloqueio de RLS)', async () => {
    affectedRows = []; // PostgREST devolve sucesso com zero linhas afetadas
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const queryClient = makeClient();
    seedCaches(queryClient);

    const { result } = renderHook(() => useMarkConversationRead(), {
      wrapper: wrapperFor(queryClient),
    });

    result.current.mutate('conv-1');

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toContain('nenhuma linha foi atualizada');
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('propaga erro do PostgREST', async () => {
    updateError = { message: 'permission denied' };
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const queryClient = makeClient();
    seedCaches(queryClient);

    const { result } = renderHook(() => useMarkConversationRead(), {
      wrapper: wrapperFor(queryClient),
    });

    result.current.mutate('conv-1');

    await waitFor(() => expect(result.current.isError).toBe(true));
    consoleSpy.mockRestore();
  });
});
