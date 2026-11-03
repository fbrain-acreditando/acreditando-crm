import React, { useState, useEffect, useRef, useId } from 'react';
import { X, ThumbsDown } from 'lucide-react';
import { FocusTrap, useFocusReturn } from '@/lib/a11y';
import { LIMITE_LOCAL, LIMITE_OBSERVACAO, type LossReasonExtras } from './localDaPerda';
import { MOTIVOS_DE_PERDA } from './motivosDePerda';

export { LIMITE_LOCAL, LIMITE_OBSERVACAO, localSugeridoDoCard, type LossReasonExtras } from './localDaPerda';
export { MOTIVOS_DE_PERDA } from './motivosDePerda';

interface LossReasonModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reason: string, extras?: LossReasonExtras) => void;
  dealTitle?: string;
  /**
   * Story 2.66 (D3) — o `ondeReside` do card, mostrado só como DICA cinza no
   * campo "Onde a pessoa mora?". Nunca é gravado.
   */
  localSugerido?: string;
  /**
   * Story 2.67 — o "Onde mora" que o card JÁ tem (`deal.leadLocation`): é o
   * valor inicial do campo. Só volta em `extras.leadLocation` se ela mudar.
   */
  localAtual?: string;
}

const DICA_LOCAL_PADRAO = 'Ex.: Santana (Zona Norte) — depende de apoio para vir';
const DICA_OBSERVACAO = 'Ex.: não tem como vir sozinho, depende de apoio';

const CLASSE_CAMPO = `w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10
  bg-slate-50 dark:bg-white/5 text-sm text-slate-900 dark:text-white
  placeholder:text-slate-400 dark:placeholder:text-slate-500
  focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500
  transition-all`;

/**
 * LossReasonModal - Modal to capture deal loss reason
 *
 * Accessibility Features:
 * - role="dialog" for modal identification
 * - aria-labelledby for title
 * - aria-describedby for description
 * - Focus trap to keep keyboard focus within modal
 * - Escape key closes modal
 * - Proper form labels
 */
