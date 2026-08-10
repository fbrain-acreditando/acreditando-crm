'use client';

/**
 * Edição do nome do lead — story 2.20.
 *
 * Um componente só, usado em Conversas (`ContactPanel`) e em Boards
 * (`DealDetailModal`). As duas telas gravam no MESMO lugar: `contacts.name`.
 * Não existe "editar o nome da conversa" nem "editar o nome do card" — existe
 * **editar o nome do lead**, e a propagação é do banco.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Check, Pencil, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/context/ToastContext';
import { useRenameLead } from '@/lib/query/hooks/useRenameLead';

interface LeadNameEditorProps {
  /** Sem contato vinculado não há o que editar — a fonte é `contacts.name`. */
  contactId?: string;
  /** Nome exibido hoje (já resolvido pela regra contato → pushName → fallback). */
  displayName: string;
  /** Classe do texto quando NÃO está editando, para casar com a tela de origem. */
  className?: string;
  /** Rótulo do botão de editar, para leitor de tela. */
  ariaLabel?: string;
}

export function LeadNameEditor({
  contactId,
  displayName,
  className,
  ariaLabel = 'Editar o nome do lead',
}: LeadNameEditorProps) {
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(displayName);
  const inputRef = useRef<HTMLInputElement>(null);
  const { addToast } = useToast();
  const renomear = useRenameLead();

  // Se o nome mudar por fora (outra aba, realtime), o campo fechado acompanha.
  useEffect(() => {
    if (!editando) setValor(displayName);
  }, [displayName, editando]);

  useEffect(() => {
    if (editando) inputRef.current?.select();
  }, [editando]);

  function cancelar() {
    setValor(displayName);
    setEditando(false);
  }

  function salvar() {
    const novo = valor.trim();

    // `deals.title` é NOT NULL e o título automático é montado com o nome. Nome
    // vazio produziria o card " - WhatsApp". O banco também barra (é a regra de
    // verdade); aqui é só para o usuário não descobrir isso por mensagem de erro.
    if (!novo) {
      addToast('O nome do lead não pode ficar vazio.', 'error');
      inputRef.current?.focus();
      return;
    }
    if (!contactId) {
      addToast('Esta conversa não tem contato vinculado — não há nome para editar.', 'error');
      return;
    }
    if (novo === displayName) {
      setEditando(false);
      return;
    }

    renomear.mutate(
      { contactId, name: novo },
      {
        onSuccess: (r) => {
          setEditando(false);

          // AC5 — nada muda (nem deixa de mudar) em silêncio.
          const partes = [`Nome alterado para "${r.nome_novo}".`];
          if (r.cards_renomeados > 0) {
            partes.push(
              `${r.cards_renomeados} ${r.cards_renomeados === 1 ? 'card renomeado' : 'cards renomeados'}`
            );
          }
          if (r.cards_preservados > 0) {
            partes.push(
              `${r.cards_preservados} ${r.cards_preservados === 1 ? 'card manteve' : 'cards mantiveram'} o título personalizado`
            );
          }
          addToast(partes.join(' · '), 'success');
        },
        onError: (e: unknown) => {
          const msg = e instanceof Error ? e.message : 'Não foi possível alterar o nome.';
          addToast(msg, 'error');
        },
      }
    );
  }

  if (!editando) {
    return (
      <span className="group inline-flex items-center gap-1.5 min-w-0">
        <span className={cn('truncate', className)}>{displayName}</span>
        {contactId && (
          <button
            type="button"
            onClick={() => setEditando(true)}
            aria-label={ariaLabel}
            title={ariaLabel}
            className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 flex-shrink-0"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        )}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 min-w-0 w-full">
      <input
        ref={inputRef}
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') salvar();
          if (e.key === 'Escape') cancelar();
        }}
        disabled={renomear.isPending}
        aria-label="Nome do lead"
        maxLength={120}
        className="flex-1 min-w-0 px-2 py-1 rounded border border-slate-300 dark:border-white/20 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-base disabled:opacity-60"
      />
      <button
        type="button"
        onClick={salvar}
        disabled={renomear.isPending}
        aria-label="Salvar o nome"
        title="Salvar"
        className="p-1 rounded text-green-600 hover:bg-green-50 dark:hover:bg-green-500/10 disabled:opacity-60 flex-shrink-0"
      >
        <Check className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={cancelar}
        disabled={renomear.isPending}
        aria-label="Cancelar"
        title="Cancelar"
        className="p-1 rounded text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10 disabled:opacity-60 flex-shrink-0"
      >
        <X className="w-4 h-4" />
      </button>
    </span>
  );
}
