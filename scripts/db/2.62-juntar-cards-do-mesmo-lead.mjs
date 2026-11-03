#!/usr/bin/env node
// Story 2.62 — "O lead que estava duas vezes no funil".
// Junta os cards do mesmo lead no card da etapa mais avançada (AC0–AC5, AC7, AC8).
//
//   node scripts/db/2.62-juntar-cards-do-mesmo-lead.mjs                         -> DRY-RUN (padrão): mede e mostra o plano
//   node scripts/db/2.62-juntar-cards-do-mesmo-lead.mjs --ensaio                -> roda cada par num bloco que o Postgres ABORTA
//   node scripts/db/2.62-juntar-cards-do-mesmo-lead.mjs --execute               -> AC1–AC4 (backup, mescla, filhas, nota)
//   node scripts/db/2.62-juntar-cards-do-mesmo-lead.mjs --execute --excluir-perdedores   -> + AC5 (soft delete)
//   node scripts/db/2.62-juntar-cards-do-mesmo-lead.mjs --reverter <backup.json>          -> DRY-RUN da reversão (AC7)
//   node scripts/db/2.62-juntar-cards-do-mesmo-lead.mjs --reverter <backup.json> --execute -> reverte
//
// Regras (story 2.62, "Decisões do Filipe — 09/10/2026"):
//  - AC0 re-mede e compara com a lista gravada abaixo (ESPERADO, 03/11; cards em IGNORAR não contam). Qualquer diferença => para, sem escrever.
//  - Uma transação por par = UM bloco `do $$ ... $$` por requisição. Bloco plpgsql é atômico no próprio banco;
//    não depende de a camada HTTP honrar BEGIN/COMMIT (lição do scripts/db/README.md).
//  - Toda escrita tem read-back: re-mede e compara com o pretendido. Sem read-back não é "feito".
//  - Nunca imprime o token nem dado pessoal completo (telefone/e-mail/nome mascarados no console).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REF = 'jmjhtprnxjffaqhdzfmc';
export const BOARD_PREFIXO = '5f6bded2'; // board Acreditando
export const LEAD_NOVO_PREFIXO = '82d1a222'; // etapa "Lead novo"
export const EMAIL_DO_FILIPE = 'fbraintech@gmail.com'; // P4: merged_by = profiles.id dele (descoberto por SELECT)
export const ORDEM_MAXIMA_DE_AVANCO = 7; // depois de 7, "order" não é avanço (Ganho/Perdido/...)
export const TITULO_NOTA_A = 'Card da LP juntado a este';
export const TITULO_NOTA_B = 'Card duplicado juntado a este';
export const DIR_BACKUP_PADRAO = 'C:/Users/filip_mg5w2c4/grupo-acreditando/.dados-leads';

// Data da lista abaixo (aparece nas mensagens do AC0).
export const DATA_DA_LISTA = '03/11';

// Lista de 03/11/2026 (story 2.62, "Decisões do Filipe — 03/11/2026", D1–D3; medição e verificação de
// identidade da @data-engineer). Substitui a lista de 07/10. Só os 8 primeiros caracteres dos ids:
// cada prefixo tem de casar com EXATAMENTE 1 linha.
// Tipo B: uma linha por card que SAI. Contato com 3 cards (d710be17) = 2 linhas com o mesmo sobrevivente;
// a regra S1 é aplicada a TODOS os cards abertos do contato de uma vez.
export const ESPERADO = Object.freeze({
  tipoA: [
    { perdedor: '4ef235a4', contatoLp: 'b9b6179e', sobrevivente: '08750bc3', contatoWa: '23e7ce9b', ordemPerdedor: 0, ordemSobrevivente: 0 },
    { perdedor: '886ae9cd', contatoLp: '21438ce0', sobrevivente: '9c7f9e20', contatoWa: 'ec38877e', ordemPerdedor: 1, ordemSobrevivente: 2 },
    { perdedor: '0560b87e', contatoLp: '492dd9d3', sobrevivente: 'd0034c1c', contatoWa: '8b861862', ordemPerdedor: 0, ordemSobrevivente: 2 },
    { perdedor: 'bff4a088', contatoLp: 'd2fe63fe', sobrevivente: 'f44c758a', contatoWa: 'dcd7af74', ordemPerdedor: 0, ordemSobrevivente: 1 },
    { perdedor: 'f1545ba6', contatoLp: '544e32b2', sobrevivente: '1c01d6a5', contatoWa: '1b92c408', ordemPerdedor: 4, ordemSobrevivente: 4 },
    { perdedor: '997a8343', contatoLp: '15d051f4', sobrevivente: 'cf26cd4f', contatoWa: 'a68ab296', ordemPerdedor: 1, ordemSobrevivente: 1 },
    { perdedor: 'bcc855a9', contatoLp: '34076397', sobrevivente: 'c7ca2b17', contatoWa: '9f5acee3', ordemPerdedor: 0, ordemSobrevivente: 2 },
    { perdedor: 'c52f0fd4', contatoLp: 'b632536e', sobrevivente: 'dc982758', contatoWa: 'f015d1cf', ordemPerdedor: 0, ordemSobrevivente: 4 },
  ],
  tipoB: [
    { contato: '0d0d6cbb', perdedor: '4f45f163', ordemPerdedor: 1, sobrevivente: '17b4bdee', ordemSobrevivente: 2 },
    { contato: '745defaf', perdedor: '26cf8f43', ordemPerdedor: 0, sobrevivente: '8f817576', ordemSobrevivente: 1 },
    { contato: '7d287767', perdedor: '57efb6e0', ordemPerdedor: 1, sobrevivente: 'e6a98089', ordemSobrevivente: 2 },
    { contato: 'd710be17', perdedor: 'e0c5249f', ordemPerdedor: 3, sobrevivente: '5c0756fb', ordemSobrevivente: 4 },
    { contato: 'd710be17', perdedor: 'cb14c659', ordemPerdedor: 1, sobrevivente: '5c0756fb', ordemSobrevivente: 4 },
    { contato: '0ec75e7f', perdedor: '2b216592', ordemPerdedor: 3, sobrevivente: '58beadc0', ordemSobrevivente: 4 },
    { contato: '1153a09a', perdedor: '462a380e', ordemPerdedor: 1, sobrevivente: '99b87ee5', ordemSobrevivente: 2 },
    { contato: '115625c1', perdedor: '3b849cf3', ordemPerdedor: 0, sobrevivente: '6e77f6b3', ordemSobrevivente: 1 },
    { contato: '2ba3e4bb', perdedor: '9d378f90', ordemPerdedor: 1, sobrevivente: '3e239a24', ordemSobrevivente: 2 },
    { contato: '2e9653a5', perdedor: 'bd7d5444', ordemPerdedor: 0, sobrevivente: '00021d83', ordemSobrevivente: 2 },
    { contato: '3bc54c46', perdedor: '2ab2a5ec', ordemPerdedor: 2, sobrevivente: '589cf47f', ordemSobrevivente: 4 },
    { contato: '4820f82e', perdedor: '9209076e', ordemPerdedor: 0, sobrevivente: 'ff2a0c3e', ordemSobrevivente: 1 },
    { contato: '5d59c53d', perdedor: 'e6487465', ordemPerdedor: 1, sobrevivente: '02e47343', ordemSobrevivente: 2 },
    { contato: '6b524fd9', perdedor: 'c535f99b', ordemPerdedor: 0, sobrevivente: '52dd3370', ordemSobrevivente: 4 },
    { contato: '6ea03641', perdedor: '5ca0d75f', ordemPerdedor: 0, sobrevivente: '0b06b6cd', ordemSobrevivente: 2 },
    { contato: '986f6ed3', perdedor: 'a983e821', ordemPerdedor: 0, sobrevivente: 'a640d85e', ordemSobrevivente: 1 },
    { contato: 'a570890d', perdedor: '8ccc8cc7', ordemPerdedor: 0, sobrevivente: '7d456732', ordemSobrevivente: 2 },
    { contato: 'a58cdbfa', perdedor: 'bc037b00', ordemPerdedor: 0, sobrevivente: '1f4432ae', ordemSobrevivente: 1 },
    { contato: 'bf2feb51', perdedor: '5a646702', ordemPerdedor: 1, sobrevivente: '60bb65d2', ordemSobrevivente: 2 },
    { contato: 'e6d43d67', perdedor: 'a313b612', ordemPerdedor: 0, sobrevivente: '1e8382d9', ordemSobrevivente: 1 },
    { contato: 'f21eb4d2', perdedor: 'f267be34', ordemPerdedor: 0, sobrevivente: 'd7c56588', ordemSobrevivente: 1 },
  ],
});

// Cards que a busca do AC0 acha, mas que o Filipe decidiu NÃO mexer (03/11, D3). Aparecer não para o AC0;
// o script nunca escreve neles (não estão no ESPERADO). Qualquer OUTRO card fora da lista continua parando.
export const IGNORAR = Object.freeze([
  '3d16c8bd', '7415c18c', '0bb8f43d', '5143394e', // tipo A com os dois cards em Profissional (S1 não decide)
  '41d374ff', '32edefa2', '85a1b48d', 'a5e957a8', // órfãos da LP em Lead novo; o gêmeo do WhatsApp está em Perdido
  '009abd19', 'fbc9012e', '091eecf8', // card do WhatsApp cujo gêmeo da LP foi para Perdido em 29/10
  '7a3b95f7', // Clientes
]);

/** Nenhum card pode estar ao mesmo tempo na lista e no IGNORAR. */
export function validarListas(esp = ESPERADO, ignorar = IGNORAR) {
  const naLista = new Set([...esp.tipoA.flatMap((e) => [e.perdedor, e.sobrevivente]), ...esp.tipoB.flatMap((e) => [e.perdedor, e.sobrevivente])]);
  const erros = ignorar.filter((p) => naLista.has(p)).map((p) => `card ${p} está na lista E no IGNORAR`);
  const perdedores = [...esp.tipoA, ...esp.tipoB].map((e) => e.perdedor);
  for (const p of new Set(perdedores)) if (perdedores.filter((x) => x === p).length > 1) erros.push(`card ${p} aparece 2 vezes como perdedor`);
  for (const p of perdedores) if ([...esp.tipoA, ...esp.tipoB].some((e) => e.sobrevivente === p)) erros.push(`card ${p} é perdedor e sobrevivente`);
  return erros;
}

