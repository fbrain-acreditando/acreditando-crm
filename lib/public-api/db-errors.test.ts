/**
 * Story 2.51 — classificação de erro de banco (AC3, AC4).
 */
import { describe, expect, it } from 'vitest';
import {
  classifyDbError,
  extractFieldName,
  extractSafePgFields,
  isAmbiguousDbError,
  isTransientDbError,
  messageForDbErrorCode,
} from '@/lib/public-api/db-errors';

describe('isTransientDbError — classe SQLSTATE', () => {
  it.each(['08000', '08006', '08003', '53300', '57014', '57P01'])(
    'considera %s transitório',
    (code) => {
      expect(isTransientDbError({ code, message: 'x' })).toBe(true);
    }
  );

  it.each(['23503', '23505', '23514', '42501', '42P01', '22P02'])(
    'considera %s definitivo',
    (code) => {
      expect(isTransientDbError({ code, message: 'x' })).toBe(false);
    }
  );

  it('classifica por PREFIXO nas classes 08/57 — código novo da classe 08 também retenta', () => {
    expect(isTransientDbError({ code: '08XYZ', message: 'código que ainda não existe' })).toBe(true);
  });

  // ACHADO 7 do QA: disco cheio e memória estourada NÃO passam sozinhos.
  it.each(['53100', '53200'])('não retenta %s — o estado não melhora em 1 segundo', (code) => {
    expect(isTransientDbError({ code, message: 'x' })).toBe(false);
  });
});

describe('isTransientDbError — rede e erro sem código', () => {
  it.each(['fetch failed', 'read ECONNRESET', 'connect ETIMEDOUT 10.0.0.1:5432'])(
    'considera falha de rede transitória: %s',
    (message) => {
      expect(isTransientDbError(new TypeError(message))).toBe(true);
    }
  );

  /**
   * ACHADO 6 do QA: o supabase-js NÃO põe o status HTTP no objeto de erro. Num
   * 5xx de gateway o corpo não é JSON, `JSON.parse` falha e sobra
   * `{ message: '<html>…' }` — sem `code`. Esse é o formato real, e ele tem de
   * ser tratado como passageiro (e ambíguo).
   */
  it('gateway 5xx chega como erro SEM código e é transitório', () => {
    expect(isTransientDbError({ message: '<html><head><title>503 Service Unavailable</title>' })).toBe(true);
  });

  it('falha de rede do postgrest-js (code vazio) é transitória', () => {
    expect(
      isTransientDbError({ message: 'TypeError: fetch failed', details: 'FetchError: ...', hint: '', code: '' })
    ).toBe(true);
  });
});

describe('isAmbiguousDbError — "dá para saber se commitou?"', () => {
  it.each(['57014', '53300'])('%s é inequívoco: não commitou, pode retentar direto', (code) => {
    expect(isAmbiguousDbError({ code, message: 'x' })).toBe(false);
  });

  it.each(['08006', '08007', '08000'])('%s é ambíguo: a conexão caiu, pode ter commitado', (code) => {
    expect(isAmbiguousDbError({ code, message: 'connection failure' })).toBe(true);
  });

  it('fetch failed é ambíguo', () => {
    expect(isAmbiguousDbError(new TypeError('fetch failed'))).toBe(true);
  });

  it('erro sem código é ambíguo', () => {
    expect(isAmbiguousDbError({ message: 'Bad Gateway' })).toBe(true);
  });

  it('erro definitivo nunca é ambíguo — ele não escreveu', () => {
    expect(isAmbiguousDbError({ code: '23503', message: 'fk' })).toBe(false);
  });
});

describe('classifyDbError — mapa de código definitivo → HTTP', () => {
  it('23503 (FK) vira 422 INVALID_REFERENCE com o nome do campo', () => {
    const c = classifyDbError({
      code: '23503',
      message: 'insert or update on table "deals" violates foreign key constraint "deals_board_id_fkey"',
      details: 'Key (board_id)=(b2c3d4e5-f6a7-4b8c-9d0e-f1a2b3c4d5e6) is not present in table "boards".',
    });
    expect(c).toMatchObject({ classe: 'definitivo', status: 422, code: 'INVALID_REFERENCE', campo: 'board_id' });
  });

  it('23505 (unicidade) vira 409', () => {
    expect(classifyDbError({ code: '23505', message: 'duplicate key' })).toMatchObject({ status: 409, code: 'CONFLICT' });
  });

  it('23514 (check) vira 422', () => {
    expect(classifyDbError({ code: '23514', message: 'check' })).toMatchObject({ status: 422, code: 'CHECK_VIOLATION' });
  });

  it('42501 (permissão) vira 403', () => {
    expect(classifyDbError({ code: '42501', message: 'permission denied' })).toMatchObject({ status: 403, code: 'FORBIDDEN' });
  });

  it('transitório fica em 500 DB_ERROR', () => {
    expect(classifyDbError({ code: '57014', message: 'canceling statement due to statement timeout' })).toMatchObject({
      classe: 'transitorio',
      status: 500,
      code: 'DB_ERROR',
    });
  });

  it('código desconhecido é definitivo e cai em 500 DB_ERROR', () => {
    expect(classifyDbError({ code: '22P02', message: 'invalid input syntax' })).toMatchObject({
      classe: 'definitivo',
      status: 500,
      code: 'DB_ERROR',
    });
  });
});

