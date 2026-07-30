'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { MessageSquare, User, CheckCircle, MoreVertical, LinkIcon, Trash2, RotateCcw, Search } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { sanitizeUrl } from '@/lib/utils/sanitize';
import { supabase } from '@/lib/supabase';
import { dealsService } from '@/lib/supabase/deals';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { ConversationList } from './components/ConversationList';
import { MessageThread } from './components/MessageThread';
import { MessageInput } from './components/MessageInput';
import { ContactPanel } from './components/ContactPanel';
import { ContactLinkModal } from './components/Modals/ContactLinkModal';
import { ChannelIndicator } from './components/ChannelIndicator';
import { WindowExpiryBadge } from './components/WindowExpiryBadge';
import { MessageSearchBar } from './components/MessageSearchBar';
import { AssignmentDropdown } from './components/AssignmentDropdown';
import {
  useConversation,
  useMarkConversationRead,
  useResolveConversation,
  useReopenConversation,
  useDeleteConversation,
  addPendingDeletion,
  removePendingDeletion,
} from '@/lib/query/hooks/useConversationsQuery';
import { useConversationsByContact } from '@/lib/query/hooks/useMessagingConversationsQuery';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Modal } from '@/components/ui/Modal';
import { useRealtimeSyncMessaging } from '@/lib/realtime/useRealtimeSync';
import { queryKeys } from '@/lib/query';
import { useContactPresence } from '@/lib/messaging/hooks/useContactPresence';
import type { ConversationView } from '@/lib/messaging/types';

interface MessagingPageProps {
  initialConversationId?: string;
}

