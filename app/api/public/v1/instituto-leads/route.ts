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
  chavesAutorizadas,
  FORMATO_DA_CHAVE,
  INSTITUTO_ENDPOINT,
  logPedidoErro,
  processarPedidoDaLoja,
  validarPedido,
} from '@/lib/instituto/processarPedido';

export const runtime = 'nodejs';

/**
 * POST /api/public/v1/instituto-leads — story 2.64.
 *
 * O pedido da loja da página do Instituto vira card da Fernanda em "Produtos de
 * treinamento". Chamada SÓ pelo n8n (story 2.65), com uma chave própria: a
 * página nunca guarda chave do CRM (D11). Sem CORS — não é rota de navegador.
 * Esta rota é casca: autentica, valida, cuida da idempotência e delega a
 * `lib/instituto/processarPedido.ts`.
 *
 * - `INSTITUTO_LEADS_API_KEY_IDS` vazia ⇒ 503 `ROTA_DESLIGADA` para toda chamada.
 * - Chave válida fora da lista ⇒ 403 `CHAVE_NAO_AUTORIZADA` (hoje, a chave `n8n`).
 * - `Idempotency-Key: instituto:{64 hex}` obrigatória (AC8). Mesma chave + mesmo
 *   corpo ⇒ mesma resposta; corpo diferente ⇒ 409; 5xx libera a chave.
 * - `?ensaio=1` (AC11): responde a ação PREVISTA sem gravar nada e sem tocar na
 *   tabela de idempotência.
 * - Resposta sem nome, telefone, e-mail ou "para quem" (AC9, AC10).
 */
export async function POST(request: Request) {
  const requestId = randomUUID();

  const autorizadas = chavesAutorizadas();
  if (autorizadas.length === 0) {
    return NextResponse.json(
      { error: 'Route disabled', code: 'ROTA_DESLIGADA', request_id: requestId },
      { status: 503 }
    );
  }

  const auth = await authPublicApi(request);
  if (!auth.ok) {
    return NextResponse.json({ ...auth.body, request_id: requestId }, { status: auth.status });
  }
  if (!autorizadas.includes(auth.apiKeyId)) {
    return NextResponse.json(
      { error: 'API key not allowed on this route', code: 'CHAVE_NAO_AUTORIZADA', request_id: requestId },
      { status: 403 }
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON', code: 'BAD_REQUEST', request_id: requestId }, { status: 400 });
  }

  const idempotencyKey = request.headers.get('idempotency-key')?.trim() || '';
  if (!FORMATO_DA_CHAVE.test(idempotencyKey)) {
    return NextResponse.json(
      { error: 'Missing or invalid Idempotency-Key', code: 'IDEMPOTENCY_KEY_INVALIDA', request_id: requestId },
      { status: 422 }
    );
  }

  const validado = validarPedido(raw);
  if (!validado.ok) {
    // Só o CÓDIGO e o caminho do erro, nunca o valor recebido (AC10).
    return NextResponse.json(
      { error: 'Invalid payload', code: validado.code, campos: validado.campos, request_id: requestId },
      { status: 422 }
    );
  }

  const ensaio = new URL(request.url).searchParams.get('ensaio') === '1';

  const ref: IdempotencyRef | null = ensaio
    ? null
    : {
        organizationId: auth.organizationId,
        endpoint: INSTITUTO_ENDPOINT,
        idempotencyKey,
        requestHash: hashRequestBody(raw),
      };

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
      logPedidoErro({ requestId, etapa: 'idempotencia', erro: { message: outcome.message } });
      return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR', request_id: requestId }, { status: 500 });
    }
  }

  const resultado = await processarPedidoDaLoja({
    organizationId: auth.organizationId,
    pedido: validado.pedido,
    telefone: validado.telefone,
    idempotencyKey,
    requestId,
    ensaio,
  });

  if (ref) {
    if (resultado.chave === 'liberar') await releaseIdempotency(ref);
    else await finalizeIdempotency(ref, { status: resultado.status, body: resultado.body });
  }

  return NextResponse.json(resultado.body, { status: resultado.status });
}
