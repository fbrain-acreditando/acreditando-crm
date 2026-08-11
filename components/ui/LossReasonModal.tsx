import React, { useState, useEffect, useRef, useId } from 'react';
import { X, ThumbsDown, DollarSign, Users, Clock, HelpCircle, MapPin } from 'lucide-react';
import { FocusTrap, useFocusReturn } from '@/lib/a11y';

interface LossReasonModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  dealTitle?: string;
}

/**
 * Motivos rápidos de perda.
 *
 * ⚠️ Ordem NÃO é arbitrária: o 1º é o mais frequente na operação. "Distância"
 * entrou primeiro (pedido da Fernanda, story 2.26) porque a medição mostrou que
 * ele é **6 dos 11** deals perdidos — enquanto os 5 botões que já existiam,
 * somados, foram usados 2 vezes. Era o único motivo comum sem botão, e por isso
 * vinha digitado à mão: o banco já tem `distância`, `distãncia` e
 * `distância e parte financeira` — três grafias do mesmo motivo, impossíveis de agrupar.
 *
 * `value` é o que fica gravado em `deals.loss_reason` e é o que os relatórios
 * agrupam ⇒ **um motivo, um `value` canônico**. Mudar um `value` daqui
 * fragmenta o histórico; para renomear, migrar as linhas existentes junto.
 */
const QUICK_REASONS = [
  { label: 'Distância', icon: MapPin, value: 'Distância' },
  { label: 'Preço', icon: DollarSign, value: 'Preço muito alto' },
  { label: 'Concorrência', icon: Users, value: 'Perdeu para concorrente' },
  { label: 'Timing', icon: Clock, value: 'Momento inadequado' },
  { label: 'Desistência', icon: X, value: 'Cliente desistiu' },
  { label: 'Outro', icon: HelpCircle, value: '' },
];

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
}) => {
  const [reason, setReason] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  
  const generatedId = useId();
  const titleId = `loss-reason-title-${generatedId}`;
  const descId = `loss-reason-desc-${generatedId}`;
  const inputId = `loss-reason-input-${generatedId}`;

  // Restore focus to trigger element on close
  useFocusReturn({ enabled: isOpen });

  useEffect(() => {
    if (isOpen) {
      setReason('');
      setShowCustomInput(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (showCustomInput && inputRef.current) {
      inputRef.current.focus();
    }
  }, [showCustomInput]);

  if (!isOpen) return null;

  const handleQuickReason = (value: string) => {
    if (value === '') {
      setShowCustomInput(true);
    } else {
      onConfirm(value);
      onClose();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (reason.trim()) {
      onConfirm(reason.trim());
      onClose();
    }
  };

  const handleSkip = () => {
    onConfirm('Não informado');
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
          className="bg-white dark:bg-dark-card border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200"
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
          <div className="p-6">
            <p 
              id={descId}
              className="text-sm text-slate-600 dark:text-slate-400 mb-4"
            >
              Qual foi o motivo da perda? Isso ajuda a melhorar suas estratégias.
            </p>

            {!showCustomInput ? (
              <div className="grid grid-cols-2 gap-2" role="group" aria-label="Motivos rápidos">
                {QUICK_REASONS.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => handleQuickReason(item.value)}
                    className="flex items-center gap-2 p-3 rounded-xl border border-slate-200 dark:border-white/10 
                               hover:border-red-300 dark:hover:border-red-500/50 hover:bg-red-50 dark:hover:bg-red-900/10
                               transition-all group text-left focus-visible-ring"
                  >
                    <item.icon className="w-4 h-4 text-slate-400 group-hover:text-red-500 dark:group-hover:text-red-400 transition-colors" aria-hidden="true" />
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
