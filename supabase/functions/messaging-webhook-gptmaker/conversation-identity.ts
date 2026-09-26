/**
 * A decisão de QUAL conversa/contato/card este evento pertence — story 2.56.
 *
 * ## Por que este módulo existe (achado ALTA-1 do @qa, 25/09)
 *
 * A primeira versão da 2.56 pôs a decisão dentro do `ensureConversation` do
 * `index.ts`. Os testes cobriam os módulos puros (`alias-map`, `deal-guard`),
 * mas **a sequência real não era testada por ninguém** — e o `index.ts` está no
 * `exclude` do `tsconfig.json`, ou seja, nem o `tsc` olhava.
 *
 * O estrago possível é o pior desta família: um `throw` na fiação faz o handler
 * cair no `catch`, responder **200** ao fornecedor (para evitar retry storm) e
 * **nunca inserir a mensagem**. Sem retry, sem erro visível. É exatamente o
 * pecado que a story 2.53 documentou: engolir mensagem em silêncio.
 *
 * Então a decisão mudou de lugar. Aqui ela é pura: recebe **portas**
 * (`ConversationPorts`) e devolve o que fazer. O `index.ts` vira o adaptador
 * que liga cada porta ao Supabase — e a sequência passa a ter teste.
 *
 * ## A sequência, na ordem em que acontece
 *
 * 1. `@lid` conhecido? → resolve para o telefone **antes** de procurar qualquer
 *    coisa (AC2). Só `status = 'resolved'` resolve.
 * 2. Acha a conversa pela chave efetiva (telefone quando resolveu, lid quando
 *    não). Achou ⇒ acabou.
 * 3. Não achou ⇒ resolve o contato, cria a conversa, aplica a regra de entrada
 *    de leads (que passa pela guarda de card aberto do AC3).
 * 4. Lid que **não** resolveu ⇒ marca identidade não confirmada (AC4 / D2 = B).
 * 5. Lid que resolveu e tinha conversa antiga ⇒ deixa um **ponteiro** na antiga
 *    (`sucedida_por`), para ela não emudecer sem nada apontando para a nova.
 *
 * ## 🔴 Contrato inegociável: NUNCA lança
 *
 * Nenhuma porta pode derrubar esta função. Falha em porta acessória (marcação,
 * sucessão, card) é registrada e a conversa continua. A única coisa que faz a
 * função devolver `conversationId: null` é não conseguir criar a conversa — e
 * aí o chamador ainda grava o que der, nunca descarta o evento.
 *
 * @module supabase/functions/messaging-webhook-gptmaker/conversation-identity
 */

import { MOTIVO_AMBIGUO, MOTIVO_SEM_TELEFONE, type AliasStatus } from "./alias-map.ts";
import { chatIdPorTelefone } from "./parser.ts";

export interface IdentityEvent {
  chatId: string;
  lid: string | null;
  contactName: string | null;
  contactPhone: string | null;
}

export interface ConversaEncontrada {
  conversationId: string;
  contactId: string | null;
}

/**
 * As portas. Cada uma é uma operação de banco que o `index.ts` liga ao Supabase.
 *
 * ⚠️ Todas devem **absorver o próprio erro** e devolver um valor — a função
 * orquestradora envolve tudo em try/catch como segunda camada, não como a
 * primeira.
 */
export interface ConversationPorts {
  /** AC2 — o alias resolve para telefone? Só `resolved` devolve telefone. */
  resolverAlias(alias: string): Promise<{ phone: string | null; status: AliasStatus | null }>;
  /** Conversa por `(channel_id, external_contact_id)`. */
  acharConversa(chatId: string): Promise<ConversaEncontrada | null>;
  /** Contato por telefone (ou criação). `null` quando nem isso deu. */
  resolverContato(input: { phone: string | null; nome: string | null }): Promise<string | null>;
  /**
   * Cria a conversa. `corrida: true` quando outra entrega ganhou — o chamador
   * relê com `acharConversa`.
   */
  criarConversa(input: {
    chatId: string;
    contactId: string | null;
    nome: string | null;
    phone: string | null;
    lid: string | null;
    identidadeNaoConfirmada: boolean;
  }): Promise<{ conversationId: string } | { corrida: true } | { erro: string }>;
  /** Regra de "Entrada de Leads" do canal. `null` = canal não cria card. */
  regraDeEntrada(): Promise<{ boardId: string; stageId: string | null } | null>;
  /** AC3 — cria o card OU reusa o aberto. Devolve o id, ou `null` se não deu. */
  garantirCard(input: {
    contactId: string;
    boardId: string;
    stageId: string | null;
    conversationId: string;
    titulo: string;
  }): Promise<string | null>;
  /** AC4 — grava a marcação de identidade não confirmada. */
  marcarIdentidade(input: {
    alias: string;
    motivo: string;
    conversationId: string;
    dealId: string | null;
  }): Promise<void>;
  /**
   * MÉDIA-2 — deixa o ponteiro `sucedida_por` na conversa antiga do lid.
   *
   * Medido em 23/09: **93 dos 94 lids resolvidos não têm conversa gêmea** por
   * telefone. Ou seja, o caso COMUM do AC2 é nascer uma conversa nova e a `@lid`
   * emudecer. Sem o ponteiro, quem abrir a antiga não tem como saber para onde
   * a conversa foi.
   */
  marcarSucessao(conversationIdAntiga: string, conversationIdNova: string): Promise<void>;
  log(msg: string): void;
}

