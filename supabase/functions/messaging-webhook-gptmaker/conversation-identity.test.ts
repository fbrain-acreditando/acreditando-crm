/**
 * Testes da SEQUÊNCIA de identidade — story 2.56, achado ALTA-1 do @qa (25/09).
 *
 * Os testes anteriores cobriam os módulos puros (`alias-map`, `deal-guard`); a
 * decisão real vivia no `index.ts`, que **não é checado pelo `tsc`** (está no
 * `exclude`) e **não tinha teste nenhum**. Um `throw` ali faz o handler cair no
 * catch, responder **200** ao fornecedor e nunca inserir a mensagem — sem retry,
 * sem erro visível. É o pecado da 2.53.
 *
 * Aqui a sequência inteira é exercitada com portas falsas que **registram a
 * ordem das chamadas**: se alguém resolver o alias DEPOIS de procurar a conversa,
 * o teste quebra.
 */

import { describe, it, expect } from 'vitest';
import {
  garantirIdentidadeDaConversa,
  type ConversationPorts,
  type ConversaEncontrada,
} from './conversation-identity';
import { MOTIVO_AMBIGUO, MOTIVO_SEM_TELEFONE, type AliasStatus } from './alias-map';

const LID = '150439953756312@lid';
const CHAT_LID = '3E14B107-150439953756312@lid';
const CHAT_TEL = '3E14B107-5511951342931';
const TELEFONE = '+5511951342931';
const BOARD = '5f6bded2-0f7c-418d-9598-7ea75d032242';

interface Cenario {
  alias?: { phone: string | null; status: AliasStatus | null };
  conversas?: Record<string, ConversaEncontrada>;
  contato?: string | null;
  regra?: { boardId: string; stageId: string | null } | null;
  card?: string | null;
  criarFalha?: 'corrida' | 'erro';
  /** Porta que deve LANÇAR — o teste do contrato "nunca lança". */
  explode?: keyof ConversationPorts;
}

function montar(c: Cenario = {}) {
  const chamadas: string[] = [];
  const conversas: Record<string, ConversaEncontrada> = { ...(c.conversas ?? {}) };
  const marcacoes: Array<Record<string, unknown>> = [];
  const sucessoes: Array<[string, string]> = [];
  const conversasCriadas: Array<Record<string, unknown>> = [];
  const cardsPedidos: Array<Record<string, unknown>> = [];
  let proximaConversa = 1;

  function registrar(nome: keyof ConversationPorts) {
    chamadas.push(nome);
    if (c.explode === nome) throw new Error(`porta ${nome} explodiu`);
  }

  const ports: ConversationPorts = {
    log: () => {},

    async resolverAlias() {
      registrar('resolverAlias');
      return c.alias ?? { phone: null, status: null };
    },

    async acharConversa(chatId) {
      registrar('acharConversa');
      return conversas[chatId] ?? null;
    },

    async resolverContato(input) {
      registrar('resolverContato');
      chamadas.push(`contato:phone=${input.phone ?? 'null'}`);
      return c.contato === undefined ? 'contato-1' : c.contato;
    },

    async criarConversa(input) {
      registrar('criarConversa');
      conversasCriadas.push(input as unknown as Record<string, unknown>);
      if (c.criarFalha === 'erro') return { erro: 'banco fora do ar' };
      if (c.criarFalha === 'corrida') return { corrida: true as const };
      const id = `conv-nova-${proximaConversa++}`;
      conversas[input.chatId] = { conversationId: id, contactId: input.contactId };
      return { conversationId: id };
    },

    async regraDeEntrada() {
      registrar('regraDeEntrada');
      return c.regra === undefined ? { boardId: BOARD, stageId: null } : c.regra;
    },

    async garantirCard(input) {
      registrar('garantirCard');
      cardsPedidos.push(input as unknown as Record<string, unknown>);
      return c.card === undefined ? 'deal-1' : c.card;
    },

    async marcarIdentidade(input) {
      registrar('marcarIdentidade');
      marcacoes.push(input as unknown as Record<string, unknown>);
    },

    async marcarSucessao(antiga, nova) {
      registrar('marcarSucessao');
      sucessoes.push([antiga, nova]);
    },
  };

  return { ports, chamadas, marcacoes, sucessoes, conversasCriadas, cardsPedidos, conversas };
}

const EVENTO_LID = {
  chatId: CHAT_LID,
  lid: LID,
  contactName: null,
  contactPhone: null,
};

const EVENTO_TELEFONE = {
  chatId: CHAT_TEL,
  lid: null,
  contactName: 'Bruno Nascimento Motta',
  contactPhone: TELEFONE,
};

