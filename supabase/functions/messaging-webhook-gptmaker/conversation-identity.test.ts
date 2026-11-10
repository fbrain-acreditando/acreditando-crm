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
import { resolveContactId, type ContactResolverClient } from './contact';
import { encontrarCardAberto, type DealGuardClient } from './deal-guard';

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
  /** Story 2.63 — `acharConversa` lança SÓ para estas chaves. */
  explodeNaChave?: string[];
  /** Story 2.63 — resultado do alinhamento da chave (padrão: "alinhada"). */
  alinhamento?: 'alinhada' | 'ocupada' | 'nada-a-fazer' | 'falhou';
}

function montar(c: Cenario = {}) {
  const chamadas: string[] = [];
  const conversas: Record<string, ConversaEncontrada> = { ...(c.conversas ?? {}) };
  const marcacoes: Array<Record<string, unknown>> = [];
  const sucessoes: Array<[string, string]> = [];
  const conversasCriadas: Array<Record<string, unknown>> = [];
  const cardsPedidos: Array<Record<string, unknown>> = [];
  const alinhamentos: Array<{ conversationId: string; chaveNova: string; chaveAnterior: string }> = [];
  const chavesProcuradas: string[] = [];
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
      chavesProcuradas.push(chatId);
      if (c.explodeNaChave?.includes(chatId)) throw new Error(`busca por ${chatId} explodiu`);
      return conversas[chatId] ?? null;
    },

    async alinharChave(input) {
      registrar('alinharChave');
      alinhamentos.push(input);
      const r = c.alinhamento ?? 'alinhada';
      if (r === 'alinhada') {
        // Simula o UPDATE: a conversa passa a responder pela chave nova.
        const conv = conversas[input.chaveAnterior];
        delete conversas[input.chaveAnterior];
        conversas[input.chaveNova] = conv;
      }
      return r;
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

  return {
    ports,
    chamadas,
    marcacoes,
    sucessoes,
    conversasCriadas,
    cardsPedidos,
    conversas,
    alinhamentos,
    chavesProcuradas,
  };
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

// =============================================================================
// Story 2.63 — o mesmo telefone com e sem o 9º dígito
// =============================================================================
// ⚠️ Telefones fictícios (o repositório é público).

const PFX = 'CANAL9';
const T13 = '+5511987654321';
const T12 = '+551187654321';
const CHAVE13 = `${PFX}-5511987654321`;
const CHAVE12 = `${PFX}-551187654321`;
const LID_9 = '123456789012345@lid';
const CHAVE_LID_9 = `${PFX}-${LID_9}`;

const evento = (chatId: string, phone: string | null, lid: string | null = null) => ({
  chatId,
  lid,
  contactName: 'Lead Fictício',
  contactPhone: phone,
});

describe('2.63 AC2 — conversa: exata primeiro, variante depois', () => {
  it('evento com 12 dígitos, conversa gravada com 13 ⇒ reusa a de 13', async () => {
    const cen = montar({ conversas: { [CHAVE13]: { conversationId: 'conv-13', contactId: 'contato-lp' } } });

    const r = await garantirIdentidadeDaConversa(cen.ports, evento(CHAVE12, T12));

    expect(r.conversationId).toBe('conv-13');
    expect(r.contactId).toBe('contato-lp');
    expect(r.reusouConversa).toBe(true);
    expect(r.casouPelaVariante).toBe(true);
    expect(cen.conversasCriadas).toHaveLength(0);
    expect(cen.chamadas).not.toContain('resolverContato');
    // A exata foi procurada ANTES da variante.
    expect(cen.chavesProcuradas).toEqual([CHAVE12, CHAVE13]);
  });

  it('evento com 13 dígitos, conversa gravada com 12 ⇒ reusa a de 12', async () => {
    const cen = montar({ conversas: { [CHAVE12]: { conversationId: 'conv-12', contactId: 'contato-wa' } } });

    const r = await garantirIdentidadeDaConversa(cen.ports, evento(CHAVE13, T13));

    expect(r.conversationId).toBe('conv-12');
    expect(r.casouPelaVariante).toBe(true);
    expect(cen.conversasCriadas).toHaveLength(0);
  });

  it('as duas existem ⇒ reusa a EXATA e nem procura a variante', async () => {
    const cen = montar({
      conversas: {
        [CHAVE13]: { conversationId: 'conv-13', contactId: 'c13' },
        [CHAVE12]: { conversationId: 'conv-12', contactId: 'c12' },
      },
    });

    const r = await garantirIdentidadeDaConversa(cen.ports, evento(CHAVE12, T12));

    expect(r.conversationId).toBe('conv-12');
    expect(r.casouPelaVariante).toBe(false);
    expect(cen.chavesProcuradas).toEqual([CHAVE12]);
    expect(cen.alinhamentos).toHaveLength(0);
  });

  it('@lid resolvido para telefone de 12, conversa de 13 ⇒ reusa a de 13', async () => {
    const cen = montar({
      alias: { phone: T12, status: 'resolved' },
      conversas: { [CHAVE13]: { conversationId: 'conv-13', contactId: 'contato-lp' } },
    });

    const r = await garantirIdentidadeDaConversa(cen.ports, evento(CHAVE_LID_9, null, LID_9));

    expect(r.conversationId).toBe('conv-13');
    expect(r.aliasResolvido).toBe(true);
    expect(r.casouPelaVariante).toBe(true);
    // A chave nova é a de telefone derivada do lid (a que o fornecedor usa).
    expect(cen.alinhamentos).toEqual([{ conversationId: 'conv-13', chaveNova: CHAVE12, chaveAnterior: CHAVE13 }]);
    // R1: a busca da conversa ANTIGA do lid (apontarConversaAntiga) é exata —
    // nenhuma variante derivada do rabo do chatId de lid.
    expect(cen.chavesProcuradas).toEqual([CHAVE12, CHAVE13, CHAVE_LID_9]);
  });
});

describe('2.63 AC3 — casou pela variante ⇒ alinha a chave', () => {
  it('pede o alinhamento com a chave do EVENTO e guarda a anterior', async () => {
    const cen = montar({ conversas: { [CHAVE13]: { conversationId: 'conv-13', contactId: 'c' } } });

    await garantirIdentidadeDaConversa(cen.ports, evento(CHAVE12, T12));

    expect(cen.alinhamentos).toEqual([{ conversationId: 'conv-13', chaveNova: CHAVE12, chaveAnterior: CHAVE13 }]);
    // Depois de alinhada, a próxima mensagem acha pela EXATA.
    expect(cen.conversas[CHAVE12]?.conversationId).toBe('conv-13');
  });

  it('chave ocupada ⇒ não troca, mas a conversa é reusada e a mensagem entra', async () => {
    const cen = montar({
      alinhamento: 'ocupada',
      conversas: { [CHAVE13]: { conversationId: 'conv-13', contactId: 'c' } },
    });

    const r = await garantirIdentidadeDaConversa(cen.ports, evento(CHAVE12, T12));

    expect(r.conversationId).toBe('conv-13');
    expect(cen.conversasCriadas).toHaveLength(0);
  });

  it('`alinharChave` explodindo PRESERVA a conversa achada pela variante', async () => {
    const cen = montar({
      explode: 'alinharChave',
      conversas: { [CHAVE13]: { conversationId: 'conv-13', contactId: 'c' } },
    });

    const r = await garantirIdentidadeDaConversa(cen.ports, evento(CHAVE12, T12));

    expect(r.conversationId).toBe('conv-13');
    expect(r.casouPelaVariante).toBe(true);
  });

  it('AC7: o reuso pela variante escreve log identificável, com telefone mascarado', async () => {
    const logs: string[] = [];
    const cen = montar({ conversas: { [CHAVE13]: { conversationId: 'conv-13', contactId: 'c' } } });
    cen.ports.log = (m) => logs.push(m);

    await garantirIdentidadeDaConversa(cen.ports, evento(CHAVE12, T12));

    expect(logs).toContain('[GPTMaker] 9º dígito — conversa achada pela variante 5511*****4321');
  });
});

describe('2.63 AC6 — caminhos que NÃO mudam', () => {
  it('@lid NÃO resolvido: nenhuma variante, identidade continua não confirmada', async () => {
    const cen = montar({ alias: { phone: null, status: null } });

    const r = await garantirIdentidadeDaConversa(cen.ports, evento(CHAVE_LID_9, null, LID_9));

    expect(cen.chavesProcuradas).toEqual([CHAVE_LID_9]);
    expect(r.casouPelaVariante).toBe(false);
    expect(r.identidadeNaoConfirmada).toBe(true);
    expect(cen.marcacoes).toHaveLength(1);
  });

  it('@lid não resolvido com telefone ao lado: a chave é de lid ⇒ não procura variante', async () => {
    const cen = montar({
      alias: { phone: null, status: null },
      conversas: { [CHAVE13]: { conversationId: 'conv-13', contactId: 'c' } },
    });

    const r = await garantirIdentidadeDaConversa(cen.ports, evento(CHAVE_LID_9, T12, LID_9));

    expect(r.conversationId).not.toBe('conv-13');
    expect(cen.chavesProcuradas).toEqual([CHAVE_LID_9]);
  });

  it('telefone fixo: só a busca exata', async () => {
    const cen = montar();

    await garantirIdentidadeDaConversa(cen.ports, evento(`${PFX}-551132215555`, '+551132215555'));

    expect(cen.chavesProcuradas).toEqual([`${PFX}-551132215555`]);
  });

  it('QA-1: 9 + 3 NÃO casa com o número de 12 com cara de fixo (outra pessoa)', async () => {
    const chave13 = `${PFX}-5511933456789`;
    const chaveFixo = `${PFX}-551133456789`;
    const cen = montar({ conversas: { [chaveFixo]: { conversationId: 'conv-do-fixo', contactId: 'outra-pessoa' } } });

    const r = await garantirIdentidadeDaConversa(cen.ports, evento(chave13, '+5511933456789'));

    expect(r.conversationId).toBe('conv-nova-1');
    expect(r.casouPelaVariante).toBe(false);
    expect(cen.chavesProcuradas).toEqual([chave13]);
  });

  it('número estrangeiro: só a busca exata', async () => {
    const cen = montar();

    await garantirIdentidadeDaConversa(cen.ports, evento(`${PFX}-14155552671`, '+14155552671'));

    expect(cen.chavesProcuradas).toEqual([`${PFX}-14155552671`]);
  });

  it('chave que não é do telefone do evento ⇒ não procura variante (não inventa casamento)', async () => {
    const cen = montar({ conversas: { [CHAVE13]: { conversationId: 'conv-13', contactId: 'c' } } });

    const r = await garantirIdentidadeDaConversa(cen.ports, evento(`${PFX}-5511900000000`, T12));

    expect(r.conversationId).toBe('conv-nova-1');
    expect(cen.chavesProcuradas).toEqual([`${PFX}-5511900000000`]);
  });

  it('"nunca lança": erro na busca da VARIANTE ⇒ segue pelo caminho de hoje (cria)', async () => {
    const cen = montar({ explodeNaChave: [CHAVE13] });

    const r = await garantirIdentidadeDaConversa(cen.ports, evento(CHAVE12, T12));

    expect(r.conversationId).toBe('conv-nova-1');
    expect(r.casouPelaVariante).toBe(false);
    expect(cen.conversasCriadas).toHaveLength(1);
    expect(cen.conversasCriadas[0].chatId).toBe(CHAVE12);
  });
});

// =============================================================================
// 2.63 AC4 + AC5 — sequência com o contato da LP (13) e a 1ª mensagem do
// WhatsApp (12). Peças REAIS: `resolveContactId` (contact.ts) e
// `encontrarCardAberto` (deal-guard.ts). O duplo do banco modela a função SQL
// `find_or_create_contact_por_variantes` (exato → variante → cria) com as
// próprias expressões regulares da migration — não com `nono-digito.ts`.
// =============================================================================

interface ContatoLinha {
  id: string;
  phone: string | null;
  deleted_at: string | null;
  merged_into_id: string | null;
}
interface DealLinha {
  id: string;
  contact_id: string;
  board_id: string;
  stage_id: string;
  organization_id: string;
  deleted_at: string | null;
  created_at: string;
}

const ORG_9 = 'org-ficticia';
const LEAD_NOVO_9 = '82d1a222-eeff-4627-baed-881908dbd702';

function bancoFake(contatos: ContatoLinha[], deals: DealLinha[]) {
  let seq = 0;
  const vivo = (c: ContatoLinha, phone: string) =>
    c.phone === phone && c.deleted_at === null && c.merged_into_id === null;

  /** Modelo da função SQL da migration 20261103140000. */
  const rpcClient: ContactResolverClient = {
    async rpc(fn, args) {
      if (fn !== 'find_or_create_contact_por_variantes') {
        return { data: null, error: { message: `função desconhecida: ${fn}` } };
      }
      const phone = (args.p_phone as string | null) ?? null;
      if (!phone) {
        const id = `contato-novo-${++seq}`;
        contatos.push({ id, phone: null, deleted_at: null, merged_into_id: null });
        return { data: [{ contact_id: id, casou_por: 'criado', telefone_casado: null }], error: null };
      }
      let variante: string | null = null;
      const m13 = phone.match(/^\+55(\d{2})9(\d{8})$/);
      const m12 = phone.match(/^\+55(\d{2})([6-9]\d{7})$/);
      if (m13) variante = `+55${m13[1]}${m13[2]}`;
      else if (m12) variante = `+55${m12[1]}9${m12[2]}`;

      const exato = contatos.find((c) => vivo(c, phone));
      if (exato) return { data: [{ contact_id: exato.id, casou_por: 'exato', telefone_casado: phone }], error: null };
      if (variante) {
        const pelaVariante = contatos.find((c) => vivo(c, variante!));
        if (pelaVariante) {
          return {
            data: [{ contact_id: pelaVariante.id, casou_por: 'variante', telefone_casado: variante }],
            error: null,
          };
        }
      }
      const id = `contato-novo-${++seq}`;
      contatos.push({ id, phone, deleted_at: null, merged_into_id: null });
      return { data: [{ contact_id: id, casou_por: 'criado', telefone_casado: phone }], error: null };
    },
    from() {
      throw new Error('insert direto não deveria acontecer neste teste');
    },
  };

  const dealClient = {
    from() {
      return {
        select() {
          const eqs: Array<[string, unknown]> = [];
          const nulos: string[] = [];
          const q = {
            eq(c: string, v: unknown) {
              eqs.push([c, v]);
              return q;
            },
            is(c: string) {
              nulos.push(c);
              return q;
            },
            order() {
              return q;
            },
            async limit(n: number) {
              const r = deals
                .filter((d) => eqs.every(([c, v]) => (d as unknown as Record<string, unknown>)[c] === v))
                .filter((d) => nulos.every((c) => (d as unknown as Record<string, unknown>)[c] === null))
                .slice(0, n);
              return { data: r.map((d) => ({ id: d.id, stage_id: d.stage_id })), error: null };
            },
          };
          return q;
        },
        update() {
          throw new Error('não usado');
        },
      };
    },
  } as unknown as DealGuardClient;

  return { rpcClient, dealClient, contatos, deals };
}

function portasDeSequencia(banco: ReturnType<typeof bancoFake>, logs: string[]) {
  const conversas: Record<string, ConversaEncontrada> = {};
  const criadas: Array<{ chatId: string; contactId: string | null }> = [];
  const ports: ConversationPorts = {
    log: (m) => logs.push(m),
    async resolverAlias() {
      return { phone: null, status: null };
    },
    async acharConversa(chatId) {
      return conversas[chatId] ?? null;
    },
    async alinharChave() {
      return 'alinhada';
    },
    async resolverContato(input) {
      const r = await resolveContactId(
        banco.rpcClient,
        { organizationId: ORG_9, phone: input.phone, name: input.nome ?? '' },
        (m) => logs.push(m)
      );
      return r.contactId;
    },
    async criarConversa(input) {
      const id = `conv-${criadas.length + 1}`;
      criadas.push({ chatId: input.chatId, contactId: input.contactId });
      conversas[input.chatId] = { conversationId: id, contactId: input.contactId };
      return { conversationId: id };
    },
    async regraDeEntrada() {
      return { boardId: BOARD, stageId: LEAD_NOVO_9 };
    },
    async garantirCard(input) {
      const guarda = await encontrarCardAberto(banco.dealClient, {
        organizationId: ORG_9,
        contactId: input.contactId,
        boardId: input.boardId,
      });
      if (guarda.temCardAberto) return guarda.dealId;
      const id = `deal-novo-${banco.deals.length + 1}`;
      banco.deals.push({
        id,
        contact_id: input.contactId,
        board_id: input.boardId,
        stage_id: input.stageId ?? LEAD_NOVO_9,
        organization_id: ORG_9,
        deleted_at: null,
        created_at: '2026-11-03T00:00:00Z',
      });
      return id;
    },
    async marcarIdentidade() {},
    async marcarSucessao() {},
  };
  return { ports, criadas };
}

describe('2.63 AC4/AC5 — contato e card: o reuso pela variante leva a guarda junto', () => {
  it('contato da LP (13) com card em "Lead novo" + 1ª mensagem do WhatsApp (12) ⇒ 0 contatos e 0 cards novos', async () => {
    const banco = bancoFake(
      [{ id: 'contato-lp', phone: T13, deleted_at: null, merged_into_id: null }],
      [
        {
          id: 'deal-lp',
          contact_id: 'contato-lp',
          board_id: BOARD,
          stage_id: LEAD_NOVO_9,
          organization_id: ORG_9,
          deleted_at: null,
          created_at: '2026-11-01T00:00:00Z',
        },
      ]
    );
    const logs: string[] = [];
    const { ports, criadas } = portasDeSequencia(banco, logs);

    const r = await garantirIdentidadeDaConversa(ports, evento(CHAVE12, T12));

    // Conversa NOVA (não havia nenhuma), ligada ao contato da LP.
    expect(criadas).toEqual([{ chatId: CHAVE12, contactId: 'contato-lp' }]);
    expect(r.contactId).toBe('contato-lp');
    // 0 contatos novos; o telefone do contato existente NÃO foi alterado.
    expect(banco.contatos).toEqual([{ id: 'contato-lp', phone: T13, deleted_at: null, merged_into_id: null }]);
    // 0 cards novos; o card continua na mesma etapa.
    expect(r.dealId).toBe('deal-lp');
    expect(banco.deals).toHaveLength(1);
    expect(banco.deals[0].stage_id).toBe(LEAD_NOVO_9);
    // AC7 — o reuso do contato também deixa rastro, mascarado.
    expect(logs).toContain(
      '[GPTMaker] 9º dígito — contato achado pela variante 5511*****4321 (evento com 5511****4321)'
    );
  });

  it('o inverso: contato do WhatsApp (12) + evento com 13 ⇒ reusa o de 12', async () => {
    const banco = bancoFake([{ id: 'contato-wa', phone: T12, deleted_at: null, merged_into_id: null }], []);
    const { ports } = portasDeSequencia(banco, []);

    const r = await garantirIdentidadeDaConversa(ports, evento(CHAVE13, T13));

    expect(r.contactId).toBe('contato-wa');
    expect(banco.contatos).toHaveLength(1);
  });

  it('nenhuma forma existe ⇒ 1 contato novo, com o telefone COMO VEIO', async () => {
    const banco = bancoFake([], []);
    const { ports } = portasDeSequencia(banco, []);

    const r = await garantirIdentidadeDaConversa(ports, evento(CHAVE12, T12));

    expect(banco.contatos).toHaveLength(1);
    expect(banco.contatos[0].phone).toBe(T12);
    expect(r.contactId).toBe(banco.contatos[0].id);
    expect(banco.deals).toHaveLength(1);
  });

  it('contato da variante MESCLADO não é reusado ⇒ cria (mesmos filtros de hoje)', async () => {
    const banco = bancoFake(
      [{ id: 'contato-morto', phone: T13, deleted_at: null, merged_into_id: 'outro' }],
      []
    );
    const { ports } = portasDeSequencia(banco, []);

    const r = await garantirIdentidadeDaConversa(ports, evento(CHAVE12, T12));

    expect(r.contactId).not.toBe('contato-morto');
    expect(banco.contatos).toHaveLength(2);
  });
});

// =============================================================================
// Story 2.73 — chave `public-api-…`: nenhuma porta é chamada
// =============================================================================
//
// A nota gravada pela API pública da IA do WhatsApp (`add-message`) voltava com
// a chave `public-api-{workspace}-{canal}-{telefone}` e criava contato + conversa
// + card falsos em "Lead novo" (160 em 10/11). Na variante `@lid`, ainda gravava
// um apelido `api-…@lid` (8 apagados na limpeza). Estrutura medida no banco;
// telefones e lids fictícios.

const WS_273 = '3E12E22DF12D30FBB326262F356E288B';
const CANAL_273 = '3E14B10711E1C0FE16B42EC236EAE1D6';
const TEL_273 = '5511900001486'; // fictício
const LID_273 = '150439900001486@lid'; // fictício
const PUBLIC_TEL_273 = `public-api-${WS_273}-${CANAL_273}-${TEL_273}`;
const PUBLIC_LID_273 = `public-api-${WS_273}-${CANAL_273}-${LID_273}`;
const REAL_TEL_273 = `${CANAL_273}-${TEL_273}`;

/** O que o parser de hoje produz para cada variante (ver `parser.ts`). */
const EVENTOS_PUBLIC_API: Array<{ nome: string; evento: Parameters<typeof garantirIdentidadeDaConversa>[1] }> = [
  {
    nome: 'chave de telefone, sem nome e sem telefone (o caso medido)',
    evento: { chatId: PUBLIC_TEL_273, lid: null, contactName: null, contactPhone: null },
  },
  {
    nome: 'chave de telefone COM nome e telefone no evento',
    evento: { chatId: PUBLIC_TEL_273, lid: null, contactName: 'Cliente Fictício', contactPhone: `+${TEL_273}` },
  },
  {
    // `recipientFromContextId` corta no 1º hífen ⇒ o lid vira `api-…@lid`.
    nome: 'variante @lid (lid = "api-…@lid", como o parser extrai)',
    evento: {
      chatId: PUBLIC_LID_273,
      lid: `api-${WS_273}-${CANAL_273}-${LID_273}`,
      contactName: null,
      contactPhone: null,
    },
  },
  {
    nome: 'variante @lid COM telefone no evento',
    evento: {
      chatId: PUBLIC_LID_273,
      lid: `api-${WS_273}-${CANAL_273}-${LID_273}`,
      contactName: null,
      contactPhone: `+${TEL_273}`,
    },
  },
  {
    nome: 'malformada (AC6): "public-api-"',
    evento: { chatId: 'public-api-', lid: null, contactName: null, contactPhone: null },
  },
  {
    nome: 'malformada (AC6): "public-api-ABC"',
    evento: { chatId: 'public-api-ABC', lid: null, contactName: null, contactPhone: null },
  },
];

describe('2.73 AC2 — chave public-api-… nunca cria contato, conversa, card nem apelido', () => {
  for (const caso of EVENTOS_PUBLIC_API) {
    it(caso.nome, async () => {
      const m = montar({ alias: { phone: `+${TEL_273}`, status: 'resolved' } });
      const logs: string[] = [];
      m.ports.log = (msg) => logs.push(msg);

      const r = await garantirIdentidadeDaConversa(m.ports, caso.evento);

      // 🔴 Nenhuma porta: nem busca, nem alias, nem contato, nem conversa, nem card.
      expect(m.chamadas).toEqual([]);
      expect(m.conversasCriadas).toEqual([]);
      expect(m.cardsPedidos).toEqual([]);
      expect(m.marcacoes).toEqual([]);
      expect(m.sucessoes).toEqual([]);
      expect(m.chavesProcuradas).toEqual([]);

      expect(r.ignoradoPorChavePublicApi).toBe(true);
      expect(r.conversationId).toBeNull();
      expect(r.contactId).toBeNull();
      expect(r.dealId).toBeNull();
      expect(r.reusouConversa).toBe(false);
      expect(r.chatIdUsado).toBe(caso.evento.chatId);

      // AC4 — o rastro sai no log, com telefone mascarado.
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatch(/^\[GPTMaker\] public-api — evento ignorado/);
      expect(logs[0]).not.toContain(TEL_273);
      expect(logs[0]).not.toContain('150439900001486');
    });
  }

  it('o log da chave completa aponta a conversa real com os 4 últimos dígitos', async () => {
    const m = montar();
    const logs: string[] = [];
    m.ports.log = (msg) => logs.push(msg);

    await garantirIdentidadeDaConversa(m.ports, EVENTOS_PUBLIC_API[0].evento);

    expect(logs).toEqual([
      `[GPTMaker] public-api — evento ignorado (conversa real ${CANAL_273}-…1486)`,
    ]);
  });
});

describe('2.73 AC3 — também não toca a conversa real', () => {
  it('conversa {canal}-{telefone} existe ⇒ não é procurada nem devolvida', async () => {
    const m = montar({
      conversas: { [REAL_TEL_273]: { conversationId: 'conv-real', contactId: 'contato-real' } },
    });

    const r = await garantirIdentidadeDaConversa(m.ports, EVENTOS_PUBLIC_API[1].evento);

    // Sem conversa devolvida, o chamador não insere mensagem, não muda prévia e
    // não move card.
    expect(r.conversationId).toBeNull();
    expect(r.ignoradoPorChavePublicApi).toBe(true);
    expect(m.chavesProcuradas).toEqual([]);
    expect(m.conversas[REAL_TEL_273]).toEqual({ conversationId: 'conv-real', contactId: 'contato-real' });
    expect(m.alinhamentos).toEqual([]);
  });
});

describe('2.73 AC5 — o fluxo normal não muda', () => {
  it('chave {canal}-{telefone} nova ⇒ cria contato, conversa e card como hoje', async () => {
    const m = montar();

    const r = await garantirIdentidadeDaConversa(m.ports, {
      chatId: REAL_TEL_273,
      lid: null,
      contactName: 'Cliente Fictício',
      contactPhone: `+${TEL_273}`,
    });

    expect(r.ignoradoPorChavePublicApi).toBe(false);
    expect(r.conversationId).toBe('conv-nova-1');
    expect(r.dealId).toBe('deal-1');
    expect(m.conversasCriadas).toHaveLength(1);
    expect(m.conversasCriadas[0]).toMatchObject({ chatId: REAL_TEL_273, phone: `+${TEL_273}` });
    expect(m.cardsPedidos).toHaveLength(1);
    expect(m.cardsPedidos[0]).toMatchObject({ titulo: 'Cliente Fictício' });
  });

  it('chave {canal}-{n}@lid sem alias ⇒ cria conversa e card e marca identidade como hoje', async () => {
    const m = montar();

    const r = await garantirIdentidadeDaConversa(m.ports, {
      chatId: `${CANAL_273}-${LID_273}`,
      lid: LID_273,
      contactName: null,
      contactPhone: null,
    });

    expect(r.ignoradoPorChavePublicApi).toBe(false);
    expect(r.conversationId).toBe('conv-nova-1');
    expect(r.identidadeNaoConfirmada).toBe(true);
    expect(m.chamadas[0]).toBe('resolverAlias');
    expect(m.marcacoes).toHaveLength(1);
    expect(m.marcacoes[0]).toMatchObject({ alias: LID_273, motivo: MOTIVO_SEM_TELEFONE });
  });

  it('busca pela variante do 9º dígito continua igual (12 no evento, 13 gravada)', async () => {
    const chave13 = `${CANAL_273}-5511987651486`;
    const chave12 = `${CANAL_273}-551187651486`;
    const m = montar({ conversas: { [chave13]: { conversationId: 'conv-13', contactId: 'c-13' } } });

    const r = await garantirIdentidadeDaConversa(m.ports, {
      chatId: chave12,
      lid: null,
      contactName: null,
      contactPhone: '+551187651486',
    });

    expect(r.ignoradoPorChavePublicApi).toBe(false);
    expect(r.conversationId).toBe('conv-13');
    expect(r.casouPelaVariante).toBe(true);
    expect(m.chavesProcuradas).toEqual([chave12, chave13]);
  });
});
