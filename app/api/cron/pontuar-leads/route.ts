/**
 * GET /api/cron/pontuar-leads
 *
 * Story 2.35 — pontua o lead que entrou em `Qualificado`.
 * Story 2.41 — drena uma FILA, não varre o board.
 * Story 2.42 — **deixa de ser o motor e vira a REDE DE SEGURANÇA, 1× por dia.**
 *
 * ============================================================================
 * ⚠️ O QUE MUDOU, E POR QUE (custou R$ 197,83)
 * ============================================================================
 * Na 2.35 este endpoint lia uma VIEW derivada do estado, de 5 em 5 minutos. Card
 * que FALHAVA não recebia carimbo e **não contava tentativa**: voltava na rodada
 * seguinte, para sempre.
 *
 *   12 rodadas/hora × 24h = 288 rodadas/dia × 10 cards = 2.880 chamadas/dia
 *   O Google mediu ~3.000/dia, de 13/08 a 16/08 02:00 (quando a chave caiu).
 *
 * A 2.41 pôs contador de tentativas. A 2.42 tirou o polling: **quem dispara o
 * trabalho agora é o trigger do banco**, via `pg_net`, no instante da entrada
 * (`POST /api/ai/pontuar-lead`).
 *
 * ============================================================================
 * ENTÃO POR QUE ESTE ARQUIVO AINDA EXISTE?
 * ============================================================================
 * Porque `pg_net` é fire-and-forget: se o POST falhar — app em cold start, deploy
 * no meio, 500, timeout —, **nada tenta de novo**. Sem uma rede, trocar polling
 * por evento trocaria *"gasta demais"* por *"perde em silêncio"* — a classe de
 * defeito que mordeu este repo três vezes só em agosto.
 *
 * Então: **1 rodada por dia**, agindo só sobre quem ficou para trás. Em dia sem
 * falha, processa **zero**. De 288 rodadas/dia para 1.
 *
 * 📌 A pontuação de cada item vive em `processarItemDaFila` — a MESMA função que
 *    o disparo por evento usa. Duas implementações do mesmo trabalho é o defeito
 *    que a story 2.29 passou o dia consertando.
 *
 * Protegido por CRON_SECRET, mesmo contrato de `/api/cron/stage-evaluations`.
 */

import { createClient } from '@supabase/supabase-js';
import { MAX_TENTATIVAS } from '@/lib/ai/scoring/filaDePontuacao';
import {
    processarItemDaFila,
    type CacheDeConfig,
    type Desfecho,
} from '@/lib/ai/scoring/processarItemDaFila';

export const maxDuration = 300;

/**
 * Teto por rodada.
 *
 * ⚠️ O limite aqui **não** é de custo — é de RELÓGIO. Cada item leva ~6s (p99
 * 16s) e `maxDuration` é 300s. Pedir 50 de uma vez faria a função morrer no meio,
 * deixando itens presos em `processing` — de onde nada os resgata.
 */
const MAX_POR_RODADA = 25;

/**
 * Para de pegar item novo quando faltam ~60s do teto da função.
 *
 * Sair pela porta é diferente de morrer no meio: o que não foi processado
 * continua `pending` e a rodada de amanhã o pega. Sem esta guarda, o item que
 * estivesse em voo no segundo 300 ficaria `processing` para sempre.
 */
const ORCAMENTO_MS = (maxDuration - 60) * 1000;

function json<T>(body: T, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8' },
    });
}

export async function GET(request: Request) {
    const comecouEm = Date.now();

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
        // O caso NORMAL depois da 2.42: o evento deu conta de tudo.
        return json({ ok: true, pontuados: 0, mensagem: 'Nada ficou para trás.' });
    }

    const cacheDeConfig: CacheDeConfig = new Map();
    const contagem: Record<Desfecho, number> = {
        pontuado: 0,
        dispensado: 0,
        falhou: 0,
        sem_chave: 0,
        ignorado: 0,
    };
    const motivos: string[] = [];
    let naoAlcancados = 0;

    for (const item of fila) {
        if (Date.now() - comecouEm > ORCAMENTO_MS) {
            // O resto continua `pending`: amanhã a rodada o pega. Melhor um item
            // adiado do que um item preso em `processing`.
            naoAlcancados = fila.length - (contagem.pontuado + contagem.dispensado
                + contagem.falhou + contagem.sem_chave + contagem.ignorado);
            break;
        }

        const resultado = await processarItemDaFila(supabase, item, cacheDeConfig);
        contagem[resultado.desfecho]++;
        if (resultado.motivo && resultado.desfecho !== 'pontuado') {
            motivos.push(`${item.deal_id}: ${resultado.motivo}`);
        }
    }

    // O corpo da resposta é o que aparece no log da Vercel — e foi a falta dele
    // que fez a investigação de 16/08 concluir "o cron não está rodando" quando
    // ele rodava e falhava. Cada contador aqui responde uma pergunta diferente.
    return json({
        ok: true,
        papel: 'rede de seguranca diaria (story 2.42)',
        pontuados: contagem.pontuado,
        dispensados: contagem.dispensado,
        falhados: contagem.falhou,
        semChave: contagem.sem_chave,
        ignorados: contagem.ignorado,
        naoAlcancados,
        naFila: fila.length,
        motivos,
        duracaoMs: Date.now() - comecouEm,
    });
}
