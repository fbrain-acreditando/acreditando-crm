/**
 * Testes do parser de webhook do GPT Maker.
 *
 * ⚠️ CONTEXTO IMPORTANTE: o formato do payload NÃO é documentado pelo fornecedor
 * (nem no OpenAPI, nem nas docs). Estes testes cobrem as formas PLAUSÍVEIS e,
 * principalmente, garantem que o parser **nunca lança** e **nunca inventa dado**
 * quando não reconhece — o evento cai como "unknown" e o corpo cru fica gravado
 * para inspeção (Fase 0, modo captura).
 *
 * Quando os payloads REAIS forem capturados em produção, eles viram fixtures aqui
 * e estes casos hipotéticos podem ser podados.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeEvent,
  normalizePhone,
  classifyEvent,
  generateStableEventId,
  timingSafeEqual,
  getSecretFromRequest,
} from './parser';

describe('classifyEvent', () => {
  it('reconhece os eventos documentados do agente', () => {
    expect(classifyEvent('onTransfer')).toBe('transfer');
    expect(classifyEvent('onNewMessage')).toBe('message');
    expect(classifyEvent('onFirstInteraction')).toBe('interaction');
    expect(classifyEvent('onFinishInteraction')).toBe('interaction');
  });

  it('é indiferente a caixa e a formato', () => {
    expect(classifyEvent('ON_TRANSFER')).toBe('transfer');
    expect(classifyEvent('new_message')).toBe('message');
  });

  it('devolve unknown para evento não previsto — sem chutar', () => {
    expect(classifyEvent('onCreateEvent')).toBe('unknown');
    expect(classifyEvent('')).toBe('unknown');
  });
});

describe('normalizePhone', () => {
  it('normaliza para +digitos', () => {
    expect(normalizePhone('5511999999999')).toBe('+5511999999999');
    expect(normalizePhone('+55 (11) 99999-9999')).toBe('+5511999999999');
  });

  it('rejeita entrada curta ou inválida — melhor nulo do que telefone errado', () => {
    expect(normalizePhone('123')).toBeNull();
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
    expect(normalizePhone(42)).toBeNull();
  });
});

describe('normalizeEvent — extração de chatId', () => {
  it('lê chatId na raiz', () => {
    const event = normalizeEvent({ event: 'onNewMessage', chatId: 'chat-1' });
    expect(event.chatId).toBe('chat-1');
  });

  it('lê chatId aninhado em chat.id', () => {
    const event = normalizeEvent({ event: 'onNewMessage', chat: { id: 'chat-2' } });
    expect(event.chatId).toBe('chat-2');
  });

  it('lê chatId aninhado na mensagem', () => {
    const event = normalizeEvent({
      event: 'onNewMessage',
      message: { chatId: 'chat-3', text: 'oi' },
    });
    expect(event.chatId).toBe('chat-3');
  });

  it('aceita snake_case', () => {
    const event = normalizeEvent({ event: 'onNewMessage', chat_id: 'chat-4' });
    expect(event.chatId).toBe('chat-4');
  });

  it('devolve null quando não acha — não inventa', () => {
    const event = normalizeEvent({ event: 'onNewMessage', foo: 'bar' });
    expect(event.chatId).toBeNull();
  });
});

describe('normalizeEvent — direção', () => {
  it('role "user" é entrada (o lead falando)', () => {
    const event = normalizeEvent({
      event: 'onNewMessage',
      chatId: 'c1',
      message: { role: 'user', text: 'Olá' },
    });
    expect(event.direction).toBe('inbound');
  });

  it('role "assistant" é saída (a IA do GPT Maker respondendo)', () => {
    const event = normalizeEvent({
      event: 'onNewMessage',
      chatId: 'c1',
      message: { role: 'assistant', text: 'Olá! Sou a Assistente Virtual' },
    });
    expect(event.direction).toBe('outbound');
  });

  it('sem role, assume entrada (o caso que importa para o funil)', () => {
    const event = normalizeEvent({ event: 'onNewMessage', chatId: 'c1', message: { text: 'oi' } });
    expect(event.direction).toBe('inbound');
  });
});

describe('normalizeEvent — conteúdo', () => {
  it('extrai texto simples', () => {
    const event = normalizeEvent({
      event: 'onNewMessage',
      chatId: 'c1',
      message: { text: 'Tive um AVC há 3 meses' },
    });
    expect(event.contentType).toBe('text');
    expect(event.content).toEqual({ type: 'text', text: 'Tive um AVC há 3 meses' });
  });

  it('aceita message como string pura', () => {
    const event = normalizeEvent({ event: 'onNewMessage', chatId: 'c1', message: 'texto direto' });
    expect(event.text).toBe('texto direto');
  });

  it('reconhece imagem', () => {
    const event = normalizeEvent({
      event: 'onNewMessage',
      chatId: 'c1',
      message: { imageUrl: 'https://x/img.png', text: 'comprovante' },
    });
    expect(event.contentType).toBe('image');
    expect(event.content.mediaUrl).toBe('https://x/img.png');
    expect(event.content.caption).toBe('comprovante');
  });

  it('reconhece áudio', () => {
    const event = normalizeEvent({
      event: 'onNewMessage',
      chatId: 'c1',
      message: { audioUrl: 'https://x/a.ogg' },
    });
    expect(event.contentType).toBe('audio');
  });

  it('reconhece documento e usa nome padrão quando falta', () => {
    const event = normalizeEvent({
      event: 'onNewMessage',
      chatId: 'c1',
      message: { documentUrl: 'https://x/d.pdf' },
    });
    expect(event.contentType).toBe('document');
    expect(event.content.fileName).toBe('documento');
  });

  it('usa placeholder quando não há texto — nunca undefined no preview', () => {
    const event = normalizeEvent({ event: 'onNewMessage', chatId: 'c1' });
    expect(event.text).toBe('[mensagem]');
  });
});

describe('normalizeEvent — contato', () => {
  it('extrai nome e telefone do bloco contact', () => {
    const event = normalizeEvent({
      event: 'onTransfer',
      chatId: 'c1',
      contact: { name: 'Maria Silva', phone: '5511988887777' },
    });
    expect(event.contactName).toBe('Maria Silva');
    expect(event.contactPhone).toBe('+5511988887777');
  });

  it('cai para os campos do chat quando não há contact', () => {
    const event = normalizeEvent({
      event: 'onTransfer',
      chat: { id: 'c1', userName: 'João', whatsappPhone: '5511977776666' },
    });
    expect(event.contactName).toBe('João');
    expect(event.contactPhone).toBe('+5511977776666');
  });

  it('devolve null quando o telefone não vem — o contato ainda é criado pelo nome', () => {
    const event = normalizeEvent({ event: 'onTransfer', chatId: 'c1', contact: { name: 'Ana' } });
    expect(event.contactPhone).toBeNull();
    expect(event.contactName).toBe('Ana');
  });
});

describe('normalizeEvent — timestamp', () => {
  it('interpreta epoch em milissegundos', () => {
    const ms = 1753300000000;
    const event = normalizeEvent({ event: 'onNewMessage', chatId: 'c1', message: { time: ms } });
    expect(event.timestamp.getTime()).toBe(ms);
  });

  it('interpreta epoch em segundos', () => {
    const seconds = 1753300000;
    const event = normalizeEvent({
      event: 'onNewMessage',
      chatId: 'c1',
      message: { time: seconds },
    });
    expect(event.timestamp.getTime()).toBe(seconds * 1000);
  });

  it('cai para agora quando não vem tempo', () => {
    const before = Date.now();
    const event = normalizeEvent({ event: 'onNewMessage', chatId: 'c1' });
    expect(event.timestamp.getTime()).toBeGreaterThanOrEqual(before);
  });
});

describe('normalizeEvent — robustez (nunca lança)', () => {
  const hostis: unknown[] = [
    {},
    { event: null },
    { message: null },
    { message: [] },
    { chat: 'string em vez de objeto' },
    { contact: 42 },
    { event: 'onNewMessage', message: { time: 'não é número' } },
  ];

  it.each(hostis)('sobrevive a payload malformado: %j', (payload) => {
    expect(() => normalizeEvent(payload as never)).not.toThrow();
  });
});

describe('generateStableEventId', () => {
  const base = {
    kind: 'message' as const,
    chatId: 'c1',
    externalMessageId: null,
    text: 'x',
    contentType: 'text',
    content: {},
    direction: 'inbound' as const,
    contactName: null,
    contactPhone: null,
    contactAvatar: null,
    timestamp: new Date(1753300000000),
  };

  it('prefere o ID da mensagem quando existe (dedupe forte)', () => {
    const id = generateStableEventId({ ...base, externalMessageId: 'msg-1' }, 'ch', 'onNewMessage');
    expect(id).toBe('gpt_msg_msg-1');
  });

  it('é determinístico para o mesmo evento — a 2ª entrega é detectada como duplicata', () => {
    const a = generateStableEventId(base, 'ch', 'onNewMessage');
    const b = generateStableEventId(base, 'ch', 'onNewMessage');
    expect(a).toBe(b);
  });

  it('transferência do mesmo chat gera sempre o mesmo ID (não duplica lead quente)', () => {
    const id = generateStableEventId({ ...base, kind: 'transfer' }, 'ch', 'onTransfer');
    expect(id).toBe('gpt_transfer_c1');
  });

  it('distingue chats diferentes', () => {
    const a = generateStableEventId(base, 'ch', 'onNewMessage');
    const b = generateStableEventId({ ...base, chatId: 'c2' }, 'ch', 'onNewMessage');
    expect(a).not.toBe(b);
  });
});

describe('timingSafeEqual', () => {
  it('aceita segredos iguais', () => {
    expect(timingSafeEqual('segredo-123', 'segredo-123')).toBe(true);
  });

  it('rejeita segredo errado', () => {
    expect(timingSafeEqual('segredo-123', 'segredo-124')).toBe(false);
  });

  it('rejeita tamanhos diferentes (prefixo correto não passa)', () => {
    expect(timingSafeEqual('segredo', 'segredo-123')).toBe(false);
  });

  it('rejeita string vazia', () => {
    expect(timingSafeEqual('', 'segredo')).toBe(false);
  });
});

describe('getSecretFromRequest', () => {
  function makeRequest(headers: Record<string, string> = {}) {
    return new Request('https://x/functions/v1/messaging-webhook-gptmaker/uuid', { headers });
  }

  it('lê o segredo do header x-api-key', () => {
    const req = makeRequest({ 'x-api-key': 'abc' });
    expect(getSecretFromRequest(req, new URL(req.url))).toBe('abc');
  });

  it('lê o segredo da query string (o GPT Maker só configura URL)', () => {
    const url = new URL('https://x/functions/v1/messaging-webhook-gptmaker/uuid?key=xyz');
    expect(getSecretFromRequest(makeRequest(), url)).toBe('xyz');
  });

  it('header tem precedência sobre query', () => {
    const url = new URL('https://x/f?key=da-query');
    expect(getSecretFromRequest(makeRequest({ 'x-api-key': 'do-header' }), url)).toBe('do-header');
  });

  it('devolve vazio quando não há segredo — o handler nega por default', () => {
    const req = makeRequest();
    expect(getSecretFromRequest(req, new URL(req.url))).toBe('');
  });
});
