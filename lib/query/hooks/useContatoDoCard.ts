/**
 * Story 2.75 (D1) — o contato do card, mesmo quando é antigo.
 *
 * A janela do card procurava o contato só na lista do `useContacts()`, que traz
 * os 1.000 contatos criados mais recentemente. Contato mais antigo "sumia" e,
 * com ele, o botão "Mensagem"/"Iniciar conversa" e a etiqueta da etapa.
 *
 * Regras, nesta ordem:
 *   1. sem `contactId` → nada, sem consulta;
 *   2. contato na lista carregada → o da lista, sem consulta (sem regressão);
 *   3. lista ainda carregando → espera (`carregando`), sem consulta;
 *   4. lista carregada (ou com erro) e o id fora dela → busca pelo id no banco;
 *   5. contato excluído → o `getByIds` já filtra `deleted_at` → `null`.
 *
 * A chave fica DEBAIXO de `queryKeys.contacts.all` (o Realtime de `contacts` e o
 * `useRenameLead` invalidam junto) e NUNCA é `queryKeys.contacts.detail(id)`,
 * que pertence ao `useContact` antigo, com outra `queryFn`.
 */
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../index';
import { contactsService } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import type { Contact } from '@/types';

/** Chave do cache do contato achado pelo id (fora da lista). */
export const chaveDoContatoDoCard = (contactId: string) =>
  [...queryKeys.contacts.all, 'do-card', contactId] as const;

export interface ContatosCarregados {
  data?: Contact[];
  isFetched: boolean;
  isError: boolean;
}

export interface ContatoDoCard {
  contato: Contact | null;
  carregando: boolean;
  erro: boolean;
}

export function useContatoDoCard(
  contactId: string | undefined | null,
  contatosCarregados: ContatosCarregados
): ContatoDoCard {
  const { user, loading: authLoading } = useAuth();
  const id = contactId || '';

  const daLista = id ? (contatosCarregados.data?.find(c => c.id === id) ?? null) : null;
  const listaPronta = contatosCarregados.isFetched || contatosCarregados.isError;
  const precisaBuscar = !!id && !daLista && listaPronta;

  const consulta = useQuery({
    queryKey: chaveDoContatoDoCard(id),
    queryFn: async ({ signal }) => {
      const { data, error } = await contactsService.getByIds([id], { signal });
      if (error) throw error;
      return data?.[0] ?? null;
    },
    staleTime: 2 * 60 * 1000,
    enabled: precisaBuscar && !authLoading && !!user,
  });

  // Regra 1
  if (!id) return { contato: null, carregando: false, erro: false };
  // Regra 2
  if (daLista) return { contato: daLista, carregando: false, erro: false };
  // Regra 3
  if (!listaPronta) return { contato: null, carregando: true, erro: false };
  // Regras 4 e 5 — QA 2.75 (LOW-1): erro só conta sem contato já carregado. Se
  // uma nova busca em segundo plano (Realtime, renomear lead) falhar, o botão
  // que já funcionava continua; o React Query mantém o último `data`.
  if (consulta.isError && consulta.data === undefined) {
    return { contato: null, carregando: false, erro: true };
  }
  return {
    contato: consulta.data ?? null,
    carregando: consulta.isPending,
    erro: false,
  };
}
