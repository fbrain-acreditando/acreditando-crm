/**
 * @fileoverview Descoberta de workspaces / agentes / canais do GPT Maker
 *
 * Existe para que o admin **só precise colar o token** ao configurar o canal:
 * o CRM consulta a conta e devolve as opções para escolher em lista, em vez de
 * exigir que os 4 IDs sejam garimpados na mão no painel do GPT Maker.
 *
 * POST /api/messaging/gptmaker/discovery
 * Body: { apiToken: string, workspaceId?: string }
 *  - sem `workspaceId` → devolve os workspaces do token
 *  - com `workspaceId` → devolve os agentes e canais daquele workspace
 *
 * Segurança:
 * - Admin autenticado da organização, mesma origem (igual às demais rotas de canal)
 * - O token é usado **em trânsito** e nunca é persistido nem logado aqui.
 *   Ele só é gravado quando o canal é efetivamente criado (em `messaging_channels.credentials`).
 *
 * @module app/api/messaging/gptmaker/discovery
 */

import { createClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { gptMakerDiscovery } from '@/lib/messaging/providers/whatsapp/gptmaker.provider';

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

interface DiscoveredWorkspace {
  id: string;
  name: string;
}

interface DiscoveredAgent {
  id: string;
  name: string;
}

interface DiscoveredChannel {
  id: string;
  name: string;
  type: string;
  connected: boolean;
  username: string | null;
  agentId: string | null;
  agentName: string | null;
}

/**
 * A API do GPT Maker devolve listas em formatos diferentes conforme o endpoint
 * (`/workspaces` devolve array; `/channels` devolve `{ data, count }`).
 * Esta função aceita as duas formas em vez de assumir uma.
 */
function toArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  if (value && typeof value === 'object') {
    const data = (value as { data?: unknown }).data;
    if (Array.isArray(data)) return data as Record<string, unknown>[];
  }
  return [];
}

function pickName(item: Record<string, unknown>): string {
  return (
    (item.name as string) ||
    (item.title as string) ||
    (item.id as string) ||
    'Sem nome'
  );
}

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) {
    return json({ error: 'Forbidden' }, 403);
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return json({ error: 'Unauthorized' }, 401);

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, role, organization_id')
    .eq('id', user.id)
    .single();

  if (profileError || !profile?.organization_id) {
    return json({ error: 'Profile not found' }, 404);
  }

  if (profile.role !== 'admin') {
    return json({ error: 'Forbidden - Admin access required' }, 403);
  }

  let body: { apiToken?: string; workspaceId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const apiToken = body.apiToken?.trim();
  if (!apiToken) {
    return json({ error: 'Token da API é obrigatório' }, 400);
  }

  try {
    // Sem workspace escolhido → lista os workspaces do token.
    if (!body.workspaceId) {
      const raw = await gptMakerDiscovery.listWorkspaces(apiToken);
      const workspaces: DiscoveredWorkspace[] = toArray(raw).map((w) => ({
        id: String(w.id ?? ''),
        name: pickName(w),
      }));

      return json({ workspaces });
    }

    // Com workspace → lista agentes e canais em paralelo.
    const [agentsRaw, channelsRaw] = await Promise.all([
      gptMakerDiscovery.listAgents(apiToken, body.workspaceId),
      gptMakerDiscovery.listChannels(apiToken, body.workspaceId),
    ]);

    const agents: DiscoveredAgent[] = toArray(agentsRaw).map((a) => ({
      id: String(a.id ?? ''),
      name: pickName(a),
    }));

    const channels: DiscoveredChannel[] = toArray(channelsRaw).map((c) => ({
      id: String(c.id ?? ''),
      name: pickName(c),
      type: String(c.type ?? ''),
      connected: Boolean(c.connected),
      username: (c.username as string) ?? null,
      agentId: (c.agentId as string) ?? null,
      agentName: (c.agentName as string) ?? null,
    }));

    return json({ agents, channels });
  } catch (error) {
    // Nunca ecoar o token na mensagem de erro.
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    console.error('[GPTMaker Discovery] Falha ao consultar a API do GPT Maker');

    const isAuthError = /\b401\b|\b403\b/.test(message);
    return json(
      {
        error: isAuthError
          ? 'Token recusado pelo GPT Maker. Confira se copiou a chave inteira.'
          : 'Não foi possível consultar o GPT Maker. Verifique o token e tente de novo.',
      },
      isAuthError ? 401 : 502
    );
  }
}
