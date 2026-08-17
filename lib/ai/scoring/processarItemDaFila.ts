/**
 * @fileoverview Story 2.42 — pontuar UM item da fila. A lógica mora aqui, e só aqui.
 *
 * ## Por que este módulo existe
 *
 * A 2.42 criou um segundo caminho para o mesmo trabalho: o disparo por evento
 * (`POST /api/ai/pontuar-lead`, chamado pelo trigger via `pg_net`) e a rede de
 * segurança diária (`GET /api/cron/pontuar-leads`). **Duas implementações do
 * mesmo trabalho é o defeito que a story 2.29 passou o dia consertando** — havia
 * três traduções manuais do mesmo registro, e o que ficava de fora guardava o
 * valor velho.
 *
 * Então os dois caminhos entram por esta função. O que muda entre eles é apenas
 * **quem escolhe os itens**, nunca o que se faz com cada um.
 *
 * As REGRAS puras (teto de tentativas, dispensa) continuam em `filaDePontuacao.ts`,
 * sem I/O e sob teste. Aqui fica o I/O.
 *
 * @module lib/ai/scoring/processarItemDaFila
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getOrgAIConfig } from '@/lib/ai/agent/agent.service';
import { pontuarLead } from '@/lib/ai/scoring/pontuarLead';
import { orderConversationWindow } from '@/lib/ai/extraction/conversationWindow';
import {
    decidirDesfechoDaTentativa,
    motivoParaDispensar,
} from '@/lib/ai/scoring/filaDePontuacao';

/** Quantas mensagens da conversa vão para o modelo. Média medida: 30. */
const MAX_MENSAGENS = 60;

/** Texto que vai para `last_error` quando o card é dispensado (não é falha). */
const MOTIVO_DA_DISPENSA = {
    deal_inexistente: 'dispensado: deal inexistente ou excluído',
    ja_pontuado: 'dispensado: já pontuado (uma entrada, uma avaliação)',
    nota_manual: 'dispensado: nota manual é intocável (AC3 da 2.35)',
    saiu_da_coluna: 'dispensado: saiu da coluna de pontuação antes da rodada',
} as const;

export interface ItemDaFila {
    id: string;
    deal_id: string;
    organization_id: string;
    attempts: number;
}

export type Desfecho =
    /** A IA leu a conversa e a nota foi gravada. */
    | 'pontuado'
    /** O card não merecia mais nota (saiu da coluna, nota manual, já pontuado…). */
    | 'dispensado'
    /** Tentativa consumida. Na terceira, o item vira `failed` e sai da fila. */
    | 'falhou'
    /** Falha de AMBIENTE: chave de IA ausente. **Não** consome tentativa. */
    | 'sem_chave'
    /** Outra execução pegou o item primeiro (lock otimista). Nada foi feito. */
    | 'ignorado';

export interface ResultadoDoItem {
    desfecho: Desfecho;
    motivo?: string;
}

/**
 * Cache de config de IA por organização, para o caminho em lote.
 * O caminho sob demanda processa um item só e passa `undefined`.
 */
export type CacheDeConfig = Map<string, Awaited<ReturnType<typeof getOrgAIConfig>>>;

/**
 * Pontua um item da fila, do lock ao carimbo.
 *
 * Não lança: todo caminho de erro vira um `ResultadoDoItem` **e** um registro na
 * fila. ⚠️ `console.error` foi o que escondeu o problema de 13–16/08 por três
 * dias — em produção ninguém lê.
 */
