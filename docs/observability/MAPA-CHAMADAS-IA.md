# Mapa das chamadas de IA — quem chama o Google, e quem registra

> Criado em **2026-08-16**, durante a investigação do gasto de **R$ 197,83** na API do Google.
> Motivo: a fatura não bateu com nada que o CRM registrasse, e descobrimos que **o log cobre
> menos de um quarto dos pontos que chamam o modelo**. Enquanto este mapa não estiver todo
> verde, **o CRM não pode ser inocentado nem condenado por nenhuma fatura** — é essa a razão
> de existir deste documento.
>
> 🔴 **ATUALIZAÇÃO 2026-08-17 — a origem foi encontrada, e é o CRM.** O [[Filipe]] estava certo
> ao recusar a absolvição de ontem. Ver **seção 7**: o cron `pontuar-leads-qualificados`
> reprocessa a mesma fila **288 vezes por dia** porque ela **não tem contador de tentativas**.
> A aritmética do cron bate com a curva do Google (**2.880 vs ~3.000 req/dia**), e as duas datas
> da fatura são as duas datas do cron. **A pendência nº 1 ("quem agenda?") está resolvida:
> pg_cron do Supabase, versionado neste repo.**

---

## 1. O buraco, em um número

| Fonte | Período | Chamadas |
|---|---|---|
| **Google Cloud** (`GenerateContent`, projeto `bot foto`) | 30 dias | **8.557** |
| **`ai_conversation_log`** (o que o CRM registrou) | 40 dias | **85** |

O log enxerga **~1%** do que o Google cobra. E o que ele enxerga é de **um único tipo**:
`custom_fields_extraction`. Todo o resto do sistema chama o modelo em silêncio.

---

## 2. Mapa completo — 24 arquivos que chamam o modelo

Levantado com `generateText` / `streamText` em `lib/` e `app/`, excluindo testes.
**Coluna "log"** = o arquivo chama `logAiTokens` ou insere em `ai_conversation_log`.

### ✅ Registram (6 arquivos)

| Arquivo | Rótulo (`action_taken`) |
|---|---|
| `lib/ai/extraction/customFields.service.ts` | `custom_fields_extraction` |
| `lib/ai/extraction/extraction.service.ts` | `bant_extraction` |
| `lib/ai/briefing/briefing.service.ts` | `briefing` |
| `lib/ai/agent/stage-evaluator.ts` | `stage_evaluation` |
| `lib/ai/agent/generate-prompts.service.ts` | (via `logAiTokens`) |
| `app/api/ai/actions/route.ts` | (via `logAIAction`) — **14 pontos de chamada no arquivo** |

### ❌ NÃO registram (18 arquivos)

| Arquivo | O que faz | Risco de volume |
|---|---|---|
| `lib/ai/scoring/pontuarLead.ts` | Pontua lead ao entrar em Qualificado (story 2.35) | 🔴 **A ORIGEM** — cron 288×/dia sobre fila sem contador (**seção 7**) |
| `lib/ai/normalization/classificarValores.ts` | Dicionário de normalização (story 2.18b) | **Alto** — roda em lote sobre todos os valores |
| `lib/ai/agent/provider-failover.ts` | Tenta providers em sequência | ⚖️ **Baixo — NÃO multiplica** (17/08): `buildProviderList` só devolve o primário |
| `lib/ai/agent/few-shot-learner.ts` | Aprendizado por exemplos | Médio |
| `lib/ai/agent/generative-schema.ts` | Geração de schema | Médio |
| `lib/ai/messaging/persona-generator.ts` | Gera persona (**2 pontos**) | Médio |
| `app/api/ai/crm-agent/route.ts` | Chat interativo (streaming) | **Alto** — por mensagem |
| `app/api/ai/board-config/generate-goal/route.ts` | Gera meta do board | Baixo |
| `app/api/ai/tasks/boards/generate-strategy/route.ts` | Estratégia de board | Baixo |
| `app/api/ai/tasks/boards/generate-structure/route.ts` | Estrutura de board | Baixo |
| `app/api/ai/tasks/boards/refine/route.ts` | Refino de board | Baixo |
| `app/api/ai/tasks/deals/analyze/route.ts` | Análise de deal | Médio |
| `app/api/ai/tasks/deals/email-draft/route.ts` | Rascunho de e-mail | Médio |
| `app/api/ai/tasks/deals/objection-responses/route.ts` | Respostas a objeção | Médio |
| `app/api/ai/tasks/inbox/daily-briefing/route.ts` | Briefing diário | **Alto** — cron 8h seg-sex |
| `app/api/ai/tasks/inbox/sales-script/route.ts` | Roteiro de vendas | Médio |
| `app/api/test/ai-modes/route.ts` | Rota de teste | ⚖️ **17/08:** exige **login** (`getUser` → 401), mas **NÃO** olha `ALLOW_AI_TEST_ROUTE` — a flag só existe na `page.tsx`. Não é aberta ao mundo; segue sem log e sem flag |
| `app/(protected)/ai-test/page.tsx` | Página de teste | ✅ protegida por `ALLOW_AI_TEST_ROUTE` (default `false` no `.env.example`) |

