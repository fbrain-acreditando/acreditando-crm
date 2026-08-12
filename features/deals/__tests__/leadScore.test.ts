/**
 * Story 2.18a — os casos que o AC7 exige, mais os que o AC0 revelou.
 *
 * Cada teste existe porque a regra oposta é plausível: a implementação ingênua
 * (contar `true`, tratar o resto como `false`) passa em metade deles e reprova
 * exatamente nos que definem a story.
 */

import { describe, it, expect } from 'vitest';
import {
    computeLeadScore,
    formatarNota,
    compararPorPrioridade,
    type CriteriosDoLead,
} from '../leadScore';

/** Todos desconhecidos — o estado de 210 dos 318 cards vivos, medido em 12/08. */
const NADA_CONHECIDO: CriteriosDoLead = {
    roteiroCompleto: null,
    cidadeDeSaoPaulo: null,
    lesaoRecente: null,
    semReabilitacaoPrevia: null,
    paraProprioLead: null,
};

describe('computeLeadScore — a regra é contagem', () => {
    it('cinco critérios batendo dão 5 estrelas (a frase original do Filipe)', () => {
        const nota = computeLeadScore({
            roteiroCompleto: true,
            cidadeDeSaoPaulo: true,
            lesaoRecente: true,
            semReabilitacaoPrevia: true,
            paraProprioLead: true,
        });

        expect(nota.score).toBe(5);
        expect(nota.known).toBe(5);
        expect(nota.unknown).toHaveLength(0);
    });

    it('deal sem nenhum campo NÃO vira 5 e NÃO quebra', () => {
        const nota = computeLeadScore(NADA_CONHECIDO);

        expect(nota.score).toBeNull();
        expect(nota.known).toBe(0);
        expect(nota.unknown).toHaveLength(5);
    });

    it('objeto vazio é tratado como tudo desconhecido, não como erro', () => {
        expect(computeLeadScore({}).score).toBeNull();
    });
});

describe('AC2 — campo ausente NÃO é campo negativo', () => {
    it('desconhecido não entra no denominador; refutado entra', () => {
        // O caso que separa esta story da implementação ingênua.
        const soRoteiro = computeLeadScore({
            ...NADA_CONHECIDO,
            roteiroCompleto: true,
        });
        const roteiroComQuatroRefutados = computeLeadScore({
            roteiroCompleto: true,
            cidadeDeSaoPaulo: false,
            lesaoRecente: false,
            semReabilitacaoPrevia: false,
            paraProprioLead: false,
        });

        // Mesma NOTA...
        expect(soRoteiro.score).toBe(1);
        expect(roteiroComQuatroRefutados.score).toBe(1);

        // ...e denominadores opostos. É o que impede os dois de parecerem iguais
        // na tela — um é lead a investigar, o outro é lead a descartar.
        expect(soRoteiro.known).toBe(1);
        expect(roteiroComQuatroRefutados.known).toBe(5);
    });

    it('tudo refutado dá nota ZERO, que é diferente de SEM NOTA', () => {
        const tudoRefutado = computeLeadScore({
            roteiroCompleto: false,
            cidadeDeSaoPaulo: false,
            lesaoRecente: false,
            semReabilitacaoPrevia: false,
            paraProprioLead: false,
        });

        // Zero AFIRMA: perguntamos os cinco e nenhum bateu.
        expect(tudoRefutado.score).toBe(0);
        expect(tudoRefutado.known).toBe(5);

        // Null diz outra coisa: não perguntamos nada.
        expect(computeLeadScore(NADA_CONHECIDO).score).toBeNull();
    });
});

describe('formatarNota — o denominador é obrigatório na tela', () => {
    it('mostra acertos sobre conhecidos, não sobre cinco', () => {
        expect(formatarNota(computeLeadScore({ ...NADA_CONHECIDO, roteiroCompleto: true })))
            .toBe('1/1');
    });

    it('o mesmo acerto com quatro refutados aparece diferente', () => {
        expect(
            formatarNota(
                computeLeadScore({
                    roteiroCompleto: true,
                    cidadeDeSaoPaulo: false,
                    lesaoRecente: false,
                    semReabilitacaoPrevia: false,
                    paraProprioLead: false,
                })
            )
        ).toBe('1/5');
    });

    it('card sem dado diz "sem dado", não "0/0"', () => {
        expect(formatarNota(computeLeadScore(NADA_CONHECIDO))).toBe('sem dado');
    });
});

describe('compararPorPrioridade — a fila de trabalho', () => {
    const nota = (c: Partial<CriteriosDoLead>) => computeLeadScore(c);

    it('nota maior vem primeiro', () => {
        const tres = nota({ roteiroCompleto: true, cidadeDeSaoPaulo: true, lesaoRecente: true });
        const um = nota({ roteiroCompleto: true });
        expect(compararPorPrioridade(tres, um)).toBeLessThan(0);
    });

    it('empate na nota: ganha quem tem menos critérios refutados', () => {
        // 2/2 (dois acertos, nada contra) vence 2/5 (dois acertos, três contra).
        const doisDeDois = nota({ roteiroCompleto: true, cidadeDeSaoPaulo: true });
        const doisDeCinco = nota({
            roteiroCompleto: true,
            cidadeDeSaoPaulo: true,
            lesaoRecente: false,
            semReabilitacaoPrevia: false,
            paraProprioLead: false,
        });
        expect(compararPorPrioridade(doisDeDois, doisDeCinco)).toBeLessThan(0);
    });

    it('card sem nota vai para o fim, e não para o topo', () => {
        // A armadilha: `null` em comparação numérica vira 0 e, num sort
        // decrescente mal escrito, um card sem dado nenhum encabeçaria a fila
        // dela — o oposto do que a story existe para fazer.
        const semNota = nota(NADA_CONHECIDO);
        const notaZero = nota({
            roteiroCompleto: false,
            cidadeDeSaoPaulo: false,
            lesaoRecente: false,
            semReabilitacaoPrevia: false,
            paraProprioLead: false,
        });

        expect(compararPorPrioridade(semNota, notaZero)).toBeGreaterThan(0);
        expect(compararPorPrioridade(notaZero, semNota)).toBeLessThan(0);
    });

    it('dois sem nota empatam, sem inverter a ordem original', () => {
        expect(compararPorPrioridade(nota(NADA_CONHECIDO), nota(NADA_CONHECIDO))).toBe(0);
    });
});
