/**
 * Story 2.75 (AC8) — o `enriquecerDeals` não engole mais o erro em silêncio.
 * Decisão: registra no console (só a mensagem) e mantém o fallback, para o
 * quadro não ficar em branco por uma falha passageira.
 */
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import type { Deal } from '@/types';

const h = vi.hoisted(() => ({
  contatos: vi.fn(),
  empresas: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  contactsService: { getByIds: h.contatos },
  companiesService: { getByIds: h.empresas },
  boardStagesService: { getAll: vi.fn(async () => ({ data: [], error: null })) },
}));

import { enriquecerDeals } from './enriquecerDeals';

const CONTATO = '11111111-1111-4111-8111-111111111111';
const EMPRESA = '22222222-2222-4222-8222-222222222222';
const card = { id: 'deal-1', contactId: CONTATO, clientCompanyId: EMPRESA, status: 'stage-1' } as unknown as Deal;

describe('enriquecerDeals — erro do getByIds (story 2.75, AC8)', () => {
  let erroNoConsole: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    h.contatos.mockReset();
    h.empresas.mockReset();
    erroNoConsole = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => erroNoConsole.mockRestore());

  it('com sucesso: usa o nome e o e-mail do contato, sem registrar erro', async () => {
    h.contatos.mockResolvedValue({ data: [{ id: CONTATO, name: 'Contato de Teste', email: 'teste@example.com' }], error: null });
    h.empresas.mockResolvedValue({ data: [{ id: EMPRESA, name: 'Empresa de Teste' }], error: null });
    const [view] = await enriquecerDeals([card], { etapas: [] });
    expect(view.contactName).toBe('Contato de Teste');
    expect(view.contactEmail).toBe('teste@example.com');
    expect(view.companyName).toBe('Empresa de Teste');
    expect(erroNoConsole).not.toHaveBeenCalled();
  });

  it('erro nos contatos: registra só a mensagem e mantém o fallback', async () => {
    h.contatos.mockResolvedValue({ data: null, error: new Error('Bad Request') });
    h.empresas.mockResolvedValue({ data: [], error: null });
    const [view] = await enriquecerDeals([card], { etapas: [] });
    expect(view.contactName).toBe('Sem contato');
    expect(view.contactEmail).toBe('');
    expect(erroNoConsole).toHaveBeenCalledTimes(1);
    expect(erroNoConsole.mock.calls[0]).toEqual([
      '[enriquecerDeals] falha ao buscar contatos dos cards:',
      'Bad Request',
    ]);
    // lista branca: nenhum id no registro
    expect(JSON.stringify(erroNoConsole.mock.calls)).not.toContain(CONTATO);
  });

  it('erro nas empresas: registra e mantém "Sem empresa"', async () => {
    h.contatos.mockResolvedValue({ data: [], error: null });
    h.empresas.mockResolvedValue({ data: null, error: new Error('Bad Request') });
    const [view] = await enriquecerDeals([card], { etapas: [] });
    expect(view.companyName).toBe('Sem empresa');
    expect(erroNoConsole).toHaveBeenCalledWith('[enriquecerDeals] falha ao buscar empresas dos cards:', 'Bad Request');
  });

  it('cancelamento (signal abortado) não é registrado como falha', async () => {
    const controller = new AbortController();
    controller.abort();
    h.contatos.mockResolvedValue({ data: null, error: new Error('aborted') });
    h.empresas.mockResolvedValue({ data: null, error: new Error('aborted') });
    await enriquecerDeals([card], { etapas: [], signal: controller.signal });
    expect(erroNoConsole).not.toHaveBeenCalled();
  });
});