**Placar: 18 de 24 arquivos chamam o Google sem deixar rastro.**

---

## 3. Três defeitos de classe (não são bugs isolados)

### 3.1 O log conta chamada lógica, o Google cobra requisição HTTP

Todo ponto usa `maxRetries: 2` (e `app/api/ai/actions/route.ts` usa **`maxRetries: 3`** em
**14** pontos, não 9 — recontado em 17/08). O AI SDK **repete a requisição** nesse limite ⇒
**1 chamada de código = até 3 (ou 4) requisições faturadas**.

> ⚖️ **Correção de 17/08 — o `provider-failover` NÃO multiplica.** Ontem afirmei que ele
> "percorre providers em laço" e somava ao multiplicador. O laço existe, mas
> `buildProviderList()` **empurra só o primário** (`provider-failover.ts:102-116`) — a lista tem
> **1 item**, e o comentário *"then others that have API keys configured"* descreve algo que o
> código não faz. O multiplicador real é só o `maxRetries`. **Corrigir o comentário ou o código
> é dívida à parte** — hoje o failover é decorativo, e `AIProvider` só admite `'google'`.

⇒ Mesmo que os 24 arquivos registrassem, o log **ainda** subestimaria a fatura. O que
precisa ser contado é a **requisição**, não a intenção.

### 3.2 `conversation_id` é `NOT NULL` — o log recusa o que não é conversa

`logAiTokens` devolve `{logged:false, reason:'sem_conversa'}` quando a operação não tem
conversa associada. Isso **exclui por construção** justamente os pontos de maior volume
potencial: pontuação de lead, normalização em lote, geração de board, briefing.

⇒ Não adianta chamar `logAiTokens` nos 18 arquivos restantes: **metade seria recusada pelo
schema.** O `NOT NULL` precisa cair antes.

### 3.3 `action_taken` tem CHECK fechado no banco

Domínio atual: `responded`, `advanced_stage`, `handoff`, `skipped`, `stage_evaluation`,
`custom_fields_extraction`, `bant_extraction`, `briefing`.

Rótulo novo **sem migration** = erro `23514` em silêncio. Já aconteceu uma vez (story 2.10,
`custom_fields_extraction` ficou um dia inteiro falhando calado).

⇒ Cada ponto novo instrumentado exige rótulo novo, que exige migration. **8 rótulos hoje,
precisamos de ~24.**

### 3.4 A falha é sempre muda

O insert é fire-and-forget e a falha vira `console.error` — que ninguém lê em produção.
Foi assim que a tabela ficou **vazia desde sempre** sem ninguém notar (documentado em
`lib/ai/token-log.ts`). O `logAiTokens` já devolve o resultado em vez de engolir, mas
**ninguém olha o retorno**.

---

## 4. Crons — os 4 agendadores, achados (✅ resolvido em 17/08)

Havia **dois agendadores diferentes**, e foi isso que escondeu os dois crons: procuramos no
`vercel.json` e nos backups do n8n, mas eles estão no **pg_cron do Supabase** — versionados
neste próprio repo, em `supabase/migrations/`.

| Cron | Agendador | Cadência REAL | Chama IA? | Trava de tentativas |
|---|---|---|---|---|
| `/api/cron/daily-briefing` | `vercel.json` | `0 8 * * 1-5` (8h seg–sex) | sim | n/a |
| `/api/cron/template-sync` | `vercel.json` | `0 6 * * *` (6h diário) | não | n/a |
| `/api/cron/stage-evaluations` | **pg_cron** `stage-evaluations-1min` | `* * * * *` na migration | sim | ✅ **`attempts` + `MAX_ATTEMPTS=3`** |
| `/api/cron/pontuar-leads` | **pg_cron** `pontuar-leads-qualificados` | `2,7,…,57 * * * *` = **12×/h, 24h/dia** | sim | ❌ **NENHUMA** |

- Fonte: `supabase/migrations/20260813011000_cron_da_pontuacao_por_ia.sql` (pontuação) e
  `20260722120000_pg_cron_stage_evaluations.sql` (avaliação de estágio).
- Ambos chamam a produção via `net.http_get` com o segredo `cron_secret_stage_eval` do vault.
- ⚠️ O nome `stage-evaluations-1min` **mente** (pendência nº 41 do CRM): a migration agenda
  `* * * * *`, o comentário do route diz 5 min ⇒ alguém alterou por `cron.alter_job`. **A
  cadência real desse job só se sabe consultando `cron.job` no banco.**

