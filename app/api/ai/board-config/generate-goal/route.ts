/**
 * POST /api/ai/board-config/generate-goal
 *
 * Gera sugestões de objetivo (whatToDo + whatNotToDo) contextualmente
 * baseadas no contexto do negócio + categoria selecionada.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getOrgAIConfig, SECURITY_PREAMBLE } from '@/lib/ai/agent/agent.service';
import { sanitizeIncomingMessage } from '@/lib/ai/agent/input-filter';
import { getModel } from '@/lib/ai/config';
import { generateText } from 'ai';

export const maxDuration = 20;

const CATEGORY_LABELS: Record<string, string> = {
  qualificacao: 'Qualificação de Leads',
  agendamento: 'Agendamento',
  vendas: 'Vendas',
  suporte: 'Suporte ao Cliente',
  filtragem: 'Filtragem e Triagem',
};

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json() as {
    businessContext?: string;
    category?: string;
  };

  const { businessContext, category } = body;
  if (!businessContext?.trim() || !category) {
    return NextResponse.json({ error: 'businessContext and category are required' }, { status: 400 });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, role')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile?.organization_id) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
  }
  if (profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const aiConfig = await getOrgAIConfig(supabase, profile.organization_id);
  if (!aiConfig) {
    return NextResponse.json({ error: 'AI not configured' }, { status: 422 });
  }

  const model = getModel(aiConfig.provider, aiConfig.apiKey, aiConfig.model);
  const categoryLabel = CATEGORY_LABELS[category] ?? category;
  const { text: safeContext } = sanitizeIncomingMessage(businessContext, { org_id: profile.organization_id });

  try {
    const { text, usage } = await generateText({
      model,
      system: SECURITY_PREAMBLE,
      prompt: `Você é um especialista em configurar agentes de IA para vendas.

CONTEXTO DO NEGÓCIO:
${safeContext}

CATEGORIA DE ATUAÇÃO DO AGENTE: ${categoryLabel}

Gere sugestões específicas e realistas para ESTE negócio, considerando o tom, público e contexto descritos.
Responda em JSON com exatamente este formato:
{
  "whatToDo": "2-3 frases descrevendo o que o agente deve fazer, específico para este negócio",
  "whatNotToDo": "2-3 frases descrevendo o que o agente NÃO deve fazer, específico para este negócio"
}

Seja específico ao negócio. Mencione elementos reais do contexto (tipo de cliente, produto, serviço).
Retorne APENAS o JSON, sem markdown ou explicações.`,
    });

    // ⚠️ Story 2.10 — contabilização removida, não esquecida.
    // Nunca gravou: omitia `conversation_id` (`NOT NULL`) ⇒ `23502` mudo. Gerar
    // objetivo de board não tem conversa associada, então não é conserto de
    // coluna — é decisão de modelagem, documentada em `logAIAction`
    // (`app/api/ai/actions/route.ts`).

    // Parse JSON response
    const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
    const result = JSON.parse(cleaned) as { whatToDo: string; whatNotToDo: string };

    return NextResponse.json(result);
  } catch (err) {
    console.error('[GenerateGoal] Failed:', err);
    return NextResponse.json({ error: 'Failed to generate goal' }, { status: 500 });
  }
}
