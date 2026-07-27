/**
 * @fileoverview Extração de campos personalizados a partir da conversa.
 *
 * POST /api/messaging/ai/extract-fields
 * Body: { conversationId, organizationId, dealId, messageId? }
 *
 * Rota interna — chamada pelos webhooks de mensageria depois de inserir uma
 * mensagem inbound.
 *
 * Por que ela existe separada de `/api/messaging/ai/process`:
 * a extração nativa (BANT) mora DENTRO do fluxo do agente de atendimento e só
 * roda depois que a IA do CRM responde. No canal do Acreditando (GPT Maker),
 * quem atende é o agente do fornecedor e a IA do CRM fica desligada por decisão
 * de produto — então aquele caminho nunca é percorrido. Esta rota separa as
 * duas coisas: extrair informação da conversa NÃO exige responder ao lead.
 *
 * @module app/api/messaging/ai/extract-fields
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { waitUntil } from '@vercel/functions';
import { extractAndUpdateCustomFields } from '@/lib/ai/extraction';
import crypto from 'crypto';

const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET;

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  // --- Autenticação interna (mesmo contrato de /ai/process) ---
  const internalSecret = request.headers.get('X-Internal-Secret');
  const authHeader = request.headers.get('Authorization');
  const providedKey = internalSecret || authHeader?.replace('Bearer ', '');

  if (!INTERNAL_API_SECRET) {
    console.error('[ExtractFields] INTERNAL_API_SECRET não configurado');
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  if (!providedKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const expectedBuf = Buffer.from(INTERNAL_API_SECRET, 'utf8');
  const providedBuf = Buffer.from(providedKey, 'utf8');
  const isValid =
    expectedBuf.length === providedBuf.length &&
    crypto.timingSafeEqual(expectedBuf, providedBuf);

  if (!isValid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // --- Corpo ---
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { conversationId, organizationId, dealId, messageId } = body as Record<string, unknown>;

  if (typeof conversationId !== 'string' || !conversationId) {
    return NextResponse.json({ error: 'conversationId ausente' }, { status: 400 });
  }
  if (typeof organizationId !== 'string' || !organizationId) {
    return NextResponse.json({ error: 'organizationId ausente' }, { status: 400 });
  }
  if (typeof dealId !== 'string' || !dealId) {
    return NextResponse.json({ error: 'dealId ausente' }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Em dev o waitUntil descarta o callback — aguardar direto deixa testável.
  const isDev = process.env.NODE_ENV === 'development';
  const task = extractAndUpdateCustomFields({
    supabase,
    dealId,
    conversationId,
    organizationId,
    triggerMessageId: typeof messageId === 'string' ? messageId : undefined,
  })
    .then(result => {
      if (!result.success) {
        console.error('[ExtractFields] Falhou:', result.error);
      }
      return result;
    })
    .catch(error => {
      console.error('[ExtractFields] Erro em background:', error);
    });

  if (isDev) {
    await task;
  } else {
    waitUntil(task);
  }

  return Response.json({ received: true }, { status: 200 });
}
