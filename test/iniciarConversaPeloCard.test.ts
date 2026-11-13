// @vitest-environment node
/**
 * Story 2.52 — "O lead que chegou sem conversa" (AC3, AC4, AC5, AC7, AC9).
 *
 * A rota roda de verdade contra o Supabase em memória (`test/helpers/fakeSupabase`),
 * que guarda as linhas e aplica a chave única da conversa. Os testes RELEEM o
 * estado e afirmam VALORES (Rule 7), não existência.
 *
 * Mockados: o provider (nenhuma chamada externa), o `after()` do Next (capturado
 * para rodar na mão) e o relógio (virtual, para o laço do AC4.5 não esperar 55 s).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSupabase } from './helpers/fakeSupabase';

// ---------------------------------------------------------------------------
// Estado compartilhado com os mocks
// ---------------------------------------------------------------------------
const h = vi.hoisted(() => ({
  user: null as { id: string } | null,
  db: null as unknown,
  depois: [] as Array<() => Promise<void>>,
  relogio: { t: 0 },
  prov: {
    initialize: null as unknown as (...a: unknown[]) => unknown,
    sendMessage: null as unknown as (...a: unknown[]) => unknown,
    startHuman: null as unknown as (...a: unknown[]) => unknown,
    lerChatHumano: null as unknown as (...a: unknown[]) => unknown,
  },
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user }, error: null }) },
    from: (t: string) => (h.db as FakeSupabase).from(t),
  }),
}));

vi.mock('@/lib/supabase/staticAdminClient', () => ({
  createStaticAdminClient: () => h.db,
}));

vi.mock('next/server', async (importOriginal) => {
  const real = await importOriginal<typeof import('next/server')>();
  return { ...real, after: (fn: () => Promise<void>) => h.depois.push(fn) };
});

vi.mock('@/lib/messaging/iniciar-conversa/relogio', () => ({
  agoraMs: () => h.relogio.t,
  esperar: async (ms: number) => {
    h.relogio.t += ms;
  },
}));

vi.mock('@/lib/messaging/providers/whatsapp/gptmaker.provider', () => ({
  GptMakerWhatsAppProvider: class {
    initialize = (...a: unknown[]) => h.prov.initialize(...a);
    sendMessage = (...a: unknown[]) => h.prov.sendMessage(...a);
    startHuman = (...a: unknown[]) => h.prov.startHuman(...a);
    lerChatHumano = (...a: unknown[]) => h.prov.lerChatHumano(...a);
  },
}));

import { GET, POST } from '@/app/api/messaging/conversations/start/route';
import { POST as ASSUMIR } from '@/app/api/messaging/conversations/[id]/assumir/route';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const ORG = '0b5c3f9e-1111-4111-8111-000000000001';
const OUTRA_ORG = '0b5c3f9e-1111-4111-8111-000000000002';
const USER = 'a0000000-0000-4000-8000-00000000000a';
const DEAL = 'd0000000-0000-4000-8000-00000000000d';
const DEAL_OUTRA_ORG = 'd0000000-0000-4000-8000-0000000000ff';
const CONTATO = 'c0000000-0000-4000-8000-00000000000c';
const CANAL = 'e0000000-0000-4000-8000-00000000000e';
const BOARD = 'b0000000-0000-4000-8000-00000000000b';
const STAGE_LEAD_NOVO = 'f0000000-0000-4000-8000-000000000001';
const UNIDADE_DO_CANAL = '90000000-0000-4000-8000-000000000001';
const UNIDADE_DO_QUADRO = '90000000-0000-4000-8000-000000000002';
const CANAL_FORNECEDOR = '3E14B10711E1C0FE16B42EC236EAE1D6';
const CHAVE = `${CANAL_FORNECEDOR}-5512997534278`;
const CHAVE_SEM_NOVE = `${CANAL_FORNECEDOR}-551297534278`;
const HOJE = Date.parse('2026-11-13T15:00:00Z'); // 12:00 em Brasília

interface Arquivo {
  caminho: string;
  conversaJaExistia: boolean;
  contentType: string;
}

function montarBanco() {
  const db = new FakeSupabase();
  db.tabelas.profiles = [{ id: USER, organization_id: ORG }];
  db.tabelas.boards = [{ id: BOARD, organization_id: ORG, business_unit_id: UNIDADE_DO_QUADRO }];
  db.tabelas.deals = [
    { id: DEAL, organization_id: ORG, contact_id: CONTATO, board_id: BOARD, stage_id: STAGE_LEAD_NOVO, deleted_at: null },
    { id: DEAL_OUTRA_ORG, organization_id: OUTRA_ORG, contact_id: CONTATO, board_id: BOARD, stage_id: STAGE_LEAD_NOVO, deleted_at: null },
  ];
  db.tabelas.contacts = [
    { id: CONTATO, organization_id: ORG, name: 'Maria Souza', phone: '+5512997534278', deleted_at: null },
  ];
  db.tabelas.messaging_channels = [
    {
      id: CANAL,
      organization_id: ORG,
      business_unit_id: UNIDADE_DO_CANAL,
      provider: 'gptmaker',
      channel_type: 'whatsapp',
      status: 'connected',
      deleted_at: null,
      external_identifier: 'acreditando',
      credentials: { gptmakerChannelId: CANAL_FORNECEDOR, apiToken: 't', workspaceId: 'ws', agentId: 'ag' },
    },
  ];
  db.tabelas.messaging_conversations = [];
  db.tabelas.messaging_messages = [];
  db.tabelas.audit_logs = [];
  db.tabelas.webhook_events_out = [];

  const arquivos = new Map<string, Arquivo>();
  const falhas = { upload: false };
  const storage = {
    from: (bucket: string) => ({
      upload: async (caminho: string, _bytes: unknown, opts: { contentType: string }) => {
        if (falhas.upload) return { data: null, error: { message: 'storage fora' } };
        const convId = caminho.split('/')[1];
        arquivos.set(`${bucket}/${caminho}`, {
          caminho,
          conversaJaExistia: db.tabelas.messaging_conversations.some((c) => c.id === convId),
          contentType: opts.contentType,
        });
        return { data: { path: caminho }, error: null };
      },
      remove: async (caminhos: string[]) => {
        for (const c of caminhos) arquivos.delete(`${bucket}/${c}`);
        return { data: null, error: null };
      },
      getPublicUrl: (caminho: string) => ({
        data: { publicUrl: `https://projeto.supabase.co/storage/v1/object/public/${bucket}/${caminho}` },
      }),
    }),
  };
  Object.assign(db, { storage });
  return { db, arquivos, falhas };
}

let banco: ReturnType<typeof montarBanco>;

function pedirJson(body: unknown): Request {
  return new Request('http://localhost/api/messaging/conversations/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function pedirAudio(campos: { dealId?: string; text?: string; audio?: File }): Request {
  const form = new FormData();
  if (campos.dealId) form.set('dealId', campos.dealId);
  if (campos.text !== undefined) form.set('text', campos.text);
  if (campos.audio) form.set('audio', campos.audio);
  return new Request('http://localhost/api/messaging/conversations/start', { method: 'POST', body: form });
}

function mp3(bytes = 2048, tipo = 'audio/mpeg'): File {
  return new File([new Uint8Array(bytes)], 'gravacao.mp3', { type: tipo });
}

const conversas = () => banco.db.tabelas.messaging_conversations;
const logs = (resultado?: string) =>
  banco.db.tabelas.audit_logs.filter((l) => !resultado || l.details?.resultado === resultado);

async function rodarDepois() {
  const fila = h.depois.splice(0);
  for (const fn of fila) await fn();
}

beforeEach(() => {
  banco = montarBanco();
  h.db = banco.db;
  h.user = { id: USER };
  h.depois = [];
  h.relogio.t = HOJE;
  h.prov.initialize = vi.fn(async () => undefined);
  h.prov.sendMessage = vi.fn(async () => ({ success: true, externalMessageId: 'x', status: 'sent' }));
  h.prov.startHuman = vi.fn(async () => ({ success: true }));
  h.prov.lerChatHumano = vi.fn(async () => ({ achou: true, humanTalk: true }));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

// ===========================================================================
// AC3 — autenticação, organização e o que a rota aceita
// ===========================================================================
describe('AC3 — a rota é autenticada e não confia no cliente', () => {
  it('sem login ⇒ 401, nada gravado e o fornecedor não é chamado', async () => {
    h.user = null;
    const res = await POST(pedirJson({ dealId: DEAL, text: 'Olá' }));
    expect(res.status).toBe(401);
    expect(conversas()).toHaveLength(0);
    expect(h.prov.sendMessage).not.toHaveBeenCalled();
  });

  it('card de outra organização ⇒ 404', async () => {
    const res = await POST(pedirJson({ dealId: DEAL_OUTRA_ORG, text: 'Olá' }));
    expect(res.status).toBe(404);
    expect(conversas()).toHaveLength(0);
    expect(h.prov.sendMessage).not.toHaveBeenCalled();
  });

  it('telefone mandado no corpo é ignorado: sai para o telefone do contato no banco', async () => {
    const res = await POST(pedirJson({ dealId: DEAL, text: 'Olá', phone: '5511900000000', to: '5511900000000' }));
    expect(res.status).toBe(200);
    expect(h.prov.sendMessage).toHaveBeenCalledTimes(1);
    expect((h.prov.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0].to).toBe('5512997534278');
  });

  it.each([
    ['sem texto e sem áudio', () => pedirJson({ dealId: DEAL })],
    ['texto só com espaços', () => pedirJson({ dealId: DEAL, text: '   ' })],
    ['texto com 4.001 caracteres', () => pedirJson({ dealId: DEAL, text: 'a'.repeat(4001) })],
    ['texto e áudio juntos', () => pedirAudio({ dealId: DEAL, text: 'oi', audio: mp3() })],
    ['áudio audio/webm', () => pedirAudio({ dealId: DEAL, audio: mp3(100, 'audio/webm') })],
    ['áudio de tipo fora da lista', () => pedirAudio({ dealId: DEAL, audio: mp3(100, 'video/mp4') })],
    ['áudio acima de 4 MB', () => pedirAudio({ dealId: DEAL, audio: mp3(4 * 1024 * 1024 + 1) })],
  ])('%s ⇒ 422 sem gravar nada', async (_nome, pedir) => {
    const res = await POST(pedir());
    expect(res.status).toBe(422);
    expect(conversas()).toHaveLength(0);
    expect(banco.arquivos.size).toBe(0);
    expect(h.prov.sendMessage).not.toHaveBeenCalled();
  });

  it('contato sem telefone ⇒ 422 "Contato sem telefone", sem chamar o fornecedor (AC2)', async () => {
    banco.db.tabelas.contacts[0].phone = null;
    const res = await POST(pedirJson({ dealId: DEAL, text: 'Olá' }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('Contato sem telefone');
    expect(h.prov.sendMessage).not.toHaveBeenCalled();
  });

  it('telefone fora de 12–13 dígitos ⇒ 422 sem chamada (AC5)', async () => {
    banco.db.tabelas.contacts[0].phone = '+1 415 555 2671';
    const res = await POST(pedirJson({ dealId: DEAL, text: 'Olá' }));
    expect(res.status).toBe(422);
    expect(h.prov.sendMessage).not.toHaveBeenCalled();
    expect(banco.db.tabelas.contacts[0].phone).toBe('+1 415 555 2671'); // nunca alterado
  });
});

// ===========================================================================
// AC3 — "já tem conversa" e o reaproveitamento (C2)
// ===========================================================================
describe('AC3 — conversa existente', () => {
  it('contato com conversa ⇒ 409 com o conversationId, sem chamar o fornecedor', async () => {
    banco.db.tabelas.messaging_conversations.push({
      id: 'conv-antiga', organization_id: ORG, channel_id: CANAL, contact_id: CONTATO,
      external_contact_id: CHAVE, metadata: {},
    });
    const res = await POST(pedirJson({ dealId: DEAL, text: 'Olá' }));
    expect(res.status).toBe(409);
    expect((await res.json()).conversationId).toBe('conv-antiga');
    expect(h.prov.sendMessage).not.toHaveBeenCalled();
    expect(conversas()).toHaveLength(1);
  });

  it('conversa na OUTRA forma do telefone (sem o 9º) e sem contato ⇒ 409 sem disparo', async () => {
    banco.db.tabelas.messaging_conversations.push({
      id: 'conv-12', organization_id: ORG, channel_id: CANAL, contact_id: null,
      external_contact_id: CHAVE_SEM_NOVE, metadata: {},
    });
    const res = await POST(pedirJson({ dealId: DEAL, text: 'Olá' }));
    expect(res.status).toBe(409);
    expect((await res.json()).conversationId).toBe('conv-12');
    expect(h.prov.sendMessage).not.toHaveBeenCalled();
  });

  it('conversa com inicio_falhou E mensagens ⇒ 409 normal, sem disparo', async () => {
    banco.db.tabelas.messaging_conversations.push({
      id: 'conv-real', organization_id: ORG, channel_id: CANAL, contact_id: CONTATO,
      external_contact_id: CHAVE, metadata: { inicio_falhou: true },
    });
    banco.db.tabelas.messaging_messages.push({ id: 'm1', conversation_id: 'conv-real' });
    const res = await POST(pedirJson({ dealId: DEAL, text: 'Olá' }));
    expect(res.status).toBe(409);
    expect(h.prov.sendMessage).not.toHaveBeenCalled();
  });

  it('clique seguinte com conversa inicio_falhou e 0 mensagens ⇒ reaproveita: mesma conversa, 1 disparo, marca removida', async () => {
    banco.db.tabelas.messaging_conversations.push({
      id: 'conv-falhou', organization_id: ORG, channel_id: CANAL, contact_id: CONTATO,
      business_unit_id: UNIDADE_DO_CANAL, external_contact_id: CHAVE,
      metadata: { gptmaker_chat_id: CHAVE, inicio_falhou: true, inicio_falhou_em: 'ontem', iniciada_por: 'outra' },
    });
    const res = await POST(pedirJson({ dealId: DEAL, text: 'Olá de novo' }));
    expect(res.status).toBe(200);
    expect((await res.json()).conversationId).toBe('conv-falhou');
    expect(h.prov.sendMessage).toHaveBeenCalledTimes(1);
    expect(conversas()).toHaveLength(1);
    const meta = conversas()[0].metadata;
    expect(meta.inicio_falhou).toBeUndefined();
    expect(meta.inicio_falhou_em).toBeUndefined();
    expect(meta.iniciada_por).toBe(USER);
    expect(meta.iniciada_em).toBe(new Date(HOJE).toISOString());
    expect(meta.humano_pedido).toBe(true);
    expect(conversas()[0].assigned_user_id).toBe(USER);
  });

  it('dois reaproveitamentos simultâneos ⇒ um dispara, o outro 409', async () => {
    banco.db.tabelas.messaging_conversations.push({
      id: 'conv-falhou', organization_id: ORG, channel_id: CANAL, contact_id: CONTATO,
      external_contact_id: CHAVE, metadata: { inicio_falhou: true },
    });
    const [a, b] = await Promise.all([
      POST(pedirJson({ dealId: DEAL, text: 'um' })),
      POST(pedirJson({ dealId: DEAL, text: 'dois' })),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(h.prov.sendMessage).toHaveBeenCalledTimes(1);
    expect(conversas()).toHaveLength(1);
  });
});

// ===========================================================================
// AC4 — a conversa nasce no CRM antes do disparo, com os valores do webhook
// ===========================================================================
describe('AC4.1 — a conversa pré-gravada', () => {
  it('sucesso ⇒ a linha leva exatamente as colunas do webhook, com a unidade do CANAL', async () => {
    let linhaNoMomentoDoEnvio: Record<string, unknown> | undefined;
    h.prov.sendMessage = vi.fn(async () => {
      linhaNoMomentoDoEnvio = { ...conversas()[0] };
      return { success: true, externalMessageId: 'x', status: 'sent' };
    });

    const res = await POST(pedirJson({ dealId: DEAL, text: 'Olá, Maria!' }));
    expect(res.status).toBe(200);
    const corpo = await res.json();

    // Pré-gravada ANTES do disparo.
    expect(linhaNoMomentoDoEnvio?.id).toBe(corpo.conversationId);

    expect(conversas()).toHaveLength(1);
    const c = conversas()[0];
    expect(c.organization_id).toBe(ORG);
    expect(c.channel_id).toBe(CANAL);
    expect(c.business_unit_id).toBe(UNIDADE_DO_CANAL);
    expect(c.business_unit_id).not.toBe(UNIDADE_DO_QUADRO);
    expect(c.external_contact_id).toBe(CHAVE);
    expect(c.external_contact_name).toBe('Maria Souza');
    expect(c.contact_id).toBe(CONTATO);
    expect(c.status).toBe('open');
    expect(c.priority).toBe('normal');
    expect(c.assigned_user_id).toBe(USER);
    expect(c.metadata).toEqual({
      gptmaker_chat_id: CHAVE,
      gptmaker_phone: '+5512997534278',
      source: 'gptmaker',
      ai_paused: true,
      iniciada_pelo_crm: true,
      iniciada_por: USER,
      iniciada_em: new Date(HOJE).toISOString(),
      humano_pedido: true,
    });
  });

  it('contato sem nome ⇒ external_contact_name é o telefone (mesma regra do webhook)', async () => {
    banco.db.tabelas.contacts[0].name = null;
    await POST(pedirJson({ dealId: DEAL, text: 'Olá' }));
    expect(conversas()[0].external_contact_name).toBe('+5512997534278');
  });

  it('texto ⇒ o fornecedor recebe exatamente o texto digitado, para o telefone do contato', async () => {
    const texto = 'Olá, Maria! Recebemos seu contato — ação e atenção.';
    await POST(pedirJson({ dealId: DEAL, text: texto }));
    expect(h.prov.sendMessage).toHaveBeenCalledTimes(1);
    const [params] = (h.prov.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(params.to).toBe('5512997534278');
    expect(params.content).toEqual({ type: 'text', text: texto });
  });

  it('a rota NÃO grava a mensagem enviada (ela chega pelo eco) e o card não muda de etapa (AC4.4)', async () => {
    await POST(pedirJson({ dealId: DEAL, text: 'Olá' }));
    await rodarDepois();
    expect(banco.db.tabelas.messaging_messages).toHaveLength(0);
    expect(banco.db.tabelas.deals.find((d) => d.id === DEAL)?.stage_id).toBe(STAGE_LEAD_NOVO);
    const tabelasEscritas = new Set(banco.db.escritas.map((e) => e.tabela));
    expect(tabelasEscritas.has('deals')).toBe(false);
    expect(tabelasEscritas.has('contacts')).toBe(false);
    expect(tabelasEscritas.has('webhook_events_out')).toBe(false);
    expect(tabelasEscritas.has('messaging_messages')).toBe(false);
  });
});

describe('AC4 — áudio', () => {
  it('áudio ⇒ arquivo gravado em <org>/<conversa>/… DEPOIS do INSERT e o fornecedor recebe a URL dele', async () => {
    const res = await POST(pedirAudio({ dealId: DEAL, audio: mp3() }));
    expect(res.status).toBe(200);
    const { conversationId } = await res.json();

    expect(banco.arquivos.size).toBe(1);
    const [arquivo] = [...banco.arquivos.values()];
    expect(arquivo.caminho).toMatch(new RegExp(`^${ORG}/${conversationId}/[0-9a-f-]+\\.mp3$`));
    expect(arquivo.conversaJaExistia).toBe(true);
    expect(arquivo.contentType).toBe('audio/mpeg');

    const [params] = (h.prov.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(params.content.type).toBe('audio');
    expect(params.content.mediaUrl).toBe(
      `https://projeto.supabase.co/storage/v1/object/public/messaging-media/${arquivo.caminho}`
    );
  });

  it('falha no envio de áudio ⇒ conversa E arquivo apagados', async () => {
    h.prov.sendMessage = vi.fn(async () => ({
      success: false, error: { code: 'GPTMAKER_ERROR', message: 'GPT Maker API request failed: 400 x', retryable: false },
    }));
    const res = await POST(pedirAudio({ dealId: DEAL, audio: mp3() }));
    expect(res.status).toBe(502);
    expect(conversas()).toHaveLength(0);
    expect(banco.arquivos.size).toBe(0);
  });

  it('falha ao subir o áudio ⇒ conversa apagada e o fornecedor nem é chamado', async () => {
    banco.falhas.upload = true;
    const res = await POST(pedirAudio({ dealId: DEAL, audio: mp3() }));
    expect(res.status).toBe(502);
    expect(conversas()).toHaveLength(0);
    expect(h.prov.sendMessage).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// AC4.3 — falha no disparo desfaz
// ===========================================================================
describe('AC4.3 — falha no disparo', () => {
  const falhar = () =>
    vi.fn(async () => ({
      success: false,
      error: { code: 'GPTMAKER_ERROR', message: 'GPT Maker API request failed: 400 {"error":"malformed"}', retryable: false },
    }));

  it('fornecedor falha ⇒ 0 conversas, log de erro, e o toast não cita o fornecedor', async () => {
    h.prov.sendMessage = falhar();
    const res = await POST(pedirJson({ dealId: DEAL, text: 'Olá' }));
    expect(res.status).toBe(502);
    const { error } = await res.json();
    expect(error).toBe('Não foi possível iniciar a conversa: o WhatsApp recusou o envio (código 400)');
    expect(error).not.toMatch(/gpt\s*maker/i);
    expect(conversas()).toHaveLength(0);
    expect(logs('sucesso')).toHaveLength(0);
    expect(logs('erro_envio')).toHaveLength(1);
    expect(h.depois).toHaveLength(0); // nenhum startHuman agendado
  });

  it('fornecedor falha E o DELETE falha ⇒ conversa fica com metadata.inicio_falhou = true', async () => {
    h.prov.sendMessage = falhar();
    banco.db.falharProxima('messaging_conversations', 'delete', { message: 'banco ocupado' });
    const res = await POST(pedirJson({ dealId: DEAL, text: 'Olá' }));
    expect(res.status).toBe(502);
    expect(conversas()).toHaveLength(1);
    expect(conversas()[0].metadata.inicio_falhou).toBe(true);
    expect(conversas()[0].metadata.inicio_falhou_em).toBe(new Date(HOJE).toISOString());
    expect(logs('erro_envio')).toHaveLength(1);
  });

  it('DELETE e UPDATE falham ⇒ registro erro_sem_desfazer com o conversationId', async () => {
    h.prov.sendMessage = falhar();
    banco.db.falharProxima('messaging_conversations', 'delete', { message: 'fora' });
    banco.db.falharProxima('messaging_conversations', 'update', { message: 'fora' });
    await POST(pedirJson({ dealId: DEAL, text: 'Olá' }));
    expect(logs('erro_sem_desfazer')).toHaveLength(1);
    expect(logs('erro_sem_desfazer')[0].resource_id).toBe(conversas()[0].id);
  });

  it('o eco chegou apesar do erro ⇒ não apaga nem marca: a conversa é real', async () => {
    h.prov.sendMessage = vi.fn(async (p: { conversationId: string }) => {
      banco.db.tabelas.messaging_messages.push({ id: 'eco', conversation_id: p.conversationId });
      return { success: false, error: { code: 'X', message: 'The operation was aborted', retryable: true } };
    });
    const res = await POST(pedirJson({ dealId: DEAL, text: 'Olá' }));
    expect(res.status).toBe(200);
    expect(conversas()).toHaveLength(1);
    expect(conversas()[0].metadata.inicio_falhou).toBeUndefined();
  });
});

// ===========================================================================
// AC3 — teto de 20 por dia
// ===========================================================================
describe('AC3 — teto de 20 conversas iniciadas por dia', () => {
  function semear(n: number, quando: number, resultado = 'sucesso') {
    for (let i = 0; i < n; i++) {
      banco.db.tabelas.audit_logs.push({
        id: `log-${resultado}-${quando}-${i}`, organization_id: ORG, action: 'whatsapp_conversa_iniciada',
        details: { resultado }, created_at: new Date(quando).toISOString(),
      });
    }
  }

  it('20 sucessos hoje ⇒ a 21ª é 429 com o texto da tela, sem chamar o fornecedor', async () => {
    semear(20, HOJE - 60_000);
    semear(3, HOJE - 60_000, 'erro_envio'); // erro não conta
    const res = await POST(pedirJson({ dealId: DEAL, text: 'Olá' }));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe('Limite de 20 conversas iniciadas hoje atingido. Tente amanhã.');
    expect(h.prov.sendMessage).not.toHaveBeenCalled();
    expect(conversas()).toHaveLength(0);
  });

  it('19 sucessos hoje ⇒ a 20ª passa e o contador vira 20', async () => {
    semear(19, HOJE - 60_000);
    const res = await POST(pedirJson({ dealId: DEAL, text: 'Olá' }));
    expect(res.status).toBe(200);
    expect((await res.json()).usadasHoje).toBe(20);
  });

  it('20 sucessos ONTEM (Brasília) ⇒ hoje libera', async () => {
    semear(20, Date.parse('2026-11-13T02:59:00Z')); // 23:59 de 12/11 em Brasília
    const res = await POST(pedirJson({ dealId: DEAL, text: 'Olá' }));
    expect(res.status).toBe(200);
  });

  it('no dia seguinte o mesmo teto libera', async () => {
    semear(20, HOJE - 60_000);
    expect((await POST(pedirJson({ dealId: DEAL, text: 'Olá' }))).status).toBe(429);
    h.relogio.t = Date.parse('2026-11-14T03:00:00Z'); // 00:00 de 14/11 em Brasília
    expect((await POST(pedirJson({ dealId: DEAL, text: 'Olá' }))).status).toBe(200);
  });

  it('GET devolve o contador do dia', async () => {
    semear(7, HOJE - 60_000);
    const res = await GET();
    expect(await res.json()).toEqual({ usadasHoje: 7, limite: 20 });
  });
});

// ===========================================================================
// AC7 — fica registrado quem disparou
// ===========================================================================
describe('AC7 — registro em audit_logs', () => {
  it('sucesso ⇒ usuário, card, contato, telefone MASCARADO e resultado', async () => {
    const res = await POST(pedirJson({ dealId: DEAL, text: 'Olá' }));
    const { conversationId } = await res.json();
    const [log] = logs('sucesso');
    expect(log.user_id).toBe(USER);
    expect(log.organization_id).toBe(ORG);
    expect(log.action).toBe('whatsapp_conversa_iniciada');
    expect(log.resource_id).toBe(conversationId);
    expect(log.details).toMatchObject({
      resultado: 'sucesso', deal_id: DEAL, contact_id: CONTATO, telefone: '5512*****4278', tipo: 'texto',
    });
    expect(JSON.stringify(banco.db.tabelas.audit_logs)).not.toContain('5512997534278');
  });
});

// ===========================================================================
// AC4.5 — passar para a Fernanda (startHuman + leitura) com prazo pelo relógio
// ===========================================================================
describe('AC4.5 — startHuman em after()', () => {
  it('confirma no 1º ciclo ⇒ humano_confirmado_em gravado, startHuman no chat da conversa', async () => {
    await POST(pedirJson({ dealId: DEAL, text: 'Olá' }));
    expect(h.depois).toHaveLength(1);
    await rodarDepois();
    expect(h.prov.startHuman).toHaveBeenCalledWith(CHAVE);
    expect(h.prov.lerChatHumano).toHaveBeenCalledWith('5512997534278', CHAVE);
    expect(conversas()[0].metadata.humano_confirmado_em).toBe(new Date(HOJE).toISOString());
    expect(conversas()[0].metadata.humano_falhou).toBeUndefined();
    expect(logs('confirmado')).toHaveLength(1);
  });

  it('startHuman falha nas 2 primeiras e funciona na 3ª ⇒ 3 chamadas e humano_confirmado_em', async () => {
    let n = 0;
    h.prov.startHuman = vi.fn(async () => {
      n++;
      return n < 3 ? { success: false, error: '500' } : { success: true };
    });
    await POST(pedirJson({ dealId: DEAL, text: 'Olá' }));
    await rodarDepois();
    expect(h.prov.startHuman).toHaveBeenCalledTimes(3);
    expect(conversas()[0].metadata.humano_confirmado_em).toBe(new Date(HOJE + 16_000).toISOString());
  });

  it('sempre falhando até o prazo ⇒ humano_falhou: true e registro no AC7', async () => {
    h.prov.lerChatHumano = vi.fn(async () => ({ achou: true, humanTalk: false }));
    await POST(pedirJson({ dealId: DEAL, text: 'Olá' }));
    await rodarDepois();
    expect(conversas()[0].metadata.humano_falhou).toBe(true);
    expect(conversas()[0].metadata.humano_confirmado_em).toBeUndefined();
    expect(logs('humano_falhou')).toHaveLength(1);
    expect(h.relogio.t - HOJE).toBeLessThanOrEqual(55_000);
  });

  it('chamadas lentas (15 s cada) ⇒ nenhum ciclo começa com gasto + 30 s > 55 s', async () => {
    const inicios: number[] = [];
    h.prov.startHuman = vi.fn(async () => {
      inicios.push(h.relogio.t - HOJE);
      h.relogio.t += 15_000;
      return { success: true };
    });
    h.prov.lerChatHumano = vi.fn(async () => {
      h.relogio.t += 15_000;
      return { achou: false, humanTalk: false };
    });
    await POST(pedirJson({ dealId: DEAL, text: 'Olá' }));
    await rodarDepois();
    expect(inicios).toEqual([0]);
    for (const t of inicios) expect(t + 30_000).toBeLessThanOrEqual(55_000);
    expect(conversas()[0].metadata.humano_falhou).toBe(true);
  });

  it('a chave alinhada pelo eco (2.63) é relida antes do ciclo', async () => {
    await POST(pedirJson({ dealId: DEAL, text: 'Olá' }));
    conversas()[0].external_contact_id = CHAVE_SEM_NOVE; // o eco alinhou para 12 dígitos
    await rodarDepois();
    expect(h.prov.startHuman).toHaveBeenCalledWith(CHAVE_SEM_NOVE);
    expect(h.prov.lerChatHumano).toHaveBeenCalledWith('551297534278', CHAVE_SEM_NOVE);
  });
});

// ===========================================================================
// AC4.6 — "Assumir conversa"
// ===========================================================================
describe('AC4.6 — POST /conversations/[id]/assumir', () => {
  const CONV = '70000000-0000-4000-8000-000000000007';
  const params = (id = CONV) => ({ params: Promise.resolve({ id }) });
  const pedir = () => new Request(`http://localhost/api/messaging/conversations/${CONV}/assumir`, { method: 'POST' });

  function semearConversa(meta: Record<string, unknown>, org = ORG) {
    banco.db.tabelas.messaging_conversations.push({
      id: CONV, organization_id: org, channel_id: CANAL, contact_id: CONTATO, external_contact_id: CHAVE, metadata: meta,
    });
  }

  it('sem login ⇒ 401', async () => {
    h.user = null;
    expect((await ASSUMIR(pedir(), params())).status).toBe(401);
  });

  it('conversa de outra organização ⇒ 404, sem chamar o fornecedor', async () => {
    semearConversa({ iniciada_pelo_crm: true }, OUTRA_ORG);
    expect((await ASSUMIR(pedir(), params())).status).toBe(404);
    expect(h.prov.startHuman).not.toHaveBeenCalled();
  });

  it('conversa que não foi iniciada pelo CRM ⇒ 422', async () => {
    semearConversa({});
    expect((await ASSUMIR(pedir(), params())).status).toBe(422);
    expect(h.prov.startHuman).not.toHaveBeenCalled();
  });

  it('confirmou ⇒ humano_confirmado_em gravado, humano_falhou removido, assumido_em gravado', async () => {
    semearConversa({ iniciada_pelo_crm: true, humano_pedido: true, humano_falhou: true });
    const res = await ASSUMIR(pedir(), params());
    expect(await res.json()).toEqual({ confirmado: true });
    const meta = conversas()[0].metadata;
    expect(meta.humano_confirmado_em).toBe(new Date(HOJE).toISOString());
    expect(meta.humano_falhou).toBeUndefined();
    expect(meta.assumido_em).toBe(new Date(HOJE).toISOString());
    expect(logs('confirmado')[0].action).toBe('whatsapp_conversa_assumir');
  });

  it('não confirmou ⇒ nada gravado como sucesso (só o assumido_em do clique)', async () => {
    semearConversa({ iniciada_pelo_crm: true, humano_pedido: true, humano_falhou: true });
    h.prov.lerChatHumano = vi.fn(async () => ({ achou: true, humanTalk: false }));
    const res = await ASSUMIR(pedir(), params());
    expect(await res.json()).toEqual({ confirmado: false });
    const meta = conversas()[0].metadata;
    expect(meta.humano_confirmado_em).toBeUndefined();
    expect(meta.humano_falhou).toBe(true);
    expect(meta.assumido_em).toBe(new Date(HOJE).toISOString());
    expect(logs('nao_confirmado')).toHaveLength(1);
  });
});
