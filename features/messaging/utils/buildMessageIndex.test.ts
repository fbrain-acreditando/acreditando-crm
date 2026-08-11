import { describe, it, expect } from 'vitest';
import { buildMessageIndex } from './buildMessageIndex';
import type { MessagingMessage } from '@/lib/messaging/types';

/**
 * Story 2.23 (AC2) — o índice substituiu um `allMessages.find(...)` que rodava
 * dentro de cada MessageBubble. Estes testes existem para provar que a troca
 * é EQUIVALENTE, não só mais rápida: a busca antiga casava por `id` OU
 * `externalId` e devolvia o PRIMEIRO da ordem.
 */

function msg(partial: Partial<MessagingMessage> & { id: string }): MessagingMessage {
  return {
    conversationId: 'conv-1',
    direction: 'inbound',
    contentType: 'text',
    content: 'oi',
    createdAt: '2026-08-11T10:00:00.000Z',
    ...partial,
  } as MessagingMessage;
}

/** A implementação ANTIGA, mantida aqui só como oráculo de comparação. */
function findLegacy(
  messages: readonly MessagingMessage[],
  key: string
): MessagingMessage | undefined {
  return messages.find((m) => m.id === key || m.externalId === key);
}

describe('buildMessageIndex', () => {
  it('acha por id', () => {
    const messages = [msg({ id: 'a' }), msg({ id: 'b' })];
    expect(buildMessageIndex(messages).get('b')?.id).toBe('b');
  });

  it('acha por externalId', () => {
    const messages = [msg({ id: 'a', externalId: 'wa-123' })];
    expect(buildMessageIndex(messages).get('wa-123')?.id).toBe('a');
  });

  it('devolve undefined para chave inexistente', () => {
    expect(buildMessageIndex([msg({ id: 'a' })]).get('nao-existe')).toBeUndefined();
  });

  it('ignora externalId ausente sem criar chave vazia', () => {
    const index = buildMessageIndex([msg({ id: 'a', externalId: undefined })]);
    expect(index.size).toBe(1);
    expect(index.has('')).toBe(false);
  });

  // 🪤 O caso que motivou a regra "primeiro vence".
  it('quando um externalId COLIDE com o id de outra mensagem, o primeiro da ordem vence — igual ao find antigo', () => {
    const messages = [
      msg({ id: 'colisao' }), // 1ª: casa pelo id
      msg({ id: 'outra', externalId: 'colisao' }), // 2ª: casaria pelo externalId
    ];

    const doIndice = buildMessageIndex(messages).get('colisao');
    const doFindAntigo = findLegacy(messages, 'colisao');

    expect(doIndice?.id).toBe('colisao');
    expect(doIndice).toBe(doFindAntigo); // mesma referência: equivalência provada
  });

  it('idem na ordem inversa: quem aparece primeiro é quem vence', () => {
    const messages = [
      msg({ id: 'outra', externalId: 'colisao' }), // agora esta vem primeiro
      msg({ id: 'colisao' }),
    ];

    const doIndice = buildMessageIndex(messages).get('colisao');
    expect(doIndice?.id).toBe('outra');
    expect(doIndice).toBe(findLegacy(messages, 'colisao'));
  });

  it('equivale ao find antigo em TODAS as chaves de uma conversa realista', () => {
    const messages = [
      msg({ id: 'm1', externalId: 'wa-1' }),
      msg({ id: 'm2', externalId: 'wa-2' }),
      msg({ id: 'm3' }),
      msg({ id: 'wa-2' }), // id que colide com o externalId de m2
      msg({ id: 'm5', externalId: 'wa-5' }),
    ];

    const index = buildMessageIndex(messages);
    const chaves = ['m1', 'm2', 'm3', 'm5', 'wa-1', 'wa-2', 'wa-5', 'inexistente'];

    for (const chave of chaves) {
      expect(index.get(chave)).toBe(findLegacy(messages, chave));
    }
  });

  it('aguenta lista vazia', () => {
    expect(buildMessageIndex([]).size).toBe(0);
  });
});