// AC3: linhas filhas que MUDAM de card (deal_id) para o sobrevivente.
export const TABELAS_FILHAS = ['activities', 'deal_notes', 'deal_activities', 'deal_files', 'deal_items'];
// Tabelas com FK para deals que FICAM no card excluído (histórico/log). Linha aqui => aviso, não parada.
export const TABELAS_QUE_FICAM = new Set([
  'ai_decisions', 'ai_audio_notes', 'webhook_events_in', 'webhook_events_out',
  'messaging_contact_aliases', 'voice_calls',
  'ai_pending_evaluations', 'ai_pending_lead_scores', 'ai_pending_stage_advances', // pendentes => parada (filas_pendentes)
]);
// Colunas com FK para contacts que o merge_contacts move (ou que são a própria trilha do merge).
export const COLUNAS_QUE_O_MERGE_MOVE = new Set([
  'deals.contact_id', 'messaging_conversations.contact_id', 'activities.contact_id',
  'ai_decisions.contact_id', 'ai_audio_notes.contact_id', 'leads.converted_to_contact_id',
  'webhook_events_in.created_contact_id',
  'contact_merge_log.source_contact_id', 'contact_merge_log.target_contact_id',
]);

// ---------------------------------------------------------------------------------------------
// Utilitários puros
// ---------------------------------------------------------------------------------------------
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const prefixo = (id) => String(id ?? '').slice(0, 8);
export const lit = (s) => (s === null || s === undefined ? 'null' : `'${String(s).replace(/'/g, "''")}'`);
export const jsonLit = (o) => `${lit(JSON.stringify(o ?? {}))}::jsonb`;
export function uuidLit(s) {
  if (!UUID_RE.test(String(s))) throw new Error(`id inválido para SQL: ${String(s).slice(0, 40)}`);
  return `'${String(s).toLowerCase()}'::uuid`;
}
export const ident = (s) => `"${String(s).replace(/"/g, '""')}"`;
function prefixosLit(lista) {
  for (const p of lista) if (!/^[0-9a-f]{8}$/.test(p)) throw new Error(`prefixo inválido: ${p}`);
  return `array[${lista.map((p) => `'${p}'`).join(',')}]::text[]`;
}
const uuidArray = (ids) => (ids.length ? `array[${ids.map(uuidLit).join(',')}]` : `array[]::uuid[]`);

