-- Story 2.56 — "A conversa que nasce partida em dois cards" (AC1 · AC4 · D1 = A)
--
-- ============================================================================
-- O DEFEITO
-- ============================================================================
-- O GPT Maker às vezes identifica o MESMO chat pelo número oculto do WhatsApp
-- (`@lid`) em vez do telefone. O `contextId` muda, o CRM entende "outra pessoa":
-- abre conversa nova, cria contato SEM telefone e gera card novo.
--
-- Caso medido (lead Bruno Nascimento Motta, 21/09/2026): dois registros criados
-- com 7 minutos de diferença — um com as 8 perguntas do cliente (inbound), outro
-- com as 5 respostas da atendente (outbound). NENHUM dos dois mostrava a
-- conversa inteira.
--
-- Escala medida no banco de produção (24/07 a 23/09): 143 conversas com `@lid`,
-- 139 criaram card, 43 "cards espelho" (só outbound), 164 contatos sem telefone,
-- 196 lids distintos.
--
-- ============================================================================
-- POR QUE UMA TABELA DE APELIDOS (D1 = A, decidida pelo Filipe em 23/09)
-- ============================================================================
-- O spike do @analyst (23/09) mediu quatro caminhos de reconciliação. O único
-- que resolve sem inventar vínculo: o PRÓPRIO payload do webhook às vezes traz,
-- no mesmo evento, o `contextId` com `@lid` E um `contactPhone` numérico.
--
--   • 95 dos 196 lids (48%) têm ao menos um evento com telefone numérico;
--   • desses 95, TODOS resolvem para telefone único — ZERO ambiguidade.
--
-- As alternativas foram medidas e descartadas:
--   • rechavear as conversas por telefone (opção B) — migra a chave de TODAS as
--     conversas e quebra justo quando não há telefone (o caso Bruno);
--   • heurística por janela de tempo (±30 min) — 55,2% dos pares são AMBÍGUOS.
--     Usar isso é inventar vínculo, exatamente o que a story 2.53 ensinou a não
--     fazer.
--
-- Esta tabela é ADITIVA: a chave das conversas (`external_contact_id`) não muda,
-- nada é migrado, e desligar a correção é parar de consultá-la.
--
-- ============================================================================
-- POR QUE A FILA DE REVISÃO MORA NA MESMA TABELA
-- ============================================================================
-- D2 = B (decidida pelo Filipe): quando o lid NÃO resolve, a conversa é gravada
-- e o card É criado — mas MARCADO. "Nada pode ficar invisível para quem atende."
--
-- A marcação precisa ser DADO GRAVADO (AC4, item 1), não rótulo montado na tela,
-- para que a story 2.57 leia a fila do banco em vez de recalcular heurística. E
-- a unidade dessa fila é exatamente a mesma desta tabela: UM lid. Uma linha por
-- lid guarda o que a máquina sabe (`phone`, `status`) e o que a revisão vai
-- precisar (`conversation_id`, `deal_id`, `review_reason`).
--
-- ⚠️ NADA ACONTECE SOZINHO. Esta tabela não dispara merge, não apaga card, não
-- move nada. Ela registra. Merge só por confirmação humana — story 2.57.

-- ============================================================================
-- 1. A tabela
-- ============================================================================
create table if not exists public.messaging_contact_aliases (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null references public.organizations(id) on delete cascade,
  channel_id      uuid not null references public.messaging_channels(id) on delete cascade,

  -- O apelido é o `recipient` do `contextId` quando ele é um `@lid`
  -- (ex.: "150439953756312@lid"). Guardado CRU, como veio do fornecedor.
  alias text not null,

  -- Telefone normalizado (+55...) quando a máquina conseguiu resolver.
  phone text,

  -- 'unresolved' → nunca vimos telefone para este lid (o caso Bruno);
  -- 'resolved'   → telefone único, confiável, USADO para reconciliar;
  -- 'ambiguous'  → o mesmo lid apontou para telefones diferentes. NUNCA é usado.
  status text not null default 'unresolved'
    check (status in ('unresolved', 'resolved', 'ambiguous')),

  -- Histórico do conflito. O primeiro telefone NÃO é sobrescrito (AC1): quando
  -- aparece um segundo, o status vira 'ambiguous' e os dois ficam aqui.
  conflicting_phones text[] not null default '{}',

  -- Fila de revisão (AC4) — por que este lid não resolveu.
  -- 'sem-telefone-no-payload' | 'alias-ambiguo'
  review_reason text,
  -- Os ids que a revisão da 2.57 vai precisar.
  conversation_id uuid references public.messaging_conversations(id) on delete set null,
  deal_id         uuid references public.deals(id) on delete set null,

  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  resolved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Idempotência do AC1 nasce AQUI, não no código: o mesmo par visto 50 vezes
-- bate na constraint e vira UPDATE. Sem índice único, a corrida entre duas
-- entregas concorrentes do webhook (medida em 137 ms na story 2.6) cria duas
-- linhas e nenhuma delas falha.
create unique index if not exists messaging_contact_aliases_channel_alias_key
  on public.messaging_contact_aliases (channel_id, alias);

-- A consulta do AC2: "este lid resolve?" — feita a CADA evento `@lid`.
create index if not exists messaging_contact_aliases_lookup_idx
  on public.messaging_contact_aliases (channel_id, alias, status);

-- A consulta da 2.57: "o que está esperando revisão nesta organização?"
create index if not exists messaging_contact_aliases_review_idx
  on public.messaging_contact_aliases (organization_id, status)
  where status <> 'resolved';

comment on table public.messaging_contact_aliases is
  'Story 2.56 — mapa `@lid` → telefone do GPT Maker E fila de identidades não '
  'confirmadas. Uma linha por (channel_id, alias). status=resolved é o único '
  'que reconcilia; ambiguous e unresolved são a fila de revisão da story 2.57. '
  'Nenhum merge automático parte daqui.';

comment on column public.messaging_contact_aliases.status is
  'unresolved = nunca vimos telefone · resolved = telefone único e confiável · '
  'ambiguous = o mesmo lid apontou para telefones diferentes, NUNCA reconcilia.';

comment on column public.messaging_contact_aliases.conflicting_phones is
  'Todos os telefones já vistos para este lid quando houve conflito. O primeiro '
  'NÃO é sobrescrito — sobrescrever apagaria a evidência de que o vínculo é duvidoso.';

-- ============================================================================
-- 2. RLS — leitura pela própria organização, escrita só pelo webhook
-- ============================================================================
alter table public.messaging_contact_aliases enable row level security;

-- A escrita vem da edge function (service role), que ignora RLS. Usuário
-- autenticado só LÊ, e só da própria organização — a story 2.57 vai montar a
-- tela em cima disso.
drop policy if exists "aliases_select_own_org" on public.messaging_contact_aliases;
create policy "aliases_select_own_org"
  on public.messaging_contact_aliases
  for select
  to authenticated
  using (
    organization_id in (
      select organization_id from public.profiles where id = (select auth.uid())
    )
  );

grant select on public.messaging_contact_aliases to authenticated;
grant all    on public.messaging_contact_aliases to service_role;

-- ============================================================================
-- 3. `updated_at` sempre verdadeiro
-- ============================================================================
create or replace function public.messaging_contact_aliases_touch()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists messaging_contact_aliases_touch_trg
  on public.messaging_contact_aliases;
create trigger messaging_contact_aliases_touch_trg
  before update on public.messaging_contact_aliases
  for each row execute function public.messaging_contact_aliases_touch();
