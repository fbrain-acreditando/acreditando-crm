/**
 * Renomear o lead — story 2.20.
 *
 * ## Por que existe um hook próprio, havendo `useUpdateContact`
 *
 * O `useUpdateContact` é genérico (telefone, e-mail, notas, `aiPaused`) e invalida
 * só `queryKeys.contacts.all`. Renomear é diferente em dois pontos:
 *
 *  1. **Mexe em três telas** — Contatos, Conversas e Boards. Invalidar só contatos
 *     deixaria o nome novo aparecendo numa aba e o antigo nas outras até um F5.
 *  2. **Precisa dizer o que aconteceu** (AC5) — quantos cards foram renomeados e
 *     quantos mantiveram o título personalizado. Só a RPC sabe esses números,
 *     porque eles dependem do nome ANTIGO.
 *
 * ## Por que NÃO é otimista, de propósito
 *
 * Update otimista que reverte é **indistinguível de "não aconteceu nada"** para
 * quem usa: o valor aparece e some numa fração de segundo, e o relato que chega é
 * *"editei e não mudou"*, sem erro nenhum na tela. Lição registrada em 07/08, no
 * caso do board que sumia e voltava. Aqui a escrita vai ao banco primeiro e a tela
 * só muda quando o banco confirmou.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys, DEALS_VIEW_KEY } from '../index';

/** O que a RPC `rename_lead` devolve. */
export interface RenameLeadResult {
  /** `false` quando o nome enviado era igual ao que já estava lá. */
  mudou: boolean;
  nome_antigo: string;
  nome_novo: string;
  /** Cards cujo título ainda era automático e acompanharam a troca. */
  cards_renomeados: number;
  /** Cards com título escrito por gente — preservados (AC4). */
  cards_preservados: number;
  conversas_atualizadas: number;
}

export const useRenameLead = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ contactId, name }: { contactId: string; name: string }) => {
      const { data, error } = await supabase.rpc('rename_lead', {
        p_contact_id: contactId,
        p_new_name: name,
      });
      if (error) throw error;
      return data as RenameLeadResult;
    },
    // AC6 — três telas, três caches. Faltar um deles é o bug voltar pela janela.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.messagingConversations.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.deals.all });
      queryClient.invalidateQueries({ queryKey: DEALS_VIEW_KEY });
      queryClient.invalidateQueries({ queryKey: queryKeys.boards.all });
    },
  });
};
