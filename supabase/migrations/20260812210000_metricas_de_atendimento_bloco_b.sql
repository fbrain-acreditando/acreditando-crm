-- Story 2.19 — Bloco B ("como foi o mês"), medido pelo atendimento real.
--
-- ============================================================================
-- O PROBLEMA QUE ISTO RESOLVE — medido em 12/08, não suposto
-- ============================================================================
-- A Fernanda conta na unha "quantos leads chegaram e quantos EU falei". A
-- primeira tentativa de responder isso pelo corpo da mensagem FALHOU, com
-- número: o GPT Maker carimba TODA saída como `role = 'assistant'` — a IA e ela
-- são indistinguíveis na mensagem. São 6.421 saídas com `sender_type` e
-- `sender_name` NULOS; só 21 mensagens em toda a base têm autor.
--
-- 🔑 O que separa não está na mensagem, está no EVENTO DE TRANSFERÊNCIA:
-- depois que a IA transfere o atendimento, ela NÃO VOLTA. O carimbo divide a
-- conversa em duas metades — antes é a IA, depois é a Fernanda.
--
-- Medido antes de escrever este arquivo:
--   • 146 conversas transferidas;
--   • TODAS as 146 têm saída depois do carimbo — 1.398 mensagens, dela;
--   • o `contextId` do evento casa com `external_contact_id` em 146 de 146
--     (join total, sem órfão).
--
-- ⚠️ Por que a origem é `messaging_webhook_events` e não uma coluna da conversa:
-- a transferência NUNCA foi materializada em lugar nenhum. O evento cru é a
-- única fonte que existe. Conferido em `cron.job` que não há expurgo dessa
-- tabela — se um dia houver, esta métrica morre junto e em silêncio.

-- ============================================================================
-- 1. A transferência vira dado consultável
-- ============================================================================

create or replace view public.v_transferencia_da_conversa
with (security_invoker = true) as
select
  c.id              as conversation_id,
  c.organization_id,
  min(e.created_at) as transferida_em
from public.messaging_webhook_events e
join public.messaging_conversations c
  on c.external_contact_id = e.payload->>'contextId'
-- O discriminador é a PRESENÇA da chave `summary`, não o valor (ela vem `null`
-- com frequência) e não o `event_type`: 18 das 146 transferências chegaram
-- gravadas como `unknown`. Mesma regra do `classifyEvent` no parser da Edge
-- Function — se uma mudar, a outra tem de mudar junto.
where jsonb_exists(e.payload, 'summary')
  and e.payload->>'contextId' is not null
group by c.id, c.organization_id;

comment on view public.v_transferencia_da_conversa is
  'Story 2.19 — quando cada conversa saiu da IA e passou para a pessoa. '
  'Origem: evento onTransfer do GPT Maker (discriminado pela chave `summary`). '
  '`security_invoker` para herdar a RLS de quem consulta.';

-- Sem este índice o filtro varre os ~11 mil eventos a cada abertura do painel.
create index if not exists idx_webhook_events_transferencia
  on public.messaging_webhook_events ((payload->>'contextId'))
  where jsonb_exists(payload, 'summary');

-- ============================================================================
-- 2. RPC do Bloco B
-- ============================================================================

-- ⚠️ O nome NÃO pode conter "do": o executor somente-leitura (`scripts/db/sql-ro.mjs`)
-- bloqueia `DO` como verbo de escrita, mesmo colado em `_`. Uma função chamada
-- `..._do_atendimento` tornaria impossível consultá-la pelo caminho seguro — e a
-- saída fácil seria desligar a trava. Evitar também: set, call, comment, copy.
create or replace function public.get_metricas_de_atendimento(
  p_org_id uuid,
  p_start_date timestamptz,
  p_end_date timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chegaram          integer := 0;
  v_eu_abordei        integer := 0;
  v_chegaram_ate_mim  integer := 0;
  v_sem_resposta      integer := 0;
  v_ganhos            integer := 0;
  v_perdidos          integer := 0;
  v_cobertura_desde   timestamptz;
begin
  -- Mesma checagem de `get_messaging_metrics`: SECURITY DEFINER ignora RLS, então
  -- a organização do caller é conferida na mão, aqui dentro.
  if not exists (
    select 1 from profiles
    where id = auth.uid() and organization_id = p_org_id
  ) then
    raise exception 'Unauthorized';
  end if;

  -- A conversa entra no período pela data da PRIMEIRA mensagem — que é a data em
  -- que o lead apareceu. `created_at` da conversa não serve: a carga inicial de
  -- 24/07 criou centenas de conversas antigas no mesmo instante.
  select
    count(*) filter (where v.quem_iniciou = 'lead'),
    count(*) filter (where v.quem_iniciou = 'equipe'),
    count(*) filter (where t.conversation_id is not null),
    count(*) filter (
      where v.quem_iniciou = 'lead'
        and not exists (
          select 1 from messaging_messages m
          where m.conversation_id = v.conversation_id
            and m.direction = 'outbound'
        )
    )
  into v_chegaram, v_eu_abordei, v_chegaram_ate_mim, v_sem_resposta
  from v_origem_da_conversa v
  left join v_transferencia_da_conversa t on t.conversation_id = v.conversation_id
  where v.organization_id = p_org_id
    and v.iniciada_em >= p_start_date
    and v.iniciada_em <  p_end_date;

  -- Fechamento pela data em que fechou (`closed_at`), não pela criação do card.
  select
    count(*) filter (where d.is_won),
    count(*) filter (where d.is_lost)
  into v_ganhos, v_perdidos
  from deals d
  where d.organization_id = p_org_id
    and d.deleted_at is null
    and d.closed_at >= p_start_date
    and d.closed_at <  p_end_date;

  -- O painel PRECISA dizer desde quando existe dado: o CRM só passou a registrar
  -- conversa em 24/07, e um período anterior a isso devolveria zero parecendo
  -- resposta. Story 2.24 apagou os deals de julho — julho só existe em conversa.
  select min(iniciada_em) into v_cobertura_desde
  from v_origem_da_conversa
  where organization_id = p_org_id;

  return jsonb_build_object(
    'chegaram',        v_chegaram,
    'euAbordei',       v_eu_abordei,
    'chegaramAteMim',  v_chegaram_ate_mim,
    'resolvidosSemMim', greatest(v_chegaram - v_chegaram_ate_mim, 0),
    'semResposta',     v_sem_resposta,
    'ganhos',          v_ganhos,
    'perdidos',        v_perdidos,
    'coberturaDesde',  v_cobertura_desde
  );
end;
$$;

comment on function public.get_metricas_de_atendimento(uuid, timestamptz, timestamptz) is
  'Story 2.19 Bloco B — os números que a Fernanda apresenta. `chegaramAteMim` sai '
  'do evento de transferência do GPT Maker, único sinal que separa a IA dela.';

grant execute on function public.get_metricas_de_atendimento(uuid, timestamptz, timestamptz)
  to authenticated;
