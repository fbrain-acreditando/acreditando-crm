/**
 * @fileoverview Iniciar conversa no WhatsApp a partir do card — story 2.52.
 *
 * Desenho (AC4, decidido na v3/v4.1):
 * 1. **Pré-grava** a conversa ANTES do disparo, com as mesmas colunas que o webhook
 *    grava (`ensureConversation`/`criarConversa`, `messaging-webhook-gptmaker/index.ts`).
 *    O eco do envio acha a conversa pela chave (ou pela variante da 2.63) e nunca cria
 *    contato nem card.
 * 2. Áudio sobe DEPOIS do INSERT, no caminho de `media/upload` (V16).
 * 3. Falha no disparo ⇒ desfaz a própria pré-gravação (DELETE ⇒ senão marca
 *    `inicio_falhou` ⇒ senão registra `erro_sem_desfazer`) e apaga o arquivo.
 * 4. A mensagem enviada **não** é gravada aqui: ela chega pelo eco (Dev Notes 2.53).
 * 5. Depois do sucesso, `confirmarHumano` passa a conversa para a Fernanda
 *    (`startHuman` + leitura do `humanTalk`) com prazo pelo relógio (AC4.5).
 *
 * Toda leitura/escrita é com service role e **sempre** filtra `organization_id`
 * (a rota já validou usuário e organização).
 *
 * @module lib/messaging/iniciar-conversa/servico
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { SendMessageParams, SendMessageResult } from '@/lib/messaging/types';
import { chavesDaConversa, mascararTelefone, normalizarTelefoneWhatsApp } from './telefone';
import {
  ACAO_ASSUMIR,
  ACAO_HUMANO,
  ACAO_INICIAR,
  LIMITE_DIARIO,
  TEXTO_LIMITE_ATINGIDO,
  inicioDoDiaEmSaoPaulo,
  motivoResumido,
  tentarAteConfirmar,
  type ConteudoDaPrimeiraMensagem,
} from './regras';
import { agoraMs, esperar } from './relogio';

// =============================================================================
// Tipos
// =============================================================================

/** O que a rota precisa do provider (o `GptMakerWhatsAppProvider` cumpre). */
export interface ProvedorDeInicio {
  sendMessage(params: SendMessageParams): Promise<SendMessageResult>;
  startHuman(chatId: string): Promise<{ success: boolean; error?: string }>;
  lerChatHumano(telefone: string, chatId: string): Promise<{ achou: boolean; humanTalk: boolean }>;
}

export interface CanalDoInicio {
  id: string;
  organization_id: string;
  business_unit_id: string;
  provider: string;
  channel_type: string;
  external_identifier: string | null;
  credentials: Record<string, unknown> | null;
}

export type CriarProvedor = (canal: CanalDoInicio) => Promise<ProvedorDeInicio>;

type Metadata = Record<string, unknown>;

export interface RespostaDoServico {
  status: number;
  corpo: Record<string, unknown>;
}

export const BUCKET_DE_MIDIA = 'messaging-media';

// =============================================================================
// Registro (AC7) e teto (AC3)
// =============================================================================

interface Registro {
  acao: string;
  orgId: string;
  userId: string;
  conversationId?: string | null;
  resultado: string;
  severidade?: 'info' | 'warning' | 'error';
  detalhes?: Record<string, unknown>;
}

/** Grava em `audit_logs`. Nunca lança: o registro não pode derrubar o envio. */
export async function registrar(db: SupabaseClient, r: Registro): Promise<void> {
  try {
    const { error } = await db.from('audit_logs').insert({
      user_id: r.userId,
      organization_id: r.orgId,
      action: r.acao,
      resource_type: 'messaging_conversation',
      resource_id: r.conversationId ?? null,
      severity: r.severidade ?? 'info',
      details: { resultado: r.resultado, ...(r.detalhes ?? {}) },
      created_at: new Date(agoraMs()).toISOString(),
    });
    if (error) console.error('[iniciar-conversa] falha ao gravar audit_logs:', error.message);
  } catch (e) {
    console.error('[iniciar-conversa] falha ao gravar audit_logs:', e instanceof Error ? e.message : e);
  }
}

