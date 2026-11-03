-- =============================================================================
-- Stories 2.67 e 2.68 — Onde mora (qualquer etapa) + observação da perda
-- (uma migration só para as duas stories, decisão Q4 do Filipe)
-- =============================================================================
--
-- Pedido da Fernanda (áudios de 03/11): anotar onde a pessoa mora assim que
-- ela conta, em qualquer etapa, e deixar uma observação em qualquer motivo de
-- perda ("não tem como vir sozinho"). E (2.68) uma Lista de Perdidos com busca
-- no banco, sem diferenciar maiúscula nem acento.
--
-- O que muda em `deals`: SÓ duas colunas comuns, `lead_location` e `loss_note`.
-- A busca sem acento usa três FUNÇÕES (campos calculados do PostgREST), que
-- calculam o texto na hora da consulta, sem guardar nada na tabela.
--
-- ⛔ C5 — NENHUMA coluna calculada guardada na tabela. Os scripts de restauração da 2.24
--    (`scripts/db/RESTAURAR.mjs`, `scripts/db/ensaio-ciclo.mjs`) fazem
--    `insert into deals select * from jsonb_populate_recordset(null::deals, …)`.
--    Uma coluna calculada faria o Postgres recusar esse INSERT
--    ("cannot insert a non-DEFAULT value into column …"): o backup continuaria
--    sendo feito, mas a restauração pararia. O teste
--    `lib/supabase/ondeMora.test.ts` recusa a palavra no arquivo.
--
-- Por que `translate()` e não a extensão `unaccent`: a extensão existe em
-- produção (T0, 03/11), mas `unaccent()` é STABLE, não IMMUTABLE, e não entra
-- numa função IMMUTABLE nem num índice sem um "embrulho" que depende do esquema
-- onde ela foi instalada. `translate()` é imutável, nativa e cobre o português.
--
-- 🔁 Idempotente e aditiva: `CREATE OR REPLACE`, `IF NOT EXISTS`,
--    `DO … IF NOT EXISTS` e a cópia só onde `lead_location IS NULL`. Sem
--    NOT NULL, sem default, sem RLS nova, sem gatilho novo. `ADD COLUMN`
--    anulável sem default não reescreve a tabela.
--
-- ⚠️ Ordem do deploy (AC12 da 2.67): avisar a sessão grupo-acreditando-27,
--    aplicar e reler ESTA migration com o PR aberto e ANTES do merge (o merge
--    publica o front na Vercel); ensaio do `RESTAURAR.mjs` (linha `ENSAIO OK`)
--    e filtro pela API antes do merge.
-- =============================================================================

-- 1. Normalização para busca: imutável, sem extensão, search_path fixo (R10).
--    As duas cadeias do translate têm o MESMO tamanho (48 letras).
CREATE OR REPLACE FUNCTION public.texto_de_busca(p_valor text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = '' AS $$
  SELECT pg_catalog.nullif(pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.btrim(pg_catalog.translate(coalesce(p_valor, ''),
    'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
    'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn')), '\s+', ' ', 'g')), '');
$$;
COMMENT ON FUNCTION public.texto_de_busca(text) IS 'Stories 2.67/2.68 — minúsculas, sem acento (translate), espaços colapsados. Usada pelos campos calculados lead_location_busca(deals) e loss_reason_chave(deals) e espelhada no front por normalizarTexto(): mudar uma exige mudar a outra.';

-- 2. Colunas digitadas pelo atendimento (as ÚNICAS colunas novas em deals).
--    Vêm ANTES das funções do passo 3: o corpo LANGUAGE sql é validado na
--    criação e precisa de `d.lead_location`.
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS lead_location text;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS loss_note text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deals_lead_location_tamanho') THEN
    ALTER TABLE public.deals ADD CONSTRAINT deals_lead_location_tamanho
      CHECK (lead_location IS NULL OR char_length(lead_location) <= 200);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deals_loss_note_tamanho') THEN
    ALTER TABLE public.deals ADD CONSTRAINT deals_loss_note_tamanho
      CHECK (loss_note IS NULL OR char_length(loss_note) <= 500);
  END IF;
END $$;

-- 3. Campos calculados do PostgREST para a busca da 2.68 (C5, opção A).
--    Funções que recebem a linha de deals: nada é guardado na tabela,
--    e o INSERT ... select * dos scripts de restauração continua valendo.
--    Só aparecem na API quando pedidos pelo nome (não vêm no select=*).
CREATE OR REPLACE FUNCTION public.lead_location_busca(d public.deals)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = '' AS $$
  SELECT public.texto_de_busca(d.lead_location);
$$;
CREATE OR REPLACE FUNCTION public.loss_reason_chave(d public.deals)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = '' AS $$
  SELECT public.texto_de_busca(coalesce(pg_catalog.nullif(pg_catalog.btrim(d.loss_reason), ''), 'Não informado'));
$$;
COMMENT ON FUNCTION public.lead_location_busca(public.deals) IS 'Story 2.68 — campo calculado do PostgREST: texto_de_busca(lead_location). Filtrar com ?lead_location_busca=ilike.*termo*.';
COMMENT ON FUNCTION public.loss_reason_chave(public.deals) IS 'Story 2.68 — campo calculado do PostgREST: texto_de_busca(loss_reason), vazio = "nao informado". Nunca nulo.';

-- 4. Cópia do campo da 2.66 (no T0 de 03/11: 1 linha, no máximo 3 letras).
UPDATE public.deals SET lead_location = btrim(loss_location)
 WHERE lead_location IS NULL AND nullif(btrim(loss_location), '') IS NOT NULL;

COMMENT ON COLUMN public.deals.lead_location IS 'Story 2.67 — onde a pessoa mora, digitado pelo atendimento em qualquer etapa. NÃO é o custom_fields.ondeReside. NULL = não informado.';
COMMENT ON COLUMN public.deals.loss_note IS 'Story 2.67 — observação da perda ATUAL (qualquer motivo). Regravada a cada perda e editável no card; NULL = sem observação.';
COMMENT ON COLUMN public.deals.loss_location IS 'DESCONTINUADA pela story 2.67 — copiada para lead_location. Não gravar. DROP numa story de limpeza, com divergência = 0.';

NOTIFY pgrst, 'reload schema';
