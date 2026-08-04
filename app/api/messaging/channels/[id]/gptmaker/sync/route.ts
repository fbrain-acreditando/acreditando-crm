/**
 * @fileoverview Sincronização do canal GPT Maker — registra webhooks + importa conversas
 *
 * Fecha os dois furos que apareceram no primeiro uso real:
 *
 * 1. **O webhook precisava ser colado à mão** no painel do GPT Maker. Como o CRM já
 *    tem o token, o `agentId` e sabe a própria URL, ele registra sozinho via
 *    `PUT /v2/agent/{agentId}/webhooks` — sem copiar/colar e sem risco de perder o
 *    `?key=` (que é a única autenticação, já que a plataforma não assina os payloads).
 *
 * 2. **Conversa que já existia no GPT Maker não aparecia.** O webhook é orientado a
 *    evento: só reage a mensagem NOVA. Esta rota importa o histórico recente
 *    (`GET /v2/workspace/{id}/chats` + `GET /v2/chat/{id}/messages`).
 *
 * ⚠️ A importação **não cria deals** por padrão. Criar deal para cada conversa
 * histórica despejaria dezenas de cards no funil de uma vez. Deals continuam sendo
 * criados pelo fluxo normal (mensagem nova via webhook + regra de Entrada de Leads).
 * Para importar criando deals, passe `createDeals: true` no corpo — decisão explícita.
 *
 * POST /api/messaging/channels/[id]/gptmaker/sync
 * Body (opcional): { maxChats?: number, createDeals?: boolean, skipWebhooks?: boolean }
 *
 * @module app/api/messaging/channels/[id]/gptmaker/sync
 */

import { createClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import {
  GptMakerWhatsAppProvider,
  type GptMakerCredentials,
  type GptMakerChat,
} from '@/lib/messaging/providers/whatsapp/gptmaker.provider';

// A importação faz N chamadas à API do GPT Maker (1 por chat + páginas de mensagens).
export const maxDuration = 60;

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** Normaliza telefone para o formato do CRM (+55...). */
function normalizePhone(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 8) return null;
  return `+${digits}`;
}

/** Nome exibível do chat, com o telefone como último recurso. */
/**
 * Nome de exibição do contato de um chat do GPT Maker.
 *
 * 🔴 **`chat.userName` NÃO é o contato — é o atendente humano.** Ele vinha em
 * primeiro lugar nesta lista e, por isso, o sync batizou 11 leads reais com o nome
 * do operador. Medido na API em 2026-08-04: de 4.000 chats, **151 trazem
 * `userName: "Filipe Costa"`** e **17 trazem `"Fernanda"`** — os dois operadores da
 * conta, não 168 pessoas homônimas.
 *
 * Exemplo literal da API, no mesmo objeto:
 * ```
 * { name: "GUINA😎", userName: "Filipe Costa" }   ← name é o contato
 * ```
 *
 * ⚖️ O estrago não é cosmético: dado pessoal — e de saúde, neste canal — atrelado à
 * identidade errada fere a exatidão do **Art. 6º, V da LGPD**, e a Fernanda via
 * várias conversas com o mesmo nome sendo pessoas distintas.
 *
 * `userName` foi **removido da lista de propósito**: ele nunca é o contato, então
 * nem como último recurso serve. Quando o GPT Maker não tem nome (acontece: 4 dos
 * 11 casos vinham com `name: ""`), o telefone é a resposta honesta.
 */
