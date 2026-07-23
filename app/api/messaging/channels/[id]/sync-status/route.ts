import { createClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { getChannelRouter } from '@/lib/messaging';
import type { ChannelStatus } from '@/lib/messaging/types';

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/messaging/channels/[id]/sync-status
 *
 * Reconcilia o status gravado no banco com o estado REAL do provedor.
 *
 * Motivo: o botão "Conectar" apenas gravava `status: 'connecting'` e nunca
 * consultava o provedor. Instâncias já conectadas (ex: uma instância Evolution
 * compartilhada e sempre-ligada) ficavam presas em "Conectando..." para sempre,
 * porque o webhook `connection.update` só dispara em MUDANÇA de estado — e não
 * há mudança quando a instância já estava `open` antes do canal existir.
 *
 * Esta rota pergunta ao provedor o estado atual (`getChannelStatus`) e grava o
 * resultado no banco. Funciona para qualquer provedor que implemente getStatus.
 */
export async function POST(req: Request, { params }: RouteParams) {
  if (!isAllowedOrigin(req)) {
    return json({ error: 'Forbidden' }, 403);
  }

  const { id: channelId } = await params;
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

  // Apenas admins podem gerenciar canais.
  if (profile.role !== 'admin') {
    return json({ error: 'Forbidden - Admin access required' }, 403);
  }

  // Confirma que o canal pertence à organização (defense-in-depth além do RLS)
  // e não está deletado, antes de tocar o provedor.
  const { data: channel, error: channelError } = await supabase
    .from('messaging_channels')
    .select('id, provider, settings')
    .eq('id', channelId)
    .eq('organization_id', profile.organization_id)
    .is('deleted_at', null)
    .single();

  if (channelError || !channel) {
    return json({ error: 'Channel not found' }, 404);
  }

  try {
    // Consulta o estado REAL no provedor (ex: Evolution connectionState).
    const router = getChannelRouter();
    const live = await router.getChannelStatus(channelId);

    const newStatus: ChannelStatus = live.status;

    const updatePayload: Record<string, unknown> = {
      status: newStatus,
      status_message: newStatus === 'error' ? (live.message ?? 'Erro desconhecido') : null,
      updated_at: new Date().toISOString(),
    };

    if (newStatus === 'connected') {
      updatePayload.last_connected_at = new Date().toISOString();

      // Se o provedor devolveu o telefone, exibe na UI (paridade com Z-API),
      // sem sobrescrever outros campos de settings.
      const phone = live.details?.phoneNumber;
      if (phone) {
        updatePayload.settings = {
          ...((channel.settings as Record<string, unknown> | null) ?? {}),
          displayPhone: phone,
        };
      }
    }

    const { error: updateError } = await supabase
      .from('messaging_channels')
      .update(updatePayload)
      .eq('id', channelId)
      .eq('organization_id', profile.organization_id);

    if (updateError) {
      return json({ error: updateError.message }, 500);
    }

    return json({
      status: newStatus,
      message: live.message ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to sync channel status';
    console.error('[sync-status] Error:', message);

    await supabase
      .from('messaging_channels')
      .update({
        status: 'error',
        status_message: message,
        updated_at: new Date().toISOString(),
      })
      .eq('id', channelId)
      .eq('organization_id', profile.organization_id);

    return json({ error: message }, 500);
  }
}
