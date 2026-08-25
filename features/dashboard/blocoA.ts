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

// =============================================================================
// Story 2.48 — a fila que ABRE
// =============================================================================

/**
 * A frase do card, agora que ele conta o RECORTE do funil.
 *
 * 🔑 A definição antiga prometia "conversas que exigem ação sua" e entregava
 * "conversas abertas". A 2.48 não conserta isso classificando intenção — ela
 * conserta **mostrando quem são**. Então o texto para de prometer julgamento e
 * passa a dizer, literalmente, o que a conta faz e o que ela deixa de fora.
 */
export function definicaoDaEsperaNoFunil(horasDoLimite: number): string {
    return `Pessoas com card no funil ativo em que o lead falou por último. Clique para ver quem são e o que escreveram. "Passou do limite" conta as que estão assim há mais de ${horasDoLimite}h.`;
}

/**
 * A frase que explica o desconto — o que saiu da conta, e por quê.
 *
 * ⚠️ Obrigatória. Descontar 36 conversas de um número que já circulou em reunião
 * **sem dizer** é a forma mais rápida de o painel mentir sem uma linha errada:
 * ela veria "58" onde ontem havia "94" e concluiria que a fila caiu sozinha.
 *
 * @returns a frase, ou `null` quando não há desconto nenhum a explicar.
 */
export function resumoDoDesconto(foraDoFunil: number, semCard: number): string | null {
    const partes: string[] = [];

    if (foraDoFunil > 0) {
        partes.push(
            `${foraDoFunil} ${foraDoFunil === 1 ? 'está' : 'estão'} em Ganho, Perdido ou nas colunas de categoria`
        );
    }
    if (semCard > 0) {
        partes.push(
            `${semCard} ${semCard === 1 ? 'não virou card' : 'não viraram card'} no CRM`
        );
    }

    if (partes.length === 0) return null;

    const total = foraDoFunil + semCard;
    return `${total} ${total === 1 ? 'conversa espera' : 'conversas esperam'} fora desta conta: ${partes.join(' e ')}.`;
}

/**
 * O rótulo de tempo de um item da lista.
 *
 * Horas cruas ("73.4h") obrigam a fazer conta de cabeça no meio da fila. O
 * corte em 48h é onde "ontem" deixa de ser útil e o número de dias passa a ser
 * a informação — mesma régua que ela usa falando ("faz três dias que mandei").
 */
export function rotuloDaEspera(horas: number): string {
    if (horas < 1) return 'agora há pouco';
    if (horas < 48) return `há ${Math.floor(horas)}h`;
    return `há ${Math.floor(horas / 24)} dias`;
}

/**
 * O que mostrar quando a última mensagem do lead não é texto.
 *
 * 📌 Medido em 24/08: dos 56 que esperavam dentro do funil, **6 eram áudio e 4
 * imagem**. Nenhuma regra de texto os enxerga — e é justamente por isso que a
 * lista não pode fingir que estão vazios. Dizer "áudio" é informação; deixar a
 * linha em branco é a lista dizendo que não há nada ali.
 */
export function textoDoItem(tipo: string, texto: string | null): string {
    const limpo = (texto ?? '').trim();
    if (limpo) return limpo;

    switch (tipo) {
        case 'audio':
            return '🎤 Áudio — abra para ouvir';
        case 'image':
            return '🖼️ Imagem — abra para ver';
        case 'video':
            return '🎬 Vídeo — abra para ver';
        case 'document':
            return '📎 Documento — abra para ver';
        default:
            return 'Sem texto legível — abra a conversa';
    }
}
