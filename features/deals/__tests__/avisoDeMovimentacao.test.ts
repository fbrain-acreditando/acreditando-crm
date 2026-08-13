/**
 * Story 2.37 — o aviso quando mover um card falha.
 *
 * O código ANTIGO não tinha mensagem nenhuma (o `onError` descartava o erro em
 * `_err`), então o oráculo aqui é por CONTEÚDO: cada asserção descreve algo que
 * a tela dela precisa dizer — e que o silêncio anterior não dizia.
 */
import { describe, expect, it } from 'vitest';
import {
    deveAvisarDeFalha,
    mensagemDeFalhaAoMover,
    nomeDoEstagioDestino,
    resumoTecnico,
} from '../avisoDeMovimentacao';

describe('mensagemDeFalhaAoMover', () => {
    it('diz o que aconteceu com o card E o que fazer (AC1)', () => {
        const msg = mensagemDeFalhaAoMover('Perdido');

        // O que aconteceu: ele VOLTOU — sem isso ela conclui que o sistema perdeu
        // o trabalho, que é a desconfiança de 12/08.
        expect(msg).toContain('voltou para a coluna anterior');
        // O que fazer: aviso sem saída é a story 2.28 com outra roupa.
        expect(msg).toContain('tente de novo');
        // Para onde ela tentou mover.
        expect(msg).toContain('Perdido');
    });

    it('funciona sem o nome do estágio, e nunca escreve "undefined" na tela', () => {
        for (const semNome of [null, undefined, '', '   ']) {
            const msg = mensagemDeFalhaAoMover(semNome);
            expect(msg).toContain('Não foi possível mover o card');
            expect(msg).not.toContain('undefined');
            expect(msg).not.toContain('null');
            // Sem nome, não sobra aspas vazias nem "para ".
            expect(msg).not.toContain('""');
            expect(msg).toContain('card.');
        }
    });

    it('NÃO vaza linguagem de sistema (AC2)', () => {
        // A mensagem é montada só a partir do nome do estágio — o texto do erro
        // não tem caminho para a tela. Esta asserção trava isso.
        const msg = mensagemDeFalhaAoMover('Perdido');
        for (const vazamento of ['PGRST', 'supabase', 'undefined', 'Error', 'row-level', '500']) {
            expect(msg).not.toContain(vazamento);
        }
    });
});

describe('deveAvisarDeFalha (AC3)', () => {
    it('não avisa quando a requisição foi abortada', () => {
        const abort = new Error('The user aborted a request.');
        abort.name = 'AbortError';
        expect(deveAvisarDeFalha(abort)).toBe(false);

        const cancelada = new Error('CancelledError');
        cancelada.name = 'CancelledError';
        expect(deveAvisarDeFalha(cancelada)).toBe(false);

        // Também pela mensagem, para o caso de o `name` vir genérico.
        expect(deveAvisarDeFalha(new Error('signal is aborted without reason'))).toBe(false);
    });

    it('avisa em falha real de gravação', () => {
        expect(deveAvisarDeFalha(new Error('violates row-level security policy'))).toBe(true);
        expect(deveAvisarDeFalha({ message: 'Failed to fetch' })).toBe(true);
        expect(deveAvisarDeFalha('erro qualquer')).toBe(true);
        // Erro sem forma conhecida ⇒ avisa. Na dúvida, falar: o padrão anterior
        // (silêncio) custou 1h30 de trabalho dela.
        expect(deveAvisarDeFalha(undefined)).toBe(true);
    });
});

describe('nomeDoEstagioDestino', () => {
    const board = {
        stages: [
            { id: 's1', name: 'Lead novo' },
            { id: 's2', name: 'Perdido' },
            { id: 's3', name: '   ' },
            { id: 's4', name: null },
        ],
    };

    it('acha o nome pelo id', () => {
        expect(nomeDoEstagioDestino(board, 's2')).toBe('Perdido');
    });

    it('devolve null em vez de quebrar — erro dentro do tratamento de erro é o pior lugar', () => {
        expect(nomeDoEstagioDestino(board, 'inexistente')).toBeNull();
        expect(nomeDoEstagioDestino(board, undefined)).toBeNull();
        expect(nomeDoEstagioDestino(null, 's2')).toBeNull();
        expect(nomeDoEstagioDestino({}, 's2')).toBeNull();
        // Nome em branco ou nulo conta como "sem nome", não como nome vazio.
        expect(nomeDoEstagioDestino(board, 's3')).toBeNull();
        expect(nomeDoEstagioDestino(board, 's4')).toBeNull();
    });
});

describe('resumoTecnico', () => {
    it('preserva o diagnóstico para o console — ligar o aviso não pode custar a depuração', () => {
        expect(resumoTecnico(new Error('violates RLS'))).toBe('violates RLS');
        expect(resumoTecnico({ message: 'PGRST116' })).toBe('PGRST116');
        expect(resumoTecnico('texto solto')).toBe('texto solto');
        expect(resumoTecnico({ code: '23505' })).toContain('23505');
    });

    it('sobrevive a objeto com referência circular', () => {
        const circular: Record<string, unknown> = {};
        circular.self = circular;
        expect(() => resumoTecnico(circular)).not.toThrow();
    });
});
