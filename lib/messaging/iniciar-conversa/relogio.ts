/**
 * @fileoverview Relógio da story 2.52 — um ponto só para ler a hora e esperar.
 *
 * Existe para os testes trocarem o tempo sem `useFakeTimers` (que travaria os
 * `await` do laço do AC4.5): o teste substitui este módulo por um relógio virtual.
 *
 * @module lib/messaging/iniciar-conversa/relogio
 */

export function agoraMs(): number {
  return Date.now();
}

export function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
