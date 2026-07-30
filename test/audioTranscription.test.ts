/**
 * Transcrição de áudio do GPT Maker — story 2.3.
 *
 * FATO apurado no dado real de produção (2026-07-30): o fornecedor entrega a
 * transcrição em `midiaContent` de `GET /v2/chat/{chatId}/messages`, para áudio
 * RECEBIDO (`role: "user"`) e ENVIADO (`role: "assistant"`). O webhook NÃO a
 * entrega — auditados 358 eventos de áudio, `message` vem vazio em 100% deles.
 *
 * As fixtures abaixo reproduzem a ESTRUTURA observada na API real (campos e
 * formato). O texto foi substituído — o conteúdo original é dado de saúde.
 */
import { describe, expect, it } from 'vitest';

import { pickTranscription } from '../supabase/functions/messaging-webhook-gptmaker/transcription';

/** Resposta real: array PURO (não envelopado), mais recentes primeiro. */
const RESPOSTA_API = [
  {
    id: '3F6E5F89B525706686E7FE5C36CE80A0',
    externalId: 'A598D10C0E51C9B26FA7A02583A7B6AE',
    role: 'assistant',
    type: 'AUDIO',
    audioUrl: 'https://gpt-files.com/file/3E14B107/3F69B238',
    midiaContent: 'Perfeito, vou te explicar como funciona a avaliação.',
    userName: 'Assistente',
    time: 1753900000000,
    sequence: 3,
  },
  {
    id: '3F6E5F5ED61C10B65798C69FA9E87CFB',
    externalId: '3A55A9602DCA8E02BA2E',
    role: 'user',
    type: 'AUDIO',
    audioUrl: 'https://gpt-files.com/file/3E14B107/3F69B111',
    midiaContent: 'Oi, é para o meu pai, ele teve um AVC.',
    userName: 'Lead',
    time: 1753899000000,
    sequence: 2,
  },
  {
    id: '3F6E5E5457C23125EECA4EC21DF8C56A',
    role: 'assistant',
    type: 'TEXT',
    text: 'Olá! Como posso ajudar?',
    time: 1753898000000,
    sequence: 1,
  },
];

describe('pickTranscription', () => {
  it('acha a transcrição do áudio RECEBIDO pelo id da mensagem', () => {
    expect(pickTranscription(RESPOSTA_API, '3F6E5F5ED61C10B65798C69FA9E87CFB')).toBe(
      'Oi, é para o meu pai, ele teve um AVC.'
    );
  });

  it('acha a transcrição do áudio ENVIADO — vale para os dois sentidos', () => {
    expect(pickTranscription(RESPOSTA_API, '3F6E5F89B525706686E7FE5C36CE80A0')).toBe(
      'Perfeito, vou te explicar como funciona a avaliação.'
    );
  });

  it('devolve null quando a mensagem não tem midiaContent (ex.: texto)', () => {
    expect(pickTranscription(RESPOSTA_API, '3F6E5E5457C23125EECA4EC21DF8C56A')).toBeNull();
  });

  it('devolve null quando o id não está na página', () => {
    expect(pickTranscription(RESPOSTA_API, 'ID-QUE-NAO-EXISTE')).toBeNull();
  });

  it('não confunde com o externalId — o elo é o campo id', () => {
    // `externalId` é outro identificador do fornecedor; casar por ele traria a
    // mensagem errada ou nenhuma.
    expect(pickTranscription(RESPOSTA_API, '3A55A9602DCA8E02BA2E')).toBeNull();
  });

  it('aceita resposta envelopada em { data: [...] } sem quebrar', () => {
    expect(
      pickTranscription({ data: RESPOSTA_API }, '3F6E5F5ED61C10B65798C69FA9E87CFB')
    ).toBe('Oi, é para o meu pai, ele teve um AVC.');
  });

  it('trata transcrição só com espaços como ausente', () => {
    const body = [{ id: 'x', type: 'AUDIO', midiaContent: '   ' }];
    expect(pickTranscription(body, 'x')).toBeNull();
  });

  it('não quebra com formato inesperado nem com id vazio', () => {
    expect(pickTranscription(null, 'x')).toBeNull();
    expect(pickTranscription({ erro: 'nao autorizado' }, 'x')).toBeNull();
    expect(pickTranscription([null, undefined], 'x')).toBeNull();
    expect(pickTranscription(RESPOSTA_API, '')).toBeNull();
  });
});
