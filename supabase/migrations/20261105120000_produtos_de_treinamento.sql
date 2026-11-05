-- Story 2.64 — O pedido da loja que vira card da Fernanda (AC1 + AC12).
--
-- ⛔ ESCRITA, NÃO APLICADA. Aplicar só depois do gate do @qa e com OK do
--    Filipe (T2/T6), com token de gestão válido, e fazer o read-back do AC1/AC12.
--
-- 🔴 ORDEM OBRIGATÓRIA (QA A1, 05/11): ESTA MIGRATION SÓ RODA DEPOIS DO DEPLOY DA
--    `main` COM O AC18 (T10), CONFERIDO NA VERCEL. Sem o AC18 no ar, a IA de
--    preenchimento (que roda em toda transferência do WhatsApp) passa a ver os 4
--    campos novos e pode gravar `produtoDeTreinamento`/`consentimentoEm` num card
--    de reabilitação — e a Visão Geral nova tiraria esse card dos números.
--    O banco não tem como conferir o deploy da Vercel: a trava é o checklist da
--    T2 (item 0 do read-back: commit do AC18 publicado em produção).
--    Depois de aplicar: a constante `ESTAGIOS_CONHECIDOS_ACREDITANDO` do teste 8c
--    (`deal-guard.ts`) passa para 16 colunas (QA B3).
--
-- ============================================================================
-- O QUE ESTA MIGRATION FAZ
-- ============================================================================
--   1. 2 etapas novas no quadro "Acreditando": "Produtos de treinamento" (D1) e
--      "Produto vendido" (D8), com uuids FIXOS (o código usa o uuid, nunca o nome).
--   2. 4 campos novos do card (`custom_field_definitions`), com os rótulos da E3
--      ("Aviso de privacidade"; as chaves técnicas `consentimento*` ficam).
--   3. A opção "LP Instituto" no fim de `origemDoLead`.
--   4. `get_metricas_de_atendimento` (Visão Geral, 2.46) passa a ignorar cards
--      de produto em "Total de Leads", "Ganhos", "Perdidos" E no funil (D8, P3, E2).
--
-- Tudo idempotente: rodar duas vezes não muda nada.
--
-- ============================================================================
-- ⚠️ "ORDER" CALCULADO, NÃO FIXO (divergência com a story, 05/11)
-- ============================================================================
-- A story (AC1) fixava `"order"` 13 e 14, contando 13 etapas. Em 05/11 a frente
-- do remarketing de novembro criou pela tela a etapa "Campanha Novembro"
-- (`d0171b1d-…`, posição 5); o quadro passou a ter 14 etapas (order 0–13,
-- relido em produção pelo @dev em 05/11). Com 13/14 fixos, "Produtos de
-- treinamento" empataria com "Projeto Social" (13).
-- Por isso cada etapa nova entra com `max("order") + 1` do quadro NO MOMENTO da
-- migration (hoje: 14 e 15). O que importa para o comportamento é:
--   • as duas ficam DEPOIS de todas as outras;
--   • as duas ficam depois de "Qualificado" (transferência da IA só anda para
--     frente — `stage-move.ts`; o destino configurado em `lead_routing_rules`
--     é "Qualificado", order 2, relido em 05/11);
-- e a migration ABORTA se isso não valer depois do insert.
--
-- ============================================================================
-- POR QUE O CORPO DA FUNÇÃO DO PAINEL É ESTE
-- ============================================================================
-- Lido de produção em 05/11 (`pg_proc.prosrc`): md5
-- 275c1c2f717dc3d1cf0558df0edcb160, 5.063 caracteres — idêntico ao bloco
-- $func$ de `20260819190000_painel_visao_geral_2_46.sql` (pipeline 37, relido
-- pelo @dev no mesmo dia). As mudanças abaixo partem desse corpo e estão
-- marcadas com "2.64". ⚠️ Na aplicação (T6), reler o md5: se mudou, partir do
-- corpo novo e refazer.
--
-- "Card de produto" (AC12) = `produtoDeTreinamento` com valor NÃO VAZIO OU
-- `stage_id` numa das 2 etapas novas. (QA B1: só a existência da chave não serve —
-- o modal do card grava a chave vazia quando alguém escolhe e limpa o campo, e o
-- card de reabilitação sumiria dos números.) Os dois, porque: só a etapa deixaria
-- escapar o card de produto arrastado para "Perdido"/"Ganho"; só o campo
-- deixaria escapar card criado à mão na etapa. (A IA de preenchimento não grava
-- `produtoDeTreinamento` — AC18 —, então card de reabilitação não some.)
--
-- 🔒 2.69: a função é SECURITY DEFINER e roda só para `authenticated`. O
-- `CREATE OR REPLACE` mantém a assinatura e o ACL, mas o REVOKE/GRANT é
-- repetido no fim deste arquivo (teste `lib/supabase/funcoesSemExecucaoAnonima.test.ts`).

