/**
 * POST /api/ai/pontuar-lead
 *
 * Story 2.42 — **o disparo SOB DEMANDA.** Chamado pelo trigger do banco, via
 * `pg_net`, no instante em que o card entra num estágio com `pontua_lead`.
 *
 * ============================================================================
 * POR QUE ESTE ENDPOINT EXISTE
 * ============================================================================
 * A 2.41 consertou o sangramento (fila com contador de tentativas) mas manteve o
 * polling: 12 rodadas/hora, 24h/dia, para uma fila que só enche em horário
 * comercial — 2/3 das rodadas rodavam quando ninguém arrastava card nenhum.
 *
 * Agora quem chama é o evento. Uma entrada na coluna = uma chamada, no segundo
 * em que acontece, em vez de esperar até 5 minutos pela próxima varredura.
 *
 * 📌 `GET /api/cron/pontuar-leads` continua existindo, mas mudou de papel: virou
 *    a **rede de segurança diária**, que só cata o disparo que se perdeu.
 *    Os dois entram pela MESMA função (`processarItemDaFila`) — duas
 *    implementações do mesmo trabalho é o defeito da story 2.29.
 *
 * Protegido pelo mesmo `CRON_SECRET` do cron: o trigger manda o segredo do vault.
 */

import { createClient } from '@supabase/supabase-js';
import { itemElegivelParaRodada, type StatusDaFila } from '@/lib/ai/scoring/filaDePontuacao';
import { processarItemDaFila } from '@/lib/ai/scoring/processarItemDaFila';
import { resgatarItensPresos } from '@/lib/ai/scoring/resgatarItensPresos';

/**
 * 60s: a pontuação leva 6,0s em média (p99 16s, medido no console do Google em
 * 16/08). O `pg_net` do lado do banco espera 30s (`timeout_milliseconds`), então
 * este teto é folgado de propósito — quem corta primeiro é o chamador.
 */
export const maxDuration = 60;

function json<T>(body: T, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8' },
    });
}

export async function POST(request: Request) {
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = request.headers.get('authorization');
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
        return json({ error: 'Unauthorized' }, 401);
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) return json({ error: 'Server misconfigured' }, 500);

    let itemId: unknown;
    try {
        const body = (await request.json()) as { item_id?: unknown };
        itemId = body?.item_id;
    } catch {
        return json({ error: 'Body inválido: esperado JSON com item_id' }, 400);
    }

    if (typeof itemId !== 'string' || itemId.length === 0) {
        return json({ error: 'item_id ausente ou inválido' }, 400);
    }

    // Service role: o trigger não tem sessão. Toda query filtra `organization_id`
    // explicitamente — defense-in-depth, porque a RLS não protege aqui.
    const supabase = createClient(url, serviceKey);

    // Story 2.43 — o resgate pega carona no tráfego real. É isto que o torna
    // RÁPIDO na prática: qualquer lead novo entrando em `Qualificado` já devolve
    // à fila o que ficou preso, sem esperar a rede diária.
    //
    // Um `UPDATE` que em regime normal afeta ZERO linhas — e que nunca lança, para
    // não derrubar a pontuação por causa da faxina.
    const resgate = await resgatarItensPresos(supabase);

    const { data: item, error: erroItem } = await supabase
        .from('ai_pending_lead_scores')
        .select('id, deal_id, organization_id, attempts, status')
        .eq('id', itemId)
        .maybeSingle();

    if (erroItem) {
        console.error('[pontuar-lead] erro ao ler o item da fila:', erroItem);
        return json({ error: 'Internal server error' }, 500);
    }

    // 404 e não 500: item inexistente é entrada inválida, não defeito do servidor.
    if (!item) {
        return json({ error: 'Item não encontrado na fila' }, 404);
    }

    // O item ainda vale a pena? Espelha o filtro da rede de segurança. Um item já
    // `completed`, `failed` ou estourado no teto **não** pode virar chamada de IA
    // só porque alguém repetiu o POST.
    if (!itemElegivelParaRodada({ status: item.status as StatusDaFila, attempts: item.attempts })) {
        return json({
            ok: true,
            desfecho: 'ignorado',
            motivo: `item não elegível (status=${item.status}, attempts=${item.attempts})`,
            resgate,
        });
    }

    const resultado = await processarItemDaFila(supabase, {
        id: item.id,
        deal_id: item.deal_id,
        organization_id: item.organization_id,
        attempts: item.attempts,
    });

    // 200 mesmo quando o desfecho é `falhou`: a falha JÁ ficou registrada na fila
    // (`last_error` + `attempts`), que é onde ela precisa estar. Devolver 5xx aqui
    // só faria o `pg_net` guardar um erro que ninguém lê — o mesmo silêncio que
    // escondeu o problema de 13–16/08.
    return json({ ok: true, itemId: item.id, dealId: item.deal_id, ...resultado, resgate });
}
