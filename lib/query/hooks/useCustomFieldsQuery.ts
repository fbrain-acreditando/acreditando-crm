/**
 * TanStack Query hooks para definições de campos personalizados.
 *
 * Substitui o armazenamento em `localStorage` que existia em
 * `useSettingsController` e alimenta o board / o modal de deal, que antes
 * recebiam uma lista vazia hardcoded.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../index';
import { customFieldsService } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import type { CustomFieldDefinition, CustomFieldType } from '@/types';

const DEFAULT_ENTITY = 'deal';

// ============ QUERY HOOKS ============

/**
 * Definições de campo de uma entidade (padrão: `deal`).
 *
 * `staleTime` alto de propósito: definição de campo muda raramente, mas é lida
 * em toda abertura de board e de card.
 */
export const useCustomFields = (
  entityType: string = DEFAULT_ENTITY,
  options?: { enabled?: boolean }
) => {
  const { user, loading: authLoading } = useAuth();
  const externalEnabled = options?.enabled ?? true;

  return useQuery<CustomFieldDefinition[]>({
    queryKey: queryKeys.customFields.byEntity(entityType),
    queryFn: async () => {
      const { data, error } = await customFieldsService.getAll(entityType);
      if (error) throw error;
      return data || [];
    },
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: (query) => query.state.dataUpdatedAt === 0 || query.state.isInvalidated,
    refetchOnReconnect: false,
    enabled: !authLoading && !!user && externalEnabled,
  });
};

// ============ MUTATION HOOKS ============

export const useCreateCustomField = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      label: string;
      type: CustomFieldType;
      options?: string[];
      entityType?: string;
    }) => {
      const { data, error } = await customFieldsService.create(input);
      if (error) throw error;
      return data!;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.customFields.all });
    },
  });
};

export const useUpdateCustomField = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string;
      updates: Partial<{ label: string; type: CustomFieldType; options: string[] }>;
    }) => {
      const { error } = await customFieldsService.update(id, updates);
      if (error) throw error;
      return { id, updates };
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.customFields.all });
    },
  });
};

export const useDeleteCustomField = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await customFieldsService.delete(id);
      if (error) throw error;
      return id;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.customFields.all });
    },
  });
};
