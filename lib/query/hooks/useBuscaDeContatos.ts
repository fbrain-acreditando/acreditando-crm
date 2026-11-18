/**
 * Story 2.76 (D1, D6) — busca de contato no BANCO, com espera entre teclas.
 *
 * Substitui o "procurar dentro do `useContacts()`" (os 1.000 contatos mais
 * novos) na seleção de contato e no Inbox. 300 ms depois da última tecla vai ao
 * banco (`contactsService.buscarParaSelecao`); termo com menos de 3 letras ou
 * 4 números não consulta.
 *
 * A chave fica debaixo de `queryKeys.contacts.all`: o Realtime de `contacts`
 * e o renomear lead invalidam junto.
 */
import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { queryKeys } from '../index';
import { contactsService } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { filtroDeContatosParaSelecao, LIMITE_DA_SELECAO_DE_CONTATOS } from '@/lib/supabase/buscaDeContatosNoBanco';
import type { Contact } from '@/types';

/** Espera depois da última tecla (padrão 2.74). */
export const ESPERA_DA_BUSCA_DE_CONTATOS_MS = 300;

/** Chave do cache da busca de contatos. */
export const chaveDaBuscaDeContatos = (termo: string, limite: number) =>
  [...queryKeys.contacts.all, 'busca', termo, limite] as const;

/** Lista vazia estável (não muda a cada render). */
const SEM_CONTATOS: Contact[] = [];

export interface BuscaDeContatos {
  contatos: Contact[];
  /** Esperando a pessoa parar de digitar ou o banco responder. */
  carregando: boolean;
  erro: boolean;
  /** Há texto, mas curto demais para ir ao banco. */
  termoCurto: boolean;
}

/**
 * O termo depois de `ms` sem mudar. Começa VAZIO: o primeiro valor também
 * espera (montar já com texto não dispara uma consulta por tecla).
 */
function useTermoComEspera(valor: string, ms: number): string {
  const [comEspera, setComEspera] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setComEspera(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return comEspera;
}

export function useBuscaDeContatos(
  termo: string,
  opcoes?: { limite?: number; enabled?: boolean }
): BuscaDeContatos {
  const { user, loading: authLoading } = useAuth();
  const limite = opcoes?.limite ?? LIMITE_DA_SELECAO_DE_CONTATOS;
  const ligado = opcoes?.enabled ?? true;

  const termoAtual = termo.trim();
  const termoComEspera = useTermoComEspera(termoAtual, ESPERA_DA_BUSCA_DE_CONTATOS_MS);
  const vaiAoBanco = filtroDeContatosParaSelecao(termoComEspera) !== null;
  const termoCurto = ligado && termoAtual !== '' && filtroDeContatosParaSelecao(termoAtual) === null;

  const consulta = useQuery<Contact[], Error>({
    queryKey: chaveDaBuscaDeContatos(termoComEspera, limite),
    queryFn: async ({ signal }) => {
      const { data, error } = await contactsService.buscarParaSelecao(termoComEspera, { signal, limite });
      if (error) throw error;
      return data ?? [];
    },
    enabled: ligado && vaiAoBanco && !authLoading && !!user,
    staleTime: 2 * 60 * 1000,
    retry: false,
    placeholderData: keepPreviousData,
  });

  if (!ligado || termoAtual === '' || termoCurto) {
    return { contatos: SEM_CONTATOS, carregando: false, erro: false, termoCurto };
  }
  const termoEmDia = termoComEspera === termoAtual;
  if (!termoEmDia || consulta.isPending || consulta.isPlaceholderData) {
    return { contatos: consulta.data ?? SEM_CONTATOS, carregando: true, erro: false, termoCurto: false };
  }
  if (consulta.isError) return { contatos: SEM_CONTATOS, carregando: false, erro: true, termoCurto: false };
  return { contatos: consulta.data ?? SEM_CONTATOS, carregando: false, erro: false, termoCurto: false };
}