🛑 **Correção do diagnóstico de 16/08:** concluímos *"o cron não está rodando"* porque a última
pontuação era de 14/08 13:53. **Estava errado.** O cron rodava — a cada 5 minutos, 24h/dia — e
**falhando**. Pontuação bem-sucedida deixa carimbo; tentativa que falha **não deixa nada**. O
silêncio no banco era o sintoma do defeito, não a ausência dele. A curva do Google, que só parou
quando a chave caiu (16/08 02:00), é a prova de que ele continuou chamando o modelo.

---

## 5. O que a fatura do Google diz (16/08/2026)

| Item | Valor |
|---|---|
| Projeto | **`bot foto`** (`gen-lang-client-0589801559`) |
| Custo 1–15/ago | **R$ 197,83** |
| SKU dominante | `Generate_content text output token count for gemini-3-flash` — **R$ 174,66** (saída) |
| Credencial | **uma única**: `apikey:519caf23-d675-418a-8142-ba2b1bc38059` |
| `GenerateContent` (30d) | **8.557** · `StreamGenerateContent`: 19 · `ListModels`: 16 |
| Taxa no platô | ~**0,033 req/s** ≈ **3.000/dia**, contínuo 24h |
| Início | **13/08**, subida abrupta |
| Fim | **16/08 ~02:00** (quando as chaves foram apagadas) |
| Latência média | **6,0s** (p99: 16,0s) — respostas longas |

**A credencial `CRM Acreditanndo` (conta de serviço) vive nesse mesmo projeto** — ou seja,
o CRM e o consumo suspeito compartilhavam projeto. Foi isso que tornou impossível separar
um do outro pelo relatório de custo.

---

## 6. Plano de instrumentação (proposto, não executado)

Ordem importa: os passos 1 e 2 são pré-requisito de schema, senão o resto falha calado.

| # | Passo | Por quê |
|---|---|---|
| 1 | **Migration:** `conversation_id` deixa de ser `NOT NULL` | Sem isso, ~metade dos pontos é recusada pelo schema |
| 2 | **Migration:** ampliar o CHECK de `action_taken` com os ~16 rótulos novos | Sem isso, cada ponto novo falha em `23514` mudo |
| 3 | **Um único ponto de entrada** — um `callModel()` que embrulha `generateText`/`streamText` e registra **sempre** | Impede o 25º copy-paste; hoje cada ponto decide sozinho se registra |
| 4 | Registrar **requisições**, não só chamadas: gravar `maxRetries` e tentativas | Fecha a diferença entre o nosso número e o do Google |
| 5 | Campos novos: `input_tokens`, `output_tokens` separados | A fatura é dominada por **saída**; hoje só temos o total |
| 6 | **Falha de log deixa de ser muda** — contador/alerta quando `logged:false` | Foi o silêncio que escondeu o problema por meses |
| 7 | Lint/teste que **reprova `generateText` fora do `callModel()`** | Torna a regra executável, não uma convenção |
| 8 | Painel de consumo por dia/rótulo, comparável com o console do Google | Fecha o ciclo: dá para conferir sem abrir o console |

### Trava de custo (independente do log)

Enquanto o item 8 não existir, a proteção real está do lado do Google:
- Chave nova em **projeto separado só do CRM** (para o relatório de custo já apontar o culpado)
- **Restrição de API** na chave: só `Generative Language API`
- **Cota diária** no projeto (o CRM usa ~10/dia; um teto de 500 já é folgado)
- **Alerta de orçamento** em R$ 20

---

## 7. 🔴 A ORIGEM (17/08) — uma fila sem contador de tentativas, girando 288×/dia

### 7.1 O mecanismo, em quatro linhas de código

1. `v_leads_a_pontuar` é uma **VIEW derivada do estado**, não uma tabela de fila
   (`20260813010000`). Sai da fila **só** quem recebe o carimbo `pontuada_pela_ia_em`.
2. `pontuar-leads/route.ts` pega `MAX_POR_RODADA = 10` por rodada, **sem `ORDER BY`**.
3. Se a chamada de IA ou o `update` falharem, o `catch` registra e faz `continue` — **o lead
   não recebe carimbo e nem conta tentativa.** O comentário do arquivo diz isso com orgulho:
   *"um card que falha não derruba a rodada, e ele volta para a fila na próxima — a fila é
   derivada do estado, não consumida"*.
4. ⇒ **O lead que falha volta na rodada seguinte. Para sempre.** E como não há `ORDER BY`, os
   mesmos ~10 cards ocupam a rodada indefinidamente — os outros 20 da fila nunca são alcançados.

### 7.2 A aritmética que fecha com a fatura

