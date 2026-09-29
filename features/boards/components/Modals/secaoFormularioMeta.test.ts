import { describe, it, expect } from 'vitest';

import {
  CHAVES_SO_DO_FORMULARIO_META,
  TITULO_SECAO_FORMULARIO_META,
  separarCamposDoFormularioMeta,
} from './secaoFormularioMeta';

/** Story 2.60 — separação pela `key`, na ordem da constante, sem duplicata. */
describe('separarCamposDoFormularioMeta (story 2.60)', () => {
  const def = (key: string, label = key) => ({ id: `id-${key}`, key, label });

  it('a constante tem exatamente as 2 chaves, na ordem de exibição', () => {
    expect(CHAVES_SO_DO_FORMULARIO_META).toEqual(['quandoPretendeIniciar', 'faixaDeInvestimentoMensal']);
  });

  it('o título tem o texto decidido pelo Filipe, com acento', () => {
    expect(TITULO_SECAO_FORMULARIO_META).toBe('📋 Preenchido pelo lead (Formulário Meta)');
  });

  it('ordena pela constante e mantém a ordem original dos demais', () => {
    const entrada = [
      def('ondeReside'),
      def('faixaDeInvestimentoMensal'),
      def('origemDoLead'),
      def('quandoPretendeIniciar'),
      def('metaLeadgenId'),
    ];
    const { doFormulario, demais } = separarCamposDoFormularioMeta(entrada);

    expect(doFormulario.map(d => d.key)).toEqual(['quandoPretendeIniciar', 'faixaDeInvestimentoMensal']);
    expect(demais.map(d => d.key)).toEqual(['ondeReside', 'origemDoLead', 'metaLeadgenId']);
  });

  it('cada definição cai em um grupo só (sem duplicata)', () => {
    const entrada = [def('quandoPretendeIniciar'), def('paraQuemE'), def('faixaDeInvestimentoMensal')];
    const { doFormulario, demais } = separarCamposDoFormularioMeta(entrada);

    expect(doFormulario.length + demais.length).toBe(entrada.length);
    expect(demais.map(d => d.key)).toEqual(['paraQuemE']);
  });

  it('decide pela key, não pelo rótulo', () => {
    const entrada = [
      def('outroCampo', 'Quando pretende iniciar'),
      def('quandoPretendeIniciar', 'Previsão de início'),
    ];
    const { doFormulario, demais } = separarCamposDoFormularioMeta(entrada);

    expect(doFormulario.map(d => d.label)).toEqual(['Previsão de início']);
    expect(demais.map(d => d.label)).toEqual(['Quando pretende iniciar']);
  });

  it('🎯 rótulo repetido: "demais" também é decidido pela key, não pelo rótulo (QA Q5)', () => {
    // Um campo de outra chave com o MESMO rótulo de um dos 2 não pode sumir.
    const entrada = [
      def('quandoPretendeIniciar', 'Quando pretende iniciar'),
      def('origemDoLead', 'Quando pretende iniciar'),
      def('faixaDeInvestimentoMensal', 'Faixa de investimento mensal'),
    ];
    const { doFormulario, demais } = separarCamposDoFormularioMeta(entrada);

    expect(doFormulario.map(d => d.key)).toEqual(['quandoPretendeIniciar', 'faixaDeInvestimentoMensal']);
    expect(demais.map(d => d.key)).toEqual(['origemDoLead']);
  });

  it('sem as 2 chaves: grupo do formulário vazio e demais intactos', () => {
    const entrada = [def('ondeReside'), def('tipoDeLesao')];
    const { doFormulario, demais } = separarCamposDoFormularioMeta(entrada);

    expect(doFormulario).toEqual([]);
    expect(demais).toEqual(entrada);
  });
});
