/**
 * @fileoverview Variantes do telefone com e sem o 9º dígito — story 2.59, AC5 (T3.2).
 *
 * O WhatsApp grava o número como chega, muitas vezes SEM o 9º dígito
 * (`+553598205552`, `messaging-webhook-gptmaker/parser.ts:170-181`), e o
 * formulário da Meta manda COM (`+5535998205552`). Comparando igualdade pura,
 * a mesma pessoa vira dois contatos. Aqui se geram as duas formas para a busca.
 *
 * ⚠️ Só serve para BUSCAR. O telefone do contato achado nunca é alterado.
 *
 * @module lib/meta-form/telefone
 */

import { isE164, normalizePhoneE164 } from '@/lib/phone';

export interface VariantesDeTelefone {
  /** Forma para CRIAR contato novo: com o 9º dígito quando for celular BR. */
  principal: string;
  /** Todas as formas a procurar (sem repetição). */
  variantes: string[];
}

/** E.164 a partir do que a Meta/CSV manda (`p:+55…`, `5535…`, `(35) 9…`). */
export function paraE164(entrada: string | null | undefined): string | null {
  const bruto = String(entrada ?? '').replace(/^p:/i, '').trim();
  if (!bruto) return null;

  const digitos = bruto.replace(/\D/g, '');
  // "5535998205552" sem o "+": com o país BR na frente, o parser leria como número nacional.
  const candidato = !bruto.startsWith('+') && /^55\d{10,11}$/.test(digitos) ? `+${digitos}` : bruto;

  const e164 = normalizePhoneE164(candidato, { defaultCountry: 'BR' });
  return isE164(e164) ? e164 : null;
}

/**
 * Formas do mesmo número BR com e sem o 9º dígito.
 *
 * - `+55 DD 9XXXXXXXX` (13 dígitos, celular com 9) ⇒ também `+55 DD XXXXXXXX`.
 * - `+55 DD XXXXXXXX` com o primeiro dígito 6-9 (celular antigo, sem 9) ⇒ também `+55 DD 9XXXXXXXX`.
 * - Fixo (primeiro dígito 2-5) e número estrangeiro: só a própria forma.
 */
export function variantesDoTelefone(entrada: string | null | undefined): VariantesDeTelefone | null {
  const e164 = paraE164(entrada);
  if (!e164) return null;

  const m = e164.match(/^\+55(\d{2})(\d{8,9})$/);
  if (!m) return { principal: e164, variantes: [e164] };

  const [, ddd, assinante] = m;
  if (assinante.length === 9 && assinante.startsWith('9')) {
    const semNove = `+55${ddd}${assinante.slice(1)}`;
    return { principal: e164, variantes: [e164, semNove] };
  }
  if (assinante.length === 8 && /^[6-9]/.test(assinante)) {
    const comNove = `+55${ddd}9${assinante}`;
    return { principal: comNove, variantes: [comNove, e164] };
  }
  return { principal: e164, variantes: [e164] };
}
