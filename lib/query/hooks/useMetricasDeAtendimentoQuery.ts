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

/** Um estágio do funil, com quantos leads do período estão nele. */
export interface EstagioDoFunil {
    estagio: string;
    ordem: number;
    leads: number;
}

export interface MetricasDeAtendimento {
    /**
     * Deals CRIADOS no período. É esta a definição de "lead" no topo do painel
     * (decisão do Filipe, 19/08) — e é por isso que `coberturaDealsDesde` existe.
     */
    totalLeads: number;
    /**
     * Conversas em que o LEAD mandou a primeira mensagem.
     *
     * ⚠️ Rotulado "Leads que chegaram no WhatsApp", **não** "Leads de anúncio":
     * não existe atribuição de anúncio nesta base — os 5 canais são `whatsapp`,
     * a tabela `leads` está vazia e `contacts.source` tem um valor único.
     */
    chegaram: number;
    /** Conversas em que a EQUIPE mandou a primeira mensagem (leads orgânicos). */
    euAbordei: number;
    /** Conversas que a IA transferiu — daí em diante o atendimento é humano. */
    chegaramAteMim: number;
    /** Chegaram e não tiveram NENHUMA resposta — nem da IA. */
    semResposta: number;
    /**
     * Mensagens de saída atribuídas à IA no período — **estimativa**, não medição.
     *
     * A origem (GPT Maker) não marca autoria por mensagem: medido em 19/08, a
     * mensagem da Fernanda chega com o mesmo `role: assistant` e o mesmo
     * `assistantId` da IA. O corte usado é a transferência: antes dela (ou em
     * conversa nunca transferida) conta como IA. O card declara isso na tela.
     */
    msgsIa: number;
    /** Mensagens de saída após a transferência — a pessoa que assumiu. Ver `msgsIa`. */
    msgsPessoa: number;
    /** Leads por estágio do funil, no mesmo período. */
    funil: EstagioDoFunil[];
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
    /**
     * Data do deal mais antigo vivo — a cobertura do "Total de Leads".
     *
     * É **mais curta** que `coberturaDesde`: medido em 19/08, os 491 deals vivos
     * foram TODOS criados em agosto, porque a story 2.24 apagou fisicamente os de
     * julho. Sem escrever isso na tela, um período em julho devolve `0` parecendo
     * medição — e zero que parece resposta é pior que ausência de resposta.
     */
    coberturaDealsDesde: string | null;
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
