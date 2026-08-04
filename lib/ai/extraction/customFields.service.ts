/**
 * @fileoverview Extração de CAMPOS PERSONALIZADOS a partir das conversas.
 *
 * Por que existe: a extração nativa (`extraction.service.ts`) é BANT — quatro
 * campos fixos de venda B2B (orçamento, decisor, necessidade, prazo). Para o
 * Acreditando, o que precisa sair da conversa é outra coisa: tipo de lesão,
 * há quanto tempo, onde reside, se já faz reabilitação, para quem é. Esses
 * campos são definidos pela própria operação em `custom_field_definitions`.
 *
 * Duas regras de segurança do dado, deliberadas:
 *
 * 1. NUNCA sobrescreve valor preenchido por pessoa. Só preenche campo vazio.
 *    Quem digitou tem a palavra final; a IA só cobre o que ficou em branco.
 * 2. Valor de campo `select` que não esteja na lista de opções é DESCARTADO
 *    (`coerceValueForField`). Um valor inventado passaria despercebido e
 *    estragaria filtro e relatório sem nunca dar erro.
 *
 * A proveniência (confiança + de onde a IA tirou) fica em
 * `deals.ai_extracted.customFields`, porque `deals.custom_fields` é plano e só
 * comporta o valor. Assim dá para auditar depois de onde veio cada campo.
 *
 * ⚠️ LGPD: para o Acreditando, parte desses campos é dado de saúde (Art. 11).
 * Estruturar o que hoje está solto no texto da conversa aumenta a exposição.
 * A base legal segue pendente — ver [[CRM IA Acreditando]] no vault.
 *
 * @module lib/ai/extraction/customFields.service
 */

import { generateText, Output } from 'ai';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getModel } from '../config';
import { getOrgAIConfig } from '../agent/agent.service';
import type { CustomFieldDefinition, CustomFieldType } from '@/types';
import {
  buildCustomFieldsSchema,
  coerceValueForField,
  describeField,
  type CustomFieldProvenance,
  type ExtractedCustomField,
} from './customFields.schemas';
import { orderConversationWindow } from './conversationWindow';
import { logAiTokens, type TokenLogClient } from '../token-log';

// =============================================================================
// Constantes
// =============================================================================

const MAX_MESSAGES_FOR_EXTRACTION = 30;
/** Abaixo disso o valor é descartado — é chute do modelo, não informação. */
const MIN_CONFIDENCE_TO_STORE = 0.6;

// =============================================================================
// Prompt
// =============================================================================

const SYSTEM_PROMPT = `Você extrai informações de qualificação de uma conversa de atendimento.

REGRAS INEGOCIÁVEIS:
- Extraia APENAS o que foi dito explicitamente na conversa.
- NUNCA invente, deduza ou complete informação que não está lá.
- Se a conversa não disser, retorne null no value. Deixar em branco é o certo.
- Quando o campo tiver lista de opções, responda EXATAMENTE uma das opções, sem reescrever.
- confidence reflete o quanto está claro: 0.9+ dito com todas as letras, 0.7-0.9 mencionado, 0.6-0.7 implícito. Abaixo de 0.6, prefira null.
- reasoning cita brevemente o trecho da conversa que sustenta o valor.
- Responda SEMPRE em português brasileiro.`;

// =============================================================================
// Serviço
// =============================================================================

export interface ExtractCustomFieldsParams {
  supabase: SupabaseClient;
  dealId: string;
  conversationId: string;
  organizationId: string;
  triggerMessageId?: string;
}

export interface ExtractCustomFieldsResult {
  success: boolean;
  /** Chaves efetivamente gravadas. */
  updated?: string[];
  /** Chaves que a IA trouxe mas foram recusadas, com o motivo. */
  skipped?: Array<{ key: string; reason: string }>;
  error?: string;
}

/**
 * Lê a conversa, extrai os campos personalizados da organização e preenche
 * apenas os que estiverem vazios no deal.
 */
