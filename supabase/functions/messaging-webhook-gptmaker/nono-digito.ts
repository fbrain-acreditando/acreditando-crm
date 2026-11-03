/**
 * O mesmo telefone com e sem o 9º dígito — story 2.63, AC1.
 *
 * O WhatsApp entrega o número como ele está cadastrado no aparelho, muitas
 * vezes SEM o 9º dígito (`+55 DD XXXXXXXX`); a LP e o formulário da Meta mandam
 * COM (`+55 DD 9XXXXXXXX`). Comparando igualdade pura, a mesma pessoa vira dois
 * contatos e dois cards.
 *
 * ## Por que a regra é REPETIDA aqui (e não importada)
 *
 * A regra já existe em `lib/meta-form/telefone.ts` (`variantesDoTelefone`), mas
 * aquele arquivo importa `@/lib/phone` — alias do Next que o Deno da Edge
 * Function não resolve. O reuso é **da regra**, não do arquivo: o teste de
 * paridade (`nono-digito.test.ts`) roda a mesma tabela de casos contra as duas
 * implementações e quebra se elas divergirem.
 *
 * ## A regra
 *
 * - `+55 DD 9XXXXXXXX` com o dígito depois do 9 entre 6 e 9 ⇒ também
 *   `+55 DD XXXXXXXX`. (`9` + 2–5 ⇒ só a própria forma — QA-1.)
 * - `+55 DD XXXXXXXX` com o **1º dígito do assinante** (depois do DDD) entre 6 e 9
 *   (celular antigo, sem o 9) ⇒ também `+55 DD 9XXXXXXXX`.
 * - Fixo (assinante começando com 2–5) e número estrangeiro: só a própria forma.
 * - Vazio, `@lid`, lixo: nenhuma forma (não se inventa telefone).
 *
 * ⚠️ Só serve para BUSCAR. O telefone de contato existente nunca é alterado.
 *
 * @module supabase/functions/messaging-webhook-gptmaker/nono-digito
 */

/** `+<dígitos>` a partir do que o webhook tem; `null` quando não é telefone. */
function paraMais(entrada: string | null | undefined): string | null {
  if (typeof entrada !== "string") return null;
  const bruto = entrada.trim();
  if (!bruto || bruto.includes("@")) return null;
  if (!/^\+?\d+$/.test(bruto)) return null;
  const digitos = bruto.replace(/^\+/, "");
  if (digitos.length < 10 || digitos.length > 15) return null;
  return `+${digitos}`;
}

/**
 * Todas as formas do mesmo número, sem repetição. A primeira é a **canônica**
 * (com o 9º dígito quando for celular BR) — a mesma ordem de
 * `variantesDoTelefone(...).variantes`.
 */
export function formasDoTelefone(entrada: string | null | undefined): string[] {
  const e164 = paraMais(entrada);
  if (!e164) return [];

  const m = e164.match(/^\+55(\d{2})(\d{8,9})$/);
  if (!m) return [e164];

  const [, ddd, assinante] = m;
  // QA-1 (03/11): só `9` seguido de 6–9. `91…`–`95…` nunca existiram com 8
  // dígitos; tirar o 9 deles daria um número com cara de FIXO (outra pessoa).
  if (assinante.length === 9 && /^9[6-9]/.test(assinante)) {
    return [e164, `+55${ddd}${assinante.slice(1)}`];
  }
  if (assinante.length === 8 && /^[6-9]/.test(assinante)) {
    return [`+55${ddd}9${assinante}`, e164];
  }
  return [e164];
}

/** As OUTRAS formas do número (sem a que chegou). Vazio = não há variante. */
export function outrasFormas(entrada: string | null | undefined): string[] {
  const proprio = paraMais(entrada);
  if (!proprio) return [];
  return formasDoTelefone(proprio).filter((f) => f !== proprio);
}

/**
 * Telefone mascarado para log (AC7): os 4 primeiros e os 4 últimos dígitos.
 * `+5511987654321` ⇒ `5511*****4321`.
 */
export function mascararTelefone(entrada: string | null | undefined): string {
  const digitos = String(entrada ?? "").replace(/\D/g, "");
  if (digitos.length <= 8) return "*".repeat(digitos.length);
  return `${digitos.slice(0, 4)}${"*".repeat(digitos.length - 8)}${digitos.slice(-4)}`;
}
