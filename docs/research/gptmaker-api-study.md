# Estudo da API GPT Maker — integração como canal do CRM

> **Autor:** squad API Hunter (@api-chief) · **Data:** 2026-07-24
> **Fonte:** https://developer.gptmaker.ai/api-reference/introduction + OpenAPI completo (`/api-reference/openapi.json`, 57 rotas)
> **Objetivo:** avaliar a API do GPT Maker e desenhar a integração com o CRM Acreditando
> (Configurações → Integrações → Canais · aba Mensagens · Entrada de Leads).

---

## 1. Contexto de negócio (por que essa integração importa)

O **WhatsApp do Acreditando já roda no GPT Maker** — é a "Assistente Virtual do Acreditando"
(ver `IA Atendimento Acreditando (GPTMaker)` no vault). O desenho combinado na reunião de 16/07 é:

```
Lead no WhatsApp → IA do GPTMaker coleta (nome, lesão, tempo, região) → TRANSFERE pra Fernanda
                                                                              ↓
                                          [BURACO ATUAL] Fernanda classifica no olho, sem CRM
```

O CRM foi construído justamente para fechar esse buraco (scoring/estrelas, origem do lead, funil).
**Esta integração é o elo que faltava** — não é "mais um canal", é a entrada real de leads do Centro.

> ⚠️ **A conta do GPT Maker é PRODUÇÃO VIVA.** É o número que a Fernanda usa para atender.
> Qualquer teste toca o atendimento real. Ver seção 7 (riscos operacionais).

---

## 2. Ficha técnica da API

| Item | Valor |
|---|---|
| **Base URL** | `https://api.gptmaker.ai` |
| **Versão** | `/v2` (fixa no path) |
| **Autenticação** | `Authorization: Bearer <token>` — token único do workspace |
| **Onde pegar o token** | https://app.gptmaker.ai/browse/developers |
| **Formato** | REST + JSON |
| **OpenAPI** | ✅ completo (57 rotas) em `/api-reference/openapi.json` |
| **Rate limits** | ❌ não documentados |
| **Formato de erro** | ❌ não documentado |
| **Assinatura de webhook (HMAC)** | ❌ não existe |
| **Payload dos webhooks** | ❌ **não documentado** (nem no OpenAPI, nem nas docs) |
| **Sandbox / ambiente de teste** | ❌ não documentado |

### Hierarquia de entidades

```
Workspace
 └── Agent (a IA — prompt, modelo, treinamentos, intenções, webhooks)
      └── Channel (WHATSAPP, CLOUD_API, INSTAGRAM, TELEGRAM, WIDGET,
                   MESSENGER, MERCADO_LIVRE, TWILIO_SMS, Z_API)
           └── Chat (conversa com um contato)
                └── Message
           └── Interaction (o "atendimento" — sessão com começo e fim)
```

**Ponto crítico de modelagem:** os **webhooks são configurados por AGENTE, não por canal**
(`PUT /v2/agent/{agentId}/webhooks`). Se um agente atende vários canais, **todos os eventos caem
na mesma URL** — a desambiguação precisa vir do payload.

---

## 3. Endpoints relevantes para o CRM

### 3.1 Descoberta e canais

| Método | Rota | Uso no CRM |
|---|---|---|
| `GET` | `/v2/workspaces` | Descobrir o `workspaceId` no wizard |
| `GET` | `/v2/workspace/{workspaceId}/agents` | Listar agentes para o usuário escolher |
| `GET` | `/v2/workspace/{workspaceId}/channels` | Listar canais (`id`, `type`, `connected`, `username`, `agentId`) → é o que popula o seletor do wizard |
| `GET` | `/v2/channel/{channelId}/qr-code` | Reaproveita a UI de QR code que já existe |
| `GET`/`PUT` | `/v2/channel/{channelId}/config` | Config do canal |

**Resposta de `GET /v2/workspace/{id}/channels`:**
```json
{ "data": [{ "id": "...", "name": "...", "type": "WHATSAPP",
             "agentId": "...", "agentName": "...", "connected": true,
             "username": "5511999999999", "facebookPageId": null }],
  "count": 10 }
```
→ `connected: boolean` alimenta direto o `ChannelStatus` do CRM (`connected` / `disconnected`).

