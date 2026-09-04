-- Story 2.50 — o arrastar que chama o n8n.
--
-- ============================================================================
-- DE ONDE VEIO
-- ============================================================================
-- A story 2.49 abriu a PORTA (POST /api/public/v1/deals/{dealId}/ai-extraction),
-- mas ninguém bate nela. Medido no banco de produção em 01/09:
--
--   • `trg_notify_deal_stage_changed` (AFTER UPDATE ON deals) já existe, já sai
--     cedo quando o estágio não muda, já enriquece o payload e já grava
--     `webhook_events_out`/`webhook_deliveries` antes do `net.http_post`.
--     ⇒ Nada disso é criado aqui. Só usado.
--   • `integration_outbound_endpoints` está VAZIA — o trigger roda a cada UPDATE
--     e não acha ninguém para avisar.
--   • O payload não carrega o id da conversa no GPT Maker, e o n8n precisa dele
--     para buscar as mensagens. O dado existe:
--     `messaging_conversations.metadata->>'gptmaker_chat_id'` preenchido em
--     1.270 de 1.274 conversas.
--   • A fila interna (`ai_pending_lead_scores`) continua tentando pontuar e já
--     acumulou 91 itens em `failed` — 100% "Your prepayment credits are
--     depleted". Cada card arrastado queima 3 tentativas à toa.
--
-- 📌 Esta migration não inventa mecanismo: liga um cano que já existe numa peça
--    que falta, filtra o disparo pelas etapas que importam, e estanca um
--    vazamento paralelo — de forma REVERSÍVEL por flag.
--
-- ⚠️ O corpo das duas funções recriadas abaixo foi LIDO DO BANCO DE PRODUÇÃO
--    (`select prosrc from pg_proc ...`) antes de ser escrito, e conferido contra
--    o repositório. `CREATE OR REPLACE` apaga em silêncio qualquer trecho
--    esquecido — reescrever de memória seria perder pedaço de trigger em
--    produção.
--
-- Idempotente: `CREATE OR REPLACE` + `ADD COLUMN IF NOT EXISTS`.

-- ============================================================================
-- 1. A flag que estanca a fila morta (Task B)
-- ============================================================================
-- Campo DEDICADO, e não reuso de `organization_settings.ai_enabled`.
--
-- `ai_enabled` é o interruptor GERAL de IA da organização — chat, agente e
-- actions o consomem (`lib/ai/agent/agent.service.ts`, `app/api/ai/chat/route.ts`).
-- Desligá-lo para conter a fila de pontuação apagaria funcionalidades que não
-- têm nada a ver com o crédito esgotado do Google. Esta coluna é estreita de
-- propósito: cobre exatamente `enfileirar_pontuacao_do_lead()`, nada mais.
--
-- O DEFAULT é `true` porque o comportamento histórico é "a fila roda". Quem
-- desliga é o UPDATE explícito no fim desta migration — default não desliga
-- ninguém sozinho.

alter table public.organization_settings
  add column if not exists pontuacao_automatica_habilitada boolean not null default true;

comment on column public.organization_settings.pontuacao_automatica_habilitada is
  'Story 2.50 — interruptor ESTREITO da fila interna de pontuação por IA '
  '(ai_pending_lead_scores). Existe separado de ai_enabled porque ai_enabled '
  'desligaria chat, agente e actions junto. '
  'DESLIGADO em 02/09/2026 para a organização do Grupo Acreditando: a fila '
  'acumulou 91 itens em failed, 100% com "Your prepayment credits are depleted" '
  '(crédito do Google esgotado desde 18/08), e cada card arrastado queimava mais '
  '3 tentativas à toa. Desligar ESTANCA — não é limpeza. '
  'PARA RELIGAR: (1) crédito do Google reabastecido e confirmado; (2) decidir '
  'antes quem pontua a etapa Qualificado — a fila interna OU o n8n, nunca os '
  'dois, senão as duas notas disputam o mesmo campo lead_score; (3) '
  'update organization_settings set pontuacao_automatica_habilitada = true '
  'where organization_id = ...';

