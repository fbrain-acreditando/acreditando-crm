/**
 * Story 2.67 (AC5) — a regra de comparação do filtro "Onde mora". É o espelho
 * de `public.texto_de_busca(text)` do banco (a 2.68 depende disso).
 */
import { describe, expect, it } from 'vitest';
import { normalizarTexto } from './normalizarTexto';

describe('normalizarTexto', () => {
  it.each([
    ['  São  PAULO — Ação ', 'sao paulo — acao'],
    ['Santana — depende de apoio', 'santana — depende de apoio'],
    ['ÁÀÂÃÄ éèêë ÍÌÎÏ óòôõö ÚÙÛÜ Çç Ññ', 'aaaaa eeee iiii ooooo uuuu cc nn'],
    ['Zona\tNorte\n', 'zona norte'],
  ])('%j ⇒ %j (mesmo resultado esperado do texto_de_busca no banco)', (entrada, esperado) => {
    expect(normalizarTexto(entrada)).toBe(esperado);
  });

  it('vazio, null e undefined viram ""', () => {
    expect(normalizarTexto('')).toBe('');
    expect(normalizarTexto('   ')).toBe('');
    expect(normalizarTexto(null)).toBe('');
    expect(normalizarTexto(undefined)).toBe('');
  });
});
