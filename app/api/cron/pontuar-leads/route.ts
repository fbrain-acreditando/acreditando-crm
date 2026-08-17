/**
 * GET /api/cron/pontuar-leads
 *
 * Story 2.35 — pontua o lead que entrou em `Qualificado`.
 * Story 2.41 — **drena uma FILA, não varre o board.**
 *
 * ============================================================================
 * ⚠️ O QUE MUDOU NA 2.41, E POR QUE (custou R$ 197,83)
 * ============================================================================
 * Antes, este cron lia a VIEW `v_leads_a_pontuar` — derivada do estado do board.
 * Um card só saía dela ao receber o carimbo `pontuada_pela_ia_em`. Card que
 * FALHAVA não recebia carimbo e **não contava tentativa**: voltava na rodada
 * seguinte, para sempre. E a leitura não tinha `ORDER BY`, então os mesmos ~10
 * cards ocupavam todas as rodadas e os outros 20 nunca eram tentados.
 *
 *   12 rodadas/hora × 24h = 288 rodadas/dia × 10 cards = 2.880 chamadas/dia
 *   O Google mediu ~3.000/dia, de 13/08 a 16/08 02:00 (quando a chave caiu).
 *
 * O comentário original defendia isso como virtude — *"uma falha se auto-corrige
 * na rodada seguinte"*. Sem contador de tentativas, **"auto-corrigir" e
 * "reprocessar para sempre" são a mesma frase.**
 *
 * Agora: quem enfileira é um TRIGGER no banco, na ENTRADA da coluna (cobre a
 * Fernanda arrastando, a IA qualificando, os webhooks, a API pública e o MCP —
 * todos terminam no mesmo UPDATE de `deals.stage_id`). Este arquivo só drena,
 * com teto de 3 tentativas por card.
 *
 * 📌 `v_leads_a_pontuar` continua existindo, como DIAGNÓSTICO ("algum card ficou
 *    sem nota?"). Lê-la não dispara IA.
 *
 * Protegido por CRON_SECRET, mesmo contrato de `/api/cron/stage-evaluations`.
 */

import { createClient } from '@supabase/supabase-js';
import { getOrgAIConfig } from '@/lib/ai/agent/agent.service';
import { pontuarLead } from '@/lib/ai/scoring/pontuarLead';
import { orderConversationWindow } from '@/lib/ai/extraction/conversationWindow';
// As REGRAS da fila moram num módulo puro e testado (`filaDePontuacao.test.ts`).
// Duplicar a trava aqui é como o `15` da carência acabou em dois lugares.
import {
    MAX_TENTATIVAS,
    decidirDesfechoDaTentativa,
    motivoParaDispensar,
} from '@/lib/ai/scoring/filaDePontuacao';

export const maxDuration = 300;

/** Teto por rodada: uma chamada de IA por card. */
const MAX_POR_RODADA = 10;

/** Quantas mensagens da conversa vão para o modelo. Média medida: 30. */
const MAX_MENSAGENS = 60;

/** Texto que vai para `last_error` quando o card é dispensado (não é falha). */
const MOTIVO_DA_DISPENSA = {
    deal_inexistente: 'dispensado: deal inexistente ou excluído',
    ja_pontuado: 'dispensado: já pontuado (uma entrada, uma avaliação)',
    nota_manual: 'dispensado: nota manual é intocável (AC3 da 2.35)',
    saiu_da_coluna: 'dispensado: saiu da coluna de pontuação antes da rodada',
} as const;

function json<T>(body: T, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8' },
    });
}

