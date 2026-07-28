/**
 * Testes do lookup contato → deal (`dealsService.getLatestIdByContact`).
 *
 * Contexto do bug que originou isto: os dois caminhos de navegação entre o card
 * do lead e a conversa de WhatsApp existiam na tela e nenhum funcionava. O botão
 * "Deals" da conversa navegava para `/boards?contact=<id>` — parâmetro que nada
 * no repo lia — enquanto `/boards` só sabe abrir card por `?deal=<id>`. Faltava
 * exatamente esta peça: resolver contato → deal.
 *
 * Não há FK entre `deals` e `messaging_conversations`; o elo é `contacts.id`, e
 * um contato pode ter MAIS DE UM deal. Por isso o desempate ("o mais recente")
 * é regra de negócio, e precisa ser idêntico ao que a edge function usa ao
 * religar a extração de campos (`messaging-webhook-gptmaker/index.ts:394-403`).
 * Se divergirem, a extração preenche um deal e a navegação abre outro.
 *
 * Estratégia de mock: `vi.mock` do client Supabase. Nenhuma chamada real.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5';
const USER_ID = 'b2c3d4e5-f6a7-4b8c-9d0e-f1a2b3c4d5e6';
const CONTACT_ID = 'c3d4e5f6-a7b8-4c9d-8e0f-a1b2c3d4e5f6';
const DEAL_RECENTE = 'd4e5f6a7-b8c9-4d0e-8f1a-b2c3d4e5f6a7';

const dealsBuilder = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  is: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  maybeSingle: vi.fn(),
};

const profilesBuilder = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  maybeSingle: vi.fn(async () => ({ data: { organization_id: ORG_ID }, error: null })),
};

const mockSupabase = {
  from: vi.fn((table: string) => (table === 'profiles' ? profilesBuilder : dealsBuilder)),
  auth: {
    getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } } })),
  },
};

vi.mock('@/lib/supabase/client', () => ({
  get supabase() {
    return mockSupabase;
  },
}));

import { dealsService } from '@/lib/supabase/deals';

beforeEach(() => {
  vi.clearAllMocks();
  mockSupabase.from.mockImplementation((table: string) =>
    table === 'profiles' ? profilesBuilder : dealsBuilder
  );
  profilesBuilder.select.mockReturnThis();
  profilesBuilder.eq.mockReturnThis();
  profilesBuilder.maybeSingle.mockResolvedValue({
    data: { organization_id: ORG_ID },
    error: null,
  });
  dealsBuilder.select.mockReturnThis();
  dealsBuilder.eq.mockReturnThis();
  dealsBuilder.is.mockReturnThis();
  dealsBuilder.order.mockReturnThis();
  dealsBuilder.limit.mockReturnThis();
  dealsBuilder.maybeSingle.mockResolvedValue({ data: { id: DEAL_RECENTE }, error: null });
});

describe('getLatestIdByContact — resolve o card do lead a partir do contato', () => {
  it('devolve o id do deal do contato', async () => {
    const { data, error } = await dealsService.getLatestIdByContact(CONTACT_ID);

    expect(error).toBeNull();
    expect(data).toBe(DEAL_RECENTE);
    expect(mockSupabase.from).toHaveBeenCalledWith('deals');
  });

  it('contato SEM deal devolve null, não erro — a tela avisa em vez de quebrar', async () => {
    dealsBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });

    const { data, error } = await dealsService.getLatestIdByContact(CONTACT_ID);

    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it('propaga erro do banco em vez de fingir "contato sem deal"', async () => {
    const falha = new Error('permission denied');
    dealsBuilder.maybeSingle.mockResolvedValue({ data: null, error: falha });

    const { data, error } = await dealsService.getLatestIdByContact(CONTACT_ID);

    expect(data).toBeNull();
    expect(error).toBe(falha);
  });

  it('contactId inválido não chega ao banco', async () => {
    const { data, error } = await dealsService.getLatestIdByContact('não-é-uuid');

    expect(data).toBeNull();
    expect(error).toBeInstanceOf(Error);
    expect(mockSupabase.from).not.toHaveBeenCalledWith('deals');
  });

  /**
   * Estes três blindam o critério de desempate. Se alguém trocar a ordenação ou
   * remover o filtro de deletados, a navegação passa a abrir um card diferente
   * do que a extração de campos preencheu — divergência silenciosa.
   */
  it('ignora deal deletado (soft delete)', async () => {
    await dealsService.getLatestIdByContact(CONTACT_ID);
    expect(dealsBuilder.is).toHaveBeenCalledWith('deleted_at', null);
  });

  it('desempata pelo MAIS RECENTE — mesmo critério da edge function', async () => {
    await dealsService.getLatestIdByContact(CONTACT_ID);
    expect(dealsBuilder.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(dealsBuilder.limit).toHaveBeenCalledWith(1);
  });

  it('filtra por organização além do RLS (defense-in-depth)', async () => {
    await dealsService.getLatestIdByContact(CONTACT_ID);
    expect(dealsBuilder.eq).toHaveBeenCalledWith('contact_id', CONTACT_ID);
    expect(dealsBuilder.eq).toHaveBeenCalledWith('organization_id', ORG_ID);
  });
});