/** Id determinístico da nota do AC4: md5('2.62:' || id do card juntado) no formato uuid (igual a md5(...)::uuid no Postgres). */
export function idDaNota(perdedorId) {
  const h = crypto.createHash('md5').update(`2.62:${String(perdedorId).toLowerCase()}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function mascararTelefone(t) {
  const d = String(t ?? '').replace(/\D/g, '');
  if (!d) return '(sem telefone)';
  if (d.length <= 8) return `${'*'.repeat(Math.max(0, d.length - 2))}${d.slice(-2)}`;
  return `${d.slice(0, 4)}*****${d.slice(-4)}`;
}
export function mascararEmail(e) {
  const s = String(e ?? '').trim();
  if (!s) return '(sem e-mail)';
  const [u, dom = ''] = s.split('@');
  return `${u.slice(0, 1)}***@${dom.slice(0, 1)}***`;
}
export function mascararNome(n) {
  const s = String(n ?? '').trim();
  if (!s) return '(sem nome)';
  return s.split(/\s+/).map((p) => `${p.slice(0, 1)}***`).join(' ');
}

/** dd/mm/aaaa hh:mm no horário de Brasília. */
export function dataBrasilia(iso) {
  if (!iso) return '(sem data)';
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date(iso)).map((p) => [p.type, p.value])
  );
  return `${partes.day}/${partes.month}/${partes.year} ${partes.hour}:${partes.minute}`;
}

/**
 * S1 — sobrevivente = card da etapa de maior "order"; empate => o que tem conversa; persistindo => o mais antigo.
 * Etapa > 7 (Ganho/Perdido/Clientes/...) ou sem etapa => a regra não decide sozinha: para.
 * @param {{id:string, ordem:number|null, temConversa:boolean, criadoEm:string}[]} cards
 */
export function escolherSobrevivente(cards) {
  if (!Array.isArray(cards) || cards.length < 2) return { parar: 'menos de 2 cards para comparar' };
  const fora = cards.filter((c) => typeof c.ordem !== 'number' || c.ordem > ORDEM_MAXIMA_DE_AVANCO || c.ordem < 0);
  if (fora.length) {
    return { parar: `etapa fora da régua de avanço (order > ${ORDEM_MAXIMA_DE_AVANCO} ou sem etapa): ${fora.map((c) => prefixo(c.id)).join(', ')}` };
  }
  const ordenados = [...cards].sort(
    (a, b) =>
      b.ordem - a.ordem ||
      Number(Boolean(b.temConversa)) - Number(Boolean(a.temConversa)) ||
      Date.parse(a.criadoEm) - Date.parse(b.criadoEm) ||
      String(a.id).localeCompare(String(b.id))
  );
  return { sobrevivente: ordenados[0], perdedores: ordenados.slice(1) };
}

const vazio = (v) =>
  v === null || v === undefined ||
  (typeof v === 'string' && v.trim() === '') ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);

/** S4 — só preenche chave que o sobrevivente não tem ou tem vazia; chave preenchida nunca muda. */
export function mesclarCustomFields(doSobrevivente, doPerdedor) {
  const resultado = { ...(doSobrevivente ?? {}) };
  const adicionadas = {};
  for (const [k, v] of Object.entries(doPerdedor ?? {})) {
    if (vazio(v) || !vazio(resultado[k])) continue;
    resultado[k] = v;
    adicionadas[k] = v;
  }
  return { resultado, adicionadas };
}

/** AC4 — texto da nota de origem (vai para a timeline que a Fernanda lê; dado completo, sem mascarar). */
export function montarNota(par, agoraIso) {
  const L = par.perdedor;
  if (par.tipo === 'A') {
    const CL = par.contatoLp;
    const CW = par.contatoWa;
    const linhas = [
      `Este lead também tinha um card criado pelo formulário da landing page (LP Acreditando). Ele foi juntado a este em ${dataBrasilia(agoraIso)}.`,
      '',
      `Título original do card: ${L.title}`,
      `Criado em: ${dataBrasilia(L.created_at)} (horário de Brasília)`,
      `Nome informado no formulário: ${CL.name || 'não informado'}`,
      `Nome anterior do contato (WhatsApp): ${CW.name || 'não informado'}`,
      `Telefone informado no formulário: ${CL.phone || 'não informado'}`,
      `E-mail: ${CL.email || 'não informado'}`,
      `Card juntado: ${prefixo(L.id)} (ref. 2.62/${L.id})`,
    ];
    return { titulo: TITULO_NOTA_A, descricao: linhas.join('\n') };
  }
  const linhas = [
    `Este lead tinha outro card aberto no funil, no mesmo contato. Ele foi juntado a este em ${dataBrasilia(agoraIso)}.`,
    '',
    `Título original do card: ${L.title}`,
    `Etapa em que estava: ${L.etapa ?? 'não informada'}`,
    `Criado em: ${dataBrasilia(L.created_at)} (horário de Brasília)`,
    `Card juntado: ${prefixo(L.id)} (ref. 2.62/${L.id})`,
  ];
  return { titulo: TITULO_NOTA_B, descricao: linhas.join('\n') };
}

// ---------------------------------------------------------------------------------------------
// Cliente HTTP (Management API) — o token nunca sai em log nem em mensagem de erro
// ---------------------------------------------------------------------------------------------
export function caminhosDoToken(env = process.env) {
  return [
    env.SUPABASE_CRM_MGMT_TOKEN_FILE,
    'C:/Users/filip_mg5w2c4/grupo-acreditando/.credenciais/supabase-crm-mgmt.token',
    path.join(os.homedir(), 'grupo-acreditando', '.credenciais', 'supabase-crm-mgmt.token'),
  ].filter(Boolean);
}

export function lerToken(env = process.env, existe = fs.existsSync, ler = (p) => fs.readFileSync(p, 'utf8')) {
  if (env.SUPABASE_CRM_MGMT_TOKEN) return env.SUPABASE_CRM_MGMT_TOKEN.trim();
  const candidatos = caminhosDoToken(env);
  const arquivo = candidatos.find((p) => existe(p));
  if (!arquivo) {
    const e = new Error(`Token não encontrado. Procurei em:\n  ${candidatos.join('\n  ')}\nDefina SUPABASE_CRM_MGMT_TOKEN ou SUPABASE_CRM_MGMT_TOKEN_FILE.`);
    e.codigo = 4;
    throw e;
  }
  return ler(arquivo).trim();
}

export function criarCliente({ token, fetchImpl = globalThis.fetch, ref = REF }) {
  const limpar = (s) => (token ? String(s).split(token).join('[token]') : String(s));
  return async function q(sql) {
    let res;
    try {
      res = await fetchImpl(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: sql }),
      });
    } catch (e) {
      throw new Error(`falha de rede: ${limpar(e?.message ?? e)}`);
    }
    const corpo = await res.text();
    if (!res.ok) {
      const dica = res.status === 401 || res.status === 403 ? ' (token sem acesso a este projeto? é da conta certa?)' : '';
      const err = new Error(`HTTP ${res.status}${dica}: ${limpar(corpo).slice(0, 2000)}`);
      err.status = res.status;
      throw err;
    }
    return corpo ? JSON.parse(corpo) : [];
  };
}

// ---------------------------------------------------------------------------------------------
// SQL de leitura (AC0)
// ---------------------------------------------------------------------------------------------
const prefixosCartoes = (esp) => [...esp.tipoA.flatMap((e) => [e.perdedor, e.sobrevivente]), ...esp.tipoB.flatMap((e) => [e.perdedor, e.sobrevivente])];
const prefixosContatos = (esp) => [...esp.tipoA.flatMap((e) => [e.contatoLp, e.contatoWa]), ...esp.tipoB.map((e) => e.contato)];
const aberto = (c) => !c.deleted_at && !c.is_won && !c.is_lost;

export const sqlPerfil = (email = EMAIL_DO_FILIPE) => `/* 2.62:perfil */
select p.id, p.organization_id from public.profiles p join auth.users u on u.id = p.id
where lower(u.email) = lower(${lit(email)})`;

export const sqlFkLista = () => `/* 2.62:fk-lista */
select n.nspname as esquema, cl.relname as tabela, a.attname as coluna, tcl.relname as alvo
from pg_constraint c
join pg_class cl on cl.oid = c.conrelid join pg_namespace n on n.oid = cl.relnamespace
join pg_class tcl on tcl.oid = c.confrelid join pg_namespace tn on tn.oid = tcl.relnamespace
join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
where c.contype = 'f' and tn.nspname = 'public' and tcl.relname in ('deals', 'contacts')
  and array_length(c.conkey, 1) = 1
order by 2, 3`;

export function sqlMedicao(esp = ESPERADO) {
  const pc = prefixosLit(prefixosCartoes(esp));
  const pk = prefixosLit(prefixosContatos(esp));
  const abertoNoBoard = (a) => `${a}.board_id::text like '${BOARD_PREFIXO}%' and ${a}.deleted_at is null
      and coalesce(${a}.is_won, false) = false and coalesce(${a}.is_lost, false) = false`;
  const filhas = TABELAS_FILHAS.map((t) => `select '${t}' as t, deal_id as id, count(*) as n from public.${t} where deal_id in (select id from cartoes) group by deal_id`).join('\n      union all ');
  const filas = ['ai_pending_evaluations', 'ai_pending_lead_scores', 'ai_pending_stage_advances']
    .map((t) => `select '${t}' as t, x.deal_id as id, x.status from public.${t} x where x.deal_id in (select id from cartoes) and x.status in ('pending', 'processing')`)
    .join('\n      union all ');
  return `/* 2.62:medicao */
with cartoes as (select d.* from public.deals d where left(d.id::text, 8) = any(${pc})),
contatos as (select c.* from public.contacts c where left(c.id::text, 8) = any(${pk})),
norm as (
  select c.id, c.organization_id org,
    case when length(d) >= 12 and d like '55%' then substr(d, 3) else d end d2
  from (select id, organization_id, regexp_replace(coalesce(phone, ''), '\\D', '', 'g') d
        from public.contacts where deleted_at is null and merged_into_id is null) c
), k as (
  select id, org, case when length(d2) = 11 then substr(d2, 1, 2) || substr(d2, 4) else d2 end chave
  from norm where length(d2) between 10 and 11
), dup as (select org, chave from k group by 1, 2 having count(*) > 1)
select jsonb_build_object(
  'cartoes', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', d.id, 'board_id', d.board_id, 'stage_id', d.stage_id, 'ordem', bs."order", 'etapa', bs.label,
      'contact_id', d.contact_id, 'title', d.title, 'created_at', d.created_at, 'deleted_at', d.deleted_at,
      'is_won', coalesce(d.is_won, false), 'is_lost', coalesce(d.is_lost, false),
      'custom_fields', coalesce(d.custom_fields, '{}'::jsonb), 'organization_id', d.organization_id)), '[]'::jsonb)
    from cartoes d left join public.board_stages bs on bs.id = d.stage_id),
  'contatos', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name, 'email', c.email, 'phone', c.phone, 'source', c.source,
      'merged_into_id', c.merged_into_id, 'deleted_at', c.deleted_at, 'organization_id', c.organization_id,
      'conversas', (select count(*) from public.messaging_conversations m where m.contact_id = c.id))), '[]'::jsonb)
    from contatos c),
  'conversas', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'contact_id', m.contact_id) order by m.id), '[]'::jsonb)
    from public.messaging_conversations m where m.contact_id in (select id from contatos)),
  'merge_log', (select coalesce(jsonb_agg(jsonb_build_object('source_contact_id', l.source_contact_id,
      'target_contact_id', l.target_contact_id, 'merged_by', l.merged_by, 'records_moved', l.records_moved)), '[]'::jsonb)
    from public.contact_merge_log l where l.source_contact_id in (select id from contatos)),
  'notas', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'deal_id', a.deal_id, 'contact_id', a.contact_id,
      'type', a.type, 'title', a.title, 'description', a.description, 'deleted_at', a.deleted_at)), '[]'::jsonb)
    from public.activities a join cartoes c on a.id = md5('2.62:' || c.id::text)::uuid),
  'notas_por_card', (select coalesce(jsonb_agg(jsonb_build_object('deal_id', x.deal_id, 'n', x.n)), '[]'::jsonb) from (
      select a.deal_id, count(*) n from public.activities a
      where a.deal_id in (select id from cartoes) and a.type = 'NOTE' and a.deleted_at is null
        and a.title in (${lit(TITULO_NOTA_A)}, ${lit(TITULO_NOTA_B)})
      group by a.deal_id) x),
  'filhas', (select coalesce(jsonb_agg(jsonb_build_object('tabela', x.t, 'id', x.id, 'n', x.n)), '[]'::jsonb) from (
      ${filhas}) x),
  'filas_pendentes', (select coalesce(jsonb_agg(jsonb_build_object('tabela', x.t, 'id', x.id, 'status', x.status)), '[]'::jsonb) from (
      ${filas}) x),
  'telefone', (select coalesce(jsonb_agg(jsonb_build_object('chave', k.chave, 'deal_id', d.id, 'contact_id', d.contact_id,
      'ordem', bs."order") order by k.chave, bs."order"), '[]'::jsonb)
    from public.deals d join public.board_stages bs on bs.id = d.stage_id
    join k on k.id = d.contact_id join dup on dup.org = k.org and dup.chave = k.chave
    where ${abertoNoBoard('d')}),
  'email', (select coalesce(jsonb_agg(jsonb_build_object('n', x.n, 'contatos', x.ids)), '[]'::jsonb) from (
      select lower(btrim(c.email)) e, count(distinct c.id) n, array_agg(distinct c.id) ids
      from public.contacts c join public.deals d on d.contact_id = c.id
      where c.deleted_at is null and c.merged_into_id is null and coalesce(btrim(c.email), '') <> ''
        and ${abertoNoBoard('d')}
      group by c.organization_id, lower(btrim(c.email)) having count(distinct c.id) > 1) x),
  'dois_cards', (select coalesce(jsonb_agg(jsonb_build_object('contact_id', x.contact_id, 'deals', x.deals)), '[]'::jsonb) from (
      select d.contact_id, array_agg(d.id order by d.id) deals from public.deals d
      where ${abertoNoBoard('d')} group by d.contact_id having count(*) > 1) x),
  'lead_novo', (select count(*) from public.deals d where ${abertoNoBoard('d')} and d.stage_id::text like '${LEAD_NOVO_PREFIXO}%')
) as doc`;
}

const chaveFk = (f) => (f.esquema && f.esquema !== 'public' ? `${f.esquema}.${f.tabela}` : f.tabela);

export function sqlFkContagem(fkLista, idsCartoes, idsContatos) {
  const partes = [];
  for (const f of fkLista) {
    const ids = f.alvo === 'deals' ? idsCartoes : idsContatos;
    if (!ids.length) continue;
    partes.push(`select ${lit(chaveFk(f))} as tabela, ${lit(f.coluna)} as coluna, ${lit(f.alvo)} as alvo, x.${ident(f.coluna)}::text as id, count(*)::int as n
  from ${ident(f.esquema)}.${ident(f.tabela)} x where x.${ident(f.coluna)} = any(${uuidArray(ids)}) group by 4`);
  }
  if (!partes.length) return null;
  return `/* 2.62:fk-contagem */\n${partes.join('\nunion all\n')}`;
}

const doc = (linhas) => {
  const v = linhas?.[0]?.doc;
  return typeof v === 'string' ? JSON.parse(v) : v;
};

/** Medição completa (AC0 a–d). Também é o read-back: re-medir e comparar. */
export async function medir(q, esp = ESPERADO, fkLista = null) {
  const fk = fkLista ?? (await q(sqlFkLista()));
  const snap = doc(await q(sqlMedicao(esp)));
  const sqlFk = sqlFkContagem(fk, snap.cartoes.map((c) => c.id), snap.contatos.map((c) => c.id));
  snap.fk = sqlFk ? await q(sqlFk) : [];
  snap.fkLista = fk;
  return snap;
}

// ---------------------------------------------------------------------------------------------
// AC0 — comparar o medido com a lista (ESPERADO) e montar o plano
// ---------------------------------------------------------------------------------------------
function achar(lista, p, oque, div) {
  const m = (lista ?? []).filter((x) => String(x.id).startsWith(p));
  if (m.length !== 1) {
    div.push(`${oque} ${p}: ${m.length} linha(s) com esse prefixo (esperado 1)`);
    return null;
  }
  return m[0];
}

const somaFk = (snap, tabela, ids) =>
  (snap.fk ?? []).filter((f) => f.tabela === tabela && ids.includes(f.id)).reduce((s, f) => s + Number(f.n), 0);

function filhasDe(snap, id) {
  return Object.fromEntries(
    TABELAS_FILHAS.map((t) => [t, (snap.filhas ?? []).filter((f) => f.tabela === t && f.id === id).reduce((s, f) => s + Number(f.n), 0)])
  );
}

/**
 * Compara a medição com o esperado (P2: qualquer diferença => parar) e reconhece o que já foi feito
 * (idempotência: par já mesclado/excluído não é refeito).
 */
export function avaliar(snap, esp = ESPERADO, { excluir = false, ignorar = IGNORAR } = {}) {
  const divergencias = validarListas(esp, ignorar).map((e) => `lista inválida: ${e}`);
  const avisos = [];
  const pares = [];
  const notas = new Set((snap.notas ?? []).filter((n) => !n.deleted_at).map((n) => n.id));
  const noBoard = (c) => String(c.board_id).startsWith(BOARD_PREFIXO);
  // N2 (09/10): sobrevivente que só AVANÇOU de etapa não trava o AC0 (vira aviso). Recuo continua parando.
  // A escolha pela etapa mais avançada é refeita com a etapa nova (S1, abaixo): se o card que fica mudar, para.
  const checarEtapaSobrevivente = (nome, e, W, pd) => {
    if (W.ordem === e.ordemSobrevivente) return;
    if (typeof W.ordem === 'number' && W.ordem > e.ordemSobrevivente) {
      avisos.push(`${nome}: sobrevivente ${e.sobrevivente} avançou da etapa ${e.ordemSobrevivente} para ${W.ordem} (${W.etapa}) desde ${DATA_DA_LISTA} — segue (N2)`);
    } else {
      pd.push(`sobrevivente ${e.sobrevivente} na etapa ${W.ordem} (${W.etapa}); em ${DATA_DA_LISTA} era ${e.ordemSobrevivente} (não avançou)`);
    }
  };

  const checarFk = (nome, L, CL, pendente) => {
    const pd = [];
    for (const f of snap.fk ?? []) {
      if (!(Number(f.n) > 0)) continue;
      if (f.alvo === 'deals' && f.id === L.id) {
        if (TABELAS_FILHAS.includes(f.tabela) || (f.tabela === 'deals')) continue;
        if (TABELAS_QUE_FICAM.has(f.tabela)) avisos.push(`${nome}: ${f.n} linha(s) em ${f.tabela}.${f.coluna} ficam no card ${prefixo(L.id)} (histórico)`);
        else pd.push(`card ${prefixo(L.id)} tem ${f.n} linha(s) em ${f.tabela}.${f.coluna}, tabela que o script não sabe tratar`);
      }
      if (pendente && CL && f.alvo === 'contacts' && f.id === CL.id && !COLUNAS_QUE_O_MERGE_MOVE.has(`${f.tabela}.${f.coluna}`)) {
        pd.push(`contato ${prefixo(CL.id)} tem ${f.n} linha(s) em ${f.tabela}.${f.coluna}, que o merge_contacts não move`);
      }
    }
    for (const fp of snap.filas_pendentes ?? []) {
      if (fp.id === L.id) pd.push(`card ${prefixo(L.id)} tem item ${fp.status} em ${fp.tabela}`);
    }
    return pd;
  };

  for (const e of esp.tipoA) {
    const nome = `par A ${e.perdedor}→${e.sobrevivente}`;
    const pd = [];
    const L = achar(snap.cartoes, e.perdedor, 'card', pd);
    const W = achar(snap.cartoes, e.sobrevivente, 'card', pd);
    const CL = achar(snap.contatos, e.contatoLp, 'contato', pd);
    const CW = achar(snap.contatos, e.contatoWa, 'contato', pd);
    if (!L || !W || !CL || !CW) { divergencias.push(...pd.map((d) => `${nome}: ${d}`)); continue; }
    if (!noBoard(L) || !noBoard(W)) pd.push('card fora do board Acreditando');
    if (!aberto(W)) pd.push(`sobrevivente ${e.sobrevivente} não está aberto`);
    checarEtapaSobrevivente(nome, e, W, pd);
    if (L.ordem !== e.ordemPerdedor) pd.push(`card da LP ${e.perdedor} na etapa ${L.ordem} (${L.etapa}); em ${DATA_DA_LISTA} era ${e.ordemPerdedor}`);
    if (L.is_won || L.is_lost) pd.push(`card da LP ${e.perdedor} marcado como ganho/perdido`);
    if (W.contact_id !== CW.id) pd.push('card do WhatsApp mudou de contato');
    if (CW.merged_into_id || CW.deleted_at) pd.push('contato do WhatsApp mesclado ou apagado');
    if (!(Number(CW.conversas) >= 1)) pd.push('contato do WhatsApp sem conversa');
    if (CL.organization_id !== CW.organization_id) pd.push('contatos em organizações diferentes');

    let estado = null;
    if (!CL.merged_into_id) {
      if (CL.deleted_at) pd.push('contato da LP apagado sem mescla');
      if (Number(CL.conversas) !== 0) pd.push(`contato da LP ganhou conversa (${CL.conversas})`);
      if (L.contact_id !== CL.id) pd.push('card da LP mudou de contato');
      if (L.deleted_at) pd.push('card da LP já excluído sem mescla');
      estado = 'pendente';
    } else if (CL.merged_into_id === CW.id) {
      if (L.contact_id !== CW.id) pd.push('contato mesclado, mas o card da LP não foi para o contato do WhatsApp');
      estado = L.deleted_at ? 'concluido' : 'mesclado';
    } else {
      pd.push('contato da LP mesclado em OUTRO contato');
    }

    // Depois da mescla, a conversa do contato do WhatsApp passa a "ser" do card da LP também; num empate de etapa
    // (ex.: os dois em Lead novo) a S1 cairia no "mais antigo" e inverteria o card que fica na 2ª rodada
    // (--execute e depois --excluir-perdedores). Vale o estado de ANTES da mescla: as conversas que o
    // merge_contacts moveu do contato da LP (contact_merge_log.records_moved.conversations).
    const logLp = (snap.merge_log ?? []).find((l) => l.source_contact_id === CL.id);
    const temConversaL = estado === 'pendente'
      ? Number(CL.conversas) > 0
      : Number(logLp?.records_moved?.conversations ?? 1) > 0;
    const s1 = escolherSobrevivente([
      { id: L.id, ordem: L.ordem, temConversa: temConversaL, criadoEm: L.created_at },
      { id: W.id, ordem: W.ordem, temConversa: true, criadoEm: W.created_at },
    ]);
    if (s1.parar) pd.push(s1.parar);
    else if (s1.sobrevivente.id !== W.id) pd.push(`regra S1 escolhe ${prefixo(s1.sobrevivente.id)} como sobrevivente, não ${e.sobrevivente}`);

    pd.push(...checarFk(nome, L, CL, estado === 'pendente'));
    if (pd.length) { divergencias.push(...pd.map((d) => `${nome}: ${d}`)); continue; }

    const { resultado, adicionadas } = mesclarCustomFields(W.custom_fields, L.custom_fields);
    const nomeLp = String(CL.name ?? '').trim();
    if (estado === 'pendente' && !nomeLp) avisos.push(`${nome}: contato da LP sem nome — o nome do WhatsApp fica (P5 não se aplica)`);
    const notaId = idDaNota(L.id);
    pares.push({
      tipo: 'A', nome, estado, perdedor: L, sobrevivente: W, contatoLp: CL, contatoWa: CW, notaId,
      customFieldsResultado: resultado,
      passos: {
        // Empate de etapa (os 2 cards na mesma etapa): depois da mescla ficariam no MESMO contato e na MESMA etapa,
        // o que o trigger check_deal_duplicate_trigger proíbe em qualquer UPDATE de deals. Ver sqlDoPar.
        empate: estado === 'pendente' && L.stage_id === W.stage_id,
        mesclar: estado === 'pendente',
        renomear: estado === 'pendente' && !!nomeLp && nomeLp !== CW.name,
        moverFilhas: filhasDe(snap, L.id),
        camposAdicionados: adicionadas,
        nota: !notas.has(notaId),
        excluir: Boolean(excluir) && !L.deleted_at,
      },
    });
  }

  // Tipo B — agrupado por contato: um contato pode ter 3+ cards abertos (1 fica, os outros saem).
  const gruposB = new Map();
  for (const e of esp.tipoB) gruposB.set(e.contato, [...(gruposB.get(e.contato) ?? []), e]);
  for (const [contatoP, entradas] of gruposB) {
    const nomeG = `contato B ${contatoP}`;
    const sobrevP = [...new Set(entradas.map((e) => e.sobrevivente))];
    if (sobrevP.length !== 1) { divergencias.push(`${nomeG}: a lista tem mais de um card que fica (${sobrevP.join(', ')})`); continue; }
    const pdG = [];
    const W = achar(snap.cartoes, sobrevP[0], 'card', pdG);
    const C = achar(snap.contatos, contatoP, 'contato', pdG);
    const Ls = entradas.map((e) => achar(snap.cartoes, e.perdedor, 'card', pdG));
    if (!W || !C || Ls.some((x) => !x)) { divergencias.push(...pdG.map((d) => `${nomeG}: ${d}`)); continue; }
    if (!noBoard(W)) pdG.push('card que fica fora do board Acreditando');
    if (W.contact_id !== C.id) pdG.push(`card que fica ${sobrevP[0]} não está mais no contato`);
    if (C.merged_into_id || C.deleted_at) pdG.push('contato mesclado ou apagado');
    if (!aberto(W)) pdG.push(`sobrevivente ${sobrevP[0]} não está aberto`);
    checarEtapaSobrevivente(nomeG, entradas[0], W, pdG);
    for (const e of entradas.slice(1)) if (e.ordemSobrevivente !== entradas[0].ordemSobrevivente) pdG.push('lista com etapas diferentes para o mesmo card que fica');
    // S1 com TODOS os cards do contato de uma vez (um card de etapa maior em qualquer perdedor muda o card que fica).
    const temConversa = Number(C.conversas) > 0;
    const s1 = escolherSobrevivente([W, ...Ls].map((c) => ({ id: c.id, ordem: c.ordem, temConversa, criadoEm: c.created_at })));
    if (s1.parar) pdG.push(s1.parar);
    else if (s1.sobrevivente.id !== W.id) pdG.push(`regra S1 escolhe ${prefixo(s1.sobrevivente.id)} como sobrevivente, não ${sobrevP[0]}`);
    const pdPorPar = entradas.map((e, i) => {
      const L = Ls[i];
      const pd = [];
      if (!noBoard(L)) pd.push('card fora do board Acreditando');
      if (L.contact_id !== C.id) pd.push('os cards não estão mais no mesmo contato');
      if (L.ordem !== e.ordemPerdedor) pd.push(`perdedor ${e.perdedor} na etapa ${L.ordem} (${L.etapa}); em ${DATA_DA_LISTA} era ${e.ordemPerdedor}`);
      if (L.is_won || L.is_lost) pd.push(`perdedor ${e.perdedor} marcado como ganho/perdido`);
      pd.push(...checarFk(`par B ${e.perdedor}→${e.sobrevivente}`, L, null, false));
      return pd;
    });
    if (pdG.length || pdPorPar.some((pd) => pd.length)) {
      divergencias.push(...pdG.map((d) => `${nomeG}: ${d}`));
      entradas.forEach((e, i) => divergencias.push(...pdPorPar[i].map((d) => `par B ${e.perdedor}→${e.sobrevivente}: ${d}`)));
      continue; // o contato inteiro para: não junta "metade" dos cards
    }

    // S4 encadeado: com 2+ perdedores no mesmo sobrevivente, cada par parte do custom_fields que o par anterior deixou
    // (senão a guarda de concorrência do 2º par e o read-back reprovariam por causa do 1º).
    let cfAtual = W.custom_fields;
    entradas.forEach((e, i) => {
      const L = Ls[i];
      const Wpar = { ...W, custom_fields: cfAtual };
      const { resultado, adicionadas } = mesclarCustomFields(cfAtual, L.custom_fields);
      const notaId = idDaNota(L.id);
      pares.push({
        tipo: 'B', nome: `par B ${e.perdedor}→${e.sobrevivente}`, estado: L.deleted_at ? 'concluido' : 'pendente',
        perdedor: L, sobrevivente: Wpar, contato: C, notaId,
        customFieldsResultado: resultado,
        passos: {
          mesclar: false, renomear: false,
          moverFilhas: filhasDe(snap, L.id),
          camposAdicionados: adicionadas,
          nota: !notas.has(notaId),
          excluir: Boolean(excluir) && !L.deleted_at,
        },
      });
      cfAtual = resultado;
    });
  }

  // AC0 (b) — busca no board inteiro: nada além do esperado. Cards do IGNORAR (D3, 03/11) não param.
  const ignorado = (id) => ignorar.some((p) => String(id).startsWith(p));
  if (!divergencias.length) {
    const permitidosTel = new Set(pares.filter((p) => p.tipo === 'A' && p.estado === 'pendente').flatMap((p) => [p.perdedor.id, p.sobrevivente.id]));
    const achadosTel = new Set((snap.telefone ?? []).map((r) => r.deal_id));
    for (const id of achadosTel) {
      if (permitidosTel.has(id)) continue;
      if (ignorado(id)) avisos.push(`busca por telefone: card ${prefixo(id)} ignorado (decisão de ${DATA_DA_LISTA}) — não será mexido`);
      else divergencias.push(`busca por telefone: card ${prefixo(id)} fora da lista de ${DATA_DA_LISTA} (par novo?)`);
    }
    for (const id of permitidosTel) if (!achadosTel.has(id)) divergencias.push(`busca por telefone: card ${prefixo(id)} da lista não apareceu`);

    for (const r of snap.email ?? []) divergencias.push(`busca por e-mail: ${r.n} contatos diferentes com o mesmo e-mail (${(r.contatos ?? []).map(prefixo).join(', ')})`);

    const esperadosDois = new Map(); // contato -> Set de cards abertos esperados
    const somar = (contato, ids) => esperadosDois.set(contato, new Set([...(esperadosDois.get(contato) ?? []), ...ids]));
    for (const p of pares) {
      if (p.tipo === 'B' && p.estado === 'pendente') somar(p.contato.id, [p.perdedor.id, p.sobrevivente.id]);
      if (p.tipo === 'A' && p.estado === 'mesclado') somar(p.contatoWa.id, [p.perdedor.id, p.sobrevivente.id]);
    }
    const achadosDois = new Map((snap.dois_cards ?? []).map((r) => [r.contact_id, r.deals ?? []]));
    for (const [contato, deals] of achadosDois) {
      const esperado = esperadosDois.get(contato);
      if (!esperado) {
        if (deals.every(ignorado)) avisos.push(`contato ${prefixo(contato)}: ${deals.length} cards abertos, todos ignorados (decisão de ${DATA_DA_LISTA})`);
        else divergencias.push(`contato ${prefixo(contato)} com ${deals.length} cards abertos, fora da lista de ${DATA_DA_LISTA}`);
      } else if (deals.length !== esperado.size || ![...esperado].every((id) => deals.includes(id))) {
        divergencias.push(`contato ${prefixo(contato)}: cards abertos ${deals.map(prefixo).join(', ')} (esperado ${[...esperado].map(prefixo).join(', ')})`);
      }
    }
    for (const [contato, esperado] of esperadosDois) if (!achadosDois.has(contato)) divergencias.push(`contato ${prefixo(contato)} deveria ter ${esperado.size} cards abertos e não tem`);
  }

  return { divergencias, avisos, pares, leadNovo: Number(snap.lead_novo) };
}

export function temTrabalho(par) {
  const p = par.passos;
  return p.mesclar || p.renomear || p.nota || p.excluir ||
    Object.keys(p.camposAdicionados).length > 0 ||
    Object.values(p.moverFilhas).some((n) => n > 0);
}

// ---------------------------------------------------------------------------------------------
// Escrita — UM bloco atômico por par (AC2–AC5)
// ---------------------------------------------------------------------------------------------
export const MARCA_ENSAIO = '2.62 ENSAIO OK';

export function sqlDoPar(par, { perfilId, agoraIso, ensaio = false }) {
  const L = par.perdedor;
  const W = par.sobrevivente;
  const p = par.passos;
  const contatoFinal = par.tipo === 'A' ? par.contatoWa : par.contato;
  const nota = montarNota(par, agoraIso);
  const s = [];
  const guarda = (cond, msg) => s.push(`  if coalesce((${cond}), false) = false then raise exception ${lit(`2.62 GUARDA (${par.nome}): ${msg}`)}; end if;`);

  // Guardas: o mundo não mudou entre a medição e a escrita (concorrência otimista).
  guarda(`exists (select 1 from public.deals where id = ${uuidLit(W.id)} and deleted_at is null
      and stage_id = ${uuidLit(W.stage_id)} and contact_id = ${uuidLit(W.contact_id)} and title = ${lit(W.title)}
      and coalesce(custom_fields, '{}'::jsonb) = ${jsonLit(W.custom_fields)})`, 'sobrevivente mudou desde a medição');
  guarda(`exists (select 1 from public.deals where id = ${uuidLit(L.id)} and stage_id = ${uuidLit(L.stage_id)}
      and contact_id = ${uuidLit(L.contact_id)} and deleted_at is ${L.deleted_at ? 'not ' : ''}null)`, 'card perdedor mudou desde a medição');

  // Par em empate de etapa: check_deal_duplicate() (BEFORE INSERT OR UPDATE em deals) recusa qualquer UPDATE de um card
  // aberto quando há OUTRO card aberto (deleted_at nulo) no mesmo contato e etapa. O merge_contacts desliga esse trigger
  // por dentro, mas o UPDATE seguinte — o título do sobrevivente reescrito pelo trg_propagate_contact_name (P5) ou o
  // próprio soft delete do perdedor — bate (ensaio de 03/11, 3 pares). Saída sem desligar trigger: o soft delete do
  // perdedor (AC5) vem ANTES da mescla, enquanto ele ainda está no contato da LP (sem colisão); a partir daí a função
  // não o enxerga mais (filtra deleted_at). Por isso empate EXIGE --excluir-perdedores (barrado no executar).
  const excluirAntes = Boolean(p.empate);
  if (excluirAntes) {
    if (!p.excluir) throw new Error(`${par.nome}: par em empate de etapa exige --excluir-perdedores`);
    s.push(`  update public.deals set deleted_at = now(), updated_at = now() where id = ${uuidLit(L.id)} and deleted_at is null;`);
  }

  if (p.mesclar) {
    const CL = par.contatoLp;
    const CW = par.contatoWa;
    guarda(`exists (select 1 from public.contacts where id = ${uuidLit(CL.id)} and merged_into_id is null and deleted_at is null)`, 'contato da LP mudou');
    guarda(`exists (select 1 from public.contacts where id = ${uuidLit(CW.id)} and merged_into_id is null and deleted_at is null
      and email is not distinct from ${lit(CW.email)} and name is not distinct from ${lit(CW.name)})`, 'contato do WhatsApp mudou');
    // AC2 + P4: merge_contacts exige auth.uid() = profile da org. Papel authenticated SÓ em volta da chamada;
    // o resto do bloco volta ao papel da sessão (senão as escritas seguintes passariam pelo RLS).
    s.push(`  set local role authenticated;`);
    s.push(`  perform set_config('request.jwt.claims', ${lit(JSON.stringify({ sub: perfilId, role: 'authenticated' }))}, true);`);
    s.push(`  perform set_config('request.jwt.claim.sub', ${lit(perfilId)}, true);`);
    guarda(`auth.uid() = ${uuidLit(perfilId)}`, 'auth.uid() não é o profile do Filipe');
    s.push(`  v_merge := public.merge_contacts(${uuidLit(CL.id)}, ${uuidLit(CW.id)});`);
    s.push(`  reset role;`);
    if (p.renomear) {
      // P5: nome do contato = o digitado no formulário. O trigger da 2.20 (trg_propagate_contact_name)
      // reescreve deals.title quando o título é automático. N1 (09/10): o título ACOMPANHA o nome novo —
      // o script não devolve o antigo (ele fica no backup e na nota do AC4).
      s.push(`  update public.contacts set name = ${lit(String(CL.name).trim())}, updated_at = now() where id = ${uuidLit(CW.id)};`);
    }
  }
  // AC3: linhas filhas do perdedor -> sobrevivente.
  for (const t of TABELAS_FILHAS) {
    s.push(`  update public.${t} set deal_id = ${uuidLit(W.id)} where deal_id = ${uuidLit(L.id)};`);
  }
  if (Object.keys(p.camposAdicionados).length) {
    s.push(`  update public.deals set custom_fields = ${jsonLit(par.customFieldsResultado)}, updated_at = now() where id = ${uuidLit(W.id)};`);
  }
  // AC4: uma nota por card juntado, por construção (id determinístico + on conflict do nothing).
  s.push(`  insert into public.activities (id, organization_id, deal_id, contact_id, type, title, description, date, completed, owner_id)
    values (${uuidLit(par.notaId)}, ${uuidLit(W.organization_id)}, ${uuidLit(W.id)}, ${uuidLit(contatoFinal.id)}, 'NOTE',
      ${lit(nota.titulo)}, ${lit(nota.descricao)}, now(), true, ${uuidLit(perfilId)})
    on conflict (id) do nothing;`);
  // AC5: soft delete, sem mudar etapa (não dispara n8n nem pontuação). Nunca DELETE físico.
  if (p.excluir && !excluirAntes) {
    s.push(`  update public.deals set deleted_at = now(), updated_at = now() where id = ${uuidLit(L.id)} and deleted_at is null;`);
  }
  if (ensaio) {
    s.push(`  raise exception '${MARCA_ENSAIO} (%) merge=% -- DESFEITO', ${lit(par.nome)}, coalesce(v_merge::text, 'n/a');`);
  }
  return `/* 2.62:${ensaio ? 'ensaio' : 'escrita'}:${prefixo(L.id)} */
