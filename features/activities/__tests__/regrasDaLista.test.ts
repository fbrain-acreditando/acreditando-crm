/**
 * Lista de Atividades — regras puras (story 2.39).
 *
 * O oráculo desta story é a nota real da Fernanda, medida no banco em 14/08:
 * card do Francisco Melo, título "Nota Adicionada", texto "Informações enviadas,
 * vai avaliar o financeiro pois reside em Cubatão", `completed = true`.
 *
 * Cada teste abaixo corresponde a uma das quatro portas que estavam fechadas.
 */

import { describe, it, expect } from 'vitest';
import {
    ehNota,
    deveRiscar,
    combinaComABusca,
    corpoDaLinha,
} from '../regrasDaLista';

/** A nota real dela, como está no banco. */
const NOTA_DA_FERNANDA = {
    type: 'NOTE' as const,
    completed: true,
    title: 'Nota Adicionada',
    description: 'Informações enviadas, vai avaliar o financeiro pois reside em Cubatão',
};

describe('ehNota — nota é registro, não tarefa', () => {
    it('reconhece a nota', () => {
        expect(ehNota(NOTA_DA_FERNANDA)).toBe(true);
    });

    it('não confunde com tarefa nem com movimentação de card', () => {
        expect(ehNota({ type: 'TASK' })).toBe(false);
        expect(ehNota({ type: 'STATUS_CHANGE' })).toBe(false);
    });
});

describe('deveRiscar — a nota dela NÃO pode aparecer cancelada', () => {
    it('não risca a nota, mesmo com completed = true', () => {
        // 🔑 O caso que motivou a story: 54 de 54 notas têm `completed = true`,
        // e a linha riscava tudo que estivesse concluído. O trabalho dela
        // aparecia tachado e esmaecido, como tarefa cancelada.
        expect(deveRiscar(NOTA_DA_FERNANDA)).toBe(false);
    });

    it('continua riscando tarefa concluída — isso não era defeito', () => {
        expect(deveRiscar({ type: 'TASK', completed: true })).toBe(true);
    });

    it('não risca tarefa pendente', () => {
        expect(deveRiscar({ type: 'TASK', completed: false })).toBe(false);
    });
});

describe('combinaComABusca — procurar pelo conteúdo, não pelo título', () => {
    it('acha a nota pelo texto que ela digitou', () => {
        // Antes: a busca só olhava `title`. Procurar "Cubatão" não achava NADA,
        // porque as 54 notas se chamam todas "Nota Adicionada".
        expect(combinaComABusca(NOTA_DA_FERNANDA, 'cubatão')).toBe(true);
        expect(combinaComABusca(NOTA_DA_FERNANDA, 'financeiro')).toBe(true);
    });

    it('continua achando pelo título', () => {
        expect(combinaComABusca(NOTA_DA_FERNANDA, 'nota')).toBe(true);
    });

    it('não acha o que não está em lugar nenhum', () => {
        expect(combinaComABusca(NOTA_DA_FERNANDA, 'santos')).toBe(false);
    });

    it('busca vazia casa com tudo — é o estado inicial da tela', () => {
        expect(combinaComABusca(NOTA_DA_FERNANDA, '')).toBe(true);
        expect(combinaComABusca(NOTA_DA_FERNANDA, '   ')).toBe(true);
    });

    it('não quebra quando não há texto', () => {
        expect(combinaComABusca({ title: 'Moveu para Perdido', description: null }, 'perdido')).toBe(true);
        expect(combinaComABusca({ title: 'Moveu para Perdido', description: null }, 'cubatão')).toBe(false);
    });
});

describe('corpoDaLinha — o texto da nota vai para a tela', () => {
    it('devolve o texto da nota', () => {
        expect(corpoDaLinha(NOTA_DA_FERNANDA)).toBe(
            'Informações enviadas, vai avaliar o financeiro pois reside em Cubatão'
        );
    });

    it('devolve null quando não há texto — a movimentação de card não tem corpo', () => {
        // As 839 movimentações têm `description` vazia. Sem este caso, a lista
        // ganharia 839 parágrafos em branco.
        expect(corpoDaLinha({ description: '' })).toBeNull();
        expect(corpoDaLinha({ description: null })).toBeNull();
        expect(corpoDaLinha({ description: '   ' })).toBeNull();
    });
});
