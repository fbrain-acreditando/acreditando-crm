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
      return { field: data!, entityType: input.entityType || DEFAULT_ENTITY };
    },
    // A lista é atualizada pelo próprio resultado da mutation (convenção do repo:
    // `setQueryData` antes de invalidate). Assim o campo novo aparece na hora,
    // sem depender de um refetch — que era o sintoma relatado em 27/07 (o campo
    // só aparecia depois do F5). A invalidação em `onSettled` fica como rede.
    onSuccess: ({ field, entityType }) => {
      queryClient.setQueryData<CustomFieldDefinition[]>(
        queryKeys.customFields.byEntity(entityType),
        (old) => {
          const list = old ?? [];
          if (list.some(f => f.id === field.id)) return list;
          return [...list, field];
        }
      );
    },
    onSettled: () => {
      // `refetchType: 'none'` de propósito: marca como obsoleto SEM refetchar
      // agora. Um refetch imediato sobrescreveria o `setQueryData` acima com a
      // leitura anterior — foi assim que o otimismo se perdeu no bug de mover
      // card (24/07). A revalidação acontece na próxima montagem, o que cobre
      // alteração feita por outro usuário.
      queryClient.invalidateQueries({
        queryKey: queryKeys.customFields.all,
        refetchType: 'none',
      });
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
    onSuccess: ({ id, updates }) => {
      queryClient.setQueryData<CustomFieldDefinition[]>(
        queryKeys.customFields.byEntity(DEFAULT_ENTITY),
        (old) =>
          (old ?? []).map(f => {
            if (f.id !== id) return f;
            const next: CustomFieldDefinition = { ...f };
            if (updates.label !== undefined) next.label = updates.label;
            if (updates.type !== undefined) next.type = updates.type;
            // Espelha a regra do serviço: fora de `select` não há opções.
            if (updates.type !== undefined && updates.type !== 'select') delete next.options;
            else if (updates.options !== undefined) next.options = updates.options;
            return next;
          })
      );
    },
    onSettled: () => {
      // `refetchType: 'none'` de propósito: marca como obsoleto SEM refetchar
      // agora. Um refetch imediato sobrescreveria o `setQueryData` acima com a
      // leitura anterior — foi assim que o otimismo se perdeu no bug de mover
      // card (24/07). A revalidação acontece na próxima montagem, o que cobre
      // alteração feita por outro usuário.
      queryClient.invalidateQueries({
        queryKey: queryKeys.customFields.all,
        refetchType: 'none',
      });
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
    onSuccess: (id) => {
      queryClient.setQueryData<CustomFieldDefinition[]>(
        queryKeys.customFields.byEntity(DEFAULT_ENTITY),
        (old) => (old ?? []).filter(f => f.id !== id)
      );
    },
    onSettled: () => {
      // `refetchType: 'none'` de propósito: marca como obsoleto SEM refetchar
      // agora. Um refetch imediato sobrescreveria o `setQueryData` acima com a
      // leitura anterior — foi assim que o otimismo se perdeu no bug de mover
      // card (24/07). A revalidação acontece na próxima montagem, o que cobre
      // alteração feita por outro usuário.
      queryClient.invalidateQueries({
        queryKey: queryKeys.customFields.all,
        refetchType: 'none',
      });
    },
  });
};
