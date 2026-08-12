/**
 * @fileoverview Métricas de atendimento — Bloco B do painel (story 2.19)
 *
 * Chama a RPC `get_metricas_de_atendimento()`: os números que a Fernanda
 * apresenta à diretoria. Substituem o painel de venda recorrente que veio do
 * fork e que ela leu na tela como *"Eita, que vão controlar minha vida agora"*.
 *
 * @module lib/query/hooks/useMetricasDeAtendimentoQuery
 */

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { queryKeys } from '../queryKeys';
import { supabase } from '@/lib/supabase';
import type { PeriodFilter } from '@/features/dashboard/hooks/useDashboardMetrics';
import { periodToDateRange } from '@/lib/utils/periodToDateRange';

// =============================================================================
// Types
// =============================================================================

export interface MetricasDeAtendimento {
    /** Conversas em que o LEAD mandou a primeira mensagem. */
    chegaram: number;
    /** Conversas em que a EQUIPE mandou a primeira mensagem. */
    euAbordei: number;
    /** Conversas que a IA transferiu — daí em diante o atendimento é humano. */
    chegaramAteMim: number;
    /** Chegaram e nunca foram transferidas: a IA deu conta sozinha. */
    resolvidosSemMim: number;
    /** Chegaram e não tiveram NENHUMA resposta — nem da IA. */
    semResposta: number;
    ganhos: number;
    perdidos: number;
    /**
     * Data da primeira conversa registrada nesta organização.
     *
     * O painel escreve isso na tela: o CRM só passa a existir em 24/07, e um
     * período anterior devolveria zero **parecendo resposta**. Julho ainda é
     * pior — a story 2.24 apagou fisicamente os deals do mês, então julho existe
     * em conversa e não existe em card.
     */
    coberturaDesde: string | null;
}

// =============================================================================
// Hook
// =============================================================================

export function useMetricasDeAtendimentoQuery(period: PeriodFilter) {
    const { profile } = useAuth();
    const orgId = profile?.organization_id;

    return useQuery({
        queryKey: queryKeys.metricasDeAtendimento.byPeriod(orgId ?? '', period),
        queryFn: async (): Promise<MetricasDeAtendimento> => {
            const { start, end } = periodToDateRange(period);

            const { data, error } = await supabase.rpc('get_metricas_de_atendimento', {
                p_org_id: orgId!,
                p_start_date: start,
                p_end_date: end,
            });

            if (error) throw error;
            return data as MetricasDeAtendimento;
        },
        enabled: !!orgId,
        staleTime: 60_000,
        gcTime: 5 * 60_000,
    });
}
