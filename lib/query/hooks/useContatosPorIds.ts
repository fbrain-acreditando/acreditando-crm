/**
 * Story 2.76 (D3) — vários contatos pelo id, mesmo os antigos.
 *
 * Generaliza o `useContatoDoCard` (2.75) para N ids:
 *   1. ids vazios são descartados e os repetidos, deduplicados;
 *   2. quem está na lista já carregada (`contatosCarregados`) vem de lá, sem consulta;
 *   3. lista ainda carregando → espera, sem consulta;
 *   4. os que FALTAM vão numa ÚNICA chamada `getByIds` (que fatia em lotes de
 *      150) — nunca uma consulta por id;
 *   5. a chave usa os faltantes ORDENADOS (a mesma busca em outra ordem não
 *      duplica o cache) e fica debaixo de `queryKeys.contacts.all` — nunca é
 *      `queryKeys.contacts.detail(id)`, que pertence ao `useContact` antigo.
 *
 * Sem `contatosCarregados`, todos os ids vão ao banco.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../index';
import { contactsService } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import type { Contact } from '@/types';
import type { ContatosCarregados } from './useContatoDoCard';

/** Chave do cache dos contatos buscados pelo id (ids já ordenados). */
export const chaveDosContatosPorIds = (idsOrdenados: readonly string[]) =>
  [...queryKeys.contacts.all, 'por-ids', [...idsOrdenados]] as const;

export interface ContatosPorIds {
  porId: Map<string, Contact>;
  carregando: boolean;
  erro: boolean;
}

export function useContatosPorIds(
  ids: ReadonlyArray<string | null | undefined>,
  contatosCarregados?: ContatosCarregados
): ContatosPorIds {
  const { user, loading: authLoading } = useAuth();

  // `ids` costuma ser um array novo a cada render; o conteúdo é o que importa.
  const assinatura = Array.from(new Set(ids.filter((id): id is string => !!id))).sort().join('|');
  const unicos = useMemo(() => (assinatura ? assinatura.split('|') : []), [assinatura]);

  const lista = contatosCarregados?.data;
  const listaPronta = !contatosCarregados || contatosCarregados.isFetched || contatosCarregados.isError;

  const { daLista, faltantes } = useMemo(() => {
    const mapa = new Map<string, Contact>();
    const naLista = new Map((lista ?? []).map(c => [c.id, c]));
    const falta: string[] = [];
    for (const id of unicos) {
      const c = naLista.get(id);
      if (c) mapa.set(id, c);
      else falta.push(id);
    }
    return { daLista: mapa, faltantes: falta };
  }, [unicos, lista]);

  const precisaBuscar = listaPronta && faltantes.length > 0;

  const consulta = useQuery<Contact[], Error>({
    queryKey: chaveDosContatosPorIds(faltantes),
    queryFn: async ({ signal }) => {
      const { data, error } = await contactsService.getByIds(faltantes, { signal });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 2 * 60 * 1000,
    enabled: precisaBuscar && !authLoading && !!user,
  });

  const porId = useMemo(() => {
    const mapa = new Map(daLista);
    if (precisaBuscar) for (const c of consulta.data ?? []) mapa.set(c.id, c);
    return mapa;
  }, [daLista, precisaBuscar, consulta.data]);

  if (!listaPronta && faltantes.length > 0) return { porId, carregando: true, erro: false };
  if (!precisaBuscar) return { porId, carregando: false, erro: false };
  // Mesma regra do LOW-1 da 2.75: erro só conta sem dado já carregado.
  if (consulta.isError && consulta.data === undefined) return { porId, carregando: false, erro: true };
  return { porId, carregando: consulta.isPending, erro: false };
}
