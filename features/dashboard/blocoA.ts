/**
 * @fileoverview Bloco A do painel — regras puras (story 2.19)
 *
 * A fila viva da atendente: o que ela faz AGORA. Separado do componente pelo
 * mesmo motivo do `blocoB.ts` — são decisões que precisam de teste, e testar
 * decisão dentro de JSX custa montar a árvore inteira.
 *
 * 🔑 Por que este bloco existe: lendo só o Bloco B, a Fernanda concluiu em áudio
 * que *"meu chefe vai me substituir por uma IA"*. Ela não interpretou mal — o
 * painel media o que a IA fez e não media o que só ela faz. Este arquivo é a
 * metade que faltava.
 *
 * @module features/dashboard/blocoA
 */

/**
 * A frase de denominador do "prontos para ligar".
 *
 * 🔑 Por que é obrigatória: a IA da story 2.35 só pontua card que entra em
 * `Qualificado` — em 14/08 eram **68 de 370** cards vivos. Sem a frase, "23
 * prontos para ligar" se lê como *"de tudo que existe, 23 prestam"*, quando o
 * certo é *"dos 68 que a IA leu, 23 batem os dois critérios"*.
 *
 * É a mesma lição que a story 2.18 já pagou com o `★ 1/1` × `★ 1/5`: nota sem
 * denominador afirma um alcance que não se mediu.
 *
 * @returns a frase, ou `null` quando não há card pontuado (aí o número não tem
 *          o que qualificar — quem trata esse caso é `semBaseParaLigar`)
 */
export function avisoDeAlcanceDaIa(
    pontuadosPelaIa: number,
    cardsVivos: number
): string | null {
    if (pontuadosPelaIa <= 0) return null;
    if (cardsVivos <= 0) return null;
    if (pontuadosPelaIa >= cardsVivos) return null;

    return `Contado sobre os ${pontuadosPelaIa} cards que a IA leu (de ${cardsVivos}). Ela só pontua quem entra em Qualificado.`;
}

/**
 * Quando o "prontos para ligar" não tem base nenhuma para ser calculado.
 *
 * Devolver `0` aqui seria dizer *"não há ninguém pronto"*, que é uma afirmação
 * sobre os leads. A verdade é outra: **ninguém foi avaliado ainda**. Mesma
 * regra do `percentualSemResposta` do Bloco B — 0/0 não é 0.
 */
export function semBaseParaLigar(pontuadosPelaIa: number): boolean {
    return pontuadosPelaIa <= 0;
}

/**
 * O tom do card "passou do limite".
 *
 * Não é enfeite: este é o único número do painel que aponta trabalho ATRASADO,
 * e ele aparece na tela de quem já teme ser mal avaliada. A regra é conservadora
 * de propósito — só vira alarme quando a maior parte da fila estourou o prazo.
 *
 * - `bom`     — nada passou do limite
 * - `atencao` — há atrasados, mas são a minoria da fila
 * - `alarme`  — a maior parte de quem espera já passou do limite
 */
export function tomDoAtraso(
    passouDoLimite: number,
    esperandoPorMim: number
): 'bom' | 'atencao' | 'alarme' {
    if (passouDoLimite <= 0) return 'bom';
    if (esperandoPorMim <= 0) return 'atencao';
    return passouDoLimite / esperandoPorMim >= 0.5 ? 'alarme' : 'atencao';
}

/**
 * A frase do card "esperando minha resposta".
 *
 * ⚠️ O texto diz **por que** a conversa está na fila (o lead falou por último),
 * não só quantas são. Sem isso o número vira cobrança sem recurso: ela olha "67"
 * e não sabe o que fazer com ele.
 */
export function definicaoDaEspera(horasDoLimite: number): string {
    return `Conversas que já saíram da IA e em que o lead falou por último — a resposta está com você. "Passou do limite" conta as que estão assim há mais de ${horasDoLimite}h.`;
}
