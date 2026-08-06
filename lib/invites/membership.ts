/**
 * Story 2.11 — decisão de vínculo do convidado com a unidade de negócio.
 *
 * Por que isto é uma função pura separada da rota:
 *
 * A RLS de `messaging_conversations` (migration 20260205100000:298-341) libera a
 * conversa para (a) quem é `admin` ou (b) quem tem linha em `business_unit_members`
 * para a unidade DAQUELA conversa. Um `vendedor` sem esse vínculo enxerga ZERO
 * conversa — medido em produção em 06/08: 0 de 639, sem erro e sem log.
 *
 * O vínculo era um passo manual pós-aceite. Esquecê-lo é invisível para quem
 * convidou e indistinguível de "o sistema está quebrado" para quem foi convidado.
 * Trazer a decisão para cá permite testá-la sem subir rota nem banco.
 *
 * A regra é deliberadamente explícita: só vincula quando o convite DIZ a unidade.
 * Um fallback do tipo "se a organização só tem uma unidade, usa ela" foi descartado
 * — concessão de acesso não pode acontecer sem alguém ter pedido.
 */

export type InviteMembershipDecision =
  | { attach: true; businessUnitId: string }
  | { attach: false; reason: 'no_unit' | 'unit_not_found' | 'org_mismatch' };

export interface InviteMembershipInput {
  /** `organization_invites.business_unit_id` — NULL significa "não vincular". */
  inviteBusinessUnitId: string | null | undefined;
  /** `organization_invites.organization_id`. */
  inviteOrganizationId: string | null | undefined;
  /** A unidade lida do banco, ou `null` se não existir. */
  unit: { id: string; organization_id: string | null } | null | undefined;
}

/**
 * Decide se o aceite de um convite deve criar vínculo com unidade de negócio.
 *
 * @param input Dados do convite e da unidade referenciada.
 * @returns A decisão, com o motivo quando não vincula.
 */
export function decideInviteMembership(
  input: InviteMembershipInput
): InviteMembershipDecision {
  const { inviteBusinessUnitId, inviteOrganizationId, unit } = input;

  if (!inviteBusinessUnitId) {
    return { attach: false, reason: 'no_unit' };
  }

  if (!unit || unit.id !== inviteBusinessUnitId) {
    return { attach: false, reason: 'unit_not_found' };
  }

  // Defesa em profundidade: o aceite roda com service role (ignora RLS), então a
  // checagem de organização precisa ser explícita aqui. Sem ela, um convite com
  // unidade de OUTRA organização daria ao convidado acesso a conversas alheias.
  if (!inviteOrganizationId || unit.organization_id !== inviteOrganizationId) {
    return { attach: false, reason: 'org_mismatch' };
  }

  return { attach: true, businessUnitId: unit.id };
}
