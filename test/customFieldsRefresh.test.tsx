/**
 * Reprodução do bug relatado em 27/07: ao criar um campo personalizado, ele só
 * aparecia na lista depois de recarregar a página (F5).
 *
 * O teste exercita a cadeia real — `useSettingsController` → mutation →
 * invalidação → refetch — com um QueryClient de verdade e apenas o serviço
 * Supabase mockado. Se a invalidação não alcançar a query da lista, este teste
 * falha exatamente como o Filipe viu na tela.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CustomFieldDefinition } from '@/types';

// --- Estado do "banco" fake -------------------------------------------------
let fakeDb: CustomFieldDefinition[] = [];

const getAll = vi.fn(async () => ({ data: [...fakeDb], error: null }));
const create = vi.fn(async (input: { label: string; type: string }) => {
  const row = {
    id: `id-${fakeDb.length + 1}`,
    key: `campo${fakeDb.length + 1}`,
    label: input.label,
    type: input.type,
  } as CustomFieldDefinition;
  fakeDb.push(row);
  return { data: row, error: null };
});
const update = vi.fn(async () => ({ error: null }));
const remove = vi.fn(async (id: string) => {
  fakeDb = fakeDb.filter(f => f.id !== id);
  return { error: null };
});

vi.mock('@/lib/supabase', () => ({
  customFieldsService: {
    getAll: (...args: unknown[]) => getAll(...(args as [])),
    create: (...args: unknown[]) => create(...(args as [never])),
    update: (...args: unknown[]) => update(...(args as [])),
    delete: (...args: unknown[]) => remove(...(args as [never])),
  },
}));

// Auth: usuário logado (a query é `enabled` só com sessão)
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' }, loading: false, profile: null }),
}));

const addToast = vi.fn();
vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({ addToast }),
}));

import { useSettingsController } from '@/features/settings/hooks/useSettingsController';

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return React.createElement(QueryClientProvider, { client: queryClient }, children);
}

beforeEach(() => {
  fakeDb = [];
  vi.clearAllMocks();
  localStorage.clear();
});

describe('campo personalizado aparece na lista sem F5', () => {
  it('a lista reflete o campo recém-criado', async () => {
    const { result } = renderHook(() => useSettingsController(), { wrapper });

    await waitFor(() => expect(result.current.customFieldDefinitions).toEqual([]));

    act(() => {
      result.current.setNewFieldLabel('Tipo de Lesão');
    });

    await act(async () => {
      await result.current.handleSaveField();
    });

    // Este é o ponto do bug: sem recarregar a página, a lista tem que ter o campo.
    await waitFor(() => {
      expect(result.current.customFieldDefinitions).toHaveLength(1);
    });
    expect(result.current.customFieldDefinitions[0].label).toBe('Tipo de Lesão');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('a lista reflete a remoção sem F5', async () => {
    const { result } = renderHook(() => useSettingsController(), { wrapper });

    act(() => {
      result.current.setNewFieldLabel('Descartável');
    });
    await act(async () => {
      await result.current.handleSaveField();
    });
    await waitFor(() => expect(result.current.customFieldDefinitions).toHaveLength(1));

    const id = result.current.customFieldDefinitions[0].id;
    await act(async () => {
      await result.current.removeCustomField(id);
    });

    await waitFor(() => expect(result.current.customFieldDefinitions).toHaveLength(0));
  });
});

describe('a lista não depende de refetch (setQueryData)', () => {
  /**
   * Simula o cenário do bug de 27/07: por qualquer motivo, o refetch após a
   * invalidação não traz o dado novo (rede lenta, erro transitório, retry em
   * backoff). Aqui `getAll` fica congelado devolvendo SEMPRE a lista vazia —
   * ou seja, invalidar não adianta nada. A lista ainda assim tem que refletir
   * a criação, porque quem a atualiza é o resultado da própria mutation.
   */
  it('campo criado aparece mesmo com getAll congelado em vazio', async () => {
    getAll.mockImplementation(async () => ({ data: [], error: null }));

    const { result } = renderHook(() => useSettingsController(), { wrapper });
    await waitFor(() => expect(result.current.customFieldDefinitions).toEqual([]));

    act(() => {
      result.current.setNewFieldLabel('Onde reside');
    });
    await act(async () => {
      await result.current.handleSaveField();
    });

    await waitFor(() => {
      expect(result.current.customFieldDefinitions).toHaveLength(1);
    });
    expect(result.current.customFieldDefinitions[0].label).toBe('Onde reside');
  });

  it('remoção some da lista mesmo com getAll congelado devolvendo o campo', async () => {
    const ghost = { id: 'id-1', key: 'campo1', label: 'Fantasma', type: 'text' } as CustomFieldDefinition;
    getAll.mockImplementation(async () => ({ data: [ghost], error: null }));

    const { result } = renderHook(() => useSettingsController(), { wrapper });
    await waitFor(() => expect(result.current.customFieldDefinitions).toHaveLength(1));

    await act(async () => {
      await result.current.removeCustomField('id-1');
    });

    await waitFor(() => expect(result.current.customFieldDefinitions).toHaveLength(0));
  });
});
