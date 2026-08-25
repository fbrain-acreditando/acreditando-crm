-- Story 2.48 — a fila que ABRE: filtro por etapa do funil e a lista de quem espera.
--
-- ============================================================================
-- DE ONDE VEIO O PEDIDO
-- ============================================================================
-- Reunião de 21/08 com a Fernanda. Eu levava duas opções para o card "Esperando
-- minha resposta" — contar *"conversas abertas"* ou *"conversas que exigem ação
-- minha"*. Ela não escolheu nenhuma das duas:
--
--   "eu vou colocar esperando em resposta, só que aí eu vou fazer uns filtros…
--    só quem tá em primeiro atendimento ou que tá em alguma outras fases do
--    funil. E aí na hora que você clicar aqui, você vai ver quem são as pessoas"
--   "Ah, boa. Porque eu fico tentando adivinhar."
--
-- 📌 O incômodo nunca foi a CONTAGEM — era não conseguir AGIR a partir do
--    número. Um número que não abre não vira trabalho, vira adivinhação.
--
-- ============================================================================
-- O QUE ESTA MIGRATION FAZ (e o que deliberadamente NÃO faz)
-- ============================================================================
--   1. `board_stages.conta_como_fila` — a etapa entra na fila de trabalho? Por
--      COLUNA, nunca por nome (lição da story 2.33: o board já foi renomeado e
--      casar por nome falhou calado).
--   2. `get_fila_de_atendimento` passa a devolver TAMBÉM os números filtrados,
--      sem tirar os antigos — nenhum chamador quebra.
--   3. `get_lista_da_fila` — a lista. É o clique.
--
-- ❌ NÃO classifica intenção. Medido em 24/08: mesmo DENTRO do funil, a última
--    mensagem ainda é cortesia de encerramento em boa parte ("Ok obrigada",
--    "Perfeito", "Valeu") no mesmo balde que "Me explica", "Telefone" e
--    "qto custa". Filtrar por etapa NÃO separa por intenção — são dois
--    problemas, e misturá-los numa story só entregaria os dois pela metade.
--    A lista traz o TEXTO REAL justamente por isso: ela lê "Ok obrigada" e
--    resolve em um segundo, sem nenhum modelo no meio.
--
-- ============================================================================
-- MEDIÇÃO QUE JUSTIFICA CADA ESCOLHA (24/08, produção)
-- ============================================================================
-- A fila tem 92 conversas esperando. Por etapa:
--   (sem card) 23 · Contato Realizado 2 · Qualificado 43 · Apresentação 6 ·
--   Aguardando retorno 5 · Ganho 1 · Perdido 11 · Profissional 1
-- ⇒ o filtro do funil ativo leva 92 → 56.
--
-- Os 23 SEM CARD: 22 foram criadas entre 26 e 31/07 (a janela da importação
-- inicial do CRM) e 1 em 16/08. Nenhuma nova desde então ⇒ é resíduo de
-- migração, não torneira aberta. Entram na lista MARCADAS, porque são conversas
-- reais esperando resposta — e a etiqueta é o que faz a Fernanda cadastrá-las.

-- ============================================================================
-- 1. A etapa conta como fila de trabalho?
-- ============================================================================
alter table public.board_stages
  add column if not exists conta_como_fila boolean not null default true;

comment on column public.board_stages.conta_como_fila is
  'Story 2.48 — a etapa faz parte da fila de trabalho da atendente? Ganho, '
  'Perdido e as colunas de categoria (Clientes, Profissional, Projeto Social) '
  'são FALSE: quem está lá não espera resposta. Default TRUE para que etapa '
  'nova nasça visível — esquecer de marcar deve fazer aparecer a mais, nunca a '
  'menos. Filtrar por COLUNA e não por nome é a lição da story 2.33.';

-- Backfill SEMÂNTICO — sem citar nome de coluna nenhuma:
--   • `arquiva_sem_reabrir` já marca as três colunas de categoria (story 2.34);
--   • `CUSTOMER` = ganho e `OTHER` = perdido no ciclo de vida do fork.
-- Idempotente: rodar de novo não muda nada.
update public.board_stages
   set conta_como_fila = false
 where (arquiva_sem_reabrir is true
        or linked_lifecycle_stage in ('CUSTOMER', 'OTHER'))
   and conta_como_fila is true;