export interface IdentityOutcome {
  conversationId: string | null;
  contactId: string | null;
  dealId: string | null;
  /** A chave que acabou sendo usada — telefone quando o alias resolveu. */
  chatIdUsado: string;
  aliasResolvido: boolean;
  /** A conversa já existia? (Nesse caso nada é criado nem marcado.) */
  reusouConversa: boolean;
  identidadeNaoConfirmada: boolean;
}

/** Nome mostrado na conversa/card. Sem nome e sem telefone, sobra a chave. */
function titulo(event: IdentityEvent, chatId: string): string {
  return event.contactName ?? event.contactPhone ?? chatId;
}

/**
 * O que já foi conquistado até o ponto em que a execução chegou.
 *
 * 🔴 **Existe por causa de um furo real** — achado ALTA-1b do @qa (26/09), provado
 * com teste: o `catch` de segunda camada montava um resultado **do zero** e, se
 * uma porta ACESSÓRIA explodisse **depois** da conversa já existir no banco
 * (`regraDeEntrada`, `garantirCard`, `marcarIdentidade`, `marcarSucessao`), o
 * `conversationId` recém-criado era **descartado**. E `ensureConversation`
 * **lança** quando ele vem `null` ⇒ handler responde 200 ⇒ **mensagem nunca
 * inserida**. Exatamente o desfecho que este módulo foi criado para impedir.
 *
 * Era latente (nenhum adaptador de hoje lança), mas "impossível por construção"
 * não pode depender de os adaptadores se comportarem. Agora o progresso vive
 * aqui, fora do `try`, e o `catch` **devolve o que já foi conquistado**.
 */
interface ProgressoParcial {
  conversationId: string | null;
  contactId: string | null;
  dealId: string | null;
  chatIdUsado: string;
  aliasResolvido: boolean;
  reusouConversa: boolean;
  identidadeNaoConfirmada: boolean;
}

/**
 * Resolve identidade, garante conversa/contato/card e devolve o que aconteceu.
 *
 * **Nunca lança** — e, quando algo quebra no meio, devolve o que **já** existe no
 * banco em vez de zerar o resultado.
 */
export async function garantirIdentidadeDaConversa(
  ports: ConversationPorts,
  event: IdentityEvent
): Promise<IdentityOutcome> {
  const progresso: ProgressoParcial = {
    conversationId: null,
    contactId: null,
    dealId: null,
    chatIdUsado: event.chatId,
    aliasResolvido: false,
    reusouConversa: false,
    identidadeNaoConfirmada: false,
  };

  try {
    return await decidir(ports, event, progresso);
  } catch (e) {
    // Segunda camada. Alguma porta quebrou o contrato de não lançar.
    ports.log(
      `[GPTMaker] identidade — erro inesperado após ${
        progresso.conversationId ? `criar/achar a conversa ${progresso.conversationId}` : "nenhum passo"
      } (o evento segue): ${e instanceof Error ? e.message : String(e)}`
    );
    // 🔴 Devolve o PROGRESSO, não um resultado zerado. Se a conversa já existe,
    // a mensagem tem onde entrar — e é isso que impede engolir mensagem.
    return { ...progresso };
  }
}

