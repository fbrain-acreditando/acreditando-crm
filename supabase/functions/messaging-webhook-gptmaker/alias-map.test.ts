/**
 * Testes do mapa de apelidos `@lid → telefone` — story 2.56 (AC1, AC2, AC4, AC5).
 *
 * O cliente falso abaixo **aplica de verdade** o índice único `(channel_id,
 * alias)` e os filtros `eq`. Sem isso, os testes provariam apenas que as funções
 * chamam os métodos certos — não que a idempotência existe, nem que o conflito
 * deixa de reconciliar, que é o que esta story arrisca errar.
 *
 * Os dados vêm do caso real do lead Bruno Nascimento Motta (21/09/2026) e das
 * medições de 23/09, com telefone mascarado.
 */

import { describe, it, expect } from 'vitest';
import {
  registrarAlias,
  resolverAlias,
  marcarIdentidadeNaoConfirmada,
  MOTIVO_SEM_TELEFONE,
  MOTIVO_AMBIGUO,
  ALIAS_TABLE,
  type AliasMapClient,
  type AliasRow,
} from './alias-map';

const ORG = 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5';
const CANAL = 'b2c3d4e5-f6a7-4b8c-9d0e-f1a2b3c4d5e6';

/** O lid do caso Bruno — 5 eventos, todos `assistant`, nenhum com telefone. */
const LID_BRUNO = '150439953756312@lid';
const TELEFONE = '+5511951342931';

// =============================================================================
// CLIENTE FALSO — índice único de verdade
// =============================================================================

interface Linha extends AliasRow {
  organization_id: string;
  channel_id: string;
  [k: string]: unknown;
}

function criarClienteFalso(iniciais: Partial<Linha>[] = []) {
  const linhas: Linha[] = iniciais.map((l, i) => ({
    id: `alias-${i}`,
    organization_id: ORG,
    channel_id: CANAL,
    alias: '',
    phone: null,
    status: 'unresolved',
    conflicting_phones: [],
    conversation_id: null,
    deal_id: null,
    review_reason: null,
    ...l,
  })) as Linha[];

  let proximoId = linhas.length;
  const erros: { insert?: boolean; select?: boolean; update?: boolean } = {};

  const client: AliasMapClient = {
    from(table: string) {
      if (table !== ALIAS_TABLE) throw new Error(`tabela inesperada: ${table}`);

      return {
        select() {
          const filtros: Array<[string, unknown]> = [];
          const q = {
            eq(col: string, val: unknown) {
              filtros.push([col, val]);
              return q;
            },
            async maybeSingle() {
              if (erros.select) return { data: null, error: { message: 'banco fora do ar' } };
              const achada = linhas.find((l) => filtros.every(([c, v]) => l[c] === v));
              return { data: (achada ?? null) as AliasRow | null, error: null };
            },
          };
          return q;
        },

        insert(values: Record<string, unknown>) {
          return {
            select() {
              return {
                async single() {
                  if (erros.insert) return { data: null, error: { message: 'insert falhou' } };
                  // 🔒 O índice único `(channel_id, alias)` — é ELE que dá a
                  // idempotência do AC1, não um `if` do código.
                  const colide = linhas.some(
                    (l) => l.channel_id === values.channel_id && l.alias === values.alias
                  );
                  if (colide) {
                    return {
                      data: null,
                      error: { code: '23505', message: 'duplicate key value' },
                    };
                  }
                  const nova = {
                    id: `alias-${proximoId++}`,
                    conflicting_phones: [],
                    conversation_id: null,
                    deal_id: null,
                    review_reason: null,
                    phone: null,
                    status: 'unresolved',
                    ...values,
                  } as unknown as Linha;
                  linhas.push(nova);
                  return { data: nova as AliasRow, error: null };
                },
              };
            },
          };
        },

        update(values: Record<string, unknown>) {
          const filtros: Array<[string, unknown]> = [];
          const q = {
            eq(col: string, val: unknown) {
              filtros.push([col, val]);
              return q;
            },
            async select() {
              if (erros.update) return { data: null, error: { message: 'update falhou' } };
              const alvo = linhas.filter((l) => filtros.every(([c, v]) => l[c] === v));
              alvo.forEach((l) => Object.assign(l, values));
              return { data: alvo.map((l) => ({ id: l.id })) as AliasRow[], error: null };
            },
          };
          return q;
        },
      };
    },
  } as unknown as AliasMapClient;

  return { client, linhas, erros };
}

const base = { organizationId: ORG, channelId: CANAL };

// =============================================================================
// AC1 — gravação do par
// =============================================================================

