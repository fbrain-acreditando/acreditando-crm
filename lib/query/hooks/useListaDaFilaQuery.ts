/**
 * @fileoverview A lista da fila — o que o clique no card abre (story 2.48)
 *
 * Chama a RPC `get_lista_da_fila()`: **quem** está esperando resposta, com o
 * texto real da última mensagem do lead.
 *
 * 🔑 Por que este hook existe: em 21/08 a Fernanda não escolheu entre as duas
 * definições que eu levei para o card "Esperando minha resposta". Ela pediu
 * outra coisa — *"na hora que você clicar aqui, você vai ver quem são as
 * pessoas"* e *"eu fico tentando adivinhar"*. O incômodo nunca foi a contagem:
 * era o número não abrir.
 *
 * ⚠️ `enabled` é controlado por quem chama (`habilitado`). A lista só sai do
 * banco quando alguém realmente abre — carregar 200 linhas junto com o painel
 * para mostrar um número de dois dígitos seria pagar a consulta em toda visita.
 *
 * @module lib/query/hooks/useListaDaFilaQuery
 */

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { queryKeys } from '../queryKeys';
import { supabase } from '@/lib/supabase';

// =============================================================================
// Types
// =============================================================================

/** Uma pessoa esperando resposta. */
export interface ItemDaFilaDeEspera {
    conversationId: string;
    contactId: string | null;
    /** `null` quando a conversa não virou card no CRM. */
    dealId: string | null;
    nome: string;
    telefone: string | null;
    /** `null` quando não há card. */
    etapa: string | null;
    ordem: number | null;
    /** A conversa nunca virou card. Medido em 24/08: 23 casos, quase todos de julho. */
    semCard: boolean;
    /** Tem card, mas numa etapa que não é fila de trabalho (Ganho, Perdido, categorias). */
    foraDoFunil: boolean;
    ultimaMensagemEm: string;
    horasEsperando: number;
    passouDoLimite: boolean;
    /** `text` | `audio` | `image` | … — áudio e imagem não têm texto para ler. */
    tipo: string;
    /** A última mensagem DO LEAD, até 180 caracteres. Pode vir vazia em mídia. */
    texto: string | null;
}

// =============================================================================
// Hook
// =============================================================================

export interface OpcoesDaLista {
    /** Só etapas que contam como fila de trabalho. Default `true` (pedido dela). */
    apenasFunil?: boolean;
    /**
     * Inclui as conversas que nunca viraram card.
     *
     * ⚠️ Tem de acompanhar o que o CARD conta. Se o card mostra 58 e a lista
     * abre 81, o painel se contradiz sozinho na frente de quem usa — e a
     * confiança no número não volta.
     */
    incluiSemCard?: boolean;
    /** Carrega de fato? A lista é cara; só busca quando alguém abre. */
    habilitado?: boolean;
}

export function useListaDaFilaQuery({
    apenasFunil = true,
    incluiSemCard = true,
    habilitado = false,
}: OpcoesDaLista = {}) {
    const { profile } = useAuth();
    const orgId = profile?.organization_id;

    return useQuery({
        queryKey: queryKeys.listaDaFila.byOrg(orgId ?? '', apenasFunil, incluiSemCard),
        queryFn: async (): Promise<ItemDaFilaDeEspera[]> => {
            const { data, error } = await supabase.rpc('get_lista_da_fila', {
                p_org_id: orgId!,
                p_apenas_funil: apenasFunil,
                p_inclui_sem_card: incluiSemCard,
            });

            if (error) throw error;
            // A RPC devolve `[]` quando não há ninguém — nunca `null`. O
            // `?? []` cobre o caso de a coluna vir nula por defeito de dados,
            // que travaria o `.map` da tela.
            return (data ?? []) as ItemDaFilaDeEspera[];
        },
        enabled: !!orgId && habilitado,
        // Mesmo tempo dos números do Bloco A: os dois descrevem o mesmo instante,
        // e prazos diferentes fariam a lista contradizer o card que a abriu.
        staleTime: 30_000,
        gcTime: 5 * 60_000,
    });
}
