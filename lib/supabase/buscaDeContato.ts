/**
 * Story 2.45 — a busca de contato não achava quem ela sabia que estava lá.
 *
 * ============================================================================
 * O RELATO E A MEDIÇÃO
 * ============================================================================
 * *"ela não aparece ali nos contatos, eu não consegui encontrá-la (…) eu tô
 * buscando no geralzão, mas tem nome que eu não tô achando."* — Fernanda, 18/08
 *
 * Duas causas medidas, e as duas atacadas aqui:
 *
 * 1. **A busca não olhava o telefone.** O filtro era `name` OU `email` — e 956
 *    dos 957 contatos não têm e-mail. Na prática, buscava-se só por nome.
 *
 * 2. **52% dos nomes são inúteis para busca por nome completo.** 496 dos 957
 *    contatos têm nome de UMA palavra só, porque vêm do `pushName` do WhatsApp
 *    (a pessoa põe "Maria", um apelido, ou nada). Quem procura "Maria Silva"
 *    não casa com o registro salvo como "Maria" — `ilike %Maria Silva%` não
 *    encontra "Maria". ⇒ **o telefone é o único identificador confiável da base.**
 *
 * ============================================================================
 * POR QUE NORMALIZAR OS DÍGITOS
 * ============================================================================
 * O telefone é gravado sem formatação (`+5511999999999`), mas ninguém digita
 * assim. Buscar `(12) 98194-5826` cru com `ilike` não casaria com nada — a busca
 * por telefone nasceria quebrada e pareceria "não achou", que é exatamente o
 * sintoma que estamos consertando.
 */

/** Só os dígitos — `(12) 98194-5826` → `12981945826`. */
export function apenasDigitos(termo: string): string {
    return termo.replace(/\D/g, '');
}

/**
 * Escapa o que o PostgREST trata como sintaxe dentro de `.or(...)`.
 *
 * ⚠️ O código anterior interpolava o texto da busca cru na string do `.or()`.
 * Uma vírgula ou parêntese digitados no campo quebravam a expressão e mudavam a
 * consulta — nome de lead com vírgula é comum. Aqui os dois viram `_`, o
 * curinga de UM caractere do `LIKE`: casa com o que o usuário digitou sem deixar
 * o caractere chegar ao parser.
 */
export function escaparParaOr(termo: string): string {
    // `%` e `*` são os curingas do `ilike` no PostgREST. Digitados no campo, eles
    // não são "texto que não acha nada" — são "casa com TUDO": buscar `%`
    // devolveria a base inteira, que é o mesmo estrago do filtro sem limite
    // abaixo. Viram `_` (curinga de um caractere) junto com a sintaxe do `.or()`.
    return termo.replace(/[(),%*]/g, '_');
}

/**
 * Mínimo de dígitos para a busca considerar que aquilo é um telefone.
 *
 * ⚠️ **Sem este piso a busca por telefone se autodestrói.** Buscar `Maria 2`
 * produziria `phone.ilike.%2%`, que casa com praticamente TODO contato que tem
 * telefone ⇒ a busca devolveria a base inteira e pareceria quebrada — trocando
 * o "não acha ninguém" que estamos consertando por um "acha todo mundo".
 *
 * 4 é o menor fragmento que ainda identifica: é o final do número, que é como
 * ela procura quando tem o contato aberto no WhatsApp e não sabe o nome salvo.
 */
export const MINIMO_DE_DIGITOS_PARA_TELEFONE = 4;

/**
 * Monta a expressão do `.or()` do PostgREST para a busca de contatos.
 *
 * @param termoBruto - o que a pessoa digitou.
 * @returns expressão pronta, ou `null` se não há o que buscar.
 */
export function filtroDeBuscaDeContato(termoBruto: string): string | null {
    const termo = termoBruto.trim();
    if (!termo) return null;

    const seguro = escaparParaOr(termo);
    const condicoes = [`name.ilike.%${seguro}%`, `email.ilike.%${seguro}%`];

    // O telefone entra por DÍGITOS, não pelo texto digitado — e só a partir de
    // um fragmento que de fato identifique alguém (ver a constante acima).
    const digitos = apenasDigitos(termo);
    if (digitos.length >= MINIMO_DE_DIGITOS_PARA_TELEFONE) {
        condicoes.push(`phone.ilike.%${digitos}%`);
    }

    return condicoes.join(',');
}
