#!/usr/bin/env node
// =============================================================================
// Story 2.59 — AC9 (T4.1): backfill dos leads do Formulário Meta pelo CSV.
// =============================================================================
//
// Lê o CSV exportado da Meta (UTF-16LE, tabulação) e manda CADA lead para a
// MESMA rota que o n8n usa: POST /api/public/v1/meta-form-leads, com
// `Idempotency-Key: meta-lead:{leadgen_id}`.
//
// 🔒 NADA de dado pessoal na tela ou em log: só CONTAGENS por grupo.
//    Nome, telefone, e-mail, endereço e respostas nunca são impressos — nem em
//    erro (a mensagem de erro do servidor é descartada; fica só o status).
//
// Modos (um por vez):
//
//   --ensaio-banco   (padrão)  SOMENTE LEITURA, direto no banco, pelo executor
//                              `scripts/db/sql-ro.mjs` (trava de verbo de escrita).
//                              Classifica A/B/C sem a rota estar publicada.
//   --ensaio                   Pela rota, com `?ensaio=1` (decide sem gravar).
//                              Exige a rota publicada + CRM_API_URL e CRM_API_KEY.
//   --real --autorizado-lgpd   GRAVA. Só depois do parecer de LGPD (AC11) e da
//                              autorização do Filipe. Exige CRM_API_URL e CRM_API_KEY.
//
// Uso:
//   node scripts/db/backfill-formulario-meta.mjs [--csv <arquivo>] [modo]
//
// CSV padrão: <workspace>/.dados-leads/acreditando-form-meta/leads-2026-09-28.csv
// (fora do repositório, já no .gitignore da raiz do workspace).
//
// Invariantes esperados (AC9, medição de 28/09): A + B = 16 e C = 7 (total 23).
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ORG = '83160646-16a0-4cb7-9067-7ce7ef34ff50';
const BOARD = '5f6bded2-0f7c-418d-9598-7ea75d032242';
const TERMINAIS = [
  'f359ee98-b7b1-460d-a7be-2ef92f92c4c7', // Ganho
  '78defbd3-6ca4-4b96-b67a-2268e7e6dce5', // Perdido
  '3ed212e5-32a9-4bda-8d70-bb8be49e790d', // Clientes
];

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(AQUI, '..', '..');

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const valor = (f) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};

const CSV_PADRAO = path.join(
  os.homedir(),
  'grupo-acreditando',
  '.dados-leads',
  'acreditando-form-meta',
  'leads-2026-09-28.csv'
);
const csvPath = valor('--csv') ?? CSV_PADRAO;

// -----------------------------------------------------------------------------
// CSV → corpo da rota (DETERMINÍSTICO: sem carimbo de hora da execução, AC10)
// -----------------------------------------------------------------------------

/** Colunas que viram campo de topo (não entram em field_data). */
const TOPO = new Set([
  'id', 'created_time', 'ad_id', 'ad_name', 'adset_id', 'adset_name', 'campaign_id', 'campaign_name',
  'form_id', 'form_name', 'is_organic', 'platform', 'lead_status',
]);

const semPrefixo = (v) => String(v ?? '').trim().replace(/^[a-z]{1,3}:/i, '');

export function lerCsv(arquivo) {
  const buf = fs.readFileSync(arquivo);
  const texto = buf.toString('utf16le').replace(/^﻿/, '');
  const linhas = texto.split(/\r?\n/).filter((l) => l.trim() !== '');
  const cab = linhas[0].split('\t').map((c) => c.trim());
  return linhas.slice(1).map((l) => {
    const cel = l.split('\t');
    return Object.fromEntries(cab.map((c, i) => [c, (cel[i] ?? '').trim()]));
  });
}

/** Mesmo formato que o n8n monta a partir da Graph API (field_data ordenado por nome). */
export function corpoDoLead(linha) {
  const field_data = Object.keys(linha)
    .filter((k) => !TOPO.has(k) && linha[k] !== '')
    .sort()
    .map((k) => ({ name: k, values: [k === 'phone_number' ? semPrefixo(linha[k]) : linha[k]] }));
  const corpo = {
    leadgen_id: semPrefixo(linha.id),
    created_time: linha.created_time,
    field_data,
  };
  for (const k of ['form_id', 'campaign_id', 'campaign_name', 'ad_id', 'ad_name']) {
    const v = k.endsWith('_id') ? semPrefixo(linha[k]) : String(linha[k] ?? '').trim();
    if (v) corpo[k] = v;
  }
  return corpo;
}

// -----------------------------------------------------------------------------
// Variantes de telefone — espelho de lib/meta-form/telefone.ts (AC5)
// -----------------------------------------------------------------------------

function variantes(bruto) {
  const s = semPrefixo(bruto);
  const d = s.replace(/\D/g, '');
  if (!d) return [];
  const e164 = `+${d}`;
  const m = e164.match(/^\+55(\d{2})(\d{8,9})$/);
  if (!m) return [e164];
  const [, ddd, n] = m;
  if (n.length === 9 && n.startsWith('9')) return [e164, `+55${ddd}${n.slice(1)}`];
  if (n.length === 8 && /^[6-9]/.test(n)) return [`+55${ddd}9${n}`, e164];
  return [e164];
}

// -----------------------------------------------------------------------------
// Modos
// -----------------------------------------------------------------------------

const lit = (v) => (v === null || v === undefined || v === '' ? 'null' : `'${String(v).replace(/'/g, "''")}'`);

