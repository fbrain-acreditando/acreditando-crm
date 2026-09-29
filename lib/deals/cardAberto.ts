/**
 * @fileoverview "Card aberto" do quadro Acreditando — story 2.59, T2.1.
 *
 * A MESMA regra da guarda da story 2.56
 * (`supabase/functions/messaging-webhook-gptmaker/deal-guard.ts`), agora
 * disponível para o lado Next.js (rota do Formulário Meta):
 *
 *   • mesmo `board_id`;
 *   • `deleted_at IS NULL` (na query, não depois);
 *   • estágio **fora** de Ganho · Perdido · Clientes, comparado por **id**;
 *   • mais de um aberto ⇒ o **mais antigo** (`created_at asc`).
 *
 * ## Por que uma cópia e não um import
 *
 * A Edge Function roda em Deno e é publicada à parte; importá-la daqui puxaria
 * o arquivo para o bundle do Next e vice-versa. A story proíbe republicar a
 * Edge Function (risco R10 de `01-…`). Então a lista vive nos dois lugares e o
 * teste `lib/deals/cardAberto.test.ts` **lê o arquivo da guarda e compara os
 * uuids** — se um lado mudar sem o outro, o teste quebra (risco R5).
 *
 * ## 🔴 Por `id`, NUNCA por nome
 *
 * O estágio de proposta está gravado como `" Proposta enviada"`, com espaço no
 * começo. Comparar por rótulo erra calado.
 *
 * Lido do banco de produção em 29/09/2026 (somente leitura): os 13 estágios do
 * quadro e os 3 terminais batem com os uuids abaixo.
 *
 * @module lib/deals/cardAberto
 */

/** Quadro "Acreditando" — onde a Fernanda atende. */
export const BOARD_ACREDITANDO = '5f6bded2-0f7c-418d-9598-7ea75d032242';

/** Estágio "Lead novo" do quadro Acreditando (order 0). */
export const ESTAGIO_LEAD_NOVO_ACREDITANDO = '82d1a222-eeff-4627-baed-881908dbd702';

/** Ganho · Perdido · Clientes — card nesses estágios NÃO conta como aberto (D4 da 2.56). */
export const ESTAGIOS_TERMINAIS_ACREDITANDO: ReadonlyArray<string> = [
  'f359ee98-b7b1-460d-a7be-2ef92f92c4c7', // Ganho
  '78defbd3-6ca4-4b96-b67a-2268e7e6dce5', // Perdido
  '3ed212e5-32a9-4bda-8d70-bb8be49e790d', // Clientes
];

const TERMINAIS_POR_QUADRO: Record<string, ReadonlyArray<string>> = {
  [BOARD_ACREDITANDO]: ESTAGIOS_TERMINAIS_ACREDITANDO,
};

/**
 * Estágios terminais do quadro. Quadro sem lista ⇒ vazio (todo estágio conta
 * como aberto) — mesmo comportamento da guarda da 2.56.
 */
export function estagiosTerminaisDoQuadro(boardId: string): ReadonlyArray<string> {
  return TERMINAIS_POR_QUADRO[boardId] ?? [];
}

export interface CardCandidato {
  id: string;
  stage_id: string | null;
  created_at?: string | null;
}

export type EscolhaDeCard =
  | { temCardAberto: true; dealId: string; stageId: string | null }
  | { temCardAberto: false; motivo: 'sem-card' | 'so-terminais'; terminaisIgnorados?: number };

/**
 * Decide, entre os cards VIVOS do contato no quadro, qual é o aberto.
 *
 * ⚠️ Espera a lista já filtrada por organização, contato, quadro e
 * `deleted_at IS NULL`, e já ordenada por `created_at asc` — é o que a query
 * da guarda faz. Mesmo assim reordena por segurança (a regra é "o mais antigo").
 */
export function escolherCardAberto(boardId: string, cards: ReadonlyArray<CardCandidato>): EscolhaDeCard {
  if (cards.length === 0) return { temCardAberto: false, motivo: 'sem-card' };

  const ordenados = [...cards].sort((a, b) => {
    const ca = a.created_at ?? '';
    const cb = b.created_at ?? '';
    return ca < cb ? -1 : ca > cb ? 1 : 0;
  });

  const terminais = estagiosTerminaisDoQuadro(boardId);
  // Comparação por id. Card sem estágio conta como aberto (igual à guarda).
  const aberto = ordenados.find((d) => !d.stage_id || !terminais.includes(d.stage_id));
  if (aberto) return { temCardAberto: true, dealId: aberto.id, stageId: aberto.stage_id };

  return { temCardAberto: false, motivo: 'so-terminais', terminaisIgnorados: cards.length };
}