### 3.2 Conversas e mensagens

| Método | Rota | Uso no CRM |
|---|---|---|
| `GET` | `/v2/workspace/{workspaceId}/chats` | Backfill / reconciliação (filtra por `agentId`, pagina, busca) |
| `GET` | `/v2/chat/{chatId}/messages` | **Puxar o histórico da conversa** — é o insumo do scoring por estrelas |
| `POST` | `/v2/chat/{chatId}/send-message` | Responder pelo CRM (texto, imagem, áudio, vídeo, documento) |
| `PUT` | `/v2/chat/{chatId}/start-human` | **Assumir o atendimento** (pausa a IA do GPTMaker) |
| `PUT` | `/v2/chat/{chatId}/stop-human` | Devolver o atendimento para a IA |
| `POST` | `/v2/channel/{channelId}/start-conversation` | Mensagem ativa por telefone (**só WhatsApp não oficial**) |
| `GET` | `/v2/workspace/{workspaceId}/interactions` | Listar atendimentos (sessões) |

**Campos úteis do chat:** `id`, `name`, `whatsappPhone`, `recipient`, `humanTalk` (se está com
humano), `finished`, `unReadCount`, `userName`, `picture`, `createdAt`, `time`.

### 3.3 Contatos e campos customizados

| Método | Rota | Uso no CRM |
|---|---|---|
| `GET` | `/v2/workspace/{workspaceId}/search` | Buscar contatos |
| `GET` | `/v2/workspace/{workspaceId}/contact/{contactId}` | Dados do contato + `customFieldValues` |
| `PUT` | `/v2/contact/{contactId}/update` | **Escrever de volta no GPTMaker** |
| `GET`/`POST` | `/v2/custom-field/workspace/{workspaceId}` | Criar/listar campos customizados |

> 💡 **Oportunidade:** o CRM pode gravar a **estrela (1–5)** e o **estágio do funil** de volta como
> *custom field* no contato do GPTMaker — a Fernanda vê a classificação dentro da ferramenta que
> ela já usa, sem precisar abrir o CRM. Fica para uma fase posterior, mas o caminho existe.

### 3.4 Webhooks (o ponto fraco)

`GET` / `PUT /v2/agent/{agentId}/webhooks` — 8 eventos, cada um é **só uma string com a URL**:

| Evento | Quando dispara | Valor para o CRM |
|---|---|---|
| `onFirstInteraction` | primeiro atendimento com o cliente | 🔥 **lead novo** → criar contato + deal |
| `onTransfer` | a IA transfere para humano | 🔥🔥 **lead qualificado** → é o gatilho do desenho de 16/07 |
| `onNewMessage` | toda mensagem nova em qualquer chat | inbox em tempo real (volume alto) |
| `onStartInteraction` | início de cada atendimento | reabertura de conversa |
| `onFinishInteraction` | atendimento finalizado | fechar conversa / disparar scoring |
| `onLackKnowLedge` | a IA não soube responder | alerta de gap de treinamento |
| `onCreateEvent` / `onCancelEvent` | agendamento criado/cancelado | agenda (fora de escopo agora) |

**❌ O formato do payload de cada evento NÃO está documentado em lugar nenhum.**
Sem isso, não dá para escrever o parser do inbound com confiança. → Ver Fase 0 (seção 6).

---

## 4. Avaliação (framework API Hunter)

| Critério | Nota | Justificativa |
|---|---|---|
| **Documentação** | ⭐⭐ (2/3) | OpenAPI completo e navegável, mas **sem payload de webhook, sem rate limit, sem catálogo de erros** |
| **Custo** | ⭐⭐⭐ (3/3) | Zero custo marginal — a conta já é paga e usada pelo Acreditando |
| **Facilidade de integração** | ⭐⭐ (2/3) | REST + Bearer é trivial; o inbound é que é incerto |
| **Confiabilidade / robustez** | ⭐ (1/3) | Sem HMAC, sem ID de mensagem no envio, sem status de entrega, sem idempotência declarada |
| **Aderência ao caso de uso** | ⭐⭐⭐ (3/3) | `onTransfer` + `start-human` + histórico do chat é **exatamente** o fluxo que o Acreditando precisa |

