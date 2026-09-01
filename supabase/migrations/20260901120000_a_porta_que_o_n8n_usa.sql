-- Story 2.49 — a porta que o n8n usa.
--
-- ============================================================================
-- DE ONDE VEIO
-- ============================================================================
-- A IA interna do CRM está parada desde 18/08 (crédito do Google esgotado): a
-- fila `ai_pending_lead_scores` acumulou 91 itens em `failed` sem uma única
-- resposta de modelo para colocar dentro do mecanismo que as stories 2.41 a
-- 2.44 construíram.
--
-- Enquanto isso, o workflow n8n "05- Transferência" (3WO6BcG8M9jVGlnY) JÁ faz
-- o trabalho todo dia, com chave própria da OpenAI, e escreve o resultado num
-- Google Sheets. O dado existe, é pago e morre numa planilha.
--
-- 📌 Esta migration não cria inteligência nenhuma: abre a PORTA para o que já
--    está pronto entrar no CRM.
--
-- ============================================================================
-- 1. O CHECK que hoje REJEITA 'n8n'
-- ============================================================================
-- Definição lida no banco de produção antes de escrever esta migration:
--
--   deals_lead_score_source_check
--     CHECK (((lead_score_source IS NULL)
--             OR (lead_score_source = ANY (ARRAY['auto'::text, 'manual'::text]))))
--
-- ⇒ QUALQUER POST em /api/public/v1/deals/{dealId}/ai-extraction que traga nota
--   falha no CHECK enquanto esta migration não for aplicada. Não é detalhe de
--   arrumação: é o item que separa "funciona no teste" de "funciona em produção".
--
-- Por que 'n8n' entra como VALOR NOVO e não reaproveita 'auto':
--   • 'auto' significa "a fila interna pontuou, na régua do CRM"
--     (critérios atingidos / critérios conhecíveis);
--   • 'n8n'  significa "um modelo externo pontuou, na régua dele" (1 a 5 por
--     julgamento).
--   Um "3" de cada lado NÃO quer dizer a mesma coisa. Guardar os dois sob o
--   mesmo rótulo tornaria impossível, daqui a três meses, separar as duas
--   populações sem arqueologia — e é exatamente o tipo de silêncio que a story
--   2.44 custou caro para descobrir.
--
-- A permissão de NULL é PRESERVADA de propósito: card nunca pontuado tem a
-- coluna NULL, e é a maioria da base.
--
-- Idempotente: DROP IF EXISTS + ADD.

alter table public.deals
  drop constraint if exists deals_lead_score_source_check;

alter table public.deals
  add constraint deals_lead_score_source_check
  check (
    lead_score_source is null
    or lead_score_source = any (array['auto'::text, 'manual'::text, 'n8n'::text])
  );

-- ============================================================================
-- 2. Idempotência da API pública
-- ============================================================================
-- O n8n faz retry. Sem esta tabela, um retry de rede grava a nota e os campos
-- DUAS vezes — e na segunda o card já não está mais em branco, então a regra
-- "não sobrescreve campo preenchido" transforma o retry numa resposta
-- silenciosamente diferente da primeira.
--
-- O fluxo espelha `supabase/functions/webhook-in/index.ts:209-249`:
--   INSERT primeiro → violação de unique → SELECT →
--   request_hash igual  = replay (devolve a resposta guardada)
--   request_hash difere = 409 IDEMPOTENCY_CONFLICT
--
-- INSERT-primeiro (e não "SELECT, se não existir INSERT") porque só o unique do
-- banco é atômico: dois retries simultâneos passariam os dois pelo SELECT.

create table if not exists public.public_api_idempotency (
  id               uuid        primary key default gen_random_uuid(),
  organization_id  uuid        not null references organizations(id) on delete cascade,
  -- Rota que recebeu a chamada. Faz parte da chave para que a mesma
  -- Idempotency-Key usada em dois endpoints diferentes não colida.
  endpoint         text        not null,
  idempotency_key  text        not null,
  -- Hash do corpo. É o que separa REPLAY (mesmo corpo ⇒ devolve o guardado) de
  -- CONFLITO (corpo diferente na mesma chave ⇒ 409). Sem ele, um bug do
  -- chamador que reusa a chave com outro payload passaria despercebido.
  request_hash     text        not null,
  response_status  integer     not null,
  response_body    jsonb       not null,
  created_at       timestamptz not null default now()
);

comment on table public.public_api_idempotency is
  'Story 2.49 — memória de idempotência da API pública. Guarda a RESPOSTA de '
  'cada (organização, endpoint, Idempotency-Key) para que o retry do n8n '
  'devolva o mesmo resultado sem escrever no deal uma segunda vez. '
  'Espelha o padrão de dedupe de webhook_events_in (webhook-in:209-249).';

comment on column public.public_api_idempotency.request_hash is
  'Hash SHA-256 do corpo canonicalizado. Igual = replay; diferente = 409.';

-- A chave do registro. Unique é o que torna o INSERT-primeiro seguro sob
-- concorrência.
create unique index if not exists public_api_idempotency_org_endpoint_key_uidx
  on public.public_api_idempotency (organization_id, endpoint, idempotency_key);

-- RLS LIGADA E SEM POLICY, de propósito.
--
-- Tabela sem policy com RLS ligada = ninguém enxerga, exceto `service_role`
-- (que ignora RLS). É exatamente o que se quer: esta tabela é infraestrutura da
-- API pública, guarda corpo de resposta e nunca deve chegar ao browser de
-- ninguém. Uma policy permissiva aqui seria vazamento entre organizações; uma
-- policy restritiva seria código morto, porque nenhum cliente autenticado lê
-- esta tabela.
alter table public.public_api_idempotency enable row level security;

-- Consulta de manutenção: purgar registros antigos (não há job automático nesta
-- story — a tabela cresce devagar e o corte é decisão de operação).
create index if not exists public_api_idempotency_created_at_idx
  on public.public_api_idempotency (created_at);
