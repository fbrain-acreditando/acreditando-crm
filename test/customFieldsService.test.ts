/**
 * Testes do serviço de campos personalizados (`lib/supabase/customFields.ts`).
 *
 * Contexto do bug que originou este serviço: a tabela `custom_field_definitions`
 * existia no schema com RLS, mas a UI nunca a lia nem gravava — Configurações
 * salvava em localStorage e o board/modal recebiam `[]` hardcoded. Estes testes
 * cobrem a canalização e as duas regras que, se quebrarem, corrompem dado em
 * silêncio: a derivação da `key` e a estabilidade dela no update.
 *
 * Estratégia de mock: `vi.mock` do client Supabase. Nenhuma chamada real.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const FIELD_ID = 'd4e5f6a7-b8c9-4d0e-8f1a-b2c3d4e5f6a7';
const ORG_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5';
const USER_ID = 'b2c3d4e5-f6a7-4b8c-9d0e-f1a2b3c4d5e6';

const builder = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  order: vi.fn(),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
  single: vi.fn(),
  maybeSingle: vi.fn(),
};

const profilesBuilder = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  maybeSingle: vi.fn(async () => ({ data: { organization_id: ORG_ID }, error: null })),
};

const mockSupabase = {
  from: vi.fn((table: string) => (table === 'profiles' ? profilesBuilder : builder)),
  auth: {
    getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } } })),
  },
};

vi.mock('@/lib/supabase/client', () => ({
  get supabase() {
    return mockSupabase;
  },
}));

import { customFieldsService, deriveFieldKey } from '@/lib/supabase/customFields';

beforeEach(() => {
  vi.clearAllMocks();
  mockSupabase.from.mockImplementation((table: string) =>
    table === 'profiles' ? profilesBuilder : builder
  );
  profilesBuilder.select.mockReturnThis();
  profilesBuilder.eq.mockReturnThis();
  profilesBuilder.maybeSingle.mockResolvedValue({
    data: { organization_id: ORG_ID },
    error: null,
  });
  builder.select.mockReturnThis();
  builder.eq.mockReturnThis();
  builder.insert.mockReturnThis();
  builder.update.mockReturnThis();
  builder.delete.mockReturnThis();
});

describe('deriveFieldKey', () => {
  it('remove acentos e devolve camelCase', () => {
    // Guarda o range de combining marks (U+0300–U+036F) da normalização NFD:
    // se ele quebrar, a chave sai com lixo e o valor gravado no deal órfãos.
    expect(deriveFieldKey('Tipo de Lesão')).toBe('tipoDeLesao');
    expect(deriveFieldKey('Região de São Paulo')).toBe('regiaoDeSaoPaulo');
    expect(deriveFieldKey('Tempo de lesão')).toBe('tempoDeLesao');
  });

  it('não deixa dígito virar acento removido', () => {
    expect(deriveFieldKey('Estrela 1-5')).toBe('estrela15');
    expect(deriveFieldKey('CID 10')).toBe('cid10');
  });

  it('colapsa separadores e espaços repetidos', () => {
    expect(deriveFieldKey('  já   fez / reabilitação?  ')).toBe('jaFezReabilitacao');
  });

  it('nunca devolve string vazia', () => {
    expect(deriveFieldKey('???')).toMatch(/^campo\d+$/);
  });
});

describe('customFieldsService.getAll', () => {
  it('filtra por entity_type e transforma as linhas', async () => {
    builder.order.mockResolvedValueOnce({
      data: [
        {
          id: FIELD_ID,
          organization_id: ORG_ID,
          key: 'tipoDeLesao',
          label: 'Tipo de Lesão',
          type: 'select',
          options: ['Medular', 'AVC'],
          entity_type: 'deal',
          created_at: '2026-07-27T09:00:00Z',
        },
      ],
      error: null,
    });

    const { data, error } = await customFieldsService.getAll('deal');

    expect(error).toBeNull();
    expect(builder.eq).toHaveBeenCalledWith('entity_type', 'deal');
    expect(data).toEqual([
      {
        id: FIELD_ID,
        key: 'tipoDeLesao',
        label: 'Tipo de Lesão',
        type: 'select',
        options: ['Medular', 'AVC'],
      },
    ]);
  });

  it('omite options quando a lista vem vazia ou nula', async () => {
    builder.order.mockResolvedValueOnce({
      data: [
        {
          id: FIELD_ID,
          organization_id: ORG_ID,
          key: 'tempoDeLesao',
          label: 'Tempo de lesão',
          type: 'text',
          options: null,
          entity_type: 'deal',
          created_at: '2026-07-27T09:00:00Z',
        },
      ],
      error: null,
    });

    const { data } = await customFieldsService.getAll();
    expect(data[0]).not.toHaveProperty('options');
  });

  it('cai para text quando o banco tem um type desconhecido', async () => {
    builder.order.mockResolvedValueOnce({
      data: [
        {
          id: FIELD_ID,
          organization_id: ORG_ID,
          key: 'x',
          label: 'X',
          type: 'rating',
          options: null,
          entity_type: 'deal',
          created_at: '2026-07-27T09:00:00Z',
        },
      ],
      error: null,
    });

    const { data } = await customFieldsService.getAll();
    expect(data[0].type).toBe('text');
  });

  it('devolve lista vazia e o erro quando a query falha', async () => {
    builder.order.mockResolvedValueOnce({ data: null, error: new Error('boom') });

    const { data, error } = await customFieldsService.getAll();
    expect(data).toEqual([]);
    expect(error).toBeInstanceOf(Error);
  });
});

describe('customFieldsService.create', () => {
  it('deriva a key e grava a organização', async () => {
    builder.single.mockResolvedValueOnce({
      data: {
        id: FIELD_ID,
        organization_id: ORG_ID,
        key: 'tipoDeLesao',
        label: 'Tipo de Lesão',
        type: 'select',
        options: ['Medular'],
        entity_type: 'deal',
        created_at: '2026-07-27T09:00:00Z',
      },
      error: null,
    });

    const { data, error } = await customFieldsService.create({
      label: 'Tipo de Lesão',
      type: 'select',
      options: ['Medular'],
    });

    expect(error).toBeNull();
    expect(data?.key).toBe('tipoDeLesao');
    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'tipoDeLesao',
        label: 'Tipo de Lesão',
        type: 'select',
        options: ['Medular'],
        entity_type: 'deal',
        organization_id: ORG_ID,
      })
    );
  });

  it('zera options quando o tipo não é select', async () => {
    builder.single.mockResolvedValueOnce({
      data: {
        id: FIELD_ID,
        organization_id: ORG_ID,
        key: 'tempoDeLesao',
        label: 'Tempo de lesão',
        type: 'text',
        options: null,
        entity_type: 'deal',
        created_at: '2026-07-27T09:00:00Z',
      },
      error: null,
    });

    await customFieldsService.create({
      label: 'Tempo de lesão',
      type: 'text',
      options: ['ignorado'],
    });

    expect(builder.insert).toHaveBeenCalledWith(expect.objectContaining({ options: null }));
  });

  it('recusa rótulo vazio sem chamar o banco', async () => {
    const { data, error } = await customFieldsService.create({ label: '   ', type: 'text' });

    expect(data).toBeNull();
    expect(error?.message).toMatch(/obrigat/i);
    expect(builder.insert).not.toHaveBeenCalled();
  });
});

describe('customFieldsService.update', () => {
  it('NUNCA altera a key — ela é o vínculo com deals.custom_fields', async () => {
    builder.eq.mockResolvedValueOnce({ error: null });

    await customFieldsService.update(FIELD_ID, { label: 'Tipo da lesão (novo rótulo)' });

    const payload = builder.update.mock.calls[0][0];
    expect(payload).not.toHaveProperty('key');
    expect(payload.label).toBe('Tipo da lesão (novo rótulo)');
  });

  it('limpa as options ao sair de select', async () => {
    builder.eq.mockResolvedValueOnce({ error: null });

    await customFieldsService.update(FIELD_ID, { type: 'text' });

    expect(builder.update.mock.calls[0][0]).toMatchObject({ type: 'text', options: null });
  });

  it('não chama o banco quando não há nada a atualizar', async () => {
    const { error } = await customFieldsService.update(FIELD_ID, {});

    expect(error).toBeNull();
    expect(builder.update).not.toHaveBeenCalled();
  });

  it('recusa rótulo vazio', async () => {
    const { error } = await customFieldsService.update(FIELD_ID, { label: '  ' });

    expect(error?.message).toMatch(/obrigat/i);
    expect(builder.update).not.toHaveBeenCalled();
  });
});

describe('customFieldsService.delete', () => {
  it('apaga pelo id sanitizado', async () => {
    builder.eq.mockResolvedValueOnce({ error: null });

    const { error } = await customFieldsService.delete(FIELD_ID);

    expect(error).toBeNull();
    expect(builder.delete).toHaveBeenCalled();
    expect(builder.eq).toHaveBeenCalledWith('id', FIELD_ID);
  });
});