```
cron 'pontuar-leads-qualificados' = 2,7,12,…,57  →  12 rodadas/hora
12 × 24h                                         →  288 rodadas/dia
288 × MAX_POR_RODADA (10)                        →  2.880 chamadas/dia
                                       Google mediu: ~3.000 req/dia  ✅
```

| Evidência | Fatura do Google | Código/migration |
|---|---|---|
| **Início** do platô | **13/08**, subida abrupta | migration do cron: **`20260813011000`** |
| **Fim** do platô | **16/08 ~02:00** | chave apagada ⇒ `!aiConfig.apiKey` ⇒ `continue` **antes** da IA ⇒ custo zero |
| Volume | **~3.000/dia**, 24h contínuo | **2.880/dia** = 288 rodadas × 10 cards |
| Perfil | 24h/dia, sem queda noturna | cron `* * * *` — **não** tem recorte de horário comercial |
| SKU dominante | **saída** (R$ 174,66) | prompt manda **até 60 mensagens** de conversa; resposta = 5 itens **com `motivo` textual** |
| Latência 6,0s (p99 16s) | respostas longas | idem |
| Só **1** credencial | `apikey:519caf23-…` | `AIProvider = 'google'` **só** — o CRM não fala com outro provedor |

### 7.3 Por que o cron irmão não fez isso

Mesmo autor, mesma cadência, mesmo lote de 10 — e **um tem trava, o outro não**:

| | `stage-evaluations` | `pontuar-leads` |
|---|---|---|
| Fila | tabela persistente | **VIEW derivada do estado** |
| Contador | `attempts`, `.lt('attempts', MAX_ATTEMPTS)` | **não existe** |
| Após 3 falhas | marca `failed` e **sai da fila** | **volta eternamente** |

📌 **É a mesma classe de defeito que este repo documenta desde julho:** o caminho de erro existe,
funciona e **ninguém está escutando**. Aqui ele não só ficou mudo — ele **custou dinheiro por
requisição**, 288 vezes por dia, por 3 dias.

### 7.4 O que ainda precisa de banco/Vercel para fechar (não dá por código)

Estes números **não** foram medidos — exigem acesso que este clone não tem (sem `.env.local`,
sem link `.vercel`):

1. `select * from cron.job` — cadência **real** dos dois jobs (o nome `-1min` mente) e
   `cron.job_run_details` para contar as rodadas efetivas de 13 a 16/08.
2. `select count(*) from v_leads_a_pontuar` — tamanho da fila hoje, e **quais** cards estão
   presos (têm conversa? têm texto? o `update` bate no `.neq('lead_score_source','manual')`?).
3. Logs da Vercel de `/api/cron/pontuar-leads` em 13–16/08 — o corpo da resposta
   (`{pontuados, naFila, falhas}`) **já diz o motivo de cada falha**. É a prova direta.
4. Se a falha era do modelo ou do `update`: as duas deixam rastro só em `console.error`.

### 7.5 Conserto mínimo (a trava, não a instrumentação)

O plano de instrumentação da seção 6 continua valendo, mas **não é o que estanca**. O que estanca:

| # | Conserto | Efeito |
|---|---|---|
| 1 | **Contador de tentativas** no card (ex.: `tentativas_de_pontuacao`) + a view excluir quem passou de 3 | Fila deixa de girar; custo volta a ser proporcional a lead novo |
| 2 | **Carimbar também a falha** (`pontuada_pela_ia_em` ou coluna de erro) | Falha para de ser invisível no banco |
| 3 | `ORDER BY` na fila (mais antigo primeiro) | Card envenenado deixa de bloquear os outros 20 |
| 4 | Cadência com recorte de horário | 24h/dia para uma fila que só recebe em horário comercial é desperdício por desenho |
| 5 | Travas do lado do Google (projeto separado · restrição de API · **cota diária** · alerta R$ 20) | Teto de prejuízo **independente** de qualquer bug nosso |

⚠️ **A cota diária é a única proteção que funciona mesmo se todo o resto falhar.** Sem ela, o
próximo defeito desta classe volta a ter custo ilimitado.

---

## 8. Como verificar este mapa de novo

```bash
# Pontos que chamam o modelo vs. pontos que registram
cd projetos/acreditando-crm
for f in $(grep -rl --include=*.ts --include=*.tsx -E "generateText|streamText" lib app | grep -v "\.test\."); do
  n=$(grep -cE "await generateText|await streamText" "$f")
  log=$(grep -cE "logAiTokens|ai_conversation_log" "$f")
  printf "%-62s chamadas:%-3s log:%s\n" "$f" "$n" "$( [ "$log" -gt 0 ] && echo SIM || echo NAO )"
done
```

O número que importa: **quantos `NAO` restam**. Hoje são **18**. A meta é zero.
