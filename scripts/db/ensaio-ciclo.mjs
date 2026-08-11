#!/usr/bin/env node
// AC2 da story 2.24 — ENSAIO DO CICLO COMPLETO, abortado pelo proprio Postgres.
//
//   apaga os 431  ->  mede  ->  restaura do backup  ->  mede  ->  RAISE EXCEPTION
//
// Tudo dentro de DO $$ ... $$. O RAISE aborta o bloco NO BANCO; nao depende de a
// camada HTTP honrar transacao (BEGIN/ROLLBACK solto persistiria se o transporte
// abrisse conexao nova). Se este ensaio nao voltar "CICLO OK", o DELETE nao sai.
import fs from 'node:fs';
import path from 'node:path';

const REF = 'jmjhtprnxjffaqhdzfmc';
const TOKEN = fs
  .readFileSync('C:/Users/filip_mg5w2c4/.credenciais/supabase-crm-mgmt.token', 'utf8')
  .trim();

const DIR = process.argv[2];
if (!DIR) { console.error('uso: node ensaio-ciclo.mjs <pasta-do-backup>'); process.exit(1); }

const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const deals = JSON.parse(fs.readFileSync(path.join(DIR, 'deals-julho.json'), 'utf8'));
const acts = JSON.parse(fs.readFileSync(path.join(DIR, 'activities-cascata.json'), 'utf8'));

const sql = `
do $ensaio$
declare
  v_del_deals int; v_del_acts int;
  v_pos_del_total int; v_pos_del_agosto int; v_pos_del_acts int;
  v_pos_res_total int; v_pos_res_julho int; v_pos_res_acts int;
  v_contatos int; v_msgs int;
begin
  select count(*) into v_del_deals from deals where deleted_at is not null;
  select count(*) into v_del_acts  from activities a join deals d on d.id=a.deal_id where d.deleted_at is not null;

  -- 1) APAGA (com a cascata real do schema)
  delete from deals where deleted_at is not null;

  select count(*) into v_pos_del_total  from deals;
  select count(*) into v_pos_del_agosto from deals where deleted_at is null;
  select count(*) into v_pos_del_acts   from activities;

  -- 2) RESTAURA a partir do arquivo de backup
  insert into deals
  select * from jsonb_populate_recordset(null::deals, ${lit(JSON.stringify(deals))}::jsonb)
  on conflict (id) do nothing;

  insert into activities
  select * from jsonb_populate_recordset(null::activities, ${lit(JSON.stringify(acts))}::jsonb)
  on conflict (id) do nothing;

  select count(*) into v_pos_res_total from deals;
  select count(*) into v_pos_res_julho from deals where deleted_at is not null;
  select count(*) into v_pos_res_acts  from activities;

  select count(*) into v_contatos from contacts;
  select count(*) into v_msgs     from messaging_messages;

  raise exception
    'CICLO OK | alvo: % deals + % acts | APOS DELETE: total=% agosto=% acts=% | APOS RESTAURAR: total=% julho=% acts=% | intactos: contatos=% msgs=% | TUDO DESFEITO',
    v_del_deals, v_del_acts,
    v_pos_del_total, v_pos_del_agosto, v_pos_del_acts,
    v_pos_res_total, v_pos_res_julho, v_pos_res_acts,
    v_contatos, v_msgs;
end
$ensaio$;`;

const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
});
const body = await res.text();

if (res.ok) {
  console.error('ERRO GRAVE: o ensaio NAO lancou excecao. Pode ter persistido. NAO PROSSEGUIR.');
  console.error(body);
  process.exit(5);
}
const m = body.match(/CICLO OK[^"\\]*/);
if (!m) {
  console.error('ensaio FALHOU (nao chegou ao fim):\n' + body);
  process.exit(6);
}
console.log('\n' + m[0].replace(/ \| /g, '\n  ') + '\n');
console.log('ensaio abortado pelo Postgres — nada persistiu.');