describe('AC1 — o mapa lid → telefone', () => {
  it('teste 1: grava o par quando o evento traz lid E telefone numérico', async () => {
    const { client, linhas } = criarClienteFalso();

    const r = await registrarAlias(client, { ...base, alias: LID_BRUNO, phone: TELEFONE });

    expect(r.acao).toBe('criado');
    expect(linhas).toHaveLength(1);
    expect(linhas[0].alias).toBe(LID_BRUNO);
    expect(linhas[0].phone).toBe(TELEFONE);
    expect(linhas[0].status).toBe('resolved');
  });

  it('teste 4: o mesmo par visto duas vezes continua sendo UMA linha', async () => {
    const { client, linhas } = criarClienteFalso();

    await registrarAlias(client, { ...base, alias: LID_BRUNO, phone: TELEFONE });
    const segunda = await registrarAlias(client, { ...base, alias: LID_BRUNO, phone: TELEFONE });

    expect(segunda.acao).toBe('confirmado');
    expect(linhas).toHaveLength(1);
  });

  it('teste 4b: 50 entregas do mesmo par continuam sendo UMA linha', async () => {
    const { client, linhas } = criarClienteFalso();

    for (let i = 0; i < 50; i++) {
      await registrarAlias(client, { ...base, alias: LID_BRUNO, phone: TELEFONE });
    }

    expect(linhas).toHaveLength(1);
    expect(linhas[0].phone).toBe(TELEFONE);
  });

  it('teste 5: lid com DOIS telefones vira ambíguo e NÃO sobrescreve o primeiro', async () => {
    const { client, linhas } = criarClienteFalso();

    await registrarAlias(client, { ...base, alias: LID_BRUNO, phone: TELEFONE });
    const conflito = await registrarAlias(client, {
      ...base,
      alias: LID_BRUNO,
      phone: '+5511999998888',
    });

    expect(conflito.acao).toBe('ambiguo');
    expect(conflito.phone).toBeNull();
    expect(linhas).toHaveLength(1);
    // O primeiro telefone FICA — sobrescrever apagaria a evidência do conflito.
    expect(linhas[0].phone).toBe(TELEFONE);
    expect(linhas[0].status).toBe('ambiguous');
    expect(linhas[0].conflicting_phones).toEqual([TELEFONE, '+5511999998888']);
    expect(linhas[0].review_reason).toBe(MOTIVO_AMBIGUO);
  });

  it('teste 5b: alias ambíguo NÃO volta a resolver, nem vendo o telefone de novo', async () => {
    const { client, linhas } = criarClienteFalso();

    await registrarAlias(client, { ...base, alias: LID_BRUNO, phone: TELEFONE });
    await registrarAlias(client, { ...base, alias: LID_BRUNO, phone: '+5511999998888' });
    const terceira = await registrarAlias(client, { ...base, alias: LID_BRUNO, phone: TELEFONE });

    expect(terceira.acao).toBe('segue-ambiguo');
    expect(linhas[0].status).toBe('ambiguous');

    const lookup = await resolverAlias(client, { channelId: CANAL, alias: LID_BRUNO });
    expect(lookup.phone).toBeNull();
  });

  it('falha de banco no insert NÃO lança — devolve "erro" e o chamador segue', async () => {
    const { client, erros } = criarClienteFalso();
    erros.insert = true;

    const r = await registrarAlias(client, { ...base, alias: LID_BRUNO, phone: TELEFONE });
    expect(r.acao).toBe('erro');
  });
});

// =============================================================================
// AC2 / AC5 — leitura: só `resolved` reconcilia
// =============================================================================

describe('AC2 — o mapa é usado para reusar', () => {
  it('teste 6: alias conhecido devolve o telefone', async () => {
    const { client } = criarClienteFalso([
      { alias: LID_BRUNO, phone: TELEFONE, status: 'resolved' },
    ]);

    const r = await resolverAlias(client, { channelId: CANAL, alias: LID_BRUNO });
    expect(r.phone).toBe(TELEFONE);
    expect(r.status).toBe('resolved');
  });

  it('AC5-1: lid SEM alias conhecido não resolve nada', async () => {
    const { client } = criarClienteFalso();

    const r = await resolverAlias(client, { channelId: CANAL, alias: LID_BRUNO });
    expect(r.phone).toBeNull();
    expect(r.status).toBeNull();
  });

  it('AC5-2: alias AMBÍGUO não reconcilia (mesmo tendo telefone gravado)', async () => {
    const { client } = criarClienteFalso([
      {
        alias: LID_BRUNO,
        phone: TELEFONE,
        status: 'ambiguous',
        conflicting_phones: [TELEFONE, '+5511999998888'],
      },
    ]);

    const r = await resolverAlias(client, { channelId: CANAL, alias: LID_BRUNO });
    expect(r.phone).toBeNull();
    expect(r.status).toBe('ambiguous');
  });

  it('AC5-3: o alias é por CANAL — o mesmo lid noutro canal não resolve', async () => {
    const { client } = criarClienteFalso([
      { alias: LID_BRUNO, phone: TELEFONE, status: 'resolved' },
    ]);

    const r = await resolverAlias(client, { channelId: 'outro-canal', alias: LID_BRUNO });
    expect(r.phone).toBeNull();
  });

  it('banco indisponível devolve null — indisponível não vira casamento', async () => {
    const { client, erros } = criarClienteFalso([
      { alias: LID_BRUNO, phone: TELEFONE, status: 'resolved' },
    ]);
    erros.select = true;

    const r = await resolverAlias(client, { channelId: CANAL, alias: LID_BRUNO });
    expect(r.phone).toBeNull();
  });
});

