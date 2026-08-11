#!/usr/bin/env node
// AC1 da story 2.24 — backup COMPLETO dos leads de julho antes da exclusao fisica.
// Somente leitura. Grava em C:\Users\filip_mg5w2c4\.dados-leads\ (fora de repo — PII, Art. 11).
import fs from 'node:fs';
import path from 'node:path';

const REF = 'jmjhtprnxjffaqhdzfmc';
const TOKEN = fs
  .readFileSync('C:/Users/filip_mg5w2c4/.credenciais/supabase-crm-mgmt.token', 'utf8')
  .trim();

const STAMP = process.argv[2];
if (!STAMP) {
  console.error('uso: node backup-julho.mjs <YYYY-MM-DD-HH-MM>');
  process.exit(1);
}
const DEST = path.join('C:/Users/filip_mg5w2c4/.dados-leads', `crm-julho-pre-delete-${STAMP}`);

async function q(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${body}`);
  return JSON.parse(body);
}

function toCsv(rows) {
  if (!rows.length) return '';
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(';'), ...rows.map((r) => cols.map((c) => esc(r[c])).join(';'))].join('\n');
}

fs.mkdirSync(DEST, { recursive: true });

// O predicado do backup e EXATAMENTE o predicado do DELETE. Se divergirem,
// o backup cobre um conjunto e a exclusao apaga outro.
const ALVO = 'deleted_at is not null';

const conjuntos = {
  // O que SERA apagado
  'deals-julho': `select * from deals where ${ALVO} order by created_at`,
  'activities-cascata': `select a.* from activities a join deals d on d.id = a.deal_id where d.${ALVO} order by a.created_at`,
  // O que NAO sera apagado, mas ancora a restauracao
  'contacts-ancora': `select c.* from contacts c where c.id in (select contact_id from deals where ${ALVO}) order by c.created_at`,
  'conversas-ancora': `select mc.* from messaging_conversations mc where mc.contact_id in (select contact_id from deals where ${ALVO}) order by mc.created_at`,
};

const resumo = { stamp: STAMP, destino: DEST, predicado: ALVO, conjuntos: {} };

for (const [nome, sql] of Object.entries(conjuntos)) {
  const rows = await q(sql);
  fs.writeFileSync(path.join(DEST, `${nome}.json`), JSON.stringify(rows, null, 2), 'utf8');
  fs.writeFileSync(path.join(DEST, `${nome}.csv`), toCsv(rows), 'utf8');
  resumo.conjuntos[nome] = rows.length;
  console.log(`  ${nome.padEnd(22)} ${String(rows.length).padStart(5)} linhas`);
}

// Conferencia independente: reconta no banco e compara com o que foi gravado.
const [chk] = await q(
  `select (select count(*) from deals where ${ALVO}) as deals,
          (select count(*) from activities a join deals d on d.id=a.deal_id where d.${ALVO}) as activities,
          (select count(*) from contacts) as contatos_total,
          (select count(*) from messaging_messages) as mensagens_total,
          (select count(*) from deals) as deals_total`
);
resumo.conferencia_banco = chk;
resumo.ok =
  chk.deals === resumo.conjuntos['deals-julho'] &&
  chk.activities === resumo.conjuntos['activities-cascata'];

fs.writeFileSync(path.join(DEST, 'RESUMO.json'), JSON.stringify(resumo, null, 2), 'utf8');

console.log('\n--- conferencia contra o banco ---');
console.log(JSON.stringify(chk, null, 2));
console.log(`\nbackup ${resumo.ok ? 'OK — arquivo bate com o banco' : 'DIVERGENTE — NAO PROSSEGUIR'}`);
console.log(`destino: ${DEST}`);
process.exit(resumo.ok ? 0 : 4);