// =============================================================================
// AC2 — a ordem importa
// =============================================================================

describe('AC2 — resolve o alias ANTES de procurar conversa', () => {
  it('alias conhecido: procura a conversa pelo TELEFONE, não pelo lid', async () => {
    const { ports, chamadas, conversas } = montar({
      alias: { phone: TELEFONE, status: 'resolved' },
      conversas: { [CHAT_TEL]: { conversationId: 'conv-telefone', contactId: 'contato-1' } },
    });

    const r = await garantirIdentidadeDaConversa(ports, EVENTO_LID);

    expect(r.conversationId).toBe('conv-telefone');
    expect(r.chatIdUsado).toBe(CHAT_TEL);
    expect(r.aliasResolvido).toBe(true);
    expect(r.reusouConversa).toBe(true);
    // 🔴 A ordem: alias primeiro. Se inverter, o webhook procura pelo lid e
    // cria a conversa duplicada de novo — o defeito que a story corrige.
    expect(chamadas[0]).toBe('resolverAlias');
    expect(chamadas[1]).toBe('acharConversa');
    // Nada criado.
    expect(conversas[CHAT_LID]).toBeUndefined();
  });

  it('alias conhecido: nenhum contato novo e nenhum card novo (AC7 item 6)', async () => {
    const { ports, chamadas } = montar({
      alias: { phone: TELEFONE, status: 'resolved' },
      conversas: { [CHAT_TEL]: { conversationId: 'conv-telefone', contactId: 'contato-1' } },
    });

    await garantirIdentidadeDaConversa(ports, EVENTO_LID);

    expect(chamadas).not.toContain('resolverContato');
    expect(chamadas).not.toContain('garantirCard');
    expect(chamadas).not.toContain('criarConversa');
  });

  it('alias conhecido SEM conversa: cria UMA, chaveada pelo telefone', async () => {
    const { ports, conversasCriadas, chamadas } = montar({
      alias: { phone: TELEFONE, status: 'resolved' },
    });

    const r = await garantirIdentidadeDaConversa(ports, EVENTO_LID);

    expect(conversasCriadas).toHaveLength(1);
    expect(conversasCriadas[0].chatId).toBe(CHAT_TEL);
    // O contato é resolvido com o telefone do alias, não com `null`.
    expect(chamadas).toContain(`contato:phone=${TELEFONE}`);
    expect(r.identidadeNaoConfirmada).toBe(false);
    expect(chamadas).not.toContain('marcarIdentidade');
  });

  it('AC5-2: alias AMBÍGUO não reconcilia — segue pelo lid e marca', async () => {
    const { ports, marcacoes, conversasCriadas } = montar({
      alias: { phone: null, status: 'ambiguous' },
    });

    const r = await garantirIdentidadeDaConversa(ports, EVENTO_LID);

    expect(r.aliasResolvido).toBe(false);
    expect(conversasCriadas[0].chatId).toBe(CHAT_LID);
    expect(marcacoes[0].motivo).toBe(MOTIVO_AMBIGUO);
  });

  it('AC5-4: evento SEM lid nem consulta o mapa de alias', async () => {
    const { ports, chamadas } = montar({
      conversas: { [CHAT_TEL]: { conversationId: 'conv-normal', contactId: 'contato-1' } },
    });

    const r = await garantirIdentidadeDaConversa(ports, EVENTO_TELEFONE);

    expect(chamadas).not.toContain('resolverAlias');
    expect(chamadas).not.toContain('marcarIdentidade');
    expect(r.conversationId).toBe('conv-normal');
  });
});

// =============================================================================
// AC4 — o caso Bruno
// =============================================================================

