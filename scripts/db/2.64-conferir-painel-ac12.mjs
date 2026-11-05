#!/usr/bin/env node
// Story 2.64, AC12 — prova SÓ DE LEITURA da lógica nova da Visão Geral em Postgres de verdade.
//
// Monta uma consulta com os MESMOS trechos SQL de `get_metricas_de_atendimento` (Total de
// Leads, Ganhos/Perdidos e funil), lidos do arquivo da migration, sobre linhas SIMULADAS
// (CTEs com o nome das tabelas `deals`, `board_stages` e `boards`). Nada é criado nem gravado:
// o resultado sai pelo executor somente-leitura `sql-ro.mjs`.
//
// Uso (Git Bash), com as etapas reais do quadro + as 2 novas (ordem 14 e 15):
//   STAGES=$(node scripts/db/sql-ro.mjs "select id, name, \"order\" from board_stages where board_id='5f6bded2-0f7c-418d-9598-7ea75d032242' union all select '2f8091f5-90a8-4eae-bd2a-12f0d44b9517'::uuid, 'Produtos de treinamento', 14 union all select '824878b0-2ab4-4c07-81d7-ec367b5ebd68'::uuid, 'Produto vendido', 15" | tr -d '\n')
//   node scripts/db/sql-ro.mjs "$(node scripts/db/2.64-conferir-painel-ac12.mjs supabase/migrations/20261105120000_produtos_de_treinamento.sql "$STAGES")"
//   (controle: o mesmo com supabase/migrations/20260819190000_painel_visao_geral_2_46.sql)
//
// Linhas simuladas: r1 reabilitação aberta · r2 reabilitação perdida · w1 reabilitação ganha ·
// p1 produto em "Produtos de treinamento" · p2 produto em "Produto vendido" · p3 produto em
// "Perdido" · p4 produto em "Ganho" · m1 card SEM o campo, criado à mão na etapa da loja ·
// n1 card sem etapa. Esperado com a 2.64: total 4 (r1, r2, w1, n1), ganhos 1, perdidos 1,
// funil sem as 2 barras da loja e com "Ganho" = 1 e "Perdido" = 1.
import fs from 'node:fs';
const sql = fs.readFileSync(process.argv[2], 'utf8').replace(/\r/g, '');
const corpo = sql.slice(sql.indexOf('as $func$') + 9, sql.lastIndexOf('$func$'))
  .split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
const ORG = "'83160646-16a0-4cb7-9067-7ce7ef34ff50'::uuid";
const sub = (s) => s
  .replace(/v_etapas_da_loja/g, "array['2f8091f5-90a8-4eae-bd2a-12f0d44b9517','824878b0-2ab4-4c07-81d7-ec367b5ebd68']::uuid[]")
  .replace(/p_org_id/g, ORG)
  .replace(/p_start_date/g, "'2026-11-01T00:00:00Z'::timestamptz")
  .replace(/p_end_date/g, "'2026-12-01T00:00:00Z'::timestamptz");
const trecho = (de, ate) => sub(corpo.slice(corpo.indexOf(de), corpo.indexOf(ate)));
const total = trecho('select count(*)\n  into v_total_leads', '\n  select\n    count(*) filter (where t.conversation_id').replace(/into v_total_leads/, '').replace(/;\s*$/, '');
const funil = trecho('select coalesce(jsonb_agg(x order by ordem)', '\n  select\n    count(*) filter (where d.is_won)').replace(/into v_funil/, '').replace(/;\s*$/, '');
const fech = trecho('select\n    count(*) filter (where d.is_won)', '\n  select min(iniciada_em)').replace(/into v_ganhos, v_perdidos/, '').replace('count(*) filter (where d.is_won),', 'count(*) filter (where d.is_won) as ganhos,').replace('count(*) filter (where d.is_lost)', 'count(*) filter (where d.is_lost) as perdidos').replace(/;\s*$/, '');
const B = "'5f6bded2-0f7c-418d-9598-7ea75d032242'::uuid";
const stages = JSON.parse(process.argv[3]);
const st = stages.map((s) => `('${s.id}'::uuid, ${B}, '${s.name.replace(/'/g, "''")}', ${s.order})`).join(',\n');
const PROD = "'2f8091f5-90a8-4eae-bd2a-12f0d44b9517'::uuid", VEND = "'824878b0-2ab4-4c07-81d7-ec367b5ebd68'::uuid";
const QUAL = "'3b1384fa-5fe2-4725-a8e1-7576a8690637'::uuid", PERD = "'78defbd3-6ca4-4b96-b67a-2268e7e6dce5'::uuid", GANHO = "'f359ee98-b7b1-460d-a7be-2ef92f92c4c7'::uuid";
const cf = (o) => o ? `'${JSON.stringify(o)}'::jsonb` : 'null::jsonb';
const T = "'2026-11-03T12:00:00Z'::timestamptz";
const linhas = [
  ['r1-reab-aberto', QUAL, cf({ paraQuemE: 'x' }), 'false', 'false', 'null::timestamptz'],
  ['r2-reab-perdido', PERD, cf({}), 'false', 'true', T],
  ['w1-reab-ganho', GANHO, null, 'true', 'false', T],
  ['p1-prod-produtos', PROD, cf({ produtoDeTreinamento: 'Luvas inclusivas' }), 'false', 'false', 'null::timestamptz'],
  ['p2-prod-vendido', VEND, cf({ produtoDeTreinamento: 'ATS Pró' }), 'false', 'false', 'null::timestamptz'],
  ['p3-prod-perdido', PERD, cf({ produtoDeTreinamento: 'Bolsa impermeável' }), 'false', 'true', T],
  ['p4-prod-ganho', GANHO, cf({ produtoDeTreinamento: 'Faixa de joelho' }), 'true', 'false', T],
  ['m1-manual-na-etapa', PROD, null, 'false', 'false', 'null::timestamptz'],
  ['n1-sem-etapa', 'null::uuid', null, 'false', 'false', 'null::timestamptz'],
].map(([n, s, c, w, l, fe]) => `('${n}', ${ORG}, ${s}, ${c}, null::timestamptz, ${T}, ${fe}, ${w}, ${l})`).join(',\n');
const q = `with board_stages(id, board_id, name, "order") as (values ${st}),
boards(id, organization_id) as (values (${B}, ${ORG})),
deals(id, organization_id, stage_id, custom_fields, deleted_at, created_at, closed_at, is_won, is_lost) as (values ${linhas})
select (${total}) as total_leads,
       (select to_jsonb(f) from (${fech}) f) as fechados,
       (${funil}) as funil`;
process.stdout.write(q);