export function chatDisplayName(chat: GptMakerChat, phone: string | null): string {
  return chat.name || chat.title || phone || chat.id;
}

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

  if (profile.role !== 'admin') {
    return json({ error: 'Forbidden - Admin access required' }, 403);
  }

  const { data: channel, error: channelError } = await supabase
    .from('messaging_channels')
    .select('id, provider, business_unit_id, credentials, external_identifier')
    .eq('id', channelId)
    .eq('organization_id', profile.organization_id)
    .is('deleted_at', null)
    .single();

  if (channelError || !channel) {
    return json({ error: 'Channel not found' }, 404);
  }

  if (channel.provider !== 'gptmaker') {
    return json({ error: 'Esta rota só vale para canais GPT Maker' }, 400);
  }

  let body: { maxChats?: number; createDeals?: boolean; skipWebhooks?: boolean } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    // Corpo vazio é válido — usa os defaults.
  }

  const maxChats = Math.min(Math.max(body.maxChats ?? 20, 1), 50);
  const createDeals = body.createDeals === true;

  const credentials = channel.credentials as unknown as GptMakerCredentials;

  const report = {
    webhooks: { configured: false, url: null as string | null, error: null as string | null },
    chats: { found: 0, imported: 0, skipped: 0 },
    messages: { imported: 0, transcriptionsFilled: 0 },
    deals: { created: 0 },
    avatars: { updated: 0 },
    errors: [] as string[],
  };

  try {
    const provider = new GptMakerWhatsAppProvider();
    await provider.initialize({
      channelId: channel.id,
      channelType: 'whatsapp',
      provider: 'gptmaker',
      externalIdentifier: channel.external_identifier,
      credentials: credentials as unknown as Record<string, string>,
    });

    // -------------------------------------------------------------------------
    // 1. Registrar os webhooks no agente
    // -------------------------------------------------------------------------
    if (!body.skipWebhooks) {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const secret = credentials.webhookSecret;

      if (!supabaseUrl) {
        report.webhooks.error = 'NEXT_PUBLIC_SUPABASE_URL não configurada no servidor';
      } else if (!secret) {
        report.webhooks.error =
          'Canal sem webhookSecret. Sem segredo o webhook não tem autenticação — reconfigure o canal.';
      } else {
        const webhookUrl = `${supabaseUrl}/functions/v1/messaging-webhook-gptmaker/${channelId}?key=${encodeURIComponent(secret)}`;
        const result = await provider.configureWebhooks(webhookUrl, [
          'onNewMessage',
          'onFirstInteraction',
          'onTransfer',
        ]);

        report.webhooks.configured = result.success;
        // A URL vai no relatório SEM o segredo — ele não deve vazar para o client.
        report.webhooks.url = `${supabaseUrl}/functions/v1/messaging-webhook-gptmaker/${channelId}?key=***`;
        report.webhooks.error = result.error ?? null;
      }
    }

    // -------------------------------------------------------------------------
    // 2. Importar o histórico recente
    // -------------------------------------------------------------------------
    const chats = await provider.listChats({ pageSize: maxChats });
    const chatList = Array.isArray(chats) ? chats.slice(0, maxChats) : [];
    report.chats.found = chatList.length;

    for (const chat of chatList) {
      try {
        if (!chat.id) {
          report.chats.skipped++;
          continue;
        }

        const phone = normalizePhone(chat.whatsappPhone ?? chat.recipient);
        const displayName = chatDisplayName(chat, phone);
        // Foto de perfil do WhatsApp — vem só na listagem de chats, nunca no webhook.
        // ⚠️ URL do pps.whatsapp.net é temporária/assinada: expira. Por isso a
        // re-sincronização atualiza a foto das conversas já existentes também.
        const avatar =
          (chat.picture as string | undefined) ??
          (chat.userPicture as string | undefined) ??
          (chat.avatar as string | undefined) ??
          null;

        // --- Conversa (identidade = chatId do GPT Maker) ---
        const { data: existingConv } = await supabase
          .from('messaging_conversations')
          .select('id, contact_id, external_contact_avatar')
          .eq('channel_id', channelId)
          .eq('external_contact_id', chat.id)
          .maybeSingle();

        let conversationId = existingConv?.id as string | undefined;
        let contactId = existingConv?.contact_id as string | null | undefined;

        // Conversa já existe: atualiza a foto (a URL antiga pode ter expirado)
        // e propaga para o contato. Sem isto, re-sincronizar nunca traria o avatar
        // das 20 conversas importadas antes deste recurso existir.
        if (conversationId && avatar && avatar !== existingConv?.external_contact_avatar) {
          await supabase
            .from('messaging_conversations')
            .update({ external_contact_avatar: avatar })
            .eq('id', conversationId);
          if (contactId) {
            await supabase.from('contacts').update({ avatar }).eq('id', contactId);
          }
          report.avatars.updated++;
        }

        if (!conversationId) {
          // --- Contato (reusa por telefone; não duplica) ---
          if (phone) {
            const { data: existingContact } = await supabase
              .from('contacts')
              .select('id')
              .eq('organization_id', profile.organization_id)
              .eq('phone', phone)
              .is('deleted_at', null)
              .order('created_at')
              .limit(1)
              .maybeSingle();
            contactId = existingContact?.id ?? null;
          }

          if (!contactId) {
            const { data: newContact, error: contactErr } = await supabase
              .from('contacts')
              .insert({
                organization_id: profile.organization_id,
                name: displayName,
                phone,
                source: 'whatsapp',
                avatar,
              })
              .select('id')
              .single();

            if (contactErr) {
              report.errors.push(`Contato de "${displayName}": ${contactErr.message}`);
            } else {
              contactId = newContact.id;
            }
          }

          const { data: newConv, error: convErr } = await supabase
            .from('messaging_conversations')
            .insert({
              organization_id: profile.organization_id,
              channel_id: channelId,
              business_unit_id: channel.business_unit_id,
              external_contact_id: chat.id,
              external_contact_name: displayName,
              external_contact_avatar: avatar,
              contact_id: contactId,
              status: chat.finished ? 'resolved' : 'open',
              priority: chat.humanTalk ? 'high' : 'normal',
              metadata: {
                gptmaker_chat_id: chat.id,
                gptmaker_phone: phone,
                gptmaker_human_talk: chat.humanTalk ?? false,
                source: 'gptmaker',
                imported: true,
                // Quem atende é a IA do GPT Maker — a do CRM fica fora deste canal.
                ai_paused: true,
              },
            })
            .select('id')
            .single();

          if (convErr) {
            report.errors.push(`Conversa de "${displayName}": ${convErr.message}`);
            report.chats.skipped++;
            continue;
          }

          conversationId = newConv.id;
          report.chats.imported++;

          // --- Deal (só sob pedido explícito) ---
          if (createDeals && contactId) {
            const { data: rule } = await supabase
              .from('lead_routing_rules')
              .select('board_id, stage_id, enabled')
              .eq('channel_id', channelId)
              .maybeSingle();

            if (rule?.enabled && rule.board_id) {
              let stageId = rule.stage_id as string | null;

              if (!stageId) {
                const { data: firstStage } = await supabase
                  .from('board_stages')
                  .select('id')
                  .eq('board_id', rule.board_id)
                  .order('order', { ascending: true })
                  .limit(1)
                  .maybeSingle();
                stageId = firstStage?.id ?? null;
              }

              if (stageId) {
                const { data: newDeal, error: dealErr } = await supabase
                  .from('deals')
                  .insert({
                    organization_id: profile.organization_id,
                    board_id: rule.board_id,
                    stage_id: stageId,
                    contact_id: contactId,
                    title: `${displayName} - WhatsApp`,
                    value: 0,
                  })
                  .select('id')
                  .single();

                if (dealErr) {
                  report.errors.push(`Deal de "${displayName}": ${dealErr.message}`);
                } else {
                  report.deals.created++;
                  await supabase
                    .from('messaging_conversations')
                    .update({
                      metadata: {
                        gptmaker_chat_id: chat.id,
                        gptmaker_phone: phone,
                        source: 'gptmaker',
                        imported: true,
                        ai_paused: true,
                        deal_id: newDeal.id,
                        auto_created_deal: true,
                      },
                    })
                    .eq('id', conversationId);
                }
              }
            }
          }
        }

        // --- Mensagens ---
        const messages = await provider.fetchChatMessages(chat.id, {
          pageSize: 50,
          maxPages: 3,
        });

        let lastTimestamp: Date | null = null;
        let lastPreview = '';
        let lastDirection: 'inbound' | 'outbound' = 'inbound';

        for (const message of messages) {
          const role = (message.role ?? 'user').toLowerCase();
          const direction: 'inbound' | 'outbound' = role === 'user' ? 'inbound' : 'outbound';
          const rawTime = message.time;
          const timestamp =
            typeof rawTime === 'number'
              ? new Date(rawTime > 1e12 ? rawTime : rawTime * 1000)
              : new Date();

          let contentType = 'text';
          let content: Record<string, unknown> = {
            type: 'text',
            text: message.text || '[mensagem]',
          };

          if (message.imageUrl) {
            contentType = 'image';
            content = { type: 'image', mediaUrl: message.imageUrl, caption: message.text };
          } else if (message.audioUrl) {
            contentType = 'audio';
            // `midiaContent` é a transcrição que o GPT Maker já produz — vale
            // para áudio recebido e enviado. O webhook não a entrega; esta API é
            // a única fonte. Campo estava declarado no provider e nunca lido.
            content = {
              type: 'audio',
              mediaUrl: message.audioUrl,
              ...(message.midiaContent?.trim()
                ? { transcription: message.midiaContent.trim() }
                : {}),
            };
          } else if (message.documentUrl) {
            contentType = 'document';
            content = {
              type: 'document',
              mediaUrl: message.documentUrl,
              fileName: message.fileName ?? 'documento',
            };
          }

          const externalId = message.id ?? `gptmaker:${chat.id}:${timestamp.getTime()}`;

          const { error: msgErr } = await supabase.from('messaging_messages').insert({
            conversation_id: conversationId,
            external_id: externalId,
            direction,
            content_type: contentType,
            content,
            // A API não expõe status de entrega — não prometemos delivered/read.
            status: 'sent',
            sent_at: timestamp.toISOString(),
            sender_name: direction === 'inbound' ? message.userName ?? null : null,
            metadata: {
              gptmaker_chat_id: chat.id,
              gptmaker_message_id: message.id,
              source: 'gptmaker',
              imported: true,
            },
          });

          if (!msgErr) {
            report.messages.imported++;
          } else if (!msgErr.message.toLowerCase().includes('duplicate')) {
            report.errors.push(`Mensagem ${externalId}: ${msgErr.message}`);
          } else if (contentType === 'audio' && content.transcription) {
            // Mensagem JÁ existe (o insert acima é ignorado por duplicidade), mas
            // agora temos a transcrição e ela não estava lá. Sem este update, todo
            // o histórico de áudio ficaria para sempre sem texto — e os áudios que
            // chegaram pelo webhook antes de o fornecedor transcrever também.
            const { error: updErr } = await supabase
              .from('messaging_messages')
              .update({
                content,
                metadata: {
                  gptmaker_chat_id: chat.id,
                  gptmaker_message_id: message.id,
                  source: 'gptmaker',
                  transcription_backfilled: true,
                },
              })
              .eq('external_id', externalId)
              .eq('conversation_id', conversationId)
              .is('content->>transcription', null);

            if (updErr) {
              report.errors.push(`Transcrição ${externalId}: ${updErr.message}`);
            } else {
              report.messages.transcriptionsFilled =
                (report.messages.transcriptionsFilled ?? 0) + 1;
            }
          }

          if (!lastTimestamp || timestamp > lastTimestamp) {
            lastTimestamp = timestamp;
            lastPreview = (
              (contentType === 'audio' && typeof content.transcription === 'string'
                ? content.transcription
                : message.text) || '[mensagem]'
            ).slice(0, 100);
            lastDirection = direction;
          }
        }

        if (lastTimestamp && conversationId) {
          // ⚠️ Condicional ao carimbo (story 2.8). O sync só enxerga a janela de
          // mensagens que buscou; se o webhook já gravou algo MAIS NOVO que não
          // veio nessa janela, escrever sem comparar faria a lista andar para trás.
          //
          // Aqui é `lte`, e no webhook é `lt` — a diferença é deliberada. O webhook
          // recusa empate porque duas entregas simultâneas ficariam alternando a
          // prévia. O sync PRECISA do empate: é assim que ele conserta a prévia da
          // MESMA última mensagem quando a transcrição do áudio chega depois — o
          // carimbo é idêntico, só o texto melhora (de `[áudio]` para o que foi
          // dito). Sem o empate, os áudios transcritos depois ficariam com a prévia
          // de placeholder para sempre.
          const iso = lastTimestamp.toISOString();
          await supabase
            .from('messaging_conversations')
            .update({
              last_message_at: iso,
              last_message_preview: lastPreview,
              last_message_direction: lastDirection,
            })
            .eq('id', conversationId)
            .or(`last_message_at.is.null,last_message_at.lte."${iso}"`);
        }
      } catch (chatError) {
        const message = chatError instanceof Error ? chatError.message : 'Erro desconhecido';
        report.errors.push(`Chat ${chat.id}: ${message}`);
        report.chats.skipped++;
      }
    }

    return json(report);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    console.error('[gptmaker/sync] Falha:', message);
    return json({ ...report, error: message }, 502);
  }
}
