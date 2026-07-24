/**
 * Testes do parser de webhook do GPT Maker.
 *
 * ⚠️ As fixtures abaixo são **payloads REAIS**, capturados em produção em
 * 2026-07-24 na conta do Acreditando (`messaging_webhook_events`). O fornecedor
 * não documenta o corpo dos webhooks — esta é a única fonte de verdade.
 *
 * Anonimizados apenas nos identificadores; a ESTRUTURA é exatamente a recebida.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeEvent,
  normalizePhone,
  classifyEvent,
  generateStableEventId,
  timingSafeEqual,
  getSecretFromRequest,
  recipientFromContextId,
} from './parser';

// =============================================================================
// FIXTURES REAIS
// =============================================================================

/** Mensagem com imagem, enviada pela IA do GPT Maker. */
const REAL_MESSAGE_ASSISTANT = {
  date: '2026-07-24T17:22:53.572+00:00',
  role: 'assistant',
  audios: [],
  images: ['https://gpt-files.com/file/3E14B10711E1C0FE16B42EC236EAE1D6/3F69B238F978E068'],
  channel: 'WHATSAPP',
  message: '',
  contextId: '3E14B10711E1C0FE16B42EC236EAE1D6-27870562914352@lid',
  documents: [],
  messageId: '3F69B23A3F8D70BFB461DA78A3C64868',
  assistantId: '3E12E22DF12D30FBB326262F356E288B',
  contactName: '27870562914352@lid',
  contactPhone: '27870562914352@lid',
};

/** Mensagem de texto do lead, com telefone real no contextId. */
const REAL_MESSAGE_USER = {
  date: '2026-07-24T17:20:11.100+00:00',
  role: 'user',
  audios: [],
  images: [],
  channel: 'WHATSAPP',
  message: 'Tive um AVC há 3 meses, vocês atendem?',
  contextId: '3E14B10711E1C0FE16B42EC236EAE1D6-553598205552',
  documents: [],
  messageId: '3F69B111AAAA2222BBBB3333CCCC4444',
  assistantId: '3E12E22DF12D30FBB326262F356E288B',
  contactName: 'Nathália de Almeida',
  contactPhone: '553598205552',
};

/** Início de atendimento — não carrega mensagem. */
const REAL_INTERACTION = {
  name: '27870562914352@lid',
  agentId: '3E12E22DF12D30FBB326262F356E288B',
  channel: 'WHATSAPP',
  protocol: 23167,
  channelId: '3E14B10711E1C0FE16B42EC236EAE1D6',
  contextId: '3E14B10711E1C0FE16B42EC236EAE1D6-27870562914352@lid',
  recipient: '27870562914352@lid',
  interactionId: '3F69B23A48B531FC289CDA78A3C64868',
};

// =============================================================================
// TESTES
// =============================================================================

describe('classifyEvent — o payload real NÃO traz o nome do evento', () => {
  it('usa o &event= da URL quando presente', () => {
    expect(classifyEvent('onTransfer')).toBe('transfer');
    expect(classifyEvent('onNewMessage')).toBe('message');
    expect(classifyEvent('onFirstInteraction')).toBe('interaction');
  });

  it('sem pista na URL, deduz MENSAGEM pela forma do payload', () => {
    expect(classifyEvent('', REAL_MESSAGE_USER)).toBe('message');
    expect(classifyEvent('', REAL_MESSAGE_ASSISTANT)).toBe('message');
  });

  it('sem pista na URL, deduz INTERAÇÃO pela forma do payload', () => {
    expect(classifyEvent('', REAL_INTERACTION)).toBe('interaction');
  });

  it('devolve unknown quando não há pista nem forma reconhecível', () => {
    expect(classifyEvent('', { foo: 'bar' })).toBe('unknown');
    expect(classifyEvent('')).toBe('unknown');
  });

  it('a pista da URL tem precedência sobre a forma', () => {
    // Transferência pode vir com corpo de interação — a URL decide.
    expect(classifyEvent('onTransfer', REAL_INTERACTION)).toBe('transfer');
  });
});

