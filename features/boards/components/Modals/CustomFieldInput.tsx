'use client';

/**
 * Campo personalizado do card — story 2.26.
 *
 * O defeito que originou este componente: o input era controlado **direto pelo
 * dado do servidor** (`value={deal.customFields?.[key]}`) e gravava **a cada
 * tecla**. A Fernanda descreveu o sintoma melhor do que qualquer log:
 * *"escrevo, apaga sozinho e depois aparece — fica piscando"*.
 *
 * A sequência era:
 *   1. digita `D`   -> update otimista -> `D` aparece
 *   2. digita `i`   -> 2ª mutation      -> otimista `Di`
 *   3. a 1ª mutation resolve -> invalidateQueries(deals.all)
 *   4. o refetch aterrissa com `D` -> o input VOLTA para `D`   <- "apaga sozinho"
 *   5. a 2ª resolve -> refetch -> `Di` reaparece               <- "depois aparece"
 *
 * O update otimista existia e não resolvia: o problema é a reconciliação
 * chegando **atrasada** sobre um input **sem memória própria**.
 *
 * A correção segue a convenção que o repo já usa em `LeadNameEditor` (story
 * 2.20): estado local, e o servidor só sobrescreve quando o campo **não está
 * sendo editado**. Grava ao sair do campo — 1 escrita por edição, não por tecla
 * (digitar "Distância" gerava 9 UPDATEs, 9 broadcasts de Realtime e ~36
 * consultas, porque `dealsViewQueryFn` faz 4 por refetch).
 */
import React, { useEffect, useRef, useState } from 'react';

export interface CustomFieldDefinition {
  id: string;
  key: string;
  label: string;
  type: string;
  options?: string[] | null;
}

interface CustomFieldInputProps {
  field: CustomFieldDefinition;
  /** Valor vindo do servidor. Durante a edição ele MUDA — e é justamente isso
   *  que não pode entrar no input. */
  valorServidor: string;
  /** Chamado só quando há mudança real a gravar. */
  onSalvar: (key: string, valor: string) => void;
}

const CLASSES =
  'w-full bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded px-2 py-1.5 text-sm dark:text-white focus:ring-1 focus:ring-primary-500 outline-none';

export function CustomFieldInput({ field, valorServidor, onSalvar }: CustomFieldInputProps) {
  const [valor, setValor] = useState(valorServidor);
  const editandoRef = useRef(false);

  // Enquanto ela digita, o campo ignora o servidor. Fora da edição, acompanha
  // (outra aba, extração da IA, realtime) — mesma regra do LeadNameEditor.
  useEffect(() => {
    if (!editandoRef.current) setValor(valorServidor);
  }, [valorServidor]);

  /**
   * `editandoRef` é o "já tratei" — não só o "está editando".
   *
   * Enter e Escape chamam `.blur()`, que dispara `onBlur` logo depois. Sem este
   * guarda: o Enter gravava DUAS vezes, e o Escape gravava assim mesmo, porque
   * `setValor` é assíncrono e o `onBlur` lia o `valor` velho. Os dois foram
   * pegos por teste, não em revisão.
   */
  function salvarSeMudou() {
    if (!editandoRef.current) return;
    editandoRef.current = false;
    // Sair do campo sem alterar nada não pode gerar escrita: cada UPDATE dispara
    // Realtime e um refetch do board inteiro para todo mundo que está com a tela aberta.
    if (valor === valorServidor) return;
    onSalvar(field.key, valor);
  }

  function descartar() {
    editandoRef.current = false; // antes do blur, para o onBlur não gravar o valor velho
    setValor(valorServidor);
  }

  if (field.type === 'select') {
    // Em `select` não há digitação: não existe janela para o refetch atropelar,
    // e gravar na hora é o comportamento esperado de um seletor.
    return (
      <select
        value={valorServidor}
        onChange={e => onSalvar(field.key, e.target.value)}
        className={CLASSES}
        aria-label={field.label}
      >
        <option value="">Selecione...</option>
        {field.options?.map(opt => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    );
  }

  return (
    <input
      type={field.type}
      value={valor}
      aria-label={field.label}
      onFocus={() => {
        editandoRef.current = true;
      }}
      onChange={e => setValor(e.target.value)}
      onBlur={salvarSeMudou}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          salvarSeMudou();
          e.currentTarget.blur();
        }
        if (e.key === 'Escape') {
          // Descarta a edição sem fechar o modal por tabela.
          e.stopPropagation();
          descartar();
          e.currentTarget.blur();
        }
      }}
      className={CLASSES}
    />
  );
}
