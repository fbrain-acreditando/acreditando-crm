/**
 * Story 2.29 — uma tradução banco→app só, para o CRM inteiro.
 *
 * O problema que este arquivo existe para matar: havia DUAS traduções de linha
 * do Postgres para o formato da aplicação.
 *
 *  1. `transformDeal` (em `lib/supabase/deals.ts`) — a canônica, usada por todo
 *     `fetch`. Conhece as ~22 colunas da tabela.
 *  2. Uma lista escrita à mão dentro do `useRealtimeSync`, que normalizava
 *     **7 campos** (`updated_at`, `created_at`, `stage_id`, `is_won`, `is_lost`,
 *     `closed_at`, `last_stage_change_date`) e fazia `{ ...deal, ...resto }`.
 *
 * ⇒ Toda coluna fora daquela lista chegava em **snake_case** e era escrita como
 * chave nova, enquanto a chave camelCase que a tela lê **ficava com o valor
 * velho**. Foi o que a Fernanda viu: salvava um campo personalizado, o card
 * continuava mostrando o valor anterior, e só o F5 corrigia — porque o F5 passa
 * pelo `transformDeal`.
 *
 * 🔑 O defeito não era `custom_fields`: era existirem duas traduções. A segunda
 * nasce desatualizada no dia em que alguém adiciona uma coluna — e falha
 * **calada**, que é a família de defeito mais cara deste repo.
 */
import { transformDeal } from '@/lib/supabase/deals';
import type { Deal, DealView } from '@/types';

/** Campos do `DealView` que a linha do banco NÃO carrega — vêm de enriquecimento. */
type CamposEnriquecidos = 'items' | 'owner';

/**
 * Traduz a linha crua do Realtime usando a MESMA função do fetch.
 *
 * O payload de UPDATE do Postgres traz a linha inteira, então a tradução é
 * completa — só ficam de fora os campos que a linha não tem como carregar
 * (`items` vem de outra tabela; `owner` é enriquecido depois da query).
 */
export function normalizarDealDoRealtime(
  linha: Record<string, unknown>
): Omit<Deal, CamposEnriquecidos> {
  // O cast é a fronteira do sistema: o payload do Realtime é `unknown` por
  // natureza, e `transformDeal` é quem define o contrato do outro lado.
  const completo = transformDeal(linha as unknown as Parameters<typeof transformDeal>[0]);
  const { items: _items, owner: _owner, ...semEnriquecimento } = completo;
  return semEnriquecimento;
}

/**
 * Mescla a linha do Realtime sobre o que já está no cache.
 *
 * ⚠️ O cache guarda `DealView`, que tem campos que a tabela `deals` não tem
 * (`companyName`, `contactName`, `stageLabel`) além de `items` e `owner`.
 * Espalhar o deal traduzido POR CIMA do cache preserva todos eles — sobrescrever
 * o objeto inteiro apagaria o nome do contato do card a cada evento.
 */
export function mesclarDealDoRealtime(
  doCache: DealView,
  linha: Record<string, unknown>
): DealView {
  return { ...doCache, ...normalizarDealDoRealtime(linha) };
}

/**
 * A linha que chegou é ao menos tão nova quanto a que está no cache?
 *
 * 🔑 Isto substitui a guarda antiga, que decidia por **igualdade de estágio**:
 * *"o card não mudou de coluna ⇒ descarta a linha inteira"*. Essa regra
 * confundia **movimentação** com **atualização** — e por isso toda edição que
 * não movia o card (valor, título, campos personalizados, motivo de perda) era
 * descartada, vindo de qualquer aba ou usuário.
 *
 * A proteção que a regra antiga TENTAVA dar continua aqui, e melhor: evento
 * fora de ordem tem `updated_at` mais antigo que o do cache e é descartado —
 * é isso que impede o card de "pular de volta" por cima de um update otimista.
 *
 * Sem timestamp de um dos lados não há como julgar: aplica. Perder uma
 * atualização em silêncio é pior que aplicar uma repetida, que é idempotente.
 */
export function linhaDoRealtimeEhMaisNova(
  updatedAtDoCache: string | undefined,
  updatedAtDaLinha: string | undefined
): boolean {
  if (!updatedAtDaLinha || !updatedAtDoCache) return true;

  const daLinha = new Date(updatedAtDaLinha).getTime();
  const doCache = new Date(updatedAtDoCache).getTime();

  if (Number.isNaN(daLinha) || Number.isNaN(doCache)) return true;

  return daLinha >= doCache;
}