describe('normalizePhone — @lid NÃO é telefone', () => {
  it('rejeita @lid (identificador interno do WhatsApp)', () => {
    expect(normalizePhone('27870562914352@lid')).toBeNull();
    expect(normalizePhone('5511999999999@s.whatsapp.net')).toBeNull();
  });

  it('aceita telefone real', () => {
    expect(normalizePhone('553598205552')).toBe('+553598205552');
    expect(normalizePhone('+5511976557863')).toBe('+5511976557863');
  });

  it('rejeita comprimento implausível', () => {
    expect(normalizePhone('123')).toBeNull();
    expect(normalizePhone('1234567890123456789')).toBeNull();
  });

  it('rejeita não-string e vazio', () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(42)).toBeNull();
    expect(normalizePhone('')).toBeNull();
  });
});

describe('recipientFromContextId', () => {
  it('extrai o destinatário depois do primeiro hífen', () => {
    expect(recipientFromContextId('3E14B107-553598205552')).toBe('553598205552');
    expect(recipientFromContextId('3E14B10711E1C0FE16B42EC236EAE1D6-27870562914352@lid')).toBe(
      '27870562914352@lid'
    );
  });

  it('devolve null sem hífen ou sem valor', () => {
    expect(recipientFromContextId('semhifen')).toBeNull();
    expect(recipientFromContextId(null)).toBeNull();
  });
});

describe('normalizeEvent — payload REAL de mensagem', () => {
  it('usa o contextId como identidade da conversa (casa com o histórico importado)', () => {
    const event = normalizeEvent(REAL_MESSAGE_USER, 'onNewMessage');
    expect(event.chatId).toBe('3E14B10711E1C0FE16B42EC236EAE1D6-553598205552');
  });

  it('role "user" é entrada; "assistant" é saída', () => {
    expect(normalizeEvent(REAL_MESSAGE_USER, 'onNewMessage').direction).toBe('inbound');
    expect(normalizeEvent(REAL_MESSAGE_ASSISTANT, 'onNewMessage').direction).toBe('outbound');
  });

  it('parseia `date` em ISO string (não é epoch)', () => {
    const event = normalizeEvent(REAL_MESSAGE_USER, 'onNewMessage');
    expect(event.timestamp.toISOString()).toBe('2026-07-24T17:20:11.100Z');
  });

  it('extrai texto da mensagem', () => {
    const event = normalizeEvent(REAL_MESSAGE_USER, 'onNewMessage');
    expect(event.contentType).toBe('text');
    expect(event.content).toEqual({ type: 'text', text: 'Tive um AVC há 3 meses, vocês atendem?' });
  });

  it('extrai imagem do ARRAY `images` (não de um campo `imageUrl`)', () => {
    const event = normalizeEvent(REAL_MESSAGE_ASSISTANT, 'onNewMessage');
    expect(event.contentType).toBe('image');
    expect(event.content.mediaUrl).toContain('gpt-files.com');
    expect(event.text).toBe('[imagem]');
  });

  it('usa o messageId real para deduplicação', () => {
    const event = normalizeEvent(REAL_MESSAGE_USER, 'onNewMessage');
    expect(event.externalMessageId).toBe('3F69B111AAAA2222BBBB3333CCCC4444');
  });

  it('NÃO inventa telefone quando o contato é @lid', () => {
    const event = normalizeEvent(REAL_MESSAGE_ASSISTANT, 'onNewMessage');
    expect(event.contactPhone).toBeNull();
  });

  it('extrai telefone real quando existe', () => {
    const event = normalizeEvent(REAL_MESSAGE_USER, 'onNewMessage');
    expect(event.contactPhone).toBe('+553598205552');
    expect(event.contactName).toBe('Nathália de Almeida');
  });
});

describe('normalizeEvent — payload REAL de interação', () => {
  it('classifica como interação e acha o contextId', () => {
    const event = normalizeEvent(REAL_INTERACTION, 'onFirstInteraction');
    expect(event.kind).toBe('interaction');
    expect(event.chatId).toBe('3E14B10711E1C0FE16B42EC236EAE1D6-27870562914352@lid');
  });

  it('cai no telefone do recipient quando não há contactPhone — e rejeita @lid', () => {
    const event = normalizeEvent(REAL_INTERACTION, 'onFirstInteraction');
    expect(event.contactPhone).toBeNull();
  });

  it('usa o interactionId como id externo', () => {
    const event = normalizeEvent(REAL_INTERACTION, 'onFirstInteraction');
    expect(event.externalMessageId).toBe('3F69B23A48B531FC289CDA78A3C64868');
  });

  it('sem mensagem, o texto não fica undefined', () => {
    const event = normalizeEvent(REAL_INTERACTION, 'onFirstInteraction');
    expect(event.text).toBe('[mensagem]');
  });
});

