#!/usr/bin/env node
// AC5 da story 2.26 — normalizar as grafias de "distancia" em deals.loss_reason.
//
//   node normalizar-motivos.mjs                 -> BACKUP + ENSAIO (nada persiste)
//   node normalizar-motivos.mjs --eu-autorizo   -> executa
//
// Escopo deliberado: só as grafias que são o MESMO motivo puro.
// `distância e parte financeira` NAO entra — sao dois motivos, e loss_reason
// guarda um valor so; agrupar apagaria a parte financeira.
import fs from 'node:fs';
import path from 'node:path';

const REF = 'jmjhtprnxjffaqhdzfmc';
const TOKEN = fs
  .readFileSync('C:/Users/filip_mg5w2c4/.credenciais/supabase-crm-mgmt.token', 'utf8')
  .trim();
const AUTORIZADO = process.argv.includes('--eu-autorizo');
const STAMP = '2026-08-11-15-05';
const DEST = path.join('C:/Users/filip_mg5w2c4/.dados-leads', `crm-motivos-perda-${STAMP}`);

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

// O predicado do backup e o predicado da escrita tem de ser o MESMO conjunto,
// senao o backup cobre uma coisa e a escrita muda outra. Aqui o backup e MAIOR
// de proposito (todos os perdidos), para poder reverter mesmo se eu errar o alvo.
const ALVO = `lower(btrim(loss_reason)) in ('distância', 'distãncia')`;
const CANONICO = 'Distância';

// ---------- BACKUP (sempre, inclusive no ensaio) ----------
const perdidos = await q(
  'select id, title, loss_reason, is_lost, closed_at, updated_at from deals where is_lost = true order by closed_at'
);
fs.mkdirSync(DEST, { recursive: true });
fs.writeFileSync(path.join(DEST, 'deals-perdidos.json'), JSON.stringify(perdidos, null, 2), 'utf8');
fs.writeFileSync(
  path.join(DEST, 'deals-perdidos.csv'),
  ['id;title;loss_reason', ...perdidos.map(r => `${r.id};"${r.title}";"${r.loss_reason ?? ''}"`)].join('\n'),
  'utf8'
);

// Restaurador: devolve loss_reason exatamente como estava, linha a linha.
const restaurar = perdidos
  .filter(r => r.loss_reason !== null)
  .map(r => `update deals set loss_reason = '${String(r.loss_reason).replace(/'/g, "''")}' where id = '${r.id}';`)
  .join('\n');
fs.writeFileSync(path.join(DEST, 'REVERTER.sql'), restaurar + '\n', 'utf8');

console.log(`backup: ${perdidos.length} deals perdidos -> ${DEST}`);
console.log(`         REVERTER.sql com ${perdidos.filter(r => r.loss_reason !== null).length} linhas\n`);

const antes = await q(
  'select loss_reason, count(*) as n from deals where is_lost = true group by 1 order by 2 desc'
);
console.log('ANTES:');
antes.forEach(r => console.log(`  ${String(r.n).padStart(2)}  ${r.loss_reason}`));

// ---------- ENSAIO ou EXECUCAO ----------
if (!AUTORIZADO) {
  const sql = `
    do $ensaio$
    declare v_afetados int; v_canonico int;
    begin
      update deals set loss_reason = '${CANONICO}' where is_lost = true and ${ALVO};
      get diagnostics v_afetados = row_count;
      select count(*) into v_canonico from deals where is_lost = true and loss_reason = '${CANONICO}';
      raise exception 'ENSAIO OK -- linhas alteradas: % -- ficariam com "${CANONICO}": % -- DESFEITO', v_afetados, v_canonico;
    end
    $ensaio$;`;
  try {
    await q(sql);
    console.error('\nERRO: o ensaio deveria ter lancado excecao. NAO CONFIAR.');
    process.exit(5);
  } catch (e) {
    const m = String(e.message).match(/ENSAIO OK[^"\\]*/);
    console.log(`\n${m ? m[0] : e.message}`);
    console.log('\nnada foi escrito. Para valer: --eu-autorizo');
    process.exit(0);
  }
}

console.log('\n>>> ESCRITA AUTORIZADA');
const alterados = await q(
  `update deals set loss_reason = '${CANONICO}' where is_lost = true and ${ALVO} returning id`
);
console.log(`linhas alteradas: ${alterados.length}`);

const depois = await q(
  'select loss_reason, count(*) as n from deals where is_lost = true group by 1 order by 2 desc'
);
console.log('\nDEPOIS:');
depois.forEach(r => console.log(`  ${String(r.n).padStart(2)}  ${r.loss_reason}`));
