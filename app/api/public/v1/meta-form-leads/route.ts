import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { authPublicApi } from '@/lib/public-api/auth';
import {
  beginIdempotency,
  finalizeIdempotency,
  hashRequestBody,
  releaseIdempotency,
  type IdempotencyRef,
} from '@/lib/public-api/idempotency';
import {
  META_FORM_ENDPOINT,
  MetaFormLeadSchema,
  logMetaFormErro,
  processarLeadDoFormulario,
} from '@/lib/meta-form/processarLead';

export const runtime = 'nodejs';

/**
 * POST /api/public/v1/meta-form-leads — story 2.59.
 *
 * A porta pela qual o lead do formulário instantâneo da Meta entra no card da
 * Fernanda (n8n a cada 5 min e o script de backfill do CSV). Esta rota é casca:
 * autentica, valida, cuida da idempotência e delega. A regra vive em
 * `lib/meta-form/processarLead.ts`.
 *
 * - `Idempotency-Key: meta-lead:{leadgen_id}` (recomendado). Mesma chave + mesmo
 *   corpo ⇒ mesma resposta; corpo diferente ⇒ 409.
 * - **202 "aguardando" LIBERA a chave** (AC7, R2 do @po): o reenvio em 5 min
 *   precisa ser processado, não receber o mesmo 202 para sempre.
 * - `?ensaio=1` (AC9): responde a ação PREVISTA sem gravar nada e sem tocar na
 *   tabela de idempotência.
 * - Resposta sem nome, telefone, e-mail, endereço ou resposta clínica (AC12).
 */
export async function POST(request: Request) {
  const requestId = randomUUID();

  const auth = await authPublicApi(request);
  if (!auth.ok) {
    return NextResponse.json({ ...auth.body, request_id: requestId }, { status: auth.status });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON', code: 'BAD_REQUEST', request_id: requestId }, { status: 400 });
  }

  const parsed = MetaFormLeadSchema.safeParse(raw);
  if (!parsed.success) {
    // Só o CAMINHO do erro, nunca o valor recebido (AC12).
    return NextResponse.json(
      {
        error: 'Invalid payload',
        code: 'VALIDATION_ERROR',
        request_id: requestId,
        details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
      { status: 422 }
    );
  }

  const ensaio = new URL(request.url).searchParams.get('ensaio') === '1';

  const idempotencyKey = request.headers.get('idempotency-key')?.trim() || '';
  const ref: IdempotencyRef | null =
    idempotencyKey && !ensaio
      ? {
          organizationId: auth.organizationId,
          endpoint: META_FORM_ENDPOINT,
          idempotencyKey,
          requestHash: hashRequestBody(raw),
        }
      : null;

  if (ref) {
    const outcome = await beginIdempotency(ref);
    if (outcome.kind === 'replay') {
      const body = (outcome.body ?? {}) as Record<string, unknown>;
      return NextResponse.json({ ...body, idempotent_replay: true }, { status: outcome.status });
    }
    if (outcome.kind === 'conflict') {
      return NextResponse.json(
        { error: 'Idempotency key reused with different payload', code: 'IDEMPOTENCY_CONFLICT', request_id: requestId },
        { status: 409 }
      );
    }
    if (outcome.kind === 'error') {
      logMetaFormErro({ requestId, etapa: 'buscar_ja_processado', erro: { message: outcome.message }, extra: { idempotencia: true } });
      return NextResponse.json(
        { error: 'Internal server error', code: 'DB_ERROR', request_id: requestId },
        { status: 500 }
      );
    }
  }

  const resultado = await processarLeadDoFormulario({
    organizationId: auth.organizationId,
    input: parsed.data,
    requestId,
    ensaio,
  });

  if (ref) {
    if (resultado.chave === 'liberar') await releaseIdempotency(ref);
    else if (resultado.chave === 'finalizar') {
      await finalizeIdempotency(ref, { status: resultado.status, body: resultado.body });
    }
  }

  return NextResponse.json(resultado.body, { status: resultado.status });
}
