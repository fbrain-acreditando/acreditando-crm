/**
 * Story 2.76 (D4) — os contatos que o Inbox precisa, filtrados no BANCO.
 *
 * Antes o Inbox filtrava aniversariantes e clientes para resgate dentro do
 * `useContacts()` (os 1.000 contatos mais novos): contato criado antes do
 * corte nunca virava sugestão. Agora são duas consultas próprias, com teto de
 * 1.000 linhas cada (T0: bem abaixo disso; se encher, o serviço registra).
 *
 * Chaves debaixo de `queryKeys.contacts.all` (Realtime e renomear invalidam junto).
 */
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';
import { contactsService } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import type { Contact } from '@/types';

export const chaveDosAniversariantes = () => [...queryKeys.contacts.all, 'inbox', 'aniversario'] as const;
export const chaveDoResgate = (limiteIso: string) => [...queryKeys.contacts.all, 'inbox', 'resgate', limiteIso] as const;

/** @param limiteIso — antes desta data a última interação conta como "sumido" (30 dias). */
export function useContatosDoInbox(limiteIso: string) {
  const { user, loading: authLoading } = useAuth();
  const ligado = !authLoading && !!user;

  const aniversario = useQuery<Contact[], Error>({
    queryKey: chaveDosAniversariantes(),
    queryFn: async ({ signal }) => {
      const { data, error } = await contactsService.getComAniversario({ signal });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 2 * 60 * 1000,
    enabled: ligado,
  });

  const resgate = useQuery<Contact[], Error>({
    queryKey: chaveDoResgate(limiteIso),
    queryFn: async ({ signal }) => {
      const { data, error } = await contactsService.getClientesParaResgate(limiteIso, { signal });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 2 * 60 * 1000,
    enabled: ligado,
  });

  return {
    comAniversario: aniversario.data,
    paraResgate: resgate.data,
    isLoading: aniversario.isLoading || resgate.isLoading,
  };
}
