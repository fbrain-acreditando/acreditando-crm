-- Story 2.42 — a pontuação vira SOB DEMANDA: o trigger chama a IA na hora.
--
-- ============================================================================
-- O QUE MUDA EM RELAÇÃO À 2.41
-- ============================================================================
-- A 2.41 consertou o sangramento (fila com contador de tentativas) mas manteve o
-- POLLING: 12 rodadas/hora, 24h/dia, para uma fila que só enche em horário
-- comercial — 2/3 das rodadas rodavam quando ninguém arrastava card nenhum.
--
-- Pedido do Filipe (17/08): *"não quero cron, quero sob demanda"*.
--
--   ANTES:  trigger enfileira  →  cron varre de 5 em 5 min  →  pontua
--   AGORA:  trigger enfileira  →  trigger CHAMA (pg_net)    →  pontua na hora
--
-- A fila NÃO some — ela troca de papel: deixa de ser o motor e vira LIVRO-CAIXA
-- (`attempts`, `last_error`, `request_id`). Tirá-la junto seria trocar um defeito
-- por outro: sem `attempts`, o laço infinito volta na primeira falha que retentar.
--
-- ============================================================================
-- O PADRÃO JÁ EXISTE NESTA CASA — é ADAPT, não CREATE
-- ============================================================================
-- `notify_deal_stage_changed` (20251201000000_schema_init.sql, ~linha 2187) já
-- dispara `net.http_post` de dentro de um trigger e persiste o `request_id`.
-- Esta migration segue o mesmo formato, inclusive o `EXCEPTION WHEN OTHERS`.
--
-- ⚠️ E o que aquele padrão NÃO tem, este precisa ter: lá está escrito
--    "Retries/backoff não fazem parte do MVP". Aqui, o que cai é recuperado pela
--    rede de segurança diária da seção 4.

-- ============================================================================
-- 1. Rastro do disparo (AC5)
-- ============================================================================
-- Responde "o disparo saiu?" sem adivinhação — `request_id` é cruzável com
-- `net._http_response`, onde o pg_net guarda o resultado da chamada.
alter table public.ai_pending_lead_scores
  add column if not exists request_id bigint;

alter table public.ai_pending_lead_scores
  add column if not exists dispatched_at timestamptz;

comment on column public.ai_pending_lead_scores.request_id is
  'Story 2.42 — id da requisição do pg_net. Cruzar com net._http_response para '
  'saber o que aconteceu com o disparo por evento.';

comment on column public.ai_pending_lead_scores.dispatched_at is
  'Story 2.42 — quando o trigger disparou o POST. NULL = o disparo nem chegou a '
  'sair (o motivo fica em last_error) e o item espera a rede de segurança.';

-- ============================================================================
-- 2. O trigger passa a CHAMAR, não só enfileirar
-- ============================================================================
-- SECURITY DEFINER com `search_path` fixo (função SECURITY DEFINER sem
-- search_path é vetor de escalada de privilégio). `net.` e `vault.` são
-- qualificados por schema, então o search_path restrito não os alcança por
-- acidente — nem precisa.
create or replace function public.enfileirar_pontuacao_do_lead()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pontua   boolean;
  v_item_id  uuid;
  v_req_id   bigint;
  v_segredo  text;
begin
  -- Card excluído não entra na fila (story 2.25 — soft delete).
  if new.deleted_at is not null then
    return new;
  end if;

  -- AC4 da 2.41 — quem a IA já leu não é relido, e nota manual é intocável.
  if new.pontuada_pela_ia_em is not null then
    return new;
  end if;
  if new.lead_score_source = 'manual' then
    return new;
  end if;

  -- O estágio de destino manda pontuar? Por COLUNA, nunca por nome — o board já
  -- foi renomeado uma vez (story 2.33) e casar por nome falhou calado.
  select s.pontua_lead into v_pontua
    from board_stages s
   where s.id = new.stage_id;

  if coalesce(v_pontua, false) is not true then
    return new;
  end if;

  -- ON CONFLICT DO NOTHING cobre o índice único parcial: se já existe item
  -- pendente para este deal, não duplica.
  --
  -- ⚠️ E o RETURNING devolve NULL exatamente nesse caso — é ele que impede um
  --    segundo disparo para um card que já tem pontuação a caminho.
  insert into public.ai_pending_lead_scores (organization_id, deal_id, origem)
  values (new.organization_id, new.id, 'trigger')
  on conflict do nothing
  returning id into v_item_id;

  if v_item_id is null then
    return new;
  end if;

  -- --------------------------------------------------------------------------
  -- O disparo (AC1, AC2, AC3)
  -- --------------------------------------------------------------------------
  -- ⚠️ TUDO dentro de EXCEPTION: falha de rede NÃO pode abortar o UPDATE do card.
  --    Arrastar um card precisa funcionar mesmo com o app fora do ar — e o item
  --    já está na fila, então a rede de segurança do dia seguinte o alcança.
  begin
    -- Reusa o segredo que já existe no vault, igual aos jobs de cron. Nenhum
    -- segredo novo, e nenhum segredo passou pelo chat.
    select decrypted_secret into v_segredo
      from vault.decrypted_secrets
     where name = 'cron_secret_stage_eval';

    if v_segredo is null then
      update public.ai_pending_lead_scores
         set last_error = 'disparo nao saiu: segredo cron_secret_stage_eval ausente no vault'
       where id = v_item_id;
      return new;
    end if;

    -- `pg_net` é ASSÍNCRONO: enfileira aqui e envia depois do COMMIT. A tela da
    -- Fernanda não espera a IA — o arrasto termina na hora.
    --
    -- ⚠️ `timeout_milliseconds` é EXPLÍCITO de propósito. O default do pg_net é
    --    5.000 ms e a pontuação leva 6,0 s em média (p99 16 s, medido no console
    --    do Google em 16/08) — com o default, o pg_net cortaria a conexão no meio
    --    de TODA pontuação.
    select net.http_post(
      url     := 'https://acreditando-crm-sandy.vercel.app/api/ai/pontuar-lead',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || v_segredo
      ),
      body    := jsonb_build_object('item_id', v_item_id),
      timeout_milliseconds := 30000
    ) into v_req_id;

    update public.ai_pending_lead_scores
       set request_id    = v_req_id,
           dispatched_at = now()
     where id = v_item_id;

  exception when others then
    -- O item continua `pending` de propósito: a rede de segurança o pega.
    update public.ai_pending_lead_scores
       set last_error = 'disparo falhou: ' || sqlerrm
     where id = v_item_id;
  end;

  return new;
