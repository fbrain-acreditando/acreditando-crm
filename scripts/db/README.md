# `scripts/db/` — acesso direto ao banco de produção

> **Por que esta pasta existe.** Em 10/08 foi construído um "executor somente-leitura" que ficou
> registrado no `00-CONTEXTO-SESSAO-RETOMAR-AQUI.md` como **controle de segurança** — e ele
> **nunca foi salvo em lugar nenhum**. Viveu numa pasta temporária e morreu com a sessão. Em 11/08
> precisou ser reescrito de memória.
>
> 🔑 **Um controle reconstruído de memória vale o que quem o reconstrói lembrar.** A versão de 11/08
> só cobriu o furo conhecido (`cron.alter_job` passando por leitura, porque `_` conta como letra)
> **porque alguém leu o registro do dia anterior**. Sem isso, teria nascido com o mesmo furo.
> Estes arquivos existem para que isso não dependa mais de memória.

---

## Credenciais — não estão aqui, de propósito

Todos os scripts leem o token de **fora do repositório**:

```
C:\Users\filip_mg5w2c4\.credenciais\supabase-crm-mgmt.token
```

Nenhum arquivo desta pasta contém segredo literal. O que está no código é o **ref do projeto**
(`jmjhtprnxjffaqhdzfmc`), que já é público no contexto do repo.

---

## O que é reutilizável

### `sql-ro.mjs` — executor SOMENTE-LEITURA ⭐

```bash
node scripts/db/sql-ro.mjs "select count(*) from deals"
```

Bloqueia verbo de escrita **antes de a query sair da máquina**. Duas travas:

1. a query tem de **começar** com `SELECT` ou `WITH`;
2. nenhum verbo de escrita pode aparecer, **inclusive colado em `_` ou `.`**.

⚠️ **A segunda trava existe por causa de um furo real:** a versão anterior bloqueava `\bALTER\b`, e o
comando era `select cron.alter_job(...)` — onde `_` conta como letra, então **não casava**. A escrita
teria passado disfarçada de leitura.

🪤 **Ele produz falso positivo, e isso é o desenho, não defeito.** Já barrou `SELECT`s legítimos
porque a *coluna* se chamava `delete_rule` e porque um *alias* era `soft_delete`. **Errar para o lado
de bloquear é o lado certo de errar** — renomeie o alias e siga.

### `RESTAURAR.mjs` — restaurador genérico de backup de `deals`

```bash
node scripts/db/RESTAURAR.mjs <pasta-do-backup>                # DRY-RUN
node scripts/db/RESTAURAR.mjs <pasta-do-backup> --eu-autorizo  # escreve
```

Usa `jsonb_populate_recordset`, então o **Postgres** reconstrói cada coluna com o tipo original
(jsonb, arrays, timestamptz). Montar `INSERT` à mão erraria em algum campo, e o erro só apareceria
**no dia em que fosse preciso restaurar**.

> 📌 Uma cópia deste arquivo vive **junto de cada backup**, em `.dados-leads\`. Backup sem
> restaurador não é backup.

### `ensaio-ciclo.mjs` — ensaio de `DELETE` + restauração, abortado pelo Postgres

Roda **apaga → restaura do arquivo → reconta** dentro de `DO $$ … RAISE EXCEPTION $$`.

⚠️ **Não use `BEGIN/ROLLBACK` solto** para isto: se o transporte HTTP não honrar a transação, o
`DELETE` **persiste**. O `RAISE EXCEPTION` aborta **no próprio banco**.

🔑 **Ele prova a volta, não só a ida.** O primeiro dry-run escrito para esta operação passava sem
testar nada — o `ON CONFLICT DO NOTHING` pulava todas as linhas porque elas ainda existiam.
*Teste que passa sem exercitar o caminho é teste que mente.*

---

## O que é histórico — leia, **não rode**

Estes rodaram **uma vez**, em 11/08. Ficam como **registro do que foi feito** e como **modelo** de um
procedimento de escrita seguro (remedir → ensaiar → escrever → read-back).

| Arquivo | O que fez | Story |
|---|---|---|
| `backup-julho.mjs` | Backup dos 431 deals de julho + 11 activities + âncoras | 2.24 |
| `apagar-julho.mjs` | 🔴 `DELETE` dos 431 deals de julho. **Irreversível** | 2.24 |
| `normalizar-motivos.mjs` | 5 grafias de "distância" → `Distância` | 2.26 |

🛑 **`apagar-julho.mjs` apaga `deals` com `deleted_at IS NOT NULL`.** Hoje isso é **0 linhas** — mas
volta a ter alvo assim que alguém excluir um card pela tela. Ele exige `--eu-autorizo` e **remede o
alvo antes de escrever**, abortando se divergir do backup. Ainda assim: **não é ferramenta de rotina.**

---

## O contrato, se você for escrever algo novo aqui

Nasceu de operações reais nesta base, e cada item custou um erro:

1. **Remedir imediatamente antes de escrever.** A base é viva — foi de 707 para 724 deals em 24 h, e
   de 11 para 12 leads perdidos no meio de uma única operação.
2. **Backup antes, com contagem conferida contra o banco** — e o restaurador salvo **junto**.
3. **Ensaiar num bloco que o Postgres aborta**, nunca confiando na camada de rede.
4. **Escrita exige `--eu-autorizo` explícito** em toda chamada.
5. **Read-back depois — com um predicado que consegue estar errado.** 🪤 Um read-back desta série
   *mentiu*: perguntou `lower(btrim(loss_reason)) in ('distância','distãncia')` e acusou "5 variantes
   antigas restantes" — o predicado casava com o **próprio valor canônico** em minúsculo.
   **A trava não é reler; é reler com uma pergunta capaz de reprovar.**
