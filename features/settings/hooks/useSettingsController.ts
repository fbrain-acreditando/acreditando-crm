import { useState } from 'react';
import { useToast } from '@/context/ToastContext';
import { CustomFieldDefinition, CustomFieldType } from '@/types';
import { usePersistedState } from '@/hooks/usePersistedState';
import {
  useCustomFields,
  useCreateCustomField,
  useUpdateCustomField,
  useDeleteCustomField,
} from '@/lib/query/hooks';

// Campos personalizados vivem em `custom_field_definitions` (Supabase).
// TODO: migrar `tags` para o Supabase também — segue em localStorage.
/**
 * Hook React `useSettingsController` que encapsula uma lógica reutilizável.
 * @returns {{ defaultRoute: string; setDefaultRoute: Dispatch<SetStateAction<string>>; customFieldDefinitions: CustomFieldDefinition[]; newFieldLabel: string; ... 14 more ...; removeTag: (tag: string) => void; }} Retorna um valor do tipo `{ defaultRoute: string; setDefaultRoute: Dispatch<SetStateAction<string>>; customFieldDefinitions: CustomFieldDefinition[]; newFieldLabel: string; ... 14 more ...; removeTag: (tag: string) => void; }`.
 */
export const useSettingsController = () => {
  const { addToast } = useToast();

  // General Settings
  const [defaultRoute, setDefaultRoute] = usePersistedState<string>('crm_default_route', '/boards');

  // Custom Fields — persistidos no Supabase (`custom_field_definitions`)
  const { data: customFieldDefinitions = [] } = useCustomFields('deal');
  const createCustomField = useCreateCustomField();
  const updateCustomField = useUpdateCustomField();
  const deleteCustomField = useDeleteCustomField();
  const [newFieldLabel, setNewFieldLabel] = useState('');
  const [newFieldType, setNewFieldType] = useState<CustomFieldType>('text');
  const [newFieldOptions, setNewFieldOptions] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  // Tags State (local - TODO: migrate to Supabase)
  const [availableTags, setAvailableTags] = usePersistedState<string[]>('crm_tags', []);
  const [newTagName, setNewTagName] = useState('');

  // Custom Fields Logic
  const startEditingField = (field: CustomFieldDefinition) => {
    setEditingId(field.id);
    setNewFieldLabel(field.label);
    setNewFieldType(field.type);
    setNewFieldOptions(field.options ? field.options.join(', ') : '');
  };

  const cancelEditingField = () => {
    setEditingId(null);
    setNewFieldLabel('');
    setNewFieldType('text');
    setNewFieldOptions('');
  };

  const handleSaveField = async () => {
    if (!newFieldLabel.trim()) return;

    const optionsArray =
      newFieldType === 'select'
        ? newFieldOptions
          .split(',')
          .map(opt => opt.trim())
          .filter(opt => opt !== '')
        : undefined;

    try {
      if (editingId) {
        // A `key` não é alterada aqui de propósito: ela é o vínculo com os
        // valores já gravados em `deals.custom_fields`.
        await updateCustomField.mutateAsync({
          id: editingId,
          updates: { label: newFieldLabel, type: newFieldType, options: optionsArray ?? [] },
        });
        addToast('Campo personalizado atualizado com sucesso!', 'success');
        cancelEditingField();
      } else {
        await createCustomField.mutateAsync({
          label: newFieldLabel,
          type: newFieldType,
          options: optionsArray,
          entityType: 'deal',
        });
        addToast('Campo personalizado criado com sucesso!', 'success');
        setNewFieldLabel('');
        setNewFieldOptions('');
      }
    } catch (error) {
      addToast(
        `Não foi possível salvar o campo: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
        'error'
      );
    }
  };

  const handleRemoveField = async (id: string) => {
    try {
      await deleteCustomField.mutateAsync(id);
      addToast('Campo personalizado removido.', 'info');
    } catch (error) {
      addToast(
        `Não foi possível remover o campo: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
        'error'
      );
    }
  };

  // Tags Logic
  const handleAddTag = () => {
    if (newTagName.trim()) {
      setAvailableTags(prev => [...prev, newTagName.trim()]);
      addToast(`Tag "${newTagName}" adicionada!`, 'success');
      setNewTagName('');
    }
  };

  const handleRemoveTag = (tag: string) => {
    setAvailableTags(prev => prev.filter(t => t !== tag));
    addToast(`Tag "${tag}" removida.`, 'info');
  };

  return {
    // General Settings
    defaultRoute,
    setDefaultRoute,

    // Custom Fields
    customFieldDefinitions,
    newFieldLabel,
    setNewFieldLabel,
    newFieldType,
    setNewFieldType,
    newFieldOptions,
    setNewFieldOptions,
    editingId,
    startEditingField,
    cancelEditingField,
    handleSaveField,
    removeCustomField: handleRemoveField,

    // Tags
    availableTags,
    newTagName,
    setNewTagName,
    handleAddTag,
    removeTag: handleRemoveTag,
  };
};
