/**
 * Testes da extração de CAMPOS PERSONALIZADOS a partir das conversas.
 *
 * As duas regras cobertas aqui são as que, se quebrarem, corrompem dado em
 * silêncio — sem erro, sem log, sem ninguém perceber:
 *
 * 1. NUNCA sobrescrever valor preenchido por pessoa.
 * 2. Valor de `select` fora da lista de opções é DESCARTADO (a IA não pode
 *    inventar categoria, senão filtro e relatório mentem).
 */
import { describe, expect, it } from 'vitest';
import type { CustomFieldDefinition } from '@/types';
import {
  buildCustomFieldsSchema,
  coerceValueForField,
  describeField,
} from '@/lib/ai/extraction/customFields.schemas';

const selectField: CustomFieldDefinition = {
  id: '1',
  key: 'ondeReside',
  label: 'Onde reside',
  type: 'select',
  options: ['Zona Sul de SP', 'Outra região de SP', 'Fora de SP'],
};

const textField: CustomFieldDefinition = {
  id: '2',
  key: 'tipoDeLesao',
  label: 'Tipo de Lesão',
  type: 'text',
};

const numberField: CustomFieldDefinition = {
  id: '3',
  key: 'estrela',
  label: 'Estrela',
  type: 'number',
};

const dateField: CustomFieldDefinition = {
  id: '4',
  key: 'dataDaLesao',
  label: 'Data da lesão',
  type: 'date',
};

describe('buildCustomFieldsSchema', () => {
  it('monta o schema com uma chave por campo definido', () => {
    const schema = buildCustomFieldsSchema([selectField, textField]);
    expect(schema).not.toBeNull();
    expect(Object.keys(schema!.shape).sort()).toEqual(['ondeReside', 'tipoDeLesao']);
  });

  it('devolve null sem definições — o chamador nao deve gastar chamada de modelo', () => {
    expect(buildCustomFieldsSchema([])).toBeNull();
  });

  it('ignora definição sem key', () => {
    const semKey = { ...textField, key: '' } as CustomFieldDefinition;
    expect(buildCustomFieldsSchema([semKey])).toBeNull();
  });

  it('aceita o formato esperado por campo (value/confidence/reasoning)', () => {
    const schema = buildCustomFieldsSchema([textField])!;
    const ok = schema.safeParse({
      tipoDeLesao: { value: 'Lesão medular', confidence: 0.9, reasoning: 'o lead disse' },
    });
    expect(ok.success).toBe(true);

    const semConfianca = schema.safeParse({
      tipoDeLesao: { value: 'x', reasoning: 'y' },
    });
    expect(semConfianca.success).toBe(false);

    const foraDaFaixa = schema.safeParse({
      tipoDeLesao: { value: 'x', confidence: 1.5, reasoning: 'y' },
    });
    expect(foraDaFaixa.success).toBe(false);
  });

  it('aceita value null — "a conversa não disse" é resposta válida', () => {
    const schema = buildCustomFieldsSchema([textField])!;
    const r = schema.safeParse({
      tipoDeLesao: { value: null, confidence: 0.1, reasoning: 'não mencionado' },
    });
    expect(r.success).toBe(true);
  });
});

describe('describeField', () => {
  it('lista as opções para o modelo quando o campo é select', () => {
    const d = describeField(selectField);
    expect(d).toContain('Zona Sul de SP');
    expect(d).toContain('Fora de SP');
  });

  it('não inventa instrução para campo de texto', () => {
    expect(describeField(textField)).toBe('"Tipo de Lesão"');
  });
});

describe('coerceValueForField — a trava contra dado inventado', () => {
  it('aceita opção exata do select', () => {
    expect(coerceValueForField(selectField, 'Zona Sul de SP')).toBe('Zona Sul de SP');
  });

  it('normaliza diferença de caixa para a opção canônica', () => {
    expect(coerceValueForField(selectField, 'zona sul de sp')).toBe('Zona Sul de SP');
  });

  it('DESCARTA opção que não existe na lista', () => {
    // Sem isto, a IA responderia "Zona Norte" e o filtro passaria a mentir.
    expect(coerceValueForField(selectField, 'Zona Norte')).toBeNull();
    expect(coerceValueForField(selectField, 'São Paulo')).toBeNull();
  });

  it('trata null e string vazia como ausência', () => {
    expect(coerceValueForField(textField, null)).toBeNull();
    expect(coerceValueForField(textField, '   ')).toBeNull();
  });

  it('preserva texto livre, aparando espaços', () => {
    expect(coerceValueForField(textField, '  Lesão medular  ')).toBe('Lesão medular');
  });

  it('normaliza número em formato brasileiro', () => {
    expect(coerceValueForField(numberField, '5')).toBe('5');
    expect(coerceValueForField(numberField, '3,5')).toBe('3.5');
    expect(coerceValueForField(numberField, 'R$ 1.500')).toBe('1500');
  });

  it('recusa número que não é número', () => {
    expect(coerceValueForField(numberField, 'cinco')).toBeNull();
  });

  it('exige data em AAAA-MM-DD', () => {
    expect(coerceValueForField(dateField, '2026-07-27')).toBe('2026-07-27');
    expect(coerceValueForField(dateField, '27/07/2026')).toBeNull();
    expect(coerceValueForField(dateField, 'ano passado')).toBeNull();
  });

  it('select sem opções cadastradas aceita texto livre', () => {
    const semOpcoes = { ...selectField, options: undefined } as CustomFieldDefinition;
    expect(coerceValueForField(semOpcoes, 'qualquer coisa')).toBe('qualquer coisa');
  });
});
