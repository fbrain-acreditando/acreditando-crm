/**
 * Story 2.64 — "O pedido da loja que vira card da Fernanda" (AC1–AC12, AC15 à parte).
 *
 * A rota `POST /api/public/v1/instituto-leads` roda de verdade; o banco é o
 * `FakeSupabase` (em memória, com as travas que decidem o comportamento em
 * produção: trigger `check_deal_duplicate`, UNIQUE da idempotência, RPC da
 * 2.63). Todo AC de escrita é provado RELENDO o estado e afirmando o VALOR —
 * "respondeu 201" não prova nada (regra geral da story).
 *
 * Telefones de teste são fictícios.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSupabase } from '@/test/helpers/fakeSupabase';

const ORG = '83160646-16a0-4cb7-9067-7ce7ef34ff50';
const BOARD = '5f6bded2-0f7c-418d-9598-7ea75d032242';
const LEAD_NOVO = '82d1a222-eeff-4627-baed-881908dbd702';
const QUALIFICADO = '3b1384fa-5fe2-4725-a8e1-7576a8690637';
const CAMPANHA_NOVEMBRO = 'd0171b1d-3043-420f-8459-7db8aae35947';
const GANHO = 'f359ee98-b7b1-460d-a7be-2ef92f92c4c7';
const PERDIDO = '78defbd3-6ca4-4b96-b67a-2268e7e6dce5';
const CLIENTES = '3ed212e5-32a9-4bda-8d70-bb8be49e790d';
const PROFISSIONAL = '2da4a3f4-4333-4c79-a990-491e789d5096';
const FERNANDA = '767d620e-5f13-4d25-a283-5b50141f02d8';

/** A chave nova da T11 (a única da lista) e a chave `n8n` de hoje (fora da lista). */
const CHAVE_DA_LOJA = '0e0e0e0e-1111-4222-8333-444444444444';
const CHAVE_N8N = 'c9fda19e-a9a1-41c6-8477-12283165a937';

let db: FakeSupabase;

vi.mock('@/lib/supabase/server', () => ({ createStaticAdminClient: () => db }));
vi.mock('@/lib/public-api/auth', () => ({
  authPublicApi: vi.fn(async (req: Request) => {
    const token = req.headers.get('x-api-key') || '';
    if (!token) return { ok: false, status: 401, body: { error: 'Missing X-Api-Key', code: 'AUTH_MISSING' } };
    return { ok: true, organizationId: ORG, organizationName: 'Acreditando', apiKeyId: token, apiKeyPrefix: 'x_' };
  }),
}));

import { POST } from '@/app/api/public/v1/instituto-leads/route';
import { idDaNota, TITULO_DA_NOTA, decidirCard, impressaoDoPedido, normalizarEmail } from '@/lib/instituto/processarPedido';
import {
  ETAPA_PRODUTO_VENDIDO,
  ETAPA_PRODUTOS_DE_TREINAMENTO,
  PERFIS_DA_LOJA,
  PRODUTOS_DA_LOJA,
  VERSOES_DO_AVISO_ACEITAS,
} from '@/lib/instituto/catalogo';
import { ESTAGIOS_TERMINAIS_ACREDITANDO } from '@/lib/deals/cardAberto';

// --------------------------------------------------------------------------
// Fábricas
// --------------------------------------------------------------------------

const TEL_COM_9 = '5541998887777'; // como a página manda: 55 + DDD + 9 dígitos
const TEL_SEM_9_E164 = '+554198887777'; // como o WhatsApp costuma gravar
const TEL_COM_9_E164 = '+5541998887777';
const AGORA = '2026-11-05T17:10:00.000Z';

function pedido(over: Record<string, unknown> = {}) {
  return {
    nome: 'Joana Teste da Silva',
    email: 'joana.teste@exemplo.com',
    whatsapp: TEL_COM_9,
    perfil: 'familiar_ou_cuidador',
    produto: 'luvas-inclusivas',
    consentimento: { aceito: true, texto_versao: '2026-10-v3', aceito_em: '2026-11-05T14:05:00-03:00' },
    pagina: 'https://instituto.acreditando.com.br/#loja',
    ...over,
  };
}

const chaveDe = (semente: string) => `instituto:${createHash('sha256').update(semente).digest('hex')}`;
const CHAVE_PADRAO = chaveDe('pedido-1');

async function enviar(
  corpo: unknown,
  opts: { chave?: string | null; apiKey?: string | null; ensaio?: boolean } = {}
) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const apiKey = opts.apiKey === undefined ? CHAVE_DA_LOJA : opts.apiKey;
  if (apiKey) headers['x-api-key'] = apiKey;
  const chave = opts.chave === undefined ? CHAVE_PADRAO : opts.chave;
  if (chave) headers['idempotency-key'] = chave;
  const url = `http://localhost/api/public/v1/instituto-leads${opts.ensaio ? '?ensaio=1' : ''}`;
  const res = await POST(new Request(url, { method: 'POST', headers, body: JSON.stringify(corpo) }));
  return { status: res.status, body: (await res.json()) as any };
}

function contato(over: Record<string, unknown> = {}) {
  const c = {
    id: crypto.randomUUID(),
    organization_id: ORG,
    name: 'Joana (WhatsApp)',
    phone: TEL_SEM_9_E164,
    email: null,
    source: 'whatsapp',
    notes: 'nota da atendente',
    deleted_at: null,
    merged_into_id: null,
    created_at: '2026-10-01T12:00:00.000Z',
    updated_at: '2026-10-01T12:00:00.000Z',
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
    value: 0,
    board_id: BOARD,
    stage_id: QUALIFICADO,
    contact_id: contactId,
    owner_id: 'dono-reabilitacao',
    is_won: false,
    is_lost: false,
    custom_fields: { paraQuemE: 'Para a mãe', tipoDeLesao: 'Lesão medular' } as Record<string, unknown>,
    ai_extracted: {} as Record<string, unknown>,
    deleted_at: null,
    created_at: '2026-10-01T12:00:30.000Z',
    updated_at: '2026-10-01T12:00:30.000Z',
    ...over,
  };
  db.tabelas.deals.push(d);
  return d;
}

const cardsDoContato = (id: string) => db.tabelas.deals.filter((d) => d.contact_id === id && !d.deleted_at);
const notas = () => db.tabelas.activities.filter((a) => a.type === 'NOTE' && a.title === TITULO_DA_NOTA);
const copia = <T>(o: T): T => JSON.parse(JSON.stringify(o));
const COLUNAS_DE_NOTA = ['lead_score', 'lead_score_known', 'lead_score_source', 'lead_score_detail', 'pontuada_pela_ia_em'];