describe('normalizeEvent — mídia em array', () => {
  it('áudio', () => {
    const event = normalizeEvent(
      { ...REAL_MESSAGE_USER, images: [], audios: ['https://gpt-files.com/a.ogg'], message: '' },
      'onNewMessage'
    );
    expect(event.contentType).toBe('audio');
    expect(event.text).toBe('[áudio]');
  });

  it('documento', () => {
    const event = normalizeEvent(
      { ...REAL_MESSAGE_USER, images: [], documents: ['https://gpt-files.com/d.pdf'], message: '' },
      'onNewMessage'
    );
    expect(event.contentType).toBe('document');
  });

  it('array vazio não vira mídia', () => {
    const event = normalizeEvent(REAL_MESSAGE_USER, 'onNewMessage');
    expect(event.contentType).toBe('text');
  });
});

describe('normalizeEvent — robustez (nunca lança)', () => {
  const hostis: unknown[] = [
    {},
    { date: null },
    { images: 'não é array' },
    { message: null },
    { contextId: 123 },
    { role: 42 },
    { date: 'data inválida' },
    { images: [null, undefined] },
  ];

  it.each(hostis)('sobrevive a payload malformado: %j', (payload) => {
    expect(() => normalizeEvent(payload as never)).not.toThrow();
  });

  it('data inválida cai para agora em vez de NaN', () => {
    const event = normalizeEvent({ date: 'xxx', contextId: 'a-b' } as never);
    expect(Number.isNaN(event.timestamp.getTime())).toBe(false);
  });
});

describe('generateStableEventId', () => {
  it('a mesma mensagem gera sempre o mesmo id (2ª entrega = duplicata)', () => {
    const a = normalizeEvent(REAL_MESSAGE_USER, 'onNewMessage');
    const b = normalizeEvent(REAL_MESSAGE_USER, 'onNewMessage');
    expect(generateStableEventId(a, 'ch', 'onNewMessage')).toBe(
      generateStableEventId(b, 'ch', 'onNewMessage')
    );
  });

  it('mensagens diferentes geram ids diferentes', () => {
    const a = generateStableEventId(normalizeEvent(REAL_MESSAGE_USER, 'onNewMessage'), 'ch', 'x');
    const b = generateStableEventId(
      normalizeEvent(REAL_MESSAGE_ASSISTANT, 'onNewMessage'),
      'ch',
      'x'
    );
    expect(a).not.toBe(b);
  });

  it('interação e mensagem do mesmo chat não colidem', () => {
    const msg = generateStableEventId(normalizeEvent(REAL_MESSAGE_ASSISTANT, 'onNewMessage'), 'ch', 'onNewMessage');
    const inter = generateStableEventId(
      normalizeEvent(REAL_INTERACTION, 'onFirstInteraction'),
      'ch',
      'onFirstInteraction'
    );
    expect(msg).not.toBe(inter);
  });
});

describe('timingSafeEqual', () => {
  it('aceita iguais e rejeita diferentes', () => {
    expect(timingSafeEqual('segredo-123', 'segredo-123')).toBe(true);
    expect(timingSafeEqual('segredo-123', 'segredo-124')).toBe(false);
  });

  it('rejeita prefixo correto e string vazia', () => {
    expect(timingSafeEqual('segredo', 'segredo-123')).toBe(false);
    expect(timingSafeEqual('', 'segredo')).toBe(false);
  });
});

describe('getSecretFromRequest', () => {
  function makeRequest(headers: Record<string, string> = {}) {
    return new Request('https://x/functions/v1/messaging-webhook-gptmaker/uuid', { headers });
  }

  it('lê do header x-api-key', () => {
    const req = makeRequest({ 'x-api-key': 'abc' });
    expect(getSecretFromRequest(req, new URL(req.url))).toBe('abc');
  });

  it('lê da query string (é assim que o GPT Maker chama)', () => {
    const url = new URL('https://x/f/uuid?key=xyz&event=onNewMessage');
    expect(getSecretFromRequest(makeRequest(), url)).toBe('xyz');
  });

  it('sem segredo devolve vazio — o handler nega por default', () => {
    const req = makeRequest();
    expect(getSecretFromRequest(req, new URL(req.url))).toBe('');
  });
});
