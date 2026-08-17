-- Story 2.41 — a pontuação dispara na ENTRADA da coluna, não numa varredura.
--
-- ============================================================================
-- POR QUE ESTA MIGRATION EXISTE (custou R$ 197,83 para ser escrita)
-- ============================================================================
-- A story 2.35 pediu: "a IA pontua SOMENTE quando o card entrar na coluna
-- qualificado". O que subiu foi uma VIEW derivada do estado (`v_leads_a_pontuar`),
-- varrida de 5 em 5 minutos. Card que FALHA não recebe carimbo e não conta
-- tentativa ⇒ volta na rodada seguinte, para sempre:
--
--   12 rodadas/hora × 24h = 288 rodadas/dia × 10 cards = 2.880 chamadas/dia
--   O Google mediu ~3.000/dia, de 13/08 (data do cron) a 16/08 02:00 (chave apagada).
--
-- O comentário da 2.35 defendia o defeito como virtude: "uma falha se auto-corrige
-- na rodada seguinte". Sem contador de tentativas, "auto-corrigir" e "reprocessar
-- para sempre" são a mesma frase.
--
-- ============================================================================
-- POR QUE O GATILHO VAI NO BANCO, E NÃO NO CÓDIGO
-- ============================================================================
-- O pedido tem duas metades — "a IA qualificou OU a Fernanda arrastou" — e na
-- prática há mais de duas portas: tela, `moveOnQualified` (T3 da 2.17), HITL/agente,
-- 4 webhooks de canal, API pública v1 e ferramentas MCP. Um gatilho no código
-- precisaria ser plugado em 8+ lugares, e o 9º caminho esqueceria — foi essa
-- dificuldade real que fez a 2.35 escolher varredura.
--
-- Todas as portas terminam no MESMO lugar: um UPDATE de `deals.stage_id`.
-- É lá que o gatilho tem de morar.

-- ============================================================================
-- 1. A fila — persistente, com contador de tentativas
-- ============================================================================
-- Espelha `ai_pending_evaluations` (migration 20260409130000), que já drena pelo
-- cron irmão e PARA após 3 tentativas. Dois crons irmãos e só um tinha a trava;
-- esta migration leva o padrão que funciona para o que não o tinha.
create table if not exists public.ai_pending_lead_scores (
  id               uuid        primary key default gen_random_uuid(),
  organization_id  uuid        not null references organizations(id) on delete cascade,
  deal_id          uuid        not null references deals(id) on delete cascade,
  -- Por que o card entrou na fila. Diagnóstico: distinguir o trigger do backfill
  -- evita a pergunta "isto veio de onde?" na primeira vez que a fila encher.
  origem           text        not null default 'trigger'
                               check (origem in ('trigger', 'backfill')),
  status           text        not null default 'pending'
                               check (status in ('pending', 'processing', 'completed', 'failed')),
  attempts         integer     not null default 0,
  last_error       text,
  created_at       timestamptz not null default now(),
  processed_at     timestamptz
);

comment on table public.ai_pending_lead_scores is
  'Story 2.41 — fila de pontuação por IA, alimentada pelo TRIGGER de entrada em '
  'estágio com pontua_lead. Substitui a varredura de `v_leads_a_pontuar`, que '
  'reprocessava card com falha indefinidamente (R$ 197,83 em 3 dias). '
  'Drenada por /api/cron/pontuar-leads; para após 3 tentativas.';

comment on column public.ai_pending_lead_scores.attempts is
  'Tentativas de processamento. Máximo 3, depois vira `failed` e SAI da fila. '
  'É esta coluna que não existia — e é ela que impede o laço infinito.';

comment on column public.ai_pending_lead_scores.last_error is
  'Motivo da última falha. Antes disso só existia console.error, que ninguém lê '
  'em produção — foi esse silêncio que escondeu o problema por 3 dias.';

-- FIFO para o cron: só o que está pendente, mais antigo primeiro.
-- ⚠️ A varredura antiga NÃO tinha ORDER BY: os mesmos ~10 cards envenenados
-- ocupavam todas as rodadas e os outros 20 nunca eram tentados.
create index if not exists idx_pending_lead_scores_fila
  on public.ai_pending_lead_scores (created_at)
  where status = 'pending';

-- AC4 — no máximo UM item pendente por deal. Arrastar para fora e de volta
-- várias vezes gera uma avaliação, não uma por arrasto.
create unique index if not exists uq_pending_lead_scores_deal_pendente
  on public.ai_pending_lead_scores (deal_id)
  where status = 'pending';

-- ============================================================================
-- 2. RLS
-- ============================================================================
-- ⚠️ DIFERENÇA DELIBERADA da tabela irmã: `ai_pending_evaluations` usa
-- FORCE ROW LEVEL SECURITY porque só o service-role escreve nela (e service-role
-- tem BYPASSRLS). Aqui quem escreve é um TRIGGER, que roda no contexto de quem
-- arrastou o card — inclusive a Fernanda, autenticada. FORCE bloquearia até o
-- owner e o INSERT do trigger falharia, calado, exatamente como o log de tokens
-- falhou por meses (story 2.9/2.10). Por isso: ENABLE sem FORCE, e o trigger é
-- SECURITY DEFINER.
alter table public.ai_pending_lead_scores enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename  = 'ai_pending_lead_scores'
       and policyname = 'Org members can read own pending lead scores'
  ) then
    create policy "Org members can read own pending lead scores"
      on public.ai_pending_lead_scores for select to authenticated
      using (
        organization_id in (
          select organization_id from profiles where id = auth.uid()
        )
      );
  end if;
