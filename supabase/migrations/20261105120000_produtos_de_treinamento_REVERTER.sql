-- REVERSÃO da migration 20261105120000_produtos_de_treinamento.sql (story 2.64).
--
-- ⛔ NÃO É PARA RODAR junto com a migration. É o caminho de volta, lido pelo @qa
--    no papel (AC1) e executado só com decisão do Filipe.
--
-- O que desfaz, numa transação só (se qualquer passo falhar, nada muda):
--   0. GUARDA: se algum card (vivo ou excluído) tiver origemDoLead = 'LP Instituto',
--      ABORTA com mensagem clara — já houve pedido real; decidir antes.
--   1. Visão Geral: `get_metricas_de_atendimento` volta ao corpo da 2.46
--      (`20260819190000_painel_visao_geral_2_46.sql`, copiado byte a byte), com o
--      REVOKE/GRANT da 2.69.
--   2. Tira "LP Instituto" das opções de `origemDoLead` (as 5 antigas ficam na ordem).
--   3. Apaga as 4 definições de campo (`produtoDeTreinamento`, `paraQuemEOProduto`,
--      `consentimentoEm`, `consentimentoVersao`). Valores já gravados em
--      `deals.custom_fields` não são apagados (só some a definição da tela).
--   4. Apaga as 2 etapas SÓ se estiverem vazias: a FK `deals_stage_id_fkey` é
--      NO ACTION ⇒ se houver card, o banco aborta a transação inteira (mesmo
--      padrão de `20260812211500_board_ganha_coluna_clientes_REVERTER.sql`).
--      Se houver card, MOVER PRIMEIRO (decidindo com a Fernanda para onde).
--
-- As 2 etapas da loja são as últimas do quadro: apagá-las não deixa buraco na ordem.

begin;

do $guarda$
begin
  if exists (
    select 1 from public.deals
     where organization_id = '83160646-16a0-4cb7-9067-7ce7ef34ff50'
       and custom_fields->>'origemDoLead' = 'LP Instituto'
  ) then
    raise exception '2.64 REVERTER: há card com origemDoLead = LP Instituto; decidir antes de reverter';
  end if;
end;
$guarda$;

-- ============================================================================
-- 1. Função do painel — corpo da 2.46 (copiado byte a byte)
-- ============================================================================

