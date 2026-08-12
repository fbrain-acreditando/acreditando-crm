-- Story 2.18a — a nota tem de se manter sozinha, ou nasce morta.
--
-- ============================================================================
-- O DEFEITO QUE ESTA MIGRAÇÃO EVITA
-- ============================================================================
-- O backfill de 20260812232000 preencheu os 318 cards que existiam naquele
-- minuto. Sem esta peça, **todo lead que chegar depois nasce com `lead_score`
-- NULL e fica assim para sempre** — o badge simplesmente não apareceria nos
-- cards novos, que são justamente os que ela precisa priorizar.
--
-- É o risco nº 5 da story, escrito lá antes de existir código: *"não repetir o
-- BANT — o scoring nativo do fork nunca rodou: 198 deals, zero"*. Um scoring que
-- só existe no dia em que foi instalado é o mesmo scoring morto com outro nome.
--
-- ============================================================================
-- POR QUE CRON, E NÃO GATILHO NO EVENTO
-- ============================================================================
-- O sinal (a transferência) chega como evento de webhook processado por Edge
-- Function. Reagir a ele seria mais elegante e mais rápido — mas exige mudar a
-- Edge Function, cujo deploy não pode ser conferido nesta máquina. Cron é a
-- opção que **se auto-corrige**: se um recálculo falhar, o próximo conserta.
--
-- ⚖️ Custo controlado, porque o custo é conhecido: o decodificador de WAL do
-- Realtime é o maior consumo de CPU deste banco, e a story 2.22 já teve de
-- mudar um cron de 1 min para 5 min por causa disso. Aqui:
--   • intervalo de 10 min (não 1);
--   • o UPDATE tem guarda `is distinct from` — card cuja nota não mudou **não é
--     reescrito**, então o caso comum não gera linha nenhuma no WAL;
--   • minuto :07, seguindo a convenção da casa de evitar :00 e :30.

-- Variante sem checagem de sessão: o cron roda como `postgres`, e `auth.uid()`
-- é NULL ali. A função com checagem continua existindo para a aplicação.
create or replace function public.recalcular_lead_scores_de_todas_as_orgs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_afetados integer := 0;
begin
  with sinal as (
    select
      d.id as deal_id,
      case
        when t.conversation_id is not null then true
        when c.id is not null              then false
        else null
      end as roteiro_completo
    from deals d
    left join messaging_conversations c on c.contact_id = d.contact_id
    left join v_transferencia_da_conversa t on t.conversation_id = c.id
    where d.deleted_at is null
      -- AC4: nota humana nunca é sobrescrita.
      and (d.lead_score_source is null or d.lead_score_source <> 'manual')
  ),
  calculado as (
    select
      deal_id,
      case when roteiro_completo is null then null
           when roteiro_completo then 1 else 0 end as score,
      case when roteiro_completo is null then 0 else 1 end as known,
      jsonb_build_object(
        'matched', case when roteiro_completo is true
                        then jsonb_build_array('roteiroCompleto') else '[]'::jsonb end,
        'refuted', case when roteiro_completo is false
                        then jsonb_build_array('roteiroCompleto') else '[]'::jsonb end,
        'unknown', case when roteiro_completo is null
                        then jsonb_build_array('roteiroCompleto','cidadeDeSaoPaulo','lesaoRecente','semReabilitacaoPrevia','paraProprioLead')
                        else jsonb_build_array('cidadeDeSaoPaulo','lesaoRecente','semReabilitacaoPrevia','paraProprioLead') end,
        'origem', 'cron:recalcular_lead_scores'
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
     and (d.lead_score is distinct from c.score
       or d.lead_score_known is distinct from c.known);

  get diagnostics v_afetados = row_count;
  return v_afetados;
end;
$$;

comment on function public.recalcular_lead_scores_de_todas_as_orgs() is
  'Story 2.18a — recálculo periódico da nota. Sem checagem de sessão porque roda '
  'no cron. A guarda `is distinct from` evita reescrever card que não mudou.';

-- Nome sem "1min" no rótulo: a pendência nº 41 do CRM é justamente um job
-- chamado `stage-evaluations-1min` que roda de 5 em 5 e mente no nome, e
-- renomear está bloqueado pela plataforma.
select cron.schedule(
  'recalcular-lead-score',
  '7,17,27,37,47,57 * * * *',
  $cron$ select public.recalcular_lead_scores_de_todas_as_orgs(); $cron$
);