end;
$$;

comment on function public.enfileirar_pontuacao_do_lead() is
  'Story 2.42 — enfileira E DISPARA a pontuação ao ENTRAR em estágio com '
  'pontua_lead. Cobre TODOS os caminhos (tela, IA/HITL, moveOnQualified, '
  'webhooks, API pública, MCP) porque todos terminam no mesmo UPDATE de '
  'deals.stage_id. O POST vai por pg_net (assíncrono, pós-commit); se falhar, o '
  'item fica pending e a rede de seguranca diaria o recupera.';

-- Os triggers da 2.41 continuam válidos (a função foi substituída, não eles).
-- Recriados aqui só para o caso de esta migration rodar num banco onde a 2.41
-- ainda não passou — idempotente dos dois lados.
--
--  • UPDATE OF stage_id → só quando ESSA coluna é escrita; `IS DISTINCT FROM`
--    garante que reescrever o mesmo stage_id não gera pontuação.
--  • INSERT → card que NASCE em `Qualificado` (import, API pública) também
--    pontua. Decisão do Filipe em 17/08. ⚠️ Risco aceito e registrado: uma
--    importação em massa vira rajada de disparos.
drop trigger if exists trg_enfileirar_pontuacao_update on public.deals;
create trigger trg_enfileirar_pontuacao_update
  after update of stage_id on public.deals
  for each row
  when (old.stage_id is distinct from new.stage_id)
  execute function public.enfileirar_pontuacao_do_lead();

drop trigger if exists trg_enfileirar_pontuacao_insert on public.deals;
create trigger trg_enfileirar_pontuacao_insert
  after insert on public.deals
  for each row
  execute function public.enfileirar_pontuacao_do_lead();

-- ============================================================================
-- 3. O POLLING MORRE (AC1)
-- ============================================================================
-- Este é o job que rodava 12×/hora e cobrou R$ 197,83 em 3 dias.
do $$
begin
  perform cron.unschedule('pontuar-leads-qualificados');
  raise notice 'Story 2.42 — job `pontuar-leads-qualificados` (12x/hora) REMOVIDO.';
exception when others then
  -- Já removido, ou nunca existiu neste banco. Idempotência.
  raise notice 'Story 2.42 — `pontuar-leads-qualificados` nao estava agendado (ok).';
end;
$$;

-- ============================================================================
-- 4. A rede de segurança — 1× por dia (AC7)
-- ============================================================================
-- `pg_net` é fire-and-forget: se o POST falhar (cold start, deploy, 500), NADA
-- tenta de novo. Sem esta rede, trocar polling por evento trocaria "gasta demais"
-- por "perde em silêncio" — a classe de defeito que mordeu este repo três vezes
-- só em agosto (alarme do Lead Ads, Mission Control inativo, log de tokens cego).
--
-- Em dia sem falha ela processa ZERO. De 288 rodadas/dia para 1.
--
-- ⏱️ 06:17 UTC = 03:17 BRT. A convenção da casa evita :00 e :30.
-- 🏷️ O nome NÃO promete cadência — a pendência nº 41 do CRM é justamente um job
--    chamado `stage-evaluations-1min` que roda de 5 em 5 minutos.
select cron.schedule(
  'pontuar-leads-rede-de-seguranca',
  '17 6 * * *',
  $cron$
    select net.http_get(
      url := 'https://acreditando-crm-sandy.vercel.app/api/cron/pontuar-leads',
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret_stage_eval')
      )
    );
  $cron$
);

-- ============================================================================
-- 5. A view segue sendo diagnóstico (herdado da 2.41)
-- ============================================================================
comment on view public.v_leads_a_pontuar is
  'Story 2.42 — painel de diagnostico: cards em estagio de pontuacao ainda sem '
  'nota da IA. NAO e fila de trabalho. Depois da 2.42 ela responde a pergunta '
  'que mais importa: "algum disparo por evento se perdeu?" — o que estiver aqui '
  'no dia seguinte e o que a rede de seguranca nao conseguiu recuperar.';