-- ============================================================================
-- 2. `enfileirar_pontuacao_do_lead()` ganha o early return da flag (Task B)
-- ============================================================================
-- Corpo preservado INTEGRALMENTE do que está em produção (idêntico ao de
-- `20260817160000_pontuacao_sob_demanda.sql`). A única mudança é o bloco novo
-- marcado com "story 2.50".
--
-- ⚠️ Os triggers NÃO são tocados nem removidos. Desligar por remoção perderia a
--    rede de segurança (`pontuar-leads-rede-de-seguranca`, cron diário) e o
--    rastro de tentativas (`attempts`, `last_error`) no dia em que o crédito
--    voltar. Tem que ser reversível por flag.
--
-- `security definer` + `set search_path = public` preservados: função
-- SECURITY DEFINER sem search_path fixo é vetor de escalada de privilégio.

create or replace function public.enfileirar_pontuacao_do_lead()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pontua      boolean;
  v_item_id     uuid;
  v_req_id      bigint;
  v_segredo     text;
  v_habilitada  boolean;
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

  -- Story 2.50 — a organização desligou a pontuação automática?
  --
  -- ⚠️ `coalesce(..., true)`: organização SEM linha em organization_settings
  --    mantém o comportamento histórico (fila ligada). A flag só desliga quem
  --    foi desligado de propósito.
  select os.pontuacao_automatica_habilitada into v_habilitada
    from organization_settings os
   where os.organization_id = new.organization_id;

  if coalesce(v_habilitada, true) is not true then
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
  -- O disparo (AC1, AC2, AC3 da story 2.42)
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
  'item fica pending e a rede de seguranca diaria o recupera. '
  'Story 2.50 — passa a respeitar '
  'organization_settings.pontuacao_automatica_habilitada: quando false, retorna '
  'cedo sem enfileirar e sem disparar. Os triggers seguem ativos de propósito '
  '(desligar por flag é reversível; desligar por remoção perderia a rede de '
  'segurança e o rastro de tentativas).';

