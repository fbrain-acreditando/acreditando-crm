import React, { useId, useState } from 'react';
import { X } from 'lucide-react';
import { Contact } from '@/types';
import { DebugFillButton } from '@/components/debug/DebugFillButton';
import { fakeContact } from '@/lib/debug';
import { FocusTrap, useFocusReturn } from '@/lib/a11y';
import {
  impedimentoParaSalvarContato,
  MENSAGEM_DO_IMPEDIMENTO,
  type ImpedimentoDeContato,
} from '../validacaoDeContato';

interface ContactFormData {
  name: string;
  email: string;
  phone: string;
  role: string;
  companyName: string;
}

interface ContactFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  formData: ContactFormData;
  setFormData: (data: ContactFormData) => void;
  editingContact: Contact | null;
  createFakeContactsBatch?: (count: number) => Promise<void>;
  isSubmitting?: boolean;
}

/**
 * Componente React `ContactFormModal`.
 *
 * @param {ContactFormModalProps} {
  isOpen,
  onClose,
  onSubmit,
  formData,
  setFormData,
  editingContact,
} - Parâmetro `{
  isOpen,
  onClose,
  onSubmit,
  formData,
  setFormData,
  editingContact,
}`.
 * @returns {Element | null} Retorna um valor do tipo `Element | null`.
 */
export const ContactFormModal: React.FC<ContactFormModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  formData,
  setFormData,
  editingContact,
  createFakeContactsBatch,
  isSubmitting = false,
}) => {
  const headingId = useId();
  useFocusReturn({ enabled: isOpen });
  const [isCreatingBatch, setIsCreatingBatch] = useState(false);

  // Story 2.45 — o `required` do e-mail saiu, então a regra "nome + ao menos uma
  // forma de contato" precisa existir aqui. Sem isto, tirar o `required` trocaria
  // "exige o que ninguém tem" por "aceita linha órfã calada" — e cadastro sem
  // telefone nem e-mail é justamente o que ela não conseguiria achar depois.
  const [impedimento, setImpedimento] = useState<ImpedimentoDeContato | null>(null);

  const aoEnviar = (e: React.FormEvent) => {
    const problema = impedimentoParaSalvarContato(formData);
    if (problema) {
      e.preventDefault();
      setImpedimento(problema);
      return;
    }
    setImpedimento(null);
    onSubmit(e);
  };
  
  if (!isOpen) return null;

  const fillWithFakeData = () => {
    const fake = fakeContact();
    setFormData({
      name: fake.name,
      email: fake.email,
      phone: fake.phone,
      role: fake.role,
      companyName: fake.companyName,
    });
  };

  return (
    <FocusTrap active={isOpen} onEscape={onClose}>
      <div 
        className="fixed inset-0 md:left-[var(--app-sidebar-width,0px)] z-[9999] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onClick={(e) => {
          // Close only when clicking the backdrop (outside the panel).
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className="bg-white dark:bg-dark-card border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl w-full max-w-md animate-in zoom-in-95 duration-200">
          <div className="p-5 border-b border-slate-200 dark:border-white/10 flex justify-between items-center">
            <div className="flex items-center gap-2">
              <h2 id={headingId} className="text-lg font-bold text-slate-900 dark:text-white font-display">
                {editingContact ? 'Editar Contato' : 'Novo Contato'}
              </h2>
              <DebugFillButton onClick={fillWithFakeData} />
              {createFakeContactsBatch && (
                <DebugFillButton
                  onClick={async () => {
                    setIsCreatingBatch(true);
                    try {
                      await createFakeContactsBatch(10);
                      onClose();
                    } finally {
                      setIsCreatingBatch(false);
                    }
                  }}
                  label={isCreatingBatch ? 'Criando...' : 'Fake x10'}
                  variant="secondary"
                  className="ml-1"
                  disabled={isCreatingBatch}
                />
              )}
            </div>
            <button
              onClick={onClose}
              aria-label="Fechar modal"
              className="text-slate-400 hover:text-slate-600 dark:hover:text-white focus-visible-ring rounded"
            >
              <X size={20} aria-hidden="true" />
            </button>
          </div>
        <form onSubmit={aoEnviar} noValidate className="p-5 space-y-4">
          <div>
            <label htmlFor="contact-name" className="block text-xs font-bold text-slate-500 uppercase mb-1">
              Nome Completo <span aria-hidden="true">*</span>
            </label>
            <input
              id="contact-name"
              required
              aria-required="true"
              type="text"
              className="w-full bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="Ex: Ana Souza"
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
            />
          </div>
          {/*
            Story 2.45 — Telefone SUBIU e virou o campo de contato principal;
            e-mail desceu e deixou de ser obrigatório.
            Medido: 956 dos 957 contatos não têm e-mail; só 90 não têm telefone.
            O formulário exigia o campo que 99,9% da base não possui.
          */}
          <div>
            <label htmlFor="contact-phone" className="block text-xs font-bold text-slate-500 uppercase mb-1">
              Telefone
            </label>
            <input
              id="contact-phone"
              type="tel"
              inputMode="tel"
              className="w-full bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="+5511999999999"
              value={formData.phone}
              onChange={e => setFormData({ ...formData, phone: e.target.value })}
            />
            <p className="text-[10px] text-slate-400 mt-1">
              Telefone ou e-mail — basta um dos dois.
            </p>
          </div>
          <div>
            <label htmlFor="contact-email" className="block text-xs font-bold text-slate-500 uppercase mb-1">
              Email
            </label>
            <input
              id="contact-email"
              type="email"
              className="w-full bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="ana@empresa.com"
              value={formData.email}
              onChange={e => setFormData({ ...formData, email: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="contact-role" className="block text-xs font-bold text-slate-500 uppercase mb-1">Cargo</label>
            <input
              id="contact-role"
              type="text"
              className="w-full bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="Gerente"
              value={formData.role}
              onChange={e => setFormData({ ...formData, role: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="contact-company" className="block text-xs font-bold text-slate-500 uppercase mb-1">
              Empresa
            </label>
            <input
              id="contact-company"
              type="text"
              className="w-full bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="Nome da Empresa"
              value={formData.companyName}
              onChange={e => setFormData({ ...formData, companyName: e.target.value })}
            />
            <p className="text-[10px] text-slate-400 mt-1">
              {editingContact
                ? 'Edite para alterar a empresa. Deixe em branco para desvincular.'
                : 'Se a empresa já existir, o contato será vinculado a ela.'}
            </p>
          </div>

          {/*
            `role="alert"` para o leitor de tela anunciar sem precisar de foco.
            A mensagem fica JUNTO do botão que falhou — não como toast que some
            antes de ser lido.
          */}
          {impedimento && (
            <p role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">
              {MENSAGEM_DO_IMPEDIMENTO[impedimento]}
            </p>
          )}

            <button
            type="submit"
              disabled={isSubmitting}
            className="w-full bg-primary-600 hover:bg-primary-500 text-white font-bold py-2.5 rounded-lg mt-2 shadow-lg shadow-primary-600/20 transition-all"
          >
            {isSubmitting ? 'Criando...' : (editingContact ? 'Salvar Alterações' : 'Criar Contato')}
          </button>
        </form>
        </div>
      </div>
    </FocusTrap>
  );
};
