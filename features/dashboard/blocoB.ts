/**
 * @fileoverview Bloco B do painel — regras puras (story 2.19)
 *
 * Separado do componente de propósito: são as decisões que precisam de teste,
 * e testar decisão dentro de JSX custa montar a árvore inteira.
 *
 * @module features/dashboard/blocoB
 */

/** Fuso da operação. Ela conta o mês em horário de São Paulo, não em UTC. */
export const FUSO_DA_OPERACAO = 'America/Sao_Paulo';

/**
 * Percentual de leads que chegaram e ninguém respondeu.
 *
 * Devolve `null` quando não chegou ninguém — 0/0 não é 0%, é "não houve base".
 * Mostrar "0%" num mês sem lead é afirmar um desempenho que não aconteceu.
 */
export function percentualSemResposta(
    semResposta: number,
    chegaram: number
): number | null {
    if (chegaram <= 0) return null;
    return (semResposta / chegaram) * 100;
}

/**
 * O aviso de cobertura de dados, quando o período pedido começa ANTES de o CRM
 * existir.
 *
 * 🔑 Por que isto existe: o CRM só registra conversa desde **24/07/2026**. Pedir
 * "julho inteiro" devolveria um número que parece resposta e é recorte — e o
 * painel antigo dela dava 963 para julho, número que este CRM **não reproduz**.
 * A story 2.24 ainda apagou fisicamente os deals de julho, então nesse mês
 * "ganhos" e "perdidos" são estruturalmente zero.
 *
 * Um número sem essa frase embaixo é o tipo de número que não sobrevive à
 * primeira pergunta numa reunião de diretoria.
 *
 * @returns a frase a exibir, ou `null` quando o período está inteiro coberto
 */
export function avisoDeCobertura(
    coberturaDesde: string | null | undefined,
    inicioDoPeriodo: string
): string | null {
    if (!coberturaDesde) return null;

    const cobertura = new Date(coberturaDesde);
    const inicio = new Date(inicioDoPeriodo);
    if (Number.isNaN(cobertura.getTime()) || Number.isNaN(inicio.getTime())) return null;

    if (cobertura <= inicio) return null;

    const dia = cobertura.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone: FUSO_DA_OPERACAO,
    });

    return `O período começa antes do CRM: só há registro a partir de ${dia}. Os números abaixo cobrem de ${dia} em diante.`;
}
