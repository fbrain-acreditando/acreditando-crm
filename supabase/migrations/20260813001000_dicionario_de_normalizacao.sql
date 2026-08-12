-- Story 2.18b — o dicionário que traduz "Sapopemba" em "capital".
--
-- ============================================================================
-- POR QUE UMA TABELA DE VALORES, E NÃO IA POR DEAL
-- ============================================================================
-- Medido: 198 valores distintos nos 4 campos (`ondeReside` 66, `haQuantoTempo`
-- 55, `paraQuemE` 42, `jaFezReabilitacao` 35). Classificar por deal custaria
-- 318 × 4 chamadas e cresceria para sempre; classificar VALOR custa 198, uma vez.
--
-- Mas o motivo principal não é custo, é auditoria: um dicionário cabe numa tela.
-- Se `Cotia São Paulo` for classificado como capital, isso é **uma linha errada
-- que dá para ler e corrigir** — e a correção re-deriva para todos os deals que
-- usam aquela frase. Com IA por deal, o mesmo erro vira viés espalhado por
-- centenas de linhas que ninguém relê.
--
-- E preserva o "fora de escopo" da story 2.18: a IA traduz FRASE em RÓTULO; a
-- nota continua sendo contagem determinística sobre o rótulo. Normalizar ≠ pontuar.

create table if not exists public.normalizacao_de_criterio (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campo           text not null,
  -- CHAVE canonicalizada. Exigência do @po: sem isto, "Sapopemba", "sapopemba"
  -- e "Sapopemba " viram três linhas, a IA recusta para o mesmo lugar e uma
  -- correção humana numa grafia não alcança as outras.
  -- ⚠️ Limite conhecido e aceito: NÃO remove acento (exigiria a extensão
  -- `unaccent`). "Butantã" e "Butanta" continuam sendo chaves diferentes — cada
  -- uma recebe sua linha, e as duas podem apontar para o mesmo rótulo.
  chave           text not null,
  -- Uma das grafias originais, guardada para quem for auditar entender o que a
  -- pessoa realmente escreveu.
  valor_bruto     text not null,
  rotulo          text not null,
  confianca       numeric,
  -- 'humano' NUNCA é sobrescrito por reprocessamento (AC1). Mesmo princípio do
  -- `lead_score_source = 'manual'` da story 2.18a.
  origem          text not null default 'ia',
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  unique (organization_id, campo, chave)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'normalizacao_origem_check') then
    alter table public.normalizacao_de_criterio
      add constraint normalizacao_origem_check check (origem in ('ia', 'humano'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'normalizacao_campo_check') then
    alter table public.normalizacao_de_criterio
      add constraint normalizacao_campo_check
      check (campo in ('ondeReside', 'haQuantoTempo', 'jaFezReabilitacao', 'paraQuemE'));
  end if;

  -- Rótulo fora da lista é pior que rótulo ausente: entraria calado e o `join`
  -- devolveria um valor que nenhum critério sabe interpretar.
  if not exists (select 1 from pg_constraint where conname = 'normalizacao_rotulo_check') then
    alter table public.normalizacao_de_criterio
      add constraint normalizacao_rotulo_check
      check (rotulo in (
        'capital', 'grande_sp', 'interior_sp', 'outro_estado',
        'menos_de_1_ano', 'de_1_a_3_anos', 'mais_de_3_anos',
        'nunca_fez', 'ja_fez', 'fazendo_agora',
        'propria_pessoa', 'familiar', 'paciente_de_profissional',
        'indefinido'
      ));
  end if;
end;
$$;

-- ============================================================================
-- Canonicalização — a MESMA regra tem de valer no SQL e no TypeScript
-- ============================================================================
-- Se as duas divergirem, o `join` erra silenciosamente e o critério vira
-- "desconhecido" sem ninguém saber por quê. Por isso ela é uma função no banco,
-- e o TS tem um teste que replica os mesmos casos.
create or replace function public.canonicalizar_valor(p_valor text)
returns text
language sql
immutable
as $$
  select nullif(lower(regexp_replace(btrim(coalesce(p_valor, '')), '\s+', ' ', 'g')), '');
$$;

comment on function public.canonicalizar_valor(text) is
  'Story 2.18b — chave do dicionário: minúsculas, sem espaço nas pontas, espaços '
  'internos colapsados. NÃO remove acento (sem extensão unaccent).';

alter table public.normalizacao_de_criterio enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'normalizacao_de_criterio' and policyname = 'normalizacao_org_isolate'
  ) then
    -- Mesmo formato de `custom_field_definitions_org_isolate`: escopo por
    -- organização, uma policy para todos os comandos.
    create policy normalizacao_org_isolate on public.normalizacao_de_criterio
      for all
      using (organization_id = (select p.organization_id from profiles p where p.id = (select auth.uid())))
      with check (organization_id = (select p.organization_id from profiles p where p.id = (select auth.uid())));
  end if;
end;
$$;

create index if not exists idx_normalizacao_lookup
  on public.normalizacao_de_criterio (organization_id, campo, chave);
