/**
 * Story 2.35 AC7 — o que o modelo NÃO pode decidir.
 *
 * Todo teste aqui existe porque a alternativa ingênua (confiar na resposta do
 * modelo) é plausível e passaria despercebida em produção.
 */

import { describe, it, expect } from 'vitest';
import { consolidarPontuacao, MOTIVO_NAO_AVALIADO } from '@/lib/ai/scoring/pontuarLead';

const CINCO_COMPLETOS = [
    { id: 'roteiroCompleto', atende: 1, motivo: 'Respondeu todas as perguntas.' },
    { id: 'cidadeDeSaoPaulo', atende: 1, motivo: 'Disse que mora em Sapopemba.' },
    { id: 'lesaoRecente', atende: 1, motivo: 'Lesão há 6 meses.' },
    { id: 'semReabilitacaoPrevia', atende: 1, motivo: 'Disse que ainda não fez.' },
    { id: 'paraProprioLead', atende: 1, motivo: 'É para ela mesma.' },
];

describe('consolidarPontuacao — a soma é NOSSA', () => {
    it('soma os cinco itens', () => {
        const nota = consolidarPontuacao(CINCO_COMPLETOS);
        expect(nota.score).toBe(5);
        expect(nota.known).toBe(5);
    });

    it('ignora um total que o modelo tivesse mandado', () => {
        // O modelo não tem campo de total no schema — e, se um dia tiver, este
        // teste garante que ele não é lido. Erro de aritmética do modelo seria
        // indistinguível de erro de julgamento.
        const comTotalErrado = [...CINCO_COMPLETOS] as Array<Record<string, unknown>>;
        (comTotalErrado as unknown as { total: number }[]).push({ total: 99 } as never);

        expect(consolidarPontuacao(comTotalErrado as never).score).toBe(5);
    });

    it('conta 0 quando nenhum item atende', () => {
        const nota = consolidarPontuacao(
            CINCO_COMPLETOS.map(i => ({ ...i, atende: 0 }))
        );
        expect(nota.score).toBe(0);
        expect(nota.known).toBe(5);
    });
});

describe('item ausente vale 0 — nunca 1', () => {
    it('o item que o modelo não devolveu entra como 0', () => {
        // O risco nº4 da story: o modelo devolve menos de cinco itens. Inventar
        // ponto a partir de omissão é o pior defeito possível numa fila de
        // prioridade.
        const nota = consolidarPontuacao(CINCO_COMPLETOS.slice(0, 3));

        expect(nota.score).toBe(3);
        expect(nota.known).toBe(5);
        expect(nota.itens).toHaveLength(5);
    });

    it('o motivo distingue "não avaliei" de "avaliei e não atende"', () => {
        // Exigência do @po: valem o mesmo ponto e significam coisas diferentes
        // para quem lê o card.
        const nota = consolidarPontuacao([
            { id: 'roteiroCompleto', atende: 0, motivo: 'Parou de responder na 3ª pergunta.' },
        ]);

        const avaliado = nota.itens.find(i => i.id === 'roteiroCompleto');
        const naoAvaliado = nota.itens.find(i => i.id === 'cidadeDeSaoPaulo');

        expect(avaliado?.atende).toBe(0);
        expect(avaliado?.motivo).toContain('Parou de responder');

        expect(naoAvaliado?.atende).toBe(0);
        expect(naoAvaliado?.motivo).toBe(MOTIVO_NAO_AVALIADO);
    });

    it('resposta vazia não quebra e não inventa nota', () => {
        const nota = consolidarPontuacao([]);
        expect(nota.score).toBe(0);
        expect(nota.itens).toHaveLength(5);
        expect(nota.itens.every(i => i.motivo === MOTIVO_NAO_AVALIADO)).toBe(true);
    });
});

describe('valores fora do contrato', () => {
    it('atende diferente de 1 nunca vira ponto', () => {
        // `atende: 2` ou `atende: true` passariam num teste de verdade e virariam
        // ponto. A comparação é `=== 1`.
        const nota = consolidarPontuacao([
            { id: 'roteiroCompleto', atende: 2, motivo: 'valor fora do contrato' },
            { id: 'cidadeDeSaoPaulo', atende: -1, motivo: 'idem' },
        ]);

        expect(nota.score).toBe(0);
    });

    it('a nota nunca passa de 5, mesmo com itens repetidos na resposta', () => {
        // O modelo repetindo um item não pode inflar a soma: a consolidação
        // percorre a LISTA CANÔNICA de critérios, não a resposta.
        const repetido = [
            ...CINCO_COMPLETOS,
            { id: 'roteiroCompleto', atende: 1, motivo: 'repetido' },
            { id: 'lesaoRecente', atende: 1, motivo: 'repetido' },
        ];

        expect(consolidarPontuacao(repetido).score).toBe(5);
    });

    it('id desconhecido é descartado, não somado', () => {
        const nota = consolidarPontuacao([
            { id: 'criterioQueNaoExiste', atende: 1, motivo: 'inventado' },
        ]);
        expect(nota.score).toBe(0);
    });
});