describe('AC4 / D2 = B — o que não resolve nasce MARCADO', () => {
  it('caso Bruno: grava a conversa, CRIA o card e marca com os ids', async () => {
    const { ports, marcacoes, conversasCriadas, cardsPedidos } = montar();

    const r = await garantirIdentidadeDaConversa(ports, EVENTO_LID);

    expect(r.conversationId).toBe('conv-nova-1');
    expect(r.dealId).toBe('deal-1');
    expect(r.identidadeNaoConfirmada).toBe(true);
    // A conversa nasce com a etiqueta no metadata…
    expect(conversasCriadas[0].identidadeNaoConfirmada).toBe(true);
    // …e a marcação é DADO gravado, com motivo, conversa e card.
    expect(marcacoes).toEqual([
      {
        alias: LID,
        motivo: MOTIVO_SEM_TELEFONE,
        conversationId: 'conv-nova-1',
        dealId: 'deal-1',
      },
    ]);
    expect(cardsPedidos).toHaveLength(1);
  });

  it('a marcação vem DEPOIS do card — senão o dealId iria nulo', async () => {
    const { ports, chamadas } = montar();

    await garantirIdentidadeDaConversa(ports, EVENTO_LID);

    expect(chamadas.indexOf('garantirCard')).toBeLessThan(chamadas.indexOf('marcarIdentidade'));
  });

  it('canal sem regra de entrada: marca assim mesmo, com dealId null', async () => {
    const { ports, marcacoes } = montar({ regra: null });

    const r = await garantirIdentidadeDaConversa(ports, EVENTO_LID);

    expect(r.dealId).toBeNull();
    expect(marcacoes[0].dealId).toBeNull();
  });

  it('conversa `@lid` que JÁ existia não é remarcada (D3 = não mexer no passado)', async () => {
    const { ports, chamadas } = montar({
      conversas: { [CHAT_LID]: { conversationId: 'conv-antiga', contactId: 'contato-1' } },
    });

    const r = await garantirIdentidadeDaConversa(ports, EVENTO_LID);

    expect(r.reusouConversa).toBe(true);
    expect(chamadas).not.toContain('marcarIdentidade');
  });
});

// =============================================================================
// MÉDIA-2 — a conversa antiga não emudece sem ponteiro
// =============================================================================

describe('MÉDIA-2 — `sucedida_por` na conversa antiga do lid', () => {
  it('o caso comum (93 de 94): nasce conversa nova e a antiga ganha o ponteiro', async () => {
    const { ports, sucessoes } = montar({
      alias: { phone: TELEFONE, status: 'resolved' },
      conversas: { [CHAT_LID]: { conversationId: 'conv-antiga', contactId: 'contato-1' } },
    });

    const r = await garantirIdentidadeDaConversa(ports, EVENTO_LID);

    expect(r.conversationId).toBe('conv-nova-1');
    expect(sucessoes).toEqual([['conv-antiga', 'conv-nova-1']]);
  });

  it('quando existe gêmea por telefone, o ponteiro aponta para ela', async () => {
    const { ports, sucessoes } = montar({
      alias: { phone: TELEFONE, status: 'resolved' },
      conversas: {
        [CHAT_LID]: { conversationId: 'conv-antiga', contactId: 'contato-1' },
        [CHAT_TEL]: { conversationId: 'conv-telefone', contactId: 'contato-1' },
      },
    });

    await garantirIdentidadeDaConversa(ports, EVENTO_LID);

    expect(sucessoes).toEqual([['conv-antiga', 'conv-telefone']]);
  });

  it('sem conversa antiga do lid, não inventa ponteiro', async () => {
    const { ports, sucessoes } = montar({ alias: { phone: TELEFONE, status: 'resolved' } });

    await garantirIdentidadeDaConversa(ports, EVENTO_LID);

    expect(sucessoes).toEqual([]);
  });

  it('alias NÃO resolvido não gera ponteiro — a chave nem mudou', async () => {
    const { ports, sucessoes } = montar({
      conversas: { [CHAT_LID]: { conversationId: 'conv-antiga', contactId: 'contato-1' } },
    });

    await garantirIdentidadeDaConversa(ports, EVENTO_LID);

    expect(sucessoes).toEqual([]);
  });
});

// =============================================================================
// AC5 — o contrato que impede engolir mensagem
// =============================================================================

