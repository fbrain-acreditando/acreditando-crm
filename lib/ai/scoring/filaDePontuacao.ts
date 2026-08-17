/**
 * @fileoverview Story 2.41 — as REGRAS da fila de pontuação, sem I/O.
 *
 * Segue o padrão do repo (`autoStage` decide, `moveOnQualified` faz I/O): a
 * decisão que impede o laço infinito precisa ser testável **sem** mock de banco.
 *
 * ## Por que este módulo existe
 *
 * A varredura anterior (`v_leads_a_pontuar`, story 2.35) reprocessava para sempre
 * o card que falhava: ele não recebia carimbo e **não contava tentativa**. Foram
 * ~2.880 chamadas/dia por 3 dias — R$ 197,83.
 *
 * A trava é uma regra de 3 linhas. O que faltava não era conhecimento — o cron
 * irmão (`stage-evaluations`) já fazia isso certo desde abril. Faltava a regra
 * estar **em um lugar só, e sob teste.**
 *
 * @module lib/ai/scoring/filaDePontuacao
 */

/**
 * Tentativas por card antes de desistir. Mesmo valor do cron irmão.
 *
 * 🔗 Contrato com o banco: `ai_pending_lead_scores.attempts` e o filtro
 * `attempts < MAX_TENTATIVAS` na leitura da fila.
 */
export const MAX_TENTATIVAS = 3;

export type StatusDaFila = 'pending' | 'processing' | 'completed' | 'failed';

export interface DesfechoDaTentativa {
  status: Extract<StatusDaFila, 'pending' | 'failed'>;
  attempts: number;
  /** `true` quando o card sai da fila de vez — o oposto do defeito da 2.35. */
  encerrado: boolean;
}

/**
 * Decide o que acontece com um item da fila que **falhou**.
 *
 * @param attempts tentativas JÁ consumidas antes desta
 * @param consomeTentativa `false` para falha de **ambiente** (chave de IA
 *   ausente). O card não tem culpa, e queimar as 3 tentativas dele faria com que
 *   repor a chave encontrasse a fila inteira morta — trocar uma sangria por uma
 *   fila envenenada não é conserto.
 */
export function decidirDesfechoDaTentativa(
  attempts: number,
  consomeTentativa = true
): DesfechoDaTentativa {
  const tentativas = consomeTentativa ? attempts + 1 : attempts;
  const encerrado = consomeTentativa && tentativas >= MAX_TENTATIVAS;

  return {
    status: encerrado ? 'failed' : 'pending',
    attempts: tentativas,
    encerrado,
  };
}

/**
 * O item ainda pode ser processado numa próxima rodada?
 *
 * Espelha o filtro da query (`status='pending'` + `attempts < MAX_TENTATIVAS`).
 * Existe para que a regra tenha teste — a query, sozinha, não tem.
 */
export function itemElegivelParaRodada(item: {
  status: StatusDaFila;
  attempts: number;
}): boolean {
  return item.status === 'pending' && item.attempts < MAX_TENTATIVAS;
}

export interface EstadoDoCard {
  /** `null` quando o card não existe mais ou está excluído. */
  existe: boolean;
  /** Carimbo `pontuada_pela_ia_em`. */
  jaPontuado: boolean;
  /** `lead_score_source === 'manual'`. */
  notaManual: boolean;
  /** O estágio atual tem `pontua_lead = true`. */
  emEstagioQuePontua: boolean;
}

export type MotivoDeDispensa =
  | 'deal_inexistente'
  | 'ja_pontuado'
  | 'nota_manual'
  | 'saiu_da_coluna';

/**
 * O card enfileirado ainda merece uma chamada de IA?
 *
 * Entre o enfileiramento e a rodada, a Fernanda pode ter arrastado o card para
 * fora da coluna, dado a nota na mão ou excluído o lead. Pagar pela IA nesses
 * casos é gastar para escrever o que ninguém quer — e é dispensa, **não falha**:
 * não consome tentativa e fecha o item.
 */
export function motivoParaDispensar(
  estado: EstadoDoCard
): MotivoDeDispensa | null {
  if (!estado.existe) return 'deal_inexistente';
  if (estado.jaPontuado) return 'ja_pontuado';
  if (estado.notaManual) return 'nota_manual';
  if (!estado.emEstagioQuePontua) return 'saiu_da_coluna';
  return null;
}
