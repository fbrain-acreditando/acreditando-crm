/**
 * Story 2.19 — Bloco B: as regras que sustentam os números da apresentação.
 *
 * Cada teste aqui existe porque a regra oposta é plausível e já apareceu no
 * projeto. O painel vai a uma reunião com diretoria: número errado é pior que
 * número nenhum (risco 1 da story).
 */

import { describe, it, expect } from 'vitest';
import { percentualSemResposta, avisoDeCobertura } from '../blocoB';

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
