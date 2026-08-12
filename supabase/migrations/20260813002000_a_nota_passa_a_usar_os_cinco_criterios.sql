-- Story 2.18b — AC3: a nota deixa de ter 1 critério e passa a ter 5.
--
-- ============================================================================
-- UMA definição dos critérios, não duas
-- ============================================================================
-- Existem dois recalculadores: `recalcular_lead_scores` (chamado pela aplicação,
-- com checagem de sessão) e `recalcular_lead_scores_de_todas_as_orgs` (chamado
-- pelo cron, sem sessão). Escrever a regra dos critérios nos dois seria criar
-- uma segunda tradução que envelhece — o defeito exato que a story 2.29 achou no
-- Realtime, onde havia TRÊS conversões banco→app e a que ficava de fora
-- entregava valor velho.
--
-- Por isso a regra mora numa VIEW e as duas funções apenas somam.

create or replace view public.v_criterios_por_deal
with (security_invoker = true) as
select
  d.id              as deal_id,
  d.organization_id,

  -- 1. Completou o roteiro com a IA.
  -- `exists` em vez de `join`: um contato pode ter mais de uma conversa, e o
  -- join multiplicaria a linha do deal, inflando a contagem sem avisar.
  case
    when exists (
      select 1 from messaging_conversations c
      join v_transferencia_da_conversa t on t.conversation_id = c.id
      where c.contact_id = d.contact_id
    ) then true
    when exists (
      select 1 from messaging_conversations c where c.contact_id = d.contact_id
    ) then false
    else null
  end as roteiro_completo,

  -- 2 a 5. Vêm do dicionário. `rotulo is null` (valor ainda não classificado) e
  -- `'indefinido'` produzem NULL — desconhecido, nunca refutado. É o AC2 da
  -- story 2.18 dentro do SQL.
  case
    when n_reside.rotulo is null or n_reside.rotulo = 'indefinido' then null
    when n_reside.rotulo = 'capital' then true
    else false
  end as cidade_de_sao_paulo,

  case
    when n_tempo.rotulo is null or n_tempo.rotulo = 'indefinido' then null
    when n_tempo.rotulo = 'menos_de_1_ano' then true
    else false
  end as lesao_recente,

  case
    when n_reab.rotulo is null or n_reab.rotulo = 'indefinido' then null
    when n_reab.rotulo = 'nunca_fez' then true
    else false
  end as sem_reabilitacao_previa,

  case
    when n_quem.rotulo is null or n_quem.rotulo = 'indefinido' then null
    when n_quem.rotulo = 'propria_pessoa' then true
    else false
  end as para_proprio_lead

from deals d
left join normalizacao_de_criterio n_reside
  on n_reside.organization_id = d.organization_id
 and n_reside.campo = 'ondeReside'
 and n_reside.chave = public.canonicalizar_valor(d.custom_fields->>'ondeReside')
left join normalizacao_de_criterio n_tempo
  on n_tempo.organization_id = d.organization_id
 and n_tempo.campo = 'haQuantoTempo'
 and n_tempo.chave = public.canonicalizar_valor(d.custom_fields->>'haQuantoTempo')
left join normalizacao_de_criterio n_reab
  on n_reab.organization_id = d.organization_id
 and n_reab.campo = 'jaFezReabilitacao'
 and n_reab.chave = public.canonicalizar_valor(d.custom_fields->>'jaFezReabilitacao')
left join normalizacao_de_criterio n_quem
  on n_quem.organization_id = d.organization_id
 and n_quem.campo = 'paraQuemE'
 and n_quem.chave = public.canonicalizar_valor(d.custom_fields->>'paraQuemE')
where d.deleted_at is null;

comment on view public.v_criterios_por_deal is
  'Story 2.18b — os 5 critérios da nota, resolvidos por deal. NULL = desconhecido, '
  'nunca refutado. Fonte única para os dois recalculadores.';

-- ============================================================================
-- Os dois recalculadores passam a somar a view
-- ============================================================================

