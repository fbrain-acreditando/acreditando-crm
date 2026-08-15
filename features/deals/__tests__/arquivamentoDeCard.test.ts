/**
 * Arquivar ≠ reabrir (story 2.40).
 *
 * O oráculo é o lote real de 13/08 11:53: quatro cards que passaram por `Ganho`
 * em 11 e 12/08 foram arquivados em `Clientes`/`Profissional` e estão hoje com
 * `is_won = false` e `closed_at = null`.
 */

import { describe, it, expect } from 'vitest';
import { preservaVendaAoArquivar, avisoDeArquivamento } from '../arquivamentoDeCard';

// As três colunas de CATEGORIA deste board (stories 2.33 e 2.34).
const CLIENTES = { arquivaSemReabrir: true };
const PROFISSIONAL = { arquivaSemReabrir: true };

// Etapas de funil — aqui reabrir é o comportamento CERTO.
const LEAD_NOVO = { arquivaSemReabrir: false };
const CONTATO_REALIZADO = { arquivaSemReabrir: false };

describe('preservaVendaAoArquivar — a venda sobrevive ao arquivamento', () => {
    it('preserva ao mover para uma coluna de categoria', () => {
        expect(preservaVendaAoArquivar(CLIENTES)).toBe(true);
        expect(preservaVendaAoArquivar(PROFISSIONAL)).toBe(true);
    });

    it('NÃO preserva em etapa de funil — arrastar de volta ao funil É reabrir', () => {
        expect(preservaVendaAoArquivar(CONTATO_REALIZADO)).toBe(false);
    });

    it('🔑 não preserva em `Lead novo`, que também tem lifecycle nulo', () => {
        // Este é o teste que impede a correção "esperta": inferir categoria por
        // `linkedLifecycleStage is null` teria pegado `Lead novo` junto, e ali
        // reabrir é o certo. Por isso o sinal é uma coluna do banco.
        expect(preservaVendaAoArquivar(LEAD_NOVO)).toBe(false);
    });

    it('coluna desconhecida mantém o comportamento antigo (não preserva)', () => {
        // Falha segura: só arquiva quem foi marcado explicitamente no banco.
        expect(preservaVendaAoArquivar(undefined)).toBe(false);
        expect(preservaVendaAoArquivar(null)).toBe(false);
        expect(preservaVendaAoArquivar({})).toBe(false);
    });

    it('exige `true` de verdade — valor ausente ou estranho não arquiva', () => {
        expect(preservaVendaAoArquivar({ arquivaSemReabrir: undefined })).toBe(false);
    });
});

describe('avisoDeArquivamento — ela precisa saber que o número sobreviveu', () => {
    it('nomeia a coluna e afirma que a venda continua contando', () => {
        const texto = avisoDeArquivamento('Clientes');
        expect(texto).toContain('Clientes');
        expect(texto).toContain('continua contando');
    });
});
