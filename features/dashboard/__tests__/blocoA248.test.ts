/**
 * @fileoverview Story 2.48 — as regras da fila que ABRE.
 *
 * Testa as decisões que a tela toma, não a tela. Mesma separação do
 * `blocoA.test.ts` da 2.19: decisão testada dentro de JSX custa montar a árvore
 * inteira e não sobrevive a um refactor de layout.
 */

import { describe, it, expect } from 'vitest';
import {
    definicaoDaEsperaNoFunil,
    resumoDoDesconto,
    rotuloDaEspera,
    textoDoItem,
} from '../blocoA';

describe('definicaoDaEsperaNoFunil', () => {
    it('diz o que a conta faz e convida ao clique', () => {
        const frase = definicaoDaEsperaNoFunil(24);
        expect(frase).toContain('funil ativo');
        expect(frase).toContain('Clique');
        expect(frase).toContain('24h');
    });

    it('para de prometer julgamento de intenção', () => {
        // A definição antiga prometia "exigem ação sua" e entregava "abertas".
        // A 2.48 resolve MOSTRANDO quem são — o texto não pode voltar a prometer.
        const frase = definicaoDaEsperaNoFunil(24);
        expect(frase).not.toMatch(/exigem ação/i);
    });

    it('acompanha o limite configurado', () => {
        expect(definicaoDaEsperaNoFunil(48)).toContain('48h');
    });
});

describe('resumoDoDesconto', () => {
    it('não inventa frase quando não há desconto', () => {
        expect(resumoDoDesconto(0, 0)).toBeNull();
    });

    it('explica os dois grupos e soma o total', () => {
        const frase = resumoDoDesconto(13, 23);
        expect(frase).toContain('36');
        expect(frase).toContain('Ganho');
        expect(frase).toContain('23');
    });

    it('omite o grupo vazio em vez de escrever "0"', () => {
        const frase = resumoDoDesconto(13, 0);
        expect(frase).toContain('13');
        expect(frase).not.toContain('não viraram card');
    });

    it('concorda no singular — "1 conversa espera", não "1 conversas esperam"', () => {
        const frase = resumoDoDesconto(1, 0);
        expect(frase).toContain('1 conversa espera');
        expect(frase).toContain('1 está em Ganho');
    });

    it('é o antídoto contra o desconto silencioso', () => {
        // Descontar 36 de um número que já circulou em reunião SEM dizer é o
        // painel mentindo sem uma linha errada.
        expect(resumoDoDesconto(13, 23)).not.toBeNull();
    });
});

describe('rotuloDaEspera', () => {
    it('não manda fazer conta de cabeça', () => {
        expect(rotuloDaEspera(0.5)).toBe('agora há pouco');
        expect(rotuloDaEspera(3.7)).toBe('há 3h');
    });

    it('vira dias quando horas deixam de informar', () => {
        expect(rotuloDaEspera(48)).toBe('há 2 dias');
        expect(rotuloDaEspera(364.8)).toBe('há 15 dias');
    });

    it('trata a fronteira das 48h sem pular nem repetir', () => {
        expect(rotuloDaEspera(47.9)).toBe('há 47h');
        expect(rotuloDaEspera(48)).toBe('há 2 dias');
    });
});

describe('textoDoItem', () => {
    it('devolve o texto real quando existe', () => {
        expect(textoDoItem('text', 'Ok obrigada')).toBe('Ok obrigada');
    });

    it('não deixa a linha em branco em áudio e imagem', () => {
        // Medido em 24/08: dos 56 no funil, 6 eram áudio e 4 imagem. Linha em
        // branco é a lista afirmando que não há nada ali.
        expect(textoDoItem('audio', null)).toContain('Áudio');
        expect(textoDoItem('image', '')).toContain('Imagem');
    });

    it('trata texto só com espaços como vazio', () => {
        expect(textoDoItem('audio', '   ')).toContain('Áudio');
    });

    it('tem saída para tipo desconhecido', () => {
        expect(textoDoItem('sticker', null)).toContain('abra a conversa');
    });
});
