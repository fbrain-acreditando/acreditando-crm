'use client';

/**
 * Aviso + botão "Assumir conversa" — story 2.52, AC4.6.
 *
 * Aparece só enquanto a conversa iniciada pelo CRM pediu o humano
 * (`humano_pedido`) e ainda não tem `humano_confirmado_em` — inclui o caso
 * `humano_falhou`. Confirmou ⇒ o aviso some (a conversa é relida).
 */

import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { queryKeys } from '@/lib/query/queryKeys';

export const TEXTO_AVISO_IA = 'A IA do WhatsApp ainda pode responder este lead';
export const TEXTO_NAO_ASSUMIU = 'Não deu para assumir agora. Tente de novo em alguns segundos.';

/** Regra pura: mostra o aviso? */
export function precisaAssumir(metadata: Record<string, unknown> | null | undefined): boolean {
  return metadata?.humano_pedido === true && !metadata?.humano_confirmado_em;
}

interface Props {
  conversationId: string;
  metadata: Record<string, unknown> | null | undefined;
}

export function AvisoAssumirConversa({ conversationId, metadata }: Props) {
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const [assumindo, setAssumindo] = useState(false);

  if (!precisaAssumir(metadata)) return null;

  const assumir = async () => {
    setAssumindo(true);
    try {
      const res = await fetch(`/api/messaging/conversations/${encodeURIComponent(conversationId)}/assumir`, {
        method: 'POST',
      });
      const corpo = (await res.json().catch(() => ({}))) as { confirmado?: boolean };
      if (res.ok && corpo.confirmado === true) {
        addToast('Conversa assumida. A IA do WhatsApp não responde mais este lead.', 'success');
      } else {
        addToast(TEXTO_NAO_ASSUMIU, 'warning');
      }
    } catch {
      addToast(TEXTO_NAO_ASSUMIU, 'warning');
    } finally {
      setAssumindo(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.messagingConversations.detail(conversationId) });
    }
  };

  return (
    <div
      role="status"
      className="px-4 py-2 flex items-center gap-3 bg-amber-50 dark:bg-amber-500/10 border-b border-amber-200 dark:border-amber-500/20 text-sm text-amber-800 dark:text-amber-200"
    >
      <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
      <span className="flex-1">{TEXTO_AVISO_IA}</span>
      <button
        type="button"
        onClick={assumir}
        disabled={assumindo}
        className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-60"
      >
        {assumindo && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
        Assumir conversa
      </button>
    </div>
  );
}
