#!/usr/bin/env node
// Aplica UM arquivo de migracao contra o Supabase do CRM, seguindo o contrato
// de escrita segura do README desta pasta.
//
//   node scripts/db/aplicar-migracao.mjs <arquivo.sql>                # DRY-RUN
//   node scripts/db/aplicar-migracao.mjs <arquivo.sql> --eu-autorizo  # escreve
//
// POR QUE ELE EXISTE: `supabase/migrations/` NAO e a fonte da verdade neste
// projeto — a tabela `schema_migrations` nem existe, e repo e banco podem
// divergir sem aviso (pendencia nº 14 de 04/08). Aplicar migracao na mao, sem
// read-back, e como o repo chegou nesse estado.
//
// O QUE ELE RECUSA, de proposito:
//   - qualquer migracao que contenha DROP ou TRUNCATE. Esta ferramenta e para
//     mudanca ADITIVA. Remocao destrutiva merece procedimento proprio, com
//     backup, e nao deve caber num utilitario de rotina.
//
// READ-BACK: depois de escrever, ele RELE do `information_schema` as colunas
// que a migracao diz criar e compara. "A API respondeu 200" nao e prova de
// nada — e a Rule 7 do Meta Ads valendo dentro do banco.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REF = 'jmjhtprnxjffaqhdzfmc';

// Mesma correcao do `sql-ro.mjs`: o caminho estava cravado no home e o token
// real vive no workspace => ENOENT em toda maquina que nao fosse a original.
const CANDIDATOS = [
  process.env.SUPABASE_CRM_MGMT_TOKEN_FILE,
  path.join(os.homedir(), 'grupo-acreditando', '.credenciais', 'supabase-crm-mgmt.token'),
  path.join(os.homedir(), '.credenciais', 'supabase-crm-mgmt.token'),
].filter(Boolean);

const arquivoDoToken = CANDIDATOS.find(p => fs.existsSync(p));
if (!arquivoDoToken && !process.env.SUPABASE_CRM_MGMT_TOKEN) {
  console.error('Token nao encontrado. Procurei em:\n  ' + CANDIDATOS.join('\n  '));
  process.exit(4);
}

const TOKEN = (
  process.env.SUPABASE_CRM_MGMT_TOKEN ?? fs.readFileSync(arquivoDoToken, 'utf8')
).trim();

const arquivo = process.argv[2];
const autorizado = process.argv.includes('--eu-autorizo');

if (!arquivo) {
  console.error('uso: node aplicar-migracao.mjs <arquivo.sql> [--eu-autorizo]');
  process.exit(1);
}

const sql = fs.readFileSync(arquivo, 'utf8');

// Remove COMENTARIOS antes de procurar verbo destrutivo.
//
// POR QUE (2026-08-12): a trava recusou uma migracao que nao continha DROP
// nenhum — a palavra aparecia so em comentarios explicando POR QUE aquele DROP
// nao estava sendo usado. Falso positivo, e o incentivo que ele cria e pessimo:
// a saida facil e reescrever o comentario para enganar a trava, o que apaga
// justamente a documentacao mais valiosa do arquivo.
//
// Isto NAO afrouxa o controle. DROP em codigo continua bloqueado exatamente
// como antes; o que mudou e que a trava passou a olhar so o codigo. Mesma
// direcao do endurecimento do `sql-ro.mjs` em 11/08 (que aprendeu a pegar verbo
// colado em `_`): a trava fica mais PRECISA, nao mais permissiva.
//
// ⚠️ Limite conhecido: um `--` dentro de string literal seria tratado como
// comentario. Nenhuma migracao deste repo faz isso, e o erro cairia para o lado
// seguro apenas se a string contivesse "drop" — caso em que vale rever a mao.
function semComentarios(texto) {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, ' ')  // bloco /* ... */
    .replace(/--[^\n]*/g, ' ');          // linha  -- ...
}

// Trava: esta ferramenta nao remove nada.
const DESTRUTIVO = /(^|[^a-z])(drop|truncate)([^a-z0-9]|$)/i;
const d = semComentarios(sql).match(DESTRUTIVO);
if (d) {
  console.error(`BLOQUEADO: verbo destrutivo "${d[2]}" — use procedimento proprio, com backup.`);
  process.exit(2);
}

async function query(q) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}\n${body}`);
  return JSON.parse(body);
}

// As colunas que a migracao PROMETE criar — extraidas do proprio SQL, para o
// read-back nao depender de eu digitar a lista de novo (e errar).
const promessas = [
  ...sql.matchAll(/ALTER\s+TABLE\s+(?:public\.)?(\w+)[\s\S]*?ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+(\w+)/gi),
].map(([, tabela, coluna]) => ({ tabela, coluna }));

async function lerColunas() {
  if (promessas.length === 0) return [];
  const filtros = promessas
    .map((p) => `(table_name = '${p.tabela}' and column_name = '${p.coluna}')`)
    .join(' or ');
  return query(
    `select table_name, column_name, data_type from information_schema.columns
     where table_schema = 'public' and (${filtros}) order by table_name, column_name`
  );
}

console.log(`Arquivo: ${path.basename(arquivo)}`);
console.log(`Colunas prometidas: ${promessas.map((p) => `${p.tabela}.${p.coluna}`).join(', ') || '(nenhuma detectada)'}`);

const antes = await lerColunas();
console.log(`\nANTES — colunas ja existentes: ${antes.length}`);
for (const c of antes) console.log(`  ${c.table_name}.${c.column_name} (${c.data_type})`);

if (!autorizado) {
  console.log('\nDRY-RUN. Nada foi escrito. Repita com --eu-autorizo para aplicar.');
  process.exit(0);
}

console.log('\nAplicando...');
await query(sql);

// READ-BACK — com uma pergunta capaz de reprovar: se a coluna nao nascer, a
// contagem nao bate e o processo sai com erro.
const depois = await lerColunas();
console.log(`\nDEPOIS — colunas existentes: ${depois.length} de ${promessas.length} prometidas`);
for (const c of depois) console.log(`  ${c.table_name}.${c.column_name} (${c.data_type})`);

if (depois.length !== promessas.length) {
  console.error('\nFALHOU: o read-back nao encontrou todas as colunas prometidas.');
  process.exit(4);
}

console.log('\nOK — read-back confere: todas as colunas prometidas existem no banco.');