beforeEach(() => {
  db = new FakeSupabase();
  db.tabelas.board_stages.push({ id: ETAPA_PRODUTOS_DE_TREINAMENTO, board_id: BOARD, organization_id: ORG, name: 'Produtos de treinamento' });
  vi.stubEnv('INSTITUTO_LEADS_API_KEY_IDS', CHAVE_DA_LOJA);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(AGORA));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// --------------------------------------------------------------------------
// AC1 — migration (lida como texto; a prova em produção é o read-back da T2)
// --------------------------------------------------------------------------

describe('2.64 AC1 — migration: 2 etapas, 4 campos, 1 origem, reverter', () => {
  const pasta = path.resolve(__dirname, '../../supabase/migrations');
  const sql = fs.readFileSync(path.join(pasta, '20261105120000_produtos_de_treinamento.sql'), 'utf8');
  const reverter = fs.readFileSync(path.join(pasta, '20261105120000_produtos_de_treinamento_REVERTER.sql'), 'utf8');
  const semComentario = (s: string) => s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  const codigo = semComentario(sql);

  it('timestamp depois da 2.69 (20261104120000) e nenhum outro arquivo com o mesmo prefixo', () => {
    const mesmos = fs.readdirSync(pasta).filter((n) => n.startsWith('20261105120000_'));
    expect(mesmos.sort()).toEqual(['20261105120000_produtos_de_treinamento.sql', '20261105120000_produtos_de_treinamento_REVERTER.sql']);
    expect('20261105120000' > '20261104120000').toBe(true);
  });

  it('as 2 etapas com uuid fixo (o mesmo do código), sem "order" fixo, depois de todas as outras', () => {
    for (const id of [ETAPA_PRODUTOS_DE_TREINAMENTO, ETAPA_PRODUTO_VENDIDO]) {
      expect(codigo).toContain(`'${id}', '${BOARD}'`);
      expect(codigo).toMatch(new RegExp(`where not exists \\(\\s*select 1 from public.board_stages where id = '${id}'`));
    }
    // A story fixava 13/14; com "Campanha Novembro" o quadro tem 14 etapas (0–13). Calculado:
    expect((codigo.match(/coalesce\(max\(bs\."order"\), -1\) \+ 1/g) ?? []).length).toBe(2);
    expect(codigo).not.toMatch(/,\s*1[345],\s*\n/);
    expect(codigo).toMatch(/raise exception '2\.64: ordem das etapas novas inesperada/);
    expect(codigo).toMatch(/precisa ficar depois de "Qualificado"/);
  });

  it('valores exatos por etapa: lifecycle NULL, pontua_lead false, fila true/false, arquiva false/true, is_default false', () => {
    const bloco = (nome: string) => codigo.slice(codigo.indexOf(`'${nome}', '${nome}'`), codigo.indexOf('where not exists', codigo.indexOf(`'${nome}', '${nome}'`)));
    const valores = (b: string) => b.slice(b.lastIndexOf('),') + 2).split('\n').map((l) => l.replace(/--.*$/, '').trim()).join('').split(',').map((v) => v.trim()).filter(Boolean);
    expect(valores(bloco('Produtos de treinamento'))).toEqual(['null', 'false', 'true', 'false', 'false']);
    expect(valores(bloco('Produto vendido'))).toEqual(['null', 'false', 'false', 'true', 'false']);
  });

  it('4 campos com rótulos da E3 (sem "consentimento" visível) e opções = tabela única do código', () => {
    const opcoes = (chave: string) => {
      const b = codigo.match(new RegExp(`'${chave}'[^]*?array\\[([^\\]]*)\\]`))?.[1] ?? '';
      return [...b.matchAll(/'([^']*)'/g)].map((m) => m[1]);
    };
    expect(opcoes('produtoDeTreinamento')).toEqual(Object.values(PRODUTOS_DA_LOJA).map((p) => p.nome));
    expect(opcoes('paraQuemEOProduto')).toEqual(Object.values(PERFIS_DA_LOJA));
    expect(codigo).toContain(`('produtoDeTreinamento', 'Produto de treinamento', 'select'`);
    expect(codigo).toContain(`('paraQuemEOProduto', 'Para quem é o produto?', 'select'`);
    expect(codigo).toContain(`('consentimentoEm', 'Aviso de privacidade (data e hora)', 'text', null`);
    expect(codigo).toContain(`('consentimentoVersao', 'Versão do aviso de privacidade', 'text', null`);
    expect(codigo).toMatch(/on conflict \(key, organization_id\) do nothing/);
    expect(codigo).not.toContain(`'paraQuemE',`); // o campo da reabilitação não é tocado
  });

  it('"LP Instituto" entra no fim de origemDoLead só se ainda não estiver lá', () => {
    expect(codigo).toMatch(/set options = array_append\(options, 'LP Instituto'\)[^;]*key = 'origemDoLead'[^;]*not \('LP Instituto' = any\(/);
  });

  it('reverter: aborta se houver card "LP Instituto"; apaga etapas só pelo uuid (a FK aborta se houver card)', () => {
    const r = semComentario(reverter);
    expect(r).toMatch(/custom_fields->>'origemDoLead' = 'LP Instituto'[^]*raise exception/);
    expect(r).toContain(`and id in ('${ETAPA_PRODUTOS_DE_TREINAMENTO}', '${ETAPA_PRODUTO_VENDIDO}')`);
    expect(r).toContain("array_remove(options, 'LP Instituto')");
    expect(r).not.toMatch(/cascade/i);
  });
});

// --------------------------------------------------------------------------
// AC2 — rota chamada só com a chave da lista
// --------------------------------------------------------------------------

describe('2.64 AC2 — chave própria, falha fechada', () => {
  it('variável vazia ⇒ 503 para TODA chamada (até com a chave da loja), nada gravado', async () => {
    vi.stubEnv('INSTITUTO_LEADS_API_KEY_IDS', '');
    const r = await enviar(pedido());
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('ROTA_DESLIGADA');
    expect(db.escritas).toHaveLength(0);
  });

  it('sem chave ⇒ 401', async () => {
    const r = await enviar(pedido(), { apiKey: null });
    expect(r.status).toBe(401);
  });

  it('chave válida da organização fora da lista (a `n8n` de hoje) ⇒ 403 CHAVE_NAO_AUTORIZADA, nada gravado', async () => {
    const r = await enviar(pedido(), { apiKey: CHAVE_N8N });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('CHAVE_NAO_AUTORIZADA');
    expect(db.escritas).toHaveLength(0);
  });

  it('chave da lista (com espaços na variável) ⇒ segue e grava', async () => {
    vi.stubEnv('INSTITUTO_LEADS_API_KEY_IDS', ` outra , ${CHAVE_DA_LOJA} `);
    const r = await enviar(pedido());
    expect(r.status).toBe(201);
  });
});

// --------------------------------------------------------------------------
// AC3 — contrato por listas fechadas
// --------------------------------------------------------------------------

describe('2.64 AC3 — contrato do pedido', () => {
  it.each(Object.entries(PRODUTOS_DA_LOJA))('produto %s ⇒ nome e preço gravados', async (slug, p) => {
    const r = await enviar(pedido({ produto: slug }), { chave: chaveDe(slug) });
    expect(r.status).toBe(201);
    const d = db.tabelas.deals.find((x) => x.id === r.body.deal_id)!;
    expect(d.custom_fields.produtoDeTreinamento).toBe(p.nome);
    expect(d.value).toBe(p.preco);
  });

  it('nomes e preços batem com a página (site/api/lead.js, 05/11)', () => {
    expect(Object.fromEntries(Object.entries(PRODUTOS_DA_LOJA).map(([k, v]) => [k, [v.nome, v.preco]]))).toEqual({
      'colete-suspensao-parcial': ['Colete para suspensão parcial de peso', 869.9],
      'luvas-inclusivas': ['Luvas inclusivas', 185.9],
      'bolsa-impermeavel': ['Bolsa impermeável', 95.9],
      'cinto-de-transferencia': ['Cinto de transferência', 185.9],
      'faixa-de-joelho': ['Faixa de joelho', 49.9],
      'kit-tornozeleira-tracao': ['Kit tornozeleira de tração horizontal', 199],
      'cinturao-de-musculacao': ['Cinturão de musculação', 139.9],
      'ats-pro': ['ATS Pró', 179.9],
    });
  });

  it.each(Object.entries(PERFIS_DA_LOJA))('perfil %s ⇒ "%s"', async (perfil, opcao) => {
    const r = await enviar(pedido({ perfil }), { chave: chaveDe(perfil) });
    expect(r.status).toBe(201);
    expect(db.tabelas.deals.find((x) => x.id === r.body.deal_id)!.custom_fields.paraQuemEOProduto).toBe(opcao);
  });

  it.each([
    ['para_quem (nome antigo) no lugar de perfil', (() => { const { perfil: _p, ...resto } = pedido(); return { ...resto, para_quem: 'para_mim' }; })(), 'CAMPO_A_MAIS'],
    ['slug curto antigo (luvas)', pedido({ produto: 'luvas' }), 'PRODUTO_DESCONHECIDO'],
    ['produto fora da lista', pedido({ produto: 'cadeira-de-rodas' }), 'PRODUTO_DESCONHECIDO'],
    ['perfil antigo (uso_proprio)', pedido({ perfil: 'uso_proprio' }), 'PERFIL_DESCONHECIDO'],
    ['versão desconhecida (v1)', pedido({ consentimento: { aceito: true, texto_versao: '2026-10-v1', aceito_em: '2026-11-05T14:05:00-03:00' } }), 'VERSAO_DO_AVISO_DESCONHECIDA'],
    ['aceito: false', pedido({ consentimento: { aceito: false, texto_versao: '2026-10-v3', aceito_em: '2026-11-05T14:05:00-03:00' } }), 'AVISO_NAO_ACEITO'],
    ['data do aviso sem fuso inválida', pedido({ consentimento: { aceito: true, texto_versao: '2026-10-v3', aceito_em: 'ontem' } }), 'AVISO_DATA_INVALIDA'],
    ['campo a mais', pedido({ valor: 1 }), 'CAMPO_A_MAIS'],
    ['pagina no formato antigo (/#loja)', pedido({ pagina: '/#loja' }), 'PAGINA_INVALIDA'],
    ['pagina http://', pedido({ pagina: 'http://instituto.acreditando.com.br/' }), 'PAGINA_INVALIDA'],
    ['pagina com mais de 300 caracteres', pedido({ pagina: `https://instituto.acreditando.com.br/?${'a'.repeat(300)}` }), 'PAGINA_INVALIDA'],
    ['telefone que não é BR', pedido({ whatsapp: '+14155550123' }), 'TELEFONE_INVALIDO'],
    ['telefone curto', pedido({ whatsapp: '12345' }), 'TELEFONE_INVALIDO'],
    ['sem e-mail', (() => { const { email: _e, ...r } = pedido(); return r; })(), 'EMAIL_INVALIDO'],
    ['e-mail sem ponto no domínio (a página também recusa)', pedido({ email: 'nome@gmail' }), 'EMAIL_INVALIDO'],
    ['e-mail com espaço (a página também recusa)', pedido({ email: 'nome sobrenome@gmail.com' }), 'EMAIL_INVALIDO'],
    ['nome com mais de 120 caracteres', pedido({ nome: 'J'.repeat(121) }), 'NOME_INVALIDO'],
  ])('%s ⇒ 422 com o código certo e nada gravado', async (_n, corpo, code) => {
    const r = await enviar(corpo);
    expect(r.status).toBe(422);
    expect(r.body.code).toBe(code);
    expect(db.escritas).toHaveLength(0);
    // O erro diz o caminho, nunca o valor recebido.
    expect(JSON.stringify(r.body)).not.toContain('joana.teste');
    expect(JSON.stringify(r.body)).not.toContain('998887777');
  });

  // QA M1 (05/11): os 5 e-mails que a página aceita e a rota recusava. A regra é a mesma da página
  // (`site/api/lead.js`, `validar`), comparada aqui contra a cópia literal dela.
  const REGRA_DA_PAGINA = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
  it.each([
    ['maria-josé@uol.com.br', 'maria-josé@uol.com.br'],
    ['nome@gmail.com.', 'nome@gmail.com'], // ponto no fim (teclado do celular) — normalizado
    ['a..b@gmail.com', 'a..b@gmail.com'],
    ['.nome@gmail.com', '.nome@gmail.com'],
    ['nome@domínio.com.br', 'nome@domínio.com.br'],
    ['  Nome@Gmail.COM ', 'nome@gmail.com'],
  ])('e-mail que a página aceita (%s) ⇒ 201 e grava %s no contato novo', async (email, gravado) => {
    expect(REGRA_DA_PAGINA.test(email.trim().toLowerCase())).toBe(true);
    const r = await enviar(pedido({ email }), { chave: chaveDe(email) });
    expect(r.status).toBe(201);
    expect(db.tabelas.contacts.find((c) => c.id === r.body.contact_id)!.email).toBe(gravado);
  });

  it('normalizarEmail recusa o que a página recusa', () => {
    for (const e of ['nome@gmail', 'semarroba.com', 'nome sobrenome@gmail.com', '@gmail.com', 'nome@.c']) {
      expect(REGRA_DA_PAGINA.test(e)).toBe(false);
      expect(normalizarEmail(e)).toBeNull();
    }
  });

  it('versões aceitas = v3 (a da página hoje) e v4 (proposta pelo parecer 39); v4 grava a versão no card', async () => {
    expect([...VERSOES_DO_AVISO_ACEITAS]).toEqual(['2026-10-v3', '2026-11-v4']);
    const r = await enviar(pedido({ consentimento: { aceito: true, texto_versao: '2026-11-v4', aceito_em: '2026-11-05T14:05:00-03:00' } }));
    expect(r.status).toBe(201);
    expect(db.tabelas.deals.find((x) => x.id === r.body.deal_id)!.custom_fields.consentimentoVersao).toBe('2026-11-v4');
  });

  it('E6: SEM pagina ⇒ aceito, e a nota relida diz "Página de origem: não informada"', async () => {
    const { pagina: _p, ...semPagina } = pedido();
    const r = await enviar(semPagina);
    expect(r.status).toBe(201);
    expect(r.body.acao).toBe('criou_contato_e_card');
    expect(notas()[0].description).toContain('Página de origem: não informada');
  });

  it('E6: pagina https completa ⇒ o MESMO texto relido na nota', async () => {
    const r = await enviar(pedido());
    expect(r.status).toBe(201);
    expect(notas()[0].description).toContain('Página de origem: https://instituto.acreditando.com.br/#loja');
  });
});

// --------------------------------------------------------------------------
// AC4 — contato
// --------------------------------------------------------------------------

describe('2.64 AC4 — contato: telefone com e sem o 9, depois e-mail; nada sobrescrito', () => {
  it('contato gravado SEM o 9 + pedido COM o 9 ⇒ mesmo contact_id; telefone, nome e origem iguais; RPC não chamada', async () => {
    const c = contato({ email: 'outro@exemplo.com' });
    const r = await enviar(pedido());
    expect(r.body.contact_id).toBe(c.id);
    const relido = db.tabelas.contacts.find((x) => x.id === c.id)!;
    expect(relido.phone).toBe(TEL_SEM_9_E164);
    expect(relido.source).toBe('whatsapp');
    expect(relido.name).toBe('Joana (WhatsApp)');
    expect(relido.email).toBe('outro@exemplo.com'); // preenchido: não muda
    expect(relido.notes).toBe('nota da atendente');
    expect(db.tabelas.contacts).toHaveLength(1);
    expect(db.rpcChamadas).toHaveLength(0);
  });

  it('contato achado com nome, e-mail e origem VAZIOS ⇒ preenche os três; telefone igual', async () => {
    const c = contato({ name: '', email: null, source: null });
    await enviar(pedido());
    const relido = db.tabelas.contacts.find((x) => x.id === c.id)!;
    expect(relido.name).toBe('Joana Teste da Silva');
    expect(relido.email).toBe('joana.teste@exemplo.com');
    expect(relido.source).toBe('lp_instituto');
    expect(relido.phone).toBe(TEL_SEM_9_E164);
  });

  it('contato novo ⇒ pela RPC find_or_create_contact_por_variantes, telefone COM o 9, p_source lp_instituto; nasce lp_instituto com e-mail', async () => {
    const r = await enviar(pedido());
    expect(r.body.acao).toBe('criou_contato_e_card');
    expect(db.rpcChamadas).toEqual([
      {
        fn: 'find_or_create_contact_por_variantes',
        args: { p_organization_id: ORG, p_phone: TEL_COM_9_E164, p_name: 'Joana Teste da Silva', p_source: 'lp_instituto' },
      },
    ]);
    const c = db.tabelas.contacts.find((x) => x.id === r.body.contact_id)!;
    expect(c.phone).toBe(TEL_COM_9_E164);
    expect(c.source).toBe('lp_instituto');
    expect(c.email).toBe('joana.teste@exemplo.com');
  });

  // M3 (decisão do Filipe, 05/11): o telefone manda.
  it('M3 caso 1: telefone acha um contato e o e-mail acha OUTRO ⇒ fica o do telefone; o do e-mail não é tocado', async () => {
    const doEmail = contato({ phone: '+5511911112222', email: 'joana.teste@exemplo.com', created_at: '2026-01-01T00:00:00Z' });
    const doTelefone = contato({ email: null, created_at: '2026-09-01T00:00:00Z' });
    const antes = copia(doEmail);
    const r = await enviar(pedido());
    expect(r.body.contact_id).toBe(doTelefone.id);
    expect(db.rpcChamadas).toHaveLength(0);
    expect(copia(db.tabelas.contacts.find((x) => x.id === doEmail.id))).toEqual(antes);
    expect(notas()[0].description).not.toContain('Atenção');
  });

  it('M3 caso 2: achado pelo E-MAIL e SEM telefone ⇒ reaproveita e grava o telefone digitado (com o 9); nada preenchido é trocado', async () => {
    const c = contato({ phone: null, email: 'joana.teste@exemplo.com', name: 'Joana (cadastro antigo)', source: 'site' });
    const r = await enviar(pedido());
    expect(r.status).toBe(201);
    expect(r.body.contact_id).toBe(c.id);
    expect(db.rpcChamadas).toHaveLength(0);
    const relido = db.tabelas.contacts.find((x) => x.id === c.id)!;
    expect(relido.phone).toBe(TEL_COM_9_E164);
    expect(relido.name).toBe('Joana (cadastro antigo)');
    expect(relido.source).toBe('site');
    expect(db.tabelas.contacts).toHaveLength(1);
    expect(notas()[0].description).not.toContain('Atenção');
  });

  it('M3 caso 2b: achado pelo E-MAIL com o MESMO telefone noutra forma (sem "+") ⇒ reaproveita; telefone não muda', async () => {
    const c = contato({ phone: '5541998887777', email: 'joana.teste@exemplo.com' });
    const r = await enviar(pedido());
    expect(r.body.contact_id).toBe(c.id);
    expect(db.rpcChamadas).toHaveLength(0);
    expect(db.tabelas.contacts.find((x) => x.id === c.id)!.phone).toBe('5541998887777');
  });

  it('M3 caso 3: achado pelo E-MAIL com OUTRO telefone ⇒ cria contato pelo telefone digitado (RPC) e a nota avisa, sem o telefone do outro', async () => {
    const outro = contato({ phone: '+5511911112222', email: 'joana.teste@exemplo.com', name: 'Outra pessoa' });
    const antes = copia(outro);
    const r = await enviar(pedido());
    expect(r.status).toBe(201);
    expect(r.body.acao).toBe('criou_contato_e_card');
    expect(r.body.contact_id).not.toBe(outro.id);
    expect(db.rpcChamadas.map((c) => [c.fn, c.args.p_phone])).toEqual([['find_or_create_contact_por_variantes', TEL_COM_9_E164]]);
    const novo = db.tabelas.contacts.find((x) => x.id === r.body.contact_id)!;
    expect(novo.phone).toBe(TEL_COM_9_E164);
    expect(novo.source).toBe('lp_instituto');
    expect(copia(db.tabelas.contacts.find((x) => x.id === outro.id))).toEqual(antes); // o outro não é tocado
    expect(cardsDoContato(outro.id)).toHaveLength(0);
    const nota = notas()[0].description;
    expect(nota).toContain('Atenção: o e-mail informado também está em outro contato do CRM');
    for (const s of ['911112222', '11112222', 'Outra pessoa']) expect(nota).not.toContain(s);
  });

  it('M3 caso 3 em ensaio ⇒ ação prevista criou_contato_e_card, nada gravado', async () => {
    contato({ phone: '+5511911112222', email: 'joana.teste@exemplo.com' });
    const r = await enviar(pedido(), { ensaio: true });
    expect(r.body).toMatchObject({ acao: 'criou_contato_e_card', ensaio: true });
    expect(db.escritas).toHaveLength(0);
    expect(db.rpcChamadas).toHaveLength(0);
  });

  it('dois contatos com o telefone ⇒ o MAIS ANTIGO; mesclado e excluído não contam; nunca erro', async () => {
    contato({ merged_into_id: 'x', created_at: '2026-01-01T00:00:00Z' });
    contato({ deleted_at: '2026-02-01T00:00:00Z', created_at: '2026-01-02T00:00:00Z' });
    const antigo = contato({ phone: TEL_COM_9_E164, created_at: '2026-03-01T00:00:00Z' });
    contato({ created_at: '2026-04-01T00:00:00Z' });
    const r = await enviar(pedido());
    expect(r.status).toBe(201);
    expect(r.body.contact_id).toBe(antigo.id);
  });

  it('se a RPC devolver um contato MESCLADO, o card nasce no contato VIVO', async () => {
    const vivo = contato({ phone: '+5511933334444', name: 'Destino', created_at: '2026-01-01T00:00:00Z' });
    const mesclado = contato({ phone: '+5511955556666', merged_into_id: vivo.id, deleted_at: '2026-09-01T00:00:00Z' });
    vi.spyOn(db, 'rpc').mockImplementation(async () => ({ data: [{ contact_id: mesclado.id, casou_por: 'exato', telefone_casado: 'x' }], error: null }) as any);
    const r = await enviar(pedido());
    expect(r.status).toBe(201);
    expect(r.body.contact_id).toBe(vivo.id);
    expect(cardsDoContato(mesclado.id)).toHaveLength(0);
  });
});

// --------------------------------------------------------------------------
// AC5 — qual card
// --------------------------------------------------------------------------

describe('2.64 AC5 — card: reaproveitar, 2º card, card novo', () => {
  it('contato novo ⇒ criou_contato_e_card: 1 contato, 1 card em "Produtos de treinamento"', async () => {
    const r = await enviar(pedido());
    expect(r.status).toBe(201);
    expect(r.body.acao).toBe('criou_contato_e_card');
    expect(cardsDoContato(r.body.contact_id)).toHaveLength(1);
    expect(db.tabelas.deals[0].stage_id).toBe(ETAPA_PRODUTOS_DE_TREINAMENTO);
  });

  it('tem card em "Produtos de treinamento" (e um de reabilitação) ⇒ reaproveita o MAIS ANTIGO de produto; nunca cria 3º; não muda etapa/valor/título/dono', async () => {
    const c = contato();
    const reab = card(c.id);
    const prodAntigo = card(c.id, { stage_id: ETAPA_PRODUTOS_DE_TREINAMENTO, title: 'Joana — Bolsa (LP Instituto)', value: 95.9, owner_id: FERNANDA, custom_fields: { produtoDeTreinamento: 'Bolsa impermeável' }, created_at: '2026-10-02T00:00:00Z' });
    const antes = copia(prodAntigo);
    const reabAntes = copia(reab);
    const r = await enviar(pedido());
    expect(r.status).toBe(200);
    expect(r.body.acao).toBe('reaproveitou_card');
    expect(r.body.deal_id).toBe(prodAntigo.id);
    expect(cardsDoContato(c.id)).toHaveLength(2);
    const relido = db.tabelas.deals.find((x) => x.id === prodAntigo.id)!;
    expect(relido.stage_id).toBe(antes.stage_id);
    expect(relido.value).toBe(95.9); // P2: não soma
    expect(relido.title).toBe(antes.title);
    expect(relido.owner_id).toBe(FERNANDA);
    expect(relido.custom_fields.produtoDeTreinamento).toBe('Bolsa impermeável'); // preenchido: fica
    expect(copia(db.tabelas.deals.find((x) => x.id === reab.id))).toEqual(reabAntes);
    expect(notas()[0].description).toMatch(/^Pediu também: Luvas inclusivas \(R\$ 185,90\)/);
  });

  it('QA B2: DOIS cards em "Produtos de treinamento" ⇒ reaproveita o MAIS ANTIGO (mesmo vindo depois na lista); o mais novo fica igual', async () => {
    const c = contato();
    const novo = card(c.id, { stage_id: ETAPA_PRODUTOS_DE_TREINAMENTO, custom_fields: { produtoDeTreinamento: 'ATS Pró' }, created_at: '2026-10-20T00:00:00Z' });
    const antigo = card(c.id, { stage_id: ETAPA_PRODUTOS_DE_TREINAMENTO, custom_fields: { produtoDeTreinamento: 'Bolsa impermeável' }, created_at: '2026-10-02T00:00:00Z' });
    const novoAntes = copia(novo);
    const r = await enviar(pedido());
    expect(r.body.acao).toBe('reaproveitou_card');
    expect(r.body.deal_id).toBe(antigo.id);
    expect(notas()[0].deal_id).toBe(antigo.id);
    expect(copia(db.tabelas.deals.find((x) => x.id === novo.id))).toEqual(novoAntes);
    expect(cardsDoContato(c.id)).toHaveLength(2);
  });

  it('card de produto com produto VAZIO ⇒ reaproveita e preenche só produtoDeTreinamento', async () => {
    const c = contato();
    const d = card(c.id, { stage_id: ETAPA_PRODUTOS_DE_TREINAMENTO, custom_fields: {} });
    const r = await enviar(pedido());
    expect(r.body.acao).toBe('reaproveitou_card');
    expect(db.tabelas.deals.find((x) => x.id === d.id)!.custom_fields).toEqual({ produtoDeTreinamento: 'Luvas inclusivas' });
  });

  it.each([
    ['Qualificado (reabilitação)', QUALIFICADO],
    ['Lead novo', LEAD_NOVO],
    ['Campanha Novembro (etapa criada em 05/11)', CAMPANHA_NOVEMBRO],
    ['Profissional', PROFISSIONAL],
  ])('card aberto em %s ⇒ segundo_card; o outro card fica IGUAL (etapa, campos, valor, dono)', async (_n, etapa) => {
    const c = contato();
    const outro = card(c.id, { stage_id: etapa, value: 1500 });
    const antes = copia(outro);
    const r = await enviar(pedido());
    expect(r.status).toBe(201);
    expect(r.body.acao).toBe('segundo_card');
    expect(r.body.deal_id).not.toBe(outro.id);
    expect(cardsDoContato(c.id)).toHaveLength(2);
    expect(db.tabelas.deals.find((x) => x.id === r.body.deal_id)!.stage_id).toBe(ETAPA_PRODUTOS_DE_TREINAMENTO);
    expect(copia(db.tabelas.deals.find((x) => x.id === outro.id))).toEqual(antes);
  });

  it.each([
    ['Ganho', GANHO],
    ['Perdido', PERDIDO],
    ['Clientes', CLIENTES],
    ['Produto vendido (E8)', ETAPA_PRODUTO_VENDIDO],
  ])('só card em %s ⇒ criou_card (+1) e o card fechado fica igual', async (_n, etapa) => {
    const c = contato();
    const fechado = card(c.id, { stage_id: etapa, value: 185.9, custom_fields: { produtoDeTreinamento: 'Luvas inclusivas' } });
    const antes = copia(fechado);
    const r = await enviar(pedido());
    expect(r.status).toBe(201);
    expect(r.body.acao).toBe('criou_card');
    expect(cardsDoContato(c.id)).toHaveLength(2);
    expect(copia(db.tabelas.deals.find((x) => x.id === fechado.id))).toEqual(antes);
  });

  it('card de outro quadro ou excluído não conta (⇒ criou_card)', async () => {
    const c = contato();
    card(c.id, { board_id: '00000000-0000-4000-8000-000000000001' });
    card(c.id, { stage_id: ETAPA_PRODUTOS_DE_TREINAMENTO, deleted_at: '2026-10-10T00:00:00Z' });
    const r = await enviar(pedido());
    expect(r.body.acao).toBe('criou_card');
  });

  it('E8: a lista da guarda do WhatsApp NÃO mudou — os mesmos 3 uuids (Ganho, Perdido, Clientes)', () => {
    expect([...ESTAGIOS_TERMINAIS_ACREDITANDO]).toEqual([GANHO, PERDIDO, CLIENTES]);
    expect(ESTAGIOS_TERMINAIS_ACREDITANDO).not.toContain(ETAPA_PRODUTO_VENDIDO);
  });

  it('decisão pura: "Produto vendido" é FECHADO na rota', () => {
    expect(decidirCard([{ id: 'a', stage_id: ETAPA_PRODUTO_VENDIDO, created_at: '2026-01-01' }])).toEqual({ tipo: 'criar' });
  });

  it('23505 do trigger (corrida: outro card de produto nasce antes do upsert) NÃO vira "já processado" pelo código: relê e reaproveita', async () => {
    const c = contato();
    db.antesDaProxima('deals', 'upsert', () => {
      card(c.id, { id: 'card-da-corrida', stage_id: ETAPA_PRODUTOS_DE_TREINAMENTO, custom_fields: {} } as any);
    });
    const r = await enviar(pedido());
    expect(r.status).toBe(200);
    expect(r.body.acao).toBe('reaproveitou_card');
    expect(r.body.deal_id).toBe('card-da-corrida');
    expect(cardsDoContato(c.id)).toHaveLength(1);
  });
});

// --------------------------------------------------------------------------
// AC6 — o que fica no card criado
// --------------------------------------------------------------------------

describe('2.64 AC6 — o card criado', () => {
  it('etapa, quadro, dona (Fernanda), valor numérico, título e os 5 campos com o texto exato', async () => {
    const r = await enviar(pedido({ produto: 'colete-suspensao-parcial', perfil: 'uso_profissional' }));
    const d = db.tabelas.deals.find((x) => x.id === r.body.deal_id)!;
    expect(d.stage_id).toBe(ETAPA_PRODUTOS_DE_TREINAMENTO);
    expect(d.board_id).toBe(BOARD);
    expect(d.owner_id).toBe(FERNANDA);
    expect(d.value).toBe(869.9);
    expect(typeof d.value).toBe('number');
    expect(d.title).toBe('Joana — Colete para suspensão parcial de peso (LP Instituto)');
    expect(d.custom_fields).toEqual({
      produtoDeTreinamento: 'Colete para suspensão parcial de peso',
      paraQuemEOProduto: 'Para uso profissional',
      consentimentoEm: '2026-11-05T14:05:00-03:00',
      consentimentoVersao: '2026-10-v3',
      origemDoLead: 'LP Instituto',
    });
    expect(d.is_won).toBe(false);
    expect(d.is_lost).toBe(false);
  });

  it('nenhuma escrita em deals menciona as colunas de estrelas', async () => {
    const c = contato();
    card(c.id, { stage_id: ETAPA_PRODUTOS_DE_TREINAMENTO, custom_fields: {} });
    await enviar(pedido(), { chave: chaveDe('a') });
    await enviar(pedido({ produto: 'ats-pro' }), { chave: chaveDe('b') });
    const c2 = contato({ phone: '+5511977776666', email: 'x@exemplo.com' });
    card(c2.id);
    await enviar(pedido({ whatsapp: '5511977776666', email: 'x@exemplo.com' }), { chave: chaveDe('c') });
    expect(db.escritas.filter((e) => e.tabela === 'deals').length).toBeGreaterThan(0);
    for (const w of db.escritas.filter((e) => e.tabela === 'deals')) {
      for (const k of COLUNAS_DE_NOTA) expect(JSON.stringify(w.payload)).not.toContain(`"${k}"`);
    }
  });
});

// --------------------------------------------------------------------------
// AC7 — nota no histórico
// --------------------------------------------------------------------------

describe('2.64 AC7 — nota "Pedido da loja do Instituto"', () => {
  it('1 nota por pedido, com produto, preço, para quem, aviso de privacidade, página e data; sem telefone, e-mail nem "consentimento"', async () => {
    const r = await enviar(pedido());
    expect(notas()).toHaveLength(1);
    const n = notas()[0];
    expect(n.id).toBe(idDaNota(ORG, CHAVE_PADRAO));
    expect(n.deal_id).toBe(r.body.deal_id);
    expect(n.contact_id).toBe(r.body.contact_id);
    expect(n.description).toBe(
      [
        'Produto: Luvas inclusivas (R$ 185,90)',
        'Para quem é o produto? Para um familiar ou pessoa de quem cuido',
        'Aviso de privacidade: versão 2026-10-v3, registrado em 05/11/2026, 14:05',
        'Página de origem: https://instituto.acreditando.com.br/#loja',
        'Pedido recebido em 05/11/2026, 14:10 pela loja do site do Instituto.',
      ].join('\n')
    );
    expect(n.description).toContain('Aviso de privacidade');
    expect(n.description).toContain('2026-10-v3');
    expect(`${n.title}\n${n.description}`.toLowerCase()).not.toContain('consentimento');
    for (const s of ['998887777', '98887777', 'joana.teste', '@exemplo.com', 'Joana']) expect(n.description).not.toContain(s);
  });

  it('reenvio do MESMO pedido ⇒ continua 1 nota; outro produto no mesmo card ⇒ 2 notas', async () => {
    const r1 = await enviar(pedido());
    await enviar(pedido()); // replay
    expect(notas()).toHaveLength(1);
    const r3 = await enviar(pedido({ produto: 'ats-pro' }), { chave: chaveDe('pedido-2') });
    expect(r3.body.acao).toBe('reaproveitou_card');
    expect(r3.body.deal_id).toBe(r1.body.deal_id);
    expect(notas()).toHaveLength(2);
    expect(notas().filter((n) => n.deal_id === r1.body.deal_id)).toHaveLength(2);
  });

  it('chave liberada (5xx) e reenvio ⇒ a nota de id fixo não duplica', async () => {
    db.falharProxima('deals', 'select', { code: 'XX000', message: 'falha' });
    const contatoAntes = contato();
    card(contatoAntes.id, { stage_id: ETAPA_PRODUTOS_DE_TREINAMENTO, custom_fields: {} });
    // 1ª: falha na 1ª leitura de deals depois de achar o contato
    const r1 = await enviar(pedido());
    expect(r1.status).toBe(500);
    const r2 = await enviar(pedido());
    const r3 = await enviar(pedido());
    expect(r2.body.acao).toBe('reaproveitou_card');
    expect(r3.body.idempotent_replay).toBe(true);
    expect(notas()).toHaveLength(1);
  });
});

// --------------------------------------------------------------------------
// AC8 — idempotência
// --------------------------------------------------------------------------

describe('2.64 AC8 — idempotência', () => {
  it('mesmo pedido 3× (2 em paralelo = clique duplo) ⇒ 1 card, 1 nota; os 3 com SUCESSO e o MESMO deal_id (QA M2: o 2º espera o 1º)', async () => {
    const [a, b] = await Promise.all([enviar(pedido()), enviar(pedido())]);
    const c = await enviar(pedido());
    expect(db.tabelas.deals).toHaveLength(1);
    expect(notas()).toHaveLength(1);
    for (const r of [a, b, c]) {
      expect(r.status).toBe(201);
      expect(r.body.code).toBeUndefined();
      expect(r.body.deal_id).toBe(db.tabelas.deals[0].id);
      expect(r.body.acao).toBe('criou_contato_e_card');
    }
    expect([a, b].filter((r) => r.body.idempotent_replay === true)).toHaveLength(1);
    expect(c.body.idempotent_replay).toBe(true);
  });

  it('QA M2: reenvio do MESMO pedido com outra hora do aviso, outra página, outro perfil e e-mail ⇒ sucesso com o card já criado (nunca 409)', async () => {
    const r1 = await enviar(pedido());
    const r2 = await enviar(
      pedido({
        consentimento: { aceito: true, texto_versao: '2026-10-v3', aceito_em: '2026-11-05T14:07:31-03:00' },
        pagina: 'https://instituto.acreditando.com.br/?utm_source=x#loja',
        perfil: 'para_mim',
        email: 'Joana.Teste@Exemplo.com',
      })
    );
    expect(r2.status).toBe(201);
    expect(r2.body.code).toBeUndefined();
    expect(r2.body.idempotent_replay).toBe(true);
    expect(r2.body.deal_id).toBe(r1.body.deal_id);
    expect(db.tabelas.deals).toHaveLength(1);
    expect(notas()).toHaveLength(1);
  });

  it('a impressão do pedido é só telefone + produto (sem a data/hora do aviso)', () => {
    expect(impressaoDoPedido(pedido() as any, '+5541998887777')).toEqual({ telefone: '+5541998887777', produto: 'luvas-inclusivas' });
  });

  it('o 1º pedido falha (500, chave liberada) enquanto o 2º espera ⇒ o 2º processa e cria o card', async () => {
    db.falharProxima('contacts', 'select', { code: 'XX000', message: 'falha' });
    const [a, b] = await Promise.all([enviar(pedido()), enviar(pedido())]);
    expect([a.status, b.status].sort()).toEqual([201, 500]);
    expect(db.tabelas.deals).toHaveLength(1);
    expect(notas()).toHaveLength(1);
  });

  it('mesma chave com OUTRO produto (chave montada errado) ⇒ 409 IDEMPOTENCY_CONFLICT', async () => {
    await enviar(pedido());
    const r = await enviar(pedido({ produto: 'ats-pro' }));
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it.each([
    ['sem Idempotency-Key', null],
    ['formato errado (só hex)', createHash('sha256').update('x').digest('hex')],
    ['prefixo certo, hex curto', 'instituto:abc'],
    ['hex maiúsculo', `instituto:${'A'.repeat(64)}`],
  ])('%s ⇒ 422 e nada gravado', async (_n, chave) => {
    const r = await enviar(pedido(), { chave });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('IDEMPOTENCY_KEY_INVALIDA');
    expect(db.escritas).toHaveLength(0);
  });
});

// --------------------------------------------------------------------------
// AC9 — releitura e respostas
// --------------------------------------------------------------------------

describe('2.64 AC9 — read-back antes do "ok"', () => {
  it('resposta de sucesso só com { acao, deal_id, contact_id, request_id } — sem dado pessoal', async () => {
    const r = await enviar(pedido());
    expect(Object.keys(r.body).sort()).toEqual(['acao', 'contact_id', 'deal_id', 'request_id']);
    for (const s of ['Joana', 'joana.teste', '998887777', 'familiar']) expect(JSON.stringify(r.body)).not.toContain(s);
  });

  it('o card relido não bate (valor mudou entre gravar e reler) ⇒ 500 READBACK_DIVERGENTE e a chave é LIBERADA', async () => {
    db.antesDaProxima('activities', 'upsert', () => {
      const d = db.tabelas.deals.find((x) => x.stage_id === ETAPA_PRODUTOS_DE_TREINAMENTO)!;
      d.value = 0;
    });
    const r = await enviar(pedido());
    expect(r.status).toBe(500);
    expect(r.body.code).toBe('READBACK_DIVERGENTE');
    expect(db.tabelas.public_api_idempotency).toHaveLength(0);
  });

  it('QA B2: card REAPROVEITADO relido sem o produto (alguém limpou entre gravar e reler) ⇒ 500 READBACK_DIVERGENTE e chave liberada', async () => {
    const c = contato();
    const d = card(c.id, { stage_id: ETAPA_PRODUTOS_DE_TREINAMENTO, custom_fields: { produtoDeTreinamento: 'Bolsa impermeável' } });
    db.antesDaProxima('activities', 'upsert', () => {
      db.tabelas.deals.find((x) => x.id === d.id)!.custom_fields = { produtoDeTreinamento: '' };
    });
    const r = await enviar(pedido());
    expect(r.status).toBe(500);
    expect(r.body.code).toBe('READBACK_DIVERGENTE');
    expect(db.tabelas.public_api_idempotency).toHaveLength(0);
  });

  it('QA B2: card REAPROVEITADO excluído entre gravar e reler ⇒ 500 READBACK_DIVERGENTE', async () => {
    const c = contato();
    const d = card(c.id, { stage_id: ETAPA_PRODUTOS_DE_TREINAMENTO, custom_fields: { produtoDeTreinamento: 'Bolsa impermeável' } });
    db.antesDaProxima('activities', 'upsert', () => {
      db.tabelas.deals.find((x) => x.id === d.id)!.deleted_at = '2026-11-05T17:10:00Z';
    });
    const r = await enviar(pedido());
    expect(r.status).toBe(500);
    expect(r.body.code).toBe('READBACK_DIVERGENTE');
  });

  it('a nota não aparece na releitura ⇒ 500 READBACK_DIVERGENTE', async () => {
    const original = db.aplicarEscrita.bind(db);
    vi.spyOn(db, 'aplicarEscrita').mockImplementation((q: any) => {
      if (q.tabela === 'activities') return { data: [], error: null }; // "gravou" sem gravar
      return original(q);
    });
    const r = await enviar(pedido());
    expect(r.status).toBe(500);
    expect(r.body.code).toBe('READBACK_DIVERGENTE');
  });

  it('migration não aplicada (etapa ausente) ⇒ 503 ETAPA_AUSENTE, nada gravado, chave liberada', async () => {
    db.tabelas.board_stages = [];
    const r = await enviar(pedido());
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('ETAPA_AUSENTE');
    expect(db.escritas.filter((e) => e.tabela !== 'public_api_idempotency')).toHaveLength(0);
    expect(db.tabelas.public_api_idempotency).toHaveLength(0);
  });
});

// --------------------------------------------------------------------------
// AC10 — logs sem dado pessoal
// --------------------------------------------------------------------------

describe('2.64 AC10 — log com lista branca', () => {
  it('erro de banco com nome/telefone/e-mail na mensagem: o log não carrega nenhum deles', async () => {
    const erros: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void erros.push(a.map(String).join(' ')));
    db.falharProxima('contacts', 'select', {
      code: 'XX000',
      message: 'Failing row contains (+5541998887777, joana.teste@exemplo.com, Joana Teste da Silva)',
      details: 'Key (phone)=(+5541998887777)',
    });
    const r = await enviar(pedido());
    expect(r.status).toBe(500);
    const log = erros.join('\n');
    expect(log).toContain('instituto_pedido_erro');
    for (const s of ['998887777', '98887777', 'joana.teste', 'Joana', 'familiar']) {
      expect(log).not.toContain(s);
      expect(JSON.stringify(r.body)).not.toContain(s);
    }
  });
});

// --------------------------------------------------------------------------
// AC11 — ensaio
// --------------------------------------------------------------------------

describe('2.64 AC11 — ?ensaio=1 decide sem gravar', () => {
  it.each([
    ['contato novo', () => undefined, 'criou_contato_e_card'],
    ['card de produto', () => { const c = contato(); card(c.id, { stage_id: ETAPA_PRODUTOS_DE_TREINAMENTO }); }, 'reaproveitou_card'],
    ['card de reabilitação', () => { const c = contato(); card(c.id); }, 'segundo_card'],
    ['só Produto vendido', () => { const c = contato(); card(c.id, { stage_id: ETAPA_PRODUTO_VENDIDO }); }, 'criou_card'],
  ])('%s ⇒ ação prevista, 0 escritas, 0 RPC, idempotência intocada', async (_n, montar, acao) => {
    montar();
    const r = await enviar(pedido(), { ensaio: true });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ acao, ensaio: true });
    expect(db.escritas).toHaveLength(0);
    expect(db.rpcChamadas).toHaveLength(0);
    expect(db.tabelas.public_api_idempotency).toHaveLength(0);
  });
});

// --------------------------------------------------------------------------
// AC12 — Visão Geral (texto da migration; prova SQL real no Dev Agent Record)
// --------------------------------------------------------------------------

describe('2.64 AC12 — get_metricas_de_atendimento sem cards de produto', () => {
  const sql = fs.readFileSync(path.resolve(__dirname, '../../supabase/migrations/20261105120000_produtos_de_treinamento.sql'), 'utf8');
  const corpo = sql.slice(sql.indexOf('as $func$'), sql.lastIndexOf('$func$'));
  // QA B1: "produto" = valor NÃO VAZIO (não a mera existência da chave) OU etapa da loja.
  const FILTRO = String.raw`and not \(\s*nullif\(btrim\(d\.custom_fields->>'produtoDeTreinamento'\), ''\) is not null\s*or coalesce\(d\.stage_id = any\(v_etapas_da_loja\), false\)\s*\)`;
  const filtroProduto = new RegExp(FILTRO);
  const filtroProdutoTodos = new RegExp(FILTRO, 'g');

  it('mesma assinatura e SECURITY DEFINER; as 2 etapas por uuid', () => {
    expect(sql).toMatch(/create or replace function public\.get_metricas_de_atendimento\(\s*p_org_id uuid,\s*p_start_date timestamptz,\s*p_end_date timestamptz default now\(\)\s*\)/);
    expect(sql).toMatch(/security definer/);
    expect(corpo).toContain(`'${ETAPA_PRODUTOS_DE_TREINAMENTO}'`);
    expect(corpo).toContain(`'${ETAPA_PRODUTO_VENDIDO}'`);
  });

  it('Total de Leads e Ganhos/Perdidos ignoram card de produto (campo OU etapa)', () => {
    expect(corpo.match(filtroProdutoTodos) ?? []).toHaveLength(2);
    const total = corpo.slice(corpo.indexOf('into v_total_leads'), corpo.indexOf('into v_msgs_ia'));
    expect(total).toMatch(filtroProduto);
    const fech = corpo.slice(corpo.indexOf('into v_ganhos, v_perdidos'), corpo.indexOf('v_cobertura_desde from'));
    expect(fech).toMatch(filtroProduto);
  });

  it('funil sem as barras da loja e sem card de produto nas outras barras', () => {
    const funil = corpo.slice(corpo.indexOf('into v_funil'), corpo.indexOf('into v_ganhos'));
    expect(funil).toMatch(/where bs\.id <> all\(v_etapas_da_loja\)/);
    expect(funil).toMatch(/and not \(nullif\(btrim\(d\.custom_fields->>'produtoDeTreinamento'\), ''\) is not null\)/);
  });

  it('QA B1: "Produto de treinamento" VAZIO não tira o card dos números — nenhuma conta usa só a existência da chave', () => {
    expect(corpo).not.toContain("custom_fields ? 'produtoDeTreinamento'");
    expect(corpo.match(/nullif\(btrim\(d\.custom_fields->>'produtoDeTreinamento'\), ''\) is not null/g) ?? []).toHaveLength(3);
  });

  it('o resto do corpo é o da 2.46 (só as linhas marcadas "2.64" mudaram)', () => {
    const base = fs.readFileSync(path.resolve(__dirname, '../../supabase/migrations/20260819190000_painel_visao_geral_2_46.sql'), 'utf8');
    const corpo246 = base.slice(base.indexOf('as $func$'), base.lastIndexOf('$func$'));
    const linhas = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean);
    const novas = new Set(linhas(corpo));
    const faltando = linhas(corpo246).filter((l) => !novas.has(l));
    // Única linha da 2.46 que mudou de forma: o fim do WHERE do Total/Ganhos (ganhou o "and not (...)").
    expect(faltando).toEqual(['and d.created_at <  p_end_date;', 'and d.closed_at <  p_end_date;']);
  });

  it('REVOKE/GRANT da 2.69 depois do CREATE, no mesmo arquivo', () => {
    const iCreate = sql.indexOf('create or replace function public.get_metricas_de_atendimento');
    const iRevoke = sql.indexOf('REVOKE ALL ON FUNCTION public.get_metricas_de_atendimento(uuid, timestamp with time zone, timestamp with time zone) FROM PUBLIC, anon;');
    const iGrant = sql.indexOf('GRANT EXECUTE ON FUNCTION public.get_metricas_de_atendimento(uuid, timestamp with time zone, timestamp with time zone) TO authenticated;');
    expect(iCreate).toBeGreaterThan(0);
    expect(iRevoke).toBeGreaterThan(iCreate);
    expect(iGrant).toBeGreaterThan(iRevoke);
  });
});
