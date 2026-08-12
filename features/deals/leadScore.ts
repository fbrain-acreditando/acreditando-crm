/**
 * @fileoverview Nota de prioridade do lead — as estrelas do card (story 2.18a)
 *
 * Função **pura**: sem I/O, sem Supabase, sem IA (AC1). Recebe os cinco
 * critérios já resolvidos em `true` / `false` / `null` e devolve a nota com a
 * explicação inteira.
 *
 * ============================================================================
 * A REGRA, e por que ela é contagem e não curva
 * ============================================================================
 * A frase original do Filipe (07/08, com a Fernanda confirmando) era:
 *   "lesão a menos de um ano + é de São Paulo + não fez tratamento em lugar
 *    nenhum → CINCO estrelas"
 *
 * ⇒ Cinco estrelas = todos os critérios batendo. A nota é **quantos bateram**.
 * Qualquer curva ou peso inventado aqui seria precisão que o dado não tem — o
 * risco nº 3 da story ("escala engana").
 *
 * ============================================================================
 * `null` NÃO É `false` — é o coração desta story (AC2)
 * ============================================================================
 * Medido em 12/08: **210 dos 318 cards vivos não têm critério nenhum conhecido**
 * (o lead abandonou o roteiro antes de responder). Se ausência puxasse a nota
 * para baixo, 66% do board viraria "1 estrela" e a coluna deixaria de informar —
 * exatamente o defeito que reprovou a rev. 1 desta story.
 *
 * Por isso existem TRÊS estados por critério, e não dois:
 *   • `true`  → bateu       (conta ponto)
 *   • `false` → refutado    (não conta, MAS conta no denominador)
 *   • `null`  → desconhecido (não conta em lugar nenhum)
 *
 * @module features/deals/leadScore
 */

// =============================================================================
// Tipos
// =============================================================================

export type CriterioId =
    | 'roteiroCompleto'
    | 'cidadeDeSaoPaulo'
    | 'lesaoRecente'
    | 'semReabilitacaoPrevia'
    | 'paraProprioLead';

/** Ordem estável — usada na tela e nos testes. */
export const CRITERIOS: readonly CriterioId[] = [
    'roteiroCompleto',
    'cidadeDeSaoPaulo',
    'lesaoRecente',
    'semReabilitacaoPrevia',
    'paraProprioLead',
] as const;

/** Rótulo que a Fernanda lê no card. */
export const ROTULO_DO_CRITERIO: Record<CriterioId, string> = {
    roteiroCompleto: 'Completou o roteiro com a IA',
    cidadeDeSaoPaulo: 'Mora na cidade de São Paulo',
    lesaoRecente: 'Lesão há menos de um ano',
    semReabilitacaoPrevia: 'Ainda não fez reabilitação',
    paraProprioLead: 'É para a própria pessoa',
};

/** `true` bateu · `false` refutado · `null` desconhecido. */
export type CriteriosDoLead = Record<CriterioId, boolean | null>;

export interface NotaDoLead {
    /** Quantos critérios bateram. `null` = SEM NOTA (nada é conhecido). */
    score: number | null;
    /** Quantos critérios eram conhecíveis — o denominador do `⭐ x/y`. */
    known: number;
    matched: CriterioId[];
    refuted: CriterioId[];
    unknown: CriterioId[];
}

// =============================================================================
// Regra
// =============================================================================

/**
 * Calcula a nota de prioridade.
 *
 * @example
 * // Lead completo que serve: 5 de 5
 * computeLeadScore({ roteiroCompleto: true, cidadeDeSaoPaulo: true, ... })
 * // → { score: 5, known: 5, ... }
 *
 * @example
 * // Lead que só completou o roteiro e nada mais se sabe
 * computeLeadScore({ roteiroCompleto: true, cidadeDeSaoPaulo: null, ... })
 * // → { score: 1, known: 1 }  ⇒ a tela mostra "⭐ 1/1", não "⭐ 1/5"
 */
export function computeLeadScore(criterios: Partial<CriteriosDoLead>): NotaDoLead {
    const matched: CriterioId[] = [];
    const refuted: CriterioId[] = [];
    const unknown: CriterioId[] = [];

    for (const id of CRITERIOS) {
        const valor = criterios[id];
        // `undefined` (chave ausente no objeto) é tratado como desconhecido, não
        // como erro: um critério novo pode ser adicionado antes de existir dado
        // para ele, e a nota tem de continuar respondendo.
        if (valor === true) matched.push(id);
        else if (valor === false) refuted.push(id);
        else unknown.push(id);
    }

    const known = matched.length + refuted.length;

    return {
        // Zero conhecido ⇒ SEM NOTA. Devolver 0 aqui afirmaria "nenhum critério
        // bateu", quando a verdade é "não perguntamos nada ainda".
        score: known === 0 ? null : matched.length,
        known,
        matched,
        refuted,
        unknown,
    };
}

/**
 * Texto curto para o card: `⭐ 3/5` — ou o aviso de que não há dado.
 *
 * O denominador é obrigatório na tela por decisão do @po: sem ele, um lead novo
 * com 1 acerto e 4 incógnitas fica visualmente idêntico a um lead investigado
 * que só acertou 1 de 5 — e os dois pedem ações opostas.
 */
export function formatarNota(nota: NotaDoLead): string {
    if (nota.score === null) return 'sem dado';
    return `${nota.score}/${nota.known}`;
}

/**
 * Ordenação da fila de trabalho.
 *
 * Ordena por nota e, no empate, por **quantos critérios sustentam** aquela nota:
 * `2/2` vem antes de `2/5`, porque o segundo tem três critérios já refutados.
 * Card sem nota vai para o fim — não disputa o topo com card medido.
 *
 * @returns negativo se `a` vem primeiro (compatível com `Array.prototype.sort`)
 */
export function compararPorPrioridade(a: NotaDoLead, b: NotaDoLead): number {
    if (a.score === null && b.score === null) return 0;
    if (a.score === null) return 1;
    if (b.score === null) return -1;

    if (a.score !== b.score) return b.score - a.score;

    // Mesmo número de acertos: ganha quem tem MENOS refutados, isto é, menor
    // denominador para a mesma nota.
    return a.known - b.known;
}
