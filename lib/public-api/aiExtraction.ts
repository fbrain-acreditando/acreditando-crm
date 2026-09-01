/**
 * @fileoverview A porta que o n8n usa — story 2.49.
 *
 * O workflow n8n "05- Transferência" já lê a conversa, extrai os campos de
 * qualificação e pontua o lead de 1 a 5 com chave própria da OpenAI. Até aqui
 * esse resultado morria num Google Sheets. Este módulo é o lugar onde ele entra
 * no CRM.
 *
 * ⚠️ Nada aqui chama modelo nenhum. A inteligência já aconteceu do lado de fora;
 * o que este módulo faz é aplicar, com cuidado, as MESMAS regras de gravação que
 * a extração interna aplica — e nenhuma a mais.
 *
 * Fora do escopo, de propósito (v1):
 *   ❌ `moveDealIfQualified` — a rota escreve, não decide funil. Quem move o
 *      card é a Fernanda. `customFields.service.ts:277` move sozinho; aqui, não.
 *
 * ⚠️ `createStaticAdminClient` IGNORA RLS. Toda query filtra `organization_id`
 * explicitamente — deal, definições e os dois UPDATEs.
 *
 * @module lib/public-api/aiExtraction
 */

import { z } from 'zod';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { sanitizeUUID } from '@/lib/supabase/utils';
import {
  coerceValueForField,
  isBlank,
  MIN_CONFIDENCE_TO_STORE,
} from '@/lib/ai/extraction/customFields.schemas';
import type { CustomFieldDefinition, CustomFieldType } from '@/types';

// =============================================================================
// Contrato
// =============================================================================

/** Rota, para a chave de idempotência. */
export const AI_EXTRACTION_ENDPOINT = 'POST /deals/{dealId}/ai-extraction';

/** A nota do n8n é 1..5 por julgamento de modelo — nunca a régua do CRM. */
export const N8N_SCORE_SCALE = 'n8n:1-5';

/**
 * O denominador da estrela.
 *
 * Não é decorativo: o CHECK do banco exige `lead_score <= lead_score_known`,
 * `null` renderiza "★ 4/0" na tela (`Kanban/DealCard.tsx:227`) e a nota manual
 * já grava 5 (`DealDetailModal.tsx:472`).
 */
export const N8N_SCORE_KNOWN = 5;

const FieldValue = z
  .object({
    value: z.string().min(1).max(500).nullable(),
    confidence: z.number().min(0).max(1).optional(),
  })
  .strict();

export const AiExtractionSchema = z
  .object({
    custom_fields: z
      .record(
        z.string().min(1).max(64),
        z.union([z.string().max(500), z.null(), FieldValue])
      )
      .optional(),
    lead_score: z
      .object({
        score: z.number().int().min(1).max(5),
        rotulo: z.string().max(80).optional(),
        criterios_atingidos: z.array(z.string().max(120)).max(20).optional(),
        red_flags: z.array(z.string().max(120)).max(20).optional(),
        confianca: z.number().min(0).max(1).optional(),
      })
      .strict()
      .optional(),
    overwrite: z.boolean().optional(),
  })
  .strict()
  .refine((v) => !!v.custom_fields || !!v.lead_score, {
    message: 'custom_fields or lead_score is required',
  });

export type AiExtractionInput = z.infer<typeof AiExtractionSchema>;

export type SkipReason =
  | 'campo_ja_preenchido'
  | 'chave_desconhecida'
  | 'confianca_baixa'
  | 'valor_invalido_para_o_tipo'
  | 'nota_manual';

export interface AiExtractionResponse {
  status: number;
  body: Record<string, unknown>;
}

// =============================================================================
// Aplicação
// =============================================================================

