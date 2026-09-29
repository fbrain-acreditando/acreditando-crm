-- =============================================================================
-- Story 2.59 — O formulário que a Fernanda não vê (AC1)
-- =============================================================================
--
-- O formulário instantâneo da Meta `[ACREDITANDO] Qualificação WPP`
-- (form_id 1635930144720093) está no ar desde 25/09 SEM integração com o CRM:
-- 7 de 23 leads pagos não chegaram, e os outros 16 chegaram sem as respostas.
--
-- Esta migration cria, na organização do Acreditando, os 6 campos novos do card
-- (entity_type = 'deal') e o índice único que garante "um envio da Meta = no
-- máximo um card vivo".
--
--   Respostas (2):  quandoPretendeIniciar · faixaDeInvestimentoMensal
--   Rastreio  (4):  origemDoLead · metaLeadgenId · metaCampanha · metaAnuncio
--
-- ⚠️ Os 5 campos que a IA do WhatsApp já preenche (paraQuemE, tipoDeLesao,
--    haQuantoTempo, jaFezReabilitacao, ondeReside) NÃO são tocados: continuam
--    `text`. Trocar para `select` faria a rota descartar toda frase livre que a
--    IA do WhatsApp manda (`customFields.schemas.ts:95-102`).
--
-- ⚠️ P1 (Filipe, 29/09): só os 4 campos de rastreio essenciais. NÃO criar
--    metaEnviadoEm, metaPlataforma, metaFormulario, metaConjunto nem
--    metaRespostasBrutas.
--
-- 🔁 Idempotente: `ON CONFLICT (key, organization_id) DO NOTHING` (UNIQUE de
--    `schema_init.sql:380-390`) e `CREATE UNIQUE INDEX IF NOT EXISTS`. Rodar
--    duas vezes não muda nada. Nada é removido nem alterado.
--
-- 📌 As opções `select` têm de bater com o texto que a rota grava
--    (`lib/meta-form/traducao.ts`), COM acento: o `select` do CRM compara
--    ignorando maiúscula, mas NÃO acento. O teste
--    `test/stories/US-2.59-formulario-meta.test.ts` lê este arquivo e compara.
--
-- Conferido antes (T1.2, somente leitura, 29/09): `custom_field_definitions`
-- tem exatamente as 5 chaves acima — nenhuma das 6 novas colide.
-- =============================================================================

insert into public.custom_field_definitions
  (key, label, type, options, entity_type, organization_id)
values
  -- Respostas novas
  ('quandoPretendeIniciar', 'Quando pretende iniciar', 'select',
     array['Imediatamente', 'Nos próximos 30 dias', 'Ainda estou só pesquisando'],
     'deal', '83160646-16a0-4cb7-9067-7ce7ef34ff50'),
  ('faixaDeInvestimentoMensal', 'Faixa de investimento mensal', 'select',
     array['Até R$ 500', 'R$ 500 a R$ 1.000', 'R$ 1.000 a R$ 2.000',
           'R$ 2.000 a R$ 3.000', 'Acima de R$ 3.000', 'Ainda não sei'],
     'deal', '83160646-16a0-4cb7-9067-7ce7ef34ff50'),
  -- Origem e rastreio (os 4 essenciais, P1)
  ('origemDoLead', 'Origem do lead', 'select',
     array['Formulário Meta', 'LP Acreditando', 'WhatsApp', 'Indicação', 'Outro'],
     'deal', '83160646-16a0-4cb7-9067-7ce7ef34ff50'),
  ('metaLeadgenId', 'Meta · ID do envio', 'text', null,
     'deal', '83160646-16a0-4cb7-9067-7ce7ef34ff50'),
  ('metaCampanha', 'Meta · Campanha', 'text', null,
     'deal', '83160646-16a0-4cb7-9067-7ce7ef34ff50'),
  ('metaAnuncio', 'Meta · Anúncio', 'text', null,
     'deal', '83160646-16a0-4cb7-9067-7ce7ef34ff50')
on conflict (key, organization_id) do nothing;

-- Garantia final de idempotência (AC10): um envio da Meta vira no máximo um
-- card VIVO por organização.
--
-- Índice de EXPRESSÃO sobre o JSONB (sem coluna nova). Parcial:
--   • só onde a chave existe (a grande maioria dos cards não é do formulário);
--   • só card vivo — card excluído (soft delete, story 2.25) não bloqueia.
--
-- ⚠️ A segunda gravação do MESMO id em outro card vira erro 23505. A rota
--    `POST /api/public/v1/meta-form-leads` trata isso lendo de volta o card
--    dono do id ("já processado"), e NÃO como 500 a retentar.
-- ⚠️ 23505 também é o código que o trigger `check_deal_duplicate` usa (mesmo
--    contato, mesmo estágio, card aberto). Por isso a rota nunca conclui
--    "já processado" só pelo código: ela relê pelo leadgen id.
-- ⚠️ Sem CONCURRENTLY: não roda dentro da transação da migration; a tabela
--    `deals` tem ~1.300 linhas e o índice comum trava por milissegundos.
create unique index if not exists deals_meta_leadgen_id_uidx
  on public.deals (organization_id, (custom_fields->>'metaLeadgenId'))
  where custom_fields ? 'metaLeadgenId'
    and deleted_at is null;

comment on index public.deals_meta_leadgen_id_uidx is
  'Story 2.59 — Formulário Meta: um leadgen_id vira no máximo um card vivo por organização. Complementa o Idempotency-Key da API pública (public_api_idempotency).';