export async function extractAndUpdateCustomFields(
  params: ExtractCustomFieldsParams
): Promise<ExtractCustomFieldsResult> {
  const { supabase, dealId, conversationId, organizationId, triggerMessageId } = params;

  try {
    // 1. Config de IA da organização (chave vive no banco, não em env var)
    const aiConfig = await getOrgAIConfig(supabase, organizationId);
    if (!aiConfig || !aiConfig.enabled) {
      return { success: true, updated: [] };
    }

    // 2. Definições da organização — sem campo definido, não há o que extrair
    const { data: defRows, error: defError } = await supabase
      .from('custom_field_definitions')
      .select('id, key, label, type, options')
      .eq('organization_id', organizationId)
      .eq('entity_type', 'deal')
      .order('created_at', { ascending: true });

    if (defError) {
      return { success: false, error: `Falha ao ler definições: ${defError.message}` };
    }

    const definitions: CustomFieldDefinition[] = (defRows ?? []).map(row => ({
      id: row.id as string,
      key: row.key as string,
      label: row.label as string,
      type: row.type as CustomFieldType,
      ...(Array.isArray(row.options) && row.options.length > 0
        ? { options: row.options as string[] }
        : {}),
    }));

    const schema = buildCustomFieldsSchema(definitions);
    if (!schema) {
      return { success: true, updated: [] };
    }

    // 3. Estado atual do deal — só preenchemos o que está vazio
    const { data: deal, error: dealError } = await supabase
      .from('deals')
      .select('custom_fields, ai_extracted')
      .eq('id', dealId)
      .single();

    if (dealError) {
      return { success: false, error: `Falha ao ler o deal: ${dealError.message}` };
    }

    const currentFields = (deal?.custom_fields as Record<string, unknown>) ?? {};
    const currentExtracted = (deal?.ai_extracted as Record<string, unknown>) ?? {};

    const pending = definitions.filter(def => isBlank(currentFields[def.key]));
    if (pending.length === 0) {
      return { success: true, updated: [] }; // Tudo já preenchido — nada a fazer
    }

    // 4. Histórico da conversa
    //
    // A janela é buscada por `created_at` DESC (as MAIS RECENTES — é onde a
    // qualificação aparece, no fim do roteiro da IA) e reordenada em memória
    // pelo horário real. Ordenar por `sent_at` no banco descartaria as
    // mensagens sem `sent_at`, que é NULL-able. Ver conversationWindow.ts.
    const { data: recentRows } = await supabase
      .from('messaging_messages')
      .select('id, direction, content, content_type, created_at, sent_at')
      .eq('conversation_id', conversationId)
      .neq('content_type', 'reaction')
      .order('created_at', { ascending: false })
      .limit(MAX_MESSAGES_FOR_EXTRACTION);

    const messages = orderConversationWindow(recentRows ?? []);

    if (messages.length < 2) {
      return { success: true, updated: [] };
    }

    const messagesText = messages
      .map(m => {
        const role = m.direction === 'inbound' ? 'LEAD' : 'ATENDIMENTO';
        return `[${role}]: ${extractTextContent(m.content as Record<string, unknown>)}`;
      })
      .join('\n');

    // 5. Extração
    const model = getModel(aiConfig.provider, aiConfig.apiKey, aiConfig.model);

    const fieldList = pending.map(def => `- ${def.key}: ${describeField(def)}`).join('\n');

    const result = await generateText({
      model,
      output: Output.object({
        schema,
        name: 'CustomFieldsExtraction',
        description: 'Extração dos campos de qualificação definidos pela operação',
      }),
      system: SYSTEM_PROMPT,
      prompt: `Campos a extrair:
${fieldList}

Conversa:
${messagesText}

Extraia apenas o que a conversa disser. O que não estiver lá, retorne null.`,
      maxRetries: 2,
    });

    if (!result.output) {
      return { success: false, error: 'O modelo não devolveu extração' };
    }

    // Contabiliza tokens no mesmo lugar que o resto da IA.
    // ⚠️ Este insert falhava em SILÊNCIO desde que entrou no ar: faltava
    // `context_snapshot`, que é NOT NULL. A tabela ficou vazia e o gasto da
    // extração — o único caminho de IA que roda neste canal — nunca foi medido.
    // Story 2.9. O helper existe para não haver um quarto copy-paste.
    void logAiTokens(
      supabase as unknown as TokenLogClient,
      {
        organizationId,
        conversationId,
        tokensUsed: result.usage?.totalTokens ?? 0,
        modelUsed: aiConfig.model,
        actionTaken: 'custom_fields_extraction',
        actionReason: `Extração de campos personalizados do deal ${dealId}`,
      },
      (msg) => console.error('[CustomFieldsExtraction]', msg)
    );

    // 6. Merge — só campo vazio, só confiança suficiente, só valor válido
    const now = new Date().toISOString();
    const output = result.output as Record<string, ExtractedCustomField>;
    const nextFields: Record<string, unknown> = { ...currentFields };
    const provenance: Record<string, CustomFieldProvenance> =
      (currentExtracted.customFields as Record<string, CustomFieldProvenance>) ?? {};
    const updated: string[] = [];
    const skipped: Array<{ key: string; reason: string }> = [];

    for (const def of pending) {
      const extracted = output[def.key];
      if (!extracted) continue;

      if (extracted.confidence < MIN_CONFIDENCE_TO_STORE) {
        if (extracted.value) skipped.push({ key: def.key, reason: 'confianca_baixa' });
        continue;
      }

      const value = coerceValueForField(def, extracted.value);
      if (value === null) {
        if (extracted.value) skipped.push({ key: def.key, reason: 'valor_invalido_para_o_tipo' });
        continue;
      }

      nextFields[def.key] = value;
      provenance[def.key] = {
        value,
        confidence: extracted.confidence,
        reasoning: extracted.reasoning,
        extractedAt: now,
        ...(triggerMessageId ? { sourceMessageId: triggerMessageId } : {}),
      };
      updated.push(def.key);
    }

    if (updated.length === 0) {
      return { success: true, updated: [], skipped };
    }

    // 7. Grava
    const { error: updateError } = await supabase
      .from('deals')
      .update({
        custom_fields: nextFields,
        ai_extracted: {
          ...currentExtracted,
          customFields: provenance,
          customFieldsLastExtractedAt: now,
        },
      })
      .eq('id', dealId);

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    console.log('[CustomFieldsExtraction] Campos preenchidos:', updated, 'no deal:', dealId);

    return { success: true, updated, skipped };
  } catch (error) {
    console.error('[CustomFieldsExtraction] Erro:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Erro desconhecido',
    };
  }
}

// =============================================================================
// Helpers
// =============================================================================

/** Vazio = nunca preenchido. String em branco conta como vazio. */
function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  return false;
}

function extractTextContent(content: Record<string, unknown>): string {
  if (typeof content === 'string') return content;
  if (content?.text && typeof content.text === 'string') return content.text;
  if (content?.type === 'image') return '[Imagem]';
  // Áudio transcrito pelo provedor (GPT Maker) entra como texto de verdade — sem
  // isto, lead que responde falando nunca qualifica, e sem erro nenhum.
  if (content?.type === 'audio') {
    return typeof content.transcription === 'string' && content.transcription.trim()
      ? content.transcription
      : '[Áudio]';
  }
  if (content?.type === 'video') return '[Vídeo]';
  if (content?.type === 'document') return '[Documento]';
  return '[Mensagem]';
}