begin;

-- ============================================================================
-- 1. Etapas (AC1, D1, D8)
-- ============================================================================

insert into public.board_stages
  (id, board_id, organization_id, name, label, color, "order",
   linked_lifecycle_stage, pontua_lead, conta_como_fila, arquiva_sem_reabrir, is_default)
select
  '2f8091f5-90a8-4eae-bd2a-12f0d44b9517', '5f6bded2-0f7c-418d-9598-7ea75d032242',
  '83160646-16a0-4cb7-9067-7ce7ef34ff50', 'Produtos de treinamento', 'Produtos de treinamento',
  'bg-cyan-500',
  (select coalesce(max(bs."order"), -1) + 1 from public.board_stages bs
    where bs.board_id = '5f6bded2-0f7c-418d-9598-7ea75d032242'),
  null,   -- nunca CUSTOMER: com won_stage_id vazio, viraria "Ganho" (useMoveDeal.ts)
  false,  -- não pontua estrelas e não chama o n8n de arrastar (2.50)
  true,   -- a Fernanda precisa agir nos pedidos
  false,
  false
where not exists (
  select 1 from public.board_stages where id = '2f8091f5-90a8-4eae-bd2a-12f0d44b9517'
);

insert into public.board_stages
  (id, board_id, organization_id, name, label, color, "order",
   linked_lifecycle_stage, pontua_lead, conta_como_fila, arquiva_sem_reabrir, is_default)
select
  '824878b0-2ab4-4c07-81d7-ec367b5ebd68', '5f6bded2-0f7c-418d-9598-7ea75d032242',
  '83160646-16a0-4cb7-9067-7ce7ef34ff50', 'Produto vendido', 'Produto vendido',
  'bg-lime-500',
  (select coalesce(max(bs."order"), -1) + 1 from public.board_stages bs
    where bs.board_id = '5f6bded2-0f7c-418d-9598-7ea75d032242'),
  null,
  false,
  false,  -- venda fechada não é fila
  true,   -- categoria de arquivo, como Clientes/Profissional/Projeto Social
  false
where not exists (
  select 1 from public.board_stages where id = '824878b0-2ab4-4c07-81d7-ec367b5ebd68'
);

-- Trava: as 2 etapas existem, no quadro certo, depois de TODAS as outras e
-- depois de "Qualificado". Se não, aborta a transação inteira.
do $trava$
declare
  v_produtos integer;
  v_vendido  integer;
  v_maior_outra integer;
  v_qualificado integer;
begin
  select "order" into v_produtos from public.board_stages
   where id = '2f8091f5-90a8-4eae-bd2a-12f0d44b9517'
     and board_id = '5f6bded2-0f7c-418d-9598-7ea75d032242';
  select "order" into v_vendido from public.board_stages
   where id = '824878b0-2ab4-4c07-81d7-ec367b5ebd68'
     and board_id = '5f6bded2-0f7c-418d-9598-7ea75d032242';
  select max("order") into v_maior_outra from public.board_stages
   where board_id = '5f6bded2-0f7c-418d-9598-7ea75d032242'
     and id not in ('2f8091f5-90a8-4eae-bd2a-12f0d44b9517', '824878b0-2ab4-4c07-81d7-ec367b5ebd68');
  select "order" into v_qualificado from public.board_stages
   where id = '3b1384fa-5fe2-4725-a8e1-7576a8690637';

  if v_produtos is null or v_vendido is null then
    raise exception '2.64: etapa nova ausente ou fora do quadro Acreditando';
  end if;
  if v_produtos <= v_maior_outra or v_vendido <= v_produtos then
    raise exception '2.64: ordem das etapas novas inesperada (produtos=%, vendido=%, maior outra=%)',
      v_produtos, v_vendido, v_maior_outra;
  end if;
  if v_qualificado is not null and v_produtos <= v_qualificado then
    raise exception '2.64: "Produtos de treinamento" precisa ficar depois de "Qualificado"';
  end if;
end;
$trava$;

-- ============================================================================
-- 2. Campos do card (AC1, E3) — opções = `lib/instituto/catalogo.ts`
-- ============================================================================

