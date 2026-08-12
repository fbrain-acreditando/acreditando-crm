#!/usr/bin/env node
// Executor SOMENTE-LEITURA contra o Supabase do CRM (ref jmjhtprnxjffaqhdzfmc).
// Bloqueia qualquer verbo de escrita ANTES de a query sair da maquina.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REF = 'jmjhtprnxjffaqhdzfmc';

// O caminho do token estava CRAVADO no home do usuario, e o token real vive no
// workspace (`grupo-acreditando/.credenciais/`) => todo script daqui falhava com
// ENOENT nesta maquina. Procurar nos lugares conhecidos, na ordem, e dizer ONDE
// procurou quando nao achar — mensagem de erro que nao diz onde olhou custa uma
// sessao inteira de adivinhacao.
const CANDIDATOS = [
  process.env.SUPABASE_CRM_MGMT_TOKEN_FILE,
  path.join(os.homedir(), 'grupo-acreditando', '.credenciais', 'supabase-crm-mgmt.token'),
  path.join(os.homedir(), '.credenciais', 'supabase-crm-mgmt.token'),
].filter(Boolean);

const arquivo = CANDIDATOS.find(p => fs.existsSync(p));
if (!arquivo && !process.env.SUPABASE_CRM_MGMT_TOKEN) {
  console.error('Token nao encontrado. Procurei em:\n  ' + CANDIDATOS.join('\n  '));
  console.error('Defina SUPABASE_CRM_MGMT_TOKEN ou SUPABASE_CRM_MGMT_TOKEN_FILE.');
  process.exit(4);
}

const TOKEN = (process.env.SUPABASE_CRM_MGMT_TOKEN ?? fs.readFileSync(arquivo, 'utf8')).trim();

const sql = process.argv[2];
if (!sql) {
  console.error('uso: node sql-ro.mjs "<SELECT ...>"');
  process.exit(1);
}

// Trava: pega verbo de escrita mesmo colado em _ ou . (licao do cron.alter_job)
const PROIBIDO =
  /(^|[^a-z])(insert|update|delete|drop|truncate|alter|create|grant|revoke|vacuum|reindex|comment|call|do|copy|refresh|set|reset|begin|commit|rollback|security|lock)([^a-z0-9]|$)/i;
const m = sql.match(PROIBIDO);
if (m) {
  console.error(`BLOQUEADO: verbo de escrita detectado -> "${m[2]}"`);
  process.exit(2);
}
if (!/^\s*(select|with)\b/i.test(sql)) {
  console.error('BLOQUEADO: a query precisa comecar com SELECT ou WITH');
  process.exit(2);
}

const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ query: sql }),
});

const body = await res.text();
if (!res.ok) {
  console.error(`HTTP ${res.status}\n${body}`);
  process.exit(3);
}
console.log(JSON.stringify(JSON.parse(body), null, 2));