### 🎯 Score: **68/100** — *aprovada com ressalvas*

> Acima do veto do framework (40). Não é uma API de primeira linha, mas **é a API do sistema que
> já está em produção no cliente** — não há alternativa a avaliar. A decisão real não é "usar ou
> não", é **quanto** do fluxo delegar a ela.

---

## 5. Armadilhas confirmadas (o que vai doer)

| # | Armadilha | Impacto | Mitigação |
|---|---|---|---|
| 1 | **Payload dos webhooks não documentado** | 🔴 Bloqueia o inbound | **Fase 0 de captura** (seção 6) |
| 2 | **Webhook é por agente, não por canal** | 🟠 Um endpoint recebe eventos de vários canais | Resolver o canal pelo payload (`channelId`/`chatId`) e cair no canal certo do CRM; se não vier, 1 agente = 1 canal no CRM |
| 3 | **Sem assinatura HMAC** | 🟠 Qualquer um com a URL injeta lead falso | Segredo na URL (`?key=`) + `timingSafeEqual` — **mesmo padrão já usado no webhook da Evolution** |
| 4 | **`send-message` retorna só `{success:true}`** | 🟠 Sem `externalMessageId` → quebra dedupe e status do CRM | Gerar ID sintético (`gptmaker:{chatId}:{timestamp}`) e reconciliar depois via `GET /chat/{id}/messages` |
| 5 | **Sem status de entrega** (sent/delivered/read) | 🟡 Badge de status fica limitado | Marcar como `sent` e parar aí; não prometer "entregue"/"lido" na UI |
| 6 | **`start-conversation` só em WhatsApp não oficial** e não devolve `chatId` | 🟡 Mensagem ativa fica cega | Disparar e reconciliar via `GET /workspace/{id}/chats` |
| 7 | **Rate limit desconhecido** | 🟡 Risco em backfill | Paginar com `pageSize` conservador + backoff exponencial |
| 8 | **Sem sandbox** | 🔴 **Todo teste é em produção** | Testar em horário combinado, com o número pessoal do Filipe, e avisar a Fernanda antes |

---

## 6. Fase 0 — descoberta do payload (mata o bloqueio #1)

Não dá para escrever o parser adivinhando. O caminho honesto, e que respeita a **Rule 7 (read-back)**:

1. Subir a edge function `messaging-webhook-gptmaker` em **modo captura**: grava o corpo cru em
   `messaging_webhook_events` (`processed: false`) e responde `200` — **sem processar nada**.
2. Apontar 1 webhook do agente (`onFirstInteraction`, o de menor volume) para essa URL, via
   `PUT /v2/agent/{agentId}/webhooks`.
3. Mandar **1 mensagem de teste** do celular do Filipe para o WhatsApp do Acreditando.
4. Ler o payload real gravado no banco → **só então** escrever os tipos e o parser.
5. Repetir para `onTransfer` e `onNewMessage`.

Custo: ~30 min. Elimina 100% da adivinhação e produz a documentação que o fornecedor não tem
(que vira `docs/webhooks.md` — payload real, com exemplo).

---

## 7. Modelos de integração avaliados

### Modelo A — Canal completo (o CRM vira a inbox do GPTMaker)
Todas as mensagens entram no CRM via `onNewMessage`; a Fernanda responde pelo CRM
(`start-human` + `send-message`); deal criado pela `lead_routing_rule`.

- ✅ Encaixe perfeito na arquitetura existente (provider + edge function + routing rule)
- ✅ Uma inbox só para todos os canais
- ❌ Depende do payload de `onNewMessage` (volume alto, evento mais arriscado)
- ❌ Duas telas mostram a mesma conversa (GPTMaker e CRM) — risco de atendimento duplicado
- ❌ Duas IAs no mesmo diálogo (a do GPTMaker e a do CRM) sem regra de quem manda