-- ============================================================================
-- 3. `notify_deal_stage_changed()` ganha a conversa e o filtro por etapa
--    (Task A + Task C)
-- ============================================================================
-- Corpo preservado INTEGRALMENTE do que está em produção. Duas adições, ambas
-- marcadas com "story 2.50":
--
--   (a) FILTRO POR ETAPA — o webhook só sai quando o estágio de DESTINO tem
--       `board_stages.pontua_lead = true`.
--
--       Por que reusar `pontua_lead` em vez de criar coluna nova: essa coluna já
--       significa EXATAMENTE "este estágio deve ser avaliado pela IA" (stories
--       2.41/2.42), e o webhook que esta migration liga serve ao mesmo propósito
--       — só troca QUEM executa a extração (n8n em vez da fila interna), não
--       QUANDO ela acontece. Criar `pontua_via_n8n` duplicaria a decisão em dois
--       lugares que precisariam ficar sincronizados à mão — o tipo de duplicação
--       que este repo já pagou caro na story 2.33 (nome vs. coluna).
--
--       ⚠️ NÃO confundir com `board_stages.conta_como_fila` (story 2.48), que
--          decide se o card entra no painel de fila de trabalho da Fernanda —
--          pergunta diferente.
--
--       ⚠️ Nenhum valor de `pontua_lead` é alterado aqui (decisão do Filipe,
--          01/09): hoje só a etapa `Qualificado` é `true`, das 13, e assim fica.
--          Trocar a etapa-gatilho um dia é um UPDATE de uma linha em
--          board_stages — não exige código.
--
--   (b) BLOCO `conversation` NO PAYLOAD — id da conversa e `gptmaker_chat_id`
--       (o `context_id` que o n8n usa em
--       GET https://api.gptmaker.ai/v2/chat/{context_id}/messages).
--
--       ⚠️ O SELECT novo vive em bloco `BEGIN ... EXCEPTION WHEN OTHERS` PRÓPRIO,
--          separado do bloco que protege o `net.http_post`. Dois motivos:
--          1. sem proteção nenhuma, um erro aqui (ex.: metadata malformado)
--             derruba o UPDATE do card inteiro — esta função é AFTER UPDATE no
--             caminho quente da Fernanda, e perder o arrasto é pior do que perder
--             o enriquecimento;
--          2. dentro do bloco do http_post, o mesmo erro seria registrado como
--             `webhook_deliveries.status = 'failed'` por um motivo errado.
--          Sem conversa encontrada ⇒ os dois campos vêm `null` e o webhook sai
--          assim mesmo.
--
-- `security definer` + `set search_path = ''` preservados (o `search_path` vazio
-- veio de `20260221200002_fix_function_search_path.sql`; por isso TODA referência
-- aqui é qualificada por schema — sem o SET, o CREATE OR REPLACE zeraria a
-- configuração e reabriria o vetor de escalada de privilégio).

create or replace function public.notify_deal_stage_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
DECLARE
  endpoint RECORD;
  board_name TEXT;
  from_label TEXT;
  to_label TEXT;
  contact_name TEXT;
  contact_phone TEXT;
  contact_email TEXT;
  payload JSONB;
  event_id UUID;
  delivery_id UUID;
  req_id BIGINT;
  -- story 2.50
  pontua_lead_destino BOOLEAN;
  conversation_id UUID;
  gptmaker_chat_id TEXT;
BEGIN
  IF (TG_OP <> 'UPDATE') THEN
    RETURN NEW;
  END IF;

  IF NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id THEN
    RETURN NEW;
  END IF;

  -- story 2.50 — filtro por etapa (Task C).
  -- Sai ANTES de qualquer escrita: estágio de destino sem `pontua_lead` não gera
  -- linha em webhook_events_out, não gera webhook_deliveries e não chama
  -- net.http_post.
  SELECT bs.pontua_lead INTO pontua_lead_destino
  FROM public.board_stages bs
  WHERE bs.id = NEW.stage_id;

  IF COALESCE(pontua_lead_destino, false) IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  -- Enriquecimento básico para payload humano
  SELECT b.name INTO board_name FROM public.boards b WHERE b.id = NEW.board_id;
  SELECT bs.label INTO to_label FROM public.board_stages bs WHERE bs.id = NEW.stage_id;
  SELECT bs.label INTO from_label FROM public.board_stages bs WHERE bs.id = OLD.stage_id;

  IF NEW.contact_id IS NOT NULL THEN
    SELECT c.name, c.phone, c.email
      INTO contact_name, contact_phone, contact_email
    FROM public.contacts c
    WHERE c.id = NEW.contact_id;
  END IF;

  -- story 2.50 — a conversa do GPT Maker (Task A).
  -- Bloco de exceção PRÓPRIO: falhar aqui não pode derrubar o UPDATE do card.
  BEGIN
    -- 1ª tentativa: vínculo explícito gravado no metadata da conversa.
    SELECT mc.id, mc.metadata->>'gptmaker_chat_id'
      INTO conversation_id, gptmaker_chat_id
    FROM public.messaging_conversations mc
    WHERE mc.organization_id = NEW.organization_id
      AND mc.metadata->>'deal_id' = NEW.id::text
    ORDER BY mc.last_message_at DESC NULLS LAST
    LIMIT 1;

    -- 2ª tentativa (fallback): a conversa mais recente do mesmo contato. Só
    -- entra quando o vínculo explícito não achou nada.
    IF conversation_id IS NULL AND NEW.contact_id IS NOT NULL THEN
      SELECT mc.id, mc.metadata->>'gptmaker_chat_id'
        INTO conversation_id, gptmaker_chat_id
      FROM public.messaging_conversations mc
      WHERE mc.organization_id = NEW.organization_id
        AND mc.contact_id = NEW.contact_id
      ORDER BY mc.last_message_at DESC NULLS LAST
      LIMIT 1;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Enriquecimento é opcional; o arrasto do card não é.
    conversation_id := NULL;
    gptmaker_chat_id := NULL;
  END;

  FOR endpoint IN
    SELECT * FROM public.integration_outbound_endpoints e
    WHERE e.organization_id = NEW.organization_id
      AND e.active = true
      AND 'deal.stage_changed' = ANY(e.events)
  LOOP
    payload := jsonb_build_object(
      'event_type', 'deal.stage_changed',
      'occurred_at', now(),
      'deal', jsonb_build_object(
        'id', NEW.id,
        'title', NEW.title,
        'value', NEW.value,
        'board_id', NEW.board_id,
        'board_name', board_name,
        -- Ordem intencional: from -> to (fica mais legível em ferramentas como n8n)
        'from_stage_id', OLD.stage_id,
        'from_stage_label', from_label,
        'to_stage_id', NEW.stage_id,
        'to_stage_label', to_label,
        'contact_id', NEW.contact_id
      ),
      'contact', jsonb_build_object(
        'name', contact_name,
        'phone', contact_phone,
        'email', contact_email
      ),
      -- story 2.50 — o que o n8n precisa para buscar as mensagens.
      -- Os dois podem vir null: o webhook sai assim mesmo.
      'conversation', jsonb_build_object(
        'id', conversation_id,
        'gptmaker_chat_id', gptmaker_chat_id
      )
    );

    INSERT INTO public.webhook_events_out (organization_id, event_type, payload, deal_id, from_stage_id, to_stage_id)
    VALUES (NEW.organization_id, 'deal.stage_changed', payload, NEW.id, OLD.stage_id, NEW.stage_id)
    RETURNING id INTO event_id;

    INSERT INTO public.webhook_deliveries (organization_id, endpoint_id, event_id, status)
    VALUES (NEW.organization_id, endpoint.id, event_id, 'queued')
    RETURNING id INTO delivery_id;

    -- Dispara HTTP async (MVP)
    BEGIN
      SELECT net.http_post(
        url := endpoint.url,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'X-Webhook-Secret', endpoint.secret,
          'Authorization', ('Bearer ' || endpoint.secret)
        ),
        body := payload
      ) INTO req_id;

      UPDATE public.webhook_deliveries
        SET request_id = req_id
      WHERE id = delivery_id;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.webhook_deliveries
        SET status = 'failed',
            error = SQLERRM
      WHERE id = delivery_id;
    END;
  END LOOP;

  RETURN NEW;
