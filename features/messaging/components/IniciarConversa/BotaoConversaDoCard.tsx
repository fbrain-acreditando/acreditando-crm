'use client';

/**
 * O botão de WhatsApp do card do lead — story 2.52, AC1/AC2/AC6.
 *
 * | Estado                     | O que aparece                               |
 * |----------------------------|---------------------------------------------|
 * | sem contato                | nada (quem chama nem monta este componente) |
 * | contato SEM conversa       | "Iniciar conversa no WhatsApp"              |
 * | contato COM conversa       | "Mensagem" (o botão de antes, inalterado)   |
 *
 * Sem telefone ⇒ o "Iniciar" fica desabilitado com "Contato sem telefone".
 */

import React, { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { MessageSquare } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { queryKeys } from '@/lib/query/queryKeys';
import { useConversaDoContato } from '../../hooks/useConversaDoContato';
import { CompositorPrimeiraMensagem, type ResultadoDoEnvio } from './CompositorPrimeiraMensagem';

export const AVISO_MENSAGEM_ENVIADA = 'Mensagem enviada. Ela aparece aqui em instantes.';

interface Props {
  dealId: string;
  contact: { id: string; phone?: string | null };
  /** Fecha o card ao navegar para a conversa. */
  onNavegar: () => void;
}

export function BotaoConversaDoCard({ dealId, contact, onNavegar }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const { temConversa, carregando } = useConversaDoContato(contact.id);
  const [compondo, setCompondo] = useState(false);

  const abrirConversa = useCallback(
    (conversationId: string) => {
      router.push(`/messaging?id=${encodeURIComponent(conversationId)}`);
      onNavegar();
    },
    [router, onNavegar]
  );

  const aoResultado = useCallback(
    (r: ResultadoDoEnvio) => {
      if (r.tipo === 'erro') {
        addToast(r.mensagem, 'error');
        queryClient.invalidateQueries({ queryKey: queryKeys.messagingConversations.iniciadasHoje() });
        return;
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.messagingConversations.byContact(contact.id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.messagingConversations.iniciadasHoje() });
      setCompondo(false);
      if (r.tipo === 'enviada') {
        addToast(AVISO_MENSAGEM_ENVIADA, 'success');
        abrirConversa(r.conversationId);
        return;
      }
      // 409: já existe conversa — abre a existente, nada foi disparado.
      addToast('Este lead já tem conversa. Abrindo a conversa existente.', 'info');
      if (r.conversationId) abrirConversa(r.conversationId);
    },
    [addToast, queryClient, contact.id, abrirConversa]
  );

  if (carregando) return null;

  if (temConversa) {
    return (
      <button
        type="button"
        onClick={() => {
          // Abre a conversa deste lead. `/messaging` resolve
          // contato → conversa mais recente (um contato pode ter
          // conversa em mais de um canal).
          //
          // ⚠️ Antes daqui saía `newConversation=true` + nome e
          // telefone, parâmetros que a página de mensagens nunca
          // leu — o botão navegava para a tela vazia.
          router.push(`/messaging?contactId=${encodeURIComponent(contact.id)}`);
          onNavegar();
        }}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-500/10 hover:bg-green-100 dark:hover:bg-green-500/20 rounded-lg transition-colors"
        title="Abrir conversa de WhatsApp deste lead"
      >
        <MessageSquare size={14} />
        <span className="hidden sm:inline">Mensagem</span>
      </button>
    );
  }

  const semTelefone = !contact.phone || !contact.phone.trim();

  return (
    <>
      <button
        type="button"
        disabled={semTelefone}
        onClick={() => setCompondo((v) => !v)}
        aria-expanded={compondo}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-500/10 hover:bg-green-100 dark:hover:bg-green-500/20 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        title={semTelefone ? 'Contato sem telefone' : 'Mandar a primeira mensagem para este lead'}
      >
        <MessageSquare size={14} />
        <span>Iniciar conversa no WhatsApp</span>
      </button>
      {semTelefone && (
        <span className="w-full basis-full text-xs text-slate-500 dark:text-slate-400">Contato sem telefone</span>
      )}
      {compondo && !semTelefone && (
        <CompositorPrimeiraMensagem dealId={dealId} onResultado={aoResultado} onCancelar={() => setCompondo(false)} />
      )}
    </>
  );
}
