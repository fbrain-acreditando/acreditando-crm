#!/usr/bin/env node
// AC3 da story 2.24 — EXCLUSAO FISICA dos leads de julho. IRREVERSIVEL.
// Exige --eu-autorizo explicito em toda chamada.
//
// Predicado seguro por construcao: antes de 10/08 havia ZERO deals com deleted_at,
// e a marcacao foi um UNICO update (carimbo identico nos 431). Logo
// `deleted_at is not null` e exatamente este conjunto, e nada mais.
import fs from 'node:fs';

const REF = 'jmjhtprnxjffaqhdzfmc';
const TOKEN = fs
  .readFileSync('C:/Users/filip_mg5w2c4/.credenciais/supabase-crm-mgmt.token', 'utf8')
  .trim();

if (!process.argv.includes('--eu-autorizo')) {
  console.error('BLOQUEADO: escrita destrutiva exige --eu-autorizo');
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

// Guarda final: remede AGORA. A base e viva (707 -> 724 em 24h). Se o alvo
// divergir do que foi salvo no backup, aborta antes de escrever.
const [antes] = await q(
  `select (select count(*) from deals) as total,
          (select count(*) from deals d where d.deleted_at is not null) as alvo,
          (select count(*) from activities) as activities,
          (select count(*) from contacts) as contatos,
          (select count(*) from messaging_messages) as mensagens`
);
console.log('ANTES: ' + JSON.stringify(antes));

if (antes.alvo !== 431) {
  console.error(`ABORTADO: alvo mudou (${antes.alvo} != 431 do backup). Refazer o backup.`);
  process.exit(2);
}

const apagados = await q(
  'delete from deals where deleted_at is not null returning id'
);
console.log(`\nDELETE executado: ${apagados.length} linhas removidas`);

const [depois] = await q(
  `select (select count(*) from deals) as total,
          (select count(*) from deals d where d.deleted_at is not null) as sobrou_marcado,
          (select count(*) from activities) as activities,
          (select count(*) from contacts) as contatos,
          (select count(*) from messaging_messages) as mensagens`
);
console.log('DEPOIS: ' + JSON.stringify(depois));
