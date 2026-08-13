/**
 * Story 2.37 — o board reconcilia quando ela volta para a aba.
 *
 * Oráculo da metade 2: com `refetchOnWindowFocus` no default global (`false`),
 * o primeiro teste REPROVA — é literalmente o caso da Fernanda em 13/08, que
 * deixou a aba aberta 1h30 enquanto apresentava a um casal e voltou vendo a
 * coluna velha.
 *
 * O segundo teste é o CONTROLE que impede a correção de virar defeito: dado
 * fresco (dentro do `staleTime` de 2 min) não pode disparar leitura por cima do
 * otimismo — o risco que o comentário original do hook temia, e com razão.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { DEALS_VIEW_KEY } from '@/lib/query/queryKeys';
import { useDealsByBoard } from '@/lib/query/hooks/useDealsQuery';

const DOIS_MINUTOS = 2 * 60 * 1000;

const getAllDeals = vi.fn(async () => ({ data: [], error: null }));

vi.mock('@/lib/supabase', () => ({
    dealsService: { getAll: (...a: unknown[]) => getAllDeals(...(a as [])) },
    boardStagesService: { getAll: vi.fn(async () => ({ data: [], error: null })) },
    contactsService: { getByIds: vi.fn(async () => ({ data: [], error: null })) },
    companiesService: { getByIds: vi.fn(async () => ({ data: [], error: null })) },
}));

vi.mock('@/context/AuthContext', () => ({
    useAuth: () => ({ user: { id: 'u1' }, loading: false }),
}));

function montarComCacheDe(idadeEmMs: number) {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
                // 🪤 ESTA LINHA É O QUE FAZ O TESTE VALER ALGO.
                //
                // A 1ª versão deste teste passou COM O CÓDIGO ANTIGO — porque um
                // `QueryClient` cru usa o default da BIBLIOTECA (`true`), não o
                // de produção. O app define `refetchOnWindowFocus: false` no
                // client global (`lib/query/index.tsx:150`), e é esse ambiente
                // que precisa ser reproduzido aqui: assim o único responsável
                // pelo refetch é a opção do próprio hook.
                //
                // 📌 Mesma lição da story 2.28 pelo avesso: lá o teste arrancava
                // a peça de produção; aqui ele quase testou um ambiente que não
                // existe.
                refetchOnWindowFocus: false,
            },
        },
    });

    // Semeia o cache com a IDADE desejada. Sem isso o `refetchOnMount` buscaria
    // no monte (`dataUpdatedAt === 0`) e o teste mediria a montagem, não o foco.
    queryClient.setQueryData(DEALS_VIEW_KEY, [], { updatedAt: Date.now() - idadeEmMs });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    return renderHook(() => useDealsByBoard('board-1'), { wrapper });
}

async function voltarParaAAba() {
    await act(async () => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
        await Promise.resolve();
    });
}

describe('story 2.37 — reconciliação ao voltar para a aba', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        // Devolve o controle de foco ao comportamento padrão do navegador.
        focusManager.setFocused(undefined);
    });

    it('dado VELHO (1h30 parado) ⇒ reconcilia ao voltar para a aba (AC4)', async () => {
        const umaHoraEMeia = 90 * 60 * 1000;
        montarComCacheDe(umaHoraEMeia);

        // Nada foi buscado na montagem: o cache tinha dado.
        expect(getAllDeals).not.toHaveBeenCalled();

        await voltarParaAAba();

        await waitFor(() => {
            expect(getAllDeals).toHaveBeenCalled();
        });
    });

    it('dado FRESCO (< staleTime) ⇒ NÃO busca, para não competir com o otimismo (AC5)', async () => {
        montarComCacheDe(DOIS_MINUTOS / 4); // 30s: ela acabou de mover um card
        expect(getAllDeals).not.toHaveBeenCalled();

        await voltarParaAAba();

        // Espera de propósito: um refetch indevido apareceria neste intervalo.
        await act(async () => {
            await new Promise(r => setTimeout(r, 50));
        });

        expect(getAllDeals).not.toHaveBeenCalled();
    });
});
