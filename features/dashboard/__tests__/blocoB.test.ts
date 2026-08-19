/**
 * Story 2.19 — Bloco B: as regras que sustentam os números da apresentação.
 *
 * Cada teste aqui existe porque a regra oposta é plausível e já apareceu no
 * projeto. O painel vai a uma reunião com diretoria: número errado é pior que
 * número nenhum (risco 1 da story).
 */

import { describe, it, expect } from 'vitest';
import {
    percentualSemResposta,
    avisoDeCobertura,
    avisoDeCoberturaDeDeals,
    inconsistenciasDoPainel,
    coberturaDoLogDaIa,
} from '../blocoB';

describe('percentualSemResposta', () => {
    it('calcula sobre os leads que chegaram', () => {
        // Agosto medido em produção em 12/08: 14 sem resposta de 300 que chegaram.
        expect(percentualSemResposta(14, 300)).toBeCloseTo(4.666, 2);
    });

    it('devolve null quando ninguém chegou — 0/0 não é 0%', () => {
        // A implementação ingênua (`sem / chegaram * 100`) devolveria NaN, e a
        // "correção" ingênua devolveria 0%, que AFIRMA um desempenho que não
        // houve: num mês sem lead, "0% ficaram sem resposta" é elogio inventado.
        expect(percentualSemResposta(0, 0)).toBeNull();
    });

    it('chega a 100% quando ninguém foi respondido', () => {
        expect(percentualSemResposta(7, 7)).toBe(100);
    });
});

describe('avisoDeCobertura', () => {
    const PRIMEIRA_CONVERSA = '2026-07-24T02:59:07.042Z';

    it('avisa quando o período pedido começa antes de o CRM existir', () => {
        // "Julho inteiro" é exatamente o que ela vai querer pedir — e o CRM só
        // tem dado a partir de 24/07. Sem este aviso, o painel devolve um
        // RECORTE com cara de RESPOSTA.
        const aviso = avisoDeCobertura(PRIMEIRA_CONVERSA, '2026-07-01T03:00:00Z');

        expect(aviso).not.toBeNull();
        expect(aviso).toContain('começa antes do CRM');
    });

    it('fica calado quando o período está inteiro coberto', () => {
        // Agosto: nada a ressalvar. Aviso permanente vira ruído e deixa de ser lido.
        expect(avisoDeCobertura(PRIMEIRA_CONVERSA, '2026-08-01T03:00:00Z')).toBeNull();
    });

    it('fica calado quando o período começa exatamente na cobertura', () => {
        expect(avisoDeCobertura(PRIMEIRA_CONVERSA, PRIMEIRA_CONVERSA)).toBeNull();
    });

    it('não inventa aviso quando não há dado nenhum', () => {
        expect(avisoDeCobertura(null, '2026-08-01T03:00:00Z')).toBeNull();
    });

    it('escreve a data no fuso da operação, não em UTC', () => {
        // A primeira conversa é 24/07 às 02:59 UTC = 23/07 às 23:59 em São Paulo,
        // um minuto antes da meia-noite. Formatar em UTC diria "24/07" — que é,
        // aliás, o que todo o registro do projeto vinha dizendo. No fuso dela é
        // "23/07", e é esse que vale: ela conta o mês em horário de São Paulo.
        // Mesma classe de erro que fez os workflows do n8n rodarem 1h adiantados
        // em 11/08 — fuso ausente contado como se fosse local.
        const aviso = avisoDeCobertura(PRIMEIRA_CONVERSA, '2026-07-01T03:00:00Z');
        expect(aviso).toContain('23/07/2026');
    });
});

// =============================================================================
// Story 2.46 — o painel que bate
// =============================================================================

describe('avisoDeCoberturaDeDeals', () => {
    it('avisa quando o periodo comeca antes do card mais antigo', () => {
        // Medido em 19/08: os 491 deals vivos sao TODOS de agosto — a story 2.24
        // apagou fisicamente os de julho. Julho devolve 0 por ausencia de card.
        const aviso = avisoDeCoberturaDeDeals('2026-08-01T00:00:00Z', '2026-07-01T00:00:00Z');
        // 01/08 00:00 UTC e 31/07 em Sao Paulo — e a data e formatada no fuso da
        // OPERACAO de proposito: ela conta o mes em horario de SP, nao em UTC.
        expect(aviso).toContain('31/07/2026');
        expect(aviso).toContain('ausência de card');
    });

    it('cala quando o periodo esta coberto', () => {
        expect(avisoDeCoberturaDeDeals('2026-08-01T00:00:00Z', '2026-08-10T00:00:00Z')).toBeNull();
    });

    it('cala quando nao ha deal nenhum — sem base nao se afirma cobertura', () => {
        expect(avisoDeCoberturaDeDeals(null, '2026-07-01T00:00:00Z')).toBeNull();
    });
});

describe('inconsistenciasDoPainel (AC10)', () => {
    it('aceita os numeros reais medidos em 19/08', () => {
        expect(
            inconsistenciasDoPainel({
                chegaram: 796,
                euAbordei: 146,
                chegaramAteMim: 203,
                semResposta: 57,
            })
        ).toEqual([]);
    });

    it('reprova transferidos maior que quem chegou', () => {
        // A queixa que abriu a story foi "nao estao batendo". Esta e a forma mais
        // provavel de voltar a nao bater: transferencia contada fora da populacao.
        const problemas = inconsistenciasDoPainel({
            chegaram: 100,
            euAbordei: 10,
            chegaramAteMim: 101,
            semResposta: 0,
        });
        expect(problemas).toHaveLength(1);
        expect(problemas[0]).toContain('transferidos');
    });

    it('reprova sem-resposta maior que quem chegou', () => {
        const problemas = inconsistenciasDoPainel({
            chegaram: 10,
            euAbordei: 0,
            chegaramAteMim: 0,
            semResposta: 11,
        });
        expect(problemas[0]).toContain('sem resposta');
    });

    it('reprova contagem negativa', () => {
        const problemas = inconsistenciasDoPainel({
            chegaram: -1,
            euAbordei: 0,
            chegaramAteMim: 0,
            semResposta: 0,
        });
        expect(problemas.some((p) => p.includes('negativa'))).toBe(true);
    });
});

describe('coberturaDoLogDaIa (AC9)', () => {
    it('declara a cobertura real medida em 19/08 (89 de 8.386)', () => {
        const aviso = coberturaDoLogDaIa(89, 8386);
        expect(aviso).toContain('89');
        expect(aviso).toContain('8386');
        // Abaixo de 1% precisa de 2 casas: "~1%" arredondaria 1,06% e "~0%"
        // faria o aviso parecer defeito do aviso, nao do log.
        expect(aviso).toContain('1.1%');
        expect(aviso).toContain('amostra');
    });

    it('cala quando o log cobre a operacao — aviso permanente vira ruido', () => {
        expect(coberturaDoLogDaIa(95, 100)).toBeNull();
    });

    it('cala quando nao ha mensagem no periodo — 0/0 nao e 0%', () => {
        expect(coberturaDoLogDaIa(0, 0)).toBeNull();
    });

    it('cala quando falta um dos lados, em vez de chutar', () => {
        expect(coberturaDoLogDaIa(89, null)).toBeNull();
        expect(coberturaDoLogDaIa(undefined, 8386)).toBeNull();
    });
});
