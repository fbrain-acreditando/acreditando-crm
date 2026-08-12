/**
 * GET /api/cron/pontuar-leads
 *
 * Story 2.35 — drena a fila de leads a pontuar.
 *
 * ⏱️ CADÊNCIA: a cada 5 minutos. A nota aparece em até 5 min depois de o card
 *    entrar em `Qualificado`, não instantaneamente.
 *
 * 🏛 POR QUE FILA POR ESTADO, E NÃO GATILHO NO WEBHOOK:
 *    pendurar a pontuação no webhook do GPT Maker pegaria só a transferência
 *    automática. A Fernanda **arrasta** cards para `Qualificado` o dia inteiro, e
 *    esse caminho ficaria de fora. A fila é uma VIEW sobre o board
 *    (`v_leads_a_pontuar`), então todo caminho de entrada conta — e uma falha se
 *    auto-corrige na rodada seguinte, sem fila persistente para ficar suja.
 *
 * Protegido por CRON_SECRET, mesmo contrato de `/api/cron/stage-evaluations`.
 */

import { createClient } from '@supabase/supabase-js';
import { getOrgAIConfig } from '@/lib/ai/agent/agent.service';
import { pontuarLead } from '@/lib/ai/scoring/pontuarLead';
import { orderConversationWindow } from '@/lib/ai/extraction/conversationWindow';

export const maxDuration = 300;

/** Teto por rodada: uma chamada de IA por card, e o cron roda de 5 em 5 min. */
const MAX_POR_RODADA = 10;

/** Quantas mensagens da conversa vão para o modelo. Média medida: 30. */
const MAX_MENSAGENS = 60;

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

    const { data: fila, error: erroFila } = await supabase
        .from('v_leads_a_pontuar')
        .select('deal_id, organization_id, contact_id')
        .limit(MAX_POR_RODADA);

    if (erroFila) {
        console.error('[pontuar-leads] erro ao ler a fila:', erroFila);
        return json({ error: 'Internal server error' }, 500);
    }

    if (!fila || fila.length === 0) {
        return json({ ok: true, pontuados: 0, mensagem: 'Fila vazia.' });
    }

    const configPorOrg = new Map<string, Awaited<ReturnType<typeof getOrgAIConfig>>>();
    let pontuados = 0;
    const falhas: string[] = [];

    for (const item of fila) {
        try {
            if (!configPorOrg.has(item.organization_id)) {
                configPorOrg.set(
                    item.organization_id,
                    await getOrgAIConfig(supabase, item.organization_id)
                );
            }
            const aiConfig = configPorOrg.get(item.organization_id);
            if (!aiConfig?.apiKey) {
                falhas.push(`${item.deal_id}: IA não configurada`);
                continue;
            }

            // --- conversa do contato ---
            const { data: conversas } = await supabase
                .from('messaging_conversations')
                .select('id')
                .eq('contact_id', item.contact_id)
                .eq('organization_id', item.organization_id);

            const ids = (conversas ?? []).map(c => c.id);
            if (ids.length === 0) {
                falhas.push(`${item.deal_id}: sem conversa`);
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
                falhas.push(`${item.deal_id}: conversa sem texto`);
                continue;
            }

            const nota = await pontuarLead(texto, aiConfig);

            const { error: erroUpdate } = await supabase
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
                .neq('lead_score_source', 'manual');

            if (erroUpdate) {
                falhas.push(`${item.deal_id}: ${erroUpdate.message}`);
                continue;
            }

            pontuados++;
        } catch (e) {
            // Um card que falha não derruba a rodada, e ele volta para a fila na
            // próxima — a fila é derivada do estado, não consumida.
            console.error(`[pontuar-leads] falha no deal ${item.deal_id}:`, e);
            falhas.push(`${item.deal_id}: ${(e as Error).message}`);
        }
    }

    return json({ ok: true, pontuados, naFila: fila.length, falhas });
}
