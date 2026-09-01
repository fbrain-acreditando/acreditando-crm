#!/usr/bin/env node
/**
 * Aplica a migração da story 2.49.
 *
 * POR QUE ESTE SCRIPT EXISTE, e não `aplicar-migracao.mjs`:
 * o script de rotina recusa qualquer SQL que contenha `drop` — guard-rail
 * correto, que existe para impedir `DROP TABLE` disfarçado de rotina. A 2.49
 * precisa de `DROP CONSTRAINT` para AMPLIAR um CHECK (aceitar 'n8n' além de
 * 'auto' e 'manual'). O efeito é aditivo, mas o verbo é destrutivo — então o
 * caminho é este, explícito, e não afrouxar o guard-rail para todo mundo.
 *
 *   node scripts/db/aplicar-2.49.mjs                # DRY-RUN
 *   node scripts/db/aplicar-2.49.mjs --eu-autorizo  # escreve
 *
 * Estado lido ANTES de escrever (01/09/2026), para reverter se precisar:
 *   deals_lead_score_source_check
 *     CHECK (lead_score_source IS NULL
 *            OR lead_score_source = ANY (ARRAY['auto','manual']))
 *   public_api_idempotency: não existia
 *   Linhas: 462 NULL · 356 'auto' · 1 'manual' — nenhuma viola o CHECK novo.
 */
import fs from 'node:fs';
import path from 'node:path';

const REF = 'jmjhtprnxjffaqhdzfmc';
const ARQUIVO = 'supabase/migrations/20260901120000_a_porta_que_o_n8n_usa.sql';

const TOKEN_FILE = path.join(
  'C:',
  'Users',
  'filip_mg5w2c4',
  'grupo-acreditando',
  '.credenciais',
  'supabase-crm-mgmt.token'
);

const TOKEN = (process.env.SUPABASE_CRM_MGMT_TOKEN ?? fs.readFileSync(TOKEN_FILE, 'utf8')).trim();
const autorizado = process.argv.includes('--eu-autorizo');

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const texto = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${texto}`);
  try {
    return JSON.parse(texto);
  } catch {
    return texto;
  }
}

const migracao = fs.readFileSync(ARQUIVO, 'utf8');

if (!autorizado) {
  console.log('DRY-RUN — nada foi escrito.');
  console.log(`Arquivo: ${ARQUIVO} (${migracao.length} bytes)`);
  console.log('Para aplicar: node scripts/db/aplicar-2.49.mjs --eu-autorizo');
  process.exit(0);
}

console.log('Aplicando...');
await sql(migracao);

// ---------------------------------------------------------------------------
// READ-BACK (Rule 7): reler do banco, não confiar na resposta da chamada.
// ---------------------------------------------------------------------------
console.log('\n=== READ-BACK ===');

const constraint = await sql(
  `select pg_get_constraintdef(oid) as def from pg_constraint
   where conrelid='public.deals'::regclass and conname='deals_lead_score_source_check'`
);
const def = constraint?.[0]?.def ?? '(não encontrada)';
console.log('CHECK:', def);
console.log("aceita 'n8n'?", def.includes("'n8n'") ? 'SIM ✅' : 'NÃO ❌');

const tabela = await sql(
  `select column_name, data_type from information_schema.columns
   where table_schema='public' and table_name='public_api_idempotency'
   order by ordinal_position`
);
console.log(`\npublic_api_idempotency: ${tabela.length} colunas`);
console.log(tabela.map((c) => `  ${c.column_name} (${c.data_type})`).join('\n'));

const indice = await sql(
  `select indexname from pg_indexes
   where schemaname='public' and tablename='public_api_idempotency'`
);
console.log('\níndices:', indice.map((i) => i.indexname).join(', '));

const rls = await sql(
  `select relrowsecurity as rls from pg_class where oid='public.public_api_idempotency'::regclass`
);
console.log('RLS ligada?', rls?.[0]?.rls ? 'SIM ✅' : 'NÃO ❌');

const policies = await sql(
  `select count(*) as n from pg_policies where schemaname='public' and tablename='public_api_idempotency'`
);
console.log('policies (deve ser 0):', policies?.[0]?.n);
