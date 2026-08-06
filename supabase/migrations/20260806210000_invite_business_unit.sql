-- Story 2.11 — O convite passa a carregar a unidade de negócio.
--
-- Antes desta migration, aceitar um convite criava o perfil com o papel certo e
-- NENHUM vínculo com unidade de negócio. Como a RLS de `messaging_conversations`
-- exige (admin) OU (membro da unidade da conversa), um `vendedor` recém-criado
-- abria o CRM e via ZERO conversa — sem erro, sem aviso. O vínculo era um passo
-- manual, feito depois, e esquecê-lo era invisível.
--
-- A coluna é NULLABLE e o vínculo só acontece quando ela está preenchida:
-- concessão de acesso não pode ter comportamento implícito.

ALTER TABLE public.organization_invites
  ADD COLUMN IF NOT EXISTS business_unit_id UUID
  REFERENCES public.business_units(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_organization_invites_business_unit
  ON public.organization_invites(business_unit_id);

COMMENT ON COLUMN public.organization_invites.business_unit_id IS
  'Unidade de negócio que o convidado passa a integrar ao aceitar o convite. NULL = nenhum vínculo é criado.';
