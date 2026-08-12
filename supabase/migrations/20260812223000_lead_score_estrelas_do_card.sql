-- Story 2.18a — a nota de prioridade do lead (estrelas no card).
--
-- ============================================================================
-- POR QUE COLUNA NOVA, e não `probability` ou `custom_fields`
-- ============================================================================
-- Decisão do @po (opção B). `probability` existe e é numérica, mas significa
-- outra coisa — misturar "probabilidade de fechar" com "prioridade de ligar"
-- deixa as duas erradas. `custom_fields` transformaria a nota em campo editável
-- comum, e o AC4 exige distinguir nota AUTOMÁTICA de nota HUMANA.
--
-- ============================================================================
-- O DENOMINADOR É PARTE DA NOTA — não é enfeite
-- ============================================================================
-- Medido em 12/08 (AC0-rev2): a cobertura dos critérios é BIMODAL. De 318 deals
-- vivos, **210 têm zero critério conhecido** e **64 têm os cinco**. Sem guardar
-- quantos critérios eram CONHECÍVEIS, dois cards opostos ficam idênticos:
--
--   • lead novo, 1 critério bateu e 4 são desconhecidos  → a investigar
--   • lead completo, 1 critério bateu e 4 foram refutados → a descartar
--
-- Os dois teriam "1 estrela". Por isso `lead_score_known` existe e a tela mostra
-- `⭐ 1/5` × `⭐ 1/1`. É o AC2 da story ("ausente ≠ negativo") levado ao schema,
-- em vez de ficar só na interface.

alter table public.deals
  add column if not exists lead_score smallint,
  add column if not exists lead_score_known smallint,
  add column if not exists lead_score_source text,
  add column if not exists lead_score_detail jsonb,
  add column if not exists lead_score_updated_at timestamptz;

-- `null` = SEM NOTA, e é diferente de zero. Zero afirma "nenhum critério bateu";
-- null diz "não sabemos nada" — o caso de 66% do board hoje. O @po decidiu que
-- lead sem nenhum campo fica sem nota, porque 1 estrela AFIRMA baixa prioridade.
comment on column public.deals.lead_score is
  'Story 2.18 — quantos critérios de prioridade bateram (0-5). NULL = sem nota, '
  'diferente de 0. Ver lead_score_known para o denominador.';

comment on column public.deals.lead_score_known is
  'Story 2.18 — quantos dos 5 critérios eram CONHECÍVEIS neste card. O card '
  'mostra score/known. Sem isto, "1 de 5 desconhecidos" e "1 de 1" ficam iguais.';

comment on column public.deals.lead_score_source is
  'Story 2.18 — "auto" (regra) ou "manual" (ela mudou). Manual NUNCA é '
  'sobrescrito por recálculo: AC4.';

comment on column public.deals.lead_score_detail is
  'Story 2.18 — quais critérios bateram, quais foram refutados e quais são '
  'desconhecidos, com o valor normalizado e a proveniência de cada um. É o AC5: '
  'nota que não se explica vira nota que ninguém confia.';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'deals_lead_score_source_check'
  ) then
    alter table public.deals
      add constraint deals_lead_score_source_check
      check (lead_score_source is null or lead_score_source in ('auto', 'manual'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'deals_lead_score_range_check'
  ) then
    alter table public.deals
      add constraint deals_lead_score_range_check
      check (
        (lead_score is null or lead_score between 0 and 5)
        and (lead_score_known is null or lead_score_known between 0 and 5)
        -- A nota nunca pode ser maior que o número de critérios conhecidos:
        -- seria afirmar que bateu um critério que não se sabe medir.
        and (lead_score is null or lead_score_known is null or lead_score <= lead_score_known)
      );
  end if;
end;
$$;

-- Ordenação do board por prioridade. `nulls last` porque card sem nota não deve
-- disputar o topo da fila com card medido.
create index if not exists idx_deals_lead_score
  on public.deals (organization_id, lead_score desc nulls last)
  where deleted_at is null;