end;
$$;

-- ============================================================================
-- 3. O gatilho de entrada
-- ============================================================================
-- SECURITY DEFINER: ver a nota de RLS acima. `search_path` fixo porque função
-- SECURITY DEFINER sem search_path é vetor de escalada de privilégio.
create or replace function public.enfileirar_pontuacao_do_lead()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pontua boolean;
begin
  -- Card excluído não entra na fila (story 2.25 — soft delete).
  if new.deleted_at is not null then
    return new;
  end if;

  -- AC4 — quem a IA já leu não é relido, e nota manual é intocável (AC3 da 2.35).
  if new.pontuada_pela_ia_em is not null then
    return new;
  end if;
  if new.lead_score_source = 'manual' then
    return new;
  end if;

  -- O estágio de destino manda pontuar? Por COLUNA, nunca por nome — o board já
  -- foi renomeado uma vez (story 2.33) e casar por nome falhou calado.
  select s.pontua_lead into v_pontua
    from board_stages s
   where s.id = new.stage_id;

  if coalesce(v_pontua, false) is not true then
    return new;
  end if;

  -- ON CONFLICT DO NOTHING cobre o índice único parcial: se já existe item
  -- pendente para este deal, não duplica.
  insert into public.ai_pending_lead_scores (organization_id, deal_id, origem)
  values (new.organization_id, new.id, 'trigger')
  on conflict do nothing;

  return new;
end;
$$;

comment on function public.enfileirar_pontuacao_do_lead() is
  'Story 2.41 — enfileira o card ao ENTRAR em estágio com pontua_lead. Cobre '
  'TODOS os caminhos (tela, IA/HITL, moveOnQualified, webhooks, API pública, MCP) '
  'porque todos terminam no mesmo UPDATE de deals.stage_id.';

-- Dois triggers, de propósito:
--
--  • UPDATE OF stage_id  → só dispara quando ESSA coluna é escrita. Um UPDATE de
--    qualquer outro campo (a Fernanda salvando uma observação) não pode gerar
--    pontuação — e `IS DISTINCT FROM` garante que reescrever o MESMO stage_id
--    também não gera (AC1).
--
--  • INSERT → card que nasce já em `Qualificado` (import, API pública) também
--    precisa ser pontuado. Sem este, essa porta ficaria de fora — o mesmo tipo
--    de buraco que a 2.35 tentava evitar.
drop trigger if exists trg_enfileirar_pontuacao_update on public.deals;
create trigger trg_enfileirar_pontuacao_update
  after update of stage_id on public.deals
  for each row
  when (old.stage_id is distinct from new.stage_id)
  execute function public.enfileirar_pontuacao_do_lead();

drop trigger if exists trg_enfileirar_pontuacao_insert on public.deals;
create trigger trg_enfileirar_pontuacao_insert
  after insert on public.deals
  for each row
  execute function public.enfileirar_pontuacao_do_lead();

-- ============================================================================
-- 4. A VIEW deixa de ser fila e passa a ser DIAGNÓSTICO
-- ============================================================================
-- Não é dropada: o aplicador de migrações recusa qualquer DROP de propósito
-- (documentado na 20260813010000), e contornar a trava seria repetir o erro que
-- este repo registra desde 11/08 — quando a ferramenta de segurança incomoda, a
-- saída fácil é desligá-la.
--
-- A definição continua a MESMA. O que muda é quem a usa: o cron passa a ler a
-- tabela de fila. Ela fica como resposta à pergunta "algum card ficou sem nota?"
-- — que é justamente o que precisa ser visível quando um item vira `failed`.
--
-- ⚠️ Uma fonte só para o TRABALHO. Duas fontes para o mesmo número é o defeito
-- que a story 2.29 passou o dia consertando.
comment on view public.v_leads_a_pontuar is
  'Story 2.41 — NÃO É MAIS A FILA DO CRON. Passou a ser painel de diagnóstico: '
  'cards em estágio de pontuação ainda sem nota da IA (inclui os que viraram '
  '`failed` na fila `ai_pending_lead_scores`). A fila de trabalho é aquela tabela, '
  'alimentada pelo trigger de entrada. Ler esta view NÃO deve disparar IA.';

-- ============================================================================
-- 5. Backfill único e LIMITADO (AC6)
-- ============================================================================
-- O trigger só pega movimento FUTURO. Os cards que já estão parados em
-- `Qualificado` sem nota (30, medidos em 16/08) nunca seriam pontuados.
--
-- ⚠️ LIMITE EXPLÍCITO: sem ele, um board grande viraria rajada de chamadas de IA
-- na primeira rodada depois de repor a chave — o oposto do objetivo desta story.
-- Eles entram na MESMA fila, então herdam o teto de 3 tentativas.
do $$
declare
  v_limite    constant integer := 50;
  v_inseridos integer;
begin
  with elegiveis as (
    select organization_id, deal_id
      from public.v_leads_a_pontuar
     order by deal_id
     limit v_limite
  )
  insert into public.ai_pending_lead_scores (organization_id, deal_id, origem)
  select organization_id, deal_id, 'backfill' from elegiveis
  on conflict do nothing;

  get diagnostics v_inseridos = row_count;
  raise notice 'Story 2.41 — backfill enfileirou % card(s) (limite %).', v_inseridos, v_limite;

  if v_inseridos = v_limite then
    raise notice 'Story 2.41 — ATENÇÃO: o limite foi atingido. Há cards elegíveis FORA da fila; rodar o backfill de novo depois de conferir o custo.';
  end if;
end;
$$;