END;
$$;

comment on function public.notify_deal_stage_changed() is
  'Webhook outbound de deal.stage_changed. Story 2.50 — passou a (a) disparar '
  'somente quando o estágio de DESTINO tem board_stages.pontua_lead = true e '
  '(b) carregar o bloco conversation (id + gptmaker_chat_id) que o n8n usa como '
  'context_id na API do GPT Maker. A busca da conversa vive em bloco EXCEPTION '
  'próprio: esta função é AFTER UPDATE no caminho quente do board, e perder o '
  'arrasto do card é pior do que perder o enriquecimento.';

-- ============================================================================
-- 4. Desligar a fila para a organização (decisão do Filipe, 01/09)
-- ============================================================================
-- ⚠️ UPDATE EXPLÍCITO, não só o DEFAULT da coluna. O `default true` não desliga
--    nada em linha que já existe — sem este UPDATE os 91 `failed` continuariam
--    crescendo a cada card movido.
--
-- A flag NASCE DESLIGADA por decisão do dono: o sangramento é medido (91 itens
-- em failed, eram 31 em 24/08; 6 falhas só em 01/09; 100% "prepayment credits
-- are depleted"). Desligar estanca.
--
-- Organização: 83160646-16a0-4cb7-9067-7ce7ef34ff50 (única linha de
-- organization_settings no banco, lida em 02/09).

update public.organization_settings
   set pontuacao_automatica_habilitada = false,
       updated_at = now()
 where organization_id = '83160646-16a0-4cb7-9067-7ce7ef34ff50';

-- ============================================================================
-- 5. Task D — o cadastro do endpoint NÃO vai nesta migration
-- ============================================================================
-- O INSERT abaixo fica COMENTADO de propósito. Ele depende de dois valores que
-- não existem ainda e que NUNCA podem entrar no repositório:
--
--   • a URL do webhook de produção do fluxo n8n "05- Transferência"
--     (3WO6BcG8M9jVGlnY);
--   • o `secret` compartilhado — gerado fora do chat, aplicado à mão no SQL
--     Editor do Supabase e guardado no cofre de segredos do Filipe.
--
-- ⚠️ Migration é arquivo versionado. Segredo em migration é segredo vazado, e
--    push é irreversível para efeito de vazamento. Por isso o valor real entra
--    manualmente, e desta story só sai o registro de QUE o endpoint existe e
--    ONDE o segredo está guardado — nunca o valor.
--
-- Template a executar à mão (substituir os dois placeholders):
--
--   insert into public.integration_outbound_endpoints
--     (organization_id, name, url, secret, events, active)
--   values (
--     '83160646-16a0-4cb7-9067-7ce7ef34ff50',
--     'n8n — Transferência (extração + pontuação)',
--     '<URL DO WEBHOOK N8N>',
--     '<SECRET GERADO FORA DO REPOSITÓRIO>',
--     array['deal.stage_changed'],
--     true
--   );
--
-- Depois de executar, o read-back da Rule 7 (ler de volta o que ficou gravado,
-- em vez de confiar no "OK" do executor):
--
--   select id, name, url, active, events
--     from public.integration_outbound_endpoints
--    where organization_id = '83160646-16a0-4cb7-9067-7ce7ef34ff50';
--
-- (a coluna `secret` fica de fora da consulta de propósito.)
