/**
 * Bloco A do painel — regras puras (story 2.19).
 *
 * O que estes testes protegem, em uma frase: **um número de fila não pode
 * afirmar mais alcance do que ele tem**. É a lição que a story 2.18 já pagou
 * (`★ 1/1` × `★ 1/5`) e que o Bloco B repetiu (`0/0` não é `0%`).
 */

import { describe, it, expect } from 'vitest';
import {
    avisoDeAlcanceDaIa,
    semBaseParaLigar,
    tomDoAtraso,
    definicaoDaEspera,
} from '../blocoA';

describe('avisoDeAlcanceDaIa — o denominador vai para a tela', () => {
    it('mostra o alcance real quando a IA leu só parte da base', () => {
        // O caso medido em 14/08: 68 de 370 cards vivos.
        const aviso = avisoDeAlcanceDaIa(68, 370);
        expect(aviso).toContain('68');
        expect(aviso).toContain('370');
    });

    it('cala quando a IA leu TODA a base — aí não há alcance a ressalvar', () => {
        expect(avisoDeAlcanceDaIa(370, 370)).toBeNull();
    });

    it('cala quando nada foi pontuado — quem trata esse caso é semBaseParaLigar', () => {
        expect(avisoDeAlcanceDaIa(0, 370)).toBeNull();
    });

    it('não quebra com base zerada (organização nova, sem card)', () => {
        expect(avisoDeAlcanceDaIa(0, 0)).toBeNull();
    });

    it('cala se o pontuado passar do total — não inventa ressalva com número impossível', () => {
        // Defensivo: se as duas contagens divergirem por corrida, é melhor não
        // escrever "de 400 cards (de 370)" na tela dela.
        expect(avisoDeAlcanceDaIa(400, 370)).toBeNull();
    });
});

describe('semBaseParaLigar — "ninguém foi lido" NÃO é "ninguém está pronto"', () => {
    it('acusa falta de base quando a IA não pontuou nada', () => {
        // 🔑 A regra existe para o painel escrever "—" em vez de "0". Mostrar
        // zero seria uma afirmação sobre os LEADS ("não há ninguém pronto"),
        // quando o fato é sobre o SISTEMA ("ninguém foi avaliado").
        expect(semBaseParaLigar(0)).toBe(true);
    });

    it('não acusa quando há pelo menos um card lido', () => {
        expect(semBaseParaLigar(1)).toBe(false);
        expect(semBaseParaLigar(68)).toBe(false);
    });
});

describe('tomDoAtraso — o alarme é conservador de propósito', () => {
    it('fica "bom" quando nada passou do limite', () => {
        expect(tomDoAtraso(0, 67)).toBe('bom');
    });

    it('fica "atencao" quando os atrasados são minoria da fila', () => {
        expect(tomDoAtraso(10, 67)).toBe('atencao');
    });

    it('vira "alarme" só quando metade ou mais da fila estourou o prazo', () => {
        // O caso medido em 14/08: 61 de 67 esperando ⇒ alarme legítimo.
        expect(tomDoAtraso(61, 67)).toBe('alarme');
        expect(tomDoAtraso(34, 67)).toBe('alarme');
        expect(tomDoAtraso(33, 67)).toBe('atencao');
    });

    it('não divide por zero quando há atrasado sem fila', () => {
        // Estado inconsistente possível entre duas leituras; melhor "atencao"
        // do que NaN na tela.
        expect(tomDoAtraso(5, 0)).toBe('atencao');
    });
});

describe('definicaoDaEspera — o card diz POR QUE a conversa está na fila (AC1)', () => {
    it('explica o critério e cita o limite de horas recebido', () => {
        const texto = definicaoDaEspera(24);
        expect(texto).toContain('24h');
        // Sem o "o lead falou por último", o número vira cobrança sem recurso:
        // ela olha "67" e não sabe o que fazer com ele.
        expect(texto).toContain('falou por último');
    });

    it('acompanha o limite se ele mudar — o texto não pode cravar 24', () => {
        expect(definicaoDaEspera(48)).toContain('48h');
        expect(definicaoDaEspera(48)).not.toContain('24h');
    });
});
