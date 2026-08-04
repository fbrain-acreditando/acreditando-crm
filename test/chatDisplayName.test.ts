/**
 * O nome do contato importado do GPT Maker.
 *
 * `chat.userName` **não é o contato — é o atendente humano**. Ele estava em
 * primeiro lugar na precedência e batizou **11 leads reais** com o nome do
 * operador, em 24/07/2026 entre 17:11 e 17:12 (um sync só).
 *
 * Escala medida na API em 2026-08-04, sobre 4.000 chats:
 *   userName = "Filipe Costa" → 151 chats
 *   userName = "Fernanda"     →  17 chats
 *   userName = null           → o resto
 *
 * São os dois operadores da conta. Não são 168 pessoas homônimas.
 *
 * ⚖️ LGPD Art. 6º, V (exatidão): dado pessoal e de saúde atrelado à identidade
 * errada. A Fernanda via várias conversas com o mesmo nome sendo pessoas
 * diferentes.
 */
import { describe, expect, it } from 'vitest';

import { chatDisplayName } from '../app/api/messaging/channels/[id]/gptmaker/sync/route';
import type { GptMakerChat } from '../lib/messaging/providers/whatsapp/gptmaker.provider';

function chat(over: Partial<GptMakerChat> = {}): GptMakerChat {
  return { id: '3E14B10711E1C0FE16B42EC236EAE1D6-5511993636416', ...over };
}

describe('chatDisplayName — o defeito que batizou 11 leads', () => {
  it('NUNCA usa userName, mesmo sendo o único campo preenchido', () => {
    // Caso literal dos 4 chats @lid: o GPT Maker não tem nome do contato, e o
    // único texto disponível é o do operador. Telefone é a resposta honesta.
    const nome = chatDisplayName(
      chat({ name: '', userName: 'Filipe Costa' }),
      '+554399059422'
    );

    expect(nome).toBe('+554399059422');
    expect(nome).not.toBe('Filipe Costa');
  });

  it('prefere o nome do contato quando os dois existem', () => {
    // Objeto real da API: { name: "GUINA😎", userName: "Filipe Costa" }
    expect(
      chatDisplayName(chat({ name: 'GUINA😎', userName: 'Filipe Costa' }), '+5511951966842')
    ).toBe('GUINA😎');
  });

  it('não confunde o outro operador com uma lead', () => {
    expect(
      chatDisplayName(chat({ name: 'Rafael Ferreira', userName: 'Fernanda' }), '+5511993636416')
    ).toBe('Rafael Ferreira');
  });

  it('uma lead que REALMENTE se chama Fernanda continua se chamando Fernanda', () => {
    // Caso real (+5511997803114): `name: "Fernanda"`, `userName: null`. Quase
    // virou falso positivo na investigação — o nome do contato coincidir com o de
    // um operador não faz dele um erro.
    expect(chatDisplayName(chat({ name: 'Fernanda', userName: null }), '+5511997803114')).toBe(
      'Fernanda'
    );
  });
});

describe('chatDisplayName — a cadeia de fallback', () => {
  it('cai para title quando não há name', () => {
    expect(chatDisplayName(chat({ name: '', title: 'Atendimento' }), '+5511999999999')).toBe(
      'Atendimento'
    );
  });

  it('cai para o telefone quando não há name nem title', () => {
    expect(chatDisplayName(chat({}), '+5511999999999')).toBe('+5511999999999');
  });

  it('cai para o id quando não há nem telefone', () => {
    const c = chat({});
    expect(chatDisplayName(c, null)).toBe(c.id);
  });

  it('trata string vazia como ausência — não devolve nome em branco', () => {
    expect(chatDisplayName(chat({ name: '', title: '' }), '+5511999999999')).toBe(
      '+5511999999999'
    );
  });
});
