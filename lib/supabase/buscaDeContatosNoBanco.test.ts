/**
 * Story 2.76 (AC1) — a expressão da busca de contato na seleção.
 * Afirma a STRING devolvida, não só que existe.
 */
import { describe, expect, it } from 'vitest';
import { filtroDeContatosParaSelecao } from './buscaDeContatosNoBanco';

/** Os valores dentro do `.or()` (o que vem depois de `campo.ilike.`). */
const valores = (filtro: string) =>
  filtro.split(/,(?=(?:name|email|phone)\.ilike\.)/).map(c => c.replace(/^(name|email|phone)\.ilike\./, ''));

describe('filtroDeContatosParaSelecao (story 2.76, AC1)', () => {
  it('"Ana" → nome e e-mail, sem telefone', () => {
    expect(filtroDeContatosParaSelecao('Ana')).toBe('name.ilike.%Ana%,email.ilike.%Ana%');
  });

  it('telefone com máscara → procura pelos 8 últimos dígitos', () => {
    const f = filtroDeContatosParaSelecao('(11) 9 8765-4321');
    expect(f).toContain('phone.ilike.%87654321%');
    expect(f).toBe('name.ilike.%11 9 8765-4321%,phone.ilike.%87654321%,email.ilike.%11 9 8765-4321%');
  });

  it('"Maria 2" → sem condição de telefone', () => {
    expect(filtroDeContatosParaSelecao('Maria 2')).toBe('name.ilike.%Maria 2%,email.ilike.%Maria 2%');
  });

  it.each(['ab', '%', '*', '__', '', '   ', null, undefined])('%j → null (não vai ao banco)', termo => {
    expect(filtroDeContatosParaSelecao(termo as string)).toBeNull();
  });

  it.each(['a,b(c)', 'x"y\\z:w'])('%j → nenhum caractere de sintaxe dentro dos valores', termo => {
    const f = filtroDeContatosParaSelecao(termo);
    expect(f).not.toBeNull();
    for (const v of valores(f!)) expect(v).not.toMatch(/[,()"\\:]/);
  });

  it('"a,b(c)" vira espaços', () => {
    expect(filtroDeContatosParaSelecao('a,b(c)')).toBe('name.ilike.%a b c%,email.ilike.%a b c%');
  });

  // O AC1 pede "a_b", mas ele tem só 2 letras (mínimo 3 da 2.74) → null.
  // A regra do `_` literal é provada com "ana_b".
  it('"ana_b" → o _ vira literal (\\_); "a_b" não vai ao banco', () => {
    expect(filtroDeContatosParaSelecao('ana_b')).toBe('name.ilike.%ana\\_b%,email.ilike.%ana\\_b%');
    expect(filtroDeContatosParaSelecao('a_b')).toBeNull();
  });

  it('termo de 200 caracteres → valor com no máximo 60', () => {
    const f = filtroDeContatosParaSelecao('x'.repeat(200))!;
    for (const v of valores(f)) expect(v.replace(/^%|%$/g, '').length).toBe(60);
  });
});