create or replace function public.get_metricas_de_atendimento(
  p_org_id uuid,
  p_start_date timestamptz,
  p_end_date timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_chegaram          integer := 0;
  v_eu_abordei        integer := 0;
  v_chegaram_ate_mim  integer := 0;
  v_sem_resposta      integer := 0;
  v_ganhos            integer := 0;
  v_perdidos          integer := 0;
  v_total_leads       integer := 0;
  v_msgs_ia           integer := 0;
  v_msgs_pessoa       integer := 0;
  v_cobertura_desde   timestamptz;
  v_cobertura_deals   timestamptz;
  v_funil             jsonb;
begin
  -- SECURITY DEFINER ignora RLS, entao a organizacao do caller e conferida aqui.
  if not exists (
    select 1 from profiles
    where id = auth.uid() and organization_id = p_org_id
  ) then
    raise exception 'Unauthorized';
  end if;

  -- A conversa entra no periodo pela data da PRIMEIRA mensagem — que e a data em
  -- que o lead apareceu. `created_at` da conversa nao serve: a carga inicial de
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

  -- AC1 — Total de Leads = deals CRIADOS no periodo (decisao do Filipe, 19/08).
  select count(*)
  into v_total_leads
  from deals d
  where d.organization_id = p_org_id
    and d.deleted_at is null
    and d.created_at >= p_start_date
    and d.created_at <  p_end_date;

  -- AC5 — IA x pessoa por CORTE DA TRANSFERENCIA. Nao e marcacao de autoria: a
  -- origem nao distingue (ver cabecalho). Antes da transferencia, ou em conversa
  -- nunca transferida, conta como IA; depois, como a pessoa que assumiu.
  -- AC6 — retorno de ferramenta fora dos dois lados.
  select
    count(*) filter (where t.conversation_id is null or m.created_at <= t.transferida_em),
    count(*) filter (where t.conversation_id is not null and m.created_at > t.transferida_em)
  into v_msgs_ia, v_msgs_pessoa
  from messaging_messages m
  join messaging_conversations c on c.id = m.conversation_id
  left join v_transferencia_da_conversa t on t.conversation_id = m.conversation_id
  where c.organization_id = p_org_id
    and m.direction = 'outbound'
    and m.created_at >= p_start_date
    and m.created_at <  p_end_date
    and not exists (select 1 from v_mensagem_de_ferramenta f where f.message_id = m.id);

  -- AC7 — leads por estagio do funil, reagindo ao mesmo filtro de data.
  -- `btrim` no nome porque um estagio esta gravado como " Proposta enviada".
  select coalesce(jsonb_agg(x order by ordem), '[]'::jsonb)
  into v_funil
  from (
    select bs."order" as ordem,
           jsonb_build_object(
             'estagio', btrim(bs.name),
             'ordem',   bs."order",
             'leads',   count(d.id)
           ) as x
    from board_stages bs
    join boards b on b.id = bs.board_id and b.organization_id = p_org_id
    left join deals d
      on d.stage_id = bs.id
     and d.deleted_at is null
     and d.organization_id = p_org_id
     and d.created_at >= p_start_date
     and d.created_at <  p_end_date
    group by bs.id, bs.name, bs."order"
  ) s;

  -- Fechamento pela data em que fechou (`closed_at`), nao pela criacao do card.
  select
    count(*) filter (where d.is_won),
    count(*) filter (where d.is_lost)
  into v_ganhos, v_perdidos
  from deals d
  where d.organization_id = p_org_id
    and d.deleted_at is null
    and d.closed_at >= p_start_date
    and d.closed_at <  p_end_date;

  -- O painel PRECISA dizer desde quando existe dado: o CRM so passou a registrar
  -- conversa em 24/07, e um periodo anterior devolveria zero parecendo resposta.
  select min(iniciada_em) into v_cobertura_desde
  from v_origem_da_conversa
  where organization_id = p_org_id;

  -- E a cobertura de DEAL e outra, mais curta: medido em 19/08, os 491 deals vivos
  -- foram TODOS criados em agosto — a story 2.24 apagou fisicamente os de julho.
  -- Sem este campo, "Total de Leads" em julho devolve 0 parecendo medicao.
  select min(created_at) into v_cobertura_deals
  from deals
  where organization_id = p_org_id
    and deleted_at is null;

  return jsonb_build_object(
    'totalLeads',      v_total_leads,
    'chegaram',        v_chegaram,
    'euAbordei',       v_eu_abordei,
    'chegaramAteMim',  v_chegaram_ate_mim,
    'semResposta',     v_sem_resposta,
    'msgsIa',          v_msgs_ia,
    'msgsPessoa',      v_msgs_pessoa,
    'funil',           v_funil,
    'ganhos',          v_ganhos,
    'perdidos',        v_perdidos,
    'coberturaDesde',      v_cobertura_desde,
    'coberturaDealsDesde', v_cobertura_deals
  );
end;
$func$;

comment on function public.get_metricas_de_atendimento(uuid, timestamptz, timestamptz) is
  'Story 2.46 — os numeros do painel de visao geral. `totalLeads` = deals criados '
  'no periodo. `msgsIa`/`msgsPessoa` sao ESTIMATIVA pelo corte da transferencia: a '
  'origem (GPT Maker) nao marca autoria por mensagem — o discriminador existe na '
  'API v2 (`GptMakerMessage.userId`), que a rota de sync recebe e descarta (story '
  '2.47). Retorno de ferramenta nao conta como mensagem enviada.';

-- 🔒 2.69 — repetido de `20261104120000_funcoes_sem_execucao_anonima.sql`.
REVOKE ALL ON FUNCTION public.get_metricas_de_atendimento(uuid, timestamp with time zone, timestamp with time zone) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_metricas_de_atendimento(uuid, timestamp with time zone, timestamp with time zone) TO authenticated;

-- ============================================================================
-- 2. Origem
-- ============================================================================

update public.custom_field_definitions
   set options = array_remove(options, 'LP Instituto')
 where organization_id = '83160646-16a0-4cb7-9067-7ce7ef34ff50'
   and key = 'origemDoLead';

-- ============================================================================
-- 3. Campos
-- ============================================================================

delete from public.custom_field_definitions
 where organization_id = '83160646-16a0-4cb7-9067-7ce7ef34ff50'
   and key in ('produtoDeTreinamento', 'paraQuemEOProduto', 'consentimentoEm', 'consentimentoVersao');

-- ============================================================================
-- 4. Etapas (só vazias — a FK aborta se houver card)
-- ============================================================================

delete from public.board_stages
 where board_id = '5f6bded2-0f7c-418d-9598-7ea75d032242'
   and id in ('2f8091f5-90a8-4eae-bd2a-12f0d44b9517', '824878b0-2ab4-4c07-81d7-ec367b5ebd68');

commit;
