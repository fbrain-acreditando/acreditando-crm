# 00 — Contexto de Sessão · Retomar Aqui (Acreditando CRM)

> Porta de entrada pra retomar o trabalho neste repo. Frase pra retomar:
> *"leia `projetos/acreditando-crm/00-CONTEXTO-SESSAO-RETOMAR-AQUI.md` e continue."*
>
> 📖 Memória completa (curada) no vault: **[[CRM Acreditando (repo nossocrm)]]** + **[[CRM IA Acreditando]]**.
> Manual da arquitetura do repo: `CLAUDE.md` + `AGENTS.md` (na raiz).

---

## Sessao 2026-08-14 (10) — 📊 story 2.19 BLOCO A: o painel passou a medir o lado dela

> ⚠️ **Esta story nao nasceu de backlog. Nasceu de um audio da Fernanda, e o motivo importa mais
> que o codigo.**

### O relato que reordenou a prioridade

Lendo **so o Bloco B**, ela concluiu, em audio, na manha de 14/08:

> *"336 lits que chegaram, 115 chegaram ate mim, 221 a IA resolveu sozinha e eu abordei 19. Falei
> assim: **meu chefe vai me substituir por um IA**, basicamente, por esses dados aqui. Ele vai
> falar: **o que a Fernanda faz? Nada.**"*

🔑 **Ela nao interpretou mal — o painel disse aquilo mesmo.** O Bloco B mede **o que a IA fez** e
nao media **o que so ela faz**, entao o numero dela parece pequeno **por construcao**. E os
*"19 abordados"* contam quem ela **INICIOU**, nao quem ela **ATENDEU** (as 115).

⇒ **O Bloco A deixou de ser "o proximo bloco do painel" e virou o que impede o painel de prejudicar
a usuaria que o encomendou.** Fonte: `06-Fontes-Raw/Transcricoes/2026-08-14 - Audios Fernanda...`

⚠️ **E ja houve efeito de 2a ordem:** ela passou a **segurar a propria entrada** num lead *"para ver
se depois a gente consegue muda-la naqueles numeros"*. O indicador comecou a governar o trabalho
**antes de existir uma leitura combinada**. ❓ Frase truncada na transcricao — **confirmar com ela**.

### AC0 — medido antes de escrever, e reproduz entre dois dias

| Numero | 13/08 | 14/08 |
|---|---|---|
| Conversas transferidas | 157 | **162** |
| Esperando resposta dela | 64 | **67** |
| Passou de 24h | 54 | **61** |
| Prontos para ligar | 23 | **23** |

### 🛑 O AC0 achou a ressalva que foi para a TELA

*"23 prontos para ligar"* e **23 de 68 cards que a IA leu** — a IA da 2.35 so pontua quem entra em
`Qualificado`, e sao **68 de 370** vivos. Sem o denominador, `23` se le como *"de tudo que existe,
23 prestam"*. **Mesma licao que a 2.18 pagou com o `★ 1/1` × `★ 1/5`.**

E quando **nada** foi pontuado, o card escreve **`—`**, nao `0`: zero seria afirmacao sobre os LEADS
(*"nao ha ninguem pronto"*), quando o fato e sobre o SISTEMA (*"ninguem foi lido"*). Tem teste.

### Tres decisoes de desenho

1. **O Bloco A NAO recebe periodo.** Fila de trabalho e sempre "agora" — filtrar por *"mes passado"*
   produz numero que ninguem usa. A RPC nem aceita intervalo.
2. **Fica ACIMA do Bloco B** na pagina. Se a tela abre pelo retrospectivo, ela abre contando o que a
   IA fez.
3. **`staleTime` 30s** (contra 60s do Bloco B): numero de fila velho manda ligar para quem ja
   respondeu.

### 🪤 O aplicador de migracao deu VERDE VAZIO

`aplicar-migracao.mjs` imprimiu *"OK — read-back confere: todas as colunas prometidas existem"* —
**conferindo 0 de 0**. O read-back dele so olha **colunas**, e esta migracao cria **view + funcao**.
⇒ Para qualquer migracao de view/RPC ele **sempre** passa. 📌 **Mesma familia do `exit 0` de gate
cego do NeuroIA (13/08): um instrumento que responde nao e um instrumento que mede.** O read-back
real foi feito na mao (`view_existe: 1`, `funcao_existe: 1`, 162 linhas, e os 3 numeros reproduzidos
pela view).

### ✅ Conferido de quebra: o gate `tsc` DESTE repo nao e cego

Depois do achado do NeuroIA, medi: `tsconfig.json` usa `include` (sem `files: []`) e o `tsc`
compila **2.130 arquivos**. **A armadilha nao existe aqui.**

### Gates

lint **0** · typecheck **0** (e enxergando) · **760 testes** (+13, zero regressao) · build ok.
**Oraculo: 8 dos 13 reprovam com a implementacao ingenua**; os **5 controles** passam dos dois lados.

### ⏳ Aberto

- 🔴 **AC1 — so ela fecha:** falta a Fernanda VER a tela. ⚠️ **E o `61 passou de 24h` vai aparecer
  em tom de ALARME** (a regra vira alarme com metade da fila estourada; hoje e 61 de 67) **para uma
  pessoa que hoje de manha achou que o painel a estava expondo.** Vale olhar antes dela.
- 🟡 **A RPC nunca rodou de ponta a ponta com sessao** — `auth.uid()` e nulo fora de sessao, entao a
  checagem de org so foi exercitada ate a excecao. **Mesma ressalva do Bloco B**; fecha quando a
  tela abrir.
- 🟡 **Bloco C segue travado** na normalizacao (`POST /api/admin/normalizar-criterios`, nunca
  disparada — o dicionario esta vazio).
- 📌 **Divida de ferramenta:** fazer o `aplicar-migracao.mjs` conferir tambem view/funcao, ou dizer
  em voz alta *"nao havia o que conferir"* em vez de "OK".

---

## Sessao 2026-08-13 (9) — 🩹 story 2.37: o board mostrava a coluna velha, e o rollback era mudo

> Commit **`bb7bf1a`** · ✅ **NO AR, PROVADO EM QUATRO PONTOS:** o alias
> `acreditando-crm-sandy.vercel.app` resolve para **`bb7bf1a`** (`/v13/deployments/{dominio}`),
> `readyState: READY`, `target: production`, `aliasError: null`, dominio em **HTTP 200**.
> Deployment `dpl_9pEkE6FvZGkD3xDvNEjnqzSZ3JDu`, pronto **19:51:46 (SP)**.
> 🔑 **A lacuna de 12/08 foi fechada: o token da Vercel agora vive em
> `.credenciais/vercel.token`** (conta `fbrainacreditando-3497`) — antes o read-back de deploy era
> impossivel e todo deploy terminava em *"a confirmar"*. Conferido que `.credenciais/` e `*.token`
> estao no `.gitignore` do vault, que tem **auto-commit de 15 min**.

### O caso real, e ele veio da Fernanda por audio

Ela moveu o card do **Arkley** para `Perdido` as **14:58**, saiu para **apresentar a um casal** e
voltou ~1h30 depois: o board mostrava **`Lead novo`**, mas *dentro* do card a classificacao ja era
**perdido**. Pergunta dela: *"por que que ele volta?"*

**MEDIDO: nao voltou.** A gravacao das 14:58 persistiu — uma leitura independente as ~15:35 pegou
**38 perdidos, todos na coluna `Perdido`**, com o motivo `vaquinha` presente — e **nao havia
atividade nem evento de webhook** de volta entre 14:58 e 16:38. **O banco estava certo; a tela nao
se atualizou.**

🎯 **O detalhe do relato foi o que resolveu:** *"dentro dele ja estava como perdido, mas ele estava
na coluna do `Lead novo`"* ⇒ **duas verdades na mesma tela** (board le cache, card aberto le o
servidor). Sem essa metade da frase, o caso pareceria perda de gravacao (como em 12/08) e a
investigacao comecaria no lugar errado.

💸 **Custo ja cobrado:** ela refez o trabalho e, ao refazer, **sobrescreveu o motivo da perda**
(`vaquinha` → `pedido de ajuda`). O original so sobrevive em `activities` — e e o campo que
alimenta o *"por que a gente perde"* do Bloco C da story 2.19.

### 🛑 As duas metades do defeito estavam DOCUMENTADAS no proprio codigo

1. **`onError` fazia rollback e descartava o erro** (`_err`, `useMoveDeal.ts:328-333`) ⇒ o card
   voltava para a coluna de origem **em silencio**. Era a **pendencia n. 3 do CRM**, escrita em
   12/08 como *"proxima armadilha da mesma familia"*. **Mordeu no dia seguinte.**
2. **`refetchOnWindowFocus` era `false`** no client global (`lib/query/index.tsx:150`) — e o
   comentario do `useDealsByBoard` dizia literalmente *"nao ha reconciliacao por foco de aba"*.

📌 **Mesmo padrao da story 2.30:** *o defeito estava descrito no repo e nao fechado*.

### O conserto, e por que ele e barato

- `features/deals/avisoDeMovimentacao.ts` — **regras puras**: a mensagem (diz **o que aconteceu com
  o card** e **o que fazer**), o filtro de abort (cancelamento nao e falha) e `resumoTecnico` para o
  console. **Texto tecnico nao vai para a tela** (a licao cobrada da IA da Livre em 06/08).
- `useMoveDeal.onError` — avisa via toast **e** loga o diagnostico. **`useOptionalToast`** de
  proposito: `useToast` lancaria *"must be used within a ToastProvider"* **dentro do tratamento de
  erro**, trocando card silencioso por tela branca.
- **`refetchOnWindowFocus: true` nos DOIS hooks** que compartilham `DEALS_VIEW_KEY`
  (`useDealsByBoard` e `useDealsView`) — observadores divergentes na mesma query fariam o
  comportamento no foco depender de qual componente esta montado.

🔑 **Por que isso NAO reintroduz a corrida que o comentario original temia:** o refetch por foco so
ocorre com dado **stale**, e o `staleTime` de 2 min e **renovado** pelo `setQueryData` do otimismo e
do Realtime. Ela move e troca de aba ⇒ dado fresco, **nada acontece**. Fica 1h30 fora ⇒ reconcilia.
***A trava contra a corrida ja existia; faltava ligar a reconciliacao que ela mesma protege.***

### 🪤 O oraculo pegou um defeito NO MEU PROPRIO TESTE

A 1a versao do teste de foco **passou com o codigo antigo**: um `QueryClient` cru usa o default da
**biblioteca** (`true`), nao o de **producao** (`false`). O teste media um ambiente que nao existe.
Corrigido reproduzindo o client real — com o motivo escrito dentro do arquivo.

📌 **Regra que fica:** teste de opcao de query tem de **replicar os defaults do client de
producao**, senao mede a biblioteca.

**Estado final do oraculo:** **3 testes reprovam com o codigo antigo** (AC1 aviso, AC2 sem
vazamento tecnico, AC4 reconciliacao) e os **3 controles** (abort nao avisa · dado fresco nao busca
· rollback continua) passam **dos dois lados**.

### Gates

lint **0 warnings** · typecheck **0** · **747 testes** (+15, zero regressao) · build **ok**.

### ⏳ Aberto

- 🔴 **AC9 — provado em uso: so a Fernanda fecha.** Mover um card, sair, voltar e ver o card onde
  deixou. ⚠️ *Provada em producao com read-back nao e provada em uso* — a distancia entre as duas
  ja custou uma story inteira neste repo (a 2.16, cujo read-back foi em SQL e a usuaria seguiu
  vendo os 431 cards).
- ✅ **AVISADO — o Filipe falou com ela em 13/08** (noite): a movimentacao das 14:58 nao se perdeu,
  era a tela, e ja esta corrigido. Isso tira o risco de ela entrar na reuniao de 14/08 achando que
  o sistema perde o que ela classifica. **A resposta dela ainda nao foi registrada aqui.**
- ✏️ **Perguntar a ela qual motivo vale no card do Arkley** — o 1o foi `vaquinha`, o 2o
  `pedido de ajuda`; o refazer sobrescreveu, e o original so existe em `activities`.
- ⚠️ **A correcao NAO cobre o caso todo:** se o Realtime falhar **e** ela nao sair da aba, o board
  segue velho ate remontar. Tirar a aposta no Realtime **fica para depois de 14/08** (decisao
  registrada: mexer no caminho de arrastar card na vespera e risco maior que o defeito).
- 🆕 **Story: arquivar em `Clientes` nao pode APAGAR a venda** — `useMoveDeal.ts:88-94` (ramo
  *"reopen if was closed"*) zera `is_won` e anula `closed_at`. Em 13/08 nao mordeu (os 3 cards eram
  clientes de meses anteriores, **confirmado por ela**), mas morde no 1o mes em que ela fechar e
  arquivar a venda no mesmo mes. Custo ja pago: o `closed_at` da venda da **Joyce**.
- 🧭 **`loss_reason` aceita texto livre e a cauda voltou pelo USO:** a story 2.26 normalizou 9 → 8;
  hoje sao **19 motivos em 38 perdidos**, com duplicatas de grafia de novo (`cliente bom dia` ×
  `cliente de bom dia`). 💡 E ha uma categoria real escondida: *"so cumprimentou/elogiou"* aparece
  **5 vezes** — **nao e perda, e "nao era lead"**.
- ✏️ **Correcao de registro:** `docs/stories/` **NAO** e gitignored (34 stories rastreadas). A nota
  *"pendencia n. 9"* neste arquivo estava desatualizada.

### 📊 AC0 do Bloco A e C da story 2.19 — medido nesta sessao (13/08, 15:07 SP)

| Bloco A | Valor |
|---|---|
| Conversas transferidas | **157** |
| A bola esta com ela (o lead falou por ultimo) | **64** |
| Passou de 24h | **54** |
| **Prontos para ligar** (SP capital + roteiro, julgados pela IA da 2.35) | **23** |

🔑 **A story 2.35 destravou o que estava preso desde 11/08:** o *"prontos para ligar"* dependia do
`SP × fora`, que o casamento por texto errava **nas duas direcoes**. A IA ja julga a capital
corretamente ⇒ **o Bloco A ficou inteiro implementavel**.

**Board em 13/08** (ela trabalhou pesado na vespera): `Lead novo` 139 → **32** · `Contato
Realizado` 55 → **114** · `Perdido` 18 → **38** · `Qualificado` 67 → **79** · `Clientes` **12** ·
`Profissional` **14**. ⚠️ **13 dos 79 em `Qualificado` seguem sem nota da IA.**

---

## Sessao 2026-08-12 (7) — 🆕 coluna `Clientes` no board (4º pedido da Fernanda no dia)

> **Aplicado no banco, read-back conferido. NAO commitado, NAO pushado** — os 2 arquivos de
> migracao estao no working tree.

**Arquivos:**
- `supabase/migrations/20260812210000_board_ganha_coluna_clientes.sql`
- `supabase/migrations/20260812210000_board_ganha_coluna_clientes_REVERTER.sql`

**Estado no banco (lido de volta):** `ord 10 · Clientes · linked_lifecycle_stage NULL ·
bg-emerald-500 · 0 cards`. Board `0..12`, **13 colunas, 0 `order` duplicado**.
As tres categorias no fim: `Clientes` 10 · `Profissional` 11 · `Projeto Social` 12.

### 🪤 A coluna nasceu em 12 e o Filipe a moveu PELA TELA para 10 — e isso quebrou a migracao

A reordenacao pela UI persistiu corretamente no banco. **O arquivo de migracao, nao.** Ele cravava
`order = 12`; num banco reconstruido do zero, inseriria `Clientes` em **10 colidindo com
`Profissional`**, que a migracao anterior (`20260812170000`) crava em 10 ⇒ **duas colunas com o
mesmo `order`**, ordem indefinida na tela.

Corrigido com `UPDATE`s de reordenacao **por UUID** (nunca por nome — licao da 2.33). **Reexecutada
contra o banco ja no estado final: no-op provado** (1 linha `Clientes`, 13 colunas, 0 empate).

🔑 *Mexer na tela e mexer no repo sao duas escritas na mesma verdade — e a segunda nao acontece
sozinha. Este repo ja carrega a pendencia nº 18: `supabase/migrations/` NAO e a fonte da verdade.*

### 🛑 O achado que muda o desenho — leia antes de mexer em qualquer coluna deste board

Ligar a coluna ao ciclo **`CUSTOMER`** era a escolha obvia (faria `contacts.stage = CUSTOMER`, e o
sistema finalmente saberia quem e cliente — hoje sao **4 de 813**). **Medido: nao da.**

`boards.won_stage_id` e **NULL** neste board ⇒ `useMoveDeal.ts:70-81` cai no **fallback por
lifecycle**, e QUALQUER coluna `CUSTOMER` marca **`is_won = true`**:

1. o card entra na contagem de **GANHO do dashboard** (`useDashboardMetrics.ts:232`) ⇒ cliente
   antigo contado como **venda** no numero que a Fernanda apresenta em **14/08**;
2. o card cai no **corte de 30 dias** (`useBoardsController.ts:430-438`) ⇒ some da tela **mesmo com
   o filtro em "Todos"**. Seria a **story 2.31 de novo**, dentro da coluna criada para o problema
   oposto.

⇒ nasceu com `linked_lifecycle_stage NULL`, igual a `Profissional` e `Projeto Social`.

**Custo aceito:** a coluna organiza a tela; **ela nao ensina o sistema a saber quem e cliente**, e
**nada poe o lead nela sozinho** (movimentacao manual, por quem disse *"eu nao anoto nada"*).

### ⏳ Aberto

- **Avisar a Fernanda que o card NAO vai sozinho** — a fala dela supoe o contrario
- Perguntas de definicao: *"cliente"* = ja atendido **x** em tratamento agora? · de onde importar o
  dado (nao esta na conversa)? · e os **490 contatos sem card**, que nenhuma coluna alcanca?
- 🧭 **Arquitetura:** **3 das 13 colunas ja sao CATEGORIA, nao etapa** — um card so cabe em uma, e
  cliente **em negociacao** obriga a escolher. Alternativa registrada: **campo + filtro**

---

## Sessao 2026-08-12 (8) — 🤖 story 2.35: a IA pontua o lead, e a regra em SQL foi aposentada

> Commits **`383caff`** (2.18b) · **`96e0a9a`** (AC4/AC5) · **`035f95e`** (2.35) · **`ab66a8c`** (2.34).
> ✅ **PROVADO EM PRODUCAO:** 67 cards pontuados pela IA, nota media **1,87 de 5**,
> e 5 cards que entraram em `Qualificado` durante a sessao foram pegos pelo cron
> **sozinho**. O ciclo fecha ponta a ponta.

### 🔄 A regra de pontuacao foi reescrita TRES vezes em seis dias

| Rev | Regra | Como morreu |
|---|---|---|
| 1 (07–10/08) | pontuar por **zona** de SP | so **28,2%** dos leads tinham zona |
| 2 (12/08) | **dicionario** de valores canonicos | so **1 de 5** criterios era computavel sem interpretar texto |
| 3 (12/08, no ar) | **a IA le a conversa** e da 0 ou 1 por item | — |

🔑 **As duas primeiras morreram no mesmo lugar: o dado nao sustentava a regra.**
E o gate (AC0) pegou as duas **antes de qualquer linha de codigo**.

### O desenho final (pedido do Filipe, 12/08)

> *"A IA deve ler a conversa e dar a pontuacao **somente quando o card entrar na
> coluna qualificado**. Atribuir **0 ou 1 a cada item**. E fazer a soma, 0 a 5."*

**Por que e melhor que o meu:** medido, dos 67 cards em `Qualificado` **so 40
tinham os 4 campos preenchidos** — a extracao perdeu 27. Reler a conversa acha o
que ela nao capturou. Prova real do 1o card pontuado: a IA excluiu **Sorocaba**
corretamente (*"pertence ao interior de Sao Paulo"*), que era exatamente o falso
positivo que o casamento por texto produzia.

### ⚠️ Duas reversoes conscientes, registradas com autor e data