insert into public.custom_field_definitions
  (key, label, type, options, entity_type, organization_id)
values
  ('produtoDeTreinamento', 'Produto de treinamento', 'select',
     array['Colete para suspensão parcial de peso', 'Luvas inclusivas', 'Bolsa impermeável',
           'Cinto de transferência', 'Faixa de joelho', 'Kit tornozeleira de tração horizontal',
           'Cinturão de musculação', 'ATS Pró'],
     'deal', '83160646-16a0-4cb7-9067-7ce7ef34ff50'),
  ('paraQuemEOProduto', 'Para quem é o produto?', 'select',
     array['Para mim', 'Para um familiar ou pessoa de quem cuido', 'Para uso profissional', 'Outro'],
     'deal', '83160646-16a0-4cb7-9067-7ce7ef34ff50'),
  ('consentimentoEm', 'Aviso de privacidade (data e hora)', 'text', null,
     'deal', '83160646-16a0-4cb7-9067-7ce7ef34ff50'),
  ('consentimentoVersao', 'Versão do aviso de privacidade', 'text', null,
     'deal', '83160646-16a0-4cb7-9067-7ce7ef34ff50')
on conflict (key, organization_id) do nothing;

-- ============================================================================
-- 3. Origem "LP Instituto" no fim de `origemDoLead` (options é text[])
-- ============================================================================

update public.custom_field_definitions
   set options = array_append(options, 'LP Instituto')
 where organization_id = '83160646-16a0-4cb7-9067-7ce7ef34ff50'
   and key = 'origemDoLead'
   and not ('LP Instituto' = any(coalesce(options, array[]::text[])));

-- ============================================================================
-- 4. Visão Geral sem cards de produto (AC12 — D8, P3, E2)
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
  -- 2.64 (AC12): as 2 etapas da loja do Instituto, por uuid.
  v_etapas_da_loja    uuid[] := array[
    '2f8091f5-90a8-4eae-bd2a-12f0d44b9517',  -- Produtos de treinamento
    '824878b0-2ab4-4c07-81d7-ec367b5ebd68'   -- Produto vendido
  ]::uuid[];
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
  -- 2.64 (D8): sem card de produto (campo OU etapa da loja). `coalesce` porque
  -- `custom_fields`/`stage_id` nulos dariam NULL e tirariam o card da conta.
  select count(*)
  into v_total_leads
  from deals d
  where d.organization_id = p_org_id
    and d.deleted_at is null
    and d.created_at >= p_start_date
    and d.created_at <  p_end_date
    and not (
      nullif(btrim(d.custom_fields->>'produtoDeTreinamento'), '') is not null
      or coalesce(d.stage_id = any(v_etapas_da_loja), false)
    );

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
  -- 2.64 (E2): sem as barras das 2 etapas da loja e sem card de produto nas
  -- barras das outras etapas (card de produto arrastado para "Perdido" não
  -- aparece na barra de "Perdido").
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
     and not (nullif(btrim(d.custom_fields->>'produtoDeTreinamento'), '') is not null)
    where bs.id <> all(v_etapas_da_loja)
    group by bs.id, bs.name, bs."order"
  ) s;

  -- Fechamento pela data em que fechou (`closed_at`), nao pela criacao do card.
  -- 2.64 (D8 + P3): Ganhos e Perdidos sem card de produto.
  select
    count(*) filter (where d.is_won),
    count(*) filter (where d.is_lost)
  into v_ganhos, v_perdidos
  from deals d
  where d.organization_id = p_org_id
    and d.deleted_at is null
    and d.closed_at >= p_start_date
    and d.closed_at <  p_end_date
    and not (
      nullif(btrim(d.custom_fields->>'produtoDeTreinamento'), '') is not null
      or coalesce(d.stage_id = any(v_etapas_da_loja), false)
    );

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
  '2.47). Retorno de ferramenta nao conta como mensagem enviada. '
  'Story 2.64: cards de produto da loja do Instituto (campo produtoDeTreinamento ou '
  'etapas "Produtos de treinamento"/"Produto vendido") ficam fora de totalLeads, '
  'ganhos, perdidos e funil.';

-- 🔒 2.69 — repetido de `20261104120000_funcoes_sem_execucao_anonima.sql`.
REVOKE ALL ON FUNCTION public.get_metricas_de_atendimento(uuid, timestamp with time zone, timestamp with time zone) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_metricas_de_atendimento(uuid, timestamp with time zone, timestamp with time zone) TO authenticated;

commit;
