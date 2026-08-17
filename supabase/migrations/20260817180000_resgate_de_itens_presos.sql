-- Story 2.43 — o item preso em `processing` volta para a fila, contando a tentativa.
--
-- ============================================================================
-- O BURACO QUE ESTA MIGRATION FECHA
-- ============================================================================
--   1. o item é travado:   status = 'processing'      (lock otimista, evita cobrar 2×)
--   2. a função morre:     timeout / deploy / crash    (nada mais escreve nesse item)
--   3. quem lê a fila:     where status = 'pending'    ⇒ o item nunca mais é visto
--
-- Não é sangria — é o oposto: o card fica sem nota e ninguém é cobrado. Mas é a
-- ÚNICA forma de um lead sumir em definitivo.
--
-- É dívida de CLASSE: as duas filas irmãs têm exatamente o mesmo desenho.
-- `ai_pending_evaluations` é ainda mais exposta — processa 10 itens EM PARALELO
-- com maxDuration 60, então um estouro pode deixar 10 presos de uma vez.
--
-- ============================================================================
-- 🔴 A DECISÃO QUE DEFINE A STORY: o resgate CONSOME TENTATIVA
-- ============================================================================
-- Um card que trava a função de forma determinística (conversa gigante, dado que
-- quebra o parser) seria resgatado, travaria de novo, seria resgatado de novo —
-- PARA SEMPRE. Seria o defeito da 2.35 com outro nome:
--
--    "uma falha se auto-corrige na rodada seguinte"  ⇒  R$ 197,83 em 3 dias
--
-- **Auto-corrigir e reprocessar para sempre são a mesma frase quando não existe
-- contador.** Por isso o resgate devolve o item à fila, mas NÃO devolve
-- tentativas a ele. Na terceira, vira `failed` e sai.

-- ============================================================================
-- 1. O carimbo da trava (AC1)
-- ============================================================================
-- Sem ele não dá para distinguir "preso há 3 horas" de "rodando agora" — e
-- resgatar um item EM VOO faria a IA ser paga duas vezes pelo mesmo lead, que é
-- exatamente o que o lock existe para impedir.
--
-- ⚠️ `created_at` NÃO serve (é quando entrou na fila, não quando travou) e
--    `processed_at` só é escrito nos estados terminais. O descarte fica
--    registrado aqui para não ser "simplificado" numa próxima leitura.
alter table public.ai_pending_lead_scores
  add column if not exists processing_since timestamptz;

alter table public.ai_pending_evaluations
  add column if not exists processing_since timestamptz;

comment on column public.ai_pending_lead_scores.processing_since is
  'Story 2.43 — quando o item foi travado em `processing`. Escrito no MESMO '
  'UPDATE que trava. NULL = não está travado. É o unico carimbo que permite '
  'distinguir item preso de item em voo.';

comment on column public.ai_pending_evaluations.processing_since is
  'Story 2.43 — idem `ai_pending_lead_scores`. A fila irma tinha a mesma lacuna: '
  'travava em `processing` e nada devolvia o item se a funcao morresse.';

-- Índices parciais: em regime normal estas tabelas têm ZERO linha em
-- `processing`, então o resgate custa praticamente nada.
create index if not exists idx_lead_scores_presos
  on public.ai_pending_lead_scores (processing_since)
  where status = 'processing';

create index if not exists idx_evaluations_presos
  on public.ai_pending_evaluations (processing_since)
  where status = 'processing';

-- ============================================================================
-- 2. O resgate (AC2, AC3, AC4)
-- ============================================================================
-- ⚠️ `p_max_tentativas` é PARÂMETRO, não constante copiada: quem chama passa o
--    `MAX_TENTATIVAS` do TypeScript. Constante duplicada é o defeito do `15` da
--    carência, que este repo já registrou vivendo em dois lugares.
--
-- ⚠️ `p_minutos` default 15 tem folga enorme sobre o maior `maxDuration` do
--    caminho (300s no lote, 60s no sob demanda). Item mais novo que isso pode
--    estar rodando — e não se resgata quem está em voo.
create or replace function public.resgatar_itens_presos(
  p_minutos        int default 15,
  p_max_tentativas int default 3
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_corte      timestamptz := now() - make_interval(mins => p_minutos);
  v_pontuacoes int := 0;
  v_avaliacoes int := 0;
begin
  with resgatados as (
    update public.ai_pending_lead_scores
       set status = case when attempts + 1 >= p_max_tentativas then 'failed' else 'pending' end,
           attempts = attempts + 1,
           last_error = 'resgatado (2.43): preso em processing desde ' || processing_since,
           processed_at = case when attempts + 1 >= p_max_tentativas then now() else processed_at end,
           processing_since = null
     where status = 'processing'
       -- ⚠️ `is not null` é deliberado: linha sem carimbo é IGNORADA, nunca
       --    resgatada por aproximação. Medido em 17/08 — não há legado a cobrir.
       and processing_since is not null
       and processing_since < v_corte
    returning 1
  )
  select count(*) into v_pontuacoes from resgatados;

  with resgatadas as (
    update public.ai_pending_evaluations
       set status = case when attempts + 1 >= p_max_tentativas then 'failed' else 'pending' end,
           attempts = attempts + 1,
           last_error = 'resgatado (2.43): preso em processing desde ' || processing_since,
           processed_at = case when attempts + 1 >= p_max_tentativas then now() else processed_at end,
           processing_since = null
     where status = 'processing'
       and processing_since is not null
       and processing_since < v_corte
    returning 1
  )
  select count(*) into v_avaliacoes from resgatadas;

  return jsonb_build_object(
    'pontuacoes', v_pontuacoes,
    'avaliacoes', v_avaliacoes,
    'corte',      v_corte
  );
end;
$$;

comment on function public.resgatar_itens_presos(int, int) is
  'Story 2.43 — devolve a `pending` os itens travados em `processing` ha mais de '
  'p_minutos, CONSUMINDO uma tentativa. Na ultima tentativa o item vira `failed` '
  'e sai da fila: resgatar sem contar recriaria o laco infinito que custou '
  'R$ 197,83. Chamada por carona nos caminhos que ja rodam — nenhum cron novo.';

-- O service role é quem executa os crons e o endpoint sob demanda.
grant execute on function public.resgatar_itens_presos(int, int) to service_role;