function ensaioBanco(linhas) {
  // Espelha a decisão da rota (processarLead.ts) em SQL de LEITURA:
  // já processado → contato (telefone com/sem 9, depois e-mail; vivo e não
  // mesclado; o mais antigo) → card aberto no quadro (fora dos terminais) ⇒ A;
  // contato sem card aberto ⇒ B; sem contato ⇒ C.
  const valores = linhas
    .map((l) => {
      const [v1, v2] = variantes(l.phone_number);
      const email = (l.email || '').toLowerCase();
      return `(${lit(semPrefixo(l.id))}, ${lit(v1)}, ${lit(v2)}, ${lit(email)})`;
    })
    .join(',\n');

  const terminais = TERMINAIS.map((t) => `'${t}'`).join(',');
  const sql = `with leads(lid, v1, v2, mail) as (values ${valores}),
achados as (
  select l.lid,
    exists(select 1 from deals d where d.organization_id = '${ORG}' and d.deleted_at is null
           and (d.custom_fields->>'metaLeadgenId' = l.lid
                or (d.ai_extracted->'metaFormLeadgenIds') @> jsonb_build_array(l.lid))) as ja,
    coalesce(
      (select c.id from contacts c where c.organization_id = '${ORG}' and c.deleted_at is null
         and c.merged_into_id is null and c.phone in (l.v1, l.v2) order by c.created_at limit 1),
      (select c.id from contacts c where c.organization_id = '${ORG}' and c.deleted_at is null
         and c.merged_into_id is null and l.mail is not null and c.email = l.mail order by c.created_at limit 1)
    ) as cid
  from leads l
),
grupos as (
  select case
    when ja then 'ja_processado'
    when cid is null then 'C_cria_contato_e_card'
    when exists(select 1 from deals d where d.organization_id = '${ORG}' and d.contact_id = achados.cid
                and d.board_id = '${BOARD}' and d.deleted_at is null
                and (d.stage_id is null or d.stage_id not in (${terminais}))) then 'A_completa'
    else 'B_cria_card_contato_existente' end as grupo
  from achados
)
select grupo, count(*)::int as n from grupos group by grupo order by grupo`;

  const r = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'db', 'sql-ro.mjs'), sql], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (r.status !== 0) {
    // 🔒 Não repassa a saída: o erro do servidor pode ecoar a consulta (com telefones).
    console.error(`Consulta de leitura falhou (código de saída ${r.status}). Saída suprimida por conter dado pessoal.`);
    process.exit(3);
  }
  const linhasDeGrupo = JSON.parse(r.stdout);
  return Object.fromEntries(linhasDeGrupo.map((g) => [g.grupo, g.n]));
}

async function viaRota(linhas, { real }) {
  const url = process.env.CRM_API_URL;
  const chave = process.env.CRM_API_KEY;
  if (!url || !chave) {
    console.error('Defina CRM_API_URL (ex.: https://<crm>/api/public/v1) e CRM_API_KEY.');
    process.exit(4);
  }
  const contagem = {};
  for (const l of linhas) {
    const corpo = corpoDoLead(l);
    const headers = { 'content-type': 'application/json', 'x-api-key': chave };
    if (real) headers['idempotency-key'] = `meta-lead:${corpo.leadgen_id}`;
    let rotulo;
    try {
      const res = await fetch(`${url.replace(/\/$/, '')}/meta-form-leads${real ? '' : '?ensaio=1'}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(corpo),
      });
      const body = await res.json().catch(() => ({}));
      // Só a AÇÃO e o CÓDIGO — o corpo inteiro nunca é impresso.
      rotulo = body.acao ? `${res.status} ${body.acao}` : `${res.status} ${body.code ?? 'sem_codigo'}`;
    } catch {
      rotulo = 'erro_de_rede';
    }
    contagem[rotulo] = (contagem[rotulo] ?? 0) + 1;
  }
  return contagem;
}

// -----------------------------------------------------------------------------

async function main() {
  if (!fs.existsSync(csvPath)) {
    console.error('CSV não encontrado no caminho informado.');
    process.exit(2);
  }
  const linhas = lerCsv(csvPath);
  const modo = flag('--real') ? 'real' : flag('--ensaio') ? 'ensaio-rota' : 'ensaio-banco';

  if (modo === 'real' && !flag('--autorizado-lgpd')) {
    console.error(
      'Modo real bloqueado: exige --autorizado-lgpd (parecer de LGPD do AC11 + autorização do Filipe).'
    );
    process.exit(5);
  }

  console.log(`Modo: ${modo} · leads no CSV: ${linhas.length}`);
  const contagem =
    modo === 'ensaio-banco' ? ensaioBanco(linhas) : await viaRota(linhas, { real: modo === 'real' });

  for (const [k, n] of Object.entries(contagem).sort()) console.log(`  ${k}: ${n}`);

  if (modo === 'ensaio-banco') {
    const A = contagem.A_completa ?? 0;
    const B = contagem.B_cria_card_contato_existente ?? 0;
    const C = contagem.C_cria_contato_e_card ?? 0;
    const ja = contagem.ja_processado ?? 0;
    console.log(`  Invariantes (AC9): A + B = ${A + B} (esperado 16) · C = ${C} (esperado 7) · já processados = ${ja}`);
    if (ja === 0 && (A + B !== 16 || C !== 7)) {
      console.log('  ⚠️ Divergência: investigar ANTES do modo real (AC9).');
    }
  }
}

const executadoDireto = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (executadoDireto) await main();