create or replace function public.recalcular_lead_scores_de_todas_as_orgs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_afetados integer := 0;
begin
  with calculado as (
    select
      v.deal_id,
      -- Contagem de critérios que bateram e de critérios conhecidos. `count`
      -- ignora NULL, que é exatamente o comportamento desejado no denominador.
      (count(*) filter (where x.valor is true))::smallint  as score,
      (count(x.valor))::smallint                            as known,
      jsonb_build_object(
        'matched', coalesce(jsonb_agg(x.nome) filter (where x.valor is true), '[]'::jsonb),
        'refuted', coalesce(jsonb_agg(x.nome) filter (where x.valor is false), '[]'::jsonb),
        'unknown', coalesce(jsonb_agg(x.nome) filter (where x.valor is null), '[]'::jsonb),
        'origem',  'sql:cinco-criterios'
      ) as detail
    from v_criterios_por_deal v
    cross join lateral (values
      ('roteiroCompleto',       v.roteiro_completo),
      ('cidadeDeSaoPaulo',      v.cidade_de_sao_paulo),
      ('lesaoRecente',          v.lesao_recente),
      ('semReabilitacaoPrevia', v.sem_reabilitacao_previa),
      ('paraProprioLead',       v.para_proprio_lead)
    ) as x(nome, valor)
    group by v.deal_id
  )
  update deals d
     set lead_score            = case when c.known = 0 then null else c.score end,
         lead_score_known      = c.known,
         lead_score_source     = case when c.known = 0 then null else 'auto' end,
         lead_score_detail     = c.detail,
         lead_score_updated_at = now()
    from calculado c
   where d.id = c.deal_id
     and d.deleted_at is null
     -- AC4 da 2.18a: nota humana nunca é sobrescrita.
     and (d.lead_score_source is null or d.lead_score_source <> 'manual')
     -- Não reescreve card cujo resultado não mudou: o decodificador de WAL do
     -- Realtime é o maior custo deste banco.
     and (d.lead_score is distinct from (case when c.known = 0 then null else c.score end)
       or d.lead_score_known is distinct from c.known);

  get diagnostics v_afetados = row_count;
  return v_afetados;
end;
$$;

create or replace function public.recalcular_lead_scores(p_org_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_afetados integer := 0;
begin
  if not exists (
    select 1 from profiles where id = auth.uid() and organization_id = p_org_id
  ) then
    raise exception 'Unauthorized';
  end if;

  with calculado as (
    select
      v.deal_id,
      (count(*) filter (where x.valor is true))::smallint as score,
      (count(x.valor))::smallint                          as known,
      jsonb_build_object(
        'matched', coalesce(jsonb_agg(x.nome) filter (where x.valor is true), '[]'::jsonb),
        'refuted', coalesce(jsonb_agg(x.nome) filter (where x.valor is false), '[]'::jsonb),
        'unknown', coalesce(jsonb_agg(x.nome) filter (where x.valor is null), '[]'::jsonb),
        'origem',  'sql:cinco-criterios'
      ) as detail
    from v_criterios_por_deal v
    cross join lateral (values
      ('roteiroCompleto',       v.roteiro_completo),
      ('cidadeDeSaoPaulo',      v.cidade_de_sao_paulo),
      ('lesaoRecente',          v.lesao_recente),
      ('semReabilitacaoPrevia', v.sem_reabilitacao_previa),
      ('paraProprioLead',       v.para_proprio_lead)
    ) as x(nome, valor)
    where v.organization_id = p_org_id
    group by v.deal_id
  )
  update deals d
     set lead_score            = case when c.known = 0 then null else c.score end,
         lead_score_known      = c.known,
         lead_score_source     = case when c.known = 0 then null else 'auto' end,
         lead_score_detail     = c.detail,
         lead_score_updated_at = now()
    from calculado c
   where d.id = c.deal_id
     and d.deleted_at is null
     and (d.lead_score_source is null or d.lead_score_source <> 'manual')
     and (d.lead_score is distinct from (case when c.known = 0 then null else c.score end)
       or d.lead_score_known is distinct from c.known);

  get diagnostics v_afetados = row_count;
  return v_afetados;
end;
$$;
