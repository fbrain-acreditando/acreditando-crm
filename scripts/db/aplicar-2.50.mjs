#!/usr/bin/env node
/**
 * Aplica a migração da story 2.50 — o arrastar que chama o n8n.
 *
 * POR QUE NÃO É O `aplicar-migracao.mjs` DE ROTINA:
 * o script de rotina recusa SQL com verbos destrutivos, e esta migração usa
 * `CREATE OR REPLACE FUNCTION` em duas funções que já estão em produção. O
 * caminho é este, explícito, com o estado ANTES salvo em `.rollback/`.
 *
 *   node scripts/db/aplicar-2.50.mjs                # DRY-RUN
 *   node scripts/db/aplicar-2.50.mjs --eu-autorizo  # escreve
 *
 * ⚠️ O QUE MAIS IMPORTA NO READ-BACK: as duas funções são SECURITY DEFINER e
 * têm `proconfig` (search_path) aplicado por uma migração POSTERIOR ao arquivo
 * original — `20260221200002_fix_function_search_path.sql`. Um CREATE OR REPLACE
 * que não repita o `SET search_path` ZERA essa configuração em silêncio e
 * reabre o vetor de escalada de privilégio que aquela migração fechou.
 * O read-back abaixo confere isso explicitamente.
 *
 * Estado lido ANTES (2026-09-03), salvo em
 * `.rollback/funcoes-antes-2.50-2026-09-03.json`:
 *   notify_deal_stage_changed .... definer, search_path="",     2881 chars
 *   enfileirar_pontuacao_do_lead . definer, search_path=public, 3381 chars
 *   fila: 102 failed · 64 completed · 8 pending
 */
import fs from 'node:fs';
import path from 'node:path';

const REF = 'jmjhtprnxjffaqhdzfmc';
const ARQUIVO = 'supabase/migrations/20260902100000_o_arrastar_que_chama_o_n8n.sql';

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
  process.exit(0);
}

console.log('Aplicando...');
await sql(migracao);

console.log('\n=== READ-BACK (relido do banco, não da resposta da chamada) ===\n');

// 1. As duas funções: security definer e — o ponto crítico — o search_path.
const fns = await sql(
  `select proname, prosecdef, proconfig, length(prosrc) as chars
     from pg_proc
    where proname like 'notify_deal%' or proname like 'enfileirar_pontuacao%'`
);
for (const f of fns) {
  const cfg = JSON.stringify(f.proconfig);
  const esperado = f.proname.startsWith('notify') ? 'search_path=""' : 'search_path=public';
  const ok = cfg.includes(esperado.replace(/"/g, '\\"')) || cfg.includes(esperado);
  console.log(
    `${f.proname}\n  definer: ${f.prosecdef} | proconfig: ${cfg} | ${f.chars} chars` +
      `\n  search_path preservado? ${ok ? 'SIM ✅' : 'NÃO ❌ — REVERTER'}`
  );
}

// 2. A flag: existe e está desligada?
const flag = await sql(
  `select organization_id, pontuacao_automatica_habilitada
     from organization_settings`
);
console.log('\nflag pontuacao_automatica_habilitada:');
flag.forEach((r) =>
  console.log(
    `  org ${r.organization_id}: ${r.pontuacao_automatica_habilitada}` +
      ` ${r.pontuacao_automatica_habilitada === false ? '✅ (desligada, como decidido)' : '❌ esperado false'}`
  )
);

// 3. Os triggers continuam vivos? (a story proíbe apagá-los)
const trg = await sql(
  `select tgname from pg_trigger
    where tgrelid='public.deals'::regclass and not tgisinternal order by tgname`
);
console.log('\ntriggers em deals (esperado: os 4 originais):');
trg.forEach((t) => console.log('  -', t.tgname));

// 4. Nenhuma etapa teve pontua_lead alterado.
const stages = await sql(
  `select count(*) filter (where pontua_lead) as com_pontua, count(*) as total from board_stages`
);
console.log(
  `\nboard_stages: ${stages[0].com_pontua} de ${stages[0].total} com pontua_lead` +
    ` ${Number(stages[0].com_pontua) === 1 ? '✅ (só Qualificado, inalterado)' : '❌ mudou'}`
);

// 5. Nenhum endpoint cadastrado ainda (Task D fica fora desta aplicação).
const eps = await sql(`select count(*) as n from integration_outbound_endpoints`);
console.log(`endpoints de saída: ${eps[0].n} ${Number(eps[0].n) === 0 ? '✅ (nenhum, como esperado)' : ''}`);
