/**
 * Supabase Realtime Sync Hook
 *
 * Provides real-time synchronization for multi-user scenarios.
 * When one user makes changes, all other users see updates instantly.
 *
 * Usage:
 *   useRealtimeSync('deals');  // Subscribe to deals table changes
 *   useRealtimeSync(['deals', 'activities']);  // Multiple tables
 */
import { useEffect, useRef } from 'react';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { queryKeys, DEALS_VIEW_KEY } from '@/lib/query/queryKeys';
import {
  normalizarDealDoRealtime,
  mesclarDealDoRealtime,
  linhaDoRealtimeEhMaisNova,
} from './normalizeDealRow';
import type { DealView } from '@/types';
import type { MessagingMessage } from '@/lib/messaging';
import { transformMessage } from '@/lib/messaging/types';
import type { DbMessagingMessage, ConversationView } from '@/lib/messaging/types';
import { pendingDeletionIds, removePendingDeletion } from '@/lib/query/hooks/useConversationsQuery';

// Enable detailed Realtime logging in development or when DEBUG_REALTIME env var is set
const DEBUG_REALTIME = process.env.NODE_ENV === 'development' || process.env.NEXT_PUBLIC_DEBUG_REALTIME === 'true';

// Global deduplication for INSERT events - prevents multiple hook instances from processing the same event
// Key format: `${table}-${id}-${updatedAt}`
// Using Map with timestamp to handle TTL and atomic check-and-set
const processedInserts = new Map<string, number>();
const PROCESSED_CACHE_TTL = 5000; // 5 seconds TTL for processed events

// Atomic check-and-set for deduplication
function shouldProcessInsert(key: string): boolean {
  const now = Date.now();
  
  // Clean up old entries
  for (const [k, timestamp] of processedInserts) {
    if (now - timestamp > PROCESSED_CACHE_TTL) {
      processedInserts.delete(k);
    }
  }
  
  // Check if already processed
  if (processedInserts.has(key)) {
    return false;
  }
  
  // Mark as processed immediately (atomic in single-threaded JS)
  processedInserts.set(key, now);
  return true;
}

// Tables that support realtime sync
type RealtimeTable =
  | 'deals'
  | 'contacts'
  | 'activities'
  | 'boards'
  | 'board_stages'
  | 'crm_companies'
  // Messaging tables
  | 'messaging_channels'
  | 'messaging_conversations'
  | 'messaging_messages';

// Lazy getter for query keys mapping - avoids initialization issues in tests
const getTableQueryKeys = (table: RealtimeTable): readonly (readonly unknown[])[] => {
  const mapping: Record<RealtimeTable, readonly (readonly unknown[])[]> = {
    deals: [queryKeys.deals.all, queryKeys.dashboard.stats],
    contacts: [queryKeys.contacts.all],
    activities: [queryKeys.activities.all],
    boards: [queryKeys.boards.all],
    board_stages: [queryKeys.boards.all], // stages invalidate boards
    crm_companies: [queryKeys.companies.all],
    // Messaging tables
    messaging_channels: [queryKeys.messagingChannels.all],
    messaging_conversations: [
      queryKeys.messagingConversations.all,
      queryKeys.messagingConversations.unreadCount(),
    ],
    // messaging_messages uses targeted invalidation via conversation_id
    // (see handleMessagingMessageChange below). This fallback covers edge cases
    // where payload doesn't contain conversation_id.
    messaging_messages: [queryKeys.messagingMessages.all],
  };
  return mapping[table];
};

