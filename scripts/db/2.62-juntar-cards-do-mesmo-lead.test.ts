/**
 * Story 2.62 — testes offline do script de junção (AC8/AC9). Nenhum acesso ao banco:
 * o cliente HTTP é substituído por um banco simulado em memória que reage às queries marcadas
 * com `/* 2.62:<etapa> *\/`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { describe, it, expect } from 'vitest';
import {
  ESPERADO,
  IGNORAR,
  validarListas,
  escolherSobrevivente,
  mesclarCustomFields,
  idDaNota,
  mascararTelefone,
  mascararEmail,
  mascararNome,
  montarNota,
  criarCliente,
  lerToken,
  lerArgs,
  executar,
  sqlDoPar,
  avaliar,
  TITULO_NOTA_A,
  TITULO_NOTA_B,
  ETAPAS_DA_LOJA_DO_INSTITUTO,
  sqlMedicao,
} from './2.62-juntar-cards-do-mesmo-lead.mjs';
import { ETAPAS_DA_LOJA } from '@/lib/instituto/catalogo';

// ---------------------------------------------------------------------------------------------
// Banco simulado
// ---------------------------------------------------------------------------------------------
const ORG = '00000000-0000-4000-8000-000000000000';
const PERFIL = 'f11e0000-0000-4000-8000-000000000001';
const BOARD = '5f6bded2-0000-4000-8000-000000000000';
const ETAPAS: Record<number, { id: string; label: string }> = {
  0: { id: '82d1a222-0000-4000-8000-000000000000', label: 'Lead novo' },
  1: { id: 'e7a00001-0000-4000-8000-000000000000', label: 'Contato Realizado' },
  2: { id: 'e7a00002-0000-4000-8000-000000000000', label: 'Qualificado' },
  3: { id: 'e7a00003-0000-4000-8000-000000000000', label: 'Apresentação enviada' },
  4: { id: 'e7a00004-0000-4000-8000-000000000000', label: 'Aguardando retorno' },
  5: { id: 'e7a00005-0000-4000-8000-000000000000', label: 'Proposta' },
  8: { id: 'e7a00008-0000-4000-8000-000000000000', label: 'Ganho' },
};
const ordemDe = (stageId: string) => Number(Object.entries(ETAPAS).find(([, e]) => e.id === stageId)?.[0]);
const uid = (p: string) => `${p}-1111-4111-8111-${p}1111`;

type Card = any;
type Contato = any;

function mundoDe0311() {
  const cards = new Map<string, Card>();
  const contatos = new Map<string, Contato>();
  const conversas: { id: string; contact_id: string }[] = [];
  let n = 0;
  const card = (p: string, ordem: number, contato: string, title: string, criado: string, cf: object = {}) =>
    cards.set(uid(p), {
      id: uid(p), board_id: BOARD, stage_id: ETAPAS[ordem].id, contact_id: uid(contato), title,
      created_at: criado, deleted_at: null, is_won: false, is_lost: false, custom_fields: cf, organization_id: ORG,
    });
  const contato = (p: string, c: Partial<Contato>, comConversa: boolean) => {
    contatos.set(uid(p), { id: uid(p), name: null, email: null, phone: null, source: null, merged_into_id: null, deleted_at: null, organization_id: ORG, ...c });
    if (comConversa) conversas.push({ id: `c0000${String(++n).padStart(3, '0')}-0000-4000-8000-000000000000`, contact_id: uid(p) });
  };
  ESPERADO.tipoA.forEach((e: any, i: number) => {
    contato(e.contatoLp, { name: `Pessoa Formulario ${i}`, email: `pessoa${i}@exemplo.com`, phone: `55119876543${i}${i}` }, false);
    contato(e.contatoWa, { name: `Zap ${i}`, phone: `5511876543${i}${i}`, source: 'whatsapp' }, true);
    card(e.perdedor, e.ordemPerdedor, e.contatoLp, `Pessoa Formulario ${i} — LP Acreditando`, '2026-10-05T16:17:00Z');
    card(e.sobrevivente, e.ordemSobrevivente, e.contatoWa, `Zap ${i} - WhatsApp`, '2026-10-05T16:18:00Z', { origem: 'ia', nota: 5 });
  });
  ESPERADO.tipoB.forEach((e: any, i: number) => {
    contato(e.contato, { name: `B ${i}`, phone: `55219000000${i}${i}` }, true);
    card(e.perdedor, e.ordemPerdedor, e.contato, `B ${i} — LP Acreditando`, '2026-09-28T12:00:00Z', { campo_lp: 'x' });
    card(e.sobrevivente, e.ordemSobrevivente, e.contato, `B ${i} - WhatsApp`, '2026-09-22T12:00:00Z', { campo_lp: '' });
  });
  // 66 outros cards em Lead novo, contatos únicos (83 no total com os 17 cards da lista em order 0)
  for (let i = 0; i < 66; i++) {
    const p = `aa${String(i).padStart(6, '0')}`;
    contato(p, { name: `Outro ${i}`, phone: `5531${String(900000000 + i)}` }, false);
    card(p, 0, p, `Outro ${i}`, '2026-10-01T12:00:00Z');
  }
  return {
    cards, contatos, conversas,
    notas: new Map<string, any>(),
    filhas: [] as { tabela: string; id: string; deal_id: string; contact_id?: string }[],
    mergeLog: [] as any[],
    webhookOut: [] as { deal_id: string }[],
    filasPendentes: [] as any[],
  };
}
type Mundo = ReturnType<typeof mundoDe0311>;

function chaveTel(phone: string | null) {
  let d = String(phone ?? '').replace(/\D/g, '');
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  if (d.length < 10 || d.length > 11) return null;
  return d.length === 11 ? d.slice(0, 2) + d.slice(3) : d;
}

const FK_LISTA = [
  { esquema: 'public', tabela: 'activities', coluna: 'deal_id', alvo: 'deals' },
  { esquema: 'public', tabela: 'activities', coluna: 'contact_id', alvo: 'contacts' },
  { esquema: 'public', tabela: 'deal_notes', coluna: 'deal_id', alvo: 'deals' },
  { esquema: 'public', tabela: 'webhook_events_out', coluna: 'deal_id', alvo: 'deals' },
  { esquema: 'public', tabela: 'deals', coluna: 'contact_id', alvo: 'contacts' },
  { esquema: 'public', tabela: 'messaging_conversations', coluna: 'contact_id', alvo: 'contacts' },
  { esquema: 'public', tabela: 'contact_merge_log', coluna: 'source_contact_id', alvo: 'contacts' },
];

const prefixosPedidos = () => new Set([
  ...ESPERADO.tipoA.flatMap((e: any) => [e.perdedor, e.sobrevivente, e.contatoLp, e.contatoWa]),
  ...ESPERADO.tipoB.flatMap((e: any) => [e.perdedor, e.sobrevivente, e.contato]),
]);

function medicao(m: Mundo, sql = '') {
  const pref = prefixosPedidos();
  const cartoes = [...m.cards.values()].filter((c) => pref.has(c.id.slice(0, 8)));
  const contatos = [...m.contatos.values()].filter((c) => pref.has(c.id.slice(0, 8)));
  const idsCartoes = new Set(cartoes.map((c) => c.id));
  // AC15 da 2.64: o simulado obedece às etapas que a SQL do script exclui (lidas da própria SQL),
  // para o teste quebrar se o script deixar de excluí-las.
  const foraDaLoja = [...(sql.match(/stage_id::text not in \(([^)]*)\)/)?.[1] ?? '').matchAll(/'([0-9a-f-]{36})'/g)].map((x) => x[1]);
  const abertoNoBoard = (d: Card) =>
    d.board_id === BOARD && !d.deleted_at && !d.is_won && !d.is_lost && !(d.stage_id && foraDaLoja.includes(d.stage_id));
  const vivos = [...m.contatos.values()].filter((c) => !c.deleted_at && !c.merged_into_id);
  const porChave = new Map<string, string[]>();
  for (const c of vivos) { const k = chaveTel(c.phone); if (k) porChave.set(k, [...(porChave.get(k) ?? []), c.id]); }
  const contatosDup = new Map<string, string>();
  for (const [k, ids] of porChave) if (ids.length > 1) ids.forEach((id) => contatosDup.set(id, k));
  const abertos = [...m.cards.values()].filter(abertoNoBoard);
  const porContato = new Map<string, string[]>();
  for (const d of abertos) porContato.set(d.contact_id, [...(porContato.get(d.contact_id) ?? []), d.id]);
  const filhasCont = new Map<string, number>();
  for (const f of m.filhas) if (idsCartoes.has(f.deal_id)) filhasCont.set(`${f.tabela}|${f.deal_id}`, (filhasCont.get(`${f.tabela}|${f.deal_id}`) ?? 0) + 1);
  for (const nt of m.notas.values()) if (idsCartoes.has(nt.deal_id)) filhasCont.set(`activities|${nt.deal_id}`, (filhasCont.get(`activities|${nt.deal_id}`) ?? 0) + 1);
  const md5uuid = (s: string) => { const h = crypto.createHash('md5').update(s).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`; };
  const notaIds = new Set(cartoes.map((c) => md5uuid(`2.62:${c.id}`)));
  return {
    cartoes: cartoes.map((d) => ({ ...d, ordem: ordemDe(d.stage_id), etapa: ETAPAS[ordemDe(d.stage_id)].label })),
    contatos: contatos.map((c) => ({ ...c, conversas: m.conversas.filter((v) => v.contact_id === c.id).length })),
    conversas: m.conversas.filter((v) => contatos.some((c) => c.id === v.contact_id)).sort((a, b) => a.id.localeCompare(b.id)),
    merge_log: m.mergeLog.filter((l) => contatos.some((c) => c.id === l.source_contact_id)),
    notas: [...m.notas.values()].filter((nt) => notaIds.has(nt.id)),
    notas_por_card: [...idsCartoes].map((id) => ({ deal_id: id, n: [...m.notas.values()].filter((nt) => nt.deal_id === id && !nt.deleted_at && [TITULO_NOTA_A, TITULO_NOTA_B].includes(nt.title)).length })).filter((x) => x.n > 0),
    filhas: [...filhasCont].map(([k, n]) => ({ tabela: k.split('|')[0], id: k.split('|')[1], n })),
    filas_pendentes: m.filasPendentes,
    telefone: abertos.filter((d) => contatosDup.has(d.contact_id)).map((d) => ({ chave: contatosDup.get(d.contact_id), deal_id: d.id, contact_id: d.contact_id, ordem: ordemDe(d.stage_id) })),
    email: [],
    dois_cards: [...porContato].filter(([, ds]) => ds.length > 1).map(([contact_id, deals]) => ({ contact_id, deals: [...deals].sort() })),
    lead_novo: abertos.filter((d) => d.stage_id === ETAPAS[0].id).length,
  };
}

function fkContagem(m: Mundo, sql: string) {
  const ids = new Set([...sql.matchAll(/'([0-9a-f-]{36})'::uuid/g)].map((x) => x[1]));
  const out: any[] = [];
  const add = (tabela: string, coluna: string, alvo: string, id: string) => {
    if (!ids.has(id)) return;
    const r = out.find((o) => o.tabela === tabela && o.coluna === coluna && o.id === id);
    if (r) r.n++; else out.push({ tabela, coluna, alvo, id, n: 1 });
  };
  for (const f of m.filhas) add(f.tabela, 'deal_id', 'deals', f.deal_id);
  for (const nt of m.notas.values()) add('activities', 'deal_id', 'deals', nt.deal_id);
  for (const w of m.webhookOut) add('webhook_events_out', 'deal_id', 'deals', w.deal_id);
  for (const d of m.cards.values()) add('deals', 'contact_id', 'contacts', d.contact_id);
  for (const v of m.conversas) add('messaging_conversations', 'contact_id', 'contacts', v.contact_id);
  for (const l of m.mergeLog) add('contact_merge_log', 'source_contact_id', 'contacts', l.source_contact_id);
  return out;
}

/** Aplica o efeito de um bloco de escrita (o que o Postgres faria) no mundo simulado. */
function aplicarEscrita(m: Mundo, sql: string, opcoes: { esquecerSoftDelete?: boolean }) {
  const u = (re: RegExp) => [...sql.matchAll(re)].map((x) => x[1]);
  const merge = sql.match(/merge_contacts\('([0-9a-f-]{36})'::uuid, '([0-9a-f-]{36})'::uuid\)/);
  if (merge) {
    expect(sql).toContain('set local role authenticated;');
    expect(sql).toContain(`"sub":"${PERFIL}"`);
    const [, src, tgt] = merge;
    const s = m.contatos.get(src); const t = m.contatos.get(tgt);
    t.email = t.email ?? s.email;
    let movidos = 0;
    for (const d of m.cards.values()) if (d.contact_id === src) { d.contact_id = tgt; movidos++; }
    s.merged_into_id = tgt; s.deleted_at = '2026-10-09T15:00:00Z';
    m.mergeLog.push({ source_contact_id: src, target_contact_id: tgt, merged_by: PERFIL, records_moved: { deals: movidos, conversations: 0 } });
  }
  const nome = sql.match(/update public\.contacts set name = '([^']*)', updated_at = now\(\) where id = '([0-9a-f-]{36})'::uuid;/);
  if (nome) {
    const c = m.contatos.get(nome[2]);
    const antigo = c.name; c.name = nome[1];
    // trigger da 2.20: renomeia "{nome} - WhatsApp"
    for (const d of m.cards.values()) if (d.contact_id === c.id && d.title === `${antigo} - WhatsApp`) d.title = `${c.name} - WhatsApp`;
  }
  for (const [, titulo, id] of sql.matchAll(/update public\.deals set title = '([^']*)' where id = '([0-9a-f-]{36})'::uuid/g)) m.cards.get(id).title = titulo;
  for (const [, tabela, para, de] of sql.matchAll(/update public\.(\w+) set deal_id = '([0-9a-f-]{36})'::uuid where deal_id = '([0-9a-f-]{36})'::uuid;/g)) {
    for (const f of m.filhas) if (f.tabela === tabela && f.deal_id === de) f.deal_id = para;
  }
  const cf = sql.match(/set custom_fields = '([^']*)'::jsonb, updated_at = now\(\) where id = '([0-9a-f-]{36})'::uuid;/);
  if (cf) m.cards.get(cf[2]).custom_fields = JSON.parse(cf[1]);
  const ins = sql.match(/values \('([0-9a-f-]{36})'::uuid, '[0-9a-f-]{36}'::uuid, '([0-9a-f-]{36})'::uuid, '([0-9a-f-]{36})'::uuid, 'NOTE',\s+'([^']*)', '((?:[^']|'')*)'/);
  if (ins && !m.notas.has(ins[1])) m.notas.set(ins[1], { id: ins[1], deal_id: ins[2], contact_id: ins[3], type: 'NOTE', title: ins[4], description: ins[5].replace(/''/g, "'"), deleted_at: null });
  if (!opcoes.esquecerSoftDelete) {
    for (const id of u(/set deleted_at = now\(\), updated_at = now\(\) where id = '([0-9a-f-]{36})'::uuid and deleted_at is null/g)) {
      const d = m.cards.get(id); if (!d.deleted_at) d.deleted_at = '2026-10-09T15:00:00Z';
    }
  }
}

function aplicarReversao(m: Mundo, sql: string) {
  for (const [, valor, id] of sql.matchAll(/update public\.deals set deleted_at = (null|'[^']*'), updated_at = now\(\) where id = '([0-9a-f-]{36})'::uuid;/g)) m.cards.get(id).deleted_at = valor === 'null' ? null : valor.slice(1, -1);
  for (const [, para, id] of sql.matchAll(/update public\.deals set contact_id = '([0-9a-f-]{36})'::uuid where id = '([0-9a-f-]{36})'::uuid;/g)) m.cards.get(id).contact_id = para;
  for (const [, id] of sql.matchAll(/update public\.contacts set merged_into_id = null, deleted_at = null, updated_at = now\(\) where id = '([0-9a-f-]{36})'::uuid;/g)) { const c = m.contatos.get(id); c.merged_into_id = null; c.deleted_at = null; }
  for (const [, valor, id] of sql.matchAll(/update public\.contacts set email = (null|'[^']*'), updated_at = now\(\) where id = '([0-9a-f-]{36})'::uuid/g)) m.contatos.get(id).email = valor === 'null' ? null : valor.slice(1, -1);
  for (const [, valor, id] of sql.matchAll(/update public\.contacts set name = '([^']*)', updated_at = now\(\) where id = '([0-9a-f-]{36})'::uuid and name/g)) m.contatos.get(id).name = valor;
  for (const [, titulo, id] of sql.matchAll(/update public\.deals set title = '([^']*)' where id = '([0-9a-f-]{36})'::uuid/g)) m.cards.get(id).title = titulo;
  for (const [, id] of sql.matchAll(/delete from public\.activities where id = '([0-9a-f-]{36})'::uuid;/g)) m.notas.delete(id);
}

/**
 * Emula o trigger check_deal_duplicate_trigger (BEFORE INSERT OR UPDATE em deals, produção 03/11): qualquer UPDATE
 * de um card falha se houver OUTRO card aberto (deleted_at nulo, não ganho/perdido) no mesmo contato e etapa.
 * A função NÃO olha NEW.deleted_at. Percorre os comandos NA ORDEM do bloco, num modelo à parte (não muda o mundo);
 * o merge_contacts desliga o trigger enquanto move os cards.
 */
function checarTriggerDuplicado(m: Mundo, sql: string) {
  const deals = new Map([...m.cards.values()].map((d) => [d.id, { ...d }]));
  const nomes = new Map([...m.contatos.values()].map((c) => [c.id, c.name]));
  const checar = (id: string) => {
    const r = deals.get(id);
    if (!r || r.is_won || r.is_lost) return;
    for (const d of deals.values()) {
      if (d.id !== r.id && d.contact_id === r.contact_id && d.stage_id === r.stage_id && !d.deleted_at && !d.is_won && !d.is_lost) {
        throw new Error(`HTTP 400: {"message":"ERROR: 23505: Já existe um negócio para este contato no estágio (check_deal_duplicate)"}`);
      }
    }
  };
  const U = '([0-9a-f-]{36})';
  const padroes: [RegExp, (x: RegExpMatchArray) => void][] = [
    [new RegExp(`update public\\.deals set deleted_at = (now\\(\\)|null|'[^']*'), updated_at = now\\(\\) where id = '${U}'::uuid`, 'g'), (x) => {
      const d = deals.get(x[2])!; d.deleted_at = x[1] === 'null' ? null : 'agora'; checar(d.id);
    }],
    [new RegExp(`merge_contacts\\('${U}'::uuid, '${U}'::uuid\\)`, 'g'), (x) => {
      for (const d of deals.values()) if (d.contact_id === x[1]) d.contact_id = x[2];
    }],
    [new RegExp(`update public\\.contacts set name = '([^']*)', updated_at = now\\(\\) where id = '${U}'::uuid`, 'g'), (x) => {
      const antigo = nomes.get(x[2]); nomes.set(x[2], x[1]);
      for (const d of deals.values()) if (d.contact_id === x[2] && d.title === `${antigo} - WhatsApp`) { d.title = `${x[1]} - WhatsApp`; checar(d.id); }
    }],
    [new RegExp(`update public\\.deals set custom_fields = '(?:[^']|'')*'::jsonb, updated_at = now\\(\\) where id = '${U}'::uuid`, 'g'), (x) => checar(x[1])],
    [new RegExp(`update public\\.deals set contact_id = '${U}'::uuid where id = '${U}'::uuid`, 'g'), (x) => {
      deals.get(x[2])!.contact_id = x[1]; checar(x[2]);
    }],
    [new RegExp(`update public\\.deals set title = '(?:[^']|'')*' where id = '${U}'::uuid`, 'g'), (x) => checar(x[1])],
  ];
  const ocorrencias = padroes.flatMap(([re, f]) => [...sql.matchAll(re)].map((x) => ({ i: x.index!, f: () => f(x) })));
  for (const o of ocorrencias.sort((a, b) => a.i - b.i)) o.f();
}

function bancoSimulado(m: Mundo, opcoes: { esquecerSoftDelete?: boolean } = {}) {
  const log: string[] = [];
  const q = async (sql: string) => {
    const tag = sql.match(/^\/\* 2\.62:([\w-]+)(?::(\w+))? \*\//)?.[1];
    log.push(tag ?? '?');
    switch (tag) {
      case 'perfil': return [{ id: PERFIL, organization_id: ORG }];
      case 'fk-lista': return FK_LISTA;
      case 'medicao': return [{ doc: medicao(m, sql) }];
      case 'fk-contagem': return fkContagem(m, sql);
      case 'backup': return [{ doc: { deals: [...m.cards.values()].filter((d) => sql.includes(d.id)), contacts: [...m.contatos.values()].filter((c) => sql.includes(c.id)), messaging_conversations: [], contact_merge_log: [], fk: [] } }];
      case 'escrita': checarTriggerDuplicado(m, sql); aplicarEscrita(m, sql, opcoes); return [];
      case 'ensaio': checarTriggerDuplicado(m, sql); throw new Error('HTTP 400: {"message":"ERROR: P0001: 2.62 ENSAIO OK (x) merge=n/a -- DESFEITO"}');
      case 'reversao': checarTriggerDuplicado(m, sql); aplicarReversao(m, sql); return [];
      default: throw new Error(`query sem marca: ${sql.slice(0, 60)}`);
    }
  };
  return { q, log };
}

function ambiente() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teste-2.62-'));
  const saida: string[] = [];
  return { dir, saida, log: (s: string) => saida.push(s), checkIgnore: () => ({ ok: true, motivo: 'teste' }), agora: () => new Date('2026-10-09T15:00:00Z') };
}

// ---------------------------------------------------------------------------------------------
// Lógica pura
// ---------------------------------------------------------------------------------------------
describe('S1 — escolherSobrevivente', () => {
  it('fica o card da etapa de maior order', () => {
    const r = escolherSobrevivente([
      { id: 'a', ordem: 0, temConversa: false, criadoEm: '2026-10-05T13:17:00Z' },
      { id: 'b', ordem: 2, temConversa: true, criadoEm: '2026-10-05T13:18:00Z' },
    ]);
    expect(r.sobrevivente.id).toBe('b');
    expect(r.perdedores.map((c: any) => c.id)).toEqual(['a']);
  });
  it('empate de etapa: fica o que tem conversa', () => {
    const r = escolherSobrevivente([
      { id: 'velho-sem-conversa', ordem: 1, temConversa: false, criadoEm: '2026-01-01T00:00:00Z' },
      { id: 'novo-com-conversa', ordem: 1, temConversa: true, criadoEm: '2026-10-01T00:00:00Z' },
    ]);
    expect(r.sobrevivente.id).toBe('novo-com-conversa');
  });
  it('empate de etapa e de conversa: fica o mais antigo', () => {
    const r = escolherSobrevivente([
      { id: 'novo', ordem: 1, temConversa: true, criadoEm: '2026-10-01T00:00:00Z' },
      { id: 'velho', ordem: 1, temConversa: true, criadoEm: '2026-09-01T00:00:00Z' },
    ]);
    expect(r.sobrevivente.id).toBe('velho');
  });
  it('etapa acima de 7 (Ganho/Perdido/...) ou sem etapa: para, não decide', () => {
    expect(escolherSobrevivente([{ id: 'a', ordem: 8, temConversa: true, criadoEm: 'x' }, { id: 'b', ordem: 2, temConversa: true, criadoEm: 'x' }]).parar).toMatch(/order > 7/);
    expect(escolherSobrevivente([{ id: 'a', ordem: null, temConversa: true, criadoEm: 'x' }, { id: 'b', ordem: 2, temConversa: true, criadoEm: 'x' }]).parar).toBeTruthy();
  });
});

describe('S4 — mesclarCustomFields', () => {
  it('só preenche chave ausente ou vazia; preenchida nunca muda', () => {
    const { resultado, adicionadas } = mesclarCustomFields(
      { nome: 'IA', vazio: '', lista: [], zero: 0 },
      { nome: 'LP', vazio: 'da LP', lista: ['x'], zero: 9, nova: 'n', perdedorVazio: '' }
    );
    expect(resultado).toEqual({ nome: 'IA', vazio: 'da LP', lista: ['x'], zero: 0, nova: 'n' });
    expect(adicionadas).toEqual({ vazio: 'da LP', lista: ['x'], nova: 'n' });
  });
  it('perdedor vazio ({}, como em 07/10) não muda nada', () => {
    expect(mesclarCustomFields({ a: 1 }, {})).toEqual({ resultado: { a: 1 }, adicionadas: {} });
  });
});

describe('utilitários', () => {
  it('idDaNota é determinístico e igual a md5(...)::uuid', () => {
    const id = uid('289f95a3');
    const h = crypto.createHash('md5').update(`2.62:${id}`).digest('hex');
    expect(idDaNota(id)).toBe(`${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`);
    expect(idDaNota(id)).toBe(idDaNota(id.toUpperCase()));
  });
  it('mascara telefone, e-mail e nome', () => {
    expect(mascararTelefone('+55 12 99753-4278')).toBe('5512*****4278');
    expect(mascararEmail('fulana@gmail.com')).toBe('f***@g***');
    expect(mascararNome('Maria da Silva')).toBe('M*** d*** S***');
  });
  it('nota do par A traz título, telefone com 9, e-mail, origem e referência — em pt-BR', () => {
    const m = mundoDe0311();
    const e = ESPERADO.tipoA[0];
    const par = {
      tipo: 'A', perdedor: m.cards.get(uid(e.perdedor)), contatoLp: m.contatos.get(uid(e.contatoLp)), contatoWa: m.contatos.get(uid(e.contatoWa)),
    };
    const n = montarNota(par, '2026-10-09T15:00:00Z');
    expect(n.titulo).toBe('Card da LP juntado a este');
    expect(n.descricao).toContain('Pessoa Formulario 0 — LP Acreditando');
    expect(n.descricao).toContain('05/10/2026 13:17 (horário de Brasília)');
    expect(n.descricao).toContain('Telefone informado no formulário: 5511987654300');
    expect(n.descricao).toContain('E-mail: pessoa0@exemplo.com');
    expect(n.descricao).toContain(`ref. 2.62/${uid(e.perdedor)}`);
    expect(n.descricao).not.toMatch(/gpt\s*maker/i);
  });
  it('lerArgs: dry-run é o padrão; escrever exige --execute', () => {
    expect(lerArgs([])).toMatchObject({ escrever: false, excluir: false, ensaio: false, reverter: null });
    expect(lerArgs(['--execute', '--excluir-perdedores'])).toMatchObject({ escrever: true, excluir: true });
    expect(() => lerArgs(['--execute', '--ensaio'])).toThrow();
    expect(() => lerArgs(['--qualquer'])).toThrow();
  });
});

describe('token nunca aparece', () => {
  it('erro HTTP 403 com o token no corpo sai com o token apagado', async () => {
    const token = 'sbp_SEGREDO_DE_TESTE_123';
    const fetchFalso = async () => ({ ok: false, status: 403, text: async () => `{"message":"forbidden for ${token}"}` });
    const q = criarCliente({ token, fetchImpl: fetchFalso as any });
    await expect(q('select 1')).rejects.toThrow(/HTTP 403 \(token sem acesso/);
    await q('select 1').catch((e: Error) => expect(e.message).not.toContain(token));
  });
  it('lerToken: variável de ambiente primeiro; sem nada, erro que diz onde procurou (sem conteúdo)', () => {
    expect(lerToken({ SUPABASE_CRM_MGMT_TOKEN: ' abc \n' } as any)).toBe('abc');
    expect(() => lerToken({} as any, () => false)).toThrow(/grupo-acreditando\/\.credenciais\/supabase-crm-mgmt\.token/);
  });
});

// ---------------------------------------------------------------------------------------------
// Orquestração contra o banco simulado
// ---------------------------------------------------------------------------------------------
describe('AC0 — re-medir e parar se o mundo mudou', () => {
  it('dry-run no mundo de 03/11: plano com 8 pares A + 21 B (20 contatos), nenhuma escrita', async () => {
    const m = mundoDe0311();
    const { q, log } = bancoSimulado(m);
    const amb = ambiente();
    const r = await executar({ q, args: lerArgs(['--excluir-perdedores']), log: amb.log, agora: amb.agora, checkIgnore: amb.checkIgnore });
    expect(r.codigo).toBe(0);
    expect(r.pares.filter((p: any) => p.tipo === 'A')).toHaveLength(8);
    expect(r.pares.filter((p: any) => p.tipo === 'B')).toHaveLength(21);
    expect(new Set(r.pares.filter((p: any) => p.tipo === 'B').map((p: any) => p.contato.id)).size).toBe(20);
    expect(r.pares.every((p: any) => p.passos.excluir)).toBe(true);
    expect(log.filter((t) => ['escrita', 'ensaio', 'backup', 'reversao'].includes(t))).toEqual([]);
    expect(amb.saida.join('\n')).toContain('Nada foi escrito');
    // contato "d710be17" com 3 cards: fica o de Aguardando retorno; saem os outros 2
    for (const sai of ['cb14c659', 'e0c5249f']) expect(r.pares.find((p: any) => p.perdedor.id === uid(sai)).sobrevivente.id).toBe(uid('5c0756fb'));
    // nada de dado pessoal completo no console
    const tudo = amb.saida.join('\n');
    expect(tudo).not.toContain('pessoa0@exemplo.com');
    expect(tudo).not.toContain('5511987654300');
    expect(tudo).not.toContain('Pessoa Formulario');
  });

  it('par novo pelo telefone => para sem escrever', async () => {
    const m = mundoDe0311();
    m.contatos.set(uid('bbbbbbb1'), { id: uid('bbbbbbb1'), name: 'X', phone: '5531900000000', email: null, merged_into_id: null, deleted_at: null, organization_id: ORG });
    m.cards.set(uid('bbbbbbb1'), { id: uid('bbbbbbb1'), board_id: BOARD, stage_id: ETAPAS[1].id, contact_id: uid('bbbbbbb1'), title: 'X', created_at: '2026-10-08T00:00:00Z', deleted_at: null, is_won: false, is_lost: false, custom_fields: {}, organization_id: ORG });
    const { q, log } = bancoSimulado(m);
    const amb = ambiente();
    const r = await executar({ q, args: lerArgs(['--execute', '--excluir-perdedores']), log: amb.log, agora: amb.agora, checkIgnore: amb.checkIgnore });
    expect(r.codigo).toBe(2);
    expect(r.divergencias.join('\n')).toMatch(/busca por telefone: card bbbbbbb1 fora da lista/);
    expect(log).not.toContain('escrita');
    expect(log).not.toContain('backup');
  });

  it('N2: sobrevivente que só avançou (Qualificado → Aguardando retorno) => segue, com aviso', async () => {
    const m = mundoDe0311();
    m.cards.get(uid('08750bc3')).stage_id = ETAPAS[4].id;
    const { q, log } = bancoSimulado(m);
    const amb = ambiente();
    const r = await executar({ q, args: { ...lerArgs(['--execute', '--excluir-perdedores']), dirBackup: amb.dir }, log: amb.log, agora: amb.agora, checkIgnore: amb.checkIgnore });
    expect(amb.saida.join('\n')).not.toMatch(/REPROVOU|PARADO/);
    expect(r.codigo).toBe(0);
    expect(amb.saida.join('\n')).toMatch(/08750bc3 avançou da etapa 0 para 4 .* segue \(N2\)/);
    expect(log.filter((t) => t === 'escrita')).toHaveLength(29);
    expect(m.cards.get(uid('08750bc3'))).toMatchObject({ stage_id: ETAPAS[4].id, deleted_at: null });
  });

  it('N2: perdedor que mudou de etapa => para', async () => {
    const m = mundoDe0311();
    m.cards.get(uid('4ef235a4')).stage_id = ETAPAS[1].id; // card da LP saiu de Lead novo
    const { q, log } = bancoSimulado(m);
    const amb = ambiente();
    const r = await executar({ q, args: lerArgs(['--execute']), log: amb.log, agora: amb.agora, checkIgnore: amb.checkIgnore });
    expect(r.codigo).toBe(2);
    expect(r.divergencias.join('\n')).toMatch(/card da LP 4ef235a4 na etapa 1/);
    expect(log).not.toContain('escrita');
  });

  it('N2: com a etapa nova o card que fica muda (sobrevivente recuou abaixo do perdedor) => para', async () => {
    const m = mundoDe0311();
    m.cards.get(uid('e6a98089')).stage_id = ETAPAS[0].id; // era Qualificado (2); perdedor 57efb6e0 está em 1
    const { q, log } = bancoSimulado(m);
    const amb = ambiente();
    const r = await executar({ q, args: lerArgs(['--execute']), log: amb.log, agora: amb.agora, checkIgnore: amb.checkIgnore });
    expect(r.codigo).toBe(2);
    expect(r.divergencias.join('\n')).toMatch(/regra S1 escolhe 57efb6e0 como sobrevivente, não e6a98089/);
    expect(log).not.toContain('escrita');
  });

  it('N2: sobrevivente que avançou para etapa > 7 (Ganho) => para', async () => {
    const m = mundoDe0311();
    m.cards.get(uid('dc982758')).stage_id = ETAPAS[8].id;
    const { q } = bancoSimulado(m);
    const amb = ambiente();
    const r = await executar({ q, args: lerArgs([]), log: amb.log, agora: amb.agora, checkIgnore: amb.checkIgnore });
    expect(r.codigo).toBe(2);
    expect(r.divergencias.join('\n')).toMatch(/order > 7/);
  });

  it('par que sumiu (perdedor já excluído por alguém) => para', async () => {
    const m = mundoDe0311();
    m.cards.get(uid('bff4a088')).deleted_at = '2026-10-08T00:00:00Z';
    const { q } = bancoSimulado(m);
    const amb = ambiente();
    const r = await executar({ q, args: lerArgs([]), log: amb.log, agora: amb.agora, checkIgnore: amb.checkIgnore });
    expect(r.codigo).toBe(2);
    expect(r.divergencias.join('\n')).toMatch(/bff4a088/);
  });

  it('card da LP ganhou conversa => para', async () => {
    const m = mundoDe0311();
    m.conversas.push({ id: 'c9990000-0000-4000-8000-000000000000', contact_id: uid('b9b6179e') });
    const { q } = bancoSimulado(m);
    const amb = ambiente();
    const r = await executar({ q, args: lerArgs([]), log: amb.log, agora: amb.agora, checkIgnore: amb.checkIgnore });
    expect(r.codigo).toBe(2);
    expect(r.divergencias.join('\n')).toMatch(/contato da LP ganhou conversa/);
  });

  it('item pendente na fila de IA do perdedor => para', () => {
    const m = mundoDe0311();
    m.filasPendentes.push({ tabela: 'ai_pending_lead_scores', id: uid('4f45f163'), status: 'pending' });
    const snap: any = { ...medicao(m), fk: [] };
    expect(avaliar(snap).divergencias.join('\n')).toMatch(/4f45f163 tem item pending em ai_pending_lead_scores/);
  });

  it('backup em pasta que o git NÃO ignora => para antes de escrever', async () => {
    const m = mundoDe0311();
    const { q, log } = bancoSimulado(m);
    const amb = ambiente();
    const r = await executar({ q, args: { ...lerArgs(['--execute', '--excluir-perdedores']), dirBackup: amb.dir }, log: amb.log, agora: amb.agora, checkIgnore: () => ({ ok: false, motivo: 'não ignorado' }) });
    expect(r.codigo).toBe(2);
    expect(amb.saida.join('\n')).toMatch(/PARADO no AC1: não ignorado/);
    expect(log).not.toContain('escrita');
  });
});

describe('Lista de 03/11 (D1–D3), IGNORAR e contato com 3 cards', () => {
  const telefoneDuplicado = (m: Mundo, prefixoCard: string, prefixoGemeo: string) => {
    // card aberto + gêmeo (mesmo telefone, outro contato) em Perdido: a busca por telefone acha só o aberto
    for (const [p, perdido] of [[prefixoCard, false], [prefixoGemeo, true]] as const) {
      m.contatos.set(uid(p), { id: uid(p), name: 'Y', phone: '5541988887777', email: null, merged_into_id: null, deleted_at: null, organization_id: ORG });
      m.cards.set(uid(p), { id: uid(p), board_id: BOARD, stage_id: ETAPAS[0].id, contact_id: uid(p), title: 'Y', created_at: '2026-10-17T00:00:00Z', deleted_at: null, is_won: false, is_lost: perdido, custom_fields: {}, organization_id: ORG });
    }
  };

  it('a lista nova é aceita: 8 A + 21 B, sem sobreposição com o IGNORAR, 3 pares antigos fora (D1)', () => {
    expect(validarListas()).toEqual([]);
    expect(ESPERADO.tipoA).toHaveLength(8);
    expect(ESPERADO.tipoB).toHaveLength(21);
    expect(new Set(ESPERADO.tipoB.map((e: any) => e.contato)).size).toBe(20);
    const naLista = new Set([...ESPERADO.tipoA, ...ESPERADO.tipoB].flatMap((e: any) => [e.perdedor, e.sobrevivente]));
    for (const antigo of ['289f95a3', '6b21d78c', 'ecd42b65', '49edbe0c', '93c9f90b']) expect(naLista.has(antigo)).toBe(false);
    expect(IGNORAR).toHaveLength(12);
  });

  it('validarListas reprova card na lista E no IGNORAR, e perdedor repetido', () => {
    expect(validarListas(ESPERADO, ['08750bc3']).join('\n')).toMatch(/08750bc3 está na lista E no IGNORAR/);
    const dup = { tipoA: [], tipoB: [ESPERADO.tipoB[0], ESPERADO.tipoB[0]] };
    expect(validarListas(dup as any, []).join('\n')).toMatch(/2 vezes como perdedor/);
  });

  it('card do IGNORAR achado pela busca por telefone NÃO para o AC0 (vira aviso) e não é tocado', async () => {
    const m = mundoDe0311();
    telefoneDuplicado(m, '41d374ff', 'dcff3e86');
    const { q, log } = bancoSimulado(m);
    const amb = ambiente();
    const r = await executar({ q, args: { ...lerArgs(['--execute', '--excluir-perdedores']), dirBackup: amb.dir }, log: amb.log, agora: amb.agora, checkIgnore: amb.checkIgnore });
    expect(amb.saida.join('\n')).not.toMatch(/PARADO|REPROVOU/);
    expect(r.codigo).toBe(0);
    expect(amb.saida.join('\n')).toMatch(/card 41d374ff ignorado/);
    expect(log.filter((t) => t === 'escrita')).toHaveLength(29);
    expect(m.cards.get(uid('41d374ff')).deleted_at).toBeNull();
  });

  it('card fora da lista e fora do IGNORAR continua parando o AC0', async () => {
    const m = mundoDe0311();
    telefoneDuplicado(m, 'cccccc01', 'cccccc02');
    const { q, log } = bancoSimulado(m);
    const amb = ambiente();
    const r = await executar({ q, args: lerArgs(['--execute', '--excluir-perdedores']), log: amb.log, agora: amb.agora, checkIgnore: amb.checkIgnore });
    expect(r.codigo).toBe(2);
    expect(r.divergencias.join('\n')).toMatch(/busca por telefone: card cccccc01 fora da lista de 03\/11/);
    expect(log).not.toContain('escrita');
    expect(log).not.toContain('backup');
  });

  it('contato com 3 cards: 2 perdedores no mesmo sobrevivente, S4 encadeado, 2 notas', async () => {
    const m = mundoDe0311();
    const snap: any = { ...medicao(m), fk: [] };
    const av = avaliar(snap, ESPERADO, { excluir: true });
    expect(av.divergencias).toEqual([]);
    const doContato = av.pares.filter((p: any) => p.tipo === 'B' && p.contato.id === uid('d710be17'));
    expect(doContato.map((p: any) => p.perdedor.id.slice(0, 8))).toEqual(['e0c5249f', 'cb14c659']);
    expect(doContato.every((p: any) => p.sobrevivente.id === uid('5c0756fb'))).toBe(true);
    // o 1º par preenche campo_lp; o 2º parte do resultado do 1º e não acrescenta nada
    expect(doContato[0].passos.camposAdicionados).toEqual({ campo_lp: 'x' });
    expect(doContato[1].sobrevivente.custom_fields).toEqual(doContato[0].customFieldsResultado);
    expect(doContato[1].passos.camposAdicionados).toEqual({});
  });

  it('contato com 3 cards: um 4º card aberto no contato => para', async () => {
    const m = mundoDe0311();
    m.cards.set(uid('dddddd01'), { id: uid('dddddd01'), board_id: BOARD, stage_id: ETAPAS[0].id, contact_id: uid('d710be17'), title: 'extra', created_at: '2026-10-20T00:00:00Z', deleted_at: null, is_won: false, is_lost: false, custom_fields: {}, organization_id: ORG });
    const { q, log } = bancoSimulado(m);
    const amb = ambiente();
    const r = await executar({ q, args: lerArgs(['--execute']), log: amb.log, agora: amb.agora, checkIgnore: amb.checkIgnore });
    expect(r.codigo).toBe(2);
    expect(r.divergencias.join('\n')).toMatch(/contato d710be17: cards abertos .*dddddd01/);
    expect(log).not.toContain('escrita');
  });

  it('contato com 3 cards: se um perdedor passar o que fica (S1 com todos), o contato inteiro para', async () => {
    const m = mundoDe0311();
    m.cards.get(uid('5c0756fb')).stage_id = ETAPAS[2].id; // o que fica recuou para 2; e0c5249f está em 3
    const { q } = bancoSimulado(m);
    const amb = ambiente();
    const r = await executar({ q, args: lerArgs([]), log: amb.log, agora: amb.agora, checkIgnore: amb.checkIgnore });
    expect(r.codigo).toBe(2);
    expect(r.divergencias.join('\n')).toMatch(/contato B d710be17: regra S1 escolhe e0c5249f/);
    expect(r.divergencias.join('\n')).not.toMatch(/cb14c659→5c0756fb: /); // o contato para como um todo
  });
});

describe('AC1–AC5 + idempotência + AC7', () => {
  it('executa, confirma por read-back, e a 2ª execução não muda nada', async () => {
    const m = mundoDe0311();
    m.filhas.push({ tabela: 'deal_notes', id: 'n1', deal_id: uid('57efb6e0') });
    m.webhookOut.push({ deal_id: uid('08750bc3') });
    const { q, log } = bancoSimulado(m);
    const amb = ambiente();
    const args = { ...lerArgs(['--execute', '--excluir-perdedores']), dirBackup: amb.dir };
    const r = await executar({ q, args, log: amb.log, agora: amb.agora, checkIgnore: amb.checkIgnore });
    expect(amb.saida.join('\n')).not.toMatch(/REPROVOU/);
    expect(r.codigo).toBe(0);
    expect(log.filter((t) => t === 'escrita')).toHaveLength(29);

    // AC1: backup relido com 57 cards (16 do tipo A + 21 que saem + 20 que ficam no B) e 36 contatos
    const backup = JSON.parse(fs.readFileSync(r.backup, 'utf8'));
    expect(backup.linhas.deals).toHaveLength(57);
    expect(backup.linhas.contacts).toHaveLength(36);
    expect(fs.existsSync(path.join(path.dirname(r.backup), '2.62-juntar-cards-do-mesmo-lead.mjs'))).toBe(true);

    // AC2 + P5 + N1
    const e = ESPERADO.tipoA[0];
    const CW = m.contatos.get(uid(e.contatoWa));
    expect(m.contatos.get(uid(e.contatoLp)).merged_into_id).toBe(uid(e.contatoWa));
    expect(CW.email).toBe('pessoa0@exemplo.com');
    expect(CW.name).toBe('Pessoa Formulario 0');
    // N1: o título acompanha o nome novo (reescrito pelo trigger simulado) e o read-back aceita o valor lido
    expect(m.cards.get(uid(e.sobrevivente)).title).toBe('Pessoa Formulario 0 - WhatsApp');
    expect(r.resultados[0]).toMatchObject({ ok: true, tituloAntes: 'Zap 0 - WhatsApp', tituloLido: 'Pessoa Formulario 0 - WhatsApp' });
    expect(m.cards.get(uid(e.perdedor)).title).toBe('Pessoa Formulario 0 — LP Acreditando');
    // AC3: filha movida no tipo B
    expect(m.filhas.find((f) => f.id === 'n1')!.deal_id).toBe(uid('e6a98089'));
    // AC4: 1 nota por card juntado (o sobrevivente do contato com 3 cards recebe 2)
    expect(m.notas.size).toBe(29);
    expect([...m.notas.values()].filter((n: any) => n.deal_id === uid('5c0756fb'))).toHaveLength(2);
    // AC5: 29 perdedores com deleted_at, sobreviventes sem
    for (const p of r.pares) {
      expect(m.cards.get(p.perdedor.id).deleted_at).toBeTruthy();
      expect(m.cards.get(p.sobrevivente.id).deleted_at).toBeNull();
    }
    // AC6 (a): 66 outros + 17 da lista em Lead novo = 83; saem os 16 perdedores que estavam em Lead novo
    expect(r.final).toMatchObject({ leadNovoAntes: 83, leadNovoEsperado: 67, leadNovoLido: 67, webhookAntes: 1, webhookDepois: 1 });

    // Idempotência: 2ª execução não escreve nada e o estado fica idêntico
    const fotografia = JSON.stringify(medicao(m));
    const amb2 = ambiente();
    const r2 = await executar({ q, args: { ...args, dirBackup: amb2.dir }, log: amb2.log, agora: amb2.agora, checkIgnore: amb2.checkIgnore });
    expect(r2.codigo).toBe(0);
    expect(r2.escritas).toBe(0);
    expect(log.filter((t) => t === 'escrita')).toHaveLength(29);
    expect(JSON.stringify(medicao(m))).toBe(fotografia);
    expect(amb2.saida.join('\n')).toContain('Nada a fazer');

    // AC7: reversão (dry-run não escreve; --execute devolve)
    const amb3 = ambiente();
    const seco = await executar({ q, args: lerArgs(['--reverter', r.backup]), log: amb3.log, agora: amb3.agora, checkIgnore: amb3.checkIgnore, fsImpl: fs });
    expect(seco.codigo).toBe(0);
    expect(log).not.toContain('reversao');
    const rev = await executar({ q, args: lerArgs(['--reverter', r.backup, '--execute']), log: amb3.log, agora: amb3.agora, checkIgnore: amb3.checkIgnore, fsImpl: fs });
    expect(amb3.saida.join('\n')).not.toMatch(/REPROVOU|FALHOU/);
    expect(rev.codigo).toBe(0);
    expect(m.cards.get(uid(e.perdedor))).toMatchObject({ deleted_at: null, contact_id: uid(e.contatoLp) });
    expect(m.contatos.get(uid(e.contatoLp))).toMatchObject({ merged_into_id: null, deleted_at: null });
    expect(m.contatos.get(uid(e.contatoWa))).toMatchObject({ email: null, name: 'Zap 0' });
    expect(m.notas.size).toBe(0);
  });

  it('empate de etapa sem --excluir-perdedores: --execute e --ensaio param antes de escrever; dry-run só avisa', async () => {
    const m = mundoDe0311();
    const { q, log } = bancoSimulado(m);
    const amb = ambiente();
    for (const flags of [['--execute'], ['--ensaio']]) {
      const r = await executar({ q, args: { ...lerArgs(flags), dirBackup: amb.dir }, log: amb.log, agora: amb.agora, checkIgnore: amb.checkIgnore });
      expect(r.codigo).toBe(2);
    }
    expect(amb.saida.join('\n')).toMatch(/PARADO: 3 par\(es\) A em empate de etapa \(4ef235a4, f1545ba6, 997a8343\)/);
    expect(log.filter((t) => ['escrita', 'ensaio', 'backup'].includes(t))).toEqual([]);
    const amb2 = ambiente();
    const seco = await executar({ q, args: lerArgs([]), log: amb2.log, agora: amb2.agora, checkIgnore: amb2.checkIgnore });
    expect(seco.codigo).toBe(0);
    expect(amb2.saida.join('\n')).toMatch(/aviso: 3 par\(es\) A em empate/);
  });

  it('empate de etapa: o soft delete do perdedor vem ANTES da mescla (uma vez só) e o trigger não bate', () => {
    const m = mundoDe0311();
    const { pares } = avaliar({ ...medicao(m), fk: [] } as any, ESPERADO, { excluir: true });
    const empatados = pares.filter((p: any) => p.passos.empate).map((p: any) => p.perdedor.id.slice(0, 8));
    expect(empatados).toEqual(['4ef235a4', 'f1545ba6', '997a8343']);
    for (const par of pares.filter((p: any) => p.tipo === 'A')) {
      const sql = sqlDoPar(par, { perfilId: PERFIL, agoraIso: '2026-11-03T15:00:00Z' });
      const del = [...sql.matchAll(/set deleted_at = now\(\)/g)].map((x) => x.index!);
      expect(del).toHaveLength(1);
      if (par.passos.empate) expect(del[0]).toBeLessThan(sql.indexOf('merge_contacts('));
      else expect(del[0]).toBeGreaterThan(sql.indexOf('merge_contacts('));
      expect(() => checarTriggerDuplicado(m, sql)).not.toThrow();
    }
    // sem a flag, o SQL de um par empatado nem é montado
    const semFlag = avaliar({ ...medicao(m), fk: [] } as any, ESPERADO, { excluir: false }).pares.find((p: any) => p.passos.empate);
    expect(() => sqlDoPar(semFlag, { perfilId: PERFIL, agoraIso: '2026-11-03T15:00:00Z' })).toThrow(/exige --excluir-perdedores/);
  });

  it('sem --excluir-perdedores (sem empate): junta (AC2–AC4) e não exclui; depois só o AC5 roda', async () => {
    const m = mundoDe0311();
    // tira o empate dos 3 pares: o card que fica avançou uma etapa (N2: segue, com aviso)
    m.cards.get(uid('08750bc3')).stage_id = ETAPAS[1].id;
    m.cards.get(uid('1c01d6a5')).stage_id = ETAPAS[5].id;
    m.cards.get(uid('cf26cd4f')).stage_id = ETAPAS[2].id;
    const { q, log } = bancoSimulado(m);
    const amb = ambiente();
    const r1 = await executar({ q, args: { ...lerArgs(['--execute']), dirBackup: amb.dir }, log: amb.log, agora: amb.agora, checkIgnore: amb.checkIgnore });
    expect(r1.codigo).toBe(0);
    expect([...m.cards.values()].filter((d) => d.deleted_at)).toHaveLength(0);
    const r2 = await executar({ q, args: { ...lerArgs(['--execute', '--excluir-perdedores']), dirBackup: amb.dir }, log: amb.log, agora: () => new Date('2026-10-09T15:05:00Z'), checkIgnore: amb.checkIgnore });
    expect(r2.codigo).toBe(0);
    expect(r2.pares.filter((p: any) => p.tipo === 'A').every((p: any) => p.estado === 'mesclado' && !p.passos.mesclar && p.passos.excluir)).toBe(true);
    expect([...m.cards.values()].filter((d) => d.deleted_at)).toHaveLength(29);
    expect(m.notas.size).toBe(29);
    expect(log.filter((t) => t === 'escrita')).toHaveLength(58);
  });

  it('read-back que reprova (soft delete não persistiu) => código 3, não "feito"', async () => {
    const m = mundoDe0311();
    const { q } = bancoSimulado(m, { esquecerSoftDelete: true });
    const amb = ambiente();
    const r = await executar({ q, args: { ...lerArgs(['--execute', '--excluir-perdedores']), dirBackup: amb.dir }, log: amb.log, agora: amb.agora, checkIgnore: amb.checkIgnore });
    expect(r.codigo).toBe(3);
    expect(amb.saida.join('\n')).toMatch(/READ-BACK REPROVOU[\s\S]*sem deleted_at \(AC5\)/);
  });

  it('ensaio: cada par roda num bloco abortado pelo Postgres', async () => {
    const m = mundoDe0311();
    const { q, log } = bancoSimulado(m);
    const amb = ambiente();
    const r = await executar({ q, args: lerArgs(['--ensaio', '--excluir-perdedores']), log: amb.log, agora: amb.agora, checkIgnore: amb.checkIgnore });
    expect(r.codigo).toBe(0);
    expect(log.filter((t) => t === 'ensaio')).toHaveLength(29);
    expect(log).not.toContain('escrita');
  });

  it('N1: título reescrito sem relação com o nome novo => read-back reprova', async () => {
    const m = mundoDe0311();
    const { q: qBase } = bancoSimulado(m);
    const q = async (sql: string) => {
      const r = await qBase(sql);
      if (sql.includes('2.62:escrita:')) m.cards.get(uid('08750bc3')).title = 'Outra coisa';
      return r;
    };
    const amb = ambiente();
    const r = await executar({ q, args: { ...lerArgs(['--execute', '--excluir-perdedores']), dirBackup: amb.dir }, log: amb.log, agora: amb.agora, checkIgnore: amb.checkIgnore });
    expect(r.codigo).toBe(3);
    expect(amb.saida.join('\n')).toMatch(/título do sobrevivente mudou sem relação com o nome novo/);
  });

  it('SQL do par: nunca DELETE de deals, nunca muda stage_id, guarda nula reprova', () => {
    const m = mundoDe0311();
    const snap: any = { ...medicao(m), fk: [] };
    const { pares } = avaliar(snap, ESPERADO, { excluir: true });
    for (const par of pares) {
      const sql = sqlDoPar(par, { perfilId: PERFIL, agoraIso: '2026-10-09T15:00:00Z' });
      expect(sql).not.toMatch(/delete\s+from\s+public\.deals/i);
      expect(sql).not.toMatch(/set\s+stage_id/i);
      expect(sql).toMatch(/if coalesce\(\(/);
      if (par.tipo === 'A') expect(sql.indexOf('reset role')).toBeGreaterThan(sql.indexOf('merge_contacts('));
      expect(sql).not.toMatch(/set title =/); // N1: o script não devolve título
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Story 2.64, AC15 — o 2º card de produto (D7) não é duplicata
// ---------------------------------------------------------------------------------------------
describe('2.64 AC15 — etapas da loja do Instituto ficam fora de "card aberto no quadro"', () => {
  const [PRODUTOS, VENDIDO] = ETAPAS_DA_LOJA_DO_INSTITUTO;

  it('os uuids são os mesmos de lib/instituto/catalogo.ts', () => {
    expect([...ETAPAS_DA_LOJA_DO_INSTITUTO]).toEqual([...ETAPAS_DA_LOJA]);
  });

  it('a SQL de medição exclui as 2 etapas nas 4 buscas (telefone, email, dois_cards, lead_novo)', () => {
    const sql = sqlMedicao();
    const exclusoes = sql.match(/stage_id::text not in \('2f8091f5-90a8-4eae-bd2a-12f0d44b9517', '824878b0-2ab4-4c07-81d7-ec367b5ebd68'\)/g) ?? [];
    expect(exclusoes).toHaveLength(4);
  });

  const comContato = (m: Mundo, p: string) =>
    m.contatos.set(uid(p), { id: uid(p), name: 'Comprador', phone: '5541988887777', email: null, source: 'whatsapp', merged_into_id: null, deleted_at: null, organization_id: ORG });
  const comCard = (m: Mundo, p: string, contato: string, stageId: string) =>
    m.cards.set(uid(p), { id: uid(p), board_id: BOARD, stage_id: stageId, contact_id: uid(contato), title: 'X', created_at: '2026-11-05T12:00:00Z', deleted_at: null, is_won: false, is_lost: false, custom_fields: {}, organization_id: ORG });

  it('1 card de reabilitação + 1 em "Produtos de treinamento" (e 1 em "Produto vendido") ⇒ nenhuma divergência, nenhum par novo', async () => {
    const m = mundoDe0311();
    comContato(m, 'cccccc01');
    comCard(m, 'cccccc02', 'cccccc01', ETAPAS[2].id);
    comCard(m, 'cccccc03', 'cccccc01', PRODUTOS);
    comCard(m, 'cccccc04', 'cccccc01', VENDIDO);
    const { q } = bancoSimulado(m);
    const amb = ambiente();
    const r = await executar({ q, args: lerArgs(['--excluir-perdedores']), log: amb.log, agora: amb.agora, checkIgnore: amb.checkIgnore });
    expect(r.divergencias ?? []).toEqual([]);
    expect(r.codigo).toBe(0);
    expect(r.pares.some((p: any) => [p.perdedor?.id, p.sobrevivente?.id].includes(uid('cccccc03')))).toBe(false);
    expect(r.pares).toHaveLength(29); // os 8 A + 21 B da lista de 03/11, nada a mais
  });

  it('2 cards de REABILITAÇÃO abertos do mesmo contato ⇒ o par continua sendo achado (o ajuste não cega o script)', async () => {
    const m = mundoDe0311();
    comContato(m, 'cccccc01');
    comCard(m, 'cccccc02', 'cccccc01', ETAPAS[1].id);
    comCard(m, 'cccccc05', 'cccccc01', ETAPAS[2].id);
    comCard(m, 'cccccc03', 'cccccc01', PRODUTOS);
    const { q } = bancoSimulado(m);
    const amb = ambiente();
    const r = await executar({ q, args: lerArgs(['--excluir-perdedores']), log: amb.log, agora: amb.agora, checkIgnore: amb.checkIgnore });
    expect(r.codigo).toBe(2);
    const msg = r.divergencias.join(' | ');
    expect(msg).toMatch(/contato cccccc01 com 2 cards abertos, fora da lista/);
  });
});