export async function GET(request: Request) {
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = request.headers.get('authorization');
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
        return json({ error: 'Unauthorized' }, 401);
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) return json({ error: 'Server misconfigured' }, 500);

    // Service role: o cron não tem sessão. Toda query filtra `organization_id`
    // explicitamente — defense-in-depth, porque a RLS não protege aqui.
    const supabase = createClient(url, serviceKey);

    // A fila, em FIFO. `attempts < MAX_TENTATIVAS` é o que impede o laço infinito:
    // card que falhou 3 vezes já está `failed` e não volta mais.
    const { data: fila, error: erroFila } = await supabase
        .from('ai_pending_lead_scores')
        .select('id, deal_id, organization_id, attempts')
        .eq('status', 'pending')
        .lt('attempts', MAX_TENTATIVAS)
        .order('created_at', { ascending: true })
        .limit(MAX_POR_RODADA);

    if (erroFila) {
        console.error('[pontuar-leads] erro ao ler a fila:', erroFila);
        return json({ error: 'Internal server error' }, 500);
    }

    if (!fila || fila.length === 0) {
        return json({ ok: true, pontuados: 0, mensagem: 'Fila vazia.' });
    }

    /**
     * Registra a falha NA FILA — não só no console.
     *
     * ⚠️ `console.error` foi o que escondeu este problema por 3 dias: em produção
     * ninguém lê. Agora o motivo fica em `last_error`, e a 3ª tentativa encerra
     * o card em `failed` em vez de o deixar girando.
     *
     * `consomeTentativa: false` é para falha de AMBIENTE (chave de IA ausente):
     * o card não tem culpa, e queimar as 3 tentativas dele faria com que repor a
     * chave encontrasse a fila inteira morta.
     */
    async function registrarFalha(
        item: { id: string; attempts: number },
        motivo: string,
        consomeTentativa = true
    ) {
        const desfecho = decidirDesfechoDaTentativa(item.attempts, consomeTentativa);

        const { error } = await supabase
            .from('ai_pending_lead_scores')
            .update({
                status: desfecho.status,
                attempts: desfecho.attempts,
                last_error: motivo,
                ...(desfecho.encerrado ? { processed_at: new Date().toISOString() } : {}),
            })
            .eq('id', item.id);

        if (error) {
            // Se nem a contabilidade da falha grava, isso PRECISA aparecer: é o
            // caminho que, calado, recriaria o laço infinito.
            console.error(`[pontuar-leads] NÃO consegui registrar a falha do item ${item.id}:`, error.message);
        }
    }

    /** Fecha o item como resolvido — pontuado ou dispensado. */
    async function marcarConcluido(itemId: string, motivo?: string) {
        const { error } = await supabase
            .from('ai_pending_lead_scores')
            .update({
                status: 'completed',
                processed_at: new Date().toISOString(),
                ...(motivo ? { last_error: motivo } : {}),
            })
            .eq('id', itemId);

        if (error) {
            console.error(`[pontuar-leads] NÃO consegui fechar o item ${itemId}:`, error.message);
        }
    }

    const configPorOrg = new Map<string, Awaited<ReturnType<typeof getOrgAIConfig>>>();
    let pontuados = 0;
    let falhados = 0;
    let dispensados = 0;
    let semChave = 0;
    const falhas: string[] = [];

    for (const item of fila) {
        try {
            // Lock otimista: só processa quem ainda está `pending`. Se duas rodadas
            // se sobrepuserem (rodada anterior lenta), a segunda não repete o card
            // — repetir aqui é gastar IA duas vezes pelo mesmo lead.
            const { data: travado, error: erroLock } = await supabase
                .from('ai_pending_lead_scores')
                .update({ status: 'processing' })
                .eq('id', item.id)
                .eq('status', 'pending')
                .select('id');

            if (erroLock || !travado || travado.length === 0) {
                continue;
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
                dispensados++;
                await marcarConcluido(item.id, MOTIVO_DA_DISPENSA[dispensa]);
                continue;
            }

            if (!deal) {
                // Inalcançável: `motivoParaDispensar` devolve 'deal_inexistente'
                // antes daqui. Fica como narrowing para o TypeScript e como rede
                // de segurança — item nenhum pode ficar preso em `processing`.
                await marcarConcluido(item.id, 'deal ausente (caminho inalcançável)');
                continue;
            }

            // --- config de IA da org ---
            if (!configPorOrg.has(item.organization_id)) {
                configPorOrg.set(
                    item.organization_id,
                    await getOrgAIConfig(supabase, item.organization_id)
                );
            }
            const aiConfig = configPorOrg.get(item.organization_id);
            if (!aiConfig?.apiKey) {
                // Falha de AMBIENTE: não queima tentativa (ver `registrarFalha`).
                semChave++;
                falhas.push(`${item.deal_id}: IA não configurada`);
                await registrarFalha(item, 'IA não configurada (chave ausente)', false);
                continue;
            }

            // --- conversa do contato ---
            const { data: conversas } = await supabase
                .from('messaging_conversations')
                .select('id')
                .eq('contact_id', deal.contact_id)
                .eq('organization_id', item.organization_id);

            const ids = (conversas ?? []).map(c => c.id);
            if (ids.length === 0) {
                falhados++;
                falhas.push(`${item.deal_id}: sem conversa`);
                await registrarFalha(item, 'sem conversa associada ao contato');
                continue;
            }

            // Seleciona o que `orderConversationWindow` precisa: ela ordena por
            // `sent_at ?? created_at` (o instante em que foi DITA, não em que
            // chegou) e descarta reações por `content_type`. Selecionar menos e
            // resolver com cast esconderia as duas coisas.
            const { data: mensagens } = await supabase
                .from('messaging_messages')
                .select('id, direction, content, content_type, created_at, sent_at')
                .in('conversation_id', ids)
                // As MAIS RECENTES, e depois reordenadas em ordem cronológica.
                // Pegar as mais ANTIGAS foi o defeito corrigido em 03/08 na
                // extração de campos: o trecho de qualificação vem no FIM do
                // roteiro, e a janela nunca chegava nele.
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
                falhados++;
                falhas.push(`${item.deal_id}: conversa sem texto`);
                await registrarFalha(item, 'conversa sem texto legível');
                continue;
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
                // Corrida: se a Fernanda definiu a nota na mão entre a leitura da
                // fila e esta escrita, a dela ganha (AC3).
                .neq('lead_score_source', 'manual')
                // Read-back (Rule 7): sem `.select()`, o PostgREST responde OK mesmo
                // quando ZERO linhas mudaram — e "respondeu OK" não é "está feito".
                // Era por aqui que a IA podia ser paga e a nota não aparecer.
                .select('id');

            if (erroUpdate) {
                falhados++;
                falhas.push(`${item.deal_id}: ${erroUpdate.message}`);
                await registrarFalha(item, `erro ao gravar a nota: ${erroUpdate.message}`);
                continue;
            }

            if (!gravado || gravado.length === 0) {
                // A IA foi paga e a nota não entrou. Sem contar tentativa, este é
                // exatamente o card que giraria para sempre.
                falhados++;
                falhas.push(`${item.deal_id}: update afetou 0 linhas`);
                await registrarFalha(item, 'UPDATE afetou 0 linhas (nota manual em corrida ou RLS)');
                continue;
            }

            await marcarConcluido(item.id);
            pontuados++;
        } catch (e) {
            // Um card que falha não derruba a rodada — mas agora ele CONTA a
            // tentativa e sai da fila na terceira. Era essa a diferença.
            const motivo = (e as Error).message;
            console.error(`[pontuar-leads] falha no deal ${item.deal_id}:`, e);
            falhados++;
            falhas.push(`${item.deal_id}: ${motivo}`);
            await registrarFalha(item, motivo);
        }
    }

    // O corpo da resposta é o que aparece no log da Vercel — e foi a falta dele
    // que fez a investigação de 16/08 concluir "o cron não está rodando" quando
    // ele rodava e falhava. Cada contador aqui responde uma pergunta diferente.
    return json({
        ok: true,
        pontuados,
        falhados,
        dispensados,
        semChave,
        naFila: fila.length,
        falhas,
    });
}
