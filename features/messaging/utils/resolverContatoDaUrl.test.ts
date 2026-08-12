/**
 * Story 2.31 — o botão "Mensagem" do card.
 *
 * O oráculo é a guarda ANTIGA, reconstruída no fim do arquivo: ela reprova no
 * caso que a Fernanda gravou em vídeo — com uma conversa aberta na tela, o
 * clique no card não resolvia o contato novo e ela continuava vendo a conversa
 * anterior.
 */
import { describe, it, expect } from 'vitest';
import { deveResolverContatoDaUrl } from './resolverContatoDaUrl';

const PRONTO = { carregando: false, temResposta: true };

describe('deveResolverContatoDaUrl — a intenção da URL vence o estado da tela', () => {
  it('🎯 resolve mesmo com uma conversa JÁ aberta (o caso do vídeo)', () => {
    // A conversa aberta nem sequer é entrada desta decisão — e é esse o ponto.
    expect(
      deveResolverContatoDaUrl({ contactIdParam: 'contato-B', contatoJaResolvido: null, ...PRONTO })
    ).toBe(true);
  });

  it('resolve um contactId DIFERENTE depois de já ter resolvido outro', () => {
    expect(
      deveResolverContatoDaUrl({
        contactIdParam: 'contato-B',
        contatoJaResolvido: 'contato-A',
        ...PRONTO,
      })
    ).toBe(true);
  });

  it('não repete o MESMO contactId já consumido (idempotência)', () => {
    expect(
      deveResolverContatoDaUrl({
        contactIdParam: 'contato-A',
        contatoJaResolvido: 'contato-A',
        ...PRONTO,
      })
    ).toBe(false);
  });

  it('espera a resposta chegar antes de decidir', () => {
    expect(
      deveResolverContatoDaUrl({
        contactIdParam: 'contato-A',
        contatoJaResolvido: null,
        carregando: true,
        temResposta: false,
      })
    ).toBe(false);

    expect(
      deveResolverContatoDaUrl({
        contactIdParam: 'contato-A',
        contatoJaResolvido: null,
        carregando: false,
        temResposta: false,
      })
    ).toBe(false);
  });

  it('sem parâmetro na URL, não faz nada', () => {
    expect(
      deveResolverContatoDaUrl({ contactIdParam: null, contatoJaResolvido: null, ...PRONTO })
    ).toBe(false);
  });
});

/**
 * ⚖️ CONTROLE — a guarda antiga, reconstruída.
 *
 * `if (!contactIdParam || selectedConversationId) return;`
 */
describe('CONTROLE — a guarda antiga reprova no caso do vídeo', () => {
  const guardaAntigaResolve = (params: {
    contactIdParam: string | null;
    selectedConversationId: string | undefined;
    contatoJaResolvido: string | null;
    carregando: boolean;
    temResposta: boolean;
  }) => {
    if (!params.contactIdParam || params.selectedConversationId) return false;
    if (params.carregando || !params.temResposta) return false;
    if (params.contatoJaResolvido === params.contactIdParam) return false;
    return true;
  };

  it('com uma conversa aberta, a antiga DESISTE — e a tela fica na conversa anterior', () => {
    expect(
      guardaAntigaResolve({
        contactIdParam: 'contato-B',
        selectedConversationId: 'conversa-do-contato-A',
        contatoJaResolvido: null,
        ...PRONTO,
      })
    ).toBe(false);
  });

  it('e, como o estado nunca muda, o destino é SEMPRE o mesmo — as duas metades do relato', () => {
    const tentativas = ['contato-B', 'contato-C', 'contato-D'].map(id =>
      guardaAntigaResolve({
        contactIdParam: id,
        selectedConversationId: 'conversa-do-contato-A',
        contatoJaResolvido: null,
        ...PRONTO,
      })
    );

    expect(tentativas).toEqual([false, false, false]);
  });

  it('a antiga só funcionava com a tela vazia — que é como ela era testada na mão', () => {
    expect(
      guardaAntigaResolve({
        contactIdParam: 'contato-B',
        selectedConversationId: undefined,
        contatoJaResolvido: null,
        ...PRONTO,
      })
    ).toBe(true);
  });
});
