/**
 * Story 2.74 (AC2, D2, D3) — as peças puras da busca no banco.
 * Afirma a STRING EXATA que entra no `.or()` do PostgREST.
 */
import { describe, expect, it } from 'vitest';
import {
  filtroDeCardsParaBusca,
  filtroDeContatosParaBusca,
  termoSeguroParaBusca,
} from './buscaDeCards';

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';

describe('termoSeguroParaBusca (D3)', () => {
  it.each([
    ['Joana', 'Joana'],
    ['  Lucia   Prado  ', 'Lucia Prado'],
    ['Silva, Ana (mãe)', 'Silva Ana mãe'],
    ['a_b c', 'a\\_b c'],
    ['50% off', '50 off'],
    ['ana*', 'ana'],
    ['"ana"', 'ana'],
    ['an\\a', 'an a'],
    ['a:b:c', 'a b c'],
  ])('%j → %j', (entrada, esperado) => {
    expect(termoSeguroParaBusca(entrada)).toBe(esperado);
  });

  it.each([['ab'], [''], ['   '], ['%'], ['*'], ['_'], ['%%%'], ['(,)'], ['a%b'], [null], [undefined]])(
    '%j não vai ao banco (null)',
    entrada => {
      expect(termoSeguroParaBusca(entrada as string)).toBeNull();
    }
  );

  it('termo de 200 letras é cortado em 60', () => {
    const termo = termoSeguroParaBusca('a'.repeat(200));
    expect(termo).toBe('a'.repeat(60));
  });

  it('nenhum curinga sobrevive: sem %, sem *, e todo _ escapado', () => {
    const termo = termoSeguroParaBusca('x%y*z_w"q\\r,s(t)u:v')!;
    expect(termo).not.toMatch(/[%*,()"":]/);
    expect(termo.replace(/\\_/g, '')).not.toContain('_');
  });
});

describe('filtroDeContatosParaBusca (D2)', () => {
  it('Joana → só o nome, sem telefone', () => {
    expect(filtroDeContatosParaBusca('Joana')).toBe('name.ilike.%Joana%');
  });

  it('🎯 o mesmo número com e sem +55, DDD, o 9 e formatação → o MESMO filtro de telefone (8 últimos)', () => {
    const variantes = [
      '+55 (11) 91234-5678',
      '(11) 91234-5678',
      '11912345678',
      '91234-5678',
      '1234-5678',
      '11 1234-5678',
      '+551112345678',
    ];
    for (const v of variantes) {
      const filtro = filtroDeContatosParaBusca(v)!;
      expect(filtro.split(',').pop(), v).toBe('phone.ilike.%12345678%');
    }
  });

  it('+55 (11) 91234-5678 → expressão exata', () => {
    expect(filtroDeContatosParaBusca('+55 (11) 91234-5678')).toBe(
      'name.ilike.%+55 11 91234-5678%,phone.ilike.%12345678%'
    );
  });

  it('5678 (só o final) → phone.ilike.%5678%', () => {
    expect(filtroDeContatosParaBusca('5678')).toBe('name.ilike.%5678%,phone.ilike.%5678%');
  });

  it('Maria 2 → sem telefone (menos de 4 dígitos)', () => {
    expect(filtroDeContatosParaBusca('Maria 2')).toBe('name.ilike.%Maria 2%');
  });

  it('🎯 Silva, Ana (mãe) → expressão válida, sem vírgula nem parêntese do termo', () => {
    const filtro = filtroDeContatosParaBusca('Silva, Ana (mãe)')!;
    expect(filtro).toBe('name.ilike.%Silva Ana mãe%');
    // Uma condição só: nenhuma vírgula do termo virou separador do `.or()`.
    expect(filtro.split(',')).toHaveLength(1);
    expect(filtro).not.toMatch(/[()]/);
  });

  it('ana_b → _ literal (\\_), não curinga; a_b (2 letras) nem vai ao banco', () => {
    expect(filtroDeContatosParaBusca('ana_b')).toBe('name.ilike.%ana\\_b%');
    expect(filtroDeContatosParaBusca('a_b')).toBeNull();
  });

  it('ab → null (não consulta o banco)', () => {
    expect(filtroDeContatosParaBusca('ab')).toBeNull();
  });

  it('% e * sozinhos → null (nunca um curinga que acha tudo)', () => {
    expect(filtroDeContatosParaBusca('%')).toBeNull();
    expect(filtroDeContatosParaBusca('***')).toBeNull();
  });
});

describe('filtroDeCardsParaBusca (D3)', () => {
  it('sem contatos achados → SÓ o título (nada de contact_id.in.() vazio)', () => {
    expect(filtroDeCardsParaBusca('Joana', [])).toBe('title.ilike.%Joana%');
  });

  it('com contatos → título OU contact_id.in.(…)', () => {
    expect(filtroDeCardsParaBusca('Joana', [ID_A, ID_B])).toBe(
      `title.ilike.%Joana%,contact_id.in.(${ID_A},${ID_B})`
    );
  });

  it('ids inválidos são descartados e repetidos entram uma vez', () => {
    expect(filtroDeCardsParaBusca('Ana', ['x),title.ilike.*', ID_A, ID_A])).toBe(
      `title.ilike.%Ana%,contact_id.in.(${ID_A})`
    );
  });

  it('🎯 Silva, Ana (mãe) → título sem vírgula nem parêntese do termo', () => {
    expect(filtroDeCardsParaBusca('Silva, Ana (mãe)', [])).toBe('title.ilike.%Silva Ana mãe%');
  });

  it('termo curto → null', () => {
    expect(filtroDeCardsParaBusca('ab', [ID_A])).toBeNull();
  });
});
