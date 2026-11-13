/**
 * @fileoverview Instancia o provider do canal — como faz
 * `app/api/messaging/channels/[id]/gptmaker/sync/route.ts` (story 2.52).
 *
 * @module lib/messaging/iniciar-conversa/provedor
 */

import { GptMakerWhatsAppProvider } from '@/lib/messaging/providers/whatsapp/gptmaker.provider';
import type { CanalDoInicio, ProvedorDeInicio } from './servico';

export async function criarProvedorDoCanal(canal: CanalDoInicio): Promise<ProvedorDeInicio> {
  if (canal.provider !== 'gptmaker') {
    throw new Error(`Canal ${canal.id} não é da IA do WhatsApp (provider ${canal.provider})`);
  }
  const provider = new GptMakerWhatsAppProvider();
  await provider.initialize({
    channelId: canal.id,
    channelType: 'whatsapp',
    provider: 'gptmaker',
    externalIdentifier: canal.external_identifier ?? '',
    credentials: (canal.credentials ?? {}) as unknown as Record<string, string>,
  });
  return provider;
}
