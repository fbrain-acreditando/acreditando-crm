/**
 * Story 2.52, AC5 — o telefone sai normalizado, e o que não é telefone não sai.
 */
import { describe, expect, it } from 'vitest';
import {
  chavesDaConversa,
  formatarTelefoneParaExibir,
  mascararTelefone,
  normalizarTelefoneWhatsApp,
  numeroComNonoDigito,
} from './telefone';

describe('normalizarTelefoneWhatsApp (AC5)', () => {
  it('E.164 com o 9º dígito ⇒ 13 dígitos', () => {
    expect(normalizarTelefoneWhatsApp('+5512997534278')).toBe('5512997534278');
  });

  it('E.164 sem o 9º dígito ⇒ 12 dígitos, sem inventar o 9', () => {
    expect(normalizarTelefoneWhatsApp('+553598205552')).toBe('553598205552');
  });

  it('máscara e espaços ⇒ só dígitos, com o país prefixado', () => {
    expect(normalizarTelefoneWhatsApp('(12) 99753-4278')).toBe('5512997534278');
  });

  it('0 de discagem na frente ⇒ tirado antes de prefixar 55', () => {
    expect(normalizarTelefoneWhatsApp('012 99753-4278')).toBe('5512997534278');
    expect(normalizarTelefoneWhatsApp('0055 12 99753-4278')).toBe('5512997534278');
  });

  it('fora de 12–13 dígitos ou sem país BR ⇒ null (a rota responde 422)', () => {
    expect(normalizarTelefoneWhatsApp('99753-4278')).toBeNull();
    expect(normalizarTelefoneWhatsApp('+1 415 555 2671')).toBeNull();
    expect(normalizarTelefoneWhatsApp('27870562914352@lid')).toBeNull();
    expect(normalizarTelefoneWhatsApp('')).toBeNull();
    expect(normalizarTelefoneWhatsApp(null)).toBeNull();
  });
});

describe('chavesDaConversa', () => {
  it('celular com 9 ⇒ a própria forma primeiro e a sem 9 depois', () => {
    expect(chavesDaConversa('CANAL', '5512997534278')).toEqual([
      'CANAL-5512997534278',
      'CANAL-551297534278',
    ]);
  });

  it('celular antigo sem 9 ⇒ também a forma com 9', () => {
    expect(chavesDaConversa('CANAL', '553598205552')).toEqual([
      'CANAL-553598205552',
      'CANAL-5535998205552',
    ]);
  });

  it('fixo ⇒ só a própria forma', () => {
    expect(chavesDaConversa('CANAL', '551232345678')).toEqual(['CANAL-551232345678']);
  });
});

describe('mascararTelefone (AC7)', () => {
  it('guarda só o começo e o fim', () => {
    expect(mascararTelefone('5512997534278')).toBe('5512*****4278');
    expect(mascararTelefone('553598205552')).toBe('5535****5552');
  });
});

describe('numeroComNonoDigito (story 2.77, AC1)', () => {
  it('DDD 11 com 8 dígitos ⇒ põe o 9 depois do DDD', () => {
    expect(numeroComNonoDigito('551187654321')).toBe('5511987654321');
  });
  it('DDD 31 com 8 dígitos ⇒ mesma regra (vale para qualquer DDD)', () => {
    expect(numeroComNonoDigito('553187654321')).toBe('5531987654321');
  });
  it('já com 9 dígitos (13) ⇒ null', () => {
    expect(numeroComNonoDigito('5511987654321')).toBeNull();
  });
  it('estrangeiro com 12 dígitos ⇒ null', () => {
    expect(numeroComNonoDigito('351912345678')).toBeNull();
  });
  it('vazio/nulo ⇒ null', () => {
    expect(numeroComNonoDigito('')).toBeNull();
    expect(numeroComNonoDigito(null)).toBeNull();
  });
});

describe('formatarTelefoneParaExibir (story 2.77, D5)', () => {
  it('13 dígitos ⇒ +55 (DD) 99999-9999', () => {
    expect(formatarTelefoneParaExibir('+5511987654321')).toBe('+55 (11) 98765-4321');
  });
  it('12 dígitos ⇒ +55 (DD) 9999-9999', () => {
    expect(formatarTelefoneParaExibir('+551187654321')).toBe('+55 (11) 8765-4321');
  });
  it('sem país (11 dígitos) ⇒ assume Brasil', () => {
    expect(formatarTelefoneParaExibir('(11) 98765-4321')).toBe('+55 (11) 98765-4321');
  });
  it('estrangeiro ⇒ + e os dígitos', () => {
    expect(formatarTelefoneParaExibir('+351912345678')).toBe('+351912345678');
  });
  it('vazio ⇒ null', () => {
    expect(formatarTelefoneParaExibir(null)).toBeNull();
    expect(formatarTelefoneParaExibir('  ')).toBeNull();
  });
});
