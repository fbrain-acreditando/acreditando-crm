/**
 * Story 2.52, AC5 — o telefone sai normalizado, e o que não é telefone não sai.
 */
import { describe, expect, it } from 'vitest';
import { chavesDaConversa, mascararTelefone, normalizarTelefoneWhatsApp } from './telefone';

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
