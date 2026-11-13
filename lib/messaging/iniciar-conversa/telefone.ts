/**
 * @fileoverview Telefone do lead para o WhatsApp — story 2.52, AC5.
 *
 * Uma normalização só, usada pela rota que inicia conversa:
 * só dígitos ⇒ tira o `0` inicial ⇒ prefixa `55` quando vier sem o país ⇒
 * 12 ou 13 dígitos (o formato que o AC0a provou: `5512997534278`).
 *
 * ⚠️ Só serve para MANDAR e para PROCURAR. O telefone gravado no contato nunca é
 * alterado por aqui.
 *
 * @module lib/messaging/iniciar-conversa/telefone
 */

import { variantesDoTelefone } from '@/lib/meta-form/telefone';

/**
 * Dígitos do telefone no formato que o `start-conversation` aceita
 * (`55` + DDD + número), ou `null` quando não dá para confiar no número.
 */
export function normalizarTelefoneWhatsApp(entrada: string | null | undefined): string | null {
  const bruto = String(entrada ?? '').trim();
  let digitos = bruto.replace(/\D/g, '');
  if (!digitos) return null;

  // Com `+` (ou `00`) o país já veio: nunca prefixar 55 num número estrangeiro.
  const jaTemPais = bruto.startsWith('+') || digitos.startsWith('00');

  // `0` de discagem (ex.: "012 99753-4278" ou "0055…").
  digitos = digitos.replace(/^0+/, '');

  // DDD + número (10 ou 11 dígitos) ⇒ falta o país.
  if (!jaTemPais && (digitos.length === 10 || digitos.length === 11)) digitos = `55${digitos}`;

  if (digitos.length < 12 || digitos.length > 13) return null;
  if (!digitos.startsWith('55')) return null;
  return digitos;
}

/**
 * Chaves da conversa (`<canal do fornecedor>-<dígitos>`) nas duas formas do mesmo
 * celular — com e sem o 9º dígito. Mesma regra da 2.63 (`variantesDoTelefone`).
 * A primeira é a forma do próprio número.
 */
export function chavesDaConversa(canalDoFornecedor: string, digitos: string): string[] {
  const chaves = [`${canalDoFornecedor}-${digitos}`];
  const formas = variantesDoTelefone(`+${digitos}`);
  for (const forma of formas?.variantes ?? []) {
    const chave = `${canalDoFornecedor}-${forma.replace(/\D/g, '')}`;
    if (!chaves.includes(chave)) chaves.push(chave);
  }
  return chaves;
}

/**
 * Mascara qualquer sequência de 10+ dígitos de um texto livre (mensagem de erro do
 * fornecedor costuma trazer o telefone ou o chatId) antes de logar ou gravar.
 */
export function mascararDigitos(texto: string): string {
  return texto.replace(/\d{10,}/g, (d) => mascararTelefone(d));
}

/** `5512997534278` ⇒ `5512*****4278` (AC7: o registro não guarda o número inteiro). */
export function mascararTelefone(digitos: string): string {
  if (digitos.length <= 8) return '*'.repeat(digitos.length);
  return `${digitos.slice(0, 4)}${'*'.repeat(digitos.length - 8)}${digitos.slice(-4)}`;
}
