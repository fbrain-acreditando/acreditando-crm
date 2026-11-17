/**
 * Story 2.74 (AC1, D1) — o card achado no banco entra no cache do quadro
 * (`DEALS_VIEW_KEY`), SEM sobrescrever o que já está lá.
 *
 * Por que no cache, e não numa lista paralela: arrastar, perder e ganhar
 * (`handleDrop`, `handleLossReasonConfirm`, `handleMoveDealToStage`) procuram
 * o card com `deals.find(...)`, o otimismo do `useMoveDeal` escreve só em
 * `DEALS_VIEW_KEY`, e a janela do card (`DealDetailModal`) lê só dele.
 */
import type { DealView } from '@/types';

/**
 * Devolve o cache com os `achados` cujo `id` NÃO está nele.
 *
 * - Card que já está no cache **não muda** (nem campo, nem posição): o do
 *   cache pode ter otimismo ou Realtime mais novo.
 * - Cache `undefined` continua `undefined`: não cria o cache antes de o
 *   quadro carregar (senão o quadro "carregaria" só com os achados).
 * - Nada a acrescentar → devolve a MESMA referência (sem re-render à toa).
 */
export function acrescentarAoQuadro(
  cache: DealView[] | undefined,
  achados: readonly DealView[]
): DealView[] | undefined {
  if (cache === undefined) return undefined;
  if (achados.length === 0) return cache;

  const noCache = new Set(cache.map(d => d.id));
  const novos: DealView[] = [];
  for (const card of achados) {
    if (noCache.has(card.id)) continue;
    noCache.add(card.id);
    novos.push(card);
  }
  return novos.length === 0 ? cache : [...cache, ...novos];
}

/** `updatedAt` em milissegundos (inválido/ausente conta como o mais velho). */
function instante(card: Pick<DealView, 'updatedAt'>): number {
  const t = card.updatedAt ? new Date(card.updatedAt).getTime() : NaN;
  return Number.isNaN(t) ? -Infinity : t;
}

/**
 * Entre duas versões do MESMO card, a de `updatedAt` mais novo (empate: a `nova`).
 * Mesma regra do Realtime (`useRealtimeSync.ts`): o mais novo vence.
 */
export function versaoMaisNova(atual: DealView | undefined, nova: DealView): DealView {
  if (!atual) return nova;
  return instante(nova) >= instante(atual) ? nova : atual;
}

/**
 * Junta várias listas de cards guardados (busca, `?deal=`), uma versão por id:
 * a de `updatedAt` mais novo.
 */
export function juntarPorIdMaisNovo(...listas: ReadonlyArray<readonly DealView[]>): DealView[] {
  const porId = new Map<string, DealView>();
  for (const lista of listas) {
    for (const card of lista) {
      porId.set(card.id, versaoMaisNova(porId.get(card.id), card));
    }
  }
  return Array.from(porId.values());
}