/** Conversas iniciadas COM SUCESSO hoje (dia de Brasília) pela organização. */
export async function contarIniciadasHoje(db: SupabaseClient, orgId: string): Promise<number> {
  const desde = inicioDoDiaEmSaoPaulo(new Date(agoraMs()));
  const { count, error } = await db
    .from('audit_logs')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('action', ACAO_INICIAR)
    .eq('details->>resultado', 'sucesso')
    .gte('created_at', desde);
  if (error) throw new Error(`Falha ao contar conversas iniciadas hoje: ${error.message}`);
  return count ?? 0;
}

// =============================================================================
// Peças
// =============================================================================

async function contarMensagens(db: SupabaseClient, conversationId: string): Promise<number | null> {
  const { count, error } = await db
    .from('messaging_messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId);
  if (error) return null;
  return count ?? 0;
}

/**
 * O canal WhatsApp conectado da organização. Com um só (produção hoje), é ele. Com
 * mais de um, desempata pela regra de entrada de leads do quadro do card; sem
 * desempate, não escolhe (o navegador nunca escolhe o canal).
 */
async function escolherCanal(
  db: SupabaseClient,
  orgId: string,
  boardId: string | null
): Promise<CanalDoInicio | null | 'ambiguo'> {
  const { data, error } = await db
    .from('messaging_channels')
    .select('id, organization_id, business_unit_id, provider, channel_type, external_identifier, credentials, status')
    .eq('organization_id', orgId)
    .eq('provider', 'gptmaker')
    .eq('channel_type', 'whatsapp')
    .eq('status', 'connected')
    .is('deleted_at', null);
  if (error) throw new Error(`Falha ao ler canais: ${error.message}`);
  const canais = (data ?? []) as CanalDoInicio[];
  if (canais.length === 0) return null;
  if (canais.length === 1) return canais[0];
  if (!boardId) return 'ambiguo';

  const { data: regras } = await db
    .from('lead_routing_rules')
    .select('channel_id')
    .eq('organization_id', orgId)
    .eq('board_id', boardId)
    .eq('enabled', true);
  const ids = new Set(((regras ?? []) as Array<{ channel_id: string }>).map((r) => r.channel_id));
  const doQuadro = canais.filter((c) => ids.has(c.id));
  return doQuadro.length === 1 ? doQuadro[0] : 'ambiguo';
}

/**
 * A linha da conversa pré-gravada — as MESMAS colunas do `criarConversa` do webhook
 * (C1 do @po), mais o marcador de origem e a atribuição (v4.1).
 */
export function montarLinhaDaConversa(p: {
  orgId: string;
  canal: CanalDoInicio;
  chave: string;
  digitos: string;
  contato: { id: string; name: string | null };
  userId: string;
  iniciadaEm: string;
}): Record<string, unknown> {
  const telefone = `+${p.digitos}`;
  return {
    organization_id: p.orgId,
    channel_id: p.canal.id,
    // ⚠️ Do CANAL, nunca do quadro: é a coluna da RLS de leitura para quem não é admin.
    business_unit_id: p.canal.business_unit_id,
    external_contact_id: p.chave,
    external_contact_name: p.contato.name || telefone,
    contact_id: p.contato.id,
    status: 'open',
    priority: 'normal',
    assigned_user_id: p.userId,
    assigned_at: p.iniciadaEm,
    metadata: {
      gptmaker_chat_id: p.chave,
      // Mesmo formato do webhook (`normalizePhone` do parser): `+` e dígitos.
      gptmaker_phone: telefone,
      source: 'gptmaker',
      ai_paused: true,
      iniciada_pelo_crm: true,
      iniciada_por: p.userId,
      iniciada_em: p.iniciadaEm,
      humano_pedido: true,
    },
  };
}

function ehDuplicada(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return err.code === '23505' || /duplicate/i.test(err.message ?? '');
}

type Desfeito = 'apagada' | 'marcada' | 'erro_sem_desfazer' | 'mensagem_saiu';

/** AC4.3 — desfaz a pré-gravação da própria rota. */
async function desfazer(
  db: SupabaseClient,
  orgId: string,
  conversationId: string,
  metadataGravado: Metadata,
  caminhoDoAudio: string | null
): Promise<Desfeito> {
  const mensagens = await contarMensagens(db, conversationId);

  // O eco chegou apesar do erro: a mensagem saiu, a conversa é real.
  if (mensagens !== null && mensagens > 0) return 'mensagem_saiu';

  let resultado: Desfeito;
  const apagou =
    mensagens === 0
      ? await db.from('messaging_conversations').delete().eq('id', conversationId).eq('organization_id', orgId)
      : { error: { message: 'contagem de mensagens indisponível' } };

  if (!apagou.error) {
    resultado = 'apagada';
  } else {
    const { error } = await db
      .from('messaging_conversations')
      .update({
        metadata: {
          ...metadataGravado,
          inicio_falhou: true,
          inicio_falhou_em: new Date(agoraMs()).toISOString(),
        },
      })
      .eq('id', conversationId)
      .eq('organization_id', orgId);
    resultado = error ? 'erro_sem_desfazer' : 'marcada';
  }

  if (caminhoDoAudio) {
    const { error } = await db.storage.from(BUCKET_DE_MIDIA).remove([caminhoDoAudio]);
    if (error) console.error('[iniciar-conversa] falha ao apagar o áudio:', error.message);
  }
  return resultado;
}

// =============================================================================
// POST /start
// =============================================================================

export async function iniciarConversa(args: {
  db: SupabaseClient;
  orgId: string;
  userId: string;
  dealId: string;
  conteudo: ConteudoDaPrimeiraMensagem;
  criarProvedor: CriarProvedor;
  novoId?: () => string;
}): Promise<RespostaDoServico & { confirmarHumano?: { conversationId: string; canal: CanalDoInicio } }> {
  const { db, orgId, userId, dealId, conteudo } = args;
  const novoId = args.novoId ?? (() => crypto.randomUUID());

  // ---- 1. Card e contato (do banco, nunca do corpo) ---------------------------
  const { data: deal, error: dealError } = await db
    .from('deals')
    .select('id, organization_id, contact_id, board_id, stage_id')
    .eq('id', dealId)
    .eq('organization_id', orgId)
    .is('deleted_at', null)
    .maybeSingle();
  if (dealError) return { status: 500, corpo: { error: 'Falha ao ler o negócio.' } };
  if (!deal) return { status: 404, corpo: { error: 'Negócio não encontrado.' } };
  if (!deal.contact_id) return { status: 422, corpo: { error: 'Este negócio não tem contato.' } };

  const { data: contato } = await db
    .from('contacts')
    .select('id, name, phone')
    .eq('id', deal.contact_id)
    .eq('organization_id', orgId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!contato) return { status: 422, corpo: { error: 'Contato não encontrado.' } };
  if (!contato.phone) return { status: 422, corpo: { error: 'Contato sem telefone' } };

  const digitos = normalizarTelefoneWhatsApp(contato.phone);
  if (!digitos) {
    return { status: 422, corpo: { error: 'O telefone do contato não está num formato que o WhatsApp aceita.' } };
  }
  const telefoneMascarado = mascararTelefone(digitos);
  const base = { deal_id: deal.id, contact_id: contato.id, telefone: telefoneMascarado };

  // ---- 2. Canal ---------------------------------------------------------------
  const canal = await escolherCanal(db, orgId, deal.board_id ?? null);
  if (canal === null) return { status: 422, corpo: { error: 'Nenhum canal de WhatsApp conectado.' } };
  if (canal === 'ambiguo') {
    return { status: 422, corpo: { error: 'Não deu para saber por qual WhatsApp enviar para este card.' } };
  }
  const canalDoFornecedor = String((canal.credentials ?? {}).gptmakerChannelId ?? '');
  if (!canalDoFornecedor) return { status: 422, corpo: { error: 'Canal de WhatsApp sem configuração.' } };

  const chaves = chavesDaConversa(canalDoFornecedor, digitos);

  // ---- 3. Já tem conversa? (pelo contato OU pela chave nas duas formas) -------
  const [porContato, porChave] = await Promise.all([
    db
      .from('messaging_conversations')
      .select('id, metadata, external_contact_id')
      .eq('organization_id', orgId)
      .eq('channel_id', canal.id)
      .eq('contact_id', contato.id),
    db
      .from('messaging_conversations')
      .select('id, metadata, external_contact_id')
      .eq('organization_id', orgId)
      .eq('channel_id', canal.id)
      .in('external_contact_id', chaves),
  ]);
  if (porContato.error || porChave.error) {
    return { status: 500, corpo: { error: 'Falha ao procurar conversa existente.' } };
  }
  const encontradas = new Map<string, { id: string; metadata: Metadata | null; external_contact_id: string }>();
  for (const c of [...(porContato.data ?? []), ...(porChave.data ?? [])]) encontradas.set(c.id, c);
  const lista = [...encontradas.values()];

  let reaproveitar: (typeof lista)[number] | null = null;
  if (lista.length === 1 && lista[0].metadata?.inicio_falhou === true) {
    const n = await contarMensagens(db, lista[0].id);
    if (n === 0) reaproveitar = lista[0];
  }
  if (lista.length > 0 && !reaproveitar) {
    const existente = lista.find((c) => c.metadata?.inicio_falhou !== true) ?? lista[0];
    await registrar(db, {
      acao: ACAO_INICIAR, orgId, userId, conversationId: existente.id,
      resultado: 'ja_tem_conversa', detalhes: base,
    });
    return { status: 409, corpo: { error: 'Este lead já tem conversa.', conversationId: existente.id } };
  }

  // ---- 4. Teto do dia (AC3) ---------------------------------------------------
  let usadas: number;
  try {
    usadas = await contarIniciadasHoje(db, orgId);
  } catch {
    return { status: 500, corpo: { error: 'Falha ao conferir o limite do dia.' } };
  }
  if (usadas >= LIMITE_DIARIO) {
    await registrar(db, {
      acao: ACAO_INICIAR, orgId, userId, resultado: 'limite_diario', severidade: 'warning', detalhes: base,
    });
    return { status: 429, corpo: { error: TEXTO_LIMITE_ATINGIDO, usadasHoje: usadas, limite: LIMITE_DIARIO } };
  }

  // ---- 5. Pré-grava (ou reaproveita) a conversa -------------------------------
  const iniciadaEm = new Date(agoraMs()).toISOString();
  let conversationId: string;
  let metadataGravado: Metadata;

  if (reaproveitar) {
    const anterior = { ...(reaproveitar.metadata ?? {}) };
    for (const k of ['inicio_falhou', 'inicio_falhou_em', 'humano_falhou', 'humano_confirmado_em', 'assumido_em']) {
      delete anterior[k];
    }
    metadataGravado = {
      ...anterior,
      iniciada_pelo_crm: true,
      iniciada_por: userId,
      iniciada_em: iniciadaEm,
      humano_pedido: true,
    };
    // UPDATE condicional: só quem recebe a linha de volta dispara (C2).
    const { data, error } = await db
      .from('messaging_conversations')
      .update({ metadata: metadataGravado, assigned_user_id: userId, assigned_at: iniciadaEm })
      .eq('id', reaproveitar.id)
      .eq('organization_id', orgId)
      .eq('metadata->>inicio_falhou', 'true')
      .select('id');
    if (error) return { status: 500, corpo: { error: 'Falha ao preparar a conversa.' } };
    if (!data || data.length === 0) {
      return { status: 409, corpo: { error: 'Este lead já tem conversa.', conversationId: reaproveitar.id } };
    }
    conversationId = reaproveitar.id;
  } else {
    const linha = montarLinhaDaConversa({
      orgId, canal, chave: chaves[0], digitos,
      contato: { id: contato.id, name: contato.name ?? null }, userId, iniciadaEm,
    });
    metadataGravado = linha.metadata as Metadata;
    const { data, error } = await db.from('messaging_conversations').insert(linha).select('id').single();
    if (error || !data) {
      if (ehDuplicada(error)) {
        // Outra conversa ganhou a corrida: abre a dela, sem disparo.
        const { data: vencedora } = await db
          .from('messaging_conversations')
          .select('id')
          .eq('organization_id', orgId)
          .eq('channel_id', canal.id)
          .in('external_contact_id', chaves)
          .limit(1)
          .maybeSingle();
        return { status: 409, corpo: { error: 'Este lead já tem conversa.', conversationId: vencedora?.id ?? null } };
      }
      return { status: 500, corpo: { error: 'Falha ao preparar a conversa.' } };
    }
    conversationId = data.id as string;
  }

  // ---- 6. Áudio: sobe DEPOIS do INSERT (V16) ----------------------------------
  let caminhoDoAudio: string | null = null;
  let conteudoDoEnvio: SendMessageParams['content'];
  if (conteudo.tipo === 'audio') {
    caminhoDoAudio = `${orgId}/${conversationId}/${novoId()}.${conteudo.extensao}`;
    const bytes = Buffer.from(await conteudo.arquivo.arrayBuffer());
    const { error: upErr } = await db.storage
      .from(BUCKET_DE_MIDIA)
      .upload(caminhoDoAudio, bytes, { contentType: conteudo.mime, upsert: false });
    if (upErr) {
      console.error('[iniciar-conversa] falha ao subir o áudio:', upErr.message);
      const desfeito = await desfazer(db, orgId, conversationId, metadataGravado, null);
      await registrar(db, {
        acao: ACAO_INICIAR, orgId, userId, conversationId, resultado: desfeito === 'erro_sem_desfazer' ? 'erro_sem_desfazer' : 'erro_envio',
        severidade: 'error', detalhes: { ...base, etapa: 'upload_audio', desfeito },
      });
      return { status: 502, corpo: { error: 'Não foi possível iniciar a conversa: falha ao guardar o áudio' } };
    }
    const { data: pub } = db.storage.from(BUCKET_DE_MIDIA).getPublicUrl(caminhoDoAudio);
    conteudoDoEnvio = {
      type: 'audio',
      mediaUrl: pub.publicUrl,
      mimeType: conteudo.mime,
      fileSize: conteudo.arquivo.size,
    };
  } else {
    conteudoDoEnvio = { type: 'text', text: conteudo.texto };
  }

  // ---- 7. Dispara (telefone ⇒ `start-conversation`) ---------------------------
  let resultado: SendMessageResult;
  try {
    const provedor = await args.criarProvedor(canal);
    resultado = await provedor.sendMessage({ conversationId, to: digitos, content: conteudoDoEnvio });
  } catch (e) {
    resultado = {
      success: false,
      error: { code: 'EXCEPTION', message: e instanceof Error ? e.message : 'erro', retryable: false },
    };
  }

  if (!resultado.success) {
    const erroTecnico = resultado.error?.message ?? 'erro desconhecido';
    console.error('[iniciar-conversa] envio falhou:', erroTecnico);
    const desfeito = await desfazer(db, orgId, conversationId, metadataGravado, caminhoDoAudio);

    if (desfeito !== 'mensagem_saiu') {
      await registrar(db, {
        acao: ACAO_INICIAR, orgId, userId, conversationId,
        resultado: desfeito === 'erro_sem_desfazer' ? 'erro_sem_desfazer' : 'erro_envio',
        severidade: 'error',
        detalhes: { ...base, tipo: conteudo.tipo, desfeito, erro: motivoResumido(erroTecnico) },
      });
      return { status: 502, corpo: { error: `Não foi possível iniciar a conversa: ${motivoResumido(erroTecnico)}` } };
    }
    // O eco chegou apesar do erro: a mensagem saiu ⇒ segue como sucesso (AC4.3).
  }

  await registrar(db, {
    acao: ACAO_INICIAR, orgId, userId, conversationId, resultado: 'sucesso',
    detalhes: { ...base, tipo: conteudo.tipo, ...(resultado.success ? {} : { erro_do_fornecedor_com_eco: true }) },
  });

  return {
    status: 200,
    corpo: { conversationId, usadasHoje: usadas + 1, limite: LIMITE_DIARIO },
    confirmarHumano: { conversationId, canal },
  };
}

// =============================================================================
// Passar para o humano (AC4.5 e AC4.6)
// =============================================================================

/** Um ciclo: relê a chave (a 2.63 pode ter alinhado), `startHuman`, lê o chat. */
async function umCiclo(
  db: SupabaseClient,
  provedor: ProvedorDeInicio,
  orgId: string,
  conversationId: string
): Promise<boolean> {
  const { data: conv } = await db
    .from('messaging_conversations')
    .select('external_contact_id')
    .eq('id', conversationId)
    .eq('organization_id', orgId)
    .maybeSingle();
  const chatId = conv?.external_contact_id as string | undefined;
  if (!chatId || !chatId.includes('-')) return false;

  const inicio = await provedor.startHuman(chatId);
  if (!inicio.success) return false;

  const telefone = chatId.slice(chatId.indexOf('-') + 1);
  const lido = await provedor.lerChatHumano(telefone, chatId);
  return lido.achou && lido.humanTalk;
}

/** Relê o metadata e grava a mesclagem (nunca sobrescreve o que o webhook pôs). */
async function mesclarMetadata(
  db: SupabaseClient,
  orgId: string,
  conversationId: string,
  mudar: (m: Metadata) => Metadata
): Promise<boolean> {
  const { data } = await db
    .from('messaging_conversations')
    .select('metadata')
    .eq('id', conversationId)
    .eq('organization_id', orgId)
    .maybeSingle();
  if (!data) return false;
  const { error } = await db
    .from('messaging_conversations')
    .update({ metadata: mudar({ ...((data.metadata as Metadata) ?? {}) }) })
    .eq('id', conversationId)
    .eq('organization_id', orgId);
  return !error;
}

/** AC4.5 — roda em `after()`, com o relógio da requisição (`inicioMs`). */
export async function confirmarHumano(args: {
  db: SupabaseClient;
  orgId: string;
  userId: string;
  conversationId: string;
  canal: CanalDoInicio;
  criarProvedor: CriarProvedor;
  inicioMs: number;
}): Promise<{ confirmado: boolean; ciclos: number }> {
  const { db, orgId, conversationId } = args;
  let provedor: ProvedorDeInicio | null = null;
  try {
    provedor = await args.criarProvedor(args.canal);
  } catch (e) {
    console.error('[iniciar-conversa] provider indisponível:', e instanceof Error ? e.message : e);
  }

  const r = provedor
    ? await tentarAteConfirmar({
        inicioMs: args.inicioMs,
        agoraMs,
        esperar,
        tentar: () => umCiclo(db, provedor!, orgId, conversationId),
      })
    : { confirmado: false, ciclos: 0 };

  const quando = new Date(agoraMs()).toISOString();
  await mesclarMetadata(db, orgId, conversationId, (m) => {
    if (r.confirmado) {
      delete m.humano_falhou;
      return { ...m, humano_confirmado_em: quando };
    }
    return { ...m, humano_falhou: true };
  });

  await registrar(db, {
    acao: ACAO_HUMANO, orgId, userId: args.userId, conversationId,
    resultado: r.confirmado ? 'confirmado' : 'humano_falhou',
    severidade: r.confirmado ? 'info' : 'warning',
    detalhes: { ciclos: r.ciclos },
  });
  return r;
}

/** AC4.6 — botão "Assumir conversa": UM ciclo dentro da requisição. */
export async function assumirConversa(args: {
  db: SupabaseClient;
  orgId: string;
  userId: string;
  conversationId: string;
  criarProvedor: CriarProvedor;
}): Promise<RespostaDoServico> {
  const { db, orgId, userId, conversationId } = args;

  const { data: conv, error } = await db
    .from('messaging_conversations')
    .select('id, channel_id, metadata')
    .eq('id', conversationId)
    .eq('organization_id', orgId)
    .maybeSingle();
  if (error) return { status: 500, corpo: { error: 'Falha ao ler a conversa.' } };
  if (!conv) return { status: 404, corpo: { error: 'Conversa não encontrada.' } };
  if ((conv.metadata as Metadata | null)?.iniciada_pelo_crm !== true) {
    return { status: 422, corpo: { error: 'Só vale para conversa iniciada pelo CRM.' } };
  }

  const { data: canal } = await db
    .from('messaging_channels')
    .select('id, organization_id, business_unit_id, provider, channel_type, external_identifier, credentials')
    .eq('id', conv.channel_id)
    .eq('organization_id', orgId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!canal || canal.provider !== 'gptmaker') {
    return { status: 422, corpo: { error: 'Canal de WhatsApp indisponível.' } };
  }

  // `assumido_em` a cada clique: é o marco da janela do AC4.7.
  const assumidoEm = new Date(agoraMs()).toISOString();
  await mesclarMetadata(db, orgId, conversationId, (m) => ({ ...m, assumido_em: assumidoEm }));

  let confirmado = false;
  try {
    const provedor = await args.criarProvedor(canal as CanalDoInicio);
    confirmado = await umCiclo(db, provedor, orgId, conversationId);
  } catch (e) {
    console.error('[assumir-conversa] ciclo falhou:', e instanceof Error ? e.message : e);
  }

  if (confirmado) {
    const quando = new Date(agoraMs()).toISOString();
    await mesclarMetadata(db, orgId, conversationId, (m) => {
      delete m.humano_falhou;
      return { ...m, humano_confirmado_em: quando };
    });
  }

  await registrar(db, {
    acao: ACAO_ASSUMIR, orgId, userId, conversationId,
    resultado: confirmado ? 'confirmado' : 'nao_confirmado',
    severidade: confirmado ? 'info' : 'warning',
  });

  return { status: 200, corpo: { confirmado } };
}
