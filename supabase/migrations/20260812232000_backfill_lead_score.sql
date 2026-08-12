-- Story 2.18a — backfill da nota nos cards que já existem.
--
-- Mesma lógica de `recalcular_lead_scores`, sem a checagem de `auth.uid()`:
-- migração roda como admin, e não há sessão de usuário. A função continua sendo
-- o caminho da aplicação; esta migração é a carga inicial, uma vez.
--
-- ⚠️ Respeita `lead_score_source = 'manual'` igual à função (AC4). Hoje não há
-- nenhuma nota manual — mas escrever o filtro agora evita que uma reexecução
-- futura desfaça trabalho da Fernanda.

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
      'origem', 'sql:backfill-2026-08-12'
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
