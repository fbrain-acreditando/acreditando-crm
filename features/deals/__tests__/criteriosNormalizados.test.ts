/**
 * Story 2.18b — AC6: os testes que reprovam sem o conserto.
 *
 * Os casos de canonicalização são os MESMOS que a função SQL
 * `public.canonicalizar_valor` tem de produzir. Se um dia divergirem, o `join`
 * do dicionário passa a falhar em silêncio.
 */

import { describe, it, expect } from 'vitest';
import {
    canonicalizarValor,
    criterioDoRotulo,
    criteriosNormalizadosDoDeal,
} from '../criteriosNormalizados';
import { computeLeadScore } from '../leadScore';

describe('canonicalizarValor — a chave do dicionário', () => {
    it('colapsa as grafias que fragmentariam o dicionário', () => {
        // O risco levantado pelo @po: sem isto, estas quatro viram quatro linhas,
        // a IA recusta para o mesmo lugar e corrigir uma não corrige as outras.
        const grafias = ['Sapopemba', 'sapopemba', '  Sapopemba  ', 'SAPOPEMBA'];
        const chaves = new Set(grafias.map(canonicalizarValor));
        expect(chaves.size).toBe(1);
        expect([...chaves][0]).toBe('sapopemba');
    });

    it('colapsa espaços internos, como a versão SQL', () => {
        // Mesmo caso conferido no banco: '  Sapopemba   SP  ' → 'sapopemba sp'
        expect(canonicalizarValor('  Sapopemba   SP  ')).toBe('sapopemba sp');
    });

    it('vazio e só-espaço viram null, não string vazia', () => {
        expect(canonicalizarValor('')).toBeNull();
        expect(canonicalizarValor('   ')).toBeNull();
        expect(canonicalizarValor(null)).toBeNull();
        expect(canonicalizarValor(undefined)).toBeNull();
    });

    it('NÃO remove acento — limite conhecido e documentado', () => {
        // A versão SQL exigiria a extensão `unaccent`. O teste trava a decisão
        // para que ninguém "conserte" um lado só e quebre o join.
        expect(canonicalizarValor('Butantã')).toBe('butantã');
        expect(canonicalizarValor('Butantã')).not.toBe(canonicalizarValor('Butanta'));
    });
});

describe('criterioDoRotulo — indefinido NÃO é negativo', () => {
    it('o rótulo certo faz o critério bater', () => {
        expect(criterioDoRotulo('ondeReside', 'capital')).toBe(true);
        expect(criterioDoRotulo('haQuantoTempo', 'menos_de_1_ano')).toBe(true);
        expect(criterioDoRotulo('jaFezReabilitacao', 'nunca_fez')).toBe(true);
        expect(criterioDoRotulo('paraQuemE', 'propria_pessoa')).toBe(true);
    });

    it('outro rótulo VÁLIDO refuta', () => {
        // "Mora na Grande SP" é uma resposta: sabemos, e não é a capital.
        expect(criterioDoRotulo('ondeReside', 'grande_sp')).toBe(false);
        expect(criterioDoRotulo('jaFezReabilitacao', 'fazendo_agora')).toBe(false);
    });

    it('indefinido vira null, e NÃO false', () => {
        // O coração da story. `false` diria "não mora na capital"; a verdade é
        // "não sabemos onde mora". Tratar os dois igual reprovou a rev.1 da 2.18.
        expect(criterioDoRotulo('ondeReside', 'indefinido')).toBeNull();
        expect(criterioDoRotulo('ondeReside', null)).toBeNull();
        expect(criterioDoRotulo('ondeReside', undefined)).toBeNull();
    });

    it('rótulo que não pertence ao campo é dado corrompido, não negativo', () => {
        // 'nunca_fez' em `ondeReside` é bug. Devolver `false` inventaria uma
        // refutação a partir de um defeito.
        expect(criterioDoRotulo('ondeReside', 'nunca_fez')).toBeNull();
        expect(criterioDoRotulo('paraQuemE', 'capital')).toBeNull();
    });
});

describe('integração com a nota — o que a Fernanda vê', () => {
    it('os contraexemplos medidos produzem a nota certa', () => {
        // Lead de Sapopemba (capital), lesão de 6 meses, nunca fez reab, para si:
        // com o roteiro completo dá 5/5.
        const criterios = criteriosNormalizadosDoDeal({
            ondeReside: 'capital',
            haQuantoTempo: 'menos_de_1_ano',
            jaFezReabilitacao: 'nunca_fez',
            paraQuemE: 'propria_pessoa',
        });

        const nota = computeLeadScore({ ...criterios, roteiroCompleto: true });
        expect(nota.score).toBe(5);
        expect(nota.known).toBe(5);
    });

    it('valor fora do dicionário não derruba a nota — só reduz o denominador', () => {
        // Este é o caso comum hoje: o lead falou algo que ainda não foi
        // classificado. A nota tem de continuar honesta, não punir.
        const criterios = criteriosNormalizadosDoDeal({
            ondeReside: 'capital',
            // os outros três ausentes do mapa
        });

        const nota = computeLeadScore({ ...criterios, roteiroCompleto: true });
        expect(nota.score).toBe(2);
        expect(nota.known).toBe(2); // e NÃO 5
        expect(nota.refuted).toHaveLength(0);
    });

    it('Cotia e Campinas NÃO contam como capital', () => {
        // Os falsos positivos que o casamento por texto produzia.
        const cotia = criteriosNormalizadosDoDeal({ ondeReside: 'grande_sp' });
        const campinas = criteriosNormalizadosDoDeal({ ondeReside: 'interior_sp' });

        expect(cotia.cidadeDeSaoPaulo).toBe(false);
        expect(campinas.cidadeDeSaoPaulo).toBe(false);
    });
});