do $par262$
declare v_merge jsonb;
begin
${s.join('\n')}
end
$par262$;`;
}

// ---------------------------------------------------------------------------------------------
// Read-back — re-mede e afirma o VALOR pretendido (não só a existência)
// ---------------------------------------------------------------------------------------------
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ordenarChaves = (o) => Object.fromEntries(Object.entries(o ?? {}).sort(([a], [b]) => a.localeCompare(b)));

export function conferirPar(par, antes, depois, { perfilId }) {
  const erros = [];
  const L0 = par.perdedor;
  const W0 = par.sobrevivente;
  const L = (depois.cartoes ?? []).find((c) => c.id === L0.id);
  const W = (depois.cartoes ?? []).find((c) => c.id === W0.id);
  if (!L || !W) return [`${par.nome}: card sumiu da leitura`];
  const p = par.passos;
  const contatoFinalId = par.tipo === 'A' ? par.contatoWa.id : par.contato.id;

  if (W.deleted_at) erros.push('sobrevivente ficou com deleted_at');
  if (W.stage_id !== W0.stage_id) erros.push('sobrevivente mudou de etapa');
  // N1: com troca de nome, o título pode ter sido reescrito pelo trigger da 2.20. Não presume o formato:
  // lê de volta; se mudou, tem de conter o nome novo (o trigger sempre monta com NEW.name). Sem troca: igual.
  const nomeNovo = par.tipo === 'A' && p.renomear ? String(par.contatoLp.name).trim() : null;
  for (const [rotulo, depoisC, antesC] of [['sobrevivente', W, W0], ['card juntado', L, L0]]) {
    if (!String(depoisC.title ?? '').trim()) erros.push(`título do ${rotulo} ficou vazio`);
    else if (depoisC.title !== antesC.title && !(nomeNovo && depoisC.title.includes(nomeNovo))) {
      erros.push(`título do ${rotulo} mudou sem relação com o nome novo`);
    }
  }
  if (L.stage_id !== L0.stage_id) erros.push('card juntado mudou de etapa');
  if (!igual(ordenarChaves(W.custom_fields), ordenarChaves(par.customFieldsResultado))) erros.push('custom_fields do sobrevivente diferente do pretendido (S4)');
  if (L.contact_id !== contatoFinalId) erros.push('card juntado não está no contato sobrevivente');
  const deveExcluido = p.excluir || Boolean(L0.deleted_at);
  if (deveExcluido && !L.deleted_at) erros.push('card juntado sem deleted_at (AC5)');
  if (!deveExcluido && L.deleted_at) erros.push('card juntado excluído sem pedido');

  const fAntesW = filhasDe(antes, W0.id);
  const fDepoisW = filhasDe(depois, W0.id);
  const fDepoisL = filhasDe(depois, L0.id);
  for (const t of TABELAS_FILHAS) {
    if (fDepoisL[t] !== 0) erros.push(`${t}: ${fDepoisL[t]} linha(s) ainda no card juntado`);
    const notaNova = t === 'activities' && p.nota ? 1 : 0;
    const esperado = fAntesW[t] + p.moverFilhas[t] + notaNova;
    if (fDepoisW[t] !== esperado) erros.push(`${t}: sobrevivente com ${fDepoisW[t]} (esperado ${esperado})`);
  }

  const nota = (depois.notas ?? []).find((n) => n.id === par.notaId);
  if (!nota) erros.push('nota do AC4 não existe');
  else {
    const titulo = par.tipo === 'A' ? TITULO_NOTA_A : TITULO_NOTA_B;
    if (nota.deal_id !== W0.id || nota.contact_id !== contatoFinalId || nota.type !== 'NOTE' || nota.title !== titulo) erros.push('nota do AC4 com dados diferentes do pretendido');
    if (!String(nota.description ?? '').includes(`ref. 2.62/${L0.id}`)) erros.push('nota do AC4 sem a referência do card juntado');
  }
  const nNotas = (depois.notas_por_card ?? []).filter((x) => x.deal_id === W0.id).reduce((s, x) => s + Number(x.n), 0);
  const nNotasEsperado = (antes.notas_por_card ?? []).filter((x) => x.deal_id === W0.id).reduce((s, x) => s + Number(x.n), 0) + (p.nota ? 1 : 0);
  if (nNotas !== nNotasEsperado) erros.push(`notas de junção no sobrevivente: ${nNotas} (esperado ${nNotasEsperado})`);

  if (par.tipo === 'A') {
    const CL0 = par.contatoLp;
    const CW0 = par.contatoWa;
    const CL = (depois.contatos ?? []).find((c) => c.id === CL0.id);
    const CW = (depois.contatos ?? []).find((c) => c.id === CW0.id);
    if (!CL || !CW) return [...erros, 'contato sumiu da leitura'].map((e) => `${par.nome}: ${e}`);
    if (CL.merged_into_id !== CW0.id || !CL.deleted_at) erros.push('contato da LP sem merged_into_id/deleted_at (AC2)');
    if (CW.merged_into_id || CW.deleted_at) erros.push('contato do WhatsApp ficou mesclado/apagado');
    if (CW.phone !== CW0.phone) erros.push('telefone do contato do WhatsApp mudou (não pode)');
    if (p.mesclar) {
      const emailEsperado = CW0.email ?? CL0.email;
      if (CW.email !== emailEsperado) erros.push('e-mail do contato do WhatsApp diferente do pretendido (AC2)');
      const nomeEsperado = p.renomear ? String(CL0.name).trim() : CW0.name;
      if (CW.name !== nomeEsperado) erros.push('nome do contato diferente do pretendido (P5)');
    }
    const logs = (depois.merge_log ?? []).filter((l) => l.source_contact_id === CL0.id);
    if (logs.length !== 1) erros.push(`contact_merge_log: ${logs.length} linha(s) para o contato da LP (esperado 1)`);
    else {
      const rm = logs[0].records_moved ?? {};
      if (logs[0].target_contact_id !== CW0.id) erros.push('contact_merge_log com alvo errado');
      if (p.mesclar && (Number(rm.deals) !== 1 || Number(rm.conversations) !== 0)) erros.push(`contact_merge_log.records_moved = ${JSON.stringify(rm)} (esperado deals 1, conversations 0)`);
      if (p.mesclar && logs[0].merged_by !== perfilId) erros.push('contact_merge_log.merged_by não é o Filipe (P4)');
    }
    const convAntes = (antes.conversas ?? []).filter((c) => c.contact_id === CW0.id).map((c) => c.id).sort();
    const convDepois = (depois.conversas ?? []).filter((c) => c.contact_id === CW0.id).map((c) => c.id).sort();
    if (!igual(convAntes, convDepois)) erros.push('conversas do contato do WhatsApp mudaram');
  }
  return erros.map((e) => `${par.nome}: ${e}`);
}

// ---------------------------------------------------------------------------------------------
// AC1 — backup
// ---------------------------------------------------------------------------------------------
export function sqlBackup(pares, fkLista) {
  const cards = pares.flatMap((p) => [p.perdedor.id, p.sobrevivente.id]);
  const contatos = pares.flatMap((p) => (p.tipo === 'A' ? [p.contatoLp.id, p.contatoWa.id] : [p.contato.id]));
  const perdedores = pares.map((p) => p.perdedor.id);
  const contatosLp = pares.filter((p) => p.tipo === 'A').map((p) => p.contatoLp.id);
  const fk = fkLista
    .map((f) => {
      const ids = f.alvo === 'deals' ? perdedores : contatosLp;
      if (!ids.length) return null;
      return `jsonb_build_object('tabela', ${lit(chaveFk(f))}, 'coluna', ${lit(f.coluna)}, 'alvo', ${lit(f.alvo)},
        'linhas', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from ${ident(f.esquema)}.${ident(f.tabela)} x where x.${ident(f.coluna)} = any(${uuidArray(ids)})))`;
    })
    .filter(Boolean);
  return `/* 2.62:backup */