export const LossReasonModal: React.FC<LossReasonModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  dealTitle,
  localSugerido,
  localAtual,
}) => {
  const [reason, setReason] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  // Story 2.67 — local e observação no TOPO, para qualquer motivo.
  const [local, setLocal] = useState(localAtual ?? '');
  const [observacao, setObservacao] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const generatedId = useId();
  const titleId = `loss-reason-title-${generatedId}`;
  const descId = `loss-reason-desc-${generatedId}`;
  const inputId = `loss-reason-input-${generatedId}`;
  const localInputId = `lead-location-input-${generatedId}`;
  const localCounterId = `lead-location-counter-${generatedId}`;
  const notaInputId = `loss-note-input-${generatedId}`;
  const notaCounterId = `loss-note-counter-${generatedId}`;

  // Restore focus to trigger element on close
  useFocusReturn({ enabled: isOpen });

  useEffect(() => {
    if (isOpen) {
      setReason('');
      setShowCustomInput(false);
      setLocal(localAtual ?? '');
      setObservacao('');
    }
  }, [isOpen, localAtual]);

  useEffect(() => {
    if (showCustomInput && inputRef.current) {
      inputRef.current.focus();
    }
  }, [showCustomInput]);

  if (!isOpen) return null;

  /**
   * Story 2.67 (AC6) — o que vai junto de QUALQUER motivo:
   * - `leadLocation` só se ela mudou o texto e ele não ficou vazio (o local é
   *   da pessoa; apagar é só pelo card, regra da D4 da 2.66). A dica
   *   (placeholder) nunca entra: ela não é valor do campo;
   * - `lossNote` sempre: o texto, ou `''` (o hook grava `null`, S9).
   */
  const montarExtras = (): LossReasonExtras => {
    const textoLocal = local.trim();
    const mudouLocal = textoLocal !== '' && textoLocal !== (localAtual ?? '').trim();
    return {
      ...(mudouLocal && { leadLocation: textoLocal }),
      lossNote: observacao.trim(),
    };
  };

  // Story 2.67 (S4) — todos os motivos, inclusive Distância, são UM clique.
  const handleQuickReason = (value: string) => {
    if (value === '') {
      setShowCustomInput(true);
    } else {
      onConfirm(value, montarExtras());
      onClose();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (reason.trim()) {
      onConfirm(reason.trim(), montarExtras());
      onClose();
    }
  };

  const handleSkip = () => {
    onConfirm('Não informado', montarExtras());
    onClose();
  };

  return (
    <FocusTrap
      active={isOpen}
      onEscape={onClose}
      returnFocus={true}
    >
      <div
        className="fixed inset-0 md:left-[var(--app-sidebar-width,0px)] z-[9999] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descId}
          className="bg-white dark:bg-dark-card border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl w-full max-w-md max-h-[calc(100dvh-2rem)] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-6 py-4 border-b border-slate-200 dark:border-white/10 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center" aria-hidden="true">
                <ThumbsDown className="w-5 h-5 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <h3
                  id={titleId}
                  className="font-bold text-slate-900 dark:text-white font-display"
                >
                  Negócio Perdido
                </h3>
                {dealTitle && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-[200px]">
                    {dealTitle}
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar modal"
              className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-white/5 transition-colors focus-visible-ring"
            >
              <X className="w-5 h-5 text-slate-400" aria-hidden="true" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 overflow-y-auto">
            {/* Story 2.67 (AC6) — local e observação no topo, sempre visíveis
                (na lista de motivos E no passo do "Outro"). Ficam FORA de
                qualquer <form>: Enter no local não confirma a perda. */}
            <div className="space-y-3 mb-4">
              <div>
                <label
                  htmlFor={localInputId}
                  className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Onde a pessoa mora? (opcional)
                </label>
                <input
                  id={localInputId}
                  type="text"
                  value={local}
                  maxLength={LIMITE_LOCAL}
                  onChange={(e) => setLocal(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.preventDefault();
                  }}
                  placeholder={localSugerido?.trim() ? `Ex.: ${localSugerido.trim()}` : DICA_LOCAL_PADRAO}
                  aria-describedby={localCounterId}
                  className={CLASSE_CAMPO}
                />
                <p id={localCounterId} className="mt-1 text-right text-xs text-slate-400">
                  {local.length}/{LIMITE_LOCAL}
                </p>
              </div>
              <div>
                <label
                  htmlFor={notaInputId}
                  className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Observação (opcional)
                </label>
                <textarea
                  id={notaInputId}
                  value={observacao}
                  maxLength={LIMITE_OBSERVACAO}
                  rows={2}
                  onChange={(e) => setObservacao(e.target.value)}
                  placeholder={DICA_OBSERVACAO}
                  aria-describedby={notaCounterId}
                  className={`${CLASSE_CAMPO} resize-y`}
                />
                <p id={notaCounterId} className="mt-1 text-right text-xs text-slate-400">
                  {observacao.length}/{LIMITE_OBSERVACAO}
                </p>
              </div>
            </div>

            <p
              id={descId}
              className="text-sm text-slate-600 dark:text-slate-400 mb-4"
            >
              Qual foi o motivo da perda? Isso ajuda a melhorar suas estratégias.
            </p>

            {!showCustomInput ? (
              // Story 2.45/2.67 — 15 motivos + Outro. `max-h` + rolagem mantém
              // o modal na altura da tela em telefone; os mais frequentes ficam
              // visíveis sem rolar, que é a razão da ordem.
              <div
                className="grid grid-cols-2 gap-2 max-h-[32vh] overflow-y-auto pr-1"
                role="group"
                aria-label="Motivos rápidos"
              >
                {MOTIVOS_DE_PERDA.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => handleQuickReason(item.value)}
                    className="flex items-center gap-2 p-3 rounded-xl border border-slate-200 dark:border-white/10
                               hover:border-red-300 dark:hover:border-red-500/50 hover:bg-red-50 dark:hover:bg-red-900/10
                               transition-all group text-left focus-visible-ring"
                  >
                    <item.icon className="w-4 h-4 shrink-0 text-slate-400 group-hover:text-red-500 dark:group-hover:text-red-400 transition-colors" aria-hidden="true" />
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300 group-hover:text-red-600 dark:group-hover:text-red-400">
                      {item.label}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <form onSubmit={handleSubmit}>
                <label htmlFor={inputId} className="sr-only">
                  Motivo da perda
                </label>
                <input
                  ref={inputRef}
                  id={inputId}
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Digite o motivo..."
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-white/10
                             bg-slate-50 dark:bg-white/5 text-slate-900 dark:text-white
                             placeholder:text-slate-400 dark:placeholder:text-slate-500
                             focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500
                             transition-all"
                  autoFocus
                />
                <div className="flex gap-2 mt-4">
                  <button
                    type="button"
                    onClick={() => setShowCustomInput(false)}
                    className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium text-slate-600 dark:text-slate-400
                               hover:bg-slate-100 dark:hover:bg-white/5 transition-colors focus-visible-ring"
                  >
                    Voltar
                  </button>
                  <button
                    type="submit"
                    disabled={!reason.trim()}
                    className="flex-1 px-4 py-2.5 rounded-lg text-sm font-bold text-white
                               bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed
                               shadow-lg shadow-red-600/20 transition-all focus-visible-ring"
                  >
                    Confirmar
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Footer */}
          {!showCustomInput && (
            <div className="px-6 pb-6">
              <button
                type="button"
                onClick={handleSkip}
                className="w-full text-center text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors focus-visible-ring rounded p-1"
              >
                Pular esta etapa
              </button>
            </div>
          )}
        </div>
      </div>
    </FocusTrap>
  );
};

export default LossReasonModal;
