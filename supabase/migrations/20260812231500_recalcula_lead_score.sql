-- Story 2.18a — recálculo da nota a partir dos sinais que JÁ computam.
--
-- ============================================================================
-- O QUE ESTA MIGRAÇÃO FAZ, E O QUE ELA DELIBERADAMENTE NÃO FAZ
-- ============================================================================
-- FAZ: preenche `lead_score` com o único critério computável hoje sem
-- interpretar texto livre — **completou o roteiro com a IA**, medido pela
-- presença de transferência (`v_transferencia_da_conversa`).
--
-- NÃO FAZ: os outros quatro critérios (cidade de SP, lesão recente, sem
-- reabilitação prévia, para a própria pessoa). Os cinco campos da extração são
-- `type: text` com `options: null`, e a cardinalidade medida em 12/08 mostra por
-- quê: `ondeReside` tem 66 valores distintos em 75 preenchimentos (88% únicos),
-- `haQuantoTempo` tem 55 em 70. Casar por texto erra nas duas direções —
-- "Sapopemba" É a capital e não casa; "Campinas sp" casa e NÃO é.
--
-- ⇒ Esses quatro ficam **NULL (desconhecido)**, nunca `false`. Tratar ausência
-- como negativo é o defeito que reprovou a rev. 1 desta story.
-- Eles entram quando a normalização por classificação subir (2.18b).
--
-- ⚠️ CONSEQUÊNCIA HONESTA: enquanto só o critério nº 1 computar, a nota se
-- parece muito com a coluna `Qualificado` do board. É o risco nº 5 da story
-- (segundo scoring decorativo, como o BANT). Está registrado de propósito.

-- ============================================================================
-- Como cada estado é decidido
-- ============================================================================
--   transferência existe        → true  (bateu: completou o roteiro)
--   conversa existe, sem transf → false (refutado: não completou — abandonou)
--   nenhuma conversa            → null  (desconhecido: nem começou)
--
-- A distinção do meio é o que dá valor à nota hoje: 115 dos 131 cards em
-- `Lead novo` abandonaram o roteiro, e isso É informação — são leads frios.

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
    select 1 from profiles
    where id = auth.uid() and organization_id = p_org_id
  ) then
    raise exception 'Unauthorized';
  end if;

  with sinal as (
    select
      d.id as deal_id,
      case
        when t.conversation_id is not null then true   -- completou
        when c.id is not null              then false  -- abandonou no meio
        else null                                      -- nem começou
      end as roteiro_completo
    from deals d
    left join messaging_conversations c on c.contact_id = d.contact_id
    left join v_transferencia_da_conversa t on t.conversation_id = c.id
    where d.organization_id = p_org_id
      and d.deleted_at is null
      -- AC4: nota que a pessoa mudou na mão NUNCA é sobrescrita pelo recálculo.
      and (d.lead_score_source is null or d.lead_score_source <> 'manual')
  ),
  calculado as (
    select
      deal_id,
      case when roteiro_completo is null then null
           when roteiro_completo then 1 else 0 end as score,
      case when roteiro_completo is null then 0 else 1 end as known,
      jsonb_build_object(
        'matched',  case when roteiro_completo is true
                         then jsonb_build_array('roteiroCompleto') else '[]'::jsonb end,
        'refuted',  case when roteiro_completo is false
                         then jsonb_build_array('roteiroCompleto') else '[]'::jsonb end,
        -- Os quatro que ainda não computam aparecem como DESCONHECIDOS na
        -- explicação do card (AC5) — a tela diz o que falta, em vez de omitir.
        'unknown',  case when roteiro_completo is null
                         then jsonb_build_array('roteiroCompleto','cidadeDeSaoPaulo','lesaoRecente','semReabilitacaoPrevia','paraProprioLead')
                         else jsonb_build_array('cidadeDeSaoPaulo','lesaoRecente','semReabilitacaoPrevia','paraProprioLead') end,
        'origem',   'sql:recalcular_lead_scores'
      ) as detail
    from sinal
  )
  update deals d
     set lead_score            = c.score,
         lead_score_known      = c.known,
         lead_score_source     = case when c.score is null then null else 'auto' end,
         lead_score_detail     = c.detail,
         lead_score_updated_at = now()
    from calculado c
   where d.id = c.deal_id
     -- Não escreve linha que já está no valor certo: evita encher o WAL do
     -- Realtime (o decodificador ja e o maior custo do banco) e evita piscar o
     -- board de quem esta com a tela aberta.
     and (d.lead_score is distinct from c.score
       or d.lead_score_known is distinct from c.known);

  get diagnostics v_afetados = row_count;
  return v_afetados;
end;
$$;

comment on function public.recalcular_lead_scores(uuid) is
  'Story 2.18a — recalcula a nota de prioridade. Respeita lead_score_source = '
  'manual (AC4) e nunca grava desconhecido como negativo (AC2).';

grant execute on function public.recalcular_lead_scores(uuid) to authenticated;
