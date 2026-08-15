/**
 * @fileoverview Arquivar ≠ reabrir (story 2.40)
 *
 * 🔑 O caso, medido em 14/08: `useMoveDeal` tem um ramo *"reopen if was
 * closed"* que zera `isWon`/`isLost` e anula `closedAt` ao mover um card
 * fechado para uma coluna comum. A intenção é legítima — arrastar um card de
 * volta para o funil **é** reabrir.
 *
 * Só que três das treze colunas deste board **não são etapa de funil, são
 * categoria** (`Clientes`, `Profissional`, `Projeto Social` — stories 2.33 e
 * 2.34). Arquivar uma venda ganha em `Clientes` não é reabrir a negociação; é
 * dizer *"esta pessoa agora é cliente"*. E o sistema apagava a venda.
 *
 * **Já mordeu 4 vezes**, todas no mesmo lote de 13/08 11:53 — quatro cards que
 * passaram por `Ganho` estão hoje com `is_won = false` e `closed_at = null`.
 *
 * @module features/deals/arquivamentoDeCard
 */

import type { BoardStage } from '@/types';

/**
 * Se mover um card fechado para esta coluna deve **preservar** a venda.
 *
 * ⚠️ A decisão vem de `board_stages.arquiva_sem_reabrir`, uma coluna do banco —
 * **nunca** do nome nem de `linkedLifecycleStage`:
 *
 * - por `linkedLifecycleStage is null` não dá: `Lead novo` também é null, e ali
 *   reabrir é o comportamento **certo**;
 * - por nome é proibido neste repo, com cicatriz: `Em qualificação ` tem espaço
 *   no fim e a story 2.33 quase apagou a coluna errada por causa disso.
 *
 * Mesma arquitetura de `board_stages.pontua_lead` (story 2.35): *qual estágio
 * faz o quê vem da coluna, não do nome.*
 *
 * Coluna desconhecida (`undefined`) devolve `false` — o comportamento antigo
 * continua sendo o padrão, e só quem foi marcado explicitamente arquiva.
 */
export function preservaVendaAoArquivar(
    stage: Pick<BoardStage, 'arquivaSemReabrir'> | undefined | null
): boolean {
    return stage?.arquivaSemReabrir === true;
}

/**
 * O texto que o card mostra quando a venda foi preservada por arquivamento.
 *
 * Existe porque o silêncio foi o defeito da story 2.37: o card mudava de estado
 * sem dizer nada. Aqui o risco é o oposto e igualmente ruim — ela arquiva uma
 * venda e não sabe se o número do mês sobreviveu.
 */
export function avisoDeArquivamento(nomeDaColuna: string): string {
    return `Card arquivado em "${nomeDaColuna}". A venda continua contando no mês.`;
}
