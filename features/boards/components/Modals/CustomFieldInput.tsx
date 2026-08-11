'use client';

/**
 * Campo personalizado do card — stories 2.26 e 2.27.
 *
 * ## 2.26 — o defeito original
 * O input era controlado **direto pelo dado do servidor**
 * (`value={deal.customFields?.[key]}`) e gravava **a cada tecla**. A Fernanda
 * descreveu o sintoma melhor do que qualquer log: *"escrevo, apaga sozinho e
 * depois aparece — fica piscando"*. Cada tecla disparava uma mutation cujo
 * `onSettled` invalidava `deals.all`; o refetch aterrissava com o valor
 * ANTERIOR e devolvia o input para trás.
 *
 * ## 2.27 — o pedido dela
 * *"toda alteração, quando for feita, precisa clicar em salvar"*.
 *
 * ⇒ Este componente **não grava mais**. Ele reporta a mudança e o
 * `DealDetailModal` segura os pendentes até ela clicar em Salvar.
 *
 * 🔑 **E é isso que também mata o piscar**, agora por construção: enquanto
 * houver valor pendente, ele é o que aparece — o dado do servidor não tem por
 * onde atropelar, porque nem chega ao input. Não é preciso estado local nem
 * "ignorar o servidor enquanto edita": **o pendente é a memória**.
 */
import React from 'react';

export interface CustomFieldDefinition {
  id: string;
  key: string;
  label: string;
  type: string;
  options?: string[] | null;
}

interface CustomFieldInputProps {
  field: CustomFieldDefinition;
  /** Pendente, se houver; senão o valor do servidor. Quem resolve é o pai. */
  valor: string;
  /** Reporta a digitação. NÃO grava — quem grava é o botão Salvar. */
  onMudar: (key: string, valor: string) => void;
  /** True quando este campo tem alteração não salva — para a tela mostrar. */
  alterado?: boolean;
}

const CLASSES =
  'w-full bg-slate-50 dark:bg-black/20 border rounded px-2 py-1.5 text-sm dark:text-white focus:ring-1 focus:ring-primary-500 outline-none';

export function CustomFieldInput({ field, valor, onMudar, alterado }: CustomFieldInputProps) {
  // Borda âmbar = "isto ainda não está salvo". Sem isso, a barra de Salvar diz
  // que há pendência e ela não sabe ONDE — foi a lição da story 2.20 (o lápis
  // que existia e ninguém achava).
  const borda = alterado
    ? 'border-amber-400 dark:border-amber-500/60'
    : 'border-slate-200 dark:border-white/10';

  if (field.type === 'select') {
    return (
      <select
        value={valor}
        onChange={e => onMudar(field.key, e.target.value)}
        className={`${CLASSES} ${borda}`}
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
      onChange={e => onMudar(field.key, e.target.value)}
      className={`${CLASSES} ${borda}`}
    />
  );
}
