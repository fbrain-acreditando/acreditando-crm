/**
 * @fileoverview Fila de atendimento — Bloco A do painel (story 2.19)
 *
 * Chama a RPC `get_fila_de_atendimento()`: o que a Fernanda faz AGORA.
 *
 * ⚠️ Diferente do Bloco B, este hook **não recebe período**. Fila de trabalho é
 * sempre "agora" — filtrar por "mês passado" produziria um número que ninguém
 * pode usar, porque ninguém liga hoje para quem espera desde julho por causa de
 * um seletor de data.
 *
 * @module lib/query/hooks/useFilaDeAtendimentoQuery
 */

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { queryKeys } from '../queryKeys';
import { supabase } from '@/lib/supabase';

// =============================================================================
// Types
// =============================================================================

export interface FilaDeAtendimento {
    /** Conversas que já saíram da IA (base da fila). */
    transferidas: number;
    /** Dessas, as em que o LEAD falou por último: a resposta está com ela. */
    esperandoPorMim: number;
    /** Das que esperam, as que passaram do limite de horas. */
    passouDoLimite: number;
    /** O limite usado (24h — critério dela, dito em 11/08). */
    horasDoLimite: number;
    /**
     * Story 2.48 — o recorte que ela pediu em 21/08: só quem tem card numa
     * etapa que conta como fila de trabalho.
     *
     * ⚠️ NÃO substitui `esperandoPorMim`. Aquela chave já circulou em reunião;
     * trocar o significado mantendo o nome faria alguém comparar o número de
     * hoje com o de ontem e concluir que a fila despencou.
     */
    esperandoNoFunil: number;
    /** Dos que estão no funil, os que passaram do limite de horas. */
    passouDoLimiteNoFunil: number;
    /** Espera em card que NÃO é fila (Ganho, Perdido, colunas de categoria). */
    foraDoFunil: number;
    /** Espera em conversa que nunca virou card no CRM. */
    semCard: number;
    /** Cards que batem os DOIS critérios dela: SP capital + roteiro completo. */
    prontosParaLigar: number;
    /**
     * Quantos cards a IA da story 2.35 chegou a pontuar.
     *
     * É o **denominador** de `prontosParaLigar` e vai para a tela: a IA só
     * pontua quem entra em `Qualificado`, então esse número nunca fala sobre a
     * base inteira.
     */
    pontuadosPelaIa: number;
    /** Total de cards vivos — o outro lado do denominador. */
    cardsVivos: number;
}

// =============================================================================
// Hook
// =============================================================================

export function useFilaDeAtendimentoQuery() {
    const { profile } = useAuth();
    const orgId = profile?.organization_id;

    return useQuery({
        queryKey: queryKeys.filaDeAtendimento.byOrg(orgId ?? ''),
        queryFn: async (): Promise<FilaDeAtendimento> => {
            const { data, error } = await supabase.rpc('get_fila_de_atendimento', {
                p_org_id: orgId!,
            });

            if (error) throw error;
            return data as FilaDeAtendimento;
        },
        enabled: !!orgId,
        // Mais curto que o Bloco B (60s) de propósito: o Bloco B é fechamento de
        // período e quase não muda; este é fila viva, e um número de fila velho
        // manda ligar para quem já respondeu.
        staleTime: 30_000,
        gcTime: 5 * 60_000,
    });
}
