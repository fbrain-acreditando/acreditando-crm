'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Search, User, Plus, Building2 } from 'lucide-react';
import { useBuscaDeContatos, useCompanies } from '@/lib/query/hooks';
import type { Contact, Company } from '@/types';

interface ContactSearchComboboxProps {
  onSelectContact: (contact: Contact | null) => void;
  onSelectCompany: (company: Company | null) => void;
  onCreateNew: (searchTerm: string) => void;
  selectedContact: Contact | null;
  selectedCompany: Company | null;
  placeholder?: string;
}

/** Textos da busca (story 2.76, AC4) — os testes afirmam estes literais. */
export const TEXTOS_DA_BUSCA_DE_CONTATO = {
  termoCurto: 'Digite ao menos 3 letras ou 4 números.',
  buscando: 'Buscando…',
  erro: 'Não foi possível buscar contatos. Tente de novo.',
  nenhum: 'Nenhum contato encontrado',
} as const;

/**
 * Combobox de busca unificada de contatos
 * Busca por nome, telefone ou email.
 *
 * Story 2.76 (D1): a busca vai ao BANCO (`useBuscaDeContatos`), não à lista
 * dos 1.000 contatos mais novos — contato antigo aparece e não é recadastrado.
 */
export const ContactSearchCombobox: React.FC<ContactSearchComboboxProps> = ({
  onSelectContact,
  onSelectCompany,
  onCreateNew,
  selectedContact,
  selectedCompany,
  placeholder = 'Buscar contato (nome, telefone ou email)...'
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const busca = useBuscaDeContatos(searchTerm);
  const { data: companies = [] } = useCompanies();

  // Criar mapa de empresas para lookup rápido
  const companyMap = useMemo(() => {
    return new Map(companies.map(c => [c.id, c]));
  }, [companies]);

  // Contatos que o banco devolveu para o termo (até 8, mais recentes primeiro)
  const filteredContacts = busca.contatos;
  // QA loop 2.76a (MEDIUM-1): enquanto a busca do termo atual não volta, a lista
  // ainda é a do termo anterior — aparece (com "Buscando…"), mas não seleciona.
  const podeSelecionar = busca.resultadoDoTermoAtual;

  // Resetar highlight quando resultados mudam
  useEffect(() => {
    setHighlightedIndex(0);
  }, [filteredContacts]);

  // Fechar dropdown quando clicar fora
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        inputRef.current && 
        !inputRef.current.contains(e.target as Node) &&
        listRef.current &&
        !listRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (contact: Contact) => {
    if (!podeSelecionar) return;
    onSelectContact(contact);
    
    // Auto-selecionar empresa do contato se existir
    if (contact.clientCompanyId) {
      const company = companyMap.get(contact.clientCompanyId);
      if (company) {
        onSelectCompany(company);
      }
    }
    
    setSearchTerm('');
    setIsOpen(false);
  };

  const handleCreateNew = () => {
    onCreateNew(searchTerm);
    setIsOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setIsOpen(true);
      }
      return;
    }

    const totalItems = filteredContacts.length + 1; // +1 para "Criar novo"

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex(prev => (prev + 1) % totalItems);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex(prev => (prev - 1 + totalItems) % totalItems);
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightedIndex < filteredContacts.length) {
          // Resultado do termo anterior: o Enter espera a busca nova (não seleciona outro contato).
          if (podeSelecionar) handleSelect(filteredContacts[highlightedIndex]);
        } else if (!busca.carregando) {
          // LOW-4 (QA 2.76a): Enter durante "Buscando…" não abre "Criar novo" —
          // o contato pode existir e ainda não ter voltado (era o caminho do gêmeo).
          // O clique explícito em "Criar novo" continua valendo.
          handleCreateNew();
        }
        break;
      case 'Escape':
        setIsOpen(false);
        break;
    }
  };

  // Se já tem contato selecionado, não renderiza o combobox
  if (selectedContact) {
    return null;
  }

  return (
    <div className="relative">
      {/* Input de busca */}
      <div className="relative">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          ref={inputRef}
          type="text"
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => searchTerm && setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
        />
      </div>

      {/* Dropdown de resultados */}
      {isOpen && searchTerm.trim() && (
        <div
          ref={listRef}
          className="absolute z-50 w-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150"
        >
          {(busca.termoCurto || busca.carregando || busca.erro) && (
            <div
              role="status"
              className="px-3 pt-3 pb-1 text-sm text-slate-500 dark:text-slate-400 text-center"
            >
              {busca.termoCurto
                ? TEXTOS_DA_BUSCA_DE_CONTATO.termoCurto
                : busca.erro
                  ? TEXTOS_DA_BUSCA_DE_CONTATO.erro
                  : TEXTOS_DA_BUSCA_DE_CONTATO.buscando}
            </div>
          )}
          {filteredContacts.length > 0 ? (
            <div className="max-h-64 overflow-y-auto">
              {filteredContacts.map((contact, index) => {
                const company = contact.clientCompanyId ? companyMap.get(contact.clientCompanyId) : null;
                return (
                  <button
                    key={contact.id}
                    type="button"
                    disabled={!podeSelecionar}
                    onClick={() => handleSelect(contact)}
                    className={`w-full flex items-center gap-3 p-3 text-left transition-colors disabled:opacity-50 disabled:cursor-wait ${
                      index === highlightedIndex
                        ? 'bg-primary-50 dark:bg-primary-900/30'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'
                    }`}
                  >
                    <div className="w-10 h-10 bg-slate-100 dark:bg-slate-700 rounded-full flex items-center justify-center flex-shrink-0">
                      <User size={18} className="text-slate-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-slate-900 dark:text-white truncate">
                        {contact.name}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        {contact.email && <span className="truncate">{contact.email}</span>}
                        {contact.email && contact.phone && <span>•</span>}
                        {contact.phone && <span>{contact.phone}</span>}
                      </div>
                      {company && (
                        <div className="flex items-center gap-1 text-xs text-slate-400 mt-0.5">
                          <Building2 size={10} />
                          <span className="truncate">{company.name}</span>
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : busca.termoCurto || busca.carregando || busca.erro ? null : (
            <div className="p-3 text-sm text-slate-500 dark:text-slate-400 text-center">
              {TEXTOS_DA_BUSCA_DE_CONTATO.nenhum}
            </div>
          )}
          
          {/* Opção de criar novo */}
          <button
            type="button"
            onClick={handleCreateNew}
            className={`w-full flex items-center gap-3 p-3 border-t border-slate-100 dark:border-slate-700 text-left transition-colors ${
              highlightedIndex === filteredContacts.length
                ? 'bg-primary-50 dark:bg-primary-900/30'
                : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'
            }`}
          >
            <div className="w-10 h-10 bg-primary-100 dark:bg-primary-900/50 rounded-full flex items-center justify-center flex-shrink-0">
              <Plus size={18} className="text-primary-600 dark:text-primary-400" />
            </div>
            <div>
              <p className="font-medium text-primary-600 dark:text-primary-400">
                Criar novo contato
              </p>
              {searchTerm && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  com &quot;{searchTerm}&quot;
                </p>
              )}
            </div>
          </button>
        </div>
      )}
    </div>
  );
};