interface UseRealtimeSyncOptions {
  /** Whether sync is enabled (default: true) */
  enabled?: boolean;
  /** Debounce invalidation to avoid rapid updates (ms) */
  debounceMs?: number;
  /** Callback when a change is received */
  onchange?: (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => void;
}

/**
 * Subscribe to realtime changes on one or more tables
 */
export function useRealtimeSync(
  tables: RealtimeTable | RealtimeTable[],
  options: UseRealtimeSyncOptions = {}
) {
  const { enabled = true, debounceMs = 100, onchange } = options;
  const queryClient = useQueryClient();
  const channelRef = useRef<RealtimeChannel | null>(null);
  const isConnectedRef = useRef(false);
  const instanceIdRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingInvalidationsRef = useRef<Set<readonly unknown[]>>(new Set());
  const pendingInvalidateOnlyRef = useRef<Set<readonly unknown[]>>(new Set());
  // Track bursty board_stages INSERTs (creating a board inserts multiple stages).
  // We'll refetch on single INSERT (realtime stage created by someone else),
  // but avoid storms on bursts (treat burst as invalidate-only).
  const pendingBoardStagesInsertCountRef = useRef(0);
  const flushScheduledRef = useRef(false);
  const onchangeRef = useRef(onchange);
  
  // Keep callback ref up to date without causing re-renders
  useEffect(() => {
    onchangeRef.current = onchange;
  }, [onchange]);

  useEffect(() => {
    if (!enabled) return;

    const sb = supabase;
    if (!sb) {
      console.warn('[Realtime] Supabase client not available');
      return;
    }

    const tableList = Array.isArray(tables) ? tables : [tables];
    // Use unique instance ID to avoid conflict with channel being disconnected
    instanceIdRef.current += 1;
    const channelName = `realtime-sync-${tableList.join('-')}-${instanceIdRef.current}`;

    // Cleanup existing channel if any (detach-and-forget pattern)
    if (channelRef.current) {
      if (DEBUG_REALTIME) {
        console.log(`[Realtime] Cleaning up existing channel`);
      }
      const oldChannel = channelRef.current;
      channelRef.current = null;
      sb.removeChannel(oldChannel);
    }

    // Create channel with unique name to avoid race condition with previous removal
    const channel = sb.channel(channelName);

    // Subscribe to each table
    tableList.forEach(table => {
      channel.on(
        'postgres_changes',
        {
          event: '*', // INSERT, UPDATE, DELETE
          schema: 'public',
          table,
        },
        (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
          if (DEBUG_REALTIME) {
            console.log(`[Realtime] ${table} ${payload.eventType}:`, payload);
          }

          // #region agent log
          if (process.env.NODE_ENV !== 'production') {
            const dealId = (payload.new as Record<string, unknown>)?.id || (payload.old as Record<string, unknown>)?.id;
            const newData = payload.new as Record<string, unknown>;
            const oldData = payload.old as Record<string, unknown>;
            const logData = {
              dealId: typeof dealId === 'string' ? dealId.slice(0, 8) : '',
              eventType: payload.eventType,
              newStatus: newData?.status ? String(newData.status).slice(0, 8) : '',
              oldStatus: oldData?.status ? String(oldData.status).slice(0, 8) : '',
              newStageId: newData?.stage_id ? String(newData.stage_id).slice(0, 8) : '',
              oldStageId: oldData?.stage_id ? String(oldData.stage_id).slice(0, 8) : '',
              newUpdatedAt: newData?.updated_at || newData?.updatedAt || '',
              oldUpdatedAt: oldData?.updated_at || oldData?.updatedAt || '',
            };
            console.log(`[Realtime] 📨 Event received: ${table} ${payload.eventType}`, logData);
          }
          // #endregion

          // Call custom callback (if provided)
          onchangeRef.current?.(payload);

          // Targeted handling for messaging_messages:
          // - UPDATE: patch the message status in-cache (no refetch)
          // - INSERT/DELETE: invalidate to sync new/removed messages
          if (table === 'messaging_messages') {
            const record = (payload.new || payload.old) as Record<string, unknown>;
            const conversationId = record?.conversation_id as string | undefined;
            if (conversationId) {
              if (payload.eventType === 'UPDATE' && payload.new) {
                const db = payload.new as Record<string, unknown>;
                const messageId = db.id as string;
                const patch: Partial<MessagingMessage> = {
                  status: db.status as MessagingMessage['status'],
                  ...(db.external_id != null && { externalId: db.external_id as string }),
                  ...(db.sent_at != null && { sentAt: db.sent_at as string }),
                  ...(db.delivered_at != null && { deliveredAt: db.delivered_at as string }),
                  ...(db.read_at != null && { readAt: db.read_at as string }),
                  ...(db.failed_at != null && { failedAt: db.failed_at as string }),
                  ...(db.error_code != null && { errorCode: db.error_code as string }),
                  ...(db.error_message != null && { errorMessage: db.error_message as string }),
                  // Include metadata so reaction updates (metadata.reactions) propagate to the UI
                  ...(db.metadata != null && { metadata: db.metadata as Record<string, unknown> }),
                };

                const applyPatch = (m: MessagingMessage) =>
                  m.id === messageId ? { ...m, ...patch } : m;

                // Update flat query cache
                const flatKey = queryKeys.messagingMessages.byConversation(conversationId);
                queryClient.setQueryData<MessagingMessage[]>(flatKey, (old) =>
                  old ? old.map(applyPatch) : old
                );

                // Update infinite query cache (used by MessageThread)
                const infiniteKey = [...flatKey, 'infinite'] as const;
                queryClient.setQueryData<InfiniteData<{ messages: MessagingMessage[]; nextCursor: string | null }>>(
                  infiniteKey,
                  (old) => old
                    ? { ...old, pages: old.pages.map(p => ({ ...p, messages: p.messages.map(applyPatch) })) }
                    : old
                );
                return; // No invalidation for UPDATE
              }

              // INSERT: inject inbound messages directly into cache for instant delivery.
              // Invalidate-then-refetch relies on RLS evaluation in Supabase Realtime,
              // which can fail for complex JOIN-based policies — causing messages to not appear
              // until the user manually refreshes. Direct cache injection bypasses that entirely.
              if (payload.eventType === 'INSERT') {
                const newRecord = payload.new as Record<string, unknown>;
                const direction = newRecord?.direction;
                if (direction === 'outbound') {
                  // Check if this outbound message was already placed in cache by useSendMessage.
                  // If it's already there (UI-sent), just refresh the conversations list.
                  // If it's NOT there (sent from the phone/webhook), inject it like an inbound.
                  const flatKey = queryKeys.messagingMessages.byConversation(conversationId);
                  const infiniteKey = [...flatKey, 'infinite'] as const;
                  const cachedData = queryClient.getQueryData<InfiniteData<{ messages: MessagingMessage[]; nextCursor: string | null }>>(infiniteKey);
                  const messageId = newRecord.id as string;
                  const alreadyInCache = cachedData?.pages.some((p) => p.messages.some((m) => m.id === messageId));

                  if (!alreadyInCache) {
                    // Outbound from phone/webhook — inject into cache just like inbound
                    const newMessage = transformMessage(newRecord as unknown as DbMessagingMessage);
                    queryClient.setQueryData<InfiniteData<{ messages: MessagingMessage[]; nextCursor: string | null }>>(
                      infiniteKey,
                      (old) => {
                        if (!old) return old;
                        const pages = old.pages.map((page, i) => {
                          if (i !== old.pages.length - 1) return page;
                          if (page.messages.some((m) => m.id === newMessage.id)) return page;
                          return { ...page, messages: [...page.messages, newMessage] };
                        });
                        return { ...old, pages };
                      }
                    );
                    if (DEBUG_REALTIME) {
                      console.log('[Realtime] 📤 Outbound-from-phone injected into cache:', newMessage.id);
                    }
                  }

                  // Refresh conversations list (last_message preview).
                  pendingInvalidationsRef.current.add(queryKeys.messagingConversations.all);
                  pendingInvalidationsRef.current.add(queryKeys.messagingConversations.unreadCount());
                  if (!flushScheduledRef.current) {
                    flushScheduledRef.current = true;
                    queueMicrotask(() => {
                      flushScheduledRef.current = false;
                      const keysToFlush = Array.from(pendingInvalidationsRef.current);
                      pendingInvalidationsRef.current.clear();
                      keysToFlush.forEach((queryKey) => {
                        // Skip conversations-list invalidation while a deletion is in-progress.
                        // The shared ref may have been contaminated by a concurrent UPDATE event
                        // (e.g. markAsRead). Flushing it here causes a refetch that returns the
                        // conversation from DB before it's deleted, creating a flicker.
                        if (pendingDeletionIds.size > 0 && queryKey === queryKeys.messagingConversations.all) {
                          return;
                        }
                        queryClient.invalidateQueries({ queryKey, exact: false, refetchType: 'all' });
                      });
                    });
                  }
                  return;
                }

                // Inbound message: inject directly into the infinite query cache.
                // This is instant and doesn't require a network roundtrip or RLS re-evaluation.
                const newMessage = transformMessage(payload.new as unknown as DbMessagingMessage);
                const flatKey = queryKeys.messagingMessages.byConversation(conversationId);
                const infiniteKey = [...flatKey, 'infinite'] as const;

                queryClient.setQueryData<InfiniteData<{ messages: MessagingMessage[]; nextCursor: string | null }>>(
                  infiniteKey,
                  (old) => {
                    if (!old) return old;
                    // Append to the last page (most recent messages page).
                    // MessageThread reverses the order, so appending here is correct.
                    const pages = old.pages.map((page, i) => {
                      if (i !== old.pages.length - 1) return page;
                      // Deduplicate: skip if message already in cache
                      if (page.messages.some((m) => m.id === newMessage.id)) return page;
                      return { ...page, messages: [...page.messages, newMessage] };
                    });
                    return { ...old, pages };
                  }
                );

                if (DEBUG_REALTIME) {
                  console.log('[Realtime] 💬 Inbound message injected into cache:', newMessage.id);
                }

                // Also refresh conversations list for last_message preview + unread count.
                pendingInvalidationsRef.current.add(queryKeys.messagingConversations.all);
                pendingInvalidationsRef.current.add(queryKeys.messagingConversations.unreadCount());
                if (!flushScheduledRef.current) {
                  flushScheduledRef.current = true;
                  queueMicrotask(() => {
                    flushScheduledRef.current = false;
                    const keysToFlush = Array.from(pendingInvalidationsRef.current);
                    pendingInvalidationsRef.current.clear();
                    keysToFlush.forEach((queryKey) => {
                      // Skip conversations-list invalidation while a deletion is in-progress.
                      // Same guard as the outbound path — prevents an inbound message arriving
                      // during the delete window from triggering a refetch that re-shows the
                      // deleted conversation before the realtime DELETE event lowers the guard.
                      if (pendingDeletionIds.size > 0 && queryKey === queryKeys.messagingConversations.all) {
                        return;
                      }
                      queryClient.invalidateQueries({ queryKey, exact: false, refetchType: 'all' });
                    });
                  });
                }
                return;
              }

              // DELETE: invalidate to sync message thread only.
              // Do NOT invalidate messagingConversations here — that causes a race condition
              // when deleting a conversation: messages are deleted first, firing this event
              // before the conversation is deleted. The queueMicrotask refetch (refetchType:'all')
              // runs while the conversation still exists in DB, causing it to flash back into
              // the list. The messaging_conversations DELETE event handles list invalidation.
              const flatKey = queryKeys.messagingMessages.byConversation(conversationId);
              const infiniteKey = [...flatKey, 'infinite'] as const;
              pendingInvalidationsRef.current.add(flatKey);
              pendingInvalidationsRef.current.add(infiniteKey);

              if (!flushScheduledRef.current) {
                flushScheduledRef.current = true;
                queueMicrotask(() => {
                  flushScheduledRef.current = false;
                  const keysToFlush = Array.from(pendingInvalidationsRef.current);
                  pendingInvalidationsRef.current.clear();
                  keysToFlush.forEach((queryKey) => {
                    // Skip conversations-list invalidation while a deletion is in-progress.
                    // The shared ref may be contaminated by a concurrent UPDATE event (e.g.
                    // markAsRead). Flushing messagingConversations.all here with refetchType:'all'
                    // would return the conversation from DB before it's deleted — causing a flicker.
                    if (pendingDeletionIds.size > 0 && queryKey === queryKeys.messagingConversations.all) {
                      return;
                    }
                    queryClient.invalidateQueries({ queryKey, exact: false, refetchType: 'all' });
                  });
                });
              }
              return;
            }
            // If no conversation_id, fall through to generic invalidation
          }

          // Targeted handling for messaging_conversations DELETE:
          // Instead of calling invalidateQueries (which triggers a refetch), remove the
          // conversation from the cache directly. This prevents the flicker caused by
          // the refetch returning stale data (conversation still in DB while messages
          // are being deleted) overwriting the optimistic removal.
          if (table === 'messaging_conversations' && payload.eventType === 'DELETE') {
            const deletedId = (payload.old as Record<string, unknown>)?.id as string | undefined;
            if (deletedId) {
              // The DELETE event is the authoritative confirmation that the conversation is gone.
              // Lower the guard here so subsequent invalidations (e.g. unreadCount refetch) are
              // not blocked. This is the correct place — earlier removal (e.g. in onSettled) races
              // with DB-trigger UPDATE events that arrive via WebSocket AFTER the HTTP response.
              removePendingDeletion(deletedId);
              queryClient.setQueriesData(
                { queryKey: queryKeys.messagingConversations.all },
                (old: unknown) => {
                  if (!Array.isArray(old)) return old;
                  return (old as ConversationView[]).filter((conv) => conv.id !== deletedId);
                }
              );
              queryClient.removeQueries({
                queryKey: queryKeys.messagingConversations.detail(deletedId),
              });
              queryClient.invalidateQueries({
                queryKey: queryKeys.messagingConversations.unreadCount(),
              });
              if (DEBUG_REALTIME) {
                console.log('[Realtime] 🗑️ messaging_conversations DELETE — removed from cache directly', deletedId);
              }
            }
            return; // Skip generic invalidation path
          }

          // Skip UPDATE/INSERT events for conversations currently being deleted.
          // When messages are deleted, the DB trigger fires an UPDATE on messaging_conversations
          // (updating last_message_at, message_count, etc.) that arrives via WebSocket AFTER the
          // HTTP DELETE response. If we let it through, it queues a conversations-list refetch
          // that returns the conversation (still in DB at that instant), causing the flicker.
          if (table === 'messaging_conversations' && payload.eventType !== 'DELETE') {
            const convId = ((payload.new || payload.old) as Record<string, unknown>)?.id as string | undefined;
            if (convId && pendingDeletionIds.has(convId)) {
              if (DEBUG_REALTIME) {
                console.log('[Realtime] ⏭️ Skip conversations UPDATE for pending deletion:', convId.slice(0, 8));
              }
              return;
            }
          }

          // Queue query keys for invalidation (lazy loaded)
          const keys = getTableQueryKeys(table);
          // NOTE: `board_stages` INSERTs happen in bursts when creating a board (one per stage).
          // Refetching boards on each stage INSERT causes a request storm.
          // For that specific case, we can refetch on a single INSERT (true realtime),
          // but treat bursts as invalidate-only and let the board create mutation handle timing.
          if (payload.eventType === 'INSERT' && table === 'board_stages') {
            keys.forEach(key => pendingInvalidateOnlyRef.current.add(key));
            pendingBoardStagesInsertCountRef.current += 1;
          } else if (payload.eventType === 'UPDATE' && table === 'deals') {
            // 🐛 JUMP BACK FIX: um UPDATE de deals é aplicado DIRETO no cache abaixo
            // (setQueryData guardado, ~:611). Se enfileirarmos deals.all aqui, ela fica
            // "presa" na fila (o branch direto não flusha) e o PRÓXIMO flush — disparado
            // pelo INSERT de activity "Moveu para X" que TODO move gera — refetcha o
            // DEALS_VIEW_KEY com leitura stale e sobrescreve o otimismo: o card "volta"
            // pra coluna de origem. Enfileiramos só dashboard.stats; deals fica com o
            // setQueryData como fonte de verdade (design "delegar ao Realtime no move").
            keys.forEach(key => {
              if (key !== queryKeys.deals.all) pendingInvalidationsRef.current.add(key);
            });
          } else {
            keys.forEach(key => pendingInvalidationsRef.current.add(key));
          }

          // INSERT events can happen in bursts (ex.: creating a board inserts multiple board_stages).
          // Instead of refetching per-row, batch within the same tick using a microtask.
          // This keeps UI instant (optimistic updates handle UX) while preventing refetch storms.
          if (payload.eventType === 'INSERT') {
            // SPECIAL HANDLING FOR DEALS INSERT:
            // Instead of invalidating (which causes refetch that removes temp deal),
            // add the deal directly to the cache. This prevents the "flash and disappear" bug.
            if (table === 'deals') {
              const newData = payload.new as Record<string, unknown>;
              const dealId = newData.id as string;
              const updatedAt = newData.updated_at as string;
              
              // Deduplication: prevent multiple hook instances from processing the same INSERT
              const dedupeKey = `deals-${dealId}-${updatedAt}`;
              if (!shouldProcessInsert(dedupeKey)) {
                // #region agent log
                if (process.env.NODE_ENV !== 'production') {
                  console.log(`[Realtime] ⏭️ INSERT deals - skipping duplicate`, { dealId: dealId.slice(0, 8) });
                }
                // #endregion
                return; // Skip this event, already processed by another hook instance
              }
              
              // #region agent log
              if (process.env.NODE_ENV !== 'production') {
                const logData = {
                  dealId: dealId.slice(0, 8),
                  title: newData.title || 'null',
                  status: typeof newData.stage_id === 'string' ? (newData.stage_id as string).slice(0, 8) : 'null',
                };
                console.log(`[Realtime] 📥 INSERT deals - adding to cache directly`, logData);
              }
              // #endregion

              // Story 2.29 — traducao unica (`transformDeal`), a mesma do fetch.
              // Aqui viviam 12 `if`s escritos a mao que perdiam `custom_fields`,
              // `ai_extracted`, `tags`, `priority`, `probability`, `ai_summary`,
              // `owner_id` e `client_company_id` — e ainda mapeavam `company_id`,
              // coluna que nao existe na tabela.
              const normalizedDeal: Record<string, unknown> =
                normalizarDealDoRealtime(newData) as unknown as Record<string, unknown>;

              // CRÍTICO: Atualizar APENAS DEALS_VIEW_KEY (única fonte de verdade)
              // O Kanban (useDealsByBoard) agora usa essa mesma query com filtragem client-side
              // NÃO usar setQueriesData com prefix matcher - isso atualiza queries erradas!
              queryClient.setQueryData<DealView[]>(
                DEALS_VIEW_KEY,
                (old) => {
                  if (!old || !Array.isArray(old)) {
                    // Cache ainda não existe (ex.: INSERT chegou antes do 1º fetch do
                    // board). Em vez de DESCARTAR o evento, agenda um refetch pra buscar
                    // o deal novo — senão o card só apareceria após F5.
                    Promise.resolve().then(() =>
                      queryClient.invalidateQueries({ queryKey: DEALS_VIEW_KEY })
                    );
                    return old;
                  }

                  // Check if deal already exists (by real ID)
                  const existingIndex = old.findIndex((d) => d.id === dealId);
                  if (existingIndex !== -1) {
                    // Deal already exists, update it
                    // #region agent log
                    if (process.env.NODE_ENV !== 'production') {
                      console.log(`[Realtime] 📥 INSERT deals - deal already exists, updating`, { dealId: dealId.slice(0, 8) });
                    }
                    // #endregion
                    return old.map((d, i) => i === existingIndex ? { ...d, ...normalizedDeal } as DealView : d);
                  }
                  
                  // Remove any temp deals with same title (they are placeholders for this deal)
                  const tempDealsRemoved = old.filter((d) => {
                    const isTemp = typeof d.id === 'string' && d.id.startsWith('temp-');
                    const sameTitle = d.title === newData.title;
                    return !(isTemp && sameTitle);
                  });
                  
                  // #region agent log
                  if (process.env.NODE_ENV !== 'production') {
                    const removedCount = old.length - tempDealsRemoved.length;
                    console.log(`[Realtime] 📥 INSERT deals - adding new deal to cache`, { dealId: dealId.slice(0, 8), removedTempDeals: removedCount, cacheSize: tempDealsRemoved.length + 1 });
                  }
                  // #endregion
                  
                  // Add new deal at the beginning
                  return [normalizedDeal as unknown as DealView, ...tempDealsRemoved];
                }
              );
              
              // Don't invalidate for deals INSERT - we've added it directly
              return;
            }
            
            if (!flushScheduledRef.current) {
              flushScheduledRef.current = true;
              queueMicrotask(() => {
                flushScheduledRef.current = false;

                const keysToFlush = Array.from(pendingInvalidationsRef.current);
                pendingInvalidationsRef.current.clear();
                const keysInvalidateOnly = Array.from(pendingInvalidateOnlyRef.current);
                pendingInvalidateOnlyRef.current.clear();
                const boardStagesInsertCount = pendingBoardStagesInsertCountRef.current;
                pendingBoardStagesInsertCountRef.current = 0;

                keysToFlush.forEach((queryKey) => {
                  queryClient.invalidateQueries({
                    queryKey,
                    exact: false,
                    refetchType: 'all',
                  });
                });

                // For bursty INSERT sources (ex.: board_stages create-board burst),
                // invalidate-only (no refetch) to avoid storms. But for single INSERT, refetch to keep realtime UX.
                keysInvalidateOnly.forEach((queryKey) => {
                  queryClient.invalidateQueries({
                    queryKey,
                    exact: false,
                    refetchType: boardStagesInsertCount <= 1 ? 'all' : 'none',
                  });
                });
              });
            }
          } else {
            // For deals UPDATE: apply directly to cache to avoid race condition with optimistic updates
            // When user moves a deal:
            // 1. Optimistic update moves it visually
            // 2. Server confirms
            // 3. Realtime UPDATE arrives
            // If we invalidate here, we might refetch stale data and the deal "jumps back"
            // Instead, apply the update directly to cache
            if (payload.eventType === 'UPDATE' && table === 'deals') {
              const newData = payload.new as Record<string, unknown>;
              const dealId = newData.id as string;

              // Story 2.29 — a decisao de aplicar deixou de ser "o card mudou de
              // coluna?" e passou a ser "esta linha e mais nova que a do cache?".
              //
              // A regra antiga comparava `stage_id` com o `status` do cache e,
              // quando eram iguais, DESCARTAVA A LINHA INTEIRA. Ou seja: toda
              // edicao que nao move o card (valor, titulo, campos personalizados,
              // motivo de perda) era jogada fora — e so aparecia com F5.
              //
              // A protecao que aquela regra tentava dar (o card "pular de volta"
              // por cima do otimismo) continua, agora pelo timestamp: evento fora
              // de ordem chega com `updated_at` mais antigo e e descartado.
              queryClient.setQueryData<DealView[]>(DEALS_VIEW_KEY, (old) => {
                if (!old || !Array.isArray(old)) return old;

                const indice = old.findIndex((d) => d.id === dealId);

                // Deal ausente do cache (criado em outra aba): normaliza e entra.
                // ⚠️ Antes entrava a linha CRUA em snake_case, virando um card com
                // os campos todos vazios ate o proximo fetch.
                if (indice === -1) {
                  return [...old, normalizarDealDoRealtime(newData) as DealView];
                }

                const atual = old[indice];
                const chegouUpdatedAt = (newData.updated_at ?? newData.updatedAt) as string | undefined;
                if (!linhaDoRealtimeEhMaisNova(atual.updatedAt, chegouUpdatedAt)) {
                  return old;
                }

                const proximo = [...old];
                proximo[indice] = mesclarDealDoRealtime(atual, newData);
                return proximo;
              });

              // Still invalidate dashboard stats (they need recalculation)
              queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.stats });
            } else {
              // For other tables or DELETE: debounce invalidation
              if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
              }

              debounceTimerRef.current = setTimeout(() => {
                // Invalidate all pending queries
                pendingInvalidationsRef.current.forEach(queryKey => {
                  // Skip conversations-list invalidation while a deletion is in-progress.
                  if (pendingDeletionIds.size > 0 && queryKey === queryKeys.messagingConversations.all) {
                    return;
                  }
                  if (DEBUG_REALTIME) {
                    console.log(`[Realtime] Invalidating queries (debounced):`, queryKey);
                  }
                  queryClient.invalidateQueries({ queryKey });
                });
                pendingInvalidationsRef.current.clear();
              }, debounceMs);
            }
          }
        }
      );
    });