### Modelo B — Só entrada de leads (handoff)
Apenas `onTransfer` + `onFirstInteraction` criam contato + deal no funil da Fernanda, com o
histórico puxado por `GET /chat/{id}/messages`. O atendimento continua no GPTMaker.

- ✅ **É literalmente o desenho combinado em 16/07** (IA coleta → CRM roteia e pontua)
- ✅ Risco operacional baixíssimo — não toca no atendimento da Fernanda
- ✅ Entrega o scoring por estrelas e a origem do lead (o valor real)
- ❌ Não usa a inbox do CRM; responder segue fora

### Modelo C — Híbrido, em 2 fases ✅ **RECOMENDADO**
Um provider `gptmaker` completo, com um **switch por canal**:
`Somente entrada de leads` ⟷ `Atendimento no CRM`.

- **Fase 1** entrega o Modelo B (seguro, valor imediato, testável sem mexer no atendimento).
- **Fase 2** liga o envio (`start-human` + `send-message`) quando o payload do `onNewMessage`
  estiver mapeado e validado em produção.
- ✅ Não pinta o CRM em um canto: a arquitetura de provider é a mesma dos outros 4 canais
- ✅ O Filipe decide quando (e se) migrar o atendimento para dentro do CRM

---

## 8. Encaixe na arquitetura atual do CRM (o que já existe e vai ser reusado)

| Peça existente | Como entra na integração |
|---|---|
| `lib/messaging/channel-factory.ts` (registry) | Registrar `whatsapp/gptmaker` como mais um provider |
| `lib/messaging/providers/base.provider.ts` | `GptMakerProvider extends BaseChannelProvider` |
| `lib/messaging/channel-router.service.ts` | Zero mudança — roteia pelo `provider` do canal |
| `supabase/functions/messaging-webhook-evolution/` | **Molde** da nova `messaging-webhook-gptmaker` (auth por segredo, dedupe por `external_event_id`, sempre HTTP 200, `handleMessagesUpsert`, `autoCreateDeal`) |
| `lead_routing_rules` (tabela + UI "Entrada de Leads") | **Já pronta** — canal → funil → estágio. É exatamente o "destino do deal" pedido |
| `features/settings/components/ChannelsSection.tsx` | Card do canal + seção "Entrada de Leads" já renderiza qualquer provider |
| `features/settings/components/ChannelSetupWizard.tsx` | Ganha o passo de credenciais do GPTMaker |
| `features/messaging/` (inbox) | Funciona sem mudança quando a Fase 2 ligar |

**Credenciais do canal (`messaging_channels.credentials`):**
```ts
{ apiToken: string,      // Bearer do workspace (password)
  workspaceId: string,   // descoberto no wizard
  agentId: string,       // agente dono do webhook
  channelId: string,     // canal dentro do GPTMaker
  webhookSecret: string } // gerado pelo CRM, vai na URL do webhook
```

---

## 9. Recomendação final

> **Integrar pelo Modelo C, começando pela Fase 1 (entrada de leads), depois da Fase 0 de captura
> de payload.** A Fase 1 entrega o que o Acreditando pediu em 16/07 sem colocar o atendimento da
> Fernanda em risco; a Fase 2 fica destravada por decisão, não por arquitetura.

**Pré-requisitos que dependem do Filipe:**
1. Token da API (https://app.gptmaker.ai/browse/developers) — é o Bearer do workspace inteiro.
2. Confirmar **qual conta**: a do Acreditando (Fernanda) e/ou a da Livre (`IA Livre (GPTMaker)`).
3. Janela combinada para o teste em produção + aviso à Fernanda.

---

## 10. Referências

- OpenAPI: `https://developer.gptmaker.ai/api-reference/openapi.json` (baixado e inspecionado — 57 rotas)
- Índice das docs: `https://developer.gptmaker.ai/llms.txt`
- Vault: `IA Atendimento Acreditando (GPTMaker)` · `IA Livre (GPTMaker)` · `CRM IA Acreditando`
- Regra do projeto: `.claude/rules/meta-ads-safety.md` → **Rule 7 (read-back obrigatório)**
