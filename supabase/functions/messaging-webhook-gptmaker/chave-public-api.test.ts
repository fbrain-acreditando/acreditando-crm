/**
 * Story 2.73 — a chave `public-api-…` (AC1, AC4, AC6).
 *
 * A estrutura das chaves é a medida no banco em 10/11 (workspace e canal reais
 * do Acreditando, já presentes em `parser.ts`). ⚠️ Os telefones e lids são
 * fictícios (o repositório é público).
 */

import { describe, it, expect } from 'vitest';
import {
  ehChavePublicApi,
  chaveRealDaPublicApi,
  logDoEventoIgnorado,
  mascararFinal,
} from './chave-public-api';

const WS = '3E12E22DF12D30FBB326262F356E288B';
const CANAL = '3E14B10711E1C0FE16B42EC236EAE1D6';
const TEL = '5511900001486'; // fictício
const LID = '150439900001486@lid'; // fictício

const PUBLIC_TEL = `public-api-${WS}-${CANAL}-${TEL}`;
const PUBLIC_LID = `public-api-${WS}-${CANAL}-${LID}`;

describe('AC1 — ehChavePublicApi', () => {
  const casos: Array<{ nome: string; chave: unknown; esperado: boolean }> = [
    { nome: 'formato real com telefone', chave: PUBLIC_TEL, esperado: true },
    { nome: 'variante @lid', chave: PUBLIC_LID, esperado: true },
    { nome: 'maiúsculas no prefixo', chave: `PUBLIC-API-${WS}-${CANAL}-${TEL}`, esperado: true },
    { nome: 'espaço antes', chave: `  ${PUBLIC_TEL}`, esperado: true },
    { nome: 'simulação (TESTE-Orion-…)', chave: `public-api-${WS}-TESTE-Orion-formato-addmsg-${TEL}`, esperado: true },
    { nome: 'malformada: só o prefixo', chave: 'public-api-', esperado: true },
    { nome: 'malformada: um pedaço', chave: 'public-api-ABC', esperado: true },
    { nome: 'conversa real {canal}-{telefone}', chave: `${CANAL}-${TEL}`, esperado: false },
    { nome: 'conversa real {canal}-{n}@lid', chave: `${CANAL}-${LID}`, esperado: false },
    { nome: 'chave curta usada nos testes antigos', chave: `3E14B107-${TEL}`, esperado: false },
    { nome: '"public-api" no meio, não no começo', chave: `${CANAL}-public-api-${TEL}`, esperado: false },
    { nome: 'sem o hífen final do prefixo', chave: `public-api${WS}`, esperado: false },
    { nome: 'vazio', chave: '', esperado: false },
    { nome: 'null', chave: null, esperado: false },
    { nome: 'undefined', chave: undefined, esperado: false },
    { nome: 'número', chave: 5511900001486, esperado: false },
  ];

  for (const c of casos) {
    it(`${c.nome} ⇒ ${c.esperado}`, () => {
      expect(ehChavePublicApi(c.chave)).toBe(c.esperado);
    });
  }
});

describe('AC1 — chaveRealDaPublicApi', () => {
  it('formato real ⇒ workspace, canal, telefone e a chave da conversa real', () => {
    expect(chaveRealDaPublicApi(PUBLIC_TEL)).toEqual({
      workspaceId: WS,
      channelId: CANAL,
      telefone: TEL,
      chaveReal: `${CANAL}-${TEL}`,
    });
  });

  it('simulação: o "canal" é o texto passado à API, e a chave real é a entregue à API', () => {
    expect(chaveRealDaPublicApi(`public-api-${WS}-TESTE-Orion-formato-addmsg-${TEL}`)).toEqual({
      workspaceId: WS,
      channelId: 'TESTE-Orion-formato-addmsg',
      telefone: TEL,
      chaveReal: `TESTE-Orion-formato-addmsg-${TEL}`,
    });
  });

  const nulos: Array<{ nome: string; chave: unknown }> = [
    { nome: 'variante @lid (sem telefone)', chave: PUBLIC_LID },
    { nome: 'só o prefixo', chave: 'public-api-' },
    { nome: 'um pedaço', chave: 'public-api-ABC' },
    { nome: 'dois pedaços', chave: `public-api-${WS}-${TEL}` },
    { nome: 'pedaço vazio (hífen duplo)', chave: `public-api-${WS}--${TEL}` },
    { nome: 'telefone com letra', chave: `public-api-${WS}-${CANAL}-55119ABC1486` },
    { nome: 'telefone com +', chave: `public-api-${WS}-${CANAL}-+${TEL}` },
    { nome: 'chave da conversa real (não é public-api)', chave: `${CANAL}-${TEL}` },
    { nome: 'null', chave: null },
    { nome: 'vazio', chave: '' },
  ];

  for (const c of nulos) {
    it(`${c.nome} ⇒ null`, () => {
      expect(chaveRealDaPublicApi(c.chave)).toBeNull();
    });
  }
});

describe('AC4 — log do evento ignorado, telefone mascarado', () => {
  it('chave completa: diz a conversa real com só os 4 últimos dígitos', () => {
    const linha = logDoEventoIgnorado(PUBLIC_TEL);
    expect(linha).toBe(`[GPTMaker] public-api — evento ignorado (conversa real ${CANAL}-…1486)`);
    expect(linha).not.toContain(TEL);
  });

  it('com o tipo do evento', () => {
    expect(logDoEventoIgnorado(PUBLIC_TEL, 'onNewMessage')).toBe(
      `[GPTMaker] public-api — evento "onNewMessage" ignorado (conversa real ${CANAL}-…1486)`
    );
  });

  it('variante @lid: não deduz, e o lid também sai mascarado', () => {
    const linha = logDoEventoIgnorado(PUBLIC_LID);
    expect(linha).toBe('[GPTMaker] public-api — evento ignorado (conversa real não deduzida, chave @lid …1486)');
    expect(linha).not.toContain('150439900001486');
  });

  it('malformada: não deduz e não lança', () => {
    expect(logDoEventoIgnorado('public-api-ABC')).toBe(
      '[GPTMaker] public-api — evento ignorado (conversa real não deduzida)'
    );
    expect(logDoEventoIgnorado(null)).toBe(
      '[GPTMaker] public-api — evento ignorado (conversa real não deduzida)'
    );
  });

  it('mascararFinal: só os 4 últimos dígitos', () => {
    expect(mascararFinal(TEL)).toBe('…1486');
    expect(mascararFinal('+55 11 90000-1486')).toBe('…1486');
    expect(mascararFinal('')).toBe('…');
    expect(mascararFinal(null)).toBe('…');
  });
});

describe('AC6 — nunca lança', () => {
  const estranhos: unknown[] = [
    'public-api-',
    'public-api-ABC',
    'public-api----',
    'public-api-@lid',
    `public-api-${'9'.repeat(5000)}`,
    {},
    [],
    123,
    Symbol('x'),
  ];

  for (const valor of estranhos) {
    it(`entrada ${typeof valor === 'string' ? JSON.stringify(valor.slice(0, 20)) : typeof valor}`, () => {
      expect(() => ehChavePublicApi(valor)).not.toThrow();
      expect(() => chaveRealDaPublicApi(valor)).not.toThrow();
      expect(() => logDoEventoIgnorado(valor)).not.toThrow();
    });
  }
});