// =============================================================================
// AC4 — a marcação de identidade não confirmada
// =============================================================================

describe('AC4 — identidade não confirmada é DADO gravado', () => {
  it('o caso Bruno: sem telefone em lugar nenhum ⇒ linha marcada com motivo e ids', async () => {
    const { client, linhas } = criarClienteFalso();

    const r = await marcarIdentidadeNaoConfirmada(client, {
      ...base,
      alias: LID_BRUNO,
      motivo: MOTIVO_SEM_TELEFONE,
      conversationId: 'conv-924515db',
      dealId: 'deal-espelho',
    });

    expect(r.marcado).toBe(true);
    expect(linhas).toHaveLength(1);
    expect(linhas[0].status).toBe('unresolved');
    expect(linhas[0].phone).toBeNull();
    expect(linhas[0].review_reason).toBe(MOTIVO_SEM_TELEFONE);
    expect(linhas[0].conversation_id).toBe('conv-924515db');
    expect(linhas[0].deal_id).toBe('deal-espelho');
  });

  it('marcar duas vezes continua sendo UMA linha, e os ids não se perdem', async () => {
    const { client, linhas } = criarClienteFalso();

    await marcarIdentidadeNaoConfirmada(client, {
      ...base,
      alias: LID_BRUNO,
      motivo: MOTIVO_SEM_TELEFONE,
      conversationId: 'conv-1',
      dealId: 'deal-1',
    });
    await marcarIdentidadeNaoConfirmada(client, {
      ...base,
      alias: LID_BRUNO,
      motivo: MOTIVO_SEM_TELEFONE,
      conversationId: null,
      dealId: null,
    });

    expect(linhas).toHaveLength(1);
    expect(linhas[0].conversation_id).toBe('conv-1');
    expect(linhas[0].deal_id).toBe('deal-1');
  });

  it('alias já resolvido NÃO é remarcado — a marcação não volta', async () => {
    const { client, linhas } = criarClienteFalso([
      { alias: LID_BRUNO, phone: TELEFONE, status: 'resolved' },
    ]);

    const r = await marcarIdentidadeNaoConfirmada(client, {
      ...base,
      alias: LID_BRUNO,
      motivo: MOTIVO_SEM_TELEFONE,
      conversationId: 'conv-x',
      dealId: 'deal-x',
    });

    expect(r.marcado).toBe(false);
    expect(linhas[0].status).toBe('resolved');
    expect(linhas[0].review_reason).toBeNull();
  });

  it('AC4 item 4: a marcação SAI quando o alias passa a resolver', async () => {
    const { client, linhas } = criarClienteFalso();

    await marcarIdentidadeNaoConfirmada(client, {
      ...base,
      alias: LID_BRUNO,
      motivo: MOTIVO_SEM_TELEFONE,
      conversationId: 'conv-1',
      dealId: 'deal-1',
    });

    const promovido = await registrarAlias(client, { ...base, alias: LID_BRUNO, phone: TELEFONE });

    expect(promovido.acao).toBe('promovido');
    expect(linhas).toHaveLength(1);
    expect(linhas[0].status).toBe('resolved');
    expect(linhas[0].phone).toBe(TELEFONE);
    expect(linhas[0].review_reason).toBeNull();
    // Os ids ficam: são o rastro de onde a conversa partida nasceu.
    expect(linhas[0].conversation_id).toBe('conv-1');
  });

  it('alias ambíguo marcado guarda o motivo específico, não o genérico', async () => {
    const { client, linhas } = criarClienteFalso();

    await registrarAlias(client, { ...base, alias: LID_BRUNO, phone: TELEFONE });
    await registrarAlias(client, { ...base, alias: LID_BRUNO, phone: '+5511999998888' });

    await marcarIdentidadeNaoConfirmada(client, {
      ...base,
      alias: LID_BRUNO,
      motivo: MOTIVO_SEM_TELEFONE,
      conversationId: 'conv-2',
      dealId: 'deal-2',
    });

    expect(linhas[0].review_reason).toBe(MOTIVO_AMBIGUO);
    expect(linhas[0].conversation_id).toBe('conv-2');
  });

  it('falha ao marcar NÃO lança — a mensagem continua sendo gravada pelo chamador', async () => {
    const { client, erros } = criarClienteFalso();
    erros.insert = true;

    const r = await marcarIdentidadeNaoConfirmada(client, {
      ...base,
      alias: LID_BRUNO,
      motivo: MOTIVO_SEM_TELEFONE,
      conversationId: 'conv-1',
      dealId: null,
    });

    expect(r.marcado).toBe(false);
  });
});