describe('AC5 — a decisão NUNCA lança', () => {
  const portas: Array<keyof ConversationPorts> = [
    'resolverAlias',
    'acharConversa',
    'resolverContato',
    'criarConversa',
    'regraDeEntrada',
    'garantirCard',
    'marcarIdentidade',
    'marcarSucessao',
  ];

  for (const porta of portas) {
    it(`porta "${porta}" explodindo não derruba a decisão`, async () => {
      const { ports } = montar({
        explode: porta,
        alias: { phone: TELEFONE, status: 'resolved' },
        conversas: { [CHAT_LID]: { conversationId: 'conv-antiga', contactId: 'contato-1' } },
      });

      // Se isto lançar, o handler do webhook responde 200 sem inserir a
      // mensagem — e ninguém fica sabendo. É o desfecho proibido.
      await expect(garantirIdentidadeDaConversa(ports, EVENTO_LID)).resolves.toBeDefined();
    });
  }

  /**
   * 🔴 ACHADO ALTA-1b do @qa (26/09) — este é o teste que faltava.
   *
   * `resolves.toBeDefined()` acima **não prova o que importa**: o objeto sempre
   * volta definido. O desfecho proibido é mais sutil — a conversa **já existe no
   * banco** e o resultado vem com `conversationId: null`, porque o `catch` de
   * segunda camada montava o retorno do zero. E `ensureConversation` **lança**
   * quando isso acontece ⇒ handler responde 200 ⇒ **mensagem nunca inserida**.
   *
   * O @qa provou o furo com um teste temporário: `regraDeEntrada`, `garantirCard`
   * e `marcarIdentidade` explodindo devolviam `null` no lugar de `'conv-nova-1'`.
   * Estes testes são a versão permanente dele — um por porta ACESSÓRIA, isto é,
   * as que rodam **depois** de a conversa existir.
   */
  const portasAcessorias: Array<keyof ConversationPorts> = [
    'regraDeEntrada',
    'garantirCard',
    'marcarIdentidade',
    'marcarSucessao',
  ];

  for (const porta of portasAcessorias) {
    it(`porta acessória "${porta}" explodindo PRESERVA a conversa já criada`, async () => {
      const { ports } = montar({ explode: porta });

      const r = await garantirIdentidadeDaConversa(ports, EVENTO_LID);

      // A conversa foi criada ANTES da explosão. Devolver `null` aqui faz o
      // chamador lançar e a mensagem nunca ser inserida.
      expect(r.conversationId).toBe('conv-nova-1');
      expect(r.contactId).toBe('contato-1');
      expect(r.chatIdUsado).toBe(CHAT_LID);
    });
  }

  it('`marcarSucessao` explodindo preserva a conversa REUSADA por telefone', async () => {
    const { ports } = montar({
      explode: 'marcarSucessao',
      alias: { phone: TELEFONE, status: 'resolved' },
      conversas: {
        [CHAT_LID]: { conversationId: 'conv-antiga', contactId: 'contato-1' },
        [CHAT_TEL]: { conversationId: 'conv-telefone', contactId: 'contato-1' },
      },
    });

    const r = await garantirIdentidadeDaConversa(ports, EVENTO_LID);

    expect(r.conversationId).toBe('conv-telefone');
    expect(r.reusouConversa).toBe(true);
  });

  it('`garantirCard` explodindo preserva também a marcação de identidade', async () => {
    const { ports } = montar({ explode: 'garantirCard' });

    const r = await garantirIdentidadeDaConversa(ports, EVENTO_LID);

    expect(r.conversationId).toBe('conv-nova-1');
    // A conversa nasceu com a etiqueta no metadata; o resultado tem de dizer isso.
    expect(r.identidadeNaoConfirmada).toBe(true);
    // O card não saiu — e isso é aceitável: card a menos, mensagem nenhuma perdida.
    expect(r.dealId).toBeNull();
  });

  it('porta que explode ANTES da conversa existir devolve null — e aí é correto', async () => {
    // `resolverContato` roda antes da criação: não há conversa para preservar.
    const { ports } = montar({ explode: 'resolverContato' });

    const r = await garantirIdentidadeDaConversa(ports, EVENTO_LID);

    expect(r.conversationId).toBeNull();
  });

  it('corrida na criação: relê e segue com a conversa da vencedora', async () => {
    const cen = montar({ criarFalha: 'corrida' });
    // A vencedora gravou a conversa enquanto perdíamos a corrida.
    cen.conversas[CHAT_LID] = { conversationId: 'conv-da-vencedora', contactId: 'contato-1' };

    const r = await garantirIdentidadeDaConversa(cen.ports, EVENTO_LID);

    expect(r.conversationId).toBe('conv-da-vencedora');
    expect(r.reusouConversa).toBe(true);
    // Quem criou já marcou — marcar de novo duplicaria trabalho e ids.
    expect(cen.chamadas).not.toContain('marcarIdentidade');
  });

  it('falha ao criar conversa devolve conversationId null, sem lançar', async () => {
    const { ports } = montar({ criarFalha: 'erro' });

    const r = await garantirIdentidadeDaConversa(ports, EVENTO_LID);

    expect(r.conversationId).toBeNull();
  });

  it('contato irresolvível não impede a conversa (perder contato < perder mensagem)', async () => {
    const { ports, conversasCriadas } = montar({ contato: null });

    const r = await garantirIdentidadeDaConversa(ports, EVENTO_LID);

    expect(r.conversationId).toBe('conv-nova-1');
    expect(r.contactId).toBeNull();
    expect(conversasCriadas[0].contactId).toBeNull();
    // Sem contato não há card — e é assim que já era.
    expect(r.dealId).toBeNull();
  });
});