-- ============================================================================
-- 2. Os números — os antigos ficam, os novos entram ao lado
-- ============================================================================
-- ⚠️ Por que NÃO trocar `esperandoPorMim` pelo número filtrado: ele já circulou
--    em reunião. Trocar o significado de uma chave que já foi vista, mantendo o
--    nome, é a receita para alguém comparar o número de hoje com o de ontem e
--    concluir que a fila caiu 39%. Chave nova, significado novo.
create or replace function public.get_fila_de_atendimento(
  p_org_id uuid,
  p_horas_sem_resposta integer default 24
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transferidas          integer := 0;
  v_esperando_por_mim     integer := 0;
  v_passou_do_limite      integer := 0;
  v_esperando_no_funil    integer := 0;
  v_passou_no_funil       integer := 0;
  v_fora_do_funil         integer := 0;
  v_sem_card              integer := 0;
  v_prontos_para_ligar    integer := 0;
  v_pontuados_pela_ia     integer := 0;
  v_cards_vivos           integer := 0;
begin
  -- SECURITY DEFINER ignora RLS ⇒ a organização do caller é conferida na mão.
  if not exists (
    select 1 from profiles
    where id = auth.uid() and organization_id = p_org_id
  ) then
    raise exception 'Unauthorized';
  end if;

  with base as (
    select
      f.conversation_id,
      f.direcao_da_ultima,
      f.ultima_mensagem_em,
      s.conta_como_fila,
      d.id as deal_id
    from v_fila_de_atendimento f
    join messaging_conversations c on c.id = f.conversation_id
    -- LEFT: 23 conversas da fila não têm card nenhum (medido em 24/08). Um JOIN
    -- interno as apagaria da conta em silêncio — o defeito exato que a story
    -- 2.19 cometeu do outro lado.
    left join deals d
      on d.contact_id = c.contact_id
     and d.deleted_at is null
    left join board_stages s on s.id = d.stage_id
    where f.organization_id = p_org_id
  ),
  esperando as (
    select * from base where direcao_da_ultima = 'inbound'
  )
  select
    (select count(*) from base),
    (select count(*) from esperando),
    (select count(*) from esperando
      where ultima_mensagem_em < now() - make_interval(hours => p_horas_sem_resposta)),
    -- No funil = tem card E a etapa conta como fila.
    (select count(*) from esperando where deal_id is not null and conta_como_fila is true),
    (select count(*) from esperando
      where deal_id is not null and conta_como_fila is true
        and ultima_mensagem_em < now() - make_interval(hours => p_horas_sem_resposta)),
    -- Fora do funil = tem card, mas a etapa não conta (Ganho, Perdido, categorias).
    (select count(*) from esperando where deal_id is not null and conta_como_fila is false),
    (select count(*) from esperando where deal_id is null)
  into
    v_transferidas, v_esperando_por_mim, v_passou_do_limite,
    v_esperando_no_funil, v_passou_no_funil, v_fora_do_funil, v_sem_card;

  -- "Pronto para ligar" — inalterado pela 2.48.
  select
    count(*) filter (
      where d.lead_score_detail->'matched' @> '["cidadeDeSaoPaulo"]'
        and d.lead_score_detail->'matched' @> '["roteiroCompleto"]'
    ),
    count(*) filter (where d.pontuada_pela_ia_em is not null),
    count(*)
  into v_prontos_para_ligar, v_pontuados_pela_ia, v_cards_vivos
  from deals d
  where d.organization_id = p_org_id
    and d.deleted_at is null;

  return jsonb_build_object(
    'transferidas',           v_transferidas,
    'esperandoPorMim',        v_esperando_por_mim,
    'passouDoLimite',         v_passou_do_limite,
    'horasDoLimite',          p_horas_sem_resposta,
    -- Story 2.48 — os números que a Fernanda pediu.
    'esperandoNoFunil',       v_esperando_no_funil,
    'passouDoLimiteNoFunil',  v_passou_no_funil,
    'foraDoFunil',            v_fora_do_funil,
    'semCard',                v_sem_card,
    'prontosParaLigar',       v_prontos_para_ligar,
    'pontuadosPelaIa',        v_pontuados_pela_ia,
    'cardsVivos',             v_cards_vivos
  );
end;
$$;

comment on function public.get_fila_de_atendimento(uuid, integer) is
  'Story 2.48 — os números da fila. `esperandoPorMim` segue sendo a fila '
  'INTEIRA (a chave já circulou em reunião e não pode mudar de significado); '
  '`esperandoNoFunil` é o recorte que a Fernanda pediu em 21/08. A diferença '
  'entre os dois é `foraDoFunil` + `semCard`, ambos devolvidos para que a tela '
  'possa explicar o desconto em vez de escondê-lo.';

-- ============================================================================
-- 3. A LISTA — é isto que o clique abre
-- ============================================================================
-- ⚠️ O nome não pode conter `do`, `set`, `call`, `comment` nem `copy`: o
--    executor somente-leitura (`scripts/db/sql-ro.mjs`) bloqueia esses verbos
--    mesmo colados em `_`. `da`/`de` são seguros. (Lição registrada na 2.19.)
create or replace function public.get_lista_da_fila(
  p_org_id uuid,
  p_horas_sem_resposta integer default 24,
  p_apenas_funil boolean default true,
  p_inclui_sem_card boolean default true,
  p_limite integer default 200
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lista jsonb;
begin
  if not exists (
    select 1 from profiles
    where id = auth.uid() and organization_id = p_org_id
  ) then
    raise exception 'Unauthorized';
  end if;

  -- Teto explícito: 92 hoje, mas a fila cresce. Uma lista sem teto vira uma
  -- resposta de megabytes no dia em que ninguém estiver olhando.
  p_limite := least(greatest(coalesce(p_limite, 200), 1), 500);

  with base as (
    select
      f.conversation_id,
      f.ultima_mensagem_em,
      c.contact_id,
      c.external_contact_name,
      d.id     as deal_id,
      s.name   as etapa,
      s."order" as ordem,
      s.conta_como_fila
    from v_fila_de_atendimento f
    join messaging_conversations c on c.id = f.conversation_id
    left join deals d
      on d.contact_id = c.contact_id
     and d.deleted_at is null
    left join board_stages s on s.id = d.stage_id
    where f.organization_id = p_org_id
      and f.direcao_da_ultima = 'inbound'
  ),
  filtrada as (
    select * from base
    where
      case
        -- Sem card não tem etapa: quem decide é o parâmetro próprio, nunca o
        -- filtro de funil — senão 23 pessoas somem por um efeito colateral.
        when deal_id is null then p_inclui_sem_card
        when p_apenas_funil  then conta_como_fila is true
        else true
      end
  ),
  -- A última mensagem DO LEAD, que é a que está esperando resposta.
  ultima as (
    select distinct on (m.conversation_id)
      m.conversation_id,
      m.content_type,
      left(
        coalesce(m.content->>'text', m.content->>'caption', ''),
        180
      ) as texto
    from messaging_messages m
    where m.conversation_id in (select conversation_id from filtrada)
      and m.direction = 'inbound'
    order by m.conversation_id, m.created_at desc
  )
  select coalesce(jsonb_agg(item order by (item->>'horasEsperando')::numeric desc), '[]'::jsonb)
    into v_lista
  from (
    select jsonb_build_object(
      'conversationId',  f.conversation_id,
      'contactId',       f.contact_id,
      'dealId',          f.deal_id,
      -- O nome do contato vem de `contacts`; o do provedor é o fallback, porque
      -- 52% da base está salva com o apelido do WhatsApp (medido na story 2.45).
      'nome',            coalesce(nullif(ct.name, ''), nullif(f.external_contact_name, ''), 'Sem nome'),
      'telefone',        ct.phone,
      'etapa',           f.etapa,
      'ordem',           f.ordem,
      'semCard',         (f.deal_id is null),
      'foraDoFunil',     (f.deal_id is not null and f.conta_como_fila is false),
      'ultimaMensagemEm', f.ultima_mensagem_em,
      'horasEsperando',  round(extract(epoch from (now() - f.ultima_mensagem_em)) / 3600.0, 1),
      'passouDoLimite',  (f.ultima_mensagem_em < now() - make_interval(hours => p_horas_sem_resposta)),
      -- O TEXTO REAL. É o que dispensa qualquer classificador: ela lê
      -- "Ok obrigada" e sabe na hora que ali não há trabalho nenhum.
      'tipo',            coalesce(u.content_type, 'text'),
      'texto',           u.texto
    ) as item
    from filtrada f
    left join contacts ct on ct.id = f.contact_id
    left join ultima  u  on u.conversation_id = f.conversation_id
    order by f.ultima_mensagem_em asc
    limit p_limite
  ) s;

  return v_lista;
end;
$$;

comment on function public.get_lista_da_fila(uuid, integer, boolean, boolean, integer) is
  'Story 2.48 — quem está esperando resposta, com o TEXTO REAL da última '
  'mensagem do lead. É o que o clique no card abre. O texto vai junto de '
  'propósito: sem ele a lista responde "quem" e deixa "vale a pena?" para '
  'adivinhação, que é exatamente o que a Fernanda pediu para acabar.';