1. **A story 2.18 proibia a IA de dar a nota** (*"torna o resultado nao auditavel
   e nao reproduzivel"*). O Filipe reverteu. **Mitigacao implementada:** cada
   ponto guarda o **motivo**, e o painel do card mostra os cinco. Sem isso seria
   opiniao sem recurso. ⚠️ Mitiga, **nao elimina**: duas conversas parecidas
   podem receber notas diferentes.
2. **O 0/1 eliminou o estado "desconhecido"**, que era a base da 2.18 inteira.
   Quem nao disse onde mora recebe **0**. Defensavel porque so pontua quem
   completou o roteiro — e 27 dos 67 caem nesse caso.

### 🏛 A decisao de arquitetura que vale para as proximas

**O gatilho e o ESTADO, nao o evento.** Pendurar a pontuacao no webhook do GPT
Maker pegaria so a transferencia automatica — e a **Fernanda ARRASTA** cards para
`Qualificado` o dia inteiro. A fila e uma VIEW sobre o board
(`v_leads_a_pontuar`), entao:
- todo caminho de entrada conta (automatico, arrasto, edicao);
- falha se **auto-corrige** na rodada seguinte, sem fila persistente para sujar;
- nao exige deploy de Edge Function, que **nao pode ser verificado** desta maquina.

Qual estagio pontua vem de **`board_stages.pontua_lead`**, nao do nome — o board
foi renomeado no mesmo dia e casar por nome falha calado (licao do
`Em qualificação ` com espaco no fim).

### O que PAROU de valer

- `recalcular_lead_scores*` **neutralizadas** e o cron `recalcular-lead-score`
  **desagendado**. Duas fontes para o mesmo numero e o defeito que a 2.29 passou o
  dia consertando.
- O **dicionario da 2.18b CONTINUA** — deixou de alimentar a nota e passou a
  servir so o painel da 2.19 (`SP × fora` para TODOS os leads, nao so os
  qualificados). ⚠️ **Ele nunca foi populado**: a rota
  `POST /api/admin/normalizar-criterios` existe e **nao foi disparada**.

### 🛡️ Mexi numa trava de seguranca — e por que isso NAO foi afrouxamento

O aplicador de migracoes recusou o arquivo por conter `drop constraint`. Duas
correcoes, em ordem:

1. **Redesenhei para nao precisar de DROP** — em vez de um rotulo novo em
   `lead_score_source`, um **carimbo `pontuada_pela_ia_em`**, que responde *"ja
   foi pontuada?"* **e ainda diz QUANDO**. O redesenho ficou melhor que o original.
2. Mesmo assim a trava recusou: a palavra `drop` aparecia **so em COMENTARIOS**
   explicando por que eu nao usava DROP. ⇒ a trava passou a **ignorar
   comentarios** antes de procurar o verbo.

🔑 *O incentivo do falso positivo era pessimo: a saida facil seria reescrever o
comentario para enganar a trava, apagando justamente a documentacao mais valiosa
do arquivo.* **Provado com 3 casos** que `drop table` real continua bloqueado
(comentario de linha, bloco `/* */`, e DROP de verdade).

### 🪤 Quebrei a minha propria regra dentro de UMA HORA

Nomeei a view `v_criterios_**do**_deal` — e o executor somente-leitura bloqueou o
read-back, pelo **mesmo motivo** da RPC `get_metricas_do_atendimento` horas
antes, **depois** de eu ter escrito a regra no contexto do repo e na story.

📌 **Registrar a regra nao e aplica-la.** Terceira ocorrencia desta familia em
dois dias. O que falta e **gate automatico** — nenhum lint do repo confere nome de
objeto de banco. Renomeada para `v_criterios_por_deal`.

### ⏳ Gate @qa: CONCERNS

1. 🔴 **AC8 aberto** — a Fernanda ainda nao viu as notas. Se ela discordar de mais
   da metade, **o problema passa a ser o criterio**, e uma 4a implementacao nao
   resolve.
2. 🟡 **5 dos 10 da 1a rodada nao pontuaram** (provavel "sem conversa"/"sem
   texto"). A fila e derivada do estado, entao voltam sozinhos — **conferir**.
3. 🟡 **O item "completou o roteiro" vale 1 quase sempre** dentro de `Qualificado`
   ⇒ quase nao discrimina. Se a nota parecer inflada, **e o primeiro a rever**.
4. 🟡 **Deploy do `96e0a9a` e do `035f95e` nao confirmado no alias** (token da
   Vercel expirou). ⚠️ Mas ha prova indireta forte: **o cron chamou a rota e
   gravou no banco**, o que so acontece se estiver no ar.

### Falta

- **Disparar a normalizacao** (`POST /api/admin/normalizar-criterios`) — o
  dicionario esta vazio e o AC4 da 2.19 depende dele.
- **Ordenar/filtrar o board pela nota** (indice ja existe, UI nao).
- Conferir os 5 que falharam.

---

## Sessao 2026-08-12 (7) — ⭐ story 2.18a: a nota de prioridade no card

> Commit **`f0daa50`** · ✅ **NO AR, provado**: alias de producao resolve para
> `f0daa50`, `READY`, `target: production`. SDC completo (@sm → @po → @dev AC0 →
> @qa → @devops).

### 🛑 O AC0-rev2 reprovou a story DUAS VEZES em desenhos diferentes

**A rev.1 (10/08)** morreu porque a regra pedia ZONA e so 28,2% tinham zona.
**A rev.2 (hoje)** trocou o criterio para *cidade de SP + completou o roteiro*, e
o gate reprovou **de novo, por outro motivo**:

1. **Nenhum dos 5 campos tem lista de opcoes** — todos `type: text`,
   `options: null`. O risco nº2 da story ("casar por opcao exata") **nao se
   aplica: nao existe opcao**. Cardinalidade: `ondeReside` 66 distintos em 75
   preenchimentos (88% unicos), `haQuantoTempo` 55 em 70.
2. **So UM dos cinco criterios e computavel** sem interpretar texto livre —
   completou o roteiro. Os outros exigem classificacao: *"Sapopemba"* **e** a
   capital e nao casa; *"Campinas sp"* casa e **nao e**.
   ⇒ *Uma escala de 1 a 5 com um criterio calculavel e um booleano com fantasia
   de precisao* — o risco nº3 se materializando.
3. **Cobertura bimodal:** de 318 cards, **210 com zero criterio** e **64 com os
   cinco**.

### 🔑 Mas o cruzamento com o board salvou a story

| Estagio | Cards | Com os 5 | Com zero |
|---|---|---|---|
| `Lead novo` | 131 | 11 | **115** (88%) |
| **`Qualificado`** | **67** | **40** (60%) | 5 |
| `Contato Realizado` | 57 | 3 | 50 |

**O dado nao esta espalhado — esta concentrado onde ela escolhe.** `Lead novo`
esta vazio porque o lead abandonou o roteiro, *e isso ja e informacao*.

🎯 **O achado que paga a story: 16 cards parados em `Lead novo` COMPLETARAM o
roteiro inteiro.** Leads qualificados na coluna fria, invisiveis sem abrir um a
um. A nota diz o que a coluna nao diz.

### Decisoes arbitradas pelo Filipe

| Pergunta | Decisao |
|---|---|
| Normalizar campo por IA fere o "fora de escopo"? | **Nao** — *"a IA adivinhar a NOTA"* e que esta fora. Normalizar dado mantem a regra deterministica |
| Alcance | **So onde ha dado, com denominador visivel** (`★ 1/1` × `★ 1/5`) |

### O que subiu

- `lead_score` + **`lead_score_known`** (o denominador) + `source` + `detail`.
  Constraint impede `score > known` — seria afirmar criterio que nao se mediu.
- `computeLeadScore` — funcao pura, **tres estados** por criterio
  (bateu/refutado/desconhecido). **12 testes; a implementacao ingenua reprova em 3.**
- Badge `★ N/M` no card. Sem nota ⇒ sem badge.
- Backfill: **101 cards `1/1`**, **217 `0/1`**.
- 🚨 **Cron de 10 em 10 min** (`recalcular-lead-score`, minutos :07..:57) — sem
  ele, **todo lead novo nasceria sem nota e ficaria assim**, que e o BANT de novo
  (198 deals, zero). Guarda `is distinct from` evita reescrever card que nao
  mudou (o WAL do Realtime e o maior custo deste banco).

### ⏳ Gate @qa: CONCERNS — o que NAO foi feito

1. **AC4 — nota manual pela TELA nao existe.** O banco respeita
   `lead_score_source = 'manual'` (o recalculo e o cron nao sobrescrevem), mas
   **nao ha interface para ela mudar**. A metade de baixo esta pronta.
2. **AC5 — a explicacao nao aparece no card.** O `lead_score_detail` grava
   matched/refuted/unknown; a tela ainda nao mostra.
3. **Ordenar/filtrar por nota** — indice criado, UI nao.
4. **AC8 — nao provado em uso.**
5. ⚠️ **Alcance honesto:** com um criterio so, a nota se parece muito com a
   coluna `Qualificado` (risco nº5). Os outros 4 entram na **2.18b**.

### 🎁 2.18b — e a mesma peca que a 2.19 precisa

Normalizar `ondeReside`, `haQuantoTempo`, `jaFezReabilitacao` e `paraQuemE` em
valores canonicos (~200 valores distintos no total) resolve **os 4 criterios que
faltam AQUI e o AC4 (SP × fora) da story 2.19**. Caminho decidido: **rota de
backfill protegida**, disparada pelo Filipe — o app nao roda nesta maquina
(sem `.env.local`).

### 🚩 Divergencia repo × banco encontrada nesta sessao

Outra sessao criou a **story 2.34** (coluna `Clientes` no board): a migracao
`20260812210000_board_ganha_coluna_clientes.sql` **ja esta aplicada no banco**
(`Clientes` em `order 10`; `Profissional`/`Projeto Social` foram para 11/12) e o
arquivo **segue sem commit**. ⚠️ E o timestamp **colide** com o
`20260812210000_metricas_de_atendimento_bloco_b.sql` desta sessao. Nao toquei nos
arquivos dela. **Decisao pendente do Filipe.**

---

## Sessao 2026-08-12 (6) — 📊 story 2.19 BLOCO B: o painel que ela apresenta

> Commit **`f90b814`** · ✅ **NO AR, provado**: o alias de producao
> `acreditando-crm-sandy.vercel.app` resolve para **`3b8ce58`** (ponta da `main`,
> que contem o Bloco B), `target: production`, `READY`, `aliasError: null`,
> HTTP 200.
>
> 🪤 **A lacuna que isso expos, e que vale para a proxima sessao:** por ~10 min o
> status ficou em *"pushado, deploy a confirmar"* porque **nao ha token da Vercel
> em `.credenciais/`** — so `supabase-crm-mgmt.token`. Sem ele o read-back de
> deploy e impossivel: o App Router **nao expoe `buildId`**, e `curl` no dominio
> so prova que **algo** responde 200, nao QUAL commit. E "deployment READY"
> tambem nao basta — os 3 ultimos estavam READY e so **um** era o alias. A prova
> e resolver o alias (`/v13/deployments/{dominio}`).
> ⇒ **Guardar o token da Vercel junto do da Supabase** ou todo deploy futuro
> termina em "a confirmar".

### 🛑 O AC0 derrubou DUAS premissas antes de qualquer linha de codigo

**1. "quantos EU respondi" nao existe no dado.** O risco nº 3 da story dizia que
era ambiguo. Medido: e **ausente**. O GPT Maker carimba TODA saida como
`role='assistant'` — os unicos papeis que existem sao `assistant`, `user` e
`tool`. Sao **6.421 mensagens de saida com `sender_type` e `sender_name` NULOS**,
contra **21** com autor. Nao da para contar "mensagens dela" pelo corpo da
mensagem, nem hoje nem retroativamente.

**O sinal que resolve e TEMPORAL, e veio do Filipe:** a IA transfere e **nao
volta**. O carimbo da transferencia corta a conversa em duas metades — antes e
IA, depois e ela. Medido: **146 conversas transferidas**, **todas as 146** com
saida depois do carimbo (**1.398 mensagens**). O `contextId` casa com
`external_contact_id` em **146 de 146** — join total.

🔑 *Eu tinha concluido "nao e possivel" lendo a tabela de mensagens. Era possivel,
e a resposta estava no evento que a normalizacao joga fora.* O parser ate
documenta isso na linha 237 (*"assistant / human / agent e saida"*) — a
informacao passava e era descartada.

**2. A validacao "118 ≈ 116" era coincidencia.** Ficou registrado ontem que a
definicao de *"eu abordei"* se validava sozinha contra a contagem manual dela.
Medido por dia: das 118 de julho, **84 nasceram em 4 horas do dia da carga
inicial** (24/07) — **48 numa unica hora**. Ninguem inicia 48 conversas numa
hora. O numero real de julho e **~34**.
⚠️ **A definicao continua certa; o que caiu foi a PROVA dela.** E cai junto
qualquer ideia de reproduzir julho.

### Os numeros de agosto (01-12/08), medidos

| Numero | Valor |
|---|---|
| Chegaram (lead inicia) | **300** |
| Chegaram ate mim (transferidas) | **101** |
| A IA resolveu sozinha | **199** |
| Eu abordei (equipe inicia) | **17** |
| Sem resposta (zero saida) | **14** (4,7%) |
| Ganhos · Perdidos (por `closed_at`) | **4 · 20** |

Sobreposicao entre *transferidas* e *abordadas*: **zero**, medida. Os perdidos
foram de 18 para 20 durante a sessao — ela esta classificando agora.

### O que foi construido

- **View `v_transferencia_da_conversa`** — quando cada conversa saiu da IA.
  Origem: `messaging_webhook_events` (evento cru), porque a transferencia **nunca
  foi materializada** em coluna nenhuma. Sem expurgo em `cron.job` (conferido).
- **RPC `get_metricas_de_atendimento`** — SECURITY DEFINER + checagem de org.
- **`features/dashboard/blocoB.ts`** — regras puras: percentual (devolve `null`
  em 0/0, porque "0%" num mes sem lead e elogio inventado) e aviso de cobertura.
- **`BlocoBSection.tsx`** — cada card escreve **na tela** o que conta (AC1).
- **AC6** — as metricas de carteira saem da TELA por `MOSTRAR_METRICAS_DE_CARTEIRA
  = false`. O calculo continua; nada foi apagado.

### 🪤 A RPC nasceu com um nome que a propria trava de seguranca bloqueava

Chamava-se `get_metricas_do_atendimento`. A primeira consulta de read-back foi
recusada: `BLOQUEADO: verbo de escrita detectado -> "do"` — `DO` abre bloco de
codigo no Postgres, e o `sql-ro.mjs` pega verbo colado em `_` de proposito
(licao do `cron.alter_job`). **A trava estava certa; o nome, errado** — uma
funcao impossivel de consultar pelo caminho seguro convida a desligar a trava.
📌 **Regra nova:** identificador em portugues nao pode conter `do`, `set`,
`call`, `comment`, `copy`. `de`, `da`, `dos`, `das` sao seguros.

### 📅 Correcao de registro: a cobertura comeca em 23/07, nao 24/07

Todo o projeto vinha dizendo *"o CRM so tem dado a partir de 24/07"*. A primeira
conversa e **24/07 02:59 UTC = 23/07 as 23:59 em Sao Paulo** — um minuto antes da
meia-noite. O painel escreve **23/07** e esta certo. Um teste trava isso; foi um
teste MEU, escrito com a assercao errada, que expos a diferenca.

### ⏳ Gate @qa: CONCERNS — 3 ressalvas abertas

1. 🔴 **AC7 nao conferido** — ninguem comparou o `300` com a anotacao de agosto
   dela. A story diz que este e *o gate real*. **So ela fecha.**
2. 🟡 **A RPC nunca rodou de ponta a ponta com sessao** — as 3 consultas do corpo
   foram exercitadas uma a uma; a funcao so foi provada ate a checagem de acesso
   (`auth.uid()` e nulo fora de sessao). Fecha quando a tela abrir.
3. 🟡 **O recorte do mes usa o fuso do NAVEGADOR**, nao `America/Sao_Paulo` como
   o AC2 pede. `periodToDateRange` e pre-existente e a `MessagingMetricsSection`
   tem o mesmo defeito. So morde com fuso errado na maquina — mas agora afeta
   numero que vai a diretoria.

### Ainda falta da 2.19

- **Bloco A** ("o que eu faco agora") e **Bloco C** ("por que a gente perde") —
  nao implementados.
- **AC4 (SP × fora)** — segue no caminho (c): entregar o que existe e dizer o que
  falta. A classificacao por IA dos 62 valores de texto livre nao foi feita.

---

## Sessao 2026-08-12 (4) — ✅ story 2.31: o quadro escondia exatamente o que ela classifica

> Commit **`ddb59bf`**, deploy **Ready**, alias **HTTP 200**, `origin/main` conferido.
> ⏳ **AC5 aberto:** falta ela abrir o board e ver os 22.

**Relato dela:** *"ontem eu fiz algumas movimentacoes e elas nao permaneceram... na coluna do
perdido eu tinha alguns nomes, nao tenho mais nenhum. Ganho, tambem."* — e o fecho:
***"nao sei se eu preciso mexer em alguma coisa pra olhar o todo, mas nao deveria, ne?"***

🔑 **NADA SE PERDEU — a tela e que escondia.** Medido em producao: **18 cards em `Perdido`** e
**4 em `Ganho`** vivos no banco, **16 movidos por ela em 11/08**; o `activities` confirma por
outro caminho (19 "Moveu para Perdido", 4 "Moveu para Ganho"). As 23 gravacoes funcionaram.

**Causa:** `statusFilter` nascia em `'open'` (`useBoardsController.ts:131`) e `matchesStatus =
!isWon && !isLost` (`:416`) apagava da tela o card ganho ou perdido. Mover para essas colunas e
**justamente o que marca** esses campos ⇒ **CLASSIFICAR = DESAPARECER**. E, sendo `useState` e
nao preferencia salva, o filtro **voltava para `'open'` a cada carregamento** — o trabalho
"sumia da noite para o dia" sem ninguem mexer.

**Conserto:** default `'all'` + o diagnostico escrito no proprio comentario, para ninguem
"otimizar" de volta.

❌ **A hipotese mais natural foi DESCARTADA POR DADO antes de qualquer codigo:** a exclusao
fisica de julho (2.24) era a suspeita obvia — e **nenhum dos 431 apagados** tinha movimentacao
em 10 ou 11/08 (backup pre-exclusao, `updated_at` mais recente = 07/08). Custou 10 minutos e
evitou consertar o que nao estava quebrado.

🚪 **Segunda porta fechada antes de virar suspeita:** ela usou os DOIS caminhos ("alguns eu
arrastei e outros eu fui por dentro"). O caminho "por dentro" tem um atalho que marca `isLost`
**sem mover de coluna** (`DealDetailModal.tsx:1372`) — teria criado card perdido escondido em
coluna comum. Medido: **zero deals com is_won/is_lost fora das colunas certas** ⇒ ela usou o
seletor de fase (`:715`). Os dois gravaram certo.

**Oraculo:** revertido para `'open'` ⇒ 1 de 5 testes falha. Alem da invariante do default, o
teste replica `matchesStatus` e exercita com os 22 cards reais: `'open'` mostra 0, `'all'` mostra 22.

Gates: lint 0 · typecheck 0 · **687 testes**.

⚠️ **FICA DE PE, de proposito (caminho A):**
- **story 2.32 candidata** — o corte de 30 dias (`:423-431`) esconde ganho/perdido antigo
  **INCLUSIVE em `'all'`**. Nao morde hoje (os 22 sao recentes); **morde em setembro**, e o board
  e o que ela apresenta a diretoria todo mes.
- **mover card falha em silencio** — `useMoveDeal.ts:329` faz rollback sem toast, e o
  `onSettled` nao invalida de proposito. Nao causou este caso; e a proxima armadilha da familia.

🎁 **REQUISITO QUE ELA ENTREGOU DE GRACA, e que muda a 2.18:** *"tive que entrar nas mensagens
pra relembrar qual e o tipo de conversa que eu tive, quem era o cliente, porque ta desde o
comeco do mes e eu nao lembro de todo mundo."* ⇒ **o card precisa dizer QUEM E a pessoa sem
obrigar a abrir a conversa.** Levar ao @sm antes de escrever o codigo da 2.18.

📌 **Licao:** o contraste do relato valeu mais que o relato. Das 5 colunas que ela citou, foi a
**intacta** (`Avaliacao agendada`) que apontou o culpado — se fosse a tela toda, teria zerado
tambem. E duas das quatro que ela deu como zeradas **nunca receberam card**: relato de usuario
erra na borda e acerta no centro. Descartar o todo por causa da borda teria custado o dia.

Story: `docs/stories/2.31.o-quadro-esconde-o-que-ela-classifica.story.md`

---

## Sessao 2026-08-12 (5) — ✅ story 2.33: o board vira o funil que ela usa

> Commits **`be38fa1`** (execucao) + **`9b5a101`** (correcao). Mudanca de DADO e CONFIG, nao de codigo.

**Pedido da Fernanda por audio.** Board hoje: `Lead novo` 139 · **`Contato Realizado` 55** ·
**`Qualificado` 67** · Apresentacao 16 · Aguardando 12 · Avaliacao agendada 5 · Avaliacao realizada 0 ·
` Proposta enviada` 0 · Ganho 4 · Perdido 18 · 🆕 **`Profissional`** 0 · 🆕 **`Projeto Social`** 0.
**Sairam:** `Em qualificacao ` e `Em negociacao`. Ordem **0-11 sem buracos**.
A transferencia automatica (story 2.5) agora aponta para **`Qualificado`**.

### ✏️ O ERRO QUE COMETI, e a correcao — leia antes de mexer nisto

Eu registrei que apontar a transferencia para `Qualificado` faria "o lead nascer qualificado sem
ela ter qualificado" e que isso tornaria o T3 da 2.17 inerte. **Estava errado, e o erro mudou uma
decisao** (movi os 56 cards para `Contato Realizado`).

**O Filipe corrigiu:** a IA transferir **JA E** a qualificacao — ela fez o roteiro inteiro. O
*"a partir do contato eu qualifico"* da Fernanda e o **OUTRO caminho**: o lead inicia e nao
finaliza, a IA nao qualifica, ele fica em `Lead novo`, ela assume, move para `Contato Realizado`
e qualifica na mao.

| Caminho | Como anda |
|---|---|
| 🤖 automatico | completa o roteiro → IA qualifica e transfere → `Qualificado` |
| ✋ manual | abandona no meio → fica em `Lead novo` → ela assume → `Contato Realizado` → ela qualifica |

⇒ **O T3 da 2.17 NAO ficou inerte** — ele cobre o caminho manual. E os 56 voltaram para
`Qualificado` (`Qualificado` 10 → 67).

📊 **Nuance medida:** dos 56, so **41** tem os dois campos da regra dela; 11 parciais, 4 sem nenhum.
Nao e defeito da regra nova — e **mistura de duas eras**: ate 11/08 a IA transferia com **1,32
perguntas** (monobloco 5,9%); a regra que a faz completar o roteiro entrou **ontem** (4,23 e 77,5%).

🔑 **Licao:** registrar a consequencia foi certo; o conteudo do que registrei estava errado.
**Quem conhece a operacao e quem opera** — eu li a mecanica do board e inferi a intencao.

### Como foi feito (o procedimento vale para a proxima)

- **AC0 mediu as 15 FKs** que apontam para `board_stages` antes de apagar: `boards`,
  `integration_inbound_sources`, `webhook_events_out`, `ai_conversation_log`,
  `ai_pending_stage_advances` = **zero em todas**; `stage_ai_config` tem **0 linhas**.
- **A rede de seguranca estava no schema e foi usada como gate:** `deals_stage_id_fkey` e
  **NO ACTION** ⇒ aborta o DELETE se sobrar card. Mover primeiro, apagar depois.
- **Sempre por UUID:** `Em qualificacao ` tem **espaco no fim do nome**.
- **A migracao corretiva move so quem AINDA estava em `Contato Realizado`** — nunca desfazer
  trabalho de usuario.
- 🚨 **O `git check-ignore` REPROVOU o backup antes do commit:** `.dados-leads/` nao estava no
  `.gitignore` e **nome de lead iria para o historico PERMANENTE do git**. Ate hoje esses backups
  viviam FORA do repo e o furo nunca mordeu. **5a vez no mes** que um gate parecia cobrir e nao
  cobria. Corrigido.
- Backup: `.dados-leads/board-colunas-pre-2026-08-12/` com **`REVERTER.sql`** ao lado.

⏳ **AC6 ABERTO:** falta ela abrir o board e mover um lead para `Projeto Social`.
📌 **E o pedido dela nao esta inteiro:** as colunas existem, mas **nada poe o lead nelas sozinho**.
Enquanto for manual, depende de ela lembrar — que e literalmente a queixa (*"eu nao anoto nada"*).
Fechar isso = a extracao identificar interesse em projeto social e rotear. **Vira story propria.**

---

## Sessao 2026-08-12 (4) — 🧱 base do painel da 2.19 + story 2.32

> Commits **`fedd1d4`** (2.32) · **`5582828`** (renumeracao) · **`60fef7e`** (view).

### ✅ Story 2.32 — o botao "Mensagem" abre a conversa DAQUELE lead

⚠️ **Renumerada de 2.31 para 2.32:** duas sessoes trabalharam no repo hoje e **as duas criaram uma
"story 2.31"** (esta e a do filtro do board, `ddb59bf`). Sem conflito de codigo, so de numeracao.
A outra ficou com o numero porque o vault ja a registrava assim. **O commit `fedd1d4` segue dizendo
"2.31"** — historico publicado nao se reescreve para ficar bonito.

A guarda era `if (!contactIdParam || selectedConversationId) return`. O 2o termo e **estado de UI**:
com conversa aberta, o efeito desistia antes de resolver o contato novo. **Mesma classe da 2.27**
(consumo de parametro de URL decidido por estado de UI) — a 2.27 corrigiu a instancia e **nao varreu
a classe**. Varredura feita e contada: **6 consumidores, 2 da classe**, os dois fechados.
Conserto: `features/messaging/utils/resolverContatoDaUrl.ts` — a conversa selecionada **nao e
parametro** da funcao, entao reintroduzir o defeito exige mudar a assinatura.

### 🧱 A base do painel (story 2.19) — view `v_origem_da_conversa`

**A definicao mudou, e a do Filipe estava certa:** "lead que chegou" **nao** podia ser contado por
deal (o card nasce quando o lead inicia ⇒ daria 100%). O sinal e a **direcao da PRIMEIRA mensagem**
da conversa. **Validado contra a contagem manual dela: ela anotou 116 iniciadas por ela em julho;
a definicao devolve 118.**

🛑 **E o achado que muda o escopo:** julho existe em **conversas** (452: 334 lead / 118 equipe) e
**NAO existe em deals** — a story 2.24 apagou fisicamente os 431 cards de julho e preservou
conversas por escopo. ⇒ **O AC5 ("julho continua respondivel") so e atendivel por conversas.**
⚠️ O CRM so tem dados **a partir de 24/07**, entao o "963" do painel antigo nao e reproduzivel —
e o CRM ve **118 iniciadas por ela so na ultima semana de julho**, o que reforca a desconfianca que
ela mesma tinha ("116 conversas iniciadas, impossivel").

**Definicoes fechadas pelo Filipe:** *lead que chegou* = o lead inicia · *lead que falei* = ela
inicia. **SP x fora:** a classificacao sera feita **pela IA** (sao so 62 valores distintos em texto
livre), nos existentes **e** na extracao futura.

⏳ **O que falta da 2.19:** a TELA (blocos A/B/C com a definicao escrita em cada numero — AC1) e a
chamada de classificacao de SP. **O dado ja esta pronto para os dois.**

---

## Sessao 2026-08-12 (3) — ✅ story 2.30: o piscar do valor antigo depois de salvar

> Commit **`8c20ba9`**, deployment `state=success`, alias **HTTP 200**.
> ✅ Fecha o **AC7 da 2.29** — o valor salvo passou a aparecer **sem F5**.

**Relato:** *"aparece rapidamente o antigo e muda para o novo"*.

🔑 **O residuo era pista, nao cosmetica.** Antes da 2.29 o campo ficava PRESO no valor velho;
agora aparece e **e corrigido** ⇒ alguem seguia escrevendo a leitura velha no cache, e o que
mudou foi passar a existir quem corrigisse. **O piscar era o conserto ficando visivel.**

**Causa:** `useUpdateDeal.onSettled` refetchava o board inteiro. O refetch parte logo apos a
escrita e aterrissa com leitura stale por cima do otimismo.

📌 **Ja estava diagnosticado no repo — no hook irmao:** `useMoveDeal.ts:336-343` descreve o
mecanismo palavra por palavra e por isso NAO invalida. O caminho de mover card resolveu; o de
editar campo manteve. **O defeito nao era desconhecido, era desigual.**

**Conserto:** `refetchType: 'none'` — a rede de seguranca fica (query segue marcada stale, e o
`refetchOnMount` do `useDealsByBoard` reconcilia na proxima montagem), sai so a corrida. De
quebra some um refetch de 4 consultas a cada campo salvo.

**Oraculo:** `git stash` do conserto ⇒ o teste reprova com
`expected 'Santos' to be 'Guarulhos'` — o sintoma relatado, **literalmente**.

⚖️ **Fora de escopo de proposito:** `useCreateDeal` e `useDeleteDeal` seguem refetchando — la o
refetch TRAZ o enriquecimento (`contactName`, `companyName`, `stageLabel`) que o otimismo nao
tem, em vez de competir com ele.

Gates: lint 0 · typecheck · **674 testes** · build. ⏳ **AC4 ABERTO:** falta ela salvar e nao ver
o piscar.

---

## Sessao 2026-08-12 (2) — ✅ story 2.29: UMA traducao so do banco para a tela

> Commit **`538e6fb`**, deployment `state=success`, alias **HTTP 200**. SDC completo.

**Relato do Filipe testando a 2.28:** salvava campo personalizado, o card seguia mostrando o
valor anterior, **e so o F5 corrigia**. ✅ De quebra isso **fechou o AC9 da 2.28** — o pop-up
apareceu e o "Salvar e fechar" funcionou na tela real.

🔑 **O relato ja trazia o diagnostico:** *"quando atualizo a pagina aparece"* ⇒ o banco TEM o
dado. Nao e gravacao, e **entrega ao cache**.

**AC0 eliminou o suspeito errado antes de acusar:** com `QueryClient` real e observer ativo, o
caminho da mutacao (otimismo → escrita → invalidate → refetch) termina com o valor **NOVO**.
Sobrou um unico escritor na janela seguinte: o Realtime.

**Os dois defeitos, provados por teste:**
- **(A)** a traducao banco→app do Realtime era **lista escrita a mao de 7 campos**;
  `custom_fields` ficava de fora ⇒ entrava em snake_case e o `customFields` que a tela le
  **mantinha o valor velho**. Explica os dois sintomas: *"some"* = valor velho vazio;
  *"volta pro antigo"* = valor velho preenchido.
- **(B)** a decisao de aplicar olhava **so o estagio** ⇒ confundia MOVIMENTACAO com
  ATUALIZACAO e descartava toda edicao que nao move o card.

🎯 **A causa raiz nao era `custom_fields`: era existirem DUAS traducoes do mesmo dado.** A copia
manual nasce desatualizada no dia em que alguem adiciona coluna — e falha **calada**.
Varredura de `payload.new`: **4 locais, 3 quebrados** (UPDATE com 7 campos · INSERT com 12,
ainda mapeando `company_id`, **coluna que nao existe** · deal ausente entrando **cru**). O 4o
(mensagens) ja usava a canonica.

📌 **E este padrao ja estava DOCUMENTADO na story 2.14** e nao foi consertado —
*armadilha documentada nao e armadilha resolvida*.

**Conserto:** `lib/realtime/normalizeDealRow.ts` traduz com **`transformDeal`** (a mesma do
fetch), preserva o enriquecimento do `DealView` no merge, e decide frescor por **`updated_at`**.
A protecao contra o card "pular de volta" continua — agora pelo timestamp, sem cegar a linha.
`useRealtimeSync.ts`: **1.019 → 732 linhas**. Regra escrita no `CLAUDE.md`.

**Oraculo:** a implementacao ANTIGA foi **reconstruida dentro do teste** e reprova nas mesmas
assercoes (o codigo defeituoso era inline num hook de 1.019 linhas — sem `git stash` possivel).
Gates: lint 0 · typecheck · **672 testes (+13)** · build.

⏳ **AC7 ABERTO:** falta ela editar um campo, salvar e ver o valor novo **sem F5**.

---

## Sessao 2026-08-12 (manha) — ✅ story 2.28 no ar: o aviso parou de prender a tela

> SDC completo (@sm → @po → @dev → @qa → @devops). Commit **`2531da6`**, deployment
> `state=success`, alias da Fernanda **HTTP 200** — verificado na fonte, nao pelo `git push`.

### 🛑 O AC0 derrubou o diagnostico da noite anterior em DOIS pontos

1. **O `FocusTrap` nao veio da 2.27** — `git log -S` o encontra no **`initial commit`**.
2. **O contra-indicio caiu: o `ConfirmDialog` de excluir card TAMBEM estava morto.** Ou seja,
   **nunca funcionou de dentro do card** — ninguem tinha tentado excluir um negocio por ali.

⇒ **A 2.27 nao criou o defeito. Ela estreou o unico caminho em portal que a Fernanda percorre
todo dia.** Regressao de **exposicao**, nao de mecanismo. O defeito era do repo desde o comeco.

### 🕳️ Por que 602 testes ficaram verdes com a tela travada

    // DealDetailModal.test.tsx:132  (antes)
    FocusTrap: ({ children }) => <>{children}</>,     // o trap era MOCKADO fora

O suite arrancava o trap: **o componente testado nunca foi o que roda em producao.** Isso tambem
derrubou a parede do `.env.local` — o defeito virou reproduzivel **em teste**, sem navegador.

### 🔧 O conserto, em duas camadas

- **`lib/a11y/components/FocusTrap.tsx`** — `allowOutsideClick` deixou de ser amarrado a
  `clickOutsideDeactivates` e virou **prop propria, default `true`**. O trap segue confinando
  `Tab`; so parou de **cancelar clique alheio**. Cobre qualquer portal futuro, no repo inteiro.
- **`DealDetailModal.tsx:1449`** — o trap do card **cede** enquanto ha dialogo em portal por cima
  (`active={isOpen && !avisoPendencia && !deleteId}`). Sem isso o clique voltava mas o **teclado**
  nao: dois traps ativos disputam o `focusin`. O Radix ja traz o proprio confinamento.

### 🧪 Provas

- **Oraculo por `git stash` do codigo de producao: 5 testes REPROVAM com o codigo antigo** e passam
  com o conserto. O 6o e **controle negativo** (mesmo dialogo sem trap) e passa dos dois lados.
- **AC5** trava que o `Tab` continua confinado — o conserto nao podia ser "desligar acessibilidade".
- **Classe varrida e contada:** 12 call sites de `FocusTrap`, **so 2 aninhavam portal** — os dois
  consertados. Os outros tem `<select>` nativo e conteudo inline.
- Gates: lint 0 warnings · typecheck · **659 testes (+8)** · build.

⏳ **AC9 ABERTO:** nada foi visto em navegador. **So a Fernanda fecha** — abrir card, editar campo,
fechar e sair pelos tres botoes. *Provado em teste, ainda nao em uso.*

📩 **Liberado o que estava travado:** o paragrafo do botao Salvar pode ir para ela **depois** que
ela confirmar que os botoes respondem.

---

## 🚨 P0 — o que sobra da noite de 11/08

### 1. ✅ ~~O aviso "Voce nao salvou" prende a tela~~ — **CORRIGIDO em 12/08 (story 2.28, `2531da6`)**

> Mantido abaixo o diagnostico original **porque ele estava parcialmente errado**, e o erro ensina:
> a hipotese do trap estava certa no mecanismo e **errada na origem** (culpei a 2.27; o trap era
> anterior a tudo). O "teste que decide" foi rodado — e o irmao reprovou junto, como previsto.

**Nao e um botao quebrado, e uma armadilha sem saida:** ela nao consegue Salvar, nem Descartar, nem
Continuar editando. A saida provavel e **recarregar a pagina perdendo o texto** — exatamente o que a
story existia para impedir. *O recurso que protege inverteu de sinal.*

**Hipotese principal (lida no codigo):**
- `DealDetailModal` envolve o conteudo em **`FocusTrap`** (`lib/a11y/components/FocusTrap.tsx`) com
  `clickOutsideDeactivates = false` => **`allowOutsideClick: false`**
- `FecharComPendenciasDialog` e um **Radix `AlertDialog`**, cujo `AlertDialogContent` fica dentro de
  **`AlertDialogPortal`** => renderiza no `document.body`, **fora** de `<div data-focus-trap-fallback>`
- => os cliques nos 3 botoes ocorrem "fora" do trap e sao **cancelados**

**Contra-indicio (registrado de proposito):** o `ConfirmDialog` de excluir card usa o **mesmo** Radix
AlertDialog com portal, **no mesmo modal**. Se ele funciona, a causa **nao** e o trap.

**🧪 Teste que decide, 30 segundos: tentar EXCLUIR um card pelo modal.**
- "Confirmar" tambem nao responde => **e o trap**; consertar uma vez vale para todos os dialogos
  (caminhos: `clickOutsideDeactivates`/`allowOutsideClick`, ou renderizar o dialogo **dentro** do trap,
  ou desativar o trap enquanto o aviso estiver aberto)
- "Confirmar" responde => **hipotese cai**, recomecar a investigacao

**Por que os 602 testes passaram:** montam o dialogo **isolado**, sem o `FocusTrap` real e sem ponteiro.
Mesma familia do "teste nao enxerga pixel" da 2.27b.

⚠️ **NAO enviar a ela o texto do botao Salvar antes do conserto** — seria ensinar a usar um botao que
prende a tela.

### 2. 🔀 O botao "Mensagem" do card leva SEMPRE para a conversa errada (e sempre a mesma)

Relato **com video**. Causa lida:

    // features/messaging/MessagingPage.tsx:140
    if (!contactIdParam || selectedConversationId) return;

O card faz `router.push('/messaging?contactId=...')` (`DealDetailModal.tsx:786`). Com uma conversa **ja
selecionada**, o efeito **desiste antes de tentar resolver o contato novo** => ela continua vendo a
conversa anterior ("foi para outro lead"), e como o estado nunca muda, **vai sempre para a mesma**.

🔑 **A guarda inverte a prioridade: o estado velho vence a intencao nova** — e chegar por `?contactId=`
e a intencao mais explicita que existe.

🪞 **MESMA CLASSE da 2.27** (guarda de consumo de parametro de URL decidida por estado de UI; la era
`dealIdFromUrl && !selectedDealId`). **Consertei num arquivo e nao varri a classe.**
=> Ao corrigir, **varrer a classe**: procurar todo consumo de `searchParams` guardado por estado de UI.

---

## O que é
Fork do **`nossocrm`** (Thales Laray) — CRM open-source com IA nativa. Stack: **Next.js 16 (App Router) · React 19 · Supabase · TanStack Query v5 · Zustand · AI SDK v6 (Gemini)**. É a base de código do **CRM IA do Acreditando** (comercial da Fernanda, ~700 leads/mês).

- Repo: `github.com/fbrain-acreditando/acreditando-crm` — **`main` = auto-deploy Vercel** (projeto `acreditando-crm`, org `fbrainacreditando-3497s-projects`).
- Supabase do CRM: ref **`jmjhtprnxjffaqhdzfmc`** (org própria, ≠ NeuroIA).
- Deploy manual não é necessário: **commit + push no `main`** dispara o build.

---

## Sessão 2026-08-11 (noite) — 🟢 story 2.17 no ar · 🛑 o AC0 matou o T1 e travou o AC4 da 2.19

> SDC completo (@sm → @po → @dev → @qa → @devops). Destravada pelas **respostas da Fernanda**,
> que chegaram por WhatsApp no fim do dia.

### 📥 O insumo que destravou tudo — respostas literais dela

> *"1. 24 horas"* · *"2. Onde mora e o tipo de lesão"* · *"3. todos as opções"*
> *"O lead que eu ligo primeiro: SP e se chega até o final de conversa com a IA já dizendo como quer conversar"*
> *"Reunião: diretoria e MKT"*

E a definição que faltava, dada pelo **Filipe**: **"SP" = a CIDADE de São Paulo** (não Grande SP, não o estado).

⇒ Fecha 3 bloqueios antigos: as duas definições da **2.17**, a lista de métricas da **2.19** e a
pergunta *"com quem é a reunião de 14/08?"*, aberta desde 07/08 — **é diretoria + MKT**.

### ✅ Story 2.17 — NO AR (`38a027e`, deploy `success`, HTTP 200 no alias dela)

**O `AC0` mudou a story DUAS vezes antes de existir uma linha de código:**

1. 🛑 **O destino do `T1` não existe.** O board tem **12 estágios e nenhum é "sem resposta"**; o
   candidato pelo nome (`Aguardando retorno`) está em **`order` 5, DEPOIS de `Qualificado`** ⇒ usá-lo
   contradiz a regra de não-regressão e **prenderia o lead no fundo do funil para sempre**.
   **Decisão do Filipe: o T1 sai da story e vira número de painel na 2.19.**
   🎁 **De graça:** sem o T1 caiu a necessidade de **`pg_cron`** (o job existia só para ele — T2 e T3
   são por evento), sumiu o risco de corrida job×webhook e a estimativa foi de **G para M**.
2. 🔑 **`Lead novo` tinha 141 cards e 124 JÁ HAVIAM RESPONDIDO — 88% mentindo.** A única movimentação
   automática existente (story 2.5) só dispara **na transferência para humano**, e a maioria dos leads
   responde **sem nunca ser transferida**. É o vão que o T2 cobre — e a explicação de por que ela
   seguia classificando na mão *mesmo com automação no ar*.

**O gate do @qa pegou um erro de ORDEM que teria matado a 2.5 em silêncio:** o webhook passou a ler
`replied_stage_id`; deploy **antes** da migração faria o PostgREST errar a coluna, o
`getTransferRoutingRule` cair no `return null` e **`moveDealOnTransfer` parar de mover o card** — sem
exceção, sem alarme, respondendo 200. ⇒ **migração primeiro, deploy depois.** Foi nessa ordem.

⛔ **NASCEU DESLIGADA (AC10), e isso é schema:** `replied_stage_id` e `qualified_stage_id` estão
**`NULL` em produção** (read-back conferido; `transfer_stage_id` intacto). **Nada se move até alguém
configurar.** Quando ligar, **185 de 242 cards (77%)** se reorganizam de uma vez.

**Provas:** testes por **mutação nos dois runtimes** (desliguei a trava de não-regressão → 2 reprovam
de cada lado; religuei → verde). O **contrato entre os gêmeos** Deno/Node (a definição de
"qualificado" existe duas vezes porque os runtimes não compartilham import) está **travado por teste
campo a campo**. Gates: lint 0 · typecheck · **651 testes (+31)** · build.

⚠️ **Declarado, não marcado como ✅:** o **AC3** é **parcial** — a monotonicidade protege tudo que ela
**avançou**, mas se ela mover um card **para trás** de propósito, a automação pode empurrá-lo de volta.
Não há registro de "quem moveu por último" no schema. **A 2.5 vive com o mesmo limite desde 03/08.**
O **AC8** segue aberto: falta uso real.

### 🛑 Story 2.19 — @po revalidou (🟡 GO condicional) e o `AC0` travou o AC4

**"São Paulo × fora" não é implementável como está.** Dois problemas medidos:

| Medida | Valor |
|---|---|
| Deals vivos no board | 299 |
| Com `ondeReside` preenchido | **69 (23%)** |
| Valores **distintos** entre os 69 | **62 (90% únicos)** |
| Casam com texto "São Paulo"/"SP" | 19 — **a maioria NÃO é a capital** |

🪤 **O filtro óbvio erra nas DUAS direções, com exemplos reais:**
*falsos positivos* → `Cotia São Paulo` · `Mauá São Paulo` · `Campinas sp` · `Jundiaí-SP` ·
`Praia Grande SP` · `Araçatuba, SP` · `Interior (4 horas de São Paulo)`
*falsos negativos* → `Sapopemba` · `Morumbi` · `Butantã` · `Itaquera zona leste` ·
`São Miguel Paulista` · `Brooklin Paulista` · `Zona leste` (4×)

🔑 *Não erra "um pouco": erra quase inteiro, e erra parecendo funcionar.*

**🔴 DECISÃO PENDENTE DO FILIPE — 3 caminhos:** (a) dicionário de bairros/municípios · (b) campo
estruturado novo na extração (só vale para lead futuro) · (c) **entregar o que existe + "não
classificável" explícito**. 📌 O próprio AC4 já mandava o **(c)**; recomendação registrada:
**(c) agora, (a) depois de 14/08** — número geográfico errado na frente da diretoria custa mais que
a ausência dele.

✅ **Não dependem dessa decisão e seguem prontos para implementar:** Blocos **A** e **B** inteiros +
o ranking de motivos de perda.

⚠️ **Duas definições continuam SEM resposta** — *o que conta como "lead que chegou"* e *"lead que eu
falei"*. **As perguntas nunca foram enviadas.** O @po liberou o @dev a escolher a mais defensável **e
escrevê-la na tela** (o AC1 já exige isso), mas o **AC7 continua sendo o gate real**: bater com a
anotação manual de agosto dela antes de a tela ir para uma reunião.

### 🧰 Ferramenta nova: `scripts/db/aplicar-migracao.mjs`

Aplica **um** arquivo de migração seguindo o contrato de escrita segura. Extrai as colunas prometidas
**do próprio SQL** (para o read-back não depender de eu redigitar a lista e errar), **recusa
`DROP`/`TRUNCATE`**, exige `--eu-autorizo` e **sai com erro se o read-back não achar tudo**.
Existe porque `supabase/migrations/` **não é a fonte da verdade** neste projeto (pendência nº 14).

### 🔑 Para retomar amanhã

1. 🔴 **Decidir o caminho do AC4** da 2.19 (a/b/c) — destrava "SP × fora" e "prontos para ligar"
2. 🟢 **Implementar Blocos A e B** da 2.19 — não dependem de nada
3. ⛔ **Decidir QUANDO ligar a 2.17** (configurar os dois `stage_id`) — provavelmente **depois de 14/08**
4. 🚨 **Os dois P0 da Fernanda** (topo deste arquivo) — chegaram depois e **não foram corrigidos**
5. 📩 **Perguntar a ela as 2 definições** que faltam ("lead que chegou" / "lead que eu falei")

---

## Sessão 2026-08-11 (tarde) — 🗑️ julho apagado · 🫥 soft delete ligado · 🫨 3 pedidos da Fernanda

> **4 stories no ar em uma tarde: 2.24 · 2.25 · 2.26 · 2.27.** Commits `d1f75c6`, `a0d4277`,
> `d02ebde`, `dcb1a21` — todos **pushados** com read-back no remoto.
> **Estado do banco ao fim:** `deals` **295** · **0** com `deleted_at` · contatos 787 · mensagens ~10.356.

### 🚨 O achado que abriu a tarde: o soft delete NUNCA chegou à tela

A story 2.16 marcou 431 leads em 10/08, reportou *"read-back 8/8"* — e **a Fernanda continuava
vendo os 724**. Nenhuma camada filtrava `deleted_at`: nem `deals.getAll`, nem `dealsViewQueryFn`,
nem `makeSelectByBoard`, nem a RLS — e o `transformDeal` **sequer mapeia o campo**, então não havia
como filtrar depois. `deals` é BASE TABLE, sem view escondida.

O read-back da 2.16 foi feito **em SQL, com o filtro escrito à mão**; o **AC6 — *"a Fernanda abrir
o board"*** nunca rodou. 🔑 **A distância entre "provado em read-back" e "provado em uso" era o
board inteiro.**

### 2.24 — exclusão física dos leads de julho (`d1f75c6`)

Decisão do Filipe **depois** de ler o parecer contrário (ligar o filtro daria o mesmo efeito, em 1
linha e reversível). Registrado na story como escolha informada.

| | |
|---|---|
| Resultado | `deals` **724 → 293**; a linha de julho **sumiu do `group by`** |
| Cascata real | **431 deals + 11 `activities`** |
| Intactos | contatos **787** · conversas **745** · mensagens **10.356** |
| Backup | `.dados-leads\crm-julho-pre-delete-2026-08-11-14-30\` + `RESTAURAR.mjs` ao lado |

✏️ **O AC0 derrubou o meu próprio alerta.** Eu havia dito *"9 tabelas em CASCADE"* lendo a **forma**
do schema. Medido: **8 estão vazias**, e `voice_calls` (NO ACTION), a única FK capaz de abortar o
`DELETE` no meio, tem **zero** linhas. ⇒ *schema diz o que PODE acontecer; só a contagem diz o que VAI.*

🪤 **Meu 1º dry-run do restaurador passou sem testar nada** — o `ON CONFLICT DO NOTHING` pulou as 431
porque elas ainda existiam. Trocado pelo **ensaio do ciclo completo** (apaga → restaura do arquivo →
reconta) dentro de `DO $$ … RAISE EXCEPTION $$`, abortado **pelo Postgres**, não pela rede.
**Provou a volta, não só a ida.**

### 2.25 — soft delete que esconde de verdade (`a0d4277`)

**AC0 dobrou o escopo.** Dos **85 acessos** a `deals`, **5** são leituras de tela — e **duas travam
funcionalidade**, não só mostram número errado:

| Ponto | O que fazia |
|---|---|
| `deals.getAll` | board inteiro mostrava excluídos |
| `deals.getById` | card excluído abria por link direto |
| `boards.canDelete` | pré-check contava cards mortos |
| `boards.deleteStage` | **IMPEDIA excluir estágio** por card inexistente |
| `contacts.hasDeals` | pré-check de excluir contato contava mortos |

🐛 O filtro **expôs** um defeito no `getById`: com `maybeSingle()` devolvendo `null`, o
`transformDeal` estourava e o `catch` virava *"não existe"* em *"deu erro"*. Guardado.

⚖️ **Sem ganho de performance, e a story diz isso:** 0 deals com `deleted_at` ⇒ `getAll` deixa de
trazer **zero** linhas.

🔴 **DÍVIDA VIVA:** `lib/ai/**`, `lib/mcp/**` e `app/api/public/v1/**` (**~70 acessos**) **seguem sem
filtro** ⇒ **a IA e a API pública enxergam deal excluído.** Escrito no `CLAUDE.md` do repo.

### 2.26 — o campo que piscava e o motivo "Distância" (`d02ebde`)

**Relato dela:** *"escrevo, apaga sozinho e depois aparece — fica piscando"*.

**Causa:** input controlado **direto pelo servidor**, gravando **a cada tecla**. O update otimista
**existia e não resolvia** — o problema era a **reconciliação chegando atrasada sobre um input sem
memória própria**. 🔴 **Custo determinístico:** `dealsViewQueryFn` faz 4 consultas ⇒ digitar
"Distância" custava **9 UPDATEs + 9 broadcasts + ~36 consultas**. *A lentidão da 2.23 sendo
produzida ao vivo pela digitação dela.*

📊 **"Distância" não era preferência:** dos 11 perdidos, **6 eram distância em 3 grafias**
(`distância` 4 · `distãncia` **com til** 1 · `distância e parte financeira` 1) — e os 5 botões que já
existiam, **somados**, foram usados 2 vezes. **O motivo mais comum era o único sem botão.**

✅ **AC5 executado** (autorizado): **5 linhas → `Distância`**; `distância e parte financeira`
**mantido** (são dois motivos e o campo guarda um). Motivos distintos **9 → 8**. Backup +
`REVERTER.sql` em `.dados-leads\crm-motivos-perda-2026-08-11-15-05\`.

🪤 **Meu read-back mentiu:** `lower(btrim(loss_reason)) in ('distância','distãncia')` acusou **5
"variantes restantes"** — casava com o **próprio canônico** em minúsculo. Refeito com
`loss_reason <> 'Distância'`: **zero**. 🔑 *A trava do read-back não é reler; é reler com um
predicado que consegue estar errado.*

### 2.27 — o modal que reabria sozinho e o Salvar explícito (`dcb1a21`)

**Relato dela:** *"a aba fecha e fica abrindo sozinha; clico no X, some e aparece de novo"*.

`setSelectedDealId` é chamado em **3 lugares**. Dois são `onClick` no card, e o modal tem
**backdrop** ⇒ o X **não atinge o card atrás**. Sobra o efeito do `?deal=`, cuja guarda era
`dealIdFromUrl && !selectedDealId`. 🔑 **`!selectedDealId` é estado de UI que ela zera ao fechar** ⇒
fechar destrava a guarda ⇒ reabre ⇒ **laço**.

**Correção:** guarda virou **ref que lembra QUAL valor foi consumido** (o valor, não booleano — senão
um `?deal=` diferente deixaria de abrir). A limpeza da URL saiu de `router.replace('?')`.
**Duas defesas**, porque a da URL é a que não dá para testar sem `.env.local`.

**Salvar explícito:** campos personalizados não gravam mais sozinhos — pendentes no modal, **1
escrita em lote**, barra com Salvar/Descartar, **borda âmbar no campo alterado**, e aviso nas **3
saídas** (X, backdrop, Escape) + mobile.

🎁 O pendente **mata o piscar da 2.26 por construção** — o refetch não chega ao input.

🪤 **O teste achou defeito no meu conserto:** `salvarCampos` limpava os pendentes **antes de saber se
gravou**. Como a barra some junto, ela veria o botão sumir e **concluiria que salvou, com o texto
perdido**. Agora só limpa em caso de sucesso, e *"Salvar e fechar"* **não fecha se falhar**.

### 🎨 Correção de layout do aviso (print do Filipe) — `8297aa1`

O `buttonVariants` do repo já traz **`h-10`** e **`whitespace-nowrap`**; o `AlertDialogCancel` e o
`AlertDialogAction` herdam. **Eu escrevi o "Descartar e fechar" como `<button>` cru** ⇒ sem altura
fixa e sem `nowrap` ⇒ o rótulo **quebrou em duas linhas** e desalinhou a fileira.

🔑 *Botão irmão no mesmo diálogo tem de sair da **mesma fábrica de estilo**. À mão, a geometria
diverge **em silêncio** — nada quebra, nada avisa, e só aparece em print.*

Os três agora ficam **empilhados também no desktop** (os rótulos em pt-BR somam ~446 px e o diálogo
tem ~336 px úteis ⇒ em linha, ou estoura ou quebra). 🪤 O teste achou de quebra que o
**"Continuar editando" disparava DUAS vezes por clique** (o Cancel fecha pelo Radix, o fechamento
cai no `onOpenChange`, e eu ainda tinha um `onClick`).

⚠️ **Não verificado em pixel** — sem `.env.local`. A conferência visual é do Filipe.

### 🚀 Deploy — verificado na fonte, não presumido

| Camada | Leitura |
|---|---|
| Deployment | `dpl_9UNpgtKmcXhFM66tcGzca1owkgVN` · **● Ready** · build **2 min** |
| Commit | **`8297aa1`** · `target: production` |
| **Alias** | ✅ **`acreditando-crm-sandy.vercel.app`** — o endereço que ela usa |
| Fetch ao vivo | **HTTP 200** · `Age: 0` · servido de `gru1` |

**Os 6 commits do dia estão em produção**, cada um com deploy `Ready`.

🪤 **O que quase me enganou:** o GitHub marcou `success` **1 segundo** depois de criar o registro —
o que não bate com um build. Explicação: **a Vercel só cria o registro no GitHub quando o build já
terminou**. Se eu tivesse confiado só no timestamp do GitHub, teria concluído errado — e **sem saber
em qual direção**.

### 🧰 Os scripts de banco saíram da pasta temporária — `scripts/db/`

Reutilizáveis: **`sql-ro.mjs`** (executor somente-leitura) · **`RESTAURAR.mjs`** ·
**`ensaio-ciclo.mjs`**. Históricos, marcados *"leia, não rode"*: `backup-julho`, `apagar-julho`,
`normalizar-motivos`. `README.md` explica o contrato de escrita segura.

🪤 **DUAS armadilhas do `.gitignore`, pegas pelo `git check-ignore` ANTES do commit:**
1. `scripts/` ignorava a pasta inteira ⇒ os arquivos ficariam **só no disco**, repetindo
   exatamente a falha que a pasta existe para impedir. *Mesma família do `*.png` da story 2.13.*
2. Pôr `!scripts/db/` **não bastou**: o git **não reinclui arquivo dentro de diretório excluído**.
   Precisou virar **`scripts/*`**, senão o `!` é letra morta.

✅ Read-back arquivo a arquivo: **7 dentro**, `scripts/marca` **ainda fora**, e os 7 conferidos
**no remoto** pela API do GitHub.

### 🧪 O padrão de teste que se firmou nesta sessão

**Todo teste novo tem de reprovar com o código antigo.** Como o código defeituoso era **inline**
(sem `git stash` possível), ele foi **reconstruído dentro do arquivo de teste** e submetido às mesmas
asserções:

| Story | Prova |
|---|---|
| 2.25 | `git stash` do código de produção → **6 de 7 falham** |
| 2.26 / 2.27 | `InputAntigo` e `ConsumidorAntigo` reconstruídos no teste → **reprovam** |

*Teste que passa sem exercitar o caminho é teste que mente.*

### ⏭️ Próximos passos

1. 🛑 **AC6 da 2.27 + AC5 da 2.24 — só a Fernanda fecha.** O laço **não foi reproduzido** aqui
   (segue sem `.env.local`). Se ela ainda ficar presa, **a causa é outra e a story não está fechada**
   — próximo passo é o console dela, como na 2.14.
2. 📩 **A mensagem dela** (`docs/mensagens/RASCUNHO-fernanda-acumulando.md`) está pronta e atualizada
   (**293**, e "saíram de vez"). ⚠️ **Falta acrescentar que agora existe botão Salvar** — a tela mudou
   3× hoje e o comportamento de gravação **inverteu**.
3. 🔴 **Dívida da 2.25:** ~70 acessos em `lib/ai`, `lib/mcp` e `app/api/public/v1` sem filtro de
   `deleted_at`.
4. ⏭️ **AC4 da 2.23** (paginação) — recomendação segue **depois de 14/08**.
5. 🚩 **Story do vazamento de assinatura de Realtime** — 7 assinaturas vivas 10 min após fechar.
6. ✅ ~~Os scripts de banco vivem no scratchpad~~ — **resolvido**: estão em `scripts/db/`, no git.
7. 🎨 **Conferir o aviso na tela** — a correção de layout **não foi verificada em pixel**. Se ainda
   estiver torto, o print diz onde olhar.
8. ⚠️ **A tela dela mudou 4× hoje e um comportamento INVERTEU:** o campo personalizado **não grava
   mais sozinho**. Se ela digitar e fechar por reflexo, o aviso segura — **mas ela precisa saber que
   o aviso existe**. Isso ainda **não está** na mensagem.

---

## Sessão 2026-08-10 (noite) → 2026-08-11 — 🐌 auditoria de lentidão: **o banco é inocente**

> **Gatilho:** *"A Fernanda reclamou que o CRM está muito lento"* (relato do Filipe).
> **Resultado:** a medição **derrubou duas hipóteses minhas e o alvo da story que eu mesmo escrevi.**

### 🔬 O diagnóstico, medido em produção (não inferido)

Auditoria em 3 frentes (3 subagentes: dados · runtime/realtime · bundle) + medição direta no banco.

| Medição | Valor | Leitura |
|---|---|---|
| Query do **board** | **46 ms** | banco não é o gargalo |
| Query da **lista de conversas** | **67 ms** | idem |
| Tabela `deals` inteira | **704 kB** | — |
| **JS da tela de login** (a mais leve) | **894 kB** brutos / 270 KB comprimidos | 🎯 **o código pesa mais que o dado** |
| **Decodificador de WAL do Realtime** | **405 mil chamadas · 3.657.030 ms (61 min) · pico 4.898 ms** | 40× mais que todas as queries da app somadas |
| Lista de conversas em `pg_stat_statements` | 4.225 chamadas · 90.550 ms | 21 ms/refetch — ninguém sente |

**Gate decisivo (2 leituras de 180 s):**

```
0 assinaturas → delta ZERO chamadas, ZERO ms
7 assinaturas, Filipe usando  → 1,93 chamadas/s
7 assinaturas, Filipe fechou  → 1,94 chamadas/s
```

⇒ O WAL **só existe com cliente conectado** (logo é do app, não piso da plataforma), **mas a taxa é PLANA** — não depende de atividade. É **custo fixo de manter assinatura**, ~16,3 ms de CPU de banco por segundo de tela aberta (1,6 % de um núcleo, por usuário).

🎯 **A regra que nasceu disso:** *custo de servidor e latência de usuário são grandezas diferentes.* Os 61 min de WAL são conta do mês; **não são os segundos que ela espera olhando a tela.** Atacar o WAL para responder *"está lento"* seria trocar a pergunta.

⇒ **A lentidão dela mora no navegador**: 739 linhas viram objetos, 739 itens entram no DOM (zero virtualização), bolhas repintam.

### ✅ O que foi ao ar

| Commit | O quê |
|---|---|
| `b45f2ca` | **Story 2.22** — cron de cada minuto → `*/5`. 1.440 → 288 execuções/dia |
| `d0a0534` | **21 stories saem do `.gitignore`** e entram no git, com PII mascarada |
| `89d879b` | **Story 2.23, bloco 1** (AC1+AC2) — `useMemo` no thread + fim da busca O(n²) |
| `a341020` | Limpeza: uma story 2.23 só; 2.21 marcada como absorvida |

**Story 2.22 — o `AC0` trouxe uma 3ª hipótese.** Não era produtor quebrado nem volume raro: `stage_ai_config` tem **0 linhas** ⇒ a guarda `if (config.advancement_criteria…)` **nunca é verdadeira**. O avanço automático de estágio por IA está **inteiro no ar e inteiro inerte** (mesma família do BANT: 198 deals, zero). Read-back conferido; reverter = `cron.alter_job(2, '* * * * *')`.
❌ **Renomear o job (`stage-evaluations-1min`, que agora mente) está BLOQUEADO:** `42501: permission denied for table job`, e `cron.alter_job` não tem parâmetro de nome. O contorno exigiria reescrever o comando **com o `CRON_SECRET` dentro**. Decisão: não renomear; documentado no `route.ts` que a verdade é o `schedule`.

**Story 2.23, bloco 1.** `MessageThread.tsx:69` montava a lista no corpo do componente ⇒ array com identidade nova a cada render ⇒ (a) o `useMemo` de `messagesWithDates` nunca acertava e (b) `allMessages={messages}` ia para cada bolha, anulando o `memo()` — **todas repintavam**. E dentro da bolha, `allMessages.find(...)` por bolha = **O(n²)**.
Agora: `useMemo([data])` + `buildMessageIndex` (Map) + `repliedToMessage` resolvido no pai.
🧪 **8 testes comparam o índice novo contra a implementação ANTIGA como oráculo**, chave por chave — inclusive colisão `externalId` × `id`, onde um Map ingênuo daria outra resposta.

### 🛑 O que foi REPROVADO antes de virar código

- **AC3 (`getPresence`)** — o diagnóstico do agente estava **superestimado** e o conserto que **eu mesmo escrevi na story quebraria a funcionalidade**. `ConversationList.tsx:272` passa `presenceStatus` como **string primitiva** ao wrapper `memo()` ⇒ só a linha do contato repinta, não as 739. E `useRef` + `useCallback([])` tornaria `getPresence` estável ⇒ a lista **pararia de re-renderizar** ⇒ o *"digitando…"* sumiria. Trocaria lentidão por defeito silencioso.
- **`.limit()` puro na lista de conversas (story 2.21)** — o `AC0` reprovou: as **739 conversas têm atividade nos últimos 30 dias** (275 só nos últimos 7) ⇒ `.limit(100)` esconderia **86 %**. Tem de ser `useInfiniteQuery` + `.range()`.

### ✏️ Renomear o lead — a funcionalidade existe; o problema é **descoberta**

O Filipe pediu "poder editar o nome na tela de Mensagens". **Já dá:** `ContactPanel.tsx:194` monta o `LeadNameEditor`. Ele **não achou** — e depois achou sozinho.

- 🪤 **A causa:** `opacity-0 group-hover:opacity-100` — o lápis é **invisível até o hover**, sem `cursor-pointer`, sem underline, sem nenhuma pista.
- 📱 **E `hover` não existe em tela de toque.** O app **não tem nenhum tratamento de ponteiro** (zero `@media (hover)`, zero `pointer: coarse`); a detecção é por **largura**, e um iPad de 1024 px vira "tablet" sem hover ⇒ **inalcançável**. A `MessagingPage` **não é responsiva** (3 colunas fixas, 640 px de laterais `flex-shrink-0`).
- ✅ **O repo já tem a convenção certa:** lápis **sempre visível** em `ProductsCatalogManager.tsx:333`, `CustomFieldsManager.tsx:173`, `ProfilePage.tsx:402`. `opacity-0 group-hover` aparece ~20×, mas quase sempre em ação **secundária**; só **3 ações primárias** estão escondidas assim, e esta é uma.
- 📊 **`AC0`: 109 de 777 contatos (14 %) com nome inutilizável** — 43 sem nome, 28 com `@lid`, 14 só telefone, 24 com 1–2 caracteres. **Cresce sozinho** (todo lead novo entra com o `pushName`).
- 🔴 **O cabeçalho da conversa (`MessagingPage.tsx:308`) é texto puro** — é onde ele olhou primeiro.
- ✅ **Feito:** o Bloco 5 do rascunho da Fernanda foi reescrito — dizia *"passe o mouse no nome"* **sem dizer onde** e **sem avisar que no celular não funciona**.
- ⏭️ **Na fila (opção B, sem prazo):** lápis sempre visível. Pequeno, segue convenção da casa, resolve o toque.

### 🪤 Erros meus nesta sessão (registrados de propósito)

1. **Culpei o soft delete de ontem pela lentidão.** Errado: `deals.getAll` **sempre** trouxe a tabela inteira. O payload **não cresceu** — só ficou desperdiçado. O que mudou foi **quem usa**: a Fernanda entrou em 07/08 e virou usuária diária. **A lentidão é pré-existente.**
2. **Escrevi a mensagem de commit com here-string do PowerShell (`@'…'@`) dentro do Bash** ⇒ `b45f2ca` foi ao ar com `@` solto no assunto. Conteúdo intacto. **Decisão: não corrigir** — force push em `main` com auto-deploy, por um caractere, na semana da apresentação dela, não compensa.
3. **A trava do meu executor somente-leitura tinha furo:** bloqueia `\bALTER\b`, mas o comando era `select cron.alter_job(...)` e `_` conta como letra ⇒ **a escrita teria passado disfarçada de leitura**. Mesma família do `*.png` da 2.13: *o gate parecia cobrir e não cobria*.
4. **Declarei uma medição inválida sem conferir.** Disse que a janela estava suja porque o Filipe fechou o CRM; o dado mostrava **7 assinaturas nas duas pontas**. Conferi depois — estava limpa.

### ⏭️ Estado e próximos passos da 2.23

| AC | Estado |
|---|---|
| AC1+AC2 (`useMemo` + fim do O(n²)) | ✅ **No ar**, 8 testes |
| AC3 (`getPresence`) | 🛑 **Reprovado** — fora de escopo |
| **AC4** — paginação (`useInfiniteQuery`) | ⏭️ **Próximo**, decisão do Filipe pendente: fazer agora (com validação de tela) ou **depois de 14/08** *(recomendação: depois)* |
| AC5 — virtualização (`@tanstack/react-virtual`) | Depois do AC4, medindo entre um e outro |
| AC0.3 — tempo de repintura na tela | ⛔ **Bloqueado** — não há `.env.local` (só `.env.example`) e não houve aba logada. **A entrega vai dizer isso**, não trocar por métrica de servidor |
| AC8 — provado em uso | ⏳ **Perguntar à Fernanda se melhorou** — única medição que vale |

🚩 **Story nova a abrir:** **vazamento de assinatura de Realtime** — 7 assinaturas seguiam vivas **10 min** após fechar o CRM, cobrando os mesmos 1,94/s. É custo, não velocidade.

---

## Sessão 2026-08-10 — 🔒 2.16 EXECUTADA · 🛑 2.18 morta pelo próprio AC0 · 📝 2.20 nasceu `Ready`

> **Acesso ao banco restabelecido.** Token do Supabase em `.credenciais\supabase-crm-mgmt.token`
> (fora do chat), com executor **somente-leitura** que bloqueia verbo de escrita antes de sair da
> máquina, e um segundo executor de escrita que exige `--eu-autorizo` em toda chamada.
> ⚠️ **`.credenciais/` e `.dados-leads/` não estavam no `.gitignore` da raiz** — corrigido e
> conferido com `git check-ignore`. A pasta com PII dos leads do Meta estava versionável.

**Base no dia:** 707 deals · 768 contatos · 728 conversas · 1 organização. Eram **646 deals em
07/08** ⇒ **+60 em 3 dias**, e um lead entrou **durante a medição** (12:29). A base é viva:
remedir sempre antes de escrever.

### 🔒 Story 2.16 — EXECUTADA, sem uma linha de código

`AC0 → risco nº 1 → AC0.5 → ensaio ROLLBACK → AC5 → soft delete → read-back`, na ordem.

| Passo | Resultado |
|---|---|
| AC0 | julho = **431** (gate reprovava <50) |
| Risco nº 1 (`created_at` ≠ entrada) | **afastado** — mês pelo `created_at` × mês pela 1ª mensagem batem **100%** |
| AC0.5 backup | **707/707** · julho **431/431** · JSON+CSV em `C:\Users\filip_mg5w2c4\.dados-leads\crm-backup-2026-08-10\` |
| Ensaio | `431 · 431 · 0` — desfeito e provado |
| AC1 soft delete | **431 marcados**, HTTP 201 |
| AC3 read-back | **8/8 conferem** — 707 total · 431 escondidos · 276 visíveis · 0 erro dos dois lados |
| AC4 | 431 conversas intactas, **4.927 mensagens acessíveis** |

🧪 **Truque que vale reusar:** o ensaio **não** usou `BEGIN/ROLLBACK` solto — se o transporte da
API não honrasse a transação, o `UPDATE` persistiria. Usei bloco `DO $$ … RAISE EXCEPTION $$`,
que **aborta no próprio Postgres**. Rollback garantido pelo banco, não pela camada de rede.

🔧 **Rollback sem ambiguidade:** havia **0 deals com `deleted_at`** antes ⇒ `deleted_at IS NOT NULL`
é exatamente este conjunto.

⚖️ **Decisão do Filipe: AC2 (aviso na tela) FORA DE ESCOPO.** O board caiu de 707 para 276 cards
sem a interface explicar. Escolha consciente — ele avisa a Fernanda direto. **Com um 3º usuário,
o AC2 volta a ser necessário.**

🚨 **Efeito colateral saiu de dormente para ATIVO:** `boards.ts:664` **não filtra `deleted_at`**
(achado da 2.15) ⇒ o pré-check de excluir board agora conta **431 cards mortos**.

⏳ **Falta AC6** — a Fernanda abrir o board. Até lá: provada em read-back, **não em uso**.

### 🔴 O achado que vale mais que a operação: os 431 não são o mês de julho

O 1º lead do CRM é de **24/07 14:34** — a integração do GPTMaker entrou em 23/07. São **431 em
8 dias (~54/dia)**, não em 31. ⇒ **Explica a divergência com os 963 da Fernanda**: ela mediu mês
inteiro no WhatsApp, o CRM tem 8 dias. **Não se contradizem, e não podem ser somados.**
AC5 fechado pelo caminho (b): `julho-2026-para-a-reuniao.md`, gerado do backup, ressalva no topo.

### 🛑 Story 2.18 (estrelas) — BLOQUEADA pelo próprio AC0

`ondeReside` é **texto livre**: **28,2%** têm zona de SP · 62,4% bairro/cidade solta · 9,4% fora
de SP. E **só 98 dos 707 deals (13,9%)** têm qualquer extração. A regra como foi dita **não é
implementável** — 86% dos cards ficariam sem estrela, o que o AC2 dela proíbe. **Não aproximei.**
Volta ao @po com 4 caminhos; decisão é da Fernanda.

### 📝 Story 2.20 (editar o nome do lead) — nasceu `Ready`

Demanda do Filipe. O nome vive em **3 colunas** (`contacts.name` · `deals.title` — que é a frase
`"Nome - WhatsApp"` · `messaging_conversations.external_contact_name`) e **duas telas vizinhas
leem de fontes diferentes** (`ConversationItem.tsx:41` × `ContactPanel.tsx:162`).

**Decisões dele:** fonte única = `contacts.name` · título de card já customizado é **preservado**.

🎯 **Prova viva encontrada no AC0:** o único card dos 707 fora do padrão foi editado **hoje às
11:11** — Board `Leandro` × Contatos/Conversas `Rondônia`, 27 mensagens. O `pushName` do WhatsApp
veio como a região; quem foi corrigir só conseguiu mexer no card.
📊 **106 de 768 contatos (13,9%) têm nome inutilizável** — 40 vazios, **28 com `@lid`**.

#### ✅ E foi implantada no mesmo dia — commit `71c8c62`, **em produção**

🏗️ **@architect: a regra mora no BANCO, como trigger.** Três fatos: há vários caminhos de escrita
em `contacts` (app, `lib/mcp/tools/contacts-advanced.ts`, API pública) e o hook fecharia **um**; o
repo **já usa trigger para invariante entre tabelas** (`cascade_contact_delete`); e o AC4 precisa
do **nome antigo**, que num trigger vem em `OLD.name` **sem leitura prévia e sem janela de corrida**.

🧩 **A RPC `rename_lead()` existe com papel distinto** — devolver à tela quantos cards foram
renomeados e quantos preservados (AC5). O trigger não fala com o cliente. **Nenhum depende do
outro estar certo:** quem renomear por fora da RPC ainda tem propagação.

🔎 **AC3 pelo caminho (b):** o PostgREST não faz `OR` entre coluna da tabela base e coluna embutida
numa expressão só ⇒ `external_contact_name` vira **cache de busca**, sincronizado pelo trigger.
🎁 Como a exibição passa a derivar do contato, se o webhook da Meta sobrescrever esse campo ele
corrompe **a busca, não a tela** — o risco **encolheu**. ⚠️ A busca existe em **dois hooks**;
os dois estão comentados agora.

🪤 **A armadilha da story 2.6 aconteceu DE NOVO, e numa função `SECURITY DEFINER`:** o read-back
mostrou a função nascida com `anon=X` e `authenticated=X`. `ALTER DEFAULT PRIVILEGES` concede
**grants explícitos**, que o `REVOKE FROM PUBLIC` não toca. Revogado papel a papel. **A explicação
está colada dentro da própria migration**, para o próximo não descobrir na marra.

🧪 **7 ensaios com rollback forçado**, resíduo medido em 0 · **AC7 com rename real** (o Leandro
corrigido; card customizado **preservado**) · **lint 0 · typecheck 0 · 558 testes · build**.

🐛 **Regressão própria, entendida e consertada:** 2 testes do `DealDetailModal` quebraram — ele
passou a montar o `LeadNameEditor`, que usa `useQueryClient`, e esses testes rodam **sem
`QueryClientProvider` de propósito** (o foco é ordem de hooks). Precisou de stub de
`useQueryClient` **e** de `useMutation` — o segundo resolve o client **por dentro do próprio
módulo** e não passa pelo primeiro.

🚀 **Deploy conferido, não presumido:** `dpl_BvnPvvDZuHHJy6j2vDFq7u2GPrGS` · **Ready** ·
`acreditando-crm-sandy.vercel.app` HTTP 200 · deployment criado **27 s depois do commit**.
⚠️ **Lição dupla:** eu havia escrito *"auto-deploy disparado"* **sem conferir** (Rule 7 aplicada a
deploy) — e, ao conferir, **quase concluí errado** que não tinha disparado, porque li a coluna
*Age* (`3h`) em vez do **carimbo absoluto**. Relógios de máquina, banco e plataforma divergiram
neste dia. **Diferença entre eventos decide; tempo relativo não decide nada.**

⏳ **Falta só o AC9** — a Fernanda renomear um lead e ver nas 3 telas.

---

## Sessão 2026-08-07 (noite) — ⛔ 2.12 decidida (não fazer) · 📋 plano da semana: 4 stories com prazo 14/08

### A decisão que fecha a pendência mais antiga da 2.11

> **"Ela vai ter acesso a todos os cards. Por agora não vamos atribuir os cards a vendedores. Ela é a única vendedora."** — Filipe

**A 2.12 não caiu por análise técnica — caiu por contexto de operação.** Com uma vendedora só, `owner_id` não minimiza nada: cria camada de permissão sem ninguém do outro lado e um caminho novo para bug (card sem dono ⇒ card invisível). Story marcada **NÃO FAZER AGORA**, com **4 gatilhos de reabertura** (2º vendedor · Instituto/Mayara no pipeline · agência externa · exigência de LGPD).

⚖️ **Não confundir:** o **gate de LGPD segue aberto desde 21/07**. Não haver 2º vendedor torna a minimização desnecessária *hoje*; não torna o tratamento regular.

🎁 **Sobrevive à decisão:** `owner_id` NULL em 100% dos 644 deals ⇒ `KanbanList.tsx:100` passa `src=""` ao `next/image`, **que lança**. Crash na visão de lista, qualquer papel. **Story própria, ainda por abrir.**

### O prazo que apareceu no ingest da reunião: sexta 14/08

A Fernanda vai **apresentar o CRM e os números** numa reunião que ela já tinha marcada. **Julho vai no manual** (a planilha dela foi apagada inteira), **agosto sai do CRM**. Quatro itens de backlog viraram prazo.

### As 4 stories (SDC: @sm redigiu → @po validou)

| Story | O quê | Prazo | @po | O que trava |
|---|---|---|---|---|
| **2.16** | Board começa em agosto — **soft delete + backup antes** | 11/08 | ✅ **Ready** (10/10) | nada — decidida no mesmo dia |
| **2.17** | 3 movimentações automáticas de coluna | 13/08 | 🟡 GO cond. (10/10) | **Fernanda:** N horas · quais campos = "qualificado" |
| **2.18** | Estrelas 1–5, automáticas e editáveis | 13/08 | 🟡 GO cond. (9,5/10) | **AC0 pode derrubar a regra** se região não tiver zona |
| **2.19** | Painel de leads (≠ venda recorrente) | 13/08 | 🔴 NO-GO por ora (9/10) | **Fernanda:** a lista de métricas |

🔴 **O caminho crítico não passa por código.** Três das quatro travam numa mensagem para a Fernanda; uma numa decisão de 30 segundos do Filipe.

🔬 **Os `AC0` não dependem de ninguém e devem rodar primeiro** — são medições em produção que podem **matar story antes de codar**, exatamente como o AC0 matou a 2.14 e economizou um conserto inútil.

### 🔴 O achado do planejamento: "limpar julho" não pode virar `DELETE`

O pedido foi *"vou limpar os leads de julho"*. **Apagar seria destruir dado**, por três razões que se somaram nesta semana: a **planilha de julho dela já foi apagada** (o CRM pode ser a única cópia estruturada do mês), **julho é justamente o que ela apresenta em 14/08**, e **72 deals têm dado de saúde extraído** — descarte de dado pessoal não sai como efeito colateral de faxina visual.
⇒ A 2.16 foi redesenhada para **"julho sai da frente", não "julho deixa de existir"**, com 3 caminhos reversíveis e a escolha entregue ao Filipe.

**Ele escolheu C — soft delete (`deleted_at`), sem `DELETE` físico — e acrescentou:** *"antes de deletar faça um backup de todos os leads"*. Virou o **AC0.5**, gate duro:

```
backup (TODOS os deals, JSON + CSV, fora do repo — tem dado de saúde)
  → conferir: contagem do arquivo == contagem do banco
  → ensaio do UPDATE com ROLLBACK
  → soft delete
  → read-back (total 646 inalterado · N marcados · 0 conversas afetadas)
```

⚠️ **A consequência que a opção C traz:** o soft delete esconde julho de **toda a listagem do produto**, não só do board — e julho é o que ela apresenta em 14/08. O **AC5** deixou de ser higiene e virou **requisito de prazo**.
🪤 **E agrava o achado da 2.15:** `boards.ts:664` não filtra `deleted_at` ⇒ o pré-check de excluir board passará a contar ~312 cards mortos.

**Arquivos:** `docs/stories/2.12` (decidida) · `2.16` · `2.17` · `2.18` · `2.19`

---

## Sessão 2026-08-07 (tarde) — 🔑 A Fernanda entrou (2.11 provada) · 🛑 uma story morreu no gate · ✅ o board saiu

> [!success] **Zero linha de código escrita. Três escritas em produção, todas autorizadas e com read-back.**
> A sessão foi inteira de **diagnóstico e operação**. Duas stories nasceram (**2.14 bloqueada**, **2.15 em draft**) e o defeito de excluir board foi **resolvido sem código**, removendo a causa.

### 🔑 A story 2.11 ficou provada de ponta a ponta (era o que faltava desde 06/08)

A [[Fernanda]] aceitou o convite **hoje às 14:03 BRT** (`used_at 17:03:07 UTC`, login 1s depois). Depois o Filipe repetiu o caminho com uma conta própria de `vendedor` (`filipegomesdacosta@gmail.com`, 17:23 BRT).

| | Fernanda | Filipe (vendedor) |
|---|---|---|
| Perfil criado com papel | `vendedor` ✅ | `vendedor` ✅ |
| **Linha em `business_unit_members`** | **1** ✅ | **1** ✅ |

⇒ **O convite com unidade cria o vínculo sozinho — provado duas vezes em produção.** Ontem o status era *"provado sob rollback"*. Não é mais. AC2/AC4/AC6 fechados.

*(Nota: o admin tem **0 vínculos de unidade** e mesmo assim vê tudo — confirma o bypass de `admin` na RLS de conversas.)*

### 🛑 Story 2.14 (card quebra ao mover) — MORREU NO PRÓPRIO GATE

Incidente real: a Fernanda movimentou cards e a tela deu *"Algo deu errado"* (o `app/(protected)/error.tsx`, ou seja **exceção de render** — o `QueryClient` não usa `throwOnError`, então erro de query não chega lá).

Diagnóstico no código apontou: `useRealtimeSync.ts:860,901` sobrescreve o `DealView` com a linha crua do Postgres (normaliza 7 campos de ~20, **`tags` e `value` ficam de fora**) e `DealCard.tsx:135,143,220` lê os dois **sem guarda** ⇒ `null.slice()`.

**O AC1 da story exigia confirmar a condição no banco ANTES de codar. Reprovou:**

```
tags_null: 0 · value_null: 0 · total: 644
```

**Cinco hipóteses testadas contra a produção, todas mortas:**

| Hipótese | Medição |
|---|---|
| `tags`/`value` NULL | 0 de 644 |
| RLS trata `vendedor` ≠ `admin` | `pg_policies` **real**: 5 tabelas `cmd=ALL`, org-scoped, **sem `role`** |
| Orgs divergentes | ambos em `83160646…ff50`, 644 deals cada |
| `check_deal_duplicate` | **nenhum** contato tem >1 deal |
| `stage_id` órfão / de outro board | 0 e 0 |

E o **controle experimental derrubou o resto**: o Filipe, logado como `vendedor` de verdade, **moveu cards e funcionou**. ⇒ **Não é papel, não é dado, não é RLS.** A story está marcada **BLOQUEADA** e a investigação sai do banco (esgotado e limpo) para o cliente. **Falta o stack do console da usuária.**

> 🎁 Achado colateral: **`owner_id` é NULL nos 644 deals (100%)** ⇒ `deal.owner` é sempre `{name:'Sem Dono', avatar:''}`, e `KanbanList.tsx:100` passa esse `''` ao `next/image`, que **lança**. Crash garantido na visão de lista, para qualquer papel. Story própria.

### ✅ Excluir board não fazia nada — causa achada e resolvida SEM código (story 2.15)

Relato: clica em Excluir, o popup confirma, e nada acontece. Board *"Gestão de Vendas - Experiência Chile"* (0 deals, 6 estágios).

**A causa estava no banco, não no cliente:** 1 linha em **`integration_inbound_sources`** (nome **"Entrada de Leads"**, `active=true`, criada 23/07 17:22) com `entry_board_id` apontando para o board, e a FK é **`NO ACTION`** ⇒ Postgres devolve `23503` e cancela o DELETE.

🪤 **A armadilha que teria feito o conserto falhar no passo seguinte:** a mesma linha tem **`entry_stage_id`**, cuja FK **também é `NO ACTION`**. Repontar só o board deixaria o estágio preso — e ao apagar o board os 6 estágios cairiam em CASCADE, batendo nessa FK. **Os dois campos tinham de andar juntos.**

**Executado (autorizado):** "Entrada de Leads" repontada para board **Acreditando** / estágio **"Lead novo"**; depois **3 regras órfãs** de `lead_routing_rules` apagadas com delete **auto-guardado** (`WHERE c.deleted_at IS NOT NULL`, para ser impossível encostar na regra viva).

**Read-back final, após o Filipe excluir pela interface:**

```
boards_total: 1 · chile_existe: 0 · stages_orfaos: 0 · deals: 646 intactos
```

✅ **Provado em uso.** O board saiu, os estágios caíram em CASCADE, nenhum deal tocado.

### 🎁 A descoberta que explicou o mistério: `messaging_channels` é SOFT DELETE

O Filipe dizia ter excluído as integrações Evolution; o banco mostrava 4 linhas vivas. **A tabela tem `deleted_at`** e minha consulta não filtrava:

```
Travel wapp 23/07 17:18 · Whatsapp 23/07 17:29 · Wapp 23/07 18:44 · wapp 31/07 13:06
Acreditando WhattsApp (gptmaker) → deleted_at NULL, o único vivo
```

⇒ **O delete de canal funciona.** Mas o soft delete **não limpa o que dependia do canal**: 3 das 4 `lead_routing_rules` eram órfãs de canais excluídos e seguiam `enabled = true`. Sobrou **1 regra**, a do `gptmaker`, com o `transfer_stage_id` da story 2.5 **intacto**.

⏱️ Linha do tempo que fecha o caso: a fonte "Entrada de Leads" nasceu **17:22 de 23/07**, entre a exclusão do "Travel wapp" (17:18) e a do "Whatsapp" (17:29). **Ele limpou os canais; o webhook ficou.**

### ✏️ Três correções de registro desta sessão

1. **"O padrão `UPDATE .select()` da story 2.5 não se aplica"** — não se aplicava ao *mover* card (`deals.ts:506` nem usa `.select()`). **Aplica-se em cheio ao excluir board**: 4 escritas sem verificação (`boards.ts:747`, `:782`, `:701`, `deals.ts:558`).
2. **"As integrações Evolution NÃO foram excluídas"** — **errado**. Foram; é soft delete e eu li linhas mortas sem filtrar `deleted_at`.
3. **"O convite da Fernanda é chave aberta, sem e-mail"** (vinha do doc antigo) — **errado**: o convite dela tinha `email = comercial@acreditando.com.br`. Os sem e-mail eram os dois de 06/08 20:04, já consumidos.

### 🪞 A lição estrutural da sessão

**Auditei migrations e apresentei como conclusão.** Este repo já tem registrado (pendência nº 2) que `supabase/migrations/` **não é a fonte da verdade** — `schema_migrations` nem existe. Bateu com o banco por sorte. ➡️ **`pg_policies` e `pg_constraint` primeiro, migrations depois.**

### ⏳ O que ficou aberto

- 🔴 **Story 2.14** — precisa do **stack do console** da Fernanda. Sem ele, não implementar
- 🟠 **Story 2.15** (draft) — trava numa pergunta: **apareceu toast vermelho** ao tentar excluir? Define se o defeito é de *visibilidade* (AC5) ou um caminho de erro *mudo* (AC4)
- 🟡 **Excluir canal deixa `lead_routing_rules` órfã e `enabled`** — higiene que o delete não faz. Card próprio
- 🟡 **`KanbanList.tsx:100`** — `next/image` com `src=""` garantido pelos 644 `owner_id` nulos
- ⚖️ **Gate LGPD** (21/07) e **story 2.12** (minimização) seguem abertos

**Arquivos:** `docs/stories/2.14.card-quebra-a-tela-ao-ser-movido.story.md` (BLOQUEADA) · `docs/stories/2.15.excluir-board-falha-em-silencio.story.md` (draft)

---

## Sessão 2026-08-06 (noite, 2ª rodada) — 🎨 O CRM veste a marca OFICIAL do Acreditando (story 2.13)

Commit **`d4c6734`** na `main`, deploy Vercel **no ar e provado byte a byte**.
Gates: lint 0 · typecheck 0 · suíte **558** · build ok. **Cadeia SDC completa** (@sm → @po → @dev → @qa).

> ⚠️ **Esta sessão SUBSTITUI a de baixo.** A rodada anterior (`b628a96`) pôs a marca do
> **Grupo Acreditando** — escolha feita **por restrição de arquivo**, não por decisão de marca, e
> registrada ali como pendência. O Filipe forneceu a fonte oficial e a pendência **fechou**.

**Fonte oficial:** `https://acreditando.com.br/wp-content/uploads/2022/10/logo-main.webp`

### 📐 Medido na fonte, não presumido

| Item | Valor |
|---|---|
| Formato / dimensões | WebP lossless · **961×217** · RGBA com **alfa real** |
| Símbolo **é** separável | banda vazia em **`y 119..131`** |
| Bbox do símbolo | `x 721..947` · `y 1..118` → **227×118 (1,92:1)** |
| Cor do wordmark | **`#1F3C51`** (azul-ardósia) |
| Cor do símbolo | **`#F8B106`** (âmbar) |

🔴 **As cores NÃO são as do Grupo** (`#272960` / `#F7B300`). São **duas identidades distintas** —
o `theme_color` do manifest acompanhou (`#1F3C51`).

### ⚖️ O problema que a fonte oficial trouxe, e a decisão

O wordmark é azul-ardósia e existe em **uma única versão** ⇒ sumiria no tema escuro. O logo do
Grupo tinha variante dourada oficial; **este não tem negativo**.

**Decisão do Filipe: variante negativa**, gerada por **regra de cor explícita** — apenas os
pixels ardósia viram branco, o **âmbar fica intacto** (medido: **40.131 px** para branco,
**6.524 px** âmbar preservados). É o tratamento padrão de manual de marca para fundo escuro.
Conferido nos dois temas antes do commit.

### 🗑️ Removidos com aprovação

Os 4 assets do Grupo (`acreditando-{lockup,symbol}-{navy,gold}.png`) foram apagados — sem
referência órfã. **Recuperáveis por `b628a96`**, que já está no GitHub. Em produção respondem
**404**, conferido.

### 🔁 Regeneração

`scripts/marca/gerar-marca.mjs` + `scripts/marca/logo-main-oficial.webp` — **fora do git por
convenção do repo** (`.gitignore:86` ignora `scripts/`). Usa `sharp` (já em `node_modules`),
porque o GDI+ do Windows não decodifica WebP.

### 🪞 Duas vezes o medidor mentiu e o arquivo estava certo

1. Achei o símbolo do Grupo **cortado** no arquivo-fonte — medindo linha a linha, era
   **simétrico**.
2. Na conferência final, a faixa de favicon mostrava a marca **antiga** a 16/32 px — era **cache
   do navegador**; os arquivos no disco estavam corretos, confirmado lendo os PNGs direto.

**Nos dois casos a conclusão só saiu depois de ler o arquivo, não a tela.**

⚠️ E um erro operacional que custou um build: **matar o dev server durante a gravação** corrompe
`.next/dev/types/validator.ts` e o build acusa erro de TypeScript **num arquivo que ninguém
escreveu**. Limpar o `.next` resolve.

### ⏳ O que segue sem prova em uso

**A sidebar logada.** Não há `.env.local` nesta máquina e **credencial do Filipe não é usada**.
Verificados: login nos **dois temas** e símbolo a **36 px e 40 px**. ➡️ Conferir sidebar
expandida, recolhida e o rail no primeiro acesso real.

### 🩹 Pontas soltas

- `public/icons/icon.svg` e `maskable.svg` seguem **órfãos** (não apagados).
- A sidebar expandida assina só **"ACREDITANDO"** — perdeu a palavra "CRM". A aba segue
  *"Acreditando CRM"*. Reverter é 1 linha.
- **Fora de escopo declarado:** trocar a paleta do produto (`primary-*`, hoje azul-céu) para as
  cores do Acreditando. Merece story própria.

---

## Sessão 2026-08-06 (noite, 1ª rodada) — 🎨 O CRM sai da marca do fork *(substituída pela 2.13)*

Commit **`b628a96`** na `main`, deploy Vercel **no ar e provado byte a byte**.
Gates: lint 0 · typecheck 0 · suíte **558** (sem regressão) · build ok.

**O que estava no ar:** a sidebar mostrava um quadrado com a letra **"N"** — resíduo do
**NossoCRM**, o projeto de onde este repo foi forkado. Não era logo mal posicionado: era a
**marca de outra pessoa**, em dois lugares (sidebar desktop `Layout.tsx` e rail de tablet
`NavigationRail.tsx`). O login não tinha marca nenhuma e o rodapé assinava **"CRM IA"**.
O favicon e os ícones de PWA eram os genéricos do Next.js.

**O que mudou:** lockup na sidebar expandida e no login · símbolo isolado quando a sidebar
recolhe (36 px) e no rail (40 px) · favicon `.ico` 16/32/48 + `app/icon.png` + `app/apple-icon.png`
· ícones de PWA 192/512/maskable · `theme_color` do manifest passou a **`#272960`**.

### 🪤 A armadilha que quase matou o deploy em silêncio

O `.gitignore` tinha um **`*.png` geral** (linha 95), nascido na linha 94 para barrar
screenshot de debug (`debug_navigation_failed_*.png`) e acabando por barrar **toda imagem do
repo**. Os assets teriam ficado só no disco de quem gerou e **o logo sumiria em produção** —
com o build passando **verde** localmente, porque local os arquivos existem.

Exceção aberta só para as pastas de marca (`!public/brand/*.png`, `!public/icons/*.png`,
`!app/icon.png`, `!app/apple-icon.png`). **Read-back nos dois sentidos:** os 9 assets saíram do
ignore (`git status` passou a listá-los) e `debug_navigation_failed_teste.png` **segue barrado**,
que era o propósito da regra.

### 🏗️ Decisões de arquitetura

- **`components/brand/BrandLogo.tsx` é fonte única** (`BrandMark` + `BrandLockup`). O asset não
  é repetido tela a tela — o repo já tem histórico de regra escrita em dois lugares saindo de
  sincronia.
- **Troca navy ↔ dourado por CSS (`dark:`), não por JavaScript.** Com JS a marca errada pisca
  durante a hidratação.
- **Nada foi recolorido em código.** Navy vem do arquivo navy, dourado do arquivo dourado; os
  hexes (`#272960` / `#F7B300`) foram **amostrados do original**, não chutados.

### 📐 Fonte dos assets

Gerados de `projetos/lp-kit-livre-b2c/assets/images/_orfaos/logo-acreditando-blue.png`
(6705×1668, com alfa) e `.../logo-acreditando-gold.png` (512×127, com alfa). Os arquivos da
marca **"Acreditando" empilhada** (`logo-acreditando-trim.png`, `logo-acreditando.jpg`) **não
servem**: são 24bpp/JPG, com o fundo navy queimado dentro, e quebram no tema claro.

🪞 **Leitura errada minha, desmontada por medição:** achei que o símbolo estava **cortado** na
borda esquerda do arquivo-fonte. Medindo linha a linha, a forma é **simétrica** (centro em
`x=868,5` no topo, no meio e na base) — ela apenas *toca* `x=0` e `x=1737` no ponto mais largo.
O arquivo está íntegro; quem errou foi o olho. *Antes de duvidar do arquivo, medir o arquivo.*

### ⏳ O que NÃO foi provado

**Não foi possível abrir a sidebar no app rodando** — não há `.env.local` nesta máquina, e as
credenciais que o Chrome ofereceu são do Filipe (não usadas). A verificação foi dos **assets nos
tamanhos reais** (36 px, 40 px, favicon 16 px ampliado, nos dois temas) e da **tela de login em
produção**. Pela régua do vault: a sidebar é **"provado em ensaio"**, não *"provado em uso"*.

➡️ **Conferir no primeiro acesso real:** sidebar expandida, recolhida e o rail no tablet.

### 🩹 Pontas soltas

- `public/icons/icon.svg` e `maskable.svg` ficaram **órfãos** (o manifest não os referencia
  mais). **Não apagados** — decisão do Filipe.
- A sidebar expandida agora assina **"Grupo Acreditando"** e perdeu a palavra **"CRM"**. Foi o
  preview aprovado; o título da aba segue *"Acreditando CRM"*. Reverter é 1 linha.
- ~~A marca aplicada é a do **Grupo**, não a do **Centro Integrado**~~ ✅ **FECHADO na 2ª rodada
  (`d4c6734`)** — o Filipe forneceu o logo oficial e a troca foi **exatamente** o previsto:
  substituir os arquivos, sem tocar na arquitetura do componente. A previsão se confirmou.

---

## Sessão 2026-08-06 — O convite dava papel e não dava acesso a conversa nenhuma (story 2.11)

Commits **`f527734`** + **`8b6e8ac`** na `main`, dois deploys Vercel **Ready** (read-back).
Suíte **551 → 558** (+7). Cadeia SDC completa. Migration aplicada pela Management API com read-back.

**Objetivo do dia (Meta 2):** dar acesso à [[Fernanda]]. Terminou como conserto de um caminho
incompleto do produto que ninguém tinha exercitado — porque até hoje **só existia um usuário**.

### 🔴 O defeito: acesso criado, caixa vazia, silêncio total

A RLS de `messaging_conversations` (`20260205100000:298-341`) libera a conversa para **(admin)**
OU **(membro da unidade daquela conversa)**. O aceite de convite criava o perfil com o papel certo
e **nenhuma linha em `business_unit_members`**. O vínculo era um 4º passo manual, feito depois.

**Medido em produção, com um `vendedor` real** (o próprio Filipe se cadastrou de cobaia):

| | vendedor via | existia |
|---|---|---|
| `messaging_conversations` | **0** | 639 |
| `messaging_messages` | **0** | 8.234 |

Nada disso produzia erro: nem no banco, nem na tela, nem no console. Quem fosse convidado abriria
o CRM, veria zero conversa e concluiria que o sistema está quebrado.

**Provado sob `rollback`:** inserindo a linha de membro na mesma transação, **0 → 639 conversas**
e **8.242 mensagens**. Uma linha destravava tudo.

### 🟡 O achado que a story NÃO previa — e que é maior

`deals` e `contacts` são escopados **só por organização**. Não há camada de unidade, de dono nem de
funil neles. ⇒ **qualquer `vendedor` vê os 618 cards e os 678 contatos integralmente**, no primeiro
login — incluindo os **72 deals com `ai_extracted` preenchido**, que é tipo e tempo de lesão.

⇒ **`vendedor` não é um acesso menor que `admin` no núcleo do CRM.** É o mesmo acesso, menos a
caixa de mensagens. Com **uma única unidade** contendo todas as 639 conversas, só existem dois
estados: não é membro (não trabalha) ou é membro (vê tudo). **Não há meio-termo hoje.**

🎁 **`deals.owner_id` já existe** (nullable) ⇒ o escopo por dono é policy + preenchimento, não
coluna nova. É o insumo da 2.12.

### ✏️ Correção de registro — a story 2.2 supôs errado

A 2.2 registrou *"se a conversa tiver `business_unit_id NULL`"*. A coluna é **`NOT NULL`**
(`:228`). Mesmo sintoma (0 linhas afetadas), causa diferente — e a causa muda o conserto.

### O que mudou

- `organization_invites.business_unit_id` (nullable, FK `ON DELETE SET NULL`) + índice
- `POST /api/admin/invites` aceita `businessUnitId` e **recusa unidade de outra organização**
  (o aceite roda com service role, que ignora RLS — a checagem tem de ser explícita)
- `POST /api/invites/accept` cria o vínculo (upsert idempotente) logo após o perfil
- **Novo** `lib/invites/membership.ts` — `decideInviteMembership`, decisão pura. 7 testes;
  **6 falham sob mutação** ("sempre vincula")
- `UsersPage` — seletor de unidade no convite

⚠️ **Sem unidade no convite, NENHUM vínculo é criado.** O fallback *"se a org só tem uma unidade,
usa ela"* foi **descartado de propósito**: passaria a conceder acesso a conversas em todo convite
futuro sem ninguém ter pedido, e em silêncio.

### 🔁 O segundo commit nasceu de um erro em uso real, minutos depois do deploy

O Filipe criou o convite **certo** (20:39:44, com a unidade) e se cadastrou por um link de
**20:04**, gerado antes de a coluna existir ⇒ 0 conversas de novo. **A lista de "links ativos"
mostrava papel, expiração e final do token — e não a unidade**, que é o campo que decide tudo.
Link velho era visualmente idêntico a link novo. Agora cada link declara a unidade, e link sem
unidade avisa em amarelo.

> 🪞 Mesma família dos defeitos já registrados aqui: **estado que importa, invisível na interface.**

### 🧹 Limpeza (autorizada pelo Filipe)

As 2 contas de teste foram apagadas de `auth.users` após ensaio com `rollback` e verificação de
que não possuíam nada (0 deals, 0 atividades, 0 convites, 0 vínculos). Read-back: **1 usuário**
(`fbraintech@gmail.com`), dados intactos (620 deals · 680 contatos · 641 conversas).

### ⏳ O que falta para fechar a 2.11

- **Convite para a Fernanda com o e-mail dela** — o convite ativo (`…f967e1fb6bbe`, unidade
  `Acreditando`, expira 13/08) **não tem e-mail vinculado** ⇒ é chave aberta
- **A prova de ponta a ponta** — ninguém ainda aceitou um convite COM unidade. Até isso acontecer,
  o status honesto é *"provado sob rollback"*, não *"provado em uso"*
- ⚖️ **Gate LGPD** segue aberto (21/07). A exposição incremental é de **forma**, não de público:
  a Fernanda já lê e responde essas conversas no WhatsApp hoje

### ⚠️ Armadilhas novas desta sessão

1. **`git add -A` varreu o `00-CONTEXTO-SESSAO-RETOMAR-AQUI.md`** para dentro do commit — arquivo
   que está fora do git de propósito. Desfeito com `git rm --cached` + `--amend` antes do push.
2. **O `grep` do bullet `●` da saída do `vercel ls` não casa** no Bash desta máquina (encoding).
   Usar `grep -o "Building\|Ready\|Error"`.
3. **Afirmei "está no ar" logo após o push**, sem ler o status do deploy. Corrigido no mesmo turno
   — e é exatamente a Rule 7. Push ≠ deploy.

---

## Sessão 2026-08-05 — Fui MEDIR o que a sessão anterior deu como feito. Um dos consertos não funcionava.

Commit **`a846ce3`** na `main`, deploy Vercel **Ready**, migration aplicada com read-back.
Suíte **545 → 551** (+6). Cadeia SDC completa (SM → PO → Dev → QA → DevOps).

**A sessão começou como verificação, não como desenvolvimento.** As três "provas que faltam"
listadas abaixo eram o item mais barato da fila. A primeira delas reprovou.

### 🔴 Prova 1 — o log de tokens (story 2.9) estava no ar e **não gravava**

| Medição (05/08) | Valor |
|---|---|
| Linhas em `ai_conversation_log` | **0** |
| Deploy do fix `44b73b8` | **04/08 15:27** (14 s após o commit) |
| Extrações desde o deploy | **18**, 9 delas naquele dia |

⇒ **22 horas no ar sem gravar uma linha.** A story 2.9 foi dada como concluída com base no
commit e nos gates, não em leitura do estado real. É a **Rule 7 do Meta Ads aplicada a código**:
*"o deploy subiu" ≠ "está funcionando"*.

**A causa: uma SEGUNDA regra do banco.**

```
ai_conversation_log_action_taken_check
CHECK (action_taken = ANY (ARRAY['responded','advanced_stage',
       'handoff','skipped','stage_evaluation']))
```

O helper grava `custom_fields_extraction` — fora da lista ⇒ **`23514 check_violation`**, pelo
**mesmo caminho mudo** de antes (`void` + `console.error`). O conserto de 04/08 resolveu o
`23502` e bateu na parede seguinte.

**O defeito de fundo era de tipo.** `TokenLogInput.actionTaken` era `string` livre. A 2.9 fez as
colunas `NOT NULL` serem exigidas **pelo TypeScript** e deixou solto justamente o único campo com
**domínio fechado** no banco. Blindou o defeito que tinha acabado de acontecer, não a classe dele.

### ✏️ Correção de registro: "os outros 6 pontos estão certos" era falso

A 2.9 afirmava isso. Auditados um a um os **9 pontos** que inserem na tabela: **só 2 gravariam.**

| Ponto | `action_taken` | CHECK | Outro problema |
|---|---|---|---|
| `customFields.service.ts` | `custom_fields_extraction` | ❌ | — |
| `extraction.service.ts` | `bant_extraction` | ❌ | — |
| `briefing.service.ts` | `briefing` | ❌ | — |
| `generate-prompts.service.ts` | `generate_stage_prompts` | ❌ | 🔴 sem `conversation_id` |
| `board-config/generate-goal/route.ts` | `generate_goal` | ❌ | 🔴 sem `conversation_id` |
| `tasks/deals/analyze/route.ts` | `analyze_lead` | ❌ | 🔴 sem `conversation_id` |
| `ai/actions/route.ts` | `AIAction` (válido) | ✅ | 🔴 sem `conversation_id` (14 rótulos próprios) |
| `agent.service.ts` · `stage-evaluator.ts` | válidos | ✅ | — |

### 🧭 A decisão que mudou o desenho no meio da implementação

A story mandava acrescentar **6 rótulos** ao CHECK. Ao auditar, 3 deles se revelaram **inúteis**:
pertencem a pontos que **omitem `conversation_id`** (`NOT NULL`) e morreriam em `23502` **antes**
de o CHECK ser consultado. E não é conserto de coluna — são operações de **board/deal**, que
**não têm conversa**. Não cabem nesta tabela.

⇒ A migration levou **3 rótulos, não 6**. Autorizar os outros seria **acrescentar mentira ao
schema**: descrever um insert que nunca acontece. Os 4 pontos impossíveis viraram **no-op
documentado** — tentar e falhar era uma ida ao banco garantidamente perdida, atrás do mesmo
`console.error` que escondeu as stories 2.9 e 2.10.

### ✅ AC5 — provado em uso real (o que faltou na 2.9)

Três linhas nasceram no mesmo dia, a primeira **8 minutos após o deploy**:

| `created_at` (UTC) | `action_taken` | tokens | `context_snapshot` |
|---|---|---|---|
| 15:31:18 | `custom_fields_extraction` | 1.394 | `{}` |
| 16:33:21 | `custom_fields_extraction` | 1.675 | `{}` |
| 18:33:54 | `custom_fields_extraction` | 2.831 | `{}` |

⚖️ **O gate LGPD segurou na prática:** `context_snapshot = {}` e `ai_response` vazio nas três.

### O que blinda contra a terceira vez

- **`AI_LOG_ACTIONS` + `AiLogAction`** — união fechada, espelho da constraint. Rótulo novo quebra
  a **compilação**, não a produção.
- **Teste de contrato** que lê o SQL da migration e compara com o código. Nada no projeto
  obrigava os dois a andarem juntos — e foi uma dessincronia assim que criou o bug.
- **O duplo de Supabase aprendeu o CHECK.** Antes só aplicava `NOT NULL`, e por isso ficou
  **verde enquanto a produção falhava**. O teste conhecia menos regras do banco que o banco.

**Prova:** revertido o domínio para os 5 originais, **5 testes falham** — incluindo o sintoma
literal (`logged: false, reason: 'erro'` onde deveria ser `logged: true`).

### 🟡 Prova 2 — a premissa da story 2.4 encolheu

Medindo o tamanho da conversa **no instante da extração** (não hoje — conversa cresce), existe
**1 único caso** acima de 30 mensagens desde o fix de 03/08: 05/08 02:29, 35 msgs → **5 de 5**.
**n=1 não é prova.**

E o antes derruba parte da narrativa: os **5 casos pré-fix com 33–35 mensagens** deram
**3, 5, 4, 5, 3** — média **4,0**. A história era que a IA *"nunca chegava ao fim"*, o que preveria
campo vazio. Ler as mensagens recentes segue sendo o comportamento correto; **o tamanho do
impacto é que não se sustenta**.

### ⏸️ Prova 3 — Realtime do board: NÃO executada

Precisa de olho humano: board aberto na tela + uma transferência real. Continua não observada.

### ⚠️ Armadilhas novas desta sessão

1. **`q < X` com `q` NULL cai no `ELSE`.** Um `CASE WHEN` meu classificou os **521 deals com
   `ai_extracted = {}`** como "depois do fix" e produziu uma regressão inexistente (média de
   campos 4,75 → 0,66). Quase virou achado. **Resultado que choca também precisa ser lido antes
   de acreditar** — a mesma lição do log de 30/07, agora do lado do falso alarme.
2. **Comparar coorte por estado de HOJE é armadilha.** Contar mensagens da conversa agora, para
   julgar uma extração de uma semana atrás, mede a coisa errada. O correto é
   `count(*) where created_at <= <instante da extração>`.
3. **O Bash desta máquina não aceita here-string do PowerShell.** `@'...'@` vazou para dentro da
   mensagem de commit (`@ fix(ia):...` + `'@` no fim). Corrigido com `--amend -F <arquivo>`.
   Para mensagem longa: escrever arquivo e usar `-F`.
4. **`/tmp` do Git Bash não existe para o Python do Windows.** `io.open('/tmp/x')` dá
   `FileNotFoundError` mesmo com o arquivo criado pelo bash ali. Usar o scratchpad com caminho
   Windows.

---

## Sessão 2026-08-04 — Quatro stories: a corrida de contato, o merge_log, os nomes trocados e a prévia

Commits **`a01bbad`** · **`c59a453`** · **`40ccaf3`** · **`5ca9b71`** · **`44b73b8`**, todos na `main`.
Edge function **v11 → v13 ACTIVE**. Suíte **508 → 545** (+37). Cadeia SDC completa em cada story.

### 2.6 — A corrida na criação de contato: o tratamento existia e era LETRA MORTA

O remendo já estava escrito em `index.ts:799`, com comentário e tudo. **Nunca rodou:**
`isDuplicateError` espera `23505 unique_violation`, e `contacts` **não tem constraint de unicidade
alguma além da PK** (lido de produção: só `contacts_pkey`). Sem constraint o insert concorrente
**não falha** — ninguém perde a corrida, os dois vencem.

> 🪞 É o **achado nº 3 do `5e53bdd`**, que consertou isso para *mensagens* e deixou `contacts`
> como estava. O commit dizia com todas as letras: *"o tratamento de duplicate que já existia era
> letra morta"*.

**Escala medida:** 138 grupos `(org, phone)` duplicados · **100 % com delta abaixo de 0,5 s**
(menor `0,000171 s`) · desde **25/07**, ~12/dia · **41 % dos contatos com telefone** num par.
**Zero duplicatas legítimas na base.**

**Decisão do Filipe: advisory lock** (`find_or_create_contact`, migration `20260804120000`), não
índice único. Razões: (1) `UNIQUE INDEX` proibiria duplicata no banco inteiro — decisão de produto
que contradiz a feature de dedup/merge; (2) **abortaria** com as 138 duplicatas existentes.

> 🧭 **A Opção A virou etapa 2, não descarte.** Com a base hoje em **zero duplicatas**, o índice
> único **passou a ser aplicável** — e faria o remendo de `23505` do código voltar a ter função.

**Prova, com controle negativo, no banco real:**
`6 chamadas concorrentes da função nova → 1 contato (mesmo UUID nas 6)` ·
`6 chamadas do algoritmo antigo, mesmo BD → 6 contatos`.
✅ **Confirmado em uso real:** lead **Gislaine Wehner**, 04/08 16:01 UTC, 1 contato · 1 conversa ·
1 card · 21 mensagens — **não duplicou**.

### 2.6b — Limpeza dos 138 órfãos

Auditoria prévia nas **12 tabelas** com FK para `contacts`: **tudo zero**. Guarda antes do delete:
**0 pares totalmente órfãos**. Read-back: **728 → 590** contatos, 0 grupos duplicados.
Lista completa em `docs/orfaos-apagados-2026-08-04.json`.

⚠️ **Não era faxina:** em **29 dos 138 pares o órfão era o mais VELHO**, e a busca faz
`ORDER BY created_at LIMIT 1` — uma conversa nova desses números resolveria para o contato
**vazio**, deixando histórico num contato e card em outro.

### 2.7 — `contact_merge_log`: o apagamento (LGPD Art. 18) voltou a ser possível

`source_contact_id`/`target_contact_id` eram `NOT NULL` com FK `ON DELETE SET NULL` — regras que
se contradizem. Apagar contato mergeado abortava a transação inteira.

**Decisão do Filipe: opção B** — colunas viram `NULLABLE` (migration `20260804140000`). Descartado
o `CASCADE`: trilha de auditoria que se apaga a pedido de terceiro deixa de ser trilha. O
`source_snapshot` já é `JSONB NOT NULL` e **já guarda o conteúdo** — o log vira **memória**, não
referência. Provado: contato mergeado criado, apagado, log sobreviveu com ponteiros nulos.

### 2.7b — Os 11 leads com o nome do operador: causa achada na API

`chatDisplayName` fazia `chat.userName || chat.name || ...`. A API do GPT Maker, lida sobre
**4.000 chats**, é inequívoca:

```
{ name: "GUINA😎", userName: "Filipe Costa" }   ← name é o contato
```

`userName` = **"Filipe Costa" em 151 chats** e **"Fernanda" em 17**. São os **dois operadores**,
não 168 homônimos. `userName` foi **removido da precedência** — nunca é o contato, então nem como
último recurso serve.

Backfill dos 11 com o valor que o código corrigido produziria: **6 nomes reais recuperados**
(Jussan · Fábio Souza · Rafael Ferreira · Laíza · Dra. Luanna Spinelli · 🦋); **5 vinham com
`name: ""` na própria API** e ficaram com o telefone.

> ✏️ **Falso positivo desfeito:** marquei um contato *"Fernanda"* como 12ª vítima. O chat dele tem
> `name: "Fernanda"` e `userName: null` — é uma lead que **realmente se chama Fernanda**. Nome
> coincidir com o de um operador não faz dele um erro. Há teste travando isso.

### 2.8 — A prévia da lista era da mensagem que CHEGOU por último

Relato do Filipe. Medido: **62 de 558 conversas (11 %)**. **Dois defeitos distintos.**

**A (33 casos)** — o `update` era incondicional. As entregas chegam embaralhadas por corrida de
rede; quem chega por último vence. Caso da conversa `1d0d503a`: 5 mensagens com **1 ms** entre
elas, a prévia ficou com a **primeira** (que chegou por último).

> 🪞 **Terceira vez que o mesmo dado morde num consumidor diferente:** `d812f54` consertou a **tela
> da conversa**, `75bb0ed` consertou **o que a IA lê**, e a **lista** — a primeira tela que a
> Fernanda abre — ficou de fora das duas.

**B (29 casos)** — a lista mostrava `[áudio]` com a transcrição já no banco. O backfill de 30/07
preencheu 375 transcrições e não tocou na prévia.

**A condição foi para DENTRO da escrita** (filtro `or` do PostgREST). Ler e depois decidir tiraria
a corrida da rede e a colocaria no nosso código.

⚠️ **`lt` no webhook, `lte` no sync — diferença deliberada.** O webhook recusa empate (duas
entregas simultâneas ficariam alternando a prévia); o sync **precisa** do empate, que é como ele
conserta a prévia da *mesma* última mensagem quando a transcrição chega depois.

**AC6 — a exceção que protege a Fernanda:** inbound **reabre a conversa mesmo fora de ordem**.
Esconder da fila uma conversa em que o cliente falou é pior que prévia velha.

**Backfill (autorizado):** **63** conversas (eram 62 na medição — **o bug seguiu produzindo até o
deploy**). Read-back: 0 divergências. Sobraram 2 com `[áudio]` e **está certo**: são áudios que o
GPT Maker nunca transcreveu.

**Escopo (decisão do Filipe): apenas `gptmaker`.** `evolution`, `meta` e `zapi` têm o **mesmo
`update` incondicional** — defeito conhecido, na fila.

### 2.9 — O log de tokens nunca gravou uma linha

A fila dizia *"não registra tokens da extração"*. **A tabela está vazia — 0 linhas, desde sempre.**

```
ERROR: 23502: null value in column "context_snapshot" of relation
       "ai_conversation_log" violates not-null constraint
```

**3 dos 9 pontos** de inserção omitiam a coluna — os três blocos de contabilidade acrescentados
depois, copiados um do outro. O `briefing` omitia **duas** (faltava `conversation_id`).
Os outros 6 estão certos, mas pertencem à IA do CRM, **desligada neste canal**.

**Viveu 8 dias** porque o insert é fire-and-forget e a falha só virava `console.error`. **O caminho
de erro funcionava — faltava alguém escutando.**

Correção: helper único `lib/ai/token-log.ts`. Foi o copy-paste que criou o defeito 3×.

⚖️ **`context_snapshot` vai como `{}`.** Gravar "contexto" na extração seria trecho de conversa —
dado de saúde com base legal pendente. **Consertar contabilidade não pode virar ampliação de
tratamento.** Há teste travando.

**Impacto sem inflar:** hoje o prejuízo é de **medição**, não de proteção. `token-budget.ts` e
`rate-limiter.ts` leem esta tabela mas só são chamados por `agent.service.ts` — a IA desligada.
Não há teto sendo furado; há duas proteções que nasceriam cegas.

---

## ⚠️ Armadilhas novas desta sessão

1. **`REVOKE ... FROM PUBLIC` não basta neste projeto.** O Supabase concede EXECUTE a
   `anon`/`authenticated` via `ALTER DEFAULT PRIVILEGES` — grants **explícitos**, que o revoke do
   pseudo-papel `PUBLIC` não toca. A função nasceu executável por `anon`. **Revogar papel a papel.**
   *(Pego pelo read-back da própria migration.)*
2. **`\r` do Windows quebra casamento de string.** `chatids.txt` gerado no shell tinha `\r` no fim;
   12 chats que **existiam** apareceram como "NÃO ENCONTRADO". Usar `tr -d '\r'`.
3. **`python -c "..."` entre aspas duplas deixa o bash executar as crases.** Duas palavras em
   backtick sumiram de um arquivo. Usar heredoc `<< 'PYEOF'` ou a ferramenta Edit.
4. **`python3` não existe nesta máquina** — só `python`.
5. **`void promise` + rejeição = unhandled rejection.** A 1ª versão do `logAiTokens` propagava
   erro; como as chamadas são `void logAiTokens(...)`, isso derrubaria a operação que já tinha dado
   certo. **Helper fire-and-forget precisa de `try/catch` interno.**
6. **`contacts` não tem `external_contact_name`** — essa coluna é da conversa. O `UPDATE` errado
   abortou a transação inteira (nada parcial, felizmente).
7. **A API de chats do GPT Maker pagina** (`?page=N&pageSize=200`); 200 chats cobrem só ~8 dias.

---

## 🔴 Pendências abertas (ordenadas)

| # | Item | Natureza |
|---|---|---|
| 1 | ⚖️ **Gate LGPD do dado de saúde** — pendente desde **21/07** | **Decisão jurídica**, não código. Trava tudo que lê conversa |
| 2 | 🔴 **`supabase/migrations/` NÃO é a fonte da verdade** (`schema_migrations` nem existe) | Decisão arquitetural: adotar o CLI ou assumir que é documentação |
| 3 | 🟠 **`evolution`, `meta`, `zapi` com o mesmo `update` incondicional** da prévia | Decidido adiar (04/08) |
| 4 | 🔄 **Backfill dos ~198 deals** | Falta definir **o que** deve preencher |
| 5 | 📌 **Campos de lista fechada + estrela 1-5** (pedido da Izadira, 28/07) | Feature nova — falta definição |
| 6 | 🟡 **`deals` sem trigger de `updated_at`** | Movimento por automação não carimba |
| 7 | 🧹 Dois hooks disputam `unreadCount()` · barrel exporta versão diferente de `useMarkConversationRead` · filtro `@lid` é no-op | Higiene |
| 8 | ⛔ **Botão "Sincronizar" suspenso** — a rota aceita `{ skipWebhooks: true }`, a UI não passa | — |
| 9 | 🌿 **8 stories só no HD** (2.1 a 2.9) — `docs/stories/` é gitignored | Decisão de repo |
| 10 | 🔑 **Rotacionar tokens** — `sbp_` de 03 e 04/08, `apiToken` do GPT Maker, token da Vercel | Só o Filipe consegue |

### 🔍 Provas que faltam (não são bugs — é "não observado")

> Atualizado em **05/08** — duas das três foram atacadas. Ver a sessão de 05/08 no topo.

- ✅ **O log de tokens gravando de verdade** — **FECHADA em 05/08**, mas só depois de a
  correção de 04/08 se revelar inoperante. 3 linhas reais.
- 🟡 **A extração (2.4) num lead real com +30 mensagens** — **1 caso apenas** (5 de 5). n=1 não é
  prova, e a comparação com o antes sugere que o impacto real é **bem menor** que o descrito na
  story. ⚠️ Segue **não fechando o caso Magali** (20 mensagens, abaixo do teto).
- ⏸️ **O Realtime do board (2.5)** — lido no código, não visto na tela. **Intocada.**

### 🆕 Nasceram na sessão de 05/08

| # | Item | Natureza |
|---|---|---|
| A | 🏗️ **Onde mora contabilidade de IA sem conversa?** 4 pontos (board/deal) não cabem em `ai_conversation_log`, porque `conversation_id` é `NOT NULL`. Tornar a coluna NULLABLE afrouxa uma tabela que é, por nome e FK, de conversa; a alternativa é tabela própria de consumo | **Decisão de modelagem** |
| B | 🟡 **O painel de métricas conta só 4 rótulos** (`useAIMetricsQuery`). Os 3 novos entram na tabela e **não aparecem na tela** | UI, fora do escopo da 2.10 |
| C | 🔁 **Revisar a conclusão da story 2.4** à luz da medição — o texto da story afirma um impacto que os dados não sustentam | Registro |

---

## Sessão 2026-08-03 (parte 2) — Transferência move o card para "Em qualificação" (story 2.5)

**`a7e9275`** + **edge function v10 → v11 ACTIVE** + coluna nova + regra configurada. Cadeia SDC completa. Pedido do Filipe: *"quando o lead for transferido para o humano, no board, ele passa de Lead novo para Em qualificação"*.

### Não precisou de webhook novo

O evento `onTransfer` **já chegava e já era tratado** (`handleTransfer`, desde `843458e`): marca a conversa como `priority: high` e dispara a extração. Faltava agir sobre o board. O movimento entrou **antes** da extração — mover o card é escrita curta, a extração faz chamada de modelo.

### A leitura do board derrubou as duas alternativas óbvias

| ordem | nome literal | tam |
|---|---|---|
| 0 | `'Lead novo'` | 9 |
| 1 | `'Contato Realizado'` | 17 |
| **2** | **`'Em qualificação '`** | **16** |
| 8 | `' Proposta enviada'` | 17 |

- **Casar por nome falharia:** o destino tem **espaço no fim** (16 chars). `.eq('name','Em qualificação')` não casa — e falha **em silêncio**: 200 para o fornecedor, nenhum erro, card parado para sempre.
- **"Próximo estágio pela ordem" iria para o lugar errado:** existe `Contato Realizado` na ordem 1, **entre** a entrada e o destino.

⇒ Por isso o destino vive em **`lead_routing_rules.transfer_stage_id` (UUID)**. A tabela já era uma por canal e já dizia "onde o lead nasce"; passou a dizer "para onde vai quando fica pronto".

### As regras que protegem quem usa

- **NUNCA regride.** Se o estágio atual estiver na mesma ordem ou depois do destino, o card não anda. **Isto é essencial:** desde `8355ee3` a retransferência **reprocessa** — sem a trava, um lead que a Fernanda levou para "Proposta enviada" voltaria para trás toda vez que o cliente retomasse a conversa, apagando o trabalho dela sem erro nenhum.
- **`transfer_stage_id` NULL = não move.** Default de toda regra ⇒ ligar é opt-in, e os 3 canais Evolution seguem intactos.
- **Deal em outro board não é sequestrado de volta** — board é escolha de quem opera.
- **`UPDATE ... .select('id')`** — o PostgREST devolve sucesso mesmo quando a RLS filtra a linha e **zero** são atualizadas. Rule 7 dentro do código, mesmo remédio do `b0b07e8`.
- **Atividade `Moveu para X`** no formato do move manual, `owner_id` NULL, autoria da automação na descrição.

### Reuso: a resolução do deal virou fonte única

`resolveDealForConversation()` passou a servir **extração e movimento**. Um contato pode ter vários deals e não há `UNIQUE` em lado nenhum ⇒ *"o deal desta conversa"* é **escolha, não fato**. Se os dois consumidores escolhessem diferente, um preencheria um card e o outro moveria outro — **sem nada acusar erro**.

⚠️ **`stage-evaluator.ts` foi avaliado e RECUSADO:** é BANT por IA com HITL probabilístico, pertence à IA de atendimento do CRM (desligada neste canal por decisão de 24/07) e custaria uma chamada de modelo para decidir o que o próprio evento já decidiu.

### Rollout, com read-back de cada passo

| # | Passo | Read-back |
|---|---|---|
| 1 | Coluna `transfer_stage_id` | `uuid` · `nullable YES` · FK → `board_stages` ✅ |
| 2 | Edge function | **v11 ACTIVE**, `verify_jwt: false` preservado ✅ |
| 3 | Regra do canal `gptmaker` | = `'Em qualificação '` (ordem 2) ✅ |

**Gates:** lint 0 · typecheck 0 · suíte **497 → 508** (+11) · build ok. Sem a trava de não-regressão, **2 testes falham**.

### 🔴 Achado de infraestrutura — merece decisão própria

**`supabase_migrations.schema_migrations` NÃO EXISTE neste projeto.** Nenhuma migration do repo foi aplicada pelo CLI: `supabase/migrations/` é **histórico/documentação**, não a fonte da verdade do banco. Por isso o DDL desta story foi aplicado pela Management API (com read-back), seguindo o que o projeto já pratica de fato. **Não há garantia hoje de que repo e banco descrevam a mesma coisa** — e ninguém sabia disso até agora.

### ⚠️ O que NÃO está provado

- **Nenhuma transferência real passou pelo código novo.** Até a próxima transferência da IA: *no ar*, não *funcionando*.
- **O Realtime do board não foi observado** — a expectativa é o card andar sozinho na tela aberta, mas isso foi lido no código, não visto. Se não andar, F5 resolve e vira ajuste próprio.
- **Não há UI** para trocar o estágio de destino; hoje exige SQL.

> Story: `docs/stories/2.5.mover-deal-para-em-qualificacao-na-transferencia.story.md` — ⚠️ **5ª story fora do git**.

---

## Sessão 2026-08-03 — A extração lia a metade errada da conversa (story 2.4)

**`75bb0ed`** — cadeia SDC completa (SM → PO → Dev → QA → DevOps). Fecha o item que estava marcado como *"próximo da fila"* desde 29/07.

### Os dois defeitos, no mesmo trecho de 6 linhas

`lib/ai/extraction/customFields.service.ts:149` fazia `ORDER BY created_at ASC LIMIT 30`:

- **A — a IA lia as 30 mensagens MAIS ANTIGAS.** Numa conversa de 45, ela via o "oi, bom dia" e **nunca chegava ao fim** — que é onde a qualificação aparece, porque a IA do GPT Maker pergunta lesão/tempo/região no fim do roteiro, logo antes de transferir. Campo vazio, sem erro, sem log.
- **B — ordenava por `created_at` (chegada) e não por `sent_at` (horário real).** É **o mesmo defeito que `d812f54` corrigiu na tela** e que ficou para trás aqui. O provedor entrega lotes em paralelo e as entregas HTTP chegam embaralhadas por corrida de rede.

### A armadilha que mudou o desenho da correção

**`sent_at` é NULL-able** (migration `20260205100000:387`) — a Evolution só preenche condicionalmente. Então **trocar `.order('created_at')` por `.order('sent_at')` seria a correção errada**: o Postgres usa `NULLS LAST` em `ASC`, as mensagens sem `sent_at` iriam para o fim e o `LIMIT 30` as **descartaria**. Trocaria um bug por outro, mais difícil de ver.

**Solução:** a JANELA é escolhida por `created_at DESC` (sempre preenchido, serve de cursor) e a ORDEM é resolvida em memória com o fallback `sent_at ?? created_at` — **o mesmo critério da tela** (`MessageThread.tsx:72`). Mesmo motivo de `getLatestIdByContact` ter copiado o critério da edge function: critério de desempate que mora nos dois lados precisa ser igual, senão a tela mostra uma ordem e a IA lê outra, **sem erro nenhum**.

**Incluído no mesmo commit:** reações (`content_type = 'reaction'`) passam a ser excluídas no banco — viravam a string `[Mensagem]` e **consumiam vaga da janela**. A tela já as filtrava; a extração não. `content_type` é `TEXT NOT NULL` com `CHECK`, então o `.neq` não descarta linha por `NULL`.

### O que mudou

- **Novo** `lib/ai/extraction/conversationWindow.ts` — `orderConversationWindow`, decisão **pura**, no mesmo padrão de `pickTranscription`. A seleção da janela era a única parte da extração **sem teste nenhum**.
- **Novo** `test/conversationWindow.test.ts` — 13 testes.
- `customFields.service.ts` — query e aplicação da função.

### A prova (o que faz o teste valer)

Reverti o serviço ao comportamento antigo e rodei: **4 testes falham**, com as mensagens do defeito real —
`expected '…' to contain 'MSG-44'` · `expected 'MSG-00' to be 'MSG-15'` · `expected 105 to be less than 90`.

⚠️ **O fake de Supabase aplica `order`/`limit` de verdade** sobre o dataset. Um mock que devolvesse lista fixa passaria com o bug de volta — o teste do defeito A só existe porque o duplo respeita `ascending`.

⚠️ **Um teste meu nasceu decorativo:** o primeiro caso ponta a ponta do defeito B trocava só o `id` da mensagem, mas **o `id` não vai no prompt — o `content` vai**. Falhou por defeito próprio. Lição de 30/07 outra vez, agora no vermelho: teste que falha também precisa ser lido antes de acreditar.

**Gates:** lint 0 · typecheck 0 · suíte **484 → 497** (+13) · build ok. Gate QA: **PASS**.

### ⚠️ O que esta sessão NÃO resolveu

- **NÃO fecha o caso Magali** (`5511975159030`). Aquela conversa tinha **20 mensagens — abaixo do teto de 30**, então o defeito A **não pode** tê-la causado. O defeito B (ordem) segue como hipótese viva, **não provada**. A causa continua indeterminada.
- **Não há prova em produção ainda** — a correção muda de qual trecho a IA lê, e só uma transferência real com conversa longa mostra o efeito. Até lá é "corrigido e testado", não "provado no uso".
- ⚖️ **Gate LGPD segue pendente** (desde 21/07). Esta story **não altera o volume** de dado de saúde estruturado — muda de qual trecho ele sai.

> Story completa (⚠️ **fora do git** — `docs/stories/` é gitignored): `docs/stories/2.4.janela-de-conversa-da-extracao.story.md`. É a 4ª story existindo só no HD.

---

## Sessão 2026-07-30 (parte 3) — Transcrição de áudio (recebidos e enviados) NO AR

**`9fbda2a`** + edge function **v9 → v10 ACTIVE** + **backfill de 373 áudios**. Pedido do Filipe: *"traga a transcrição dos áudios, tanto os recebidos quanto os enviados — o GPT Maker já dá essa transcrição"*. Ele a via **no painel do GPT Maker**.

### Onde a transcrição estava (apurado no dado real, não inferido)

| Caminho | Traz transcrição? |
|---|---|
| **API** `GET /v2/chat/{chatId}/messages` | ✅ **sim**, no campo **`midiaContent`** — para `role: user` (recebido) E `role: assistant` (enviado) |
| **Webhook** (`onNewMessage`) | ❌ **não** |

**Evidência do "não" do webhook:** auditados os **358 eventos de áudio** já gravados em `messaging_webhook_events` — `audios` é **array de strings** (URLs puras), e o campo `message` vem **vazio em 100% deles** (maior valor observado: **0 caracteres**). Nenhuma chave extra além das 12 conhecidas.

**Evidência do "sim" da API:** 4 chats de produção, 31 áudios, textos de 34 a 1.547 chars. Confirmado como prosa pt-BR **sem exibir conteúdo** (dado de saúde): ~5,3 chars/palavra, 60–77% de caracteres alfabéticos — base64 daria 1 "palavra" e ~100% alfanumérico.

⚠️ **`midiaContent` estava DECLARADO** em `gptmaker.provider.ts:104` **desde sempre e nunca era lido** em lugar nenhum do repo.

🔪 **Hipótese morta antes de virar código:** a primeira suspeita era que a transcrição viesse no campo `message` junto do áudio e nós a descartássemos no parser (o ramo `image` guarda como `caption`, o `audio` joga fora — assimetria real). Os 358 eventos derrubaram: `message` está sempre vazio.

**Elo entre os dois mundos:** `messaging_messages.external_id` (vindo do `messageId` do webhook) **=== `id`** do item da API. Conferido nos 3 áudios de um mesmo chat, batendo exatamente. **Não é o `externalId`** — esse é outro identificador do fornecedor e casaria errado (há teste travando isso).

### O que mudou

- **Novo** `supabase/functions/messaging-webhook-gptmaker/transcription.ts`: `pickTranscription` (pura, 8 testes) + `fetchAudioTranscription` (timeout **6 s**, devolve `null` em qualquer problema). Módulo separado pelo mesmo motivo do `parser.ts`: a decisão é pura e testável.
- **Webhook** busca a transcrição ao receber áudio. Se ainda não houver, **grava a mensagem assim mesmo** e marca `metadata.transcription_pending` — perder transcrição é aceitável, perder mensagem não.
- **Sync** passa a ler `midiaContent` **e**, quando a mensagem já existe (o `insert` é ignorado por duplicidade), faz **UPDATE do `content`**. Sem isso todo o histórico ficaria sem texto para sempre. Novo contador `report.messages.transcriptionsFilled`.
- `AudioContent.transcription`; **MessageBubble** mostra o texto sob o player (mesmo padrão do caption de imagem); preview da conversa deixa de ser `[áudio]`.
- **As 4 cópias de `extractTextContent`** passam a usar a transcrição no lugar da string fixa `'[Áudio]'` ⇒ **fecha o defeito "lead que responde falando não qualifica"**, aberto desde 28/07.

### 🎉 Prova em produção, sem teste manual

Um áudio **real chegou às 16:30:14 — 28 segundos depois** do deploy da v10 (16:29:46) — e entrou **com transcrição de 808 caracteres**, sem `transcription_pending`.

### Backfill do histórico

Script fora do repo (scratchpad): lê áudios sem transcrição, busca na API por chat, casa por `external_id === id`, grava em lotes de 40 via `jsonb_set`.

- **373 gravados** de 387 pendentes · 97 chats · 0 chats sem resposta.
- **Estado final: 375 de 389 áudios com transcrição (96%)** — 178 recebidos + 197 enviados. Tamanho médio 475 chars, maior 3.240.
- ⚠️ **14 áudios ficaram sem** — a API não devolveu `midiaContent` para eles (prováveis áudios antigos, nunca transcritos pelo fornecedor). Não há o que buscar; só uma nova transcrição do lado deles resolveria.
- ✅ **Não tocou em configuração de webhook** — o botão "Sincronizar" segue suspenso. (Descoberto no caminho: a rota de sync aceita `{ skipWebhooks: true }` no body, mas o **botão da UI não passa essa flag** — quem clicar reconfigura webhooks.)

**Gates:** lint 0 · typecheck 0 · suíte **476 → 484** (8 testes novos) · build ok. Deploy Vercel **Ready** + edge function **v10 ACTIVE** (read-back).

⚖️ **LGPD:** decisão do Filipe (30/07) de **seguir com a pendência registrada**. Isto **aumenta** a exposição do Art. 11 — áudio opaco virou **texto pesquisável e filtrável** em 375 mensagens. Base legal pendente desde **21/07**.

🔑 **Segurança:** um token `sbp_` de gerenciamento (1 dia) passou pelo chat de novo, e o `apiToken` do GPT Maker foi lido de `messaging_channels.credentials` (com autorização do Filipe). **Rotacionar.**

---

## Sessão 2026-07-30 (parte 2) — "some e volta": corrida de cache + a guarda que impedia a cura

**`7f5045d`** — **regressão do próprio `b0b07e8`**, relatada pelo Filipe minutos depois do deploy: *"ao clicar, some e depois aparece de novo; quando clico em OUTRA conversa, aí sim some de vez"*.

**O passo final é o diagnóstico:** se some de vez ao abrir outra conversa, **a escrita no banco funciona**. O que falhava era o cache — um refetch iniciado **antes do commit** (pelo clique, por realtime, ou por qualquer invalidação do prefixo `all`) lê o `unread_count` velho e, ao resolver, sobrescreve o zero.

**E a guarda anti-laço do `b0b07e8` transformava isso em permanente:** a chave era `${id}:${unreadCount}`; quando o valor velho voltava, a chave voltava a ser **a mesma** — lida como *"já tentei"* — e a segunda tentativa era **bloqueada**. Antes do fix o laço tentava até colar (barulhento); depois virou silencioso. **Bug meu, do mesmo dia.**

**Descartado com evidência (auditoria do banco):** **não existe nenhum trigger de recálculo** de `unread_count` em `supabase/migrations/`. As únicas ocorrências são o DDL, um índice parcial, o `SUM` da RPC de leitura, o `= 0` do `mark_conversation_read` e o **incremento** no `AFTER INSERT` de mensagem inbound (`20260403120000:68`). Nenhum trigger de UPDATE toca no contador — o `BEFORE UPDATE` só mexe em `updated_at`. **Não é o banco revertendo.**

**Correções:**
1. **`onSuccess` reafirma o zero** na lista e no `detail`. Não é otimismo: o `.select('id')` já confirmou a gravação ⇒ escrita **autoritativa**, que vence resposta atrasada.
2. **`onSettled` invalida a lista com `refetchType: 'none'`** — marca stale sem disparar mais uma leitura concorrente. Mesmo remédio do **`a24301a`** (campos personalizados), onde o `invalidateQueries` do `onSettled` atropelava o `setQueryData`.
3. **A guarda vira `MAX_MARK_READ_ATTEMPTS = 3`** por chave — o sistema se cura de uma corrida e ainda assim para de bater.

**Gates:** lint 0 · typecheck 0 · suíte **475 → 476** · build ok. Deploy **Ready**, alias `acreditando-crm-sandy.vercel.app` no `7f5045d` (read-back 11:31:44).

⚠️ **Lição do teste (a mais importante do dia):** escrevi o teste da corrida, ele passou — **e rodando sem o fix passou também**. Não testava nada: eu escrevia o valor velho **antes** do `onMutate` rodar. Refeito com um **portão na resposta do UPDATE** (`updateGate`), escrevendo o valor velho exatamente entre o otimismo e a confirmação. Agora falha sem o fix com `expected 3 to be +0`. **Teste que passa nos dois estados é decoração.**

**Achados laterais registrados (não corrigidos):**
- 🏎️ Eventos de `messaging_messages` INSERT invalidam com **`refetchType: 'all'`** (`useRealtimeSync.ts:268-287`, `:318-337`, `:349-369`) — refetcha até queries **inativas**, ampliando a janela de atropelo.
- 🔑 **`queryKeys.messagingConversations.filtered()` não inclui `channelType`**, embora `ConversationList` passe esse filtro e a `queryFn` filtre no client — **duas seleções de canal compartilham a mesma entrada de cache**.
- ⏱️ O debounce do realtime é **único por instância do hook, compartilhado entre todas as tabelas** (100 ms) — fluxo contínuo de eventos posterga o flush indefinidamente.
- 🔀 **Dois caminhos de baixa com autorização diferente:** o UPDATE direto (sob RLS, exige admin **ou** membro do business unit) e a RPC `mark_conversation_read` (`SECURITY DEFINER`, filtra só por `organization_id`). Hooks diferentes usam caminhos diferentes.

---

## Sessão 2026-07-30 (parte 1) — Badge de não lidas não zerava ao abrir a conversa

**`b0b07e8`** — bug relatado pelo Filipe: *"após abertas ainda ficam com o ícone com o número de mensagens não visualizadas"*. Cadeia SDC completa (SM → PO → Dev → QA → DevOps).

**Causa raiz (reproduzida em teste, não só lida):** o `onMutate` de `useMarkConversationRead` (`lib/query/hooks/useConversationsQuery.ts:364`) fazia `setQueriesData` sobre o **prefixo** `['messagingConversations']` — que casa com **três** famílias de cache: a lista (`filtered` → array), o detalhe (`detail(id)` → **objeto**) e o contador (`unreadCount()` → **número**) — e chamava `old.map` guardando só com `if (!old)`.

O `TypeError: old.map is not a function` estourava **dentro do `onMutate`**. E o TanStack aguarda o `onMutate` **antes** de iniciar o retryer (`query-core@5.96.2`, `mutation.js:102` e `:115`; o `catch` está em `:146`) ⇒ **a `mutationFn` nunca rodava** e o `UPDATE ... SET unread_count = 0` **nunca chegava ao banco**. O `onSettled` ainda rodava (caminho de erro), invalidava a lista, o refetch trazia o valor original, o objeto `selectedConversation` mudava de identidade e o efeito da `MessagingPage:167` **redisparava em laço** — tudo mudo, porque a mutation é chamada por `mutate()` sem `onError`.

**A prova do descuido estava no mesmo arquivo:** `useUpdateConversation` (`:309-317`) e `MessagingPage.tsx:107` já guardavam com `Array.isArray`, **com comentário explicando exatamente esse perigo**. Só o `markConversationRead` não guardava. E não havia **nenhum** teste tocando esse hook.

**O que mudou:**
1. Guarda `Array.isArray` no updater + `setQueryData` explícito no `detail(id)` (evita o efeito redisparar antes do refetch).
2. `mutationFn` passa a usar **`.select('id')`** e **falha alto** quando 0 linhas são afetadas. Motivo: a policy de UPDATE de `messaging_conversations` (migration `20260205100000:322-341`) exige **admin ou membro do `business_unit_members`** da conversa — para quem está fora disso, o PostgREST devolve **sucesso com zero linhas** e a baixa seria engolida em silêncio. É a Rule 7 aplicada dentro do código.
3. `onError` logando — sem isso, falha em `mutate()` dentro de efeito é invisível (foi assim que o bug durou).
4. Guarda anti-laço na `MessagingPage`, com chave **`id:unreadCount`** (mensagem nova numa conversa aberta muda a chave e volta a marcar como lida).

**Gates:** lint 0 · typecheck 0 · suíte **471 → 475** · build ok. `test/markConversationRead.test.ts` (4 testes) — **sem o fix, 3 falham** com a mensagem real `old.map is not a function`.

⚠️ **Limites assumidos:**
- **O wiring de UI não tem teste** — o `useEffect` da `MessagingPage` foi verificado por leitura, não por render. Mesmo limite de 28/07.
- **A segunda camada (RLS) segue sem verificação em produção.** Se a Fernanda não for `admin` e a conversa tiver `business_unit_id NULL`, o UPDATE continua afetando 0 linhas — a diferença é que agora **grita** (erro + `console.error`) em vez de falhar mudo. **Só o uso real revela.** Se o badge ainda não zerar para ela, o console vai dizer o porquê.

**Achados registrados, NÃO corrigidos aqui:**
- 🧟 **`context/messaging/MessagingContext.tsx` é código morto** — nenhum layout monta o `MessagingProvider` e `useMessaging()` não é chamado em lugar nenhum. Ele carrega uma **segunda** `useMarkConversationRead` (a versão RPC).
- ⚠️ **Colisão de queryKey:** `useUnreadCount` (`useConversationsQuery.ts:245`, count SQL, `staleTime` 60s) e `useUnreadConversationCount` (`useMessagingConversationsQuery.ts:273`, RPC `get_messaging_unread_count`, 30s + `refetchInterval`) usam **a mesma key** `['messagingConversations','unreadCount']` com `queryFn` diferentes. Hoje não colidem só porque o segundo não é montado — vira bug no dia em que alguém montar o provider.
- 🔁 **A RPC `mark_conversation_read` existe** (`20260223000001:223`, `SECURITY DEFINER`, filtra por org) e **a tela não a usa**. Migrar para ela contornaria a RLS de business unit — decisão de produto/segurança, não bugfix.
- 🪤 **O barrel `lib/query/hooks/index.ts:125` exporta a versão RPC** de `useMarkConversationRead`. Importar de `@/lib/query/hooks` entrega um hook **diferente** do que a `MessagingPage` usa. Armadilha para a próxima pessoa.

> Story completa (fora do git — `docs/stories/` é gitignored neste repo): `docs/stories/2.2.badge-nao-lidas-nao-zera.story.md`.

---

## Sessão 2026-07-28 (madrugada) — Navegação card do lead ↔ conversa

**`dee21cd`** — pedido do Filipe: *"clicando em um ou no outro deve abrir a conversa ou card correspondente"*. **Testado por ele em produção: funcionou.**

**O diagnóstico:** os dois caminhos existiam na tela e **nenhum chegava ao destino** — os botões navegavam mandando parâmetro que ninguém do outro lado lia.

| Caminho | Mandava | Quem lia |
|---|---|---|
| Card → conversa | `?newConversation=true&contactId&contactName&contactPhone` | **ninguém** — `MessagingPage` só lia `?id=` |
| Conversa → card | `?contact=<id>` | **ninguém** — o board só lê `?deal=<id>` |

`newConversation` aparecia **uma única vez no repo inteiro: na escrita**. É a mesma família do bug de 27/07 (campo que existia na tela e não no banco): **quem clica acha que errou o clique, então ninguém reporta.**

**A metade difícil já existia:** `/boards?deal=<id>` já abre o card (`useBoardsController.ts:319-330`). Faltava resolver contato → deal.

**Novo `dealsService.getLatestIdByContact`** — critério **idêntico** ao da edge function (`messaging-webhook-gptmaker/index.ts:394-403`): `contact_id` + `organization_id` + `deleted_at is null` + `created_at desc` + `limit 1`. ⚠️ Não há FK entre `deals` e `messaging_conversations` (o elo é `contacts.id`) e **um contato pode ter vários deals e várias conversas** — sem `UNIQUE` em nenhum lado. *"O deal desta conversa"* é **escolha**, não fato; se os dois lados divergirem, **a extração preenche um card e a navegação abre outro, sem erro**.

**Mudança de comportamento:** o botão "Mensagem" exigia `contact.phone`. Como o parser recusa `@lid` como telefone (`parser.ts:162-172`), lead vindo por `@lid` tinha conversa e **ficava sem botão**. Agora basta `contact.id`.

**Sem destino, avisa** em vez de clique mudo: *"ainda não tem conversa de WhatsApp registrada"* / *"ainda não tem card no funil"*.

**Gates:** lint 0 · typecheck 0 · `npm run build` ok · suíte **464 → 471** (7 testes novos em `test/dealLookupByContact.test.ts`). Deploy Vercel **Ready**, aliases incluindo `acreditando-crm-sandy.vercel.app`.

⚠️ **O wiring de UI não tem teste automatizado** — os 7 testes cobrem o lookup e o critério de desempate. Renderizar a `MessagingPage` exigiria ~20 mocks.

🧟 **`NewConversationModal` é código órfão** — nenhum consumidor no repo (só a definição e o export no `index.ts`). Por isso "criar conversa quando não existe" **não** foi implementado: seria recurso novo, não navegação.

### Investigação do lead 5511975159030 (Magali) — inconclusiva de propósito

Pedido: *"por que o **nome** desse lead não foi coletado"*. **O nome foi coletado** — `Magali` em `contacts.name`, `external_contact_name` e `deals.title`. E **não existe campo "nome"** entre os cinco personalizados.

O que falhou foi a **qualificação: 1 campo de 5** (`ondeReside: Ipiranga`, 0,95). Conversa com **20 mensagens** — abaixo do teto de 30 ⇒ **não foi truncamento**. ⏸️ **Causa não determinada** — investigação interrompida pelo Filipe antes de ler o conteúdo das mensagens (dado de saúde). Retomar exige autorização.

**4 defeitos reais da extração achados no caminho** (nenhum causou este caso):
1. 🟠 Lê a conversa por **`created_at`** (chegada), não `sentAt` (`customFields.service.ts:153`) — o mesmo campo que `d812f54` corrigiu **na tela**.
2. 🟠 **`limit(30)` ascendente** descarta as mensagens **mais recentes**.
3. 🔇 **Áudio vira `[Áudio]`**, sem transcrição (`:294-302`).
4. 🟡 **Filtro de `@lid` no nome é no-op** (`parser.ts:287`): `rawName && !rawName.includes("@") ? rawName : rawName ?? null` devolve `rawName` **nos dois ramos**.

Bônus: **o nome do contato nunca é atualizado depois da criação** — nem pelo `onTransfer` (que traz o nome real), nem pelo sync (que só atualiza avatar).

---

## Sessão 2026-07-28 (tarde) — Retransferência volta a reprocessar

**`8355ee3`** — fecha a pendência 🔴 nº 1 da sessão anterior. Edge function **v8 → v9**, ACTIVE.

O id de idempotência da transferência era `gpt_transfer_<contextId>`, **sem horário** — diferente de todos os outros eventos. Lead que voltava semanas depois e era transferido de novo batia na única `(channel_id, external_event_id)`, recebia `200 OK` e **nunca reprocessava**.

**A sutileza que mudou a correção:** não dá para copiar o padrão dos outros eventos e usar o timestamp cru. A transferência é o **único evento que não traz `date`** no payload — o `timestamp` dela é a hora de chegada na edge function. Timestamp cru faria **cada retry do fornecedor virar evento novo**, trocando *"engole retransferência"* por *"duplica transferência"*.

**Solução:** janela de 5 min — `TRANSFER_DEDUPE_WINDOW_MS`, id vira `gpt_transfer_<contextId>_<balde>`. Entregas no mesmo balde colapsam (retry deduplicado); transferência posterior cai em balde diferente e reprocessa.

**Limites assumidos** (documentados no código): retry que cruza a fronteira do balde duplica — só ocorre em timeout de rede, já que a função responde 200 mesmo em erro de processamento; e retransferência dentro de 5 min é engolida, o que é operacionalmente indistinguível de um retry.

**Efeito no reprocessamento (verificado em `customFields.service.ts:143-146`):** `pending` filtra só campos **vazios** e a função **retorna antes de chamar a IA** quando tudo já está preenchido ⇒ retransferência de lead já qualificado **não gasta token**. ⚠️ Contrapartida que fica mais visível: lead que volta com informação **diferente** (mudou de região, por exemplo) **não** tem o campo atualizado — é a regra deliberada de 27/07 (*"nunca sobrescreve"*), não uma regressão.

**Gates:** lint 0 · typecheck 0 · suíte **458 → 464** (6 testes novos, incluindo o caso que faltava: *"retransferência semanas depois gera id novo"*).

**Read-backs (Rule 7):**
- `supabase functions list` → `messaging-webhook-gptmaker` **v9 ACTIVE**, 14:42 UTC.
- Chamada real com chave **errada** → `401 {"error":"Segredo inválido"}` — resposta **da nossa função** (acentuada, em pt-BR), não do gateway ⇒ `verify_jwt` continua desligado e o default-deny da auth funciona. Nada gravado: a auth roda antes do audit log.

**Correção de registro:** o alerta antigo de que `main` trackeava `thaleslaray/nossocrm` **não vale mais** — `origin` é `fbrain-acreditando/acreditando-crm`. Push normal com `git push origin main`.

> 📌 **Este arquivo (`00-CONTEXTO-SESSAO-RETOMAR-AQUI.md`) está UNTRACKED no git** — existe só no HD, sem backup, apesar de ser a porta de entrada do repo e de ser citado pelo `CLAUDE.md`. Versionar é decisão pendente do Filipe.

---

## Sessão 2026-07-27 — Campos personalizados religados + extração sob medida

**Ponto de partida:** o funil da Fernanda estava listado como pendência no vault. Na verdade **o board "Acreditando" já existe com 12 estágios** (`Lead novo → … → Ganho/Perdido`), **196 deals dentro** e o roteamento certo (canais `Acreditando WhattsApp` (gptmaker) e `wapp` (evolution) → board Acreditando / estágio `Lead novo`). O que faltava era a **qualificação**.

### 1. `129e553` — campos personalizados nunca chegavam ao banco

A tabela `custom_field_definitions` existe desde o início, com RLS org-scoped, e **nenhuma parte da UI a lia ou gravava**:
- `features/settings/hooks/useSettingsController.ts` salvava em **localStorage** (`crm_custom_fields`);
- `features/boards/hooks/useBoardsController.ts:269` e `DealDetailModal.tsx:111` recebiam **`[]` hardcoded**.

Criar campo em Configurações não surtia efeito em lugar nenhum e sumia ao trocar de navegador. A gravação do **valor** já funcionava (`deals.ts:226`); o buraco era a definição nunca chegar.

Novos: `lib/supabase/customFields.ts` + `lib/query/hooks/useCustomFieldsQuery.ts` + `queryKeys.customFields.byEntity()`. A `key` é derivada do rótulo **uma vez, na criação, e nunca é alterada** — é o vínculo com os valores já gravados em `deals.custom_fields`.

⚠️ **Footgun do repo:** existem `lib/supabase.ts` **e** `lib/supabase/index.ts`. O TS resolve o **arquivo**; o `index.ts` da pasta é **código morto**. Exportar só nele dá `TS2305`. Exportado nos dois.

### 2. `a24301a` — lista só atualizava depois do F5

Sintoma relatado pelo Filipe. **Não reproduzi** — o teste da cadeia completa passa. Quatro hipóteses derrubadas com evidência (invalidação por prefixo funciona · defaults do QueryClient normais · existe só um `queryKeys` · wiring da tela ok).

Correção: tornar a atualização **determinística** via `setQueryData` nas 3 mutations. E ao escrever o teste que congela `getAll` apareceu um problema real: o `invalidateQueries` do `onSettled` **sobrescrevia** o `setQueryData` — mesma classe do bug de mover card (24/07). Resolvido com **`refetchType: 'none'`**.

### 3. `843458e` — extração de campos a partir da conversa

**Diagnóstico (verificado no banco):** 198 deals, **0** com `ai_extracted` e **0** com `custom_fields`. A extração nativa é **BANT** (orçamento/decisor/necessidade/prazo) — não serve para lesão/tempo/região — e nunca rodou, por 3 motivos somados: o webhook do GPT Maker não chama `/ai/process` (decisão de 24/07); a extração BANT é o passo 12 do agente, só roda depois que a IA do CRM responde; e os segredos nunca foram configurados (ver Pendências).

Novos: `lib/ai/extraction/customFields.schemas.ts` (schema Zod **dinâmico**, montado das definições da org) + `customFields.service.ts` + rota interna `app/api/messaging/ai/extract-fields` + gatilho no **evento de transferência** do webhook GPT Maker (edge function **v5**, read-back ok).

Duas regras deliberadas: **nunca sobrescreve valor preenchido por pessoa** (só completa campo vazio) e **descarta valor de `select` fora das opções** (`coerceValueForField`) — sem isso a IA responderia "Zona Norte" e o filtro passaria a mentir, sem erro. Proveniência em `ai_extracted.customFields`.

⚠️ **Armadilha evitada:** `deals` **NÃO tem `conversation_id`** — o elo conversa→deal é o **contato**. Confirmado no `information_schema` antes de escrever a query.

### 4. `18bfd2e` — pergunta antes de apagar campo personalizado

A lixeira apagava direto. Agora abre `ConfirmDialog` (o mesmo das outras seções de Configurações). A mensagem diz a verdade: o valor já preenchido **não é apagado** (segue em `deals.custom_fields`), só some da tela — e recriar com o mesmo rótulo **traz os valores de volta**, porque `deriveFieldKey` é determinística. Botão "Sim, remover" (a lixeira já usa o nome acessível "Remover campo"). 6 testes.

### 5. `773062d` — Sincronizar não pode atropelar webhook de outro sistema

⚠️ **Incidente real desta sessão.** O `onTransfer` do agente apontava para um fluxo do N8N (`n8n.fbraintech.com.br/webhook/transferencia-acreditando`) que **avisa a Fernanda quando a IA passa o lead para humano**. Eu apontei o `onTransfer` para o CRM (para ter o gatilho da extração) e **desliguei esse aviso sem saber**. O Filipe informou em seguida, e **restaurei** — a URL do N8N está de volta.

Causa: `configureWebhooks` preservava só os eventos **fora** da lista `events`. Como `onTransfer` está na lista padrão, um clique em "Sincronizar" faria o mesmo estrago. A API do GPT Maker aceita **uma URL por evento** — não é lista.

Corrigido: evento só é sobrescrito se a URL atual apontar para o **mesmo host**; apontando para fora, é preservado e devolvido em `skipped`. Escape: `{ overwriteExternal: true }`.

### Estado dos webhooks do agente GPT Maker (após a sessão)

| Evento | Destino |
|---|---|
| `onTransfer` | **N8N** (aviso da Fernanda) — restaurado |
| `onNewMessage` | CRM + `&event=onNewMessage` |
| `onFirstInteraction` | CRM + `&event=onFirstInteraction` |
| `onStartInteraction` · `onFinishInteraction` · `onCreateEvent` · `onCancelEvent` · `onLackKnowLedge` | vazios |

> Os `&event=` foram acrescentados nesta sessão. Antes as URLs do CRM não tinham o hint (registro anterior ao fix `f50a964`) e a classificação dependia só da inferência pela forma do payload.

### 6. `a568f1a` — parser não reconhecia o evento de transferência

O Filipe capturou o payload real do `onTransfer` apontando um webhook de teste no N8N:

```json
{ "summary": null, "agentId": "...", "name": "Filipe Costa",
  "recipient": "5512997534278", "channel": "WHATSAPP",
  "contextId": "<channelId>-<recipient>", "channelId": "..." }
```

**Não tem** `messageId`, `role`, `interactionId` nem `protocol` — os quatro campos em que `classifyEvent` se apoiava. Sem `&event=` na URL, a transferência caía em `unknown` e era descartada calada desde 24/07. Regra nova: presença da chave `summary` junto de `contextId` (a **presença**, não o valor — `summary` vem `null` quando a IA não resume). Edge function **v8**.

### 🏆 RESULTADO: extração NO AR, validada com lead real

**Greice Bugne, 28/07 10:59** — transferência real, do GPT Maker, processada de ponta a ponta:

```
paraQuemE          "Para si mesma"           (1.0)
tipoDeLesao        "AVC"                     (1.0)
haQuantoTempo      "Muito tempo"             (0.9)  ← a IA baixou a nota sozinha
ondeReside         "São Paulo, Zona Leste"   (1.0)
jaFezReabilitacao  "Não"                     (1.0)
```

Cada um com o trecho da conversa que sustenta o valor, em `ai_extracted.customFields`. Isso também **prova** que os dois valores do `INTERNAL_API_SECRET` batem.

### ⛔ Ponto cego da API do GPT Maker — leia antes de mexer em webhook

A **UI aceita vários webhooks por evento**; a **API `GET/PUT` expõe só um**. Toda leitura pela API é **parcial**, e um `PUT` nosso pode apagar destinos que não enxergamos.

**Não use o botão "Sincronizar"** do card do canal. A proteção do `773062d` compara com o que a API mostra — ela **herda o mesmo ponto cego**. Cadastre webhook à mão no painel do fornecedor, no formato:

```
https://<ref>.supabase.co/functions/v1/messaging-webhook-gptmaker/<channel_id>?key=<webhookSecret>&event=<nomeDoEvento>
```

### Pendências desta sessão

- ✅ ~~🔴 **Retransferência é descartada em silêncio.**~~ **RESOLVIDO em 28/07 (tarde)** pelo `8355ee3` — janela de dedupe de 5 min, edge function v9. Ver a sessão no topo deste arquivo.
- 🟠 **`ai_conversation_log` não registra a extração.** As duas extrações rodaram e nenhuma gravou tokens. O insert é *fire-and-forget* (falha não quebra a extração), mas o **gasto de IA fica invisível** no controle de orçamento. Investigar: coluna obrigatória? RLS? nome de campo?
- ✅ **`INTERNAL_API_SECRET` configurado e PROVADO** nos dois lados — a extração só rodou porque a edge function conseguiu chamar o app.
- 📌 Campos hoje são todos texto livre. `ondeReside` e `jaFezReabilitacao` deveriam ser lista fechada (o roteiro da IA já produz respostas fechadas); falta o campo **estrela 1-5**.
- 💡 **Usar o `summary`** do payload de transferência (resumo da conversa pela própria IA) em vez de reler 30 mensagens.
- 📌 Achado de escopo maior: sem esse segredo, **nenhum** webhook conseguia chamar o app — vale para evolution/meta/zapi também. Explica os 0 deals com `ai_extracted`. Não era decisão de produto: era configuração que nunca existiu.
- 🔄 **Backfill:** os 196 deals existentes só serão preenchidos em nova transferência. Falta uma rota/script de backfill.
- ⚖️ **LGPD:** estruturar tipo/tempo de lesão em campo indexável **aumenta** a exposição do Art. 11. Base legal pendente desde 21/07.
- 🧹 Dois estágios com espaço sobrando: `"Em qualificação "` e `" Proposta enviada"`.
- 🧹 Canais `Travel wapp` e `Whatsapp` roteiam para o board de teste **"Gestão de Vendas - Experiência Chile"** (0 deals) — lead cai em board morto.
- 📌 Os 5 campos criados são todos **texto livre**. `ondeReside` e `jaFezReabilitacao` deveriam ser lista fechada; falta o campo de **estrela 1-5**.
- 📌 **Os 38 blocos `#region agent log` são do upstream** (Thales Laray), todos `NODE_ENV !== 'production'`. **Decidido não remover** — 38 alterações em 6 arquivos upstream criariam conflito em toda re-sincronização, sem ganho.

---

## Sessão 2026-07-24 — Canal GPT Maker NO AR (WhatsApp do Acreditando dentro do CRM)

**Contexto:** o WhatsApp do Acreditando já roda no **GPT Maker** (a IA "Assistente Virtual" qualifica e transfere pra Fernanda). Até agora esse atendimento morria fora do CRM. Este canal traz as conversas pra dentro. Squad API Hunter (estudo da API, `docs/research/gptmaker-api-study.md`, score 68/100) → cadeia SDC. Modelo escolhido pelo Filipe: **canal completo, com a IA do GPT Maker atendendo e a IA do CRM DESLIGADA** neste canal (`ai_paused:true` nas conversas + `crmAiEnabled` no `ChannelSettings` — virar essa flag é a futura migração GPT Maker→CRM).

**API GPT Maker:** base `https://api.gptmaker.ai/v2`, Bearer do workspace. Hierarquia `Workspace → Agent → Channel → Chat → Message`. **Webhooks são por AGENTE, não por canal.** A plataforma **não assina os payloads (sem HMAC)** e **não documenta o formato do webhook** — o real foi capturado em produção.

**O que foi feito (7 commits na `main`, edge functions no Supabase `jmjhtprnxjffaqhdzfmc`):**
1. **`b28358f`** — provider `gptmaker` (`lib/messaging/providers/whatsapp/gptmaker.provider.ts`): status, envio, start/stop-human, backfill de histórico, `configureWebhooks`, discovery. Edge function `supabase/functions/messaging-webhook-gptmaker/` (auth por segredo na query `?key=`, dedupe, **modo captura** `GPTMAKER_CAPTURE_MODE`, handlers) + `parser.ts` isolado. Registro no factory (`features:['media']`), `config.toml` `verify_jwt=false`, passo no `ChannelSetupWizard`.
2. **`d07ddb1`** — **descoberta automática** (`app/api/messaging/gptmaker/discovery`): cola só o token → lista workspaces/agentes/canais → escolhe em dropdown.
3. **`713a2b8`** — fix colateral: **`messaging-webhook-meta` nunca bootava** (`const sourceLabel` duplicado no mesmo escopo = SyntaxError). Estava mascarado pelo 401 do gateway com `verify_jwt` ligado. As 4 webhooks (evolution/meta/zapi) foram deployadas com `verify_jwt=false` — pendência de 23/07 fechada.
4. **`02c1014`** — rota `gptmaker/sync` + botão "Sincronizar" no card: registra os webhooks no agente (`&event=` na URL, porque o payload não diz qual evento é) + importa histórico. Corrigido `WEBHOOK_FUNCTION_MAP` (faltava evolution/gptmaker).
5. **`f50a964`** — **parser reescrito com o payload REAL** (capturado dos 67 eventos): não há campo `event` (usa `&event=` + inferência pela forma), `date` é ISO string (não epoch), mídia vem em ARRAYS (`images`/`audios`/`documents`), `contactPhone` pode ser `@lid` (rejeita → não inventa telefone). `contextId = <channelId>-<recipient>` = id da conversa (= id de `/chats` → não duplica). Fixtures = payloads reais.
6. **`5e53bdd`** — **corrida** entre `onNewMessage` e `onFirstInteraction` (137ms) perdia a 1ª mensagem do cliente. Fix: em erro de duplicidade relê a conversa concorrente. + `toError()` (erros do PostgREST não são `Error`, viravam "Unknown error"). + migration `20260724190000` **índice único** `messaging_messages (conversation_id, external_id)` — não existia, o dedup de TODOS os provedores era letra morta.
7. **`d812f54`** — **ordem das mensagens**: a thread ordenava por `created_at` (chegada), embaralhada por corrida de rede. Agora por **`sentAt`** (`MessageThread.tsx`); paginação segue com cursor em `created_at`.
8. **`7b298b4`** — **foto de perfil**: `chat.picture` (só em `/chats`, não no webhook) → `external_contact_avatar` (+ `contacts.avatar`). Backfill: 49 conversas com foto.

**Estado:** canal **"Acreditando WhattsApp"** (`25761ba7-b9e6-439a-aff1-ad5632281a20`) `connected`, recebendo mensagem real, criando conversa+deal, fotos no ar. Gates em todos: lint 0 · typecheck 0 · suíte 410/410.

**Pendências:**
- ⚖️ **Gate LGPD** (dado de saúde, Art. 11) — é o que falta pra deixar rodando pra valer, não só teste.
- 🖼️ URLs de foto do WhatsApp **expiram** — re-hospedar no Storage é melhoria futura (⚠️ pesar egress); hoje a re-sync renova.
- 🔄 Backfill das 47 conversas restantes (só as 50 recentes pegaram foto; total 97).
- Detalhe completo: `docs/stories/2.1.canal-gptmaker.story.md` + daily [[2026-07-24]] + wiki [[Canal GPT Maker (CRM)]].

---

## Sessão 2026-07-23/24 — "dados só atualizavam no F5" RESOLVIDO (front + banco + jump back)

**Sintoma:** criar/mover deal/lead não refletia sem reload; card movido "voltava" pra coluna de origem. **Causa raiz:** mutations de deals delegavam 100% ao Supabase Realtime, que só era montado por página (`useRealtimeSyncAll()` nunca era chamado).

**O que foi feito (3 commits, todos com QA typecheck/lint/cache-15/build + deploy Vercel success):**
1. **`9437772`** — mutations de deal voltam a invalidar `deals.all` (targeted); `useDealsByBoard` reconcilia no mount; **`components/RealtimeBridge.tsx`** (novo) monta `useRealtimeSyncAll()` global no `ProtectedShell`; INSERT do Realtime agenda refetch em vez de descartar.
2. **Banco** (Management API, token 1-dia) — `REPLICA IDENTITY FULL` nas 6 tabelas (deals/contacts/activities/boards/board_stages/crm_companies). A publication `supabase_realtime` já tinha as tabelas.
3. **`d95b948` → `49a312a`** — fix do **jump back** ao mover card. Causa real (2 hipóteses erradas antes): num move, o Realtime aplica o stage direto no cache mas enfileirava `deals.all`, que ficava preso; o INSERT da atividade "Moveu para X" flushava a fila → refetch stale sobrescrevia o otimismo. **Fix:** em UPDATE de deals **não enfileirar `deals.all`** (`lib/realtime/useRealtimeSync.ts` ~:432).

**Arquivos tocados:** `lib/query/hooks/useDealsQuery.ts` · `lib/query/hooks/useMoveDeal.ts` · `lib/realtime/useRealtimeSync.ts` · `app/(protected)/ProtectedShell.tsx` · `components/RealtimeBridge.tsx` (novo).

---

## ⏳ Pendências / próximos passos
- 🔴 **Confirmar o re-teste do Filipe** do jump back (mover card e ver se fica). Fix `49a312a` no ar.
- 🧹 **Hardening (se o re-teste ainda falhar OU pra limpar):** o Realtime de `deals` é montado **2×** no board — `useRealtimeSyncKanban` (via `features/boards/hooks/useBoardsController.ts`) **+** `useRealtimeSyncAll` (via `RealtimeBridge`). Consolidar numa só (⚠️ `useRealtimeSyncKanban` cobre `board_stages`, que o `All` não cobre — não remover sem realocar).
- 🧹 **Cruft:** ainda há blocos de debug `#region agent log` (console.log) espalhados; os `fetch('http://127.0.0.1:7242/...')` já foram removidos. Limpar numa janela calma.
- 📋 **Config de produto (pré-uso real, do vault):** ativar IA Gemini, funil da Fernanda, conectar WhatsApp Evolution, LGPD.

## ⚠️ Convenções do repo (do CLAUDE.md)
- **Deals — fonte única:** usar `DEALS_VIEW_KEY = ['deals','list','view']` em TODOS os writes; `setQueryData` preferível a invalidate; invalidação **targeted** (nunca global).
- QA antes de push: `npm run precheck:fast` (lint + typecheck + test) — e `npm run build` pra deploy.