export function MessagingPage({ initialConversationId }: MessagingPageProps = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const conversationIdParam = searchParams.get('id');
  // Chegada vinda do card do lead (DealDetailModal → "Mensagem"): não sabemos a
  // conversa, só o contato. Resolvido no efeito abaixo.
  const contactIdParam = searchParams.get('contactId');
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const { addToast } = useToast();
  const { getPresence } = useContactPresence();

  const [selectedConversationId, setSelectedConversationId] = useState<string | undefined>(
    initialConversationId || conversationIdParam || undefined
  );
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [replyToMessage, setReplyToMessage] = useState<import('@/lib/messaging/types').MessagingMessage | null>(null);

  // Subscribe to realtime updates
  useRealtimeSyncMessaging();

  // Fetch selected conversation details
  const { data: selectedConversation, isLoading: isConversationLoading } = useConversation(selectedConversationId);

  // Mutations
  const { mutate: markAsRead } = useMarkConversationRead();
  const { mutate: resolveConversation } = useResolveConversation();
  const { mutate: reopenConversation } = useReopenConversation();
  const { mutate: deleteConversation, isPending: isDeleting } = useDeleteConversation();

  // Handle delete conversation
  const handleDeleteConversation = useCallback(() => {
    if (!selectedConversationId) return;

    const idToDelete = selectedConversationId;
    // Mark as pending deletion BEFORE any state updates so the select filter in
    // useConversations immediately starts filtering this ID. This prevents stale
    // refetches (e.g. from markAsRead.onSettled) from re-adding the conversation
    // to the list while the delete mutation is in-flight.
    addPendingDeletion(idToDelete);
    // Safety fallback: if the realtime DELETE event never arrives (network issue, etc.),
    // ensure the guard is eventually cleared so the pending-deletion filter doesn't persist.
    setTimeout(() => removePendingDeletion(idToDelete), 10_000);
    // Clear selection immediately so useConversation becomes disabled (enabled: false)
    // before invalidation or realtime events trigger a refetch of the deleted conversation
    setSelectedConversationId(undefined);
    setShowDeleteConfirm(false);
    router.push('/messaging', { scroll: false });

    // Cancel in-flight refetches so they don't overwrite the optimistic removal below
    queryClient.cancelQueries({ queryKey: queryKeys.messagingConversations.all });

    // Optimistically remove from list cache immediately
    queryClient.setQueriesData(
      { queryKey: queryKeys.messagingConversations.all },
      (old: unknown) => {
        if (!Array.isArray(old)) return old;
        return (old as ConversationView[]).filter((conv) => conv.id !== idToDelete);
      }
    );

    deleteConversation(idToDelete);
  }, [selectedConversationId, deleteConversation, router, queryClient]);

  // ---------------------------------------------------------------------------
  // CARD DO LEAD → CONVERSA
  // ---------------------------------------------------------------------------
  // Chegando por `/messaging?contactId=<id>` (botão "Mensagem" do card), abre a
  // conversa MAIS RECENTE daquele contato — mesmo critério de desempate que a
  // navegação inversa e a extração de campos usam, já que um contato pode ter
  // conversa em mais de um canal.
  //
  // Antes o card mandava `?newConversation=true&contactId=...`, e nada aqui lia
  // esses parâmetros: o clique caía na tela vazia e parecia não ter funcionado.
  const { data: contactConversations, isLoading: isResolvingContact } =
    useConversationsByContact(contactIdParam || undefined);

  // Guarda contra disparar o aviso duas vezes antes de o `replace` da URL propagar.
  const resolvedContactRef = useRef<string | null>(null);

  useEffect(() => {
    if (!contactIdParam || selectedConversationId) return;
    if (isResolvingContact || !contactConversations) return;
    if (resolvedContactRef.current === contactIdParam) return;

    resolvedContactRef.current = contactIdParam;

    // `useConversationsByContact` já ordena por `last_message_at desc`.
    const latest = contactConversations[0];

    if (latest) {
      setSelectedConversationId(latest.id);
      router.replace(`/messaging?id=${latest.id}`, { scroll: false });
      return;
    }

    addToast('Este lead ainda não tem conversa de WhatsApp registrada.', 'info');
    router.replace('/messaging', { scroll: false });
  }, [
    contactIdParam,
    selectedConversationId,
    contactConversations,
    isResolvingContact,
    router,
    addToast,
  ]);

  // Clear URL if conversation was deleted or not found
  useEffect(() => {
    if (selectedConversationId && selectedConversation === null && !isConversationLoading) {
      setSelectedConversationId(undefined);
      router.replace('/messaging', { scroll: false });
    }
  }, [selectedConversationId, selectedConversation, isConversationLoading, router]);

  // Mark as read when opening a conversation.
  //
  // Guarda anti-laço: se a baixa falhar (ex.: bloqueio de RLS), o refetch do
  // `onSettled` traz o `unreadCount` original, gera um novo objeto
  // `selectedConversation` e este efeito redispararia sem parar. A chave inclui
  // o contador de propósito — mensagem NOVA numa conversa já aberta muda a
  // chave e volta a marcar como lida.
  const markedReadRef = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedConversationId || !selectedConversation) return;
    if (selectedConversation.unreadCount <= 0) return;

    const attemptKey = `${selectedConversationId}:${selectedConversation.unreadCount}`;
    if (markedReadRef.current === attemptKey) return;
    markedReadRef.current = attemptKey;

    markAsRead(selectedConversationId);
  }, [selectedConversationId, selectedConversation, markAsRead]);


  // Update URL when conversation changes
  const handleSelectConversation = useCallback((id: string) => {
    setSelectedConversationId(id);
    setShowSearch(false);
    router.push(`/messaging?id=${id}`, { scroll: false });
  }, [router]);

  // Link conversation to contact
  const handleLinkContact = useCallback(async (contactId: string) => {
    if (!selectedConversationId) return;

    const { error } = await supabase
      .from('messaging_conversations')
      .update({ contact_id: contactId })
      .eq('id', selectedConversationId);

    if (error) throw error;

    // Invalidate queries to refresh data
    queryClient.invalidateQueries({
      queryKey: queryKeys.messagingConversations.all,
    });
  }, [selectedConversationId, queryClient]);

  // Create contact and link
  const handleCreateContact = useCallback(async (params: { name: string; phone?: string }) => {
    if (!profile?.organization_id) throw new Error('Organization not found');

    const { data: contact, error: createError } = await supabase
      .from('contacts')
      .insert({
        name: params.name,
        phone: params.phone,
        organization_id: profile.organization_id,
      })
      .select('id')
      .single();

    if (createError) throw createError;
    return contact.id;
  }, [profile?.organization_id]);

  // View contact in CRM
  const handleViewContact = useCallback((contactId: string) => {
    router.push(`/contacts?id=${contactId}`);
  }, [router]);

  // View deals for contact
  //
  // Navega para o CARD do lead no funil. `/boards` sabe abrir um deal específico
  // via `?deal=<id>` (useBoardsController), mas não existe FK conversa→deal: é
  // preciso resolver contato → deal antes de navegar. Antes daqui saía
  // `?contact=<id>`, parâmetro que ninguém lê — o clique levava ao board genérico
  // e parecia não ter feito nada.
  const handleViewDeals = useCallback(async (contactId: string) => {
    const { data: dealId, error } = await dealsService.getLatestIdByContact(contactId);

    if (error) {
      console.error('[MessagingPage] Falha ao localizar o card do contato:', error);
      addToast('Não foi possível abrir o card deste lead. Tente novamente.', 'warning');
      return;
    }

    if (!dealId) {
      addToast('Este contato ainda não tem card no funil.', 'info');
      return;
    }

    router.push(`/boards?deal=${dealId}`);
  }, [router, addToast]);

  return (
    <div className="h-[calc(100vh-4rem)] flex">
      {/* Conversation List */}
      <div className="w-80 flex-shrink-0">
        <ConversationList
          selectedId={selectedConversationId}
          onSelect={handleSelectConversation}
          getPresence={getPresence}
        />
      </div>

      {/* Message Thread */}
      <div className="flex-1 flex flex-col bg-slate-50 dark:bg-slate-900/50">
        {selectedConversation ? (
          <>
            {/* Header */}
            <div className="h-16 px-4 flex items-center gap-3 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-white/10">
              <div className="relative">
                {sanitizeUrl(selectedConversation.externalContactAvatar) ? (
                  <img
                    src={sanitizeUrl(selectedConversation.externalContactAvatar)}
                    alt={selectedConversation.externalContactName || 'Contato'}
                    className="w-10 h-10 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center">
                    <User className="w-5 h-5 text-slate-400" />
                  </div>
                )}
                <div className="absolute -bottom-0.5 -right-0.5">
                  <ChannelIndicator type={selectedConversation.channelType} size="sm" />
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="font-semibold text-slate-900 dark:text-white truncate">
                  {selectedConversation.contactName || selectedConversation.externalContactName || 'Contato desconhecido'}
                </h2>
                <div className="flex items-center gap-2">
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {selectedConversation.channelName}
                  </p>
                  <WindowExpiryBadge
                    windowExpiresAt={selectedConversation.windowExpiresAt}
                    variant="inline"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <AssignmentDropdown
                  conversationId={selectedConversation.id}
                  assignedUserId={selectedConversation.assignedUserId}
                />
                <button
                  type="button"
                  onClick={() => setShowSearch((v) => !v)}
                  className={cn(
                    'p-2 rounded-lg transition-colors',
                    showSearch
                      ? 'text-primary-500 bg-primary-50 dark:bg-primary-500/10'
                      : 'text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5'
                  )}
                  title="Buscar mensagens"
                >
                  <Search className="w-5 h-5" />
                </button>
                {selectedConversation.status === 'open' && (
                  <button
                    type="button"
                    onClick={() => resolveConversation(selectedConversation.id)}
                    className="p-2 text-slate-400 hover:text-green-500 hover:bg-green-50 dark:hover:bg-green-500/10 rounded-lg transition-colors"
                    title="Marcar como resolvida"
                  >
                    <CheckCircle className="w-5 h-5" />
                  </button>
                )}
                {!selectedConversation.contactId && (
                  <button
                    type="button"
                    onClick={() => setIsLinkModalOpen(true)}
                    className="p-2 text-slate-400 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-500/10 rounded-lg transition-colors"
                    title="Vincular contato"
                  >
                    <LinkIcon className="w-5 h-5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors"
                  title="Excluir conversa"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 rounded-lg transition-colors"
                    >
                      <MoreVertical className="w-5 h-5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    {selectedConversation.status === 'resolved' && (
                      <DropdownMenuItem
                        onClick={() => reopenConversation(selectedConversation.id)}
                        className="gap-2"
                      >
                        <RotateCcw className="w-4 h-4" />
                        Reabrir conversa
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => setShowDeleteConfirm(true)}
                      className="gap-2 text-red-600 focus:text-red-600 focus:bg-red-50 dark:focus:bg-red-500/10"
                    >
                      <Trash2 className="w-4 h-4" />
                      Excluir conversa
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Search Bar */}
            {showSearch && (
              <MessageSearchBar
                conversationId={selectedConversation.id}
                onClose={() => setShowSearch(false)}
              />
            )}

            {/* Messages */}
            <MessageThread
              conversationId={selectedConversation.id}
              presenceStatus={selectedConversation.contactId ? getPresence(selectedConversation.contactId) : undefined}
              onReply={setReplyToMessage}
            />

            {/* Input */}
            <MessageInput
              conversation={selectedConversation}
              replyTo={replyToMessage}
              onCancelReply={() => setReplyToMessage(null)}
            />
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 dark:text-slate-500">
            <MessageSquare className="w-16 h-16 mb-4 opacity-50" />
            <p className="text-lg">Selecione uma conversa</p>
            <p className="text-sm">Escolha uma conversa da lista para visualizar</p>
          </div>
        )}
      </div>

      {/* Contact Panel */}
      <div className="w-80 border-l border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 flex-shrink-0">
        <ContactPanel
          conversation={selectedConversation}
          isLoading={isConversationLoading && !!selectedConversationId}
          onLinkContact={() => setIsLinkModalOpen(true)}
          onViewContact={handleViewContact}
          onViewDeals={handleViewDeals}
        />
      </div>

      {/* Contact Link Modal */}
      <ContactLinkModal
        isOpen={isLinkModalOpen}
        onClose={() => setIsLinkModalOpen(false)}
        onLinkContact={handleLinkContact}
        onCreateContact={handleCreateContact}
        currentContactId={selectedConversation?.contactId}
        suggestedPhone={selectedConversation?.contactPhone || undefined}
        suggestedName={selectedConversation?.externalContactName || undefined}
      />

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        title="Excluir conversa"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-slate-600 dark:text-slate-300">
            Tem certeza que deseja excluir esta conversa? Todas as mensagens serão perdidas permanentemente.
          </p>
          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(false)}
              className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"
              disabled={isDeleting}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleDeleteConversation}
              disabled={isDeleting}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50"
            >
              {isDeleting ? 'Excluindo...' : 'Excluir'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
