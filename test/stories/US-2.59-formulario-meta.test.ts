/**
 * Story 2.59 — "O formulário que a Fernanda não vê" (AC1, AC3–AC7, AC10, AC12, T3.6b).
 *
 * A rota `POST /api/public/v1/meta-form-leads` roda de verdade; o banco é o
 * `FakeSupabase` (em memória, com as travas que decidem o comportamento em
 * produção: índice do leadgen, trigger `check_deal_duplicate`, UNIQUE da
 * idempotência). Todo AC de escrita é provado RELENDO o estado e afirmando o
 * VALOR — "a rota respondeu 200" não prova nada (regra geral da story).
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSupabase } from '@/test/helpers/fakeSupabase';

const ORG = '83160646-16a0-4cb7-9067-7ce7ef34ff50';
const BOARD = '5f6bded2-0f7c-418d-9598-7ea75d032242';
const LEAD_NOVO = '82d1a222-eeff-4627-baed-881908dbd702';
const QUALIFICADO = '3b1384fa-5fe2-4725-a8e1-7576a8690637';
const PERDIDO = '78defbd3-6ca4-4b96-b67a-2268e7e6dce5';
const GANHO = 'f359ee98-b7b1-460d-a7be-2ef92f92c4c7';

let db: FakeSupabase;

vi.mock('@/lib/supabase/server', () => ({ createStaticAdminClient: () => db }));
vi.mock('@/lib/public-api/auth', () => ({
  authPublicApi: vi.fn(async () => ({
    ok: true,
    organizationId: ORG,
    organizationName: 'Acreditando',
    apiKeyId: 'k1',
    apiKeyPrefix: 'n8n_',
  })),
}));

import { POST } from '@/app/api/public/v1/meta-form-leads/route';
import { idDaNota, TITULO_DA_NOTA } from '@/lib/meta-form/processarLead';
import { TABELAS } from '@/lib/meta-form/traducao';

// --------------------------------------------------------------------------
// Fábricas
// --------------------------------------------------------------------------

const ENVIO = '2026-09-28T13:00:00.000Z';
const TELEFONE_DO_FORM = 'p:+5535998205552'; // com o 9º dígito (formato da Meta)
const TELEFONE_DO_WPP = '+553598205552'; // sem o 9º dígito (formato do WhatsApp)
const DIAGNOSTICO_META = 'lesão_medular';

function lead(over: Record<string, unknown> = {}, campos: Record<string, string> = {}) {
  const base: Record<string, string> = {
    'para_quem_é_o_acompanhamento?': 'para_um_familiar_ou_pessoa_próxima',
    'qual_é_a_sua_principal_condição_ou_diagnóstico?': DIAGNOSTICO_META,
    'há_quanto_tempo_ocorreu_a_lesão_ou_diagnóstico?': 'de_1_a_3_anos',
    'você_já_realiza_algum_tipo_de_acompanhamento_ou_reabilitação?': 'já_realizei,_mas_estou_sem_',
    'quando_pretende_iniciar?': 'nos_próximos_30_dias',
    'para_entendermos_melhor_suas_possibilidades_e_apresentarmos_as_opções_de_acompanhamento,_qual_faixa_de_investimento_mensal_você_considera_possível?':
      'r$_500_a_r$_1.000',
    nome_completo: 'Joana Teste',
    email: 'joana.teste@exemplo.com',
    phone_number: TELEFONE_DO_FORM,
    'endereço': 'Rua Teste, 100 - Pouso Alegre/MG',
    ...campos,
  };
  return {
    leadgen_id: 'l:1234567890123456',
    created_time: ENVIO,
    campaign_id: 'c:120200000000000001',
    campaign_name: 'ACREDITANDO | LEAD | 2026-09',
    ad_id: 'ag:120200000000000009',
    ad_name: 'Criativo A',
    field_data: Object.entries(base).map(([name, v]) => ({ name, values: [v] })),
    ...over,
  };
}

async function enviar(corpo: unknown, opts: { chave?: string; ensaio?: boolean } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-api-key': 'x' };
  if (opts.chave) headers['idempotency-key'] = opts.chave;
  const url = `http://localhost/api/public/v1/meta-form-leads${opts.ensaio ? '?ensaio=1' : ''}`;
  const res = await POST(new Request(url, { method: 'POST', headers, body: JSON.stringify(corpo) }));
  return { status: res.status, body: (await res.json()) as any };
}

function contato(over: Record<string, unknown> = {}) {
  const c = {
    id: crypto.randomUUID(),
    organization_id: ORG,
    name: 'Joana (WhatsApp)',
    phone: TELEFONE_DO_WPP,
    email: null,
    source: 'whatsapp',
    notes: 'nota da atendente',
    deleted_at: null,
    merged_into_id: null,
    created_at: '2026-09-28T12:59:00.000Z',
    updated_at: '2026-09-28T12:59:00.000Z',
    ...over,
  };
  db.tabelas.contacts.push(c);
  return c;
}

function card(contactId: string, over: Record<string, unknown> = {}) {
  const d = {
    id: crypto.randomUUID(),
    organization_id: ORG,
    title: 'Joana - WhatsApp',
    board_id: BOARD,
    stage_id: QUALIFICADO,
    contact_id: contactId,
    owner_id: 'dono-1',
    is_won: false,
    is_lost: false,
    custom_fields: {} as Record<string, unknown>,
    ai_extracted: {} as Record<string, unknown>,
    lead_score: null as number | null,
    lead_score_known: null as number | null,
    lead_score_source: null as string | null,
    lead_score_detail: null as unknown,
    pontuada_pela_ia_em: null as string | null,
    deleted_at: null,
    created_at: '2026-09-28T12:59:30.000Z',
    updated_at: '2026-09-28T12:59:30.000Z',
    ...over,
  };
  db.tabelas.deals.push(d);
  return d;
}

const cardsDoContato = (id: string) => db.tabelas.deals.filter((d) => d.contact_id === id && !d.deleted_at);
const notas = () => db.tabelas.activities.filter((a) => a.type === 'NOTE' && a.title === TITULO_DA_NOTA);
const COLUNAS_DE_NOTA = ['lead_score', 'lead_score_known', 'lead_score_source', 'lead_score_detail', 'pontuada_pela_ia_em'];

beforeEach(() => {
  db = new FakeSupabase();
  db.tabelas.board_stages.push({ id: LEAD_NOVO, board_id: BOARD, organization_id: ORG, name: 'Lead novo' });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-28T13:30:00.000Z')); // 30 min depois do envio
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// --------------------------------------------------------------------------
// AC1 — a migration
// --------------------------------------------------------------------------

describe('2.59 AC1 — migration dos campos novos + índice único', () => {
  const sql = fs.readFileSync(
    path.resolve(__dirname, '../../supabase/migrations/20260929120000_campos_do_formulario_meta.sql'),
    'utf8'
  );
  const semComentario = sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');

  const chavesNovas = [...semComentario.matchAll(/\('([A-Za-z]+)',\s*'[^']+',\s*'(text|select)'/g)].map((m) => m[1]);

  it('cria EXATAMENTE as 6 chaves novas e nenhuma das 5 descartadas nem das 5 antigas', () => {
    expect(chavesNovas.sort()).toEqual(
      ['faixaDeInvestimentoMensal', 'metaAnuncio', 'metaCampanha', 'metaLeadgenId', 'origemDoLead', 'quandoPretendeIniciar'].sort()
    );
    for (const k of ['metaEnviadoEm', 'metaPlataforma', 'metaFormulario', 'metaConjunto', 'metaRespostasBrutas']) {
      expect(semComentario).not.toContain(`'${k}'`);
    }
    for (const k of ['paraQuemE', 'tipoDeLesao', 'haQuantoTempo', 'jaFezReabilitacao', 'ondeReside']) {
      expect(semComentario).not.toContain(`'${k}'`);
    }
  });

  it('opções do select batem, com acento, com o texto que a rota grava', () => {
    const opcoes = (chave: string) => {
      const bloco = semComentario.match(new RegExp(`'${chave}'[^]*?array\\[([^\\]]*)\\]`))?.[1] ?? '';
      return [...bloco.matchAll(/'([^']*)'/g)].map((m) => m[1]);
    };
    expect(opcoes('quandoPretendeIniciar')).toEqual(TABELAS.quandoPretendeIniciar.map(([, o]) => o));
    expect([...opcoes('faixaDeInvestimentoMensal')].sort()).toEqual(
      TABELAS.faixaDeInvestimentoMensal.map(([, o]) => o).sort()
    );
    expect(opcoes('origemDoLead')).toEqual(['Formulário Meta', 'LP Acreditando', 'WhatsApp', 'Indicação', 'Outro']);
  });

  it('idempotente (ON CONFLICT DO NOTHING + IF NOT EXISTS), índice parcial por card vivo, sem remoção', () => {
    expect(semComentario).toMatch(/on conflict \(key, organization_id\) do nothing/i);
    expect(semComentario).toMatch(/create unique index if not exists deals_meta_leadgen_id_uidx/i);
    expect(semComentario).toMatch(/\(organization_id, \(custom_fields->>'metaLeadgenId'\)\)/);
    expect(semComentario).toMatch(/where custom_fields \? 'metaLeadgenId'\s+and deleted_at is null/i);
    expect(semComentario).not.toMatch(/\b(drop|truncate|delete|alter)\b/i);
  });
});

// --------------------------------------------------------------------------
// AC3 + AC4 + AC5 + AC6 — lead que já tem card aberto
// --------------------------------------------------------------------------

describe('2.59 AC3/AC5 — lead com card aberto: completa, não duplica, não sobrescreve', () => {
  it('acha o contato do WhatsApp SEM o 9º dígito, preserva o valor digitado e preenche só os vazios', async () => {
    const c = contato();
    const d = card(c.id, { custom_fields: { paraQuemE: 'Para a mãe (digitado pela Fernanda)' } });
    const antes = cardsDoContato(c.id).length;

    const r = await enviar(lead(), { chave: 'meta-lead:1234567890123456' });
    expect(r.status).toBe(200);
    expect(r.body.acao).toBe('completou');
    expect(r.body.deal_id).toBe(d.id);
    expect(r.body.contact_id).toBe(c.id);

    // Read-back do card
    const relido = db.tabelas.deals.find((x) => x.id === d.id)!;
    expect(relido.custom_fields).toEqual({
      paraQuemE: 'Para a mãe (digitado pela Fernanda)', // valor antigo, intacto
      tipoDeLesao: 'Lesão medular',
      haQuantoTempo: 'De 1 a 3 anos',
      jaFezReabilitacao: 'Já realizei, mas estou sem acompanhamento',
      quandoPretendeIniciar: 'Nos próximos 30 dias',
      faixaDeInvestimentoMensal: 'R$ 500 a R$ 1.000',
      ondeReside: 'Rua Teste, 100 - Pouso Alegre/MG',
      origemDoLead: 'Formulário Meta',
      metaLeadgenId: '1234567890123456',
      metaCampanha: '120200000000000001 · ACREDITANDO | LEAD | 2026-09',
      metaAnuncio: '120200000000000009 · Criativo A',
    });
    expect(r.body.campos_pulados).toContainEqual({ campo: 'paraQuemE', motivo: 'campo_ja_preenchido' });
    expect(r.body.campos_gravados).not.toContain('paraQuemE');

    // Proveniência com a origem certa
    expect(relido.ai_extracted.customFields.tipoDeLesao).toMatchObject({
      source: 'meta_form',
      leadgenId: '1234567890123456',
      value: 'Lesão medular',
    });
    expect(relido.ai_extracted.customFields.paraQuemE).toBeUndefined();

    // Não muda estágio, título, dono; carimba updated_at
    expect(relido.stage_id).toBe(QUALIFICADO);
    expect(relido.title).toBe('Joana - WhatsApp');
    expect(relido.owner_id).toBe('dono-1');
    expect(relido.updated_at).toBe('2026-09-28T13:30:00.000Z');

    // Não duplica
    expect(cardsDoContato(c.id).length).toBe(antes);

    // AC5: telefone relido continua SEM o 9; origem whatsapp mantida; nome não trocado
    const cRelido = db.tabelas.contacts.find((x) => x.id === c.id)!;
    expect(cRelido.phone).toBe(TELEFONE_DO_WPP);
    expect(cRelido.source).toBe('whatsapp');
    expect(cRelido.name).toBe('Joana (WhatsApp)');
    expect(cRelido.notes).toBe('nota da atendente');
    expect(db.tabelas.contacts).toHaveLength(1);
  });

  it('mais de um card aberto ⇒ completa o MAIS ANTIGO; card de outro quadro e excluído não contam', async () => {
    const c = contato();
    card(c.id, { board_id: '00000000-0000-4000-8000-000000000001', created_at: '2026-01-01T00:00:00Z' });
    card(c.id, { deleted_at: '2026-09-01T00:00:00Z', created_at: '2026-02-01T00:00:00Z' });
    const antigo = card(c.id, { created_at: '2026-09-01T00:00:00Z', stage_id: '9f1b2a7a-e6b1-4e04-b041-87581fc6a8a9' });
    card(c.id, { created_at: '2026-09-20T00:00:00Z', stage_id: LEAD_NOVO });

    const r = await enviar(lead());
    expect(r.body.deal_id).toBe(antigo.id);
  });

  it('contato MESCLADO (mesmo o mais antigo com o telefone) é ignorado; vale o vivo', async () => {
    contato({ merged_into_id: 'x', name: 'mesclado', created_at: '2026-01-01T00:00:00Z' });
    const vivo = contato({ created_at: '2026-09-01T00:00:00Z' });
    const d = card(vivo.id);
    const r = await enviar(lead());
    expect(r.body.contact_id).toBe(vivo.id);
    expect(r.body.deal_id).toBe(d.id);
  });

  it('contato por e-mail só quando o telefone não acha ninguém', async () => {
    contato({ phone: '+5511900000000', email: 'joana.teste@exemplo.com', merged_into_id: 'x', name: 'mesclado', created_at: '2026-01-01T00:00:00Z' });
    const porEmail = contato({ phone: '+5511911111111', email: 'joana.teste@exemplo.com', created_at: '2026-09-01T00:00:00Z' });
    const d = card(porEmail.id);
    const r = await enviar(lead());
    expect(r.body.contact_id).toBe(porEmail.id);
    expect(r.body.deal_id).toBe(d.id);
  });
});

describe('2.59 AC6 — o formulário não mexe na nota (estrelas)', () => {
  it.each([
    ['card com nota n8n', { lead_score: 3, lead_score_known: 5, lead_score_source: 'n8n', lead_score_detail: { origem: 'n8n:05-transferencia' }, pontuada_pela_ia_em: '2026-09-27T10:00:00Z' }],
    ['card sem nota', {}],
  ])('%s: as 5 colunas de nota idênticas depois', async (_nome, nota) => {
    const c = contato();
    const d = card(c.id, nota);
    const antes = Object.fromEntries(COLUNAS_DE_NOTA.map((k) => [k, (d as any)[k]]));

    const r = await enviar(lead());
    expect(r.body.acao).toBe('completou');

    const relido = db.tabelas.deals.find((x) => x.id === d.id)!;
    expect(Object.fromEntries(COLUNAS_DE_NOTA.map((k) => [k, (relido as any)[k]]))).toEqual(antes);
    // E nenhuma escrita em `deals` sequer MENCIONA essas colunas.
    for (const w of db.escritas.filter((e) => e.tabela === 'deals')) {
      for (const k of COLUNAS_DE_NOTA) expect(JSON.stringify(w.payload)).not.toContain(`"${k}"`);
    }
  });
});

describe('2.59 AC4 — as respostas ficam anotadas no histórico', () => {
  it('exatamente 1 nota por leadgen id, com TODAS as respostas (inclusive diagnóstico e as já preenchidas); reenvio continua 1', async () => {
    const c = contato();
    const d = card(c.id, { custom_fields: { paraQuemE: 'Para a mãe' } });

    await enviar(lead());
    await enviar(lead()); // sem chave: a camada 2 acha o card do leadgen

    expect(notas()).toHaveLength(1);
    const n = notas()[0];
    expect(n.id).toBe(idDaNota(ORG, '1234567890123456'));
    expect(n.deal_id).toBe(d.id);
    expect(n.contact_id).toBe(c.id);
    expect(n.title).toBe('Respostas do Formulário Meta'); // título neutro, sem diagnóstico
    expect(n.description).toContain('Qual é a sua principal condição ou diagnóstico? Lesão medular');
    expect(n.description).toContain('Para quem é o acompanhamento? Para um familiar ou pessoa próxima');
    expect(n.description).toContain('Faixa de investimento mensal R$ 500 a R$ 1.000');
    expect(n.description).toContain('Já estavam preenchidos no card e não foram alterados: paraQuemE');
    // Sem nome, telefone nem e-mail na nota
    expect(n.description).not.toContain('Joana');
    expect(n.description).not.toContain('98205552');
    expect(n.description).not.toContain('@exemplo.com');
  });
});

// --------------------------------------------------------------------------
// AC7 — sem contato: carência de 10 min, depois cria contato + card
// --------------------------------------------------------------------------

describe('2.59 AC7 — carência e criação', () => {
  it('3 min ⇒ 202 sem gravar NADA e com a chave LIBERADA; 11 min, MESMA chave ⇒ cria 1 contato + 1 card em Lead novo', async () => {
    const chave = 'meta-lead:1234567890123456';
    vi.setSystemTime(new Date('2026-09-28T13:03:00.000Z'));
    const r1 = await enviar(lead(), { chave });
    expect(r1.status).toBe(202);
    expect(r1.body.acao).toBe('aguardando');
    expect(db.tabelas.contacts).toHaveLength(0);
    expect(db.tabelas.deals).toHaveLength(0);
    expect(db.tabelas.activities).toHaveLength(0);
    expect(db.tabelas.public_api_idempotency).toHaveLength(0); // reserva liberada
    expect(db.escritas.filter((e) => e.tabela !== 'public_api_idempotency')).toHaveLength(0);

    vi.setSystemTime(new Date('2026-09-28T13:11:00.000Z'));
    const r2 = await enviar(lead(), { chave });
    expect(r2.status).toBe(201);
    expect(r2.body.acao).toBe('criou_contato_e_card');
    expect(r2.body.idempotent_replay).toBeUndefined();
    expect(r2.body.code).toBeUndefined(); // nem IDEMPOTENCY_IN_PROGRESS

    expect(db.tabelas.contacts).toHaveLength(1);
    const c = db.tabelas.contacts[0];
    expect(c.phone).toBe('+5535998205552'); // COM o 9º dígito
    expect(c.source).toBe('meta_form');
    expect(c.name).toBe('Joana Teste');
    expect(c.email).toBe('joana.teste@exemplo.com');

    expect(db.tabelas.deals).toHaveLength(1);
    const d = db.tabelas.deals[0];
    expect(d.stage_id).toBe(LEAD_NOVO); // id, não nome
    expect(d.board_id).toBe(BOARD);
    expect(d.title).toBe('Joana Teste - Formulário Meta');
    expect(d.contact_id).toBe(c.id);
    expect(d.custom_fields.tipoDeLesao).toBe('Lesão medular');
    expect(d.custom_fields.origemDoLead).toBe('Formulário Meta');
    expect(notas()).toHaveLength(1);
    expect(db.rpcChamadas[0].args.p_source).toBe('meta_form');
  });

  it('contato achado só com cards terminais ⇒ cria card novo (criou_card), sem tocar nos terminais', async () => {
    const c = contato();
    const perdido = card(c.id, { stage_id: PERDIDO });
    card(c.id, { stage_id: GANHO, is_won: true });

    const r = await enviar(lead());
    expect(r.status).toBe(201);
    expect(r.body.acao).toBe('criou_card');
    expect(r.body.deal_id).not.toBe(perdido.id);
    expect(cardsDoContato(c.id)).toHaveLength(3);
    expect(db.tabelas.deals.find((x) => x.id === perdido.id)!.custom_fields).toEqual({});
    expect(db.tabelas.contacts).toHaveLength(1);
  });

  it('P3: contato achado com origem vazia passa a meta_form; com whatsapp continua whatsapp', async () => {
    const semOrigem = contato({ source: null, name: '' });
    card(semOrigem.id);
    await enviar(lead());
    const relido = db.tabelas.contacts.find((x) => x.id === semOrigem.id)!;
    expect(relido.source).toBe('meta_form');
    expect(relido.name).toBe('Joana Teste'); // nome só porque estava vazio
    expect(relido.phone).toBe(TELEFONE_DO_WPP);
  });

  it('T3.6b / R11: se a função devolver contato MESCLADO, o card nasce no contato VIVO de destino', async () => {
    const vivo = contato({ phone: '+5511922222222', name: 'Destino vivo', created_at: '2026-01-01T00:00:00Z' });
    const mesclado = contato({ merged_into_id: vivo.id, deleted_at: '2026-09-01T00:00:00Z' });
    // Simula a versão ANTIGA de `find_or_create_contact` (sem filtro de mesclado).
    vi.spyOn(db, 'rpc').mockImplementation(async () => ({ data: mesclado.id, error: null }));

    const r = await enviar(lead());
    expect(r.status).toBe(201);
    expect(r.body.contact_id).toBe(vivo.id);
    expect(db.tabelas.deals[0].contact_id).toBe(vivo.id);
    expect(cardsDoContato(mesclado.id)).toHaveLength(0);
  });
});

// --------------------------------------------------------------------------
// AC10 — idempotência em duas camadas
// --------------------------------------------------------------------------

describe('2.59 AC10 — o mesmo lead 3× (2 em paralelo) ⇒ 1 card, 1 nota, mesmo deal_id', () => {
  it('SEM Idempotency-Key: a camada 2 (índice do leadgen) faz as 3 respostas dizerem o mesmo deal_id', async () => {
    const [a, b] = await Promise.all([enviar(lead()), enviar(lead())]);
    const c = await enviar(lead());
    const ids = [a, b, c].map((r) => r.body.deal_id);
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toBeTruthy();
    expect(db.tabelas.deals).toHaveLength(1);
    expect(notas()).toHaveLength(1);
    expect([a, b, c].map((r) => r.body.acao).sort()).toEqual(['criou_contato_e_card', 'ja_processado', 'ja_processado']);
  });

  it('COM a mesma chave: 1 card e 1 nota; o paralelo recebe "em curso", o reenvio recebe o replay com o mesmo deal_id', async () => {
    const chave = 'meta-lead:1234567890123456';
    const [a, b] = await Promise.all([enviar(lead(), { chave }), enviar(lead(), { chave })]);
    const c = await enviar(lead(), { chave });

    expect(db.tabelas.deals).toHaveLength(1);
    expect(notas()).toHaveLength(1);
    const criado = [a, b].find((r) => r.status === 201)!;
    const emCurso = [a, b].find((r) => r.status !== 201)!;
    expect(emCurso.body.code).toBe('IDEMPOTENCY_IN_PROGRESS');
    expect(c.status).toBe(201);
    expect(c.body.idempotent_replay).toBe(true);
    expect(c.body.deal_id).toBe(criado.body.deal_id);
  });

  it('mesma chave com corpo diferente ⇒ 409 IDEMPOTENCY_CONFLICT', async () => {
    const chave = 'meta-lead:1234567890123456';
    await enviar(lead(), { chave });
    const r = await enviar(lead({ ad_name: 'Outro' }), { chave });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('23505 do trigger check_deal_duplicate NÃO vira "já processado": 409 e nada gravado', async () => {
    const c = contato();
    card(c.id, { stage_id: PERDIDO });
    // O mesmo código 23505 do índice, vindo do trigger (mesmo contato + mesmo estágio).
    db.falharProxima('deals', 'upsert', { code: '23505', message: 'Já existe um negócio para este contato' });
    const r = await enviar(lead());
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('CONFLICT');
    expect(db.tabelas.deals).toHaveLength(1);
    expect(notas()).toHaveLength(0);
  });
});

// --------------------------------------------------------------------------
// AC12 — resposta e logs sem dado pessoal
// --------------------------------------------------------------------------

describe('2.59 AC12 — resposta e log sem dado pessoal', () => {
  const SENSIVEIS = ['Joana', '98205552', 'joana.teste', 'Rua Teste', 'Lesão', 'lesão', 'medular'];

  it('erro de banco com o valor no texto: o log (lista branca) não carrega telefone nem diagnóstico', async () => {
    const erros: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void erros.push(a.map(String).join(' ')));
    contato();
    db.falharProxima('deals', 'select', {
      code: 'XX000',
      message: 'Failing row contains (+5535998205552, lesão_medular, Joana Teste)',
      details: 'Key (phone)=(+5535998205552)',
    });

    const r = await enviar(lead());
    expect(r.status).toBe(500);
    expect(erros.length).toBeGreaterThan(0);
    const log = erros.join('\n');
    for (const s of SENSIVEIS) expect(log).not.toContain(s);
    expect(log).toContain('meta_form_lead_erro');
    for (const s of SENSIVEIS) expect(JSON.stringify(r.body)).not.toContain(s);
  });

  it('resposta de sucesso tem só { acao, contact_id, deal_id, campos_gravados, campos_pulados, request_id }', async () => {
    const c = contato();
    card(c.id);
    const r = await enviar(lead());
    expect(Object.keys(r.body).sort()).toEqual(
      ['acao', 'campos_gravados', 'campos_pulados', 'contact_id', 'deal_id', 'request_id'].sort()
    );
    for (const s of SENSIVEIS) expect(JSON.stringify(r.body)).not.toContain(s);
  });
});

// --------------------------------------------------------------------------
// AC9 — ensaio (sem gravar)
// --------------------------------------------------------------------------

describe('2.59 AC9 — ensaio decide sem gravar', () => {
  it('?ensaio=1 devolve a ação prevista e não escreve em tabela nenhuma (nem idempotência)', async () => {
    const c = contato();
    card(c.id);
    const r1 = await enviar(lead(), { ensaio: true, chave: 'meta-lead:1234567890123456' });
    expect(r1.body).toMatchObject({ acao: 'completou', ensaio: true });

    const r2 = await enviar(lead({ leadgen_id: '999999999999' }, { phone_number: 'p:+5511987650000', email: 'x@y.z' }), {
      ensaio: true,
    });
    expect(r2.body).toMatchObject({ acao: 'criou_contato_e_card', ensaio: true });

    expect(db.escritas).toHaveLength(0);
    expect(db.rpcChamadas).toHaveLength(0);
    expect(db.tabelas.public_api_idempotency).toHaveLength(0);
  });
});

// --------------------------------------------------------------------------
// AC9/AC10 — o corpo que o script do CSV monta é aceito pela rota e é determinístico
// --------------------------------------------------------------------------

describe('2.59 AC9 — corpo do backfill pelo CSV', () => {
  it('CSV UTF-16LE com prefixos da Meta (l:, ag:, c:, p:) vira corpo válido, estável e sem prefixo', async () => {
    const { lerCsv, corpoDoLead } = await import('@/scripts/meta-form/backfill-formulario-meta.mjs');
    const { MetaFormLeadSchema } = await import('@/lib/meta-form/processarLead');
    const os = await import('node:os');
    const cab = ['id', 'created_time', 'ad_id', 'ad_name', 'campaign_id', 'campaign_name', 'form_id', 'platform',
      'para_quem_é_o_acompanhamento?', 'nome_completo', 'phone_number', 'endereço', 'lead_status'];
    const linha = ['l:1234567890123456', '2026-09-25T21:42:10-03:00', 'ag:120200000000000009', 'Criativo A',
      'c:120200000000000001', 'ACREDITANDO | LEAD', 'f:1635930144720093', 'fb', 'para_mim', 'Fulana Ficticia',
      'p:+5511987650000', 'Rua Ficticia, 1', 'complete'];
    const arquivo = path.join(os.tmpdir(), `csv-2-59-${Date.now()}.csv`);
    fs.writeFileSync(arquivo, Buffer.from('﻿' + cab.join('\t') + '\n' + linha.join('\t') + '\n', 'utf16le'));
    try {
      const [l] = lerCsv(arquivo);
      const corpo = corpoDoLead(l);
      expect(MetaFormLeadSchema.safeParse(corpo).success).toBe(true);
      expect(corpo.leadgen_id).toBe('1234567890123456');
      expect(corpo.ad_id).toBe('120200000000000009');
      expect(corpo.campaign_id).toBe('120200000000000001');
      expect(corpo.field_data.find((f: any) => f.name === 'phone_number').values).toEqual(['+5511987650000']);
      expect(corpo.field_data.map((f: any) => f.name)).not.toContain('lead_status');
      expect(JSON.stringify(corpoDoLead(l))).toBe(JSON.stringify(corpo)); // determinístico
    } finally {
      fs.unlinkSync(arquivo);
    }
  });
});
