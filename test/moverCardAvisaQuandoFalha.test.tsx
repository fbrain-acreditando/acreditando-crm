/**
 * Story 2.37 — quando mover um card falha, ela precisa SABER.
 *
 * Este é o oráculo da metade 1: com o `onError` antigo (que fazia rollback e
 * descartava o erro em `_err`), **nenhum texto chega à tela** e os dois primeiros
 * testes reprovam.
 *
 * O aviso é verificado no DOM, dentro do `ToastProvider` REAL — não num mock do
 * toast. A lição da story 2.28: suíte que arranca a peça de produção testa outro
 * componente (lá o `FocusTrap` era mockado e 602 testes ficaram verdes com a tela
 * travada).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderHook, act, waitFor, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/context/ToastContext';
import { useMoveDeal } from '@/lib/query/hooks/useMoveDeal';
import type { Board, Deal } from '@/types';

// --- Serviços mockados ------------------------------------------------------
const update = vi.fn();

vi.mock('@/lib/supabase', () => ({
    dealsService: {
        update: (...args: unknown[]) => update(...(args as [])),
    },
}));
vi.mock('@/lib/supabase/boards', () => ({ boardsService: { getById: vi.fn() } }));
vi.mock('@/lib/supabase/activities', () => ({ activitiesService: { create: vi.fn() } }));
vi.mock('@/lib/supabase/contacts', () => ({ contactsService: { update: vi.fn() } }));

// --- Cenário ----------------------------------------------------------------
const board = {
    id: 'board-1',
    stages: [
        { id: 'stage-lead', name: 'Lead novo' },
        { id: 'stage-perdido', name: 'Perdido' },
    ],
} as unknown as Board;

const deal = {
    id: 'deal-1',
    title: 'Arkley - WhatsApp',
    status: 'stage-lead',
    isWon: false,
    isLost: false,
} as unknown as Deal;

function montar() {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={queryClient}>
            <ToastProvider>{children}</ToastProvider>
        </QueryClientProvider>
    );

    return renderHook(() => useMoveDeal(), { wrapper });
}

describe('story 2.37 — o rollback deixa de ser mudo', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    it('avisa NA TELA quando a gravação falha, nomeando a coluna de destino (AC1)', async () => {
        update.mockResolvedValue({ error: new Error('violates row-level security policy') });

        const { result } = montar();

        await act(async () => {
            result.current.mutate({ dealId: 'deal-1', targetStageId: 'stage-perdido', deal, board });
        });

        await waitFor(() => {
            expect(screen.getByRole('alert')).toBeInTheDocument();
        });

        const aviso = screen.getByRole('alert').textContent ?? '';
        expect(aviso).toContain('Não foi possível mover o card');
        expect(aviso).toContain('Perdido');
        expect(aviso).toContain('voltou para a coluna anterior');
    });

    it('não joga o texto técnico do erro na tela dela (AC2)', async () => {
        update.mockResolvedValue({ error: new Error('PGRST116: violates row-level security') });

        const { result } = montar();

        await act(async () => {
            result.current.mutate({ dealId: 'deal-1', targetStageId: 'stage-perdido', deal, board });
        });

        await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());

        const aviso = screen.getByRole('alert').textContent ?? '';
        expect(aviso).not.toContain('PGRST116');
        expect(aviso).not.toContain('row-level');

        // Mas o diagnóstico NÃO se perde: ele vai para o console.
        expect(console.error).toHaveBeenCalled();
        const logado = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls
            .flat()
            .join(' ');
        expect(logado).toContain('PGRST116');
    });

    it('NÃO avisa quando a requisição foi abortada (AC3)', async () => {
        const abortada = new Error('The user aborted a request.');
        abortada.name = 'AbortError';
        update.mockResolvedValue({ error: abortada });

        const { result } = montar();

        await act(async () => {
            result.current.mutate({ dealId: 'deal-1', targetStageId: 'stage-perdido', deal, board });
        });

        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('o card volta para a coluna de origem no cache — o rollback continua existindo', async () => {
        update.mockResolvedValue({ error: new Error('falhou') });

        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        });
        // Estado anterior no cache, na coluna de origem.
        const { DEALS_VIEW_KEY } = await import('@/lib/query/queryKeys');
        queryClient.setQueryData(DEALS_VIEW_KEY, [{ ...deal, boardId: 'board-1' }]);

        const wrapper = ({ children }: { children: React.ReactNode }) => (
            <QueryClientProvider client={queryClient}>
                <ToastProvider>{children}</ToastProvider>
            </QueryClientProvider>
        );
        const { result } = renderHook(() => useMoveDeal(), { wrapper });

        await act(async () => {
            result.current.mutate({ dealId: 'deal-1', targetStageId: 'stage-perdido', deal, board });
        });

        await waitFor(() => expect(result.current.isError).toBe(true));

        const cache = queryClient.getQueryData(DEALS_VIEW_KEY) as { status: string }[];
        expect(cache[0].status).toBe('stage-lead');
    });
});
