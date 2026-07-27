/**
 * @fileoverview Schema DINÂMICO para extração de campos personalizados.
 *
 * Diferente da extração BANT (`schemas.ts`), que tem quatro campos fixos, aqui
 * o schema é montado em tempo de execução a partir das definições em
 * `custom_field_definitions`. Cada organização extrai o que ela mesma definiu.
 *
 * @module lib/ai/extraction/customFields.schemas
 */

import { z } from 'zod';
import type { CustomFieldDefinition } from '@/types';

/** Um campo extraído: valor + confiança + de onde a IA tirou. */
export const ExtractedCustomFieldSchema = z.object({
  value: z
    .string()
    .nullable()
    .describe('Valor extraído em português, ou null se a conversa não disser'),
  confidence: z.number().min(0).max(1).describe('Confiança na extração (0 a 1)'),
  reasoning: z.string().describe('Breve explicação de onde na conversa veio essa informação'),
});

export type ExtractedCustomField = z.infer<typeof ExtractedCustomFieldSchema>;

/** Metadado de proveniência, guardado em `deals.ai_extracted.customFields`. */
export interface CustomFieldProvenance {
  value: string;
  confidence: number;
  reasoning: string;
  extractedAt: string;
  sourceMessageId?: string;
}

/**
 * Monta o schema Zod a partir das definições da organização.
 *
 * Campos do tipo `select` viram enum quando têm opções — assim o modelo não
 * pode devolver um valor fora da lista e sujar o relatório. Sem opções, cai
 * para texto (e a validação posterior deixa passar).
 *
 * Retorna `null` quando não há definição alguma — o chamador deve pular a
 * extração em vez de chamar o modelo à toa.
 */
export function buildCustomFieldsSchema(
  definitions: CustomFieldDefinition[]
): z.ZodObject<Record<string, typeof ExtractedCustomFieldSchema>> | null {
  if (definitions.length === 0) return null;

  const shape: Record<string, typeof ExtractedCustomFieldSchema> = {};

  for (const def of definitions) {
    if (!def.key) continue;
    shape[def.key] = ExtractedCustomFieldSchema.describe(
      describeField(def)
    ) as typeof ExtractedCustomFieldSchema;
  }

  if (Object.keys(shape).length === 0) return null;

  return z.object(shape);
}

/** Texto que descreve o campo para o modelo, incluindo as opções quando houver. */
export function describeField(def: CustomFieldDefinition): string {
  const parts = [`"${def.label}"`];

  if (def.type === 'select' && def.options && def.options.length > 0) {
    parts.push(`— responda EXATAMENTE uma destas opções: ${def.options.join(' | ')}`);
  } else if (def.type === 'number') {
    parts.push('— responda apenas o número');
  } else if (def.type === 'date') {
    parts.push('— responda no formato AAAA-MM-DD');
  }

  return parts.join(' ');
}

/**
 * Valida o valor devolvido pelo modelo contra o tipo da definição.
 *
 * Devolve o valor normalizado, ou `null` quando ele não serve — é aqui que se
 * impede a IA de inventar uma opção que não existe na lista, o que
 * silenciosamente estragaria qualquer filtro ou relatório depois.
 */
export function coerceValueForField(
  def: CustomFieldDefinition,
  raw: string | null
): string | null {
  if (raw === null) return null;

  const value = raw.trim();
  if (!value) return null;

  if (def.type === 'select') {
    const options = def.options ?? [];
    if (options.length === 0) return value;
    const match = options.find(
      opt => opt.toLocaleLowerCase('pt-BR') === value.toLocaleLowerCase('pt-BR')
    );
    return match ?? null;
  }

  if (def.type === 'number') {
    // Aceita "3", "3,5" e "R$ 3.500" -> mantém só o número.
    const normalized = value.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
    if (normalized === '' || Number.isNaN(Number(normalized))) return null;
    return String(Number(normalized));
  }

  if (def.type === 'date') {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  }

  return value;
}
