-- Story 2.19 — Bloco A ("o que eu faço agora"), a fila viva da Fernanda.
--
-- ============================================================================
-- POR QUE ESTE BLOCO EXISTE — e por que ele virou prioridade em 14/08
-- ============================================================================
-- O Bloco B ("como foi o mês") subiu primeiro e a Fernanda leu assim, em áudio:
--
--   "336 chegaram, 115 chegaram até mim, 221 a IA resolveu sozinha e eu abordei
--    19. Falei assim: meu chefe vai me substituir por uma IA. Ele vai falar: o
--    que a Fernanda faz? Nada."
--
-- 🔑 Ela não interpretou mal. O painel mede o que a IA fez e NÃO mede o que só
-- ela faz — então o número dela parece pequeno POR CONSTRUÇÃO. O Bloco A é a
-- metade que faltava: a fila que nenhuma automação resolve.
--
-- ⚠️ DIFERENÇA DE NATUREZA em relação ao Bloco B: este bloco é "AGORA", não é
-- período. Uma fila de trabalho filtrada por "mês passado" não significa nada —
-- ninguém liga hoje para quem está esperando desde julho por causa de um seletor
-- de data. Por isso a RPC NÃO recebe intervalo.
--
-- ============================================================================
-- AC0 — medido em 14/08 ~12h (SP), antes de escrever este arquivo
-- ============================================================================
--   • conversas transferidas ............ 162   (13/08: 157)
--   • a bola está com ela ...............  67   (13/08:  64)
--   • passou de 24h .....................  61   (13/08:  54)
--   • prontos para ligar ................  23   (13/08:  23)
-- As definições REPRODUZEM entre dois dias, com o crescimento esperado.
--
-- ⚠️ RESSALVA QUE VAI PARA A TELA (AC1): "prontos para ligar" só pode ser
-- calculado sobre cards que a IA da story 2.35 pontuou — e ela só pontua quem
-- entra em `Qualificado`. São 68 de 370 cards vivos. Logo o número é 23 DE 68,
-- não 23 de 370. Mostrar sem o denominador repetiria o erro que a story 2.18
-- corrigiu com o `★ 1/1` × `★ 1/5`.

-- ============================================================================
-- 1. A última mensagem de cada conversa transferida
-- ============================================================================
-- Só interessa conversa JÁ TRANSFERIDA: antes da transferência quem responde é
-- a IA, e "esperando resposta" ali não é fila dela. O carimbo de transferência
-- é o mesmo sinal do Bloco B (`v_transferencia_da_conversa`) — se a regra de
-- discriminação mudar lá, muda aqui junto.

create or replace view public.v_fila_de_atendimento
with (security_invoker = true) as
select distinct on (m.conversation_id)
  m.conversation_id,
  c.organization_id,
  m.direction    as direcao_da_ultima,
  m.created_at   as ultima_mensagem_em
from public.messaging_messages m
join public.v_transferencia_da_conversa t on t.conversation_id = m.conversation_id
join public.messaging_conversations c     on c.id = m.conversation_id
order by m.conversation_id, m.created_at desc;

comment on view public.v_fila_de_atendimento is
  'Story 2.19 Bloco A — a última mensagem de cada conversa que já saiu da IA. '
  'Se a última é `inbound`, o lead falou por último: a bola está com a atendente. '
  '`security_invoker` para herdar a RLS de quem consulta.';

-- ============================================================================
-- 2. RPC do Bloco A
-- ============================================================================
-- ⚠️ O nome não pode conter `do`, `set`, `call`, `comment` nem `copy`: o
-- executor somente-leitura (`scripts/db/sql-ro.mjs`) bloqueia esses verbos mesmo
-- colados em `_`, e uma função impossível de consultar pelo caminho seguro
-- convida a desligar a trava. `de`/`da` são seguros. (Lição registrada na 2.19.)

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
  v_transferidas       integer := 0;
  v_esperando_por_mim  integer := 0;
  v_passou_do_limite   integer := 0;
  v_prontos_para_ligar integer := 0;
  v_pontuados_pela_ia  integer := 0;
  v_cards_vivos        integer := 0;
begin
  -- SECURITY DEFINER ignora RLS ⇒ a organização do caller é conferida na mão.
  -- Mesma checagem de `get_metricas_de_atendimento`.
  if not exists (
    select 1 from profiles
    where id = auth.uid() and organization_id = p_org_id
  ) then
    raise exception 'Unauthorized';
  end if;

  select
    count(*),
    count(*) filter (where f.direcao_da_ultima = 'inbound'),
    count(*) filter (
      where f.direcao_da_ultima = 'inbound'
        and f.ultima_mensagem_em < now() - make_interval(hours => p_horas_sem_resposta)
    )
  into v_transferidas, v_esperando_por_mim, v_passou_do_limite
  from v_fila_de_atendimento f
  where f.organization_id = p_org_id;

  -- "Pronto para ligar" = o critério DELA, literal (11/08): São Paulo capital E
  -- chegou ao fim do roteiro com a IA. Quem julga é a IA da story 2.35, porque o
  -- casamento por texto errava nas duas direções ("Sapopemba" é a capital e não
  -- casava; "Campinas sp" casava e não é).
  --
  -- O denominador sai junto de propósito: a IA só pontua quem entra em
  -- `Qualificado`, então este número NUNCA fala sobre a base inteira.
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
    'transferidas',      v_transferidas,
    'esperandoPorMim',   v_esperando_por_mim,
    'passouDoLimite',    v_passou_do_limite,
    'horasDoLimite',     p_horas_sem_resposta,
    'prontosParaLigar',  v_prontos_para_ligar,
    'pontuadosPelaIa',   v_pontuados_pela_ia,
    'cardsVivos',        v_cards_vivos
  );
end;
$$;

comment on function public.get_fila_de_atendimento(uuid, integer) is
  'Story 2.19 Bloco A — a fila viva da atendente: quantas conversas esperam '
  'resposta dela, quantas passaram do limite de horas e quantas estão prontas '
  'para ligar. NÃO recebe período: fila de trabalho é sempre "agora".';

grant execute on function public.get_fila_de_atendimento(uuid, integer)
  to authenticated;
