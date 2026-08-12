-- Story 2.35 — a IA passa a ser a fonte da nota, e só em estágio de qualificação.
--
-- ============================================================================
-- O QUE PARA DE VALER
-- ============================================================================
-- A nota deixa de ser calculada por regra SQL sobre campo extraído (stories
-- 2.18a/2.18b) e passa a vir da IA lendo a CONVERSA. Duas fontes para o mesmo
-- número é o defeito que a story 2.29 passou o dia consertando — então o cron
-- sai de cena, e não fica "como piso".
--
-- O dicionário da 2.18b CONTINUA: ele deixa de alimentar a nota e passa a servir
-- só o painel da story 2.19, que precisa de "SP × fora" para TODOS os leads e
-- não só para os qualificados.

-- ============================================================================
-- 1. Qual estágio pontua — por COLUNA, nunca por nome
-- ============================================================================
-- O board foi renomeado hoje (story 2.33) e a 2.33 já registrou que casar por
-- nome falha calado (`Em qualificação ` tinha espaço no fim). Uma coluna
-- explícita sobrevive a renomeação e deixa a decisão visível no schema.
alter table public.board_stages
  add column if not exists pontua_lead boolean not null default false;

comment on column public.board_stages.pontua_lead is
  'Story 2.35 — ao entrar neste estágio, o lead é pontuado pela IA.';

update public.board_stages
   set pontua_lead = true
 where name = 'Qualificado'
   and pontua_lead = false;

-- ============================================================================
-- 2. Quando a IA pontuou — um CARIMBO, não um valor novo em `lead_score_source`
-- ============================================================================
-- 🛑 A primeira versão desta migração acrescentava `'ia'` ao CHECK de
-- `lead_score_source`, e para isso precisava de `drop constraint`. O aplicador
-- de migrações RECUSOU: ele bloqueia qualquer `DROP` de propósito.
--
-- A trava é grosseira para este caso (trocar um CHECK não perde dado), mas
-- contorná-la seria repetir o erro que este repo documenta desde 11/08: quando a
-- ferramenta de segurança incomoda, a saída fácil é desligá-la.
--
-- 🎁 E o redesenho ficou MELHOR que o original: em vez de um rótulo a mais, um
-- CARIMBO DE TEMPO. Ele responde "já foi pontuada?" (AC4) e ainda diz QUANDO,
-- que o rótulo não dizia. `lead_score_source` segue com o significado que sempre
-- teve — `auto` = o sistema calculou, `manual` = a pessoa decidiu.
alter table public.deals
  add column if not exists pontuada_pela_ia_em timestamptz;

comment on column public.deals.pontuada_pela_ia_em is
  'Story 2.35 — quando a IA leu a conversa e pontuou este lead. NULL = ainda não '
  'pontuada, e é isso que a põe na fila `v_leads_a_pontuar`.';

-- ============================================================================
-- 3. O cron para de escrever nota
-- ============================================================================
do $$
begin
  if exists (select 1 from cron.job where jobname = 'recalcular-lead-score') then
    perform cron.unschedule('recalcular-lead-score');
  end if;
end;
$$;

-- Rede de segurança: mesmo que alguém chame as funções à mão, elas não podem
-- desfazer o trabalho da IA nem o da Fernanda. Antes elas puliam só `manual`.
create or replace function public.recalcular_lead_scores_de_todas_as_orgs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Story 2.35: a pontuação saiu do SQL e foi para a IA. A função continua
  -- existindo para não quebrar chamador antigo, mas não escreve mais nada.
  -- Apagá-la exigiria DROP, que o aplicador de migração recusa de propósito.
  return 0;
end;
$$;

create or replace function public.recalcular_lead_scores(p_org_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from profiles where id = auth.uid() and organization_id = p_org_id
  ) then
    raise exception 'Unauthorized';
  end if;

  -- Idem: neutralizada pela story 2.35.
  return 0;
end;
$$;

-- ============================================================================
-- 4. A fila de pontuação
-- ============================================================================
-- Não é tabela de fila: é uma VIEW sobre o estado do board. Card entra na fila
-- por ESTAR em estágio de pontuação sem nota da IA — então todo caminho de
-- entrada conta (transferência automática, arrasto da Fernanda, edição), e uma
-- falha de processamento se auto-corrige na rodada seguinte.
create or replace view public.v_leads_a_pontuar
with (security_invoker = true) as
select
  d.id              as deal_id,
  d.organization_id,
  d.contact_id,
  d.stage_id
from deals d
join board_stages s on s.id = d.stage_id
where d.deleted_at is null
  and s.pontua_lead
  -- AC4: não repontua quem a IA já leu.
  and d.pontuada_pela_ia_em is null
  -- AC3: nota manual é intocável.
  and (d.lead_score_source is null or d.lead_score_source <> 'manual');

comment on view public.v_leads_a_pontuar is
  'Story 2.35 — cards que estão em estágio de pontuação e ainda não têm nota da '
  'IA. Fila derivada do ESTADO, não de evento.';

create index if not exists idx_deals_a_pontuar
  on public.deals (stage_id, pontuada_pela_ia_em)
  where deleted_at is null;