async function decidir(
  ports: ConversationPorts,
  event: IdentityEvent,
  progresso: ProgressoParcial
): Promise<IdentityOutcome> {
  // ---------------------------------------------------------------------------
  // 1. `@lid` → telefone, ANTES de procurar conversa e contato (AC2)
  // ---------------------------------------------------------------------------
  let chatId = event.chatId;
  let phone = event.contactPhone;
  let aliasResolvido = false;
  let statusDoAlias: AliasStatus | null = null;

  if (event.lid) {
    const lookup = await ports.resolverAlias(event.lid);
    statusDoAlias = lookup.status;

    if (lookup.phone) {
      const chatIdDoTelefone = chatIdPorTelefone(event.chatId, lookup.phone);
      if (chatIdDoTelefone) {
        ports.log(
          `[GPTMaker] alias "${event.lid}" resolvido → ${lookup.phone}; conversa chaveada por telefone (${chatIdDoTelefone})`
        );
        chatId = chatIdDoTelefone;
        phone = lookup.phone;
        aliasResolvido = true;
      }
    }
  }

  const precisaMarcar = !!event.lid && !aliasResolvido;
  const eventoEfetivo: IdentityEvent = { ...event, chatId, contactPhone: phone };

  // Progresso: a chave efetiva já está decidida.
  progresso.chatIdUsado = chatId;
  progresso.aliasResolvido = aliasResolvido;

  // ---------------------------------------------------------------------------
  // 2. A conversa já existe?
  // ---------------------------------------------------------------------------
  const existente = await ports.acharConversa(chatId);
  if (existente) {
    // 🔴 Registra ANTES de chamar a porta acessória: se `marcarSucessao` explodir,
    // o `catch` ainda devolve a conversa que já existe.
    progresso.conversationId = existente.conversationId;
    progresso.contactId = existente.contactId;
    progresso.reusouConversa = true;

    // Mesmo reusando, a conversa antiga do lid precisa do ponteiro (MÉDIA-2).
    await apontarConversaAntiga(ports, event, aliasResolvido, existente.conversationId);
    return { ...progresso };
  }

  // ---------------------------------------------------------------------------
  // 3. Contato + conversa
  // ---------------------------------------------------------------------------
  const contactId = await ports.resolverContato({
    phone: eventoEfetivo.contactPhone,
    nome: eventoEfetivo.contactName,
  });
  progresso.contactId = contactId;

  const criada = await ports.criarConversa({
    chatId,
    contactId,
    nome: eventoEfetivo.contactName,
    phone: eventoEfetivo.contactPhone,
    lid: event.lid,
    identidadeNaoConfirmada: precisaMarcar,
  });

  if ("corrida" in criada) {
    // Outra entrega do mesmo contato ganhou (medido em 137 ms na story 2.6):
    // relê e segue com a dela. Nada é marcado de novo — quem criou já marcou.
    const relida = await ports.acharConversa(chatId);
    if (relida) {
      ports.log(`[GPTMaker] Conversa criada em paralelo, reusando: ${relida.conversationId}`);
      progresso.conversationId = relida.conversationId;
      progresso.contactId = relida.contactId;
      progresso.reusouConversa = true;
      await apontarConversaAntiga(ports, event, aliasResolvido, relida.conversationId);
      return { ...progresso };
    }
    ports.log("[GPTMaker] Corrida na criação da conversa, mas a releitura não achou nada");
    return { ...progresso };
  }

  if ("erro" in criada) {
    ports.log(`[GPTMaker] Falha ao criar conversa: ${criada.erro}`);
    return { ...progresso };
  }

  const conversationId = criada.conversationId;
  // 🔴 A conversa EXISTE no banco a partir daqui. Qualquer explosão adiante não
  // pode mais fazer o chamador achar que não há conversa.
  progresso.conversationId = conversationId;
  progresso.identidadeNaoConfirmada = precisaMarcar;

  // ---------------------------------------------------------------------------
  // 4. Card — passa pela guarda de card aberto do AC3
  // ---------------------------------------------------------------------------
  let dealId: string | null = null;
  if (contactId) {
    const regra = await ports.regraDeEntrada();
    if (regra) {
      dealId = await ports.garantirCard({
        contactId,
        boardId: regra.boardId,
        stageId: regra.stageId,
        conversationId,
        titulo: titulo(eventoEfetivo, chatId),
      });
      progresso.dealId = dealId;
    }
  }

  // ---------------------------------------------------------------------------
  // 5. Identidade não confirmada (AC4 / D2 = B) e ponteiro da antiga (MÉDIA-2)
  // ---------------------------------------------------------------------------
  if (precisaMarcar && event.lid) {
    await ports.marcarIdentidade({
      alias: event.lid,
      motivo: statusDoAlias === "ambiguous" ? MOTIVO_AMBIGUO : MOTIVO_SEM_TELEFONE,
      conversationId,
      dealId,
    });
  }

  await apontarConversaAntiga(ports, event, aliasResolvido, conversationId);

  return { ...progresso };
}

/**
 * Deixa `sucedida_por` na conversa antiga do lid — MÉDIA-2.
 *
 * Só faz sentido quando o alias resolveu (a chave mudou) E a conversa antiga do
 * lid existe E é OUTRA. Apontar uma conversa para ela mesma seria ruído.
 */
async function apontarConversaAntiga(
  ports: ConversationPorts,
  event: IdentityEvent,
  aliasResolvido: boolean,
  conversationIdNova: string
): Promise<void> {
  if (!aliasResolvido || !event.lid) return;

  const antiga = await ports.acharConversa(event.chatId);
  if (!antiga || antiga.conversationId === conversationIdNova) return;

  ports.log(
    `[GPTMaker] conversa ${antiga.conversationId} (lid "${event.lid}") sucedida por ${conversationIdNova}`
  );
  await ports.marcarSucessao(antiga.conversationId, conversationIdNova);
}