    // Delay subscription slightly to avoid race condition with previous channel
    // removal in React StrictMode (unmount → remount happens synchronously, but
    // Supabase removeChannel is async on the server side).
    const subscribeTimer = setTimeout(() => {
      channel.subscribe((status) => {
        if (DEBUG_REALTIME) {
          console.log(`[Realtime] Channel ${channelName} status:`, status);
        }

        isConnectedRef.current = status === 'SUBSCRIBED';

        if (status === 'SUBSCRIBED') {
          console.log(`[Realtime] ✅ Connected to ${tableList.join(', ')}`);
        } else if (status === 'CHANNEL_ERROR') {
          console.warn(`[Realtime] Channel error for ${channelName} (will auto-retry)`);
        } else if (status === 'TIMED_OUT') {
          console.warn(`[Realtime] Channel timeout for ${channelName}`);
        } else if (status === 'CLOSED') {
          if (DEBUG_REALTIME) {
            console.warn(`[Realtime] Channel closed for ${channelName}`);
          }
        }
      });
    }, 100);

    channelRef.current = channel;

    // Cleanup (detach-and-forget: null ref immediately, remove async)
    return () => {
      clearTimeout(subscribeTimer);
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      const channelToRemove = channelRef.current;
      channelRef.current = null;
      isConnectedRef.current = false;
      if (channelToRemove) {
        sb.removeChannel(channelToRemove);
      }
    };
    // Only re-run if enabled, tables, or debounceMs change
    // queryClient is stable, onchange is handled via ref
  }, [enabled, JSON.stringify(tables), debounceMs]);

  return {
    /** Manually trigger a sync */
    sync: () => {
      const tableList = Array.isArray(tables) ? tables : [tables];
      tableList.forEach(table => {
        const keys = getTableQueryKeys(table);
        keys.forEach(queryKey => {
          queryClient.invalidateQueries({ queryKey });
        });
      });
    },
    /** Check if channel is connected */
    isConnected: isConnectedRef.current,
  };
}

/**
 * Subscribe to all CRM-related tables at once
 * Ideal for the main app layout
 */
export function useRealtimeSyncAll(options: UseRealtimeSyncOptions = {}) {
  return useRealtimeSync(['deals', 'contacts', 'activities', 'boards', 'crm_companies'], options);
}

/**
 * Subscribe to Kanban-related tables
 * Optimized for the boards page
 */
export function useRealtimeSyncKanban(options: UseRealtimeSyncOptions = {}) {
  return useRealtimeSync(['deals', 'board_stages'], options);
}

/**
 * Subscribe to Messaging-related tables
 * Optimized for the messaging inbox
 */
export function useRealtimeSyncMessaging(options: UseRealtimeSyncOptions = {}) {
  return useRealtimeSync(['messaging_conversations', 'messaging_messages'], options);
}