describe('extractFieldName', () => {
  it('extrai da cláusula Key (...)', () => {
    expect(extractFieldName({ details: 'Key (contact_id)=(abc) is not present in table "contacts".' })).toBe('contact_id');
  });

  it('extrai do nome da constraint quando não há details', () => {
    expect(
      extractFieldName({ message: 'violates foreign key constraint "deals_stage_id_fkey"' })
    ).toBe('stage_id');
  });

  it('devolve null quando não dá para saber', () => {
    expect(extractFieldName({ message: 'boom' })).toBeNull();
  });
});

/**
 * ACHADO 4 do QA. A versão anterior era lista NEGRA (`redactPgValues`) e vazava
 * nos três formatos abaixo. Agora é lista BRANCA: nada do texto é copiado a não
 * ser identificador.
 */
describe('extractSafePgFields — 🔒 só identificador sai daqui', () => {
  const NOME = 'Maria Silva';
  const EMAIL = 'maria@x.com';
  const FONE = '11987654321';

  function tudoQueSai(erro: unknown) {
    return JSON.stringify(extractSafePgFields(erro));
  }

  it('Failing row com parênteses ANINHADOS não vaza nada', () => {
    const saida = tudoQueSai({
      code: '23505',
      message: `Failing row contains (uuid, Lead da LP (Instagram), ${NOME}, ${EMAIL}, ${FONE})`,
    });
    expect(saida).not.toContain(NOME);
    expect(saida).not.toContain(EMAIL);
    expect(saida).not.toContain(FONE);
    expect(saida).not.toContain('Instagram');
    expect(JSON.parse(saida).message_suprimida).toBe(true);
  });

  it('"duplicate key (Maria Silva) something" não vaza o nome', () => {
    const saida = tudoQueSai({ code: '23505', message: `duplicate key (${NOME}) something` });
    expect(saida).not.toContain(NOME);
  });

  it('valor entre aspas (invalid input syntax) não vaza o nome', () => {
    const saida = tudoQueSai({ code: '22P02', message: `invalid input syntax for type uuid: "${NOME}"` });
    expect(saida).not.toContain(NOME);
  });

  it('guarda constraint, colunas e relação — o que serve para depurar', () => {
    const campos = extractSafePgFields({
      code: '23503',
      message: 'insert or update on table "deals" violates foreign key constraint "deals_board_id_fkey"',
      details: 'Key (board_id, stage_id)=(abc, def) is not present in table "boards".',
      hint: 'some hint',
    });
    expect(campos).toMatchObject({
      code: '23503',
      constraint: 'deals_board_id_fkey',
      colunas: ['board_id', 'stage_id'],
      relacao: 'deals',
      details_tinha_valor: true,
    });
    expect(JSON.stringify(campos)).not.toContain('abc');
  });

  it('mensagem sem sinal de valor sobrevive (é o que identifica o timeout)', () => {
    const campos = extractSafePgFields({ code: '57014', message: 'canceling statement due to statement timeout' });
    expect(campos.message).toBe('canceling statement due to statement timeout');
    expect(campos.message_suprimida).toBe(false);
    expect(campos.details_tinha_valor).toBe(false);
  });

  it('erro sem nada devolve tudo nulo, sem estourar', () => {
    expect(extractSafePgFields(null)).toMatchObject({ code: null, constraint: null, colunas: null, message: null });
  });
});

describe('messageForDbErrorCode', () => {
  it('inclui o nome do campo quando existe', () => {
    expect(messageForDbErrorCode('INVALID_REFERENCE', 'board_id')).toBe('Invalid reference for field board_id');
  });

  it('cai em mensagem genérica para code desconhecido', () => {
    expect(messageForDbErrorCode('NAO_EXISTE')).toBe('Internal server error');
  });
});
