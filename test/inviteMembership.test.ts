/**
 * Story 2.11 — o convite passa a carregar a unidade de negócio.
 *
 * O defeito que estes testes travam foi MEDIDO em produção em 06/08: um usuário
 * `vendedor` recém-criado via convite via **0 de 639 conversas**, porque o aceite
 * criava o perfil e nenhum vínculo em `business_unit_members`. A RLS de
 * `messaging_conversations` exige (admin) OU (membro da unidade da conversa).
 *
 * Nada disso produzia erro: nem no banco, nem na tela, nem no console.
 */
import { describe, expect, it } from 'vitest';
import { decideInviteMembership } from '@/lib/invites/membership';

const ORG_A = 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5';
const ORG_B = 'b2c3d4e5-f6a7-4b8c-9d0e-f1a2b3c4d5e6';
const UNIT_A = 'c3d4e5f6-a7b8-4c9d-8e0f-a1b2c3d4e5f6';

describe('decideInviteMembership', () => {
  it('vincula quando o convite diz a unidade e ela é da mesma organização', () => {
    const decision = decideInviteMembership({
      inviteBusinessUnitId: UNIT_A,
      inviteOrganizationId: ORG_A,
      unit: { id: UNIT_A, organization_id: ORG_A },
    });

    expect(decision).toEqual({ attach: true, businessUnitId: UNIT_A });
  });

  it('NÃO vincula quando o convite não traz unidade — ausência não concede acesso', () => {
    // Este é o comportamento anterior à story, agora deliberado em vez de acidental.
    // Um fallback do tipo "se só existe uma unidade, usa ela" foi descartado: passaria
    // a conceder acesso a conversas em todo convite futuro, sem ninguém ter pedido.
    const decision = decideInviteMembership({
      inviteBusinessUnitId: null,
      inviteOrganizationId: ORG_A,
      unit: { id: UNIT_A, organization_id: ORG_A },
    });

    expect(decision).toEqual({ attach: false, reason: 'no_unit' });
  });

  it('NÃO vincula unidade de OUTRA organização', () => {
    // O aceite roda com service role, que ignora RLS. Sem esta checagem explícita,
    // um convite apontando para unidade alheia entregaria conversas de outra empresa.
    const decision = decideInviteMembership({
      inviteBusinessUnitId: UNIT_A,
      inviteOrganizationId: ORG_A,
      unit: { id: UNIT_A, organization_id: ORG_B },
    });

    expect(decision).toEqual({ attach: false, reason: 'org_mismatch' });
  });

  it('NÃO vincula quando a unidade não existe mais (FK ON DELETE SET NULL não cobre corrida)', () => {
    const decision = decideInviteMembership({
      inviteBusinessUnitId: UNIT_A,
      inviteOrganizationId: ORG_A,
      unit: null,
    });

    expect(decision).toEqual({ attach: false, reason: 'unit_not_found' });
  });

  it('NÃO vincula quando o banco devolve unidade diferente da pedida', () => {
    const decision = decideInviteMembership({
      inviteBusinessUnitId: UNIT_A,
      inviteOrganizationId: ORG_A,
      unit: { id: 'd4e5f6a7-b8c9-4d0e-8f1a-b2c3d4e5f6a7', organization_id: ORG_A },
    });

    expect(decision).toEqual({ attach: false, reason: 'unit_not_found' });
  });

  it('NÃO vincula quando o convite está sem organização', () => {
    // `organization_invites.organization_id` é NULLABLE no schema real.
    const decision = decideInviteMembership({
      inviteBusinessUnitId: UNIT_A,
      inviteOrganizationId: null,
      unit: { id: UNIT_A, organization_id: ORG_A },
    });

    expect(decision).toEqual({ attach: false, reason: 'org_mismatch' });
  });

  it('trata unidade com organização nula como recusa, não como permissão', () => {
    const decision = decideInviteMembership({
      inviteBusinessUnitId: UNIT_A,
      inviteOrganizationId: ORG_A,
      unit: { id: UNIT_A, organization_id: null },
    });

    expect(decision).toEqual({ attach: false, reason: 'org_mismatch' });
  });
});