select jsonb_build_object(
  'deals', (select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb) from public.deals d where d.id = any(${uuidArray(cards)})),
  'contacts', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from public.contacts c where c.id = any(${uuidArray(contatos)})),
  'messaging_conversations', (select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) from public.messaging_conversations m where m.contact_id = any(${uuidArray(contatos)})),
  'contact_merge_log', (select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb) from public.contact_merge_log l where l.source_contact_id = any(${uuidArray(contatos)})),
  'fk', jsonb_build_array(${fk.join(',\n    ')})
) as doc`;
}

/** Prova do AC1: relê o arquivo e afirma quantidade e ids. */
export function conferirBackup(conteudo, pares) {
  const erros = [];
  const cards = new Set(pares.flatMap((p) => [p.perdedor.id, p.sobrevivente.id]));
  const contatos = new Set(pares.flatMap((p) => (p.tipo === 'A' ? [p.contatoLp.id, p.contatoWa.id] : [p.contato.id])));
  const d = conteudo?.linhas?.deals ?? [];
  const c = conteudo?.linhas?.contacts ?? [];
  if (d.length !== cards.size) erros.push(`backup com ${d.length} cards (esperado ${cards.size})`);
  if (c.length !== contatos.size) erros.push(`backup com ${c.length} contatos (esperado ${contatos.size})`);
  for (const r of d) if (!cards.has(r.id)) erros.push(`card inesperado no backup: ${prefixo(r.id)}`);
  for (const r of c) if (!contatos.has(r.id)) erros.push(`contato inesperado no backup: ${prefixo(r.id)}`);
  const nA = pares.filter((p) => p.tipo === 'A').length;
  const nB = pares.length - nA;
  return { erros, resumo: { cards: d.length, contatos: c.length, paresA: nA, paresB: nB } };
}

export function checarIgnoradoPeloGit(arquivo, run = execFileSync) {
  try {
    run('git', ['-C', path.dirname(path.dirname(arquivo)), 'check-ignore', '-q', arquivo], { stdio: 'ignore' });
    return { ok: true, motivo: 'ignorado pelo git' };
  } catch (e) {
    if (e?.status === 1) return { ok: false, motivo: 'o caminho NÃO está ignorado pelo git (dado de lead, Art. 11 LGPD)' };
    if (e?.status === 128) return { ok: true, motivo: 'fora de repositório git' };
    return { ok: false, motivo: `git check-ignore falhou: ${e?.message ?? e}` };
  }
}

// ---------------------------------------------------------------------------------------------
// AC7 — reversão a partir do backup
// ---------------------------------------------------------------------------------------------
export function sqlReversaoDoPar(par, backup) {
  const L = par.perdedor;
  const W = par.sobrevivente;
  const s = [];
  const guarda = (cond, msg) => s.push(`  if coalesce((${cond}), false) = false then raise exception ${lit(`2.62 REVERSÃO GUARDA (${par.nome}): ${msg}`)}; end if;`);
  const linhasFk = (backup.linhas?.fk ?? []);
  const contatoFinal = par.tipo === 'A' ? par.contatoWa : par.contato;
  guarda(`exists (select 1 from public.deals where id = ${uuidLit(L.id)} and contact_id = ${uuidLit(contatoFinal.id)})`, 'card juntado não está no contato sobrevivente — nada a reverter ou mudou');

  // 0. Par A: o card volta ao contato da LP ANTES de reabrir. Reaberto no contato do WhatsApp, num par em empate de
  //    etapa, o check_deal_duplicate_trigger recusaria (2 cards abertos, mesmo contato e etapa).
  if (par.tipo === 'A') s.push(`  update public.deals set contact_id = ${uuidLit(par.contatoLp.id)} where id = ${uuidLit(L.id)};`);
  // 1. card juntado volta a existir (deleted_at do backup, normalmente nulo).
  s.push(`  update public.deals set deleted_at = ${lit(L.deleted_at)}, updated_at = now() where id = ${uuidLit(L.id)};`);
  // 3. filhas movidas no AC3 voltam, pelos ids do backup.
  for (const t of TABELAS_FILHAS) {
    const grupo = linhasFk.find((g) => g.alvo === 'deals' && g.tabela === t && g.coluna === 'deal_id');
    const ids = (grupo?.linhas ?? []).filter((r) => r.deal_id === L.id && r.id).map((r) => r.id);
    if (ids.length) s.push(`  update public.${t} set deal_id = ${uuidLit(L.id)} where id = any(${uuidArray(ids)}) and deal_id = ${uuidLit(W.id)};`);
  }
  // S4 desfeito: remove só as chaves acrescentadas, se ainda estão com o valor que o script pôs.
  for (const [k, v] of Object.entries(par.passos.camposAdicionados ?? {})) {
    s.push(`  update public.deals set custom_fields = custom_fields - ${lit(k)} where id = ${uuidLit(W.id)} and custom_fields -> ${lit(k)} = ${jsonLit(v)};`);
  }
  // nota do AC4 sai (é a única linha que o script criou).
  s.push(`  delete from public.activities where id = ${uuidLit(par.notaId)};`);

  if (par.tipo === 'A') {
    const CL = par.contatoLp;
    const CW = par.contatoWa;
    // 2. (o card já voltou ao contato da LP no passo 0) contato da LP restaurado; e-mail e nome do sobrevivente ao valor anterior.
    s.push(`  update public.contacts set merged_into_id = ${lit(CL.merged_into_id)}, deleted_at = ${lit(CL.deleted_at)}, updated_at = now() where id = ${uuidLit(CL.id)};`);
    // o que o merge_contacts moveu do contato da LP (conversas, activities, ai_*, leads, webhook_events_in) volta, por id.
    for (const g of linhasFk.filter((x) => x.alvo === 'contacts')) {
      if (g.tabela === 'deals' || g.tabela === 'contact_merge_log' || g.tabela.includes('.')) continue;
      const ids = (g.linhas ?? []).filter((r) => r[g.coluna] === CL.id && r.id).map((r) => r.id);
      if (ids.length) s.push(`  update public.${ident(g.tabela)} set ${ident(g.coluna)} = ${uuidLit(CL.id)} where id = any(${uuidArray(ids)}) and ${ident(g.coluna)} = ${uuidLit(CW.id)};`);
    }
    // activities que o cascade_contact_delete marcou ao excluir o contato da LP: só as que no backup estavam vivas.
    const acts = (linhasFk.find((g) => g.alvo === 'contacts' && g.tabela === 'activities')?.linhas ?? []).filter((r) => r.contact_id === CL.id && !r.deleted_at).map((r) => r.id);
    if (acts.length) s.push(`  update public.activities set deleted_at = null where id = any(${uuidArray(acts)});`);
    s.push(`  update public.contacts set email = ${lit(CW.email)}, updated_at = now() where id = ${uuidLit(CW.id)} and email is not distinct from ${lit(CL.email)} and email is distinct from ${lit(CW.email)};`);
    if (par.passos.renomear) {
      s.push(`  update public.contacts set name = ${lit(CW.name)}, updated_at = now() where id = ${uuidLit(CW.id)} and name = ${lit(String(CL.name).trim())};`);
    }
    // 4. contact_merge_log NÃO é apagado (trilha de auditoria, decisão de 04/08).
  }
  // Reversão: títulos de volta ao backup (o trigger de nome reescreveu na ida, N1, e pode reescrever na volta).
  s.push(`  update public.deals set title = ${lit(W.title)} where id = ${uuidLit(W.id)} and title is distinct from ${lit(W.title)};`);
  s.push(`  update public.deals set title = ${lit(L.title)} where id = ${uuidLit(L.id)} and title is distinct from ${lit(L.title)};`);
  return `/* 2.62:reversao:${prefixo(L.id)} */
