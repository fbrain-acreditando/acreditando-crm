/**
 * @fileoverview Backfill do dicionário de normalização (story 2.18b, AC4)
 *
 * Rota disparada à mão pelo Filipe. Existe porque a classificação precisa da
 * chave de IA da organização, que mora no banco — rodar isso de fora exigiria
 * tirar o segredo do lugar onde ele deve ficar.
 *
 * **Seguro para rodar duas vezes:** classifica apenas valores que ainda não
 * estão no dicionário. Reexecutar não gasta IA de novo e não desfaz correção
 * humana.
 *
 * @module app/api/admin/normalizar-criterios/route
 */

import { createClient } from '@/lib/supabase/server';
import { getOrgAIConfig } from '@/lib/ai/agent/agent.service';
import {
    classificarValores,
    emLotes,
} from '@/lib/ai/normalization/classificarValores';
import {
    CAMPOS_NORMALIZAVEIS,
    canonicalizarValor,
    type CampoNormalizavel,
} from '@/features/deals/criteriosNormalizados';

function json<T>(body: T, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8' },
    });
}

/** Teto por chamada: evita que um disparo acidental vire uma conta de IA grande. */
const MAX_VALORES_POR_EXECUCAO = 300;

export async function POST() {
    const supabase = await createClient();

    const {
        data: { user },
    } = await supabase.auth.getUser();
    if (!user) return json({ error: 'Unauthorized' }, 401);

    const { data: me, error: meError } = await supabase
        .from('profiles')
        .select('id, role, organization_id')
        .eq('id', user.id)
        .single();

    if (meError || !me?.organization_id) return json({ error: 'Profile not found' }, 404);
    if (me.role !== 'admin') return json({ error: 'Forbidden' }, 403);

    const orgId = me.organization_id;

    // ---------------------------------------------------------------------
    // 1. O que já está no dicionário
    // ---------------------------------------------------------------------
    const { data: jaClassificados, error: erroDic } = await supabase
        .from('normalizacao_de_criterio')
        .select('campo, chave')
        .eq('organization_id', orgId);

    if (erroDic) {
        console.error('[normalizar-criterios] erro ao ler dicionário:', erroDic);
        return json({ error: 'Internal server error' }, 500);
    }

    const conhecidos = new Set((jaClassificados ?? []).map(r => `${r.campo}::${r.chave}`));

    // ---------------------------------------------------------------------
    // 2. Valores distintos que os deals têm hoje
    // ---------------------------------------------------------------------
    const { data: deals, error: erroDeals } = await supabase
        .from('deals')
        .select('custom_fields')
        .eq('organization_id', orgId)
        .is('deleted_at', null);

    if (erroDeals) {
        console.error('[normalizar-criterios] erro ao ler deals:', erroDeals);
        return json({ error: 'Internal server error' }, 500);
    }

    // chave canônica → uma das grafias originais (para auditoria)
    const pendentes = new Map<string, { campo: CampoNormalizavel; chave: string; bruto: string }>();

    for (const d of deals ?? []) {
        const cf = (d.custom_fields ?? {}) as Record<string, unknown>;
        for (const campo of CAMPOS_NORMALIZAVEIS) {
            const bruto = cf[campo];
            if (typeof bruto !== 'string') continue;

            const chave = canonicalizarValor(bruto);
            if (!chave) continue;

            const id = `${campo}::${chave}`;
            if (conhecidos.has(id) || pendentes.has(id)) continue;

            pendentes.set(id, { campo, chave, bruto });
        }
    }

    const aClassificar = [...pendentes.values()].slice(0, MAX_VALORES_POR_EXECUCAO);

    if (aClassificar.length === 0) {
        return json({
            ok: true,
            mensagem: 'Nada a classificar — o dicionário já cobre todos os valores.',
            novos: 0,
            jaNoDicionario: conhecidos.size,
        });
    }

    // ---------------------------------------------------------------------
    // 3. Classificar, campo a campo, em lotes
    // ---------------------------------------------------------------------
    const aiConfig = await getOrgAIConfig(supabase, orgId);
    if (!aiConfig?.apiKey) {
        return json({ error: 'IA não configurada para esta organização' }, 400);
    }

    const linhas: Array<{
        organization_id: string;
        campo: string;
        chave: string;
        valor_bruto: string;
        rotulo: string;
        confianca: number;
        origem: string;
    }> = [];

    const falhas: string[] = [];

    for (const campo of CAMPOS_NORMALIZAVEIS) {
        const doCampo = aClassificar.filter(v => v.campo === campo);
        if (doCampo.length === 0) continue;

        for (const lote of emLotes(doCampo)) {
            try {
                const classificados = await classificarValores(
                    campo,
                    lote.map(v => v.bruto),
                    aiConfig
                );

                // Casar a resposta pela CHAVE canônica, não pela ordem nem pelo
                // texto exato: o modelo às vezes devolve o texto normalizado ou
                // reordenado, e casar por índice colocaria o rótulo no valor errado.
                for (const c of classificados) {
                    const chave = canonicalizarValor(c.valorBruto);
                    const original = lote.find(v => v.chave === chave);
                    if (!original) {
                        falhas.push(`${campo}: resposta não casou com nenhum valor enviado (${c.valorBruto})`);
                        continue;
                    }

                    linhas.push({
                        organization_id: orgId,
                        campo,
                        chave: original.chave,
                        valor_bruto: original.bruto,
                        rotulo: c.rotulo,
                        confianca: c.confianca,
                        origem: 'ia',
                    });
                }
            } catch (e) {
                // Um lote que falha não derruba os outros — o backfill é
                // re-executável e o que faltar entra na próxima chamada.
                console.error(`[normalizar-criterios] lote de ${campo} falhou:`, e);
                falhas.push(`${campo}: lote de ${lote.length} valores falhou`);
            }
        }
    }

    if (linhas.length === 0) {
        return json({ ok: false, erro: 'Nenhum valor classificado', falhas }, 502);
    }

    // ---------------------------------------------------------------------
    // 4. Gravar — sem tocar no que foi corrigido à mão
    // ---------------------------------------------------------------------
    // `ignoreDuplicates` porque a linha só existiria aqui se tivesse nascido
    // entre a leitura e a escrita; sobrescrever poderia apagar `origem: humano`.
    const { error: erroInsert } = await supabase
        .from('normalizacao_de_criterio')
        .upsert(linhas, {
            onConflict: 'organization_id,campo,chave',
            ignoreDuplicates: true,
        });

    if (erroInsert) {
        console.error('[normalizar-criterios] erro ao gravar:', erroInsert);
        return json({ error: 'Internal server error' }, 500);
    }

    // ---------------------------------------------------------------------
    // 5. Recalcular a nota com os critérios novos
    // ---------------------------------------------------------------------
    const { data: recalculados, error: erroRecalc } = await supabase.rpc(
        'recalcular_lead_scores',
        { p_org_id: orgId }
    );

    return json({
        ok: true,
        novos: linhas.length,
        jaNoDicionario: conhecidos.size,
        pendentesRestantes: Math.max(pendentes.size - aClassificar.length, 0),
        cardsRecalculados: erroRecalc ? null : recalculados,
        falhas,
    });
}
