/**
 * Story 2.74 — o card antigo que a busca acha.
 *
 * O quadro carrega no máximo `LIMITE_DEALS_DO_QUADRO` cards, e a busca do
 * quadro procurava só dentro deles. Cards criados em agosto (dois casos
 * reais) existiam no banco, mas a busca "não achava". Estas são as peças
 * PURAS da busca no banco: limpar o termo e montar as expressões do `.or()`.
 *
 * ⚠️ Nada aqui fala com o banco. O serviço
 * (`dealsService.searchForBoard`) usa estas funções com o cliente do usuário
 * logado (RLS) — nunca service role.
 */
import { apenasDigitos, MINIMO_DE_DIGITOS_PARA_TELEFONE } from './buscaDeContato';
import { sanitizeUUID } from './utils';

/** Tamanho máximo do termo (folga para nome completo; corta abuso). */
export const TAMANHO_MAXIMO_DO_TERMO = 60;

/** Mínimo de letras/dígitos para ir ao banco ("Ana" passa, "ab" não varre a base). */
export const MINIMO_DE_CARACTERES_PARA_BUSCA = 3;

/** Teto de cards devolvidos por busca (D6). */
export const LIMITE_DA_BUSCA_NO_BANCO = 50;

/** Teto de contatos da 1ª consulta (vira o `contact_id.in.(…)` da 2ª). */
export const LIMITE_DE_CONTATOS_DA_BUSCA = 200;

/**
 * Telefone: a partir de 8 dígitos, procura pelos 8 ÚLTIMOS (D2).
 * Os 8 últimos são iguais com e sem +55, com e sem DDD e com e sem o 9º dígito
 * (o 9 fica antes deles) — os casos da story 2.63.
 */
export const DIGITOS_FINAIS_DO_TELEFONE = 8;

/**
 * Caracteres que mudam a expressão do `.or()` do PostgREST (`,` `(` `)` `"`
 * `\` `:`) ou que viram curinga que acha tudo (`%` `*`). Viram ESPAÇO.
 *
 * Por que não reusar `escaparParaOr` (2.45): ele troca `%` por `_`, que também
 * é curinga (de 1 letra) — aqui o `_` digitado tem de ser LITERAL.
 */
const CARACTERES_PROIBIDOS = /[,()"\\:%*]/g;

/**
 * Limpa o que a pessoa digitou para entrar com segurança num `ilike` dentro do `.or()`.
 *
 * Ordem: tira espaços das pontas → corta em 60 → troca a sintaxe/curingas por
 * espaço → junta espaços repetidos → escapa `_` (`\_`, escape padrão do LIKE).
 *
 * @returns o termo seguro, ou `null` se sobrar menos de 3 letras/dígitos
 *          (aí a busca não vai ao banco).
 */
export function termoSeguroParaBusca(bruto: string | null | undefined): string | null {
  if (!bruto) return null;
  const limpo = bruto
    .trim()
    .slice(0, TAMANHO_MAXIMO_DO_TERMO)
    .replace(CARACTERES_PROIBIDOS, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const letrasEDigitos = limpo.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
  if (letrasEDigitos < MINIMO_DE_CARACTERES_PARA_BUSCA) return null;

  return limpo.replace(/_/g, '\\_');
}

/**
 * Condição de telefone pelo que foi digitado (D2), ou `null` se não há
 * dígitos suficientes para identificar alguém (`Maria 2` não procura telefone).
 */
export function condicaoDeTelefone(bruto: string): string | null {
  const digitos = apenasDigitos(bruto.slice(0, TAMANHO_MAXIMO_DO_TERMO));
  if (digitos.length < MINIMO_DE_DIGITOS_PARA_TELEFONE) return null;
  const trecho =
    digitos.length >= DIGITOS_FINAIS_DO_TELEFONE
      ? digitos.slice(-DIGITOS_FINAIS_DO_TELEFONE)
      : digitos;
  return `phone.ilike.%${trecho}%`;
}

/**
 * Expressão do `.or()` da 1ª consulta (contatos): nome + telefone.
 *
 * @returns a expressão pronta, ou `null` se o termo não vai ao banco.
 */
export function filtroDeContatosParaBusca(bruto: string): string | null {
  const termo = termoSeguroParaBusca(bruto);
  if (!termo) return null;
  const condicoes = [`name.ilike.%${termo}%`];
  const telefone = condicaoDeTelefone(bruto);
  if (telefone) condicoes.push(telefone);
  return condicoes.join(',');
}

/**
 * Expressão do `.or()` da 2ª consulta (cards): título + contatos achados.
 *
 * Sem contato achado, vai SÓ o título: `contact_id.in.()` vazio é erro de
 * sintaxe no PostgREST. Os ids passam por `sanitizeUUID` mesmo vindo do banco.
 *
 * @returns a expressão pronta, ou `null` se o termo não vai ao banco.
 */
export function filtroDeCardsParaBusca(bruto: string, idsDeContato: readonly string[]): string | null {
  const termo = termoSeguroParaBusca(bruto);
  if (!termo) return null;
  const condicoes = [`title.ilike.%${termo}%`];
  const ids = Array.from(
    new Set(idsDeContato.map(id => sanitizeUUID(id)).filter((id): id is string => !!id))
  );
  if (ids.length > 0) condicoes.push(`contact_id.in.(${ids.join(',')})`);
  return condicoes.join(',');
}
