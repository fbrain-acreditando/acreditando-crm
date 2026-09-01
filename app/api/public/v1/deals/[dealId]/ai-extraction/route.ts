import { NextResponse } from 'next/server';
import { authPublicApi } from '@/lib/public-api/auth';
import { isValidUUID } from '@/lib/supabase/utils';
import {
  AI_EXTRACTION_ENDPOINT,
  AiExtractionSchema,
  applyAiExtraction,
} from '@/lib/public-api/aiExtraction';
import {
  beginIdempotency,
  finalizeIdempotency,
  hashRequestBody,
  type IdempotencyRef,
} from '@/lib/public-api/idempotency';

export const runtime = 'nodejs';

/**
 * POST /api/public/v1/deals/{dealId}/ai-extraction — story 2.49.
 *
 * A porta pela qual o n8n empurra campos de qualificação e nota JÁ extraídos.
 * Esta rota é casca: valida entrada e delega. Toda a regra de gravação vive em
 * `lib/public-api/aiExtraction.ts`, testável sem HTTP.
 */
export async function POST(request: Request, ctx: { params: Promise<{ dealId: string }> }) {
  const auth = await authPublicApi(request);
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });

  const { dealId } = await ctx.params;
  if (!isValidUUID(dealId)) {
    return NextResponse.json(
      { error: 'Invalid deal id', code: 'VALIDATION_ERROR' },
      { status: 422 }
    );
  }

  // Body cru primeiro: o hash de idempotência é do que CHEGOU, não do que o Zod
  // devolveu. Corpos diferentes que normalizam para o mesmo objeto continuam
  // sendo requisições diferentes.
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON', code: 'BAD_REQUEST' }, { status: 400 });
  }

  const parsed = AiExtractionSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Invalid payload',
        code: 'VALIDATION_ERROR',
        details: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      },
      { status: 422 }
    );
  }

  const idempotencyKey = request.headers.get('idempotency-key')?.trim() || '';
  const ref: IdempotencyRef | null = idempotencyKey
    ? {
        organizationId: auth.organizationId,
        endpoint: AI_EXTRACTION_ENDPOINT,
        idempotencyKey,
        requestHash: hashRequestBody(raw),
      }
    : null;

  // A reserva vem ANTES de qualquer escrita no deal — replay não pode reprocessar.
  if (ref) {
    const outcome = await beginIdempotency(ref);

    if (outcome.kind === 'replay') {
      const body = (outcome.body ?? {}) as Record<string, unknown>;
      const data = (body.data ?? {}) as Record<string, unknown>;
      return NextResponse.json(
        { ...body, data: { ...data, idempotent_replay: true } },
        { status: outcome.status }
      );
    }
    if (outcome.kind === 'conflict') {
      return NextResponse.json(
        { error: 'Idempotency key reused with different payload', code: 'IDEMPOTENCY_CONFLICT' },
        { status: 409 }
      );
    }
    if (outcome.kind === 'error') {
      return NextResponse.json(
        { error: 'Internal server error', code: 'DB_ERROR' },
        { status: 500 }
      );
    }
  }

  const result = await applyAiExtraction({
    organizationId: auth.organizationId,
    dealId,
    input: parsed.data,
  });

  if (ref) {
    await finalizeIdempotency(ref, { status: result.status, body: result.body });
  }

  return NextResponse.json(result.body, { status: result.status });
}
