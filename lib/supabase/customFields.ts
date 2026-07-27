/**
 * @fileoverview Serviço Supabase para definições de campos personalizados.
 *
 * Contexto: a tabela `custom_field_definitions` existe no schema desde o início
 * (com RLS org-scoped), mas nenhuma parte da UI a lia ou gravava — o gerenciador
 * em Configurações salvava em `localStorage` e o board/modal recebiam sempre uma
 * lista vazia hardcoded. Este serviço é a canalização que faltava.
 *
 * Segue o mesmo molde de `products.ts` (inferência de organização client-side,
 * RLS-safe, retorno `{ data, error }`).
 */

import { supabase } from './client';
import { CustomFieldDefinition, CustomFieldType } from '@/types';
import { sanitizeUUID } from './utils';

// =============================================================================
// Organization inference (client-side, RLS-safe)
// =============================================================================
let cachedOrgId: string | null = null;
let cachedOrgUserId: string | null = null;

async function getCurrentOrganizationId(): Promise<string | null> {
  if (!supabase) return null;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  if (cachedOrgUserId === user.id && cachedOrgId) return cachedOrgId;

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .maybeSingle();

  if (error) return null;

  const orgId = sanitizeUUID((profile as { organization_id?: string } | null)?.organization_id);
  cachedOrgUserId = user.id;
  cachedOrgId = orgId;
  return orgId;
}

const SELECT_COLUMNS = 'id, organization_id, key, label, type, options, entity_type, created_at';

/** Tipos aceitos pela coluna `type`. Espelha `CustomFieldType` em `@/types`. */
const VALID_TYPES: readonly CustomFieldType[] = ['text', 'number', 'date', 'select'];

type DbCustomFieldDefinition = {
  id: string;
  organization_id: string | null;
  key: string;
  label: string;
  type: string;
  options: string[] | null;
  entity_type: string | null;
  created_at: string;
};

function transformCustomField(db: DbCustomFieldDefinition): CustomFieldDefinition {
  const type = (VALID_TYPES as readonly string[]).includes(db.type)
    ? (db.type as CustomFieldType)
    : 'text';

  return {
    id: db.id,
    key: db.key,
    label: db.label,
    type,
    ...(db.options && db.options.length > 0 ? { options: db.options } : {}),
  };
}

/**
 * Deriva uma `key` camelCase estável a partir do rótulo.
 * A `key` é o que fica gravado em `deals.custom_fields` (JSONB) — por isso ela
 * NÃO muda quando o rótulo é renomeado, senão os valores já gravados órfãos.
 */
export function deriveFieldKey(label: string): string {
  const normalized = label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase();

  if (!normalized) return `campo${Date.now()}`;

  const [first, ...rest] = normalized.split(' ');
  return first + rest.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}

export const customFieldsService = {
  /** Lista as definições de campo de uma entidade (padrão: `deal`). */
  async getAll(entityType: string = 'deal'): Promise<{ data: CustomFieldDefinition[]; error: Error | null }> {
    try {
      if (!supabase) return { data: [], error: new Error('Supabase não configurado') };

      const { data, error } = await supabase
        .from('custom_field_definitions')
        .select(SELECT_COLUMNS)
        .eq('entity_type', entityType)
        .order('created_at', { ascending: true });

      if (error) return { data: [], error };

      const rows = (data || []) as DbCustomFieldDefinition[];
      return { data: rows.map(transformCustomField), error: null };
    } catch (e) {
      return { data: [], error: e as Error };
    }
  },

  async create(input: {
    label: string;
    type: CustomFieldType;
    options?: string[];
    entityType?: string;
    key?: string;
  }): Promise<{ data: CustomFieldDefinition | null; error: Error | null }> {
    try {
      if (!supabase) return { data: null, error: new Error('Supabase não configurado') };

      const label = input.label.trim();
      if (!label) return { data: null, error: new Error('O rótulo do campo é obrigatório') };

      const organizationId = await getCurrentOrganizationId();

      const { data, error } = await supabase
        .from('custom_field_definitions')
        .insert({
          key: input.key?.trim() || deriveFieldKey(label),
          label,
          type: input.type,
          options: input.type === 'select' ? (input.options ?? []) : null,
          entity_type: input.entityType || 'deal',
          organization_id: organizationId,
        })
        .select(SELECT_COLUMNS)
        .single();

      if (error) return { data: null, error };
      return { data: transformCustomField(data as DbCustomFieldDefinition), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  /**
   * Atualiza rótulo, tipo e opções.
   * ⚠️ A `key` NUNCA é atualizada aqui — ela é o vínculo com os valores já
   * gravados em `deals.custom_fields`. Renomear o rótulo é seguro; mudar a
   * chave órfãos todo o dado histórico.
   */
  async update(
    id: string,
    updates: Partial<{ label: string; type: CustomFieldType; options: string[] }>
  ): Promise<{ error: Error | null }> {
    try {
      if (!supabase) return { error: new Error('Supabase não configurado') };

      const payload: Record<string, unknown> = {};
      if (updates.label !== undefined) {
        const label = updates.label.trim();
        if (!label) return { error: new Error('O rótulo do campo é obrigatório') };
        payload.label = label;
      }
      if (updates.type !== undefined) {
        payload.type = updates.type;
        // Sair de `select` limpa as opções; entrar em `select` sem opções vira lista vazia.
        if (updates.type !== 'select') payload.options = null;
        else if (updates.options === undefined) payload.options = [];
      }
      if (updates.options !== undefined && payload.options === undefined) {
        payload.options = updates.options;
      }

      if (Object.keys(payload).length === 0) return { error: null };

      const { error } = await supabase
        .from('custom_field_definitions')
        .update(payload)
        .eq('id', sanitizeUUID(id));

      return { error: error ?? null };
    } catch (e) {
      return { error: e as Error };
    }
  },

  async delete(id: string): Promise<{ error: Error | null }> {
    try {
      if (!supabase) return { error: new Error('Supabase não configurado') };

      const { error } = await supabase
        .from('custom_field_definitions')
        .delete()
        .eq('id', sanitizeUUID(id));

      return { error: error ?? null };
    } catch (e) {
      return { error: e as Error };
    }
  },
};
