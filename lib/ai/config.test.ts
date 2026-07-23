import { describe, it, expect, vi, beforeEach } from 'vitest';

const googleFactory = vi.fn((modelId: string) => ({ modelId }));

vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: vi.fn(() => googleFactory),
}));

import { getModel, isValidGoogleModelId } from './config';
import { AI_DEFAULT_MODELS } from './defaults';

describe('isValidGoogleModelId', () => {
  it('aceita modelos atuais da conta, inclusive os que não existiam quando o código foi escrito', () => {
    // Regressão: estes IDs eram rejeitados pela antiga lista branca fixa.
    for (const id of [
      'gemini-3-flash-preview',
      'gemini-3.1-pro-preview',
      'gemini-2.5-flash',
      'gemini-2.5-pro',
      'gemini-flash-latest',
      'gemini-pro-latest',
    ]) {
      expect(isValidGoogleModelId(id), id).toBe(true);
    }
  });

  it('rejeita vazio e formatos fora do padrão Gemini', () => {
    for (const id of ['', 'gpt-4o', 'claude-3-5-sonnet', 'models/gemini-2.5-flash', 'Gemini-2.5-Flash']) {
      expect(isValidGoogleModelId(id), id).toBe(false);
    }
  });

  it('bloqueia path traversal e injeção na URL da API', () => {
    for (const id of [
      'gemini-2.5-flash/../../secret',
      'gemini-2.5-flash:generateContent?key=x',
      'gemini-2.5-flash#frag',
      'gemini-2.5 flash',
      `gemini-${'a'.repeat(200)}`,
    ]) {
      expect(isValidGoogleModelId(id), id).toBe(false);
    }
  });
});

describe('getModel', () => {
  beforeEach(() => {
    googleFactory.mockClear();
  });

  it('usa o modelo escolhido pela organização', () => {
    getModel('google', 'chave-teste', 'gemini-3-flash-preview');
    expect(googleFactory).toHaveBeenCalledWith('gemini-3-flash-preview');
  });

  it('cai no padrão quando o modelo é inválido ou ausente', () => {
    getModel('google', 'chave-teste', '');
    expect(googleFactory).toHaveBeenCalledWith(AI_DEFAULT_MODELS.google);
  });

  it('o padrão é um alias -latest (não pode ser versão fixa, que o Google aposenta)', () => {
    expect(AI_DEFAULT_MODELS.google).toMatch(/-latest$/);
  });

  it('exige API key', () => {
    expect(() => getModel('google', '', 'gemini-2.5-flash')).toThrow('API Key is missing');
  });
});
