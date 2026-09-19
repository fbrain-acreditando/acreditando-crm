/**
 * @fileoverview Retentativa com backoff — story 2.51.
 *
 * O supabase-js **não lança** quando o Postgres recusa: devolve
 * `{ data, error }`. Por isso `comRetry` decide pelo RESULTADO (`deveRetentar`)
 * e não por exceção — envolver em try/catch aqui seria retentar só o que já é
 * raro (falha de rede) e ignorar justamente o caso que derrubou o lead.
 *
 * Sem dependência externa, sem timer real nos testes (`dormir` é injetável).
 *
 * @module lib/public-api/retry
 */

/** Espera padrão entre tentativas, em ms. 2 retentativas = 2 esperas. */
export const BACKOFF_PADRAO_MS = [250, 750] as const;

/** Jitter máximo somado a cada espera, em ms. */
export const JITTER_PADRAO_MS = 100;

export interface RetryOptions<T> {
  /** Recebe o resultado da tentativa e diz se vale tentar de novo. */
  deveRetentar: (resultado: T) => boolean;
  /** Esperas entre tentativas. O total de tentativas é `backoff.length + 1`. */
  backoff?: readonly number[];
  /** Jitter máximo (ms) somado a cada espera. `0` desliga. */
  jitter?: number;
  /** Injetável para teste: por padrão `setTimeout`. */
  dormir?: (ms: number) => Promise<void>;
  /** Injetável para teste: por padrão `Math.random`. */
  aleatorio?: () => number;
  /** Chamado ANTES de cada nova tentativa — é onde o log de retentativa entra. */
  aoRetentar?: (info: { tentativa: number; esperaMs: number; resultado: T }) => void;
}

export interface RetryResult<T> {
  resultado: T;
  /** Quantas tentativas foram feitas ao todo (1 = acertou de primeira). */
  tentativas: number;
}

const dormirPadrao = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Executa `fn` até `backoff.length + 1` vezes enquanto `deveRetentar` disser sim.
 *
 * Devolve sempre o ÚLTIMO resultado — inclusive quando todas as tentativas
 * falharam — junto com o número de tentativas, que é o que vai para o log.
 */
export async function comRetry<T>(
  fn: (tentativa: number) => Promise<T>,
  opts: RetryOptions<T>
): Promise<RetryResult<T>> {
  const backoff = opts.backoff ?? BACKOFF_PADRAO_MS;
  const jitter = opts.jitter ?? JITTER_PADRAO_MS;
  const dormir = opts.dormir ?? dormirPadrao;
  const aleatorio = opts.aleatorio ?? Math.random;

  let tentativa = 1;
  let resultado = await fn(tentativa);

  while (tentativa <= backoff.length && opts.deveRetentar(resultado)) {
    const esperaMs = Math.round(backoff[tentativa - 1] + aleatorio() * jitter);
    opts.aoRetentar?.({ tentativa, esperaMs, resultado });
    await dormir(esperaMs);
    tentativa += 1;
    resultado = await fn(tentativa);
  }

  return { resultado, tentativas: tentativa };
}
