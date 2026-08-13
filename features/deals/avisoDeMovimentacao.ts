/**
 * @fileoverview O aviso quando mover um card falha (story 2.37)
 *
 * Funções **puras**: sem React, sem toast, sem Supabase. O hook decide *quando*
 * chamar; aqui mora *o que dizer* — que é a parte que precisa de teste.
 *
 * ============================================================================
 * POR QUE ISTO EXISTE
 * ============================================================================
 * O `onError` do `useMoveDeal` fazia rollback do cache e **descartava o erro**
 * (`_err`). O card voltava para a coluna de origem **em silêncio** — e a
 * [[Fernanda]] descobriu sozinha, 1h30 depois, movendo tudo de novo e
 * **sobrescrevendo o motivo da perda** no caminho.
 *
 * Era a pendência nº 3 do CRM, escrita em 12/08 como *"próxima armadilha da
 * mesma família"*. Mordeu em 13/08.
 *
 * @module features/deals/avisoDeMovimentacao
 */

/** Board mínimo que o aviso precisa conhecer — não importa o tipo inteiro. */
interface BoardComEstagios {
    stages?: { id: string; name?: string | null }[];
}

/**
 * Nome do estágio de destino, para o aviso poder dizer *para onde* falhou.
 *
 * Tolerante de propósito: `board` sem `stages`, id inexistente ou nome vazio
 * devolvem `null` — um aviso é melhor **sem** o nome do que quebrando na hora de
 * avisar sobre uma falha. Erro dentro do tratamento de erro é o pior lugar.
 */
export function nomeDoEstagioDestino(
    board: BoardComEstagios | null | undefined,
    targetStageId: string | null | undefined
): string | null {
    if (!board?.stages || !targetStageId) return null;
    const estagio = board.stages.find(s => s.id === targetStageId);
    const nome = estagio?.name?.trim();
    return nome ? nome : null;
}

/**
 * Requisição abortada NÃO é falha de gravação.
 *
 * Acontece quando ela navega para outra tela ou o componente desmonta no meio da
 * chamada. Avisar aqui ensinaria a ignorar o aviso — e um aviso que se aprende a
 * ignorar não protege ninguém no dia em que a falha é real.
 */
export function deveAvisarDeFalha(erro: unknown): boolean {
    const nome = (erro as { name?: unknown } | null)?.name;
    if (typeof nome === 'string' && (nome === 'AbortError' || nome === 'CancelledError')) {
        return false;
    }

    const mensagem = resumoTecnico(erro).toLowerCase();
    if (mensagem.includes('abort') || mensagem.includes('cancel')) return false;

    return true;
}

/**
 * A mensagem que ela lê na tela.
 *
 * Três exigências, todas com história neste projeto:
 *
 * 1. **Diz o que aconteceu com o card** — *"voltou para a coluna anterior"*. Sem
 *    isso ela vê o card fora do lugar e conclui que o sistema perdeu o
 *    trabalho, que é exatamente a desconfiança de 12/08.
 * 2. **Diz o que fazer** — *"tente de novo"*. Aviso sem saída é o defeito da
 *    story 2.28 com outra roupa.
 * 3. **Não vaza linguagem de sistema** (AC2). A IA da Livre já foi cobrada por
 *    dizer *"não encontrei na base"*; `PGRST116` na tela dela é a mesma falha.
 *    O detalhe técnico existe — vai para o `console.error` via `resumoTecnico`.
 */
export function mensagemDeFalhaAoMover(nomeDoEstagio: string | null | undefined): string {
    const destino = nomeDoEstagio?.trim();
    const alvo = destino ? ` para "${destino}"` : '';
    return `Não foi possível mover o card${alvo}. Ele voltou para a coluna anterior — tente de novo.`;
}

/**
 * O detalhe técnico, para o `console.error` — nunca para a tela.
 *
 * Existe para que ligar o aviso **não** custe o diagnóstico: o `onError` antigo
 * era mudo para ela *e* para quem depura.
 */
export function resumoTecnico(erro: unknown): string {
    if (erro instanceof Error) return erro.message;
    if (typeof erro === 'string') return erro;
    if (erro && typeof erro === 'object') {
        const m = (erro as { message?: unknown }).message;
        if (typeof m === 'string') return m;
        try {
            return JSON.stringify(erro);
        } catch {
            return '[erro não serializável]';
        }
    }
    return String(erro);
}
