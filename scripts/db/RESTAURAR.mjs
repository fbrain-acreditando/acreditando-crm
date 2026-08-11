#!/usr/bin/env node
// RESTAURADOR da story 2.24 — devolve ao banco os 431 deals de julho e as 11 activities.
//
//   node RESTAURAR.mjs <pasta-do-backup>                 -> DRY-RUN (nao escreve nada)
//   node RESTAURAR.mjs <pasta-do-backup> --eu-autorizo   -> escreve de verdade
//
// Usa jsonb_populate_recordset: o Postgres reconstroi cada coluna com o TIPO
// original (jsonb, arrays, timestamptz). Montar INSERT a mao erraria em algum
// campo e o erro so apareceria no dia em que precisassemos restaurar.
import fs from 'node:fs';
import path from 'node:path';

const REF = 'jmjhtprnxjffaqhdzfmc';
const TOKEN = fs
  .readFileSync('C:/Users/filip_mg5w2c4/.credenciais/supabase-crm-mgmt.token', 'utf8')
  .trim();

const DIR = process.argv[2];
const AUTORIZADO = process.argv.includes('--eu-autorizo');
if (!DIR) {
  console.error('uso: node RESTAURAR.mjs <pasta-do-backup> [--eu-autorizo]');
  process.exit(1);
}

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

const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

const deals = JSON.parse(fs.readFileSync(path.join(DIR, 'deals-julho.json'), 'utf8'));
const acts = JSON.parse(fs.readFileSync(path.join(DIR, 'activities-cascata.json'), 'utf8'));

console.log(`backup lido: ${deals.length} deals · ${acts.length} activities`);

// ON CONFLICT DO NOTHING: restaurar duas vezes nao pode duplicar.
const corpo = `
  insert into deals
  select * from jsonb_populate_recordset(null::deals, ${lit(JSON.stringify(deals))}::jsonb)
  on conflict (id) do nothing;

  insert into activities
  select * from jsonb_populate_recordset(null::activities, ${lit(JSON.stringify(acts))}::jsonb)
  on conflict (id) do nothing;
`;

if (!AUTORIZADO) {
  // DRY-RUN de verdade: roda o INSERT dentro de um bloco que o PROPRIO Postgres
  // aborta. Nao depende de a camada HTTP honrar transacao.
  const sql = `
    do $ensaio$
    declare v_deals int; v_acts int;
    begin
      ${corpo}
      select count(*) into v_deals from deals where deleted_at is not null;
      select count(*) into v_acts  from activities;
      raise exception 'ENSAIO OK -- deals com deleted_at apos restaurar: %, activities: % -- DESFEITO', v_deals, v_acts;
    end
    $ensaio$;`;
  try {
    await q(sql);
    console.error('ERRO: o ensaio deveria ter lancado excecao. NAO CONFIAR.');
    process.exit(5);
  } catch (e) {
    const m = String(e.message).match(/ENSAIO OK[^"\\]*/);
    console.log(m ? `\n${m[0]}` : `\n${e.message}`);
    console.log('\ndry-run concluido — nada foi escrito. Para valer: --eu-autorizo');
    process.exit(0);
  }
}

console.log('\n>>> ESCRITA AUTORIZADA — restaurando...');
await q(corpo);
const [chk] = await q(
  'select (select count(*) from deals) as deals_total, (select count(*) from activities) as activities_total'
);
console.log(JSON.stringify(chk, null, 2));
