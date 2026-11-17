/**
 * Story 2.74 (T2) — a montagem do `DealView` num lugar só.
 *
 * Antes vivia dentro do `dealsViewQueryFn` (cache do quadro). Agora o card
 * achado pela busca no banco e o card aberto pelo `?deal=` passam pela MESMA
 * função — senão o card acrescentado ao cache teria `contactName`/`stageLabel`
 * diferentes dos carregados (mesma lição da story 2.29: uma tradução só).
 *
 * Mora na camada de query (e não em `lib/supabase`) para usar os serviços pelo
 * barrel `@/lib/supabase` sem import circular (`deals.ts` está no barrel).
 */
import type { Deal, DealView } from '@/types';
import { boardStagesService, contactsService, companiesService } from '@/lib/supabase';

/** Etapa como o `boardStagesService.getAll` devolve (só o que a montagem lê). */
type EtapaCrua = { id: string; label?: string | null; name?: string | null };

export interface OpcoesDeEnriquecimento {
  signal?: AbortSignal;
  /**
   * Etapas já buscadas (o `dealsViewQueryFn` busca em paralelo com os cards).
   * Sem elas, a função busca.
   */
  etapas?: EtapaCrua[] | null;
}

/**
 * Acrescenta `companyName`, `contactName`, `contactEmail` e `stageLabel` aos cards.
 */
export async function enriquecerDeals(
  deals: Deal[],
  { signal, etapas }: OpcoesDeEnriquecimento = {}
): Promise<DealView[]> {
  if (deals.length === 0) return [];

  const contactIds = deals.map(d => d.contactId).filter(Boolean);
  const companyIds = deals.map(d => d.clientCompanyId).filter(Boolean) as string[];

  const [stages, contactsResult, companiesResult] = await Promise.all([
    etapas !== undefined
      ? Promise.resolve(etapas || [])
      : boardStagesService.getAll({ signal }).then(r => (r.data || []) as EtapaCrua[]),
    contactsService.getByIds(contactIds, { signal }),
    companiesService.getByIds(companyIds, { signal }),
  ]);

  const contactMap = new Map((contactsResult.data || []).map(c => [c.id, c]));
  const companyMap = new Map((companiesResult.data || []).map(c => [c.id, c]));
  const stageMap = new Map(stages.map(s => [s.id, s.label || s.name]));

  return deals.map(deal => {
    const contact = contactMap.get(deal.contactId);
    const company = deal.clientCompanyId ? companyMap.get(deal.clientCompanyId) : undefined;
    return {
      ...deal,
      companyName: company?.name || 'Sem empresa',
      contactName: contact?.name || 'Sem contato',
      contactEmail: contact?.email || '',
      stageLabel: stageMap.get(deal.status) || 'Estágio não identificado',
    };
  });
}
