/**
 * Story 2.67 (AC5) — normaliza texto para COMPARAR (nunca para gravar):
 * `trim` + sem acento (NFD sem diacríticos) + minúsculas + espaços colapsados.
 *
 * ⚠️ É o espelho da função do banco `public.texto_de_busca(text)` (migration
 * `20261103180000_onde_mora_e_observacao_da_perda.sql`), usada pelos campos
 * calculados `lead_location_busca(deals)` e `loss_reason_chave(deals)`. A Lista
 * de Perdidos da 2.68 manda para o banco o termo normalizado aqui e compara com
 * o que o banco normalizou lá: **mudar uma exige mudar a outra**.
 *
 * `null`/`undefined` viram `''` (no banco, o vazio vira `NULL`; para o filtro
 * os dois são "sem local").
 */
export function normalizarTexto(valor: string | null | undefined): string {
  if (!valor) return '';
  return valor
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