export async function processarItemDaFila(
    supabase: SupabaseClient,
    item: ItemDaFila,
    cacheDeConfig?: CacheDeConfig
): Promise<ResultadoDoItem> {
    /**
     * Registra a falha NA FILA — não só no console.
     *
     * `consomeTentativa: false` é para falha de AMBIENTE (chave de IA ausente):
     * o card não tem culpa, e queimar as 3 tentativas dele faria com que repor a
     * chave encontrasse a fila inteira morta.
     */
    async function registrarFalha(motivo: string, consomeTentativa = true) {
        const desfecho = decidirDesfechoDaTentativa(item.attempts, consomeTentativa);

        const { error } = await supabase
            .from('ai_pending_lead_scores')
            .update({
                status: desfecho.status,
                attempts: desfecho.attempts,
                last_error: motivo,
                // Story 2.43 — saiu de `processing`, o carimbo da trava vai junto.
                processing_since: null,
                ...(desfecho.encerrado ? { processed_at: new Date().toISOString() } : {}),
            })
            .eq('id', item.id);

        if (error) {
            // Se nem a contabilidade da falha grava, isso PRECISA aparecer: é o
            // caminho que, calado, recriaria o laço infinito.
            console.error(
                `[pontuar-lead] NÃO consegui registrar a falha do item ${item.id}:`,
                error.message
            );
        }
    }

    /** Fecha o item como resolvido — pontuado ou dispensado. */
    async function marcarConcluido(motivo?: string) {
        const { error } = await supabase
            .from('ai_pending_lead_scores')
            .update({
                status: 'completed',
                processed_at: new Date().toISOString(),
                // Story 2.43 — saiu de `processing`, o carimbo da trava vai junto.
                processing_since: null,
                ...(motivo ? { last_error: motivo } : {}),
            })
            .eq('id', item.id);

        if (error) {
            console.error(`[pontuar-lead] NÃO consegui fechar o item ${item.id}:`, error.message);
        }
    }

    try {
        // Lock otimista: só processa quem ainda está `pending`.
        //
        // ⚠️ Na 2.42 este lock ficou MAIS importante: agora há dois caminhos que
        // podem alcançar o mesmo item — o disparo por evento e a rede de segurança
        // diária. Sem ele, um item pego pelos dois pagaria a IA duas vezes.
        const { data: travado, error: erroLock } = await supabase
            .from('ai_pending_lead_scores')
            // Story 2.43 — `processing_since` no MESMO UPDATE que trava, nunca em
            // passo separado: a janela entre dois passos é exatamente o caso que
            // o resgate precisa cobrir.
            .update({ status: 'processing', processing_since: new Date().toISOString() })
            .eq('id', item.id)
            .eq('status', 'pending')
            .select('id');

        if (erroLock || !travado || travado.length === 0) {
            return { desfecho: 'ignorado', motivo: 'outro caminho pegou o item primeiro' };
        }

        // --- o card ainda merece nota? ---
        //
        // Entre o enfileiramento e agora, a Fernanda pode ter arrastado o card
        // para FORA da coluna, dado a nota na mão, ou excluído o lead. Pontuar
        // nesse caso é gastar IA para escrever o que ninguém quer.
        const { data: deal } = await supabase
            .from('deals')
            .select('id, contact_id, stage_id, pontuada_pela_ia_em, lead_score_source')
            .eq('id', item.deal_id)
            .eq('organization_id', item.organization_id)
            .is('deleted_at', null)
            .maybeSingle();

        // Ainda está em estágio que pontua? Por COLUNA, nunca por nome (2.33).
        let emEstagioQuePontua = false;
        if (deal) {
            const { data: stage } = await supabase
                .from('board_stages')
                .select('pontua_lead')
                .eq('id', deal.stage_id)
                .maybeSingle();
            emEstagioQuePontua = stage?.pontua_lead === true;
        }

        // Dispensa NÃO é falha: fecha o item e não consome tentativa.
        const dispensa = motivoParaDispensar({
            existe: Boolean(deal),
            jaPontuado: Boolean(deal?.pontuada_pela_ia_em),
            notaManual: deal?.lead_score_source === 'manual',
            emEstagioQuePontua,
        });

        if (dispensa) {
            await marcarConcluido(MOTIVO_DA_DISPENSA[dispensa]);
            return { desfecho: 'dispensado', motivo: MOTIVO_DA_DISPENSA[dispensa] };
        }

        if (!deal) {
            // Inalcançável: `motivoParaDispensar` devolve 'deal_inexistente' antes
            // daqui. Fica como narrowing para o TypeScript e como rede de segurança
            // — item nenhum pode ficar preso em `processing`.
            await marcarConcluido('deal ausente (caminho inalcançável)');
            return { desfecho: 'dispensado', motivo: 'deal ausente' };
        }

        // --- config de IA da org ---
        let aiConfig = cacheDeConfig?.get(item.organization_id);
        if (!aiConfig) {
            aiConfig = await getOrgAIConfig(supabase, item.organization_id);
            cacheDeConfig?.set(item.organization_id, aiConfig);
        }

        if (!aiConfig?.apiKey) {
            // Falha de AMBIENTE: não queima tentativa (ver `registrarFalha`).
            await registrarFalha('IA não configurada (chave ausente)', false);
            return { desfecho: 'sem_chave', motivo: 'IA não configurada' };
        }

        // --- conversa do contato ---
        const { data: conversas } = await supabase
            .from('messaging_conversations')
            .select('id')
            .eq('contact_id', deal.contact_id)
            .eq('organization_id', item.organization_id);

        const ids = (conversas ?? []).map(c => c.id);
        if (ids.length === 0) {
            await registrarFalha('sem conversa associada ao contato');
            return { desfecho: 'falhou', motivo: 'sem conversa' };
        }

        // Seleciona o que `orderConversationWindow` precisa: ela ordena por
        // `sent_at ?? created_at` (o instante em que foi DITA, não em que chegou)
        // e descarta reações por `content_type`.
        const { data: mensagens } = await supabase
            .from('messaging_messages')
            .select('id, direction, content, content_type, created_at, sent_at')
            .in('conversation_id', ids)
            // As MAIS RECENTES, e depois reordenadas em ordem cronológica. Pegar as
            // mais ANTIGAS foi o defeito corrigido em 03/08 na extração de campos:
            // o trecho de qualificação vem no FIM do roteiro.
            .order('created_at', { ascending: false })
            .limit(MAX_MENSAGENS);

        const janela = orderConversationWindow(mensagens ?? []);

        const texto = janela
            .map(m => {
                const quem = m.direction === 'inbound' ? 'Lead' : 'Atendimento';
                const c = (m.content ?? {}) as { text?: string; caption?: string; type?: string };
                const corpo = c.text ?? c.caption ?? `[${c.type ?? 'mídia'}]`;
                return `${quem}: ${corpo}`;
            })
            .join('\n');

        if (!texto.trim()) {
            await registrarFalha('conversa sem texto legível');
            return { desfecho: 'falhou', motivo: 'conversa sem texto' };
        }

        const nota = await pontuarLead(texto, aiConfig);

        const { data: gravado, error: erroUpdate } = await supabase
            .from('deals')
            .update({
                lead_score: nota.score,
                lead_score_known: nota.known,
                lead_score_source: 'auto',
                lead_score_detail: {
                    itens: nota.itens,
                    origem: 'ia:pontuarLead',
                    // Mantém a forma que o painel já lê (story 2.18 AC5).
                    matched: nota.itens.filter(i => i.atende === 1).map(i => i.id),
                    refuted: nota.itens.filter(i => i.atende === 0).map(i => i.id),
                    unknown: [],
                },
                pontuada_pela_ia_em: new Date().toISOString(),
                lead_score_updated_at: new Date().toISOString(),
            })
            .eq('id', item.deal_id)
            .eq('organization_id', item.organization_id)
            // Corrida: se a Fernanda definiu a nota na mão entre a leitura da fila
            // e esta escrita, a dela ganha (AC3 da 2.35).
            .neq('lead_score_source', 'manual')
            // Read-back (Rule 7): sem `.select()`, o PostgREST responde OK mesmo
            // quando ZERO linhas mudaram — e "respondeu OK" não é "está feito".
            // Era por aqui que a IA podia ser paga e a nota não aparecer.
            .select('id');

        if (erroUpdate) {
            await registrarFalha(`erro ao gravar a nota: ${erroUpdate.message}`);
            return { desfecho: 'falhou', motivo: erroUpdate.message };
        }

        if (!gravado || gravado.length === 0) {
            // A IA foi paga e a nota não entrou. Sem contar tentativa, este é
            // exatamente o card que giraria para sempre.
            await registrarFalha('UPDATE afetou 0 linhas (nota manual em corrida ou RLS)');
            return { desfecho: 'falhou', motivo: 'update afetou 0 linhas' };
        }

        await marcarConcluido();
        return { desfecho: 'pontuado' };
    } catch (e) {
        // Um card que falha não derruba a rodada — mas ele CONTA a tentativa e sai
        // da fila na terceira. Era essa a diferença que custou R$ 197,83.
        const motivo = (e as Error).message;
        console.error(`[pontuar-lead] falha no deal ${item.deal_id}:`, e);
        await registrarFalha(motivo);
        return { desfecho: 'falhou', motivo };
    }
}
