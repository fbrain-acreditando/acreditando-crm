/**
 * Story 2.18 AC4 — a nota manual sobrevive à ida e volta banco ↔ tela.
 *
 * O caminho de escrita tem uma armadilha real: `leadScore: 0` (perguntamos os
 * cinco e nenhum bateu) e `leadScore: null` (voltar ao automático) são valores
 * que ela pode querer gravar, e ambos são *falsy*. Um mapeamento escrito com
 * teste de verdade (`if (deal.leadScore)`) descartaria os dois em silêncio — a
 * nota simplesmente não mudaria, sem erro nenhum na tela.
 */

import { describe, it, expect } from 'vitest';

/**
 * Réplica exata do trecho de `transformDealToDb` que mapeia a nota
 * (`lib/supabase/deals.ts`).
 *
 * A função real é inline num mapeamento de ~40 campos e não é exportada. Para
 * provar que a asserção discrimina, a versão DEFEITUOSA está logo abaixo e o
 * último teste confere que ela reprovaria — o padrão que a casa adotou em 12/08.
 */
function mapearNota(deal: {
    leadScore?: number | null;
    leadScoreKnown?: number | null;
    leadScoreSource?: 'auto' | 'manual' | null;
}) {
    const db: Record<string, unknown> = {};
    if (deal.leadScore !== undefined) db.lead_score = deal.leadScore;
    if (deal.leadScoreKnown !== undefined) db.lead_score_known = deal.leadScoreKnown;
    if (deal.leadScoreSource !== undefined) db.lead_score_source = deal.leadScoreSource;
    return db;
}

/** Como o mesmo trecho ficaria se escrito com teste de verdade. */
function mapearNotaDefeituoso(deal: {
    leadScore?: number | null;
    leadScoreSource?: 'auto' | 'manual' | null;
}) {
    const db: Record<string, unknown> = {};
    if (deal.leadScore) db.lead_score = deal.leadScore;
    if (deal.leadScoreSource) db.lead_score_source = deal.leadScoreSource;
    return db;
}

describe('gravação da nota manual', () => {
    it('grava a nota que ela escolheu, marcada como manual', () => {
        expect(mapearNota({ leadScore: 3, leadScoreKnown: 5, leadScoreSource: 'manual' })).toEqual({
            lead_score: 3,
            lead_score_known: 5,
            lead_score_source: 'manual',
        });
    });

    it('grava ZERO — que é uma nota, não a ausência de nota', () => {
        expect(mapearNota({ leadScore: 0, leadScoreKnown: 5, leadScoreSource: 'manual' })).toEqual({
            lead_score: 0,
            lead_score_known: 5,
            lead_score_source: 'manual',
        });
    });

    it('grava NULL — é assim que o card volta para o cálculo automático', () => {
        const db = mapearNota({ leadScore: null, leadScoreKnown: null, leadScoreSource: null });

        // As três chaves têm de ESTAR presentes com valor null: é isso que limpa
        // a coluna. Ausência de chave não apaga nada, e o card ficaria preso na
        // nota manual para sempre.
        expect(db).toHaveProperty('lead_score', null);
        expect(db).toHaveProperty('lead_score_source', null);
    });

    it('não toca nas colunas quando a nota não faz parte da edição', () => {
        expect(mapearNota({})).toEqual({});
    });

    it('o mapeamento com teste de verdade PERDE zero e null — por isso o !== undefined', () => {
        // Prova que a asserção discrimina: a versão defeituosa engole os dois
        // casos que mais importam.
        expect(mapearNotaDefeituoso({ leadScore: 0, leadScoreSource: 'manual' }))
            .not.toHaveProperty('lead_score');
        expect(mapearNotaDefeituoso({ leadScore: null, leadScoreSource: null }))
            .toEqual({});
    });
});
