-- Story 2.46 — O painel de visao geral que bate.
--
-- Contexto medido em 19/08 (banco de producao), que mudou o escopo do pedido:
--   * nao existe atribuicao de anuncio (5 canais `whatsapp`, tabela `leads` vazia,
--     `contacts.source` com valor unico) => "Leads Anuncio" virou
--     "Leads que chegaram no WhatsApp";
--   * 8.355 de 8.386 mensagens de saida tem `sender_type` NULL, e ZERO sao `ai`.
--     A Fernanda responde DENTRO do GPT Maker, onde a mensagem dela chega com o
--     mesmo `role: assistant` e o mesmo `assistantId` da IA — comparacao de payload
--     antes x depois da transferencia: identicos. A separacao aqui e ESTIMATIVA
--     pelo corte da transferencia, e o card declara isso na tela (AC5);
--   * 221 "mensagens de saida" sao retorno interno de ferramenta da IA.

-- ============================================================================
-- 1. Retorno de ferramenta deixa de contar como mensagem enviada
-- ============================================================================
-- O discriminador e `role = 'tool'` no evento de origem, NAO o texto. Casar por
-- texto ("sucesso, diga que a transferencia...") acha 205; o join pelo id de
-- mensagem acha 221 — 16 escapariam de um filtro de string.

create index if not exists idx_webhook_events_tool_message
  on public.messaging_webhook_events ((payload->>'messageId'))
  where payload->>'role' = 'tool';

create or replace view public.v_mensagem_de_ferramenta
with (security_invoker = true) as
select distinct m.id as message_id
from public.messaging_messages m
join public.messaging_webhook_events e
  on e.payload->>'messageId' = m.metadata->>'gptmaker_message_id'
where e.payload->>'role' = 'tool';

comment on view public.v_mensagem_de_ferramenta is
  'Story 2.46 — mensagens que sao retorno interno de ferramenta da IA, nao texto '
  'enviado ao lead. O parser do GPT Maker manda tudo que nao e `role: user` para '
  '`outbound`, entao o retorno de funcao virou "mensagem enviada". Nao contar.';

-- ============================================================================
-- 2. RPC do painel — novos numeros, e o `resolvidosSemMim` sai
-- ============================================================================
-- `resolvidosSemMim` era `greatest(chegaram - chegaramAteMim, 0)`: subtracao, nao
-- medicao. Dos 593 que ele reportava, 57 nunca receberam UMA resposta — o card
-- contava abandono como sucesso da IA. Removido por decisao do Filipe (AC8).
--
-- O nome da funcao nao pode conter "do"/"set"/"call"/"comment"/"copy": o executor
-- somente-leitura (`scripts/db/sql-ro.mjs`) os bloqueia como verbo de escrita,
-- mesmo colados em `_`.
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
