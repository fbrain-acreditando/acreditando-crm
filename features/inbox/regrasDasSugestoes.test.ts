/**
 * Story 2.76 (AC7) — regras das sugestões do Inbox (extraídas sem mudar a lógica).
 * Datas de borda do resgate: 29, 30 e 31 dias.
 */
import { describe, expect, it } from 'vitest';
import { ehClienteParaResgate, fazAniversarioNoMes } from './regrasDasSugestoes';

const DIA = 24 * 60 * 60 * 1000;
const AGORA = Date.parse('2026-11-17T12:00:00.000Z');
const LIMITE = AGORA - 30 * DIA; // "há 30 dias", como o controller calcula
const ha = (dias: number) => new Date(AGORA - dias * DIA).toISOString();

const cliente = (extra: Record<string, unknown> = {}) => ({
  status: 'ACTIVE',
  stage: 'CUSTOMER',
  createdAt: ha(400),
  lastInteraction: undefined as string | undefined,
  lastPurchaseDate: undefined as string | undefined,
  ...extra,
});

describe('ehClienteParaResgate (story 2.76, AC7)', () => {
  it('interação há 29 dias → não', () => {
    expect(ehClienteParaResgate(cliente({ lastInteraction: ha(29) }), LIMITE)).toBe(false);
  });
  it('interação há exatamente 30 dias → não (o limite não é "antes")', () => {
    expect(ehClienteParaResgate(cliente({ lastInteraction: ha(30) }), LIMITE)).toBe(false);
  });
  it('interação há 31 dias → sim', () => {
    expect(ehClienteParaResgate(cliente({ lastInteraction: ha(31) }), LIMITE)).toBe(true);
  });
  it('sem histórico, criado há 31 dias → sim', () => {
    expect(ehClienteParaResgate(cliente({ createdAt: ha(31) }), LIMITE)).toBe(true);
  });
  it('sem histórico, criado há 29 dias → não (carência)', () => {
    expect(ehClienteParaResgate(cliente({ createdAt: ha(29) }), LIMITE)).toBe(false);
  });
  it('interação velha mas compra há 5 dias → não (vale a mais recente)', () => {
    expect(ehClienteParaResgate(cliente({ lastInteraction: ha(90), lastPurchaseDate: ha(5) }), LIMITE)).toBe(false);
  });
  it('só compra, há 40 dias → sim', () => {
    expect(ehClienteParaResgate(cliente({ lastPurchaseDate: ha(40) }), LIMITE)).toBe(true);
  });
  it('lead ou inativo → nunca', () => {
    expect(ehClienteParaResgate(cliente({ stage: 'LEAD', lastInteraction: ha(90) }), LIMITE)).toBe(false);
    expect(ehClienteParaResgate(cliente({ status: 'INACTIVE', lastInteraction: ha(90) }), LIMITE)).toBe(false);
  });
});

describe('fazAniversarioNoMes', () => {
  it('compara o mês do AAAA-MM-DD', () => {
    expect(fazAniversarioNoMes({ birthDate: '1990-11-03' }, 11)).toBe(true);
    expect(fazAniversarioNoMes({ birthDate: '1990-12-03' }, 11)).toBe(false);
    expect(fazAniversarioNoMes({ birthDate: undefined }, 11)).toBe(false);
  });
});