export async function applyAiExtraction(opts: {
  organizationId: string;
  dealId: string;
  input: AiExtractionInput;
}): Promise<AiExtractionResponse> {
  const dealId = sanitizeUUID(opts.dealId);
  if (!dealId) {
    return { status: 422, body: { error: 'Invalid deal id', code: 'VALIDATION_ERROR' } };
  }

  const sb = createStaticAdminClient();

  // 1. O deal. `organization_id` explícito (o admin client ignora RLS) e
  //    `deleted_at` nulo — deal excluído não é deal.
  const { data: deal, error: dealError } = await sb
    .from('deals')
    .select('id,custom_fields,ai_extracted')
    .eq('organization_id', opts.organizationId)
    .is('deleted_at', null)
    .eq('id', dealId)
    .maybeSingle();

  if (dealError) {
    console.error('[public-api/ai-extraction] erro ao ler o deal:', dealError.message);
    return { status: 500, body: { error: 'Internal server error', code: 'DB_ERROR' } };
  }
  if (!deal) {
    return { status: 404, body: { error: 'Deal not found', code: 'NOT_FOUND' } };
  }

  const now = new Date().toISOString();
  const updated: string[] = [];
  const skipped: Array<{ key: string; reason: SkipReason }> = [];

  // 2. Campos personalizados
  const incoming = opts.input.custom_fields ?? {};
  const incomingKeys = Object.keys(incoming);

  if (incomingKeys.length > 0) {
    // Query IDÊNTICA à de `customFields.service.ts:106-113`: organização +
    // entity_type. Sem o `entity_type`, uma key de contato com o mesmo nome
    // seria aceita para deal.
    const { data: defRows, error: defError } = await sb
      .from('custom_field_definitions')
      .select('id, key, label, type, options')
      .eq('organization_id', opts.organizationId)
      .eq('entity_type', 'deal')
      .order('created_at', { ascending: true });

    if (defError) {
      console.error('[public-api/ai-extraction] erro ao ler definições:', defError.message);
      return { status: 500, body: { error: 'Internal server error', code: 'DB_ERROR' } };
    }

    const definitions = new Map<string, CustomFieldDefinition>();
    for (const row of defRows ?? []) {
      const r = row as { id: string; key: string; label: string; type: string; options?: unknown };
      definitions.set(r.key, {
        id: r.id,
        key: r.key,
        label: r.label,
        type: r.type as CustomFieldType,
        ...(Array.isArray(r.options) && r.options.length > 0 ? { options: r.options as string[] } : {}),
      });
    }

    const currentFields = ((deal as Record<string, unknown>).custom_fields as Record<string, unknown>) ?? {};
    const currentExtracted = ((deal as Record<string, unknown>).ai_extracted as Record<string, unknown>) ?? {};

    // ⚠️ Ler-e-MESCLAR, nunca spread parcial. Gravar só `{customFields: novos}`
    // apagaria o resto de `ai_extracted` em silêncio (armadilha 4 da story).
    const nextFields: Record<string, unknown> = { ...currentFields };
    const provenance: Record<string, unknown> = {
      ...((currentExtracted.customFields as Record<string, unknown>) ?? {}),
    };

    for (const key of incomingKeys) {
      const def = definitions.get(key);

      // Regra 4 — key desconhecida NÃO derruba o lote. O n8n manda 9 campos e
      // 4 não têm destino no CRM; recusar os 5 bons por causa de `resumo` seria
      // perder o dado que existe.
      if (!def) {
        skipped.push({ key, reason: 'chave_desconhecida' });
        continue;
      }

      const entry = incoming[key];
      const rawValue = entry === null ? null : typeof entry === 'string' ? entry : entry.value;
      const confidence = entry !== null && typeof entry === 'object' ? entry.confidence : undefined;

      // Valor nulo = "o modelo não achou". Não é campo pulado, é campo que não
      // veio — mesma leitura de `customFields.service.ts:234` (só entra em
      // `skipped` o que TINHA valor).
      if (rawValue === null) continue;

      // Regra 1 — quem digitou tem a palavra final.
      if (!opts.input.overwrite && !isBlank(currentFields[key])) {
        skipped.push({ key, reason: 'campo_ja_preenchido' });
        continue;
      }

      // Regra 2 — confiança ausente conta como 1 (o n8n nem sempre manda).
      const effectiveConfidence = confidence ?? 1;
      if (effectiveConfidence < MIN_CONFIDENCE_TO_STORE) {
        skipped.push({ key, reason: 'confianca_baixa' });
        continue;
      }

      // Regra 3 — o tipo manda. Valor de `select` fora da lista é descartado,
      // porque um valor inventado estragaria filtro e relatório sem dar erro.
      const value = coerceValueForField(def, rawValue);
      if (value === null) {
        skipped.push({ key, reason: 'valor_invalido_para_o_tipo' });
        continue;
      }

      nextFields[key] = value;
      // Regra 5 — proveniência com a forma de `customFields.service.ts:248-253`.
      provenance[key] = {
        value,
        confidence: effectiveConfidence,
        reasoning: 'n8n',
        extractedAt: now,
        source: 'n8n',
      };
      updated.push(key);
    }

    if (updated.length > 0) {
      const { data: gravado, error: updateError } = await sb
        .from('deals')
        .update({
          custom_fields: nextFields,
          ai_extracted: {
            ...currentExtracted,
            customFields: provenance,
            customFieldsLastExtractedAt: now,
          },
          updated_at: now,
        })
        .eq('organization_id', opts.organizationId)
        .eq('id', dealId)
        // Read-back (Rule 7): sem `.select()`, o PostgREST responde OK mesmo
        // com ZERO linhas mudadas.
        .select('id');

      if (updateError) {
        console.error('[public-api/ai-extraction] erro ao gravar campos:', updateError.message);
        return { status: 500, body: { error: 'Internal server error', code: 'DB_ERROR' } };
      }
      if (!gravado || gravado.length === 0) {
        return { status: 404, body: { error: 'Deal not found', code: 'NOT_FOUND' } };
      }
    }
  }

  // 3. A nota
  let leadScore: { applied: boolean; reason?: SkipReason } | null = null;

  if (opts.input.lead_score) {
    const nota = opts.input.lead_score;

    const { data: gravado, error: scoreError } = await sb
      .from('deals')
      .update({
        lead_score: nota.score,
        // Obrigatório: o CHECK do banco exige `lead_score <= lead_score_known`
        // e `null` renderiza "★ 4/0" na tela.
        lead_score_known: N8N_SCORE_KNOWN,
        lead_score_source: 'n8n',
        lead_score_detail: {
          // A régua, escrita por extenso. A do n8n é 1..5 por julgamento de
          // modelo; a do CRM é critérios atingidos / conhecíveis. Um "3" de
          // cada lado NÃO quer dizer a mesma coisa, e sem esta chave ninguém
          // conseguiria separar as duas populações depois.
          escala: N8N_SCORE_SCALE,
          origem: 'n8n:05-transferencia',
          ...(nota.rotulo !== undefined ? { rotulo: nota.rotulo } : {}),
          ...(nota.criterios_atingidos !== undefined
            ? { criterios_atingidos: nota.criterios_atingidos }
            : {}),
          ...(nota.red_flags !== undefined ? { red_flags: nota.red_flags } : {}),
          ...(nota.confianca !== undefined ? { confianca: nota.confianca } : {}),
        },
        // Regra 8 — carimbo que impede a fila interna de repontuar e apagar o
        // que o n8n trouxe (`filaDePontuacao.ts:100-106` consome este campo).
        pontuada_pela_ia_em: now,
        lead_score_updated_at: now,
        updated_at: now,
      })
      .eq('organization_id', opts.organizationId)
      .eq('id', dealId)
      // 🩸 story 2.44 — POR QUE ISTO NÃO É `.neq(...)`:
      // `lead_score_source <> 'manual'` é **NULL** (não TRUE) quando a coluna é
      // NULL — e card nunca pontuado tem a coluna NULL. A guarda que existe
      // para proteger a nota manual bloquearia exatamente o caso normal, que é
      // a maioria da base. O `is.null` não é enfeite.
      .or('lead_score_source.is.null,lead_score_source.neq.manual')
      // Read-back (Rule 7): é o `.select()` que transforma "0 linhas" em
      // resposta honesta em vez de sucesso silencioso.
      .select('id');

    if (scoreError) {
      console.error('[public-api/ai-extraction] erro ao gravar a nota:', scoreError.message);
      return { status: 500, body: { error: 'Internal server error', code: 'DB_ERROR' } };
    }

    leadScore =
      !gravado || gravado.length === 0
        ? // 0 linhas com o deal existindo = a nota é manual. A request continua
          // 200: os campos podem ter entrado; só a nota não.
          { applied: false, reason: 'nota_manual' }
        : { applied: true };
  }

  return {
    status: 200,
    body: {
      data: {
        deal_id: dealId,
        custom_fields: { updated, skipped },
        lead_score: leadScore,
        idempotent_replay: false,
      },
    },
  };
}