do $rev262$
begin
${s.join('\n')}
end
$rev262$;`;
}

/** Read-back da reversão: cada campo tocado de volta ao valor do backup. */
export function conferirReversao(par, depois) {
  const erros = [];
  const L = (depois.cartoes ?? []).find((c) => c.id === par.perdedor.id);
  if (!L) return [`${par.nome}: card juntado não encontrado`];
  if ((L.deleted_at ?? null) !== (par.perdedor.deleted_at ?? null)) erros.push('deleted_at do card juntado não voltou');
  if (L.title !== par.perdedor.title) erros.push('título do card juntado não voltou');
  if ((depois.notas ?? []).some((n) => n.id === par.notaId)) erros.push('nota do AC4 ainda existe');
  if (par.tipo === 'A') {
    if (L.contact_id !== par.contatoLp.id) erros.push('card não voltou ao contato da LP');
    const CL = (depois.contatos ?? []).find((c) => c.id === par.contatoLp.id);
    const CW = (depois.contatos ?? []).find((c) => c.id === par.contatoWa.id);
    if (!CL || CL.merged_into_id || CL.deleted_at) erros.push('contato da LP não foi restaurado');
    if (!CW || CW.email !== par.contatoWa.email) erros.push('e-mail do contato do WhatsApp não voltou');
    if (!CW || CW.name !== par.contatoWa.name) erros.push('nome do contato do WhatsApp não voltou');
  }
  const W = (depois.cartoes ?? []).find((c) => c.id === par.sobrevivente.id);
  if (!W || W.title !== par.sobrevivente.title) erros.push('título do sobrevivente diferente do backup');
  return erros.map((e) => `${par.nome}: ${e}`);
}

// ---------------------------------------------------------------------------------------------
// Orquestração
// ---------------------------------------------------------------------------------------------
export function lerArgs(argv) {
  const a = { escrever: false, excluir: false, ensaio: false, reverter: null, dirBackup: DIR_BACKUP_PADRAO, ajuda: false };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--execute' || x === '--apply') a.escrever = true;
    else if (x === '--excluir-perdedores') a.excluir = true;
    else if (x === '--ensaio') a.ensaio = true;
    else if (x === '--dry-run') a.escrever = false;
    else if (x === '--reverter' || x === '--revert') a.reverter = argv[++i] ?? null;
    else if (x === '--dir-backup') a.dirBackup = argv[++i] ?? a.dirBackup;
    else if (x === '-h' || x === '--help') a.ajuda = true;
    else throw new Error(`argumento desconhecido: ${x}`);
  }
  if (a.ensaio && a.escrever) throw new Error('--ensaio e --execute são exclusivos');
  if (a.reverter === '') throw new Error('--reverter exige o caminho do backup.json');
  return a;
}

function descreverPar(par) {
  const p = par.passos;
  const filhas = Object.entries(p.moverFilhas).filter(([, n]) => n > 0).map(([t, n]) => `${t}:${n}`).join(' ') || 'nenhuma';
  const contato = par.tipo === 'A'
    ? `contato LP ${prefixo(par.contatoLp.id)} (${mascararNome(par.contatoLp.name)}, ${mascararTelefone(par.contatoLp.phone)}, ${mascararEmail(par.contatoLp.email)}) ⇒ WhatsApp ${prefixo(par.contatoWa.id)} (${mascararTelefone(par.contatoWa.phone)})`
    : `contato ${prefixo(par.contato.id)} (o mesmo nos dois cards)`;
  return [
    `  ${par.nome}  [${par.estado}]`,
    `    fica:   ${prefixo(par.sobrevivente.id)} — ${par.sobrevivente.etapa} (order ${par.sobrevivente.ordem})`,
    `    junta:  ${prefixo(par.perdedor.id)} — ${par.perdedor.etapa} (order ${par.perdedor.ordem})`,
    `    ${contato}`,
    `    passos: mesclar=${p.mesclar} renomear(P5)=${p.renomear} filhas=${filhas} campos+=${Object.keys(p.camposAdicionados).join(',') || 'nenhum'} nota=${p.nota} excluir(AC5)=${p.excluir}${p.empate ? ' EMPATE de etapa (soft delete antes da mescla)' : ''}`,
  ].join('\n');
}

export async function executar({ q, args, log = console.log, agora = () => new Date(), fsImpl = fs, checkIgnore = checarIgnoradoPeloGit, scriptPath = fileURLToPath(import.meta.url) }) {
  log(`Story 2.62 — modo: ${args.reverter ? 'REVERSÃO' : args.ensaio ? 'ENSAIO (abortado pelo Postgres)' : args.escrever ? 'ESCRITA' : 'DRY-RUN (nada é escrito)'}${args.excluir ? ' + excluir perdedores (AC5)' : ''}`);

  // P4: o profile do Filipe vem do banco, não do código.
  const perfis = await q(sqlPerfil());
  if (perfis.length !== 1) {
    log(`PARADO: esperava 1 profile para o e-mail do Filipe, achei ${perfis.length}.`);
    return { codigo: 2 };
  }
  const perfil = perfis[0];
  log(`profile do Filipe: ${prefixo(perfil.id)}`);

  if (args.reverter) return reverter({ q, args, log, fsImpl, perfil });

  const fkLista = await q(sqlFkLista());
  const antes = await medir(q, ESPERADO, fkLista);
  const av = avaliar(antes, ESPERADO, { excluir: args.excluir });
  const orgs = new Set(av.pares.map((p) => p.sobrevivente.organization_id));
  if (orgs.size && (orgs.size !== 1 || !orgs.has(perfil.organization_id))) av.divergencias.push('o profile do Filipe não é da organização dos cards');

  log(`\nAC0 (d) cards abertos em "Lead novo": ${av.leadNovo}`);
  log(`AC0 (c) tabelas com FK para deals/contacts lidas do banco: ${fkLista.length}`);
  for (const a of av.avisos) log(`  aviso: ${a}`);
  if (av.divergencias.length) {
    log(`\nPARADO no AC0 — o banco não bate com a lista de ${DATA_DA_LISTA} (P2: qualquer diferença => perguntar ao Filipe). Nada foi escrito.`);
    for (const d of av.divergencias) log(`  - ${d}`);
    return { codigo: 2, divergencias: av.divergencias };
  }
  log(`AC0 OK: ${av.pares.filter((p) => p.tipo === 'A').length} pares A + ${av.pares.filter((p) => p.tipo === 'B').length} pares B (cards que saem), iguais a ${DATA_DA_LISTA}.\n\nPlano:`);
  for (const par of av.pares) log(descreverPar(par));

  const comTrabalho = av.pares.filter(temTrabalho);
  if (!comTrabalho.length) {
    log('\nNada a fazer: todos os pares já estão no estado final (idempotência).');
    return { codigo: 0, pares: av.pares, escritas: 0 };
  }
  // Par A em empate de etapa só pode ser juntado com o soft delete no mesmo bloco (ver sqlDoPar):
  // sem --excluir-perdedores ele quebraria no trigger check_deal_duplicate. Decisão: exigir as duas flags juntas.
  const empatados = comTrabalho.filter((p) => p.passos.empate);
  if (empatados.length && !args.excluir) {
    const msg = `${empatados.length} par(es) A em empate de etapa (${empatados.map((p) => prefixo(p.perdedor.id)).join(', ')}) só podem ser juntados com --excluir-perdedores (trigger check_deal_duplicate).`;
    if (!args.escrever && !args.ensaio) log(`\naviso: ${msg}`);
    else {
      log(`\nPARADO: ${msg} Nada foi escrito.`);
      return { codigo: 2, pares: av.pares, escritas: 0 };
    }
  }
  if (!args.escrever && !args.ensaio) {
    log(`\nDRY-RUN: ${comTrabalho.length} par(es) com trabalho. Nada foi escrito.`);
    log('Para valer: --execute (AC1–AC4) e --execute --excluir-perdedores (com AC5).');
    return { codigo: 0, pares: av.pares, escritas: 0 };
  }

  const agoraIso = agora().toISOString();
  if (args.ensaio) {
    let falhas = 0;
    for (const par of comTrabalho) {
      try {
        await q(sqlDoPar(par, { perfilId: perfil.id, agoraIso, ensaio: true }));
        log(`  ${par.nome}: ERRO — o ensaio deveria ter abortado. NÃO CONFIAR.`);
        falhas++;
      } catch (e) {
        const ok = String(e.message).includes(MARCA_ENSAIO);
        log(`  ${par.nome}: ${ok ? 'ensaio OK (desfeito pelo Postgres)' : `FALHOU — ${String(e.message).slice(0, 300)}`}`);
        if (!ok) falhas++;
      }
    }
    log(falhas ? `\nENSAIO com ${falhas} falha(s). Nada foi escrito.` : '\nENSAIO OK em todos os pares. Nada foi escrito.');
    return { codigo: falhas ? 5 : 0, pares: av.pares, escritas: 0 };
  }

  // AC1 — backup antes de tocar em qualquer linha.
  const stamp = agoraIso.replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
  const dir = path.join(args.dirBackup, `2.62-${stamp}`);
  const arquivo = path.join(dir, 'backup.json');
  const ig = checkIgnore(arquivo);
  if (!ig.ok) {
    log(`PARADO no AC1: ${ig.motivo}. Nada foi escrito.`);
    return { codigo: 2 };
  }
  const linhas = doc(await q(sqlBackup(comTrabalho, fkLista)));
  const conteudo = { story: '2.62', criadoEm: agoraIso, perfilId: perfil.id, excluir: args.excluir, pares: comTrabalho, antes, linhas };
  fsImpl.mkdirSync(dir, { recursive: true });
  fsImpl.writeFileSync(arquivo, JSON.stringify(conteudo, null, 2), 'utf8');
  fsImpl.copyFileSync(scriptPath, path.join(dir, path.basename(scriptPath))); // restaurador junto do backup
  const relido = JSON.parse(fsImpl.readFileSync(arquivo, 'utf8'));
  const cb = conferirBackup(relido, comTrabalho);
  if (cb.erros.length) {
    log('PARADO no AC1 — o backup relido não confere:');
    for (const e of cb.erros) log(`  - ${e}`);
    return { codigo: 3 };
  }
  log(`\nAC1 backup: ${arquivo} (${ig.motivo}) — relido: ${cb.resumo.cards} cards, ${cb.resumo.contatos} contatos.`);

  const webhookAntes = somaFk(antes, 'webhook_events_out', av.pares.flatMap((p) => [p.perdedor.id, p.sobrevivente.id]));
  let medida = antes;
  const resultados = [];
  for (const par of comTrabalho) {
    try {
      await q(sqlDoPar(par, { perfilId: perfil.id, agoraIso }));
    } catch (e) {
      log(`  ${par.nome}: FALHOU, transação desfeita — ${String(e.message).slice(0, 300)}`);
      resultados.push({ par: par.nome, ok: false, erro: String(e.message).slice(0, 300) });
      fsImpl.writeFileSync(path.join(dir, 'execucao.json'), JSON.stringify(resultados, null, 2), 'utf8');
      return { codigo: 3, backup: arquivo, resultados };
    }
    const depois = await medir(q, ESPERADO, fkLista);
    const erros = conferirPar(par, medida, depois, { perfilId: perfil.id });
    const tituloLido = (depois.cartoes ?? []).find((c) => c.id === par.sobrevivente.id)?.title ?? null;
    const tituloMudou = tituloLido !== par.sobrevivente.title;
    resultados.push({ par: par.nome, ok: !erros.length, erros, tituloAntes: par.sobrevivente.title, tituloLido });
    if (erros.length) {
      log(`  ${par.nome}: READ-BACK REPROVOU — tentado, NÃO confirmado:`);
      for (const e of erros) log(`    - ${e}`);
      fsImpl.writeFileSync(path.join(dir, 'execucao.json'), JSON.stringify(resultados, null, 2), 'utf8');
      return { codigo: 3, backup: arquivo, resultados };
    }
    log(`  ${par.nome}: feito e confirmado por read-back.${tituloMudou ? ` Título do sobrevivente reescrito pelo trigger (N1), lido de volta: ${mascararNome(tituloLido)}` : ''}`);
    medida = depois;
  }

  // AC5/AC6 (a) — sem disparo para o n8n e contagem do Lead novo.
  const webhookDepois = somaFk(medida, 'webhook_events_out', av.pares.flatMap((p) => [p.perdedor.id, p.sobrevivente.id]));
  const excluidosNoLeadNovo = comTrabalho.filter((p) => p.passos.excluir && String(p.perdedor.stage_id).startsWith(LEAD_NOVO_PREFIXO)).length;
  const leadNovoEsperado = av.leadNovo - excluidosNoLeadNovo;
  const final = { webhookAntes, webhookDepois, leadNovoAntes: av.leadNovo, leadNovoEsperado, leadNovoLido: Number(medida.lead_novo) };
  log(`\nwebhook_events_out dos cards: antes ${webhookAntes}, depois ${webhookDepois}${webhookAntes === webhookDepois ? ' (nenhum disparo novo)' : ' — DIVERGIU'}`);
  log(`Lead novo: antes ${av.leadNovo}, esperado ${leadNovoEsperado}, lido ${final.leadNovoLido}${final.leadNovoLido === leadNovoEsperado ? '' : ' — difere (base viva? conferir)'}`);
  fsImpl.writeFileSync(path.join(dir, 'execucao.json'), JSON.stringify({ resultados, final }, null, 2), 'utf8');
  const codigo = webhookAntes === webhookDepois ? 0 : 3;
  return { codigo, backup: arquivo, resultados, final, pares: av.pares, escritas: comTrabalho.length };
}

async function reverter({ q, args, log, fsImpl, perfil }) {
  const backup = JSON.parse(fsImpl.readFileSync(args.reverter, 'utf8'));
  if (backup.story !== '2.62' || !Array.isArray(backup.pares)) {
    log('PARADO: o arquivo não é um backup da 2.62.');
    return { codigo: 2 };
  }
  log(`backup de ${backup.criadoEm}: ${backup.pares.length} par(es).`);
  for (const par of backup.pares) log(`  ${par.nome}: devolver ${prefixo(par.perdedor.id)}; apagar nota ${prefixo(par.notaId)}${par.tipo === 'A' ? `; restaurar contato ${prefixo(par.contatoLp.id)}` : ''}`);
  if (!args.escrever) {
    log('\nDRY-RUN da reversão. Nada foi escrito. Para valer: --reverter <arquivo> --execute');
    return { codigo: 0 };
  }
  const fkLista = await q(sqlFkLista());
  for (const par of [...backup.pares].reverse()) {
    try {
      await q(sqlReversaoDoPar(par, backup));
    } catch (e) {
      log(`  ${par.nome}: reversão FALHOU, transação desfeita — ${String(e.message).slice(0, 300)}`);
      return { codigo: 3 };
    }
    const depois = await medir(q, ESPERADO, fkLista);
    const erros = conferirReversao(par, depois);
    if (erros.length) {
      log(`  ${par.nome}: READ-BACK da reversão REPROVOU:`);
      for (const e of erros) log(`    - ${e}`);
      return { codigo: 3 };
    }
    log(`  ${par.nome}: revertido e confirmado por read-back.`);
  }
  log('Reversão concluída. contact_merge_log mantido (trilha). Registrar no Change Log da story.');
  return { codigo: 0 };
}

async function main() {
  let args;
  try {
    args = lerArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  if (args.ajuda) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 10).join('\n'));
    return;
  }
  let token;
  try {
    token = lerToken();
  } catch (e) {
    console.error(e.message);
    process.exit(e.codigo ?? 4);
  }
  const q = criarCliente({ token });
  try {
    const r = await executar({ q, args });
    process.exit(r.codigo);
  } catch (e) {
    console.error(`ERRO: ${String(e.message).split(token).join('[token]')}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url.toLowerCase() === pathToFileURL(path.resolve(process.argv[1])).href.toLowerCase()) {
  await main();
}
