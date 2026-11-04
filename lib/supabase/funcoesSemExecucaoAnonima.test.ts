/**
 * Story 2.69 — funções do banco que rodavam sem login (AC1 e AC4, D3).
 *
 * Lê TODAS as migrations (sem banco), na ordem dos nomes dos arquivos, e falha
 * quando uma função `public` com `SECURITY DEFINER`, que não é de gatilho, não
 * tem `REVOKE … FROM … anon` (pelo nome) no MESMO arquivo ou num arquivo
 * POSTERIOR ao último `CREATE` dela. A única saída é a lista de exceções, com
 * o motivo escrito.
 *
 * Por que a ordem: "tem REVOKE em alguma migration" deixa passar a função
 * revogada e depois recriada — foi o caso da `get_user_org_id()`
 * (`20260224000000:120` revoga, `20260403000000:67` recria). A regra é
 * conservadora de propósito: um `CREATE OR REPLACE` futuro exige repetir o
 * REVOKE.
 *
 * ⚠️ Limite (C7): este teste lê o REPO. Contra a diferença repo × banco (a
 * `20260224000000` nunca rodou em produção), quem protege é o read-back do AC2.
 *
 * Dentro de um mesmo arquivo, as permissões contam depois da estrutura
 * (CREATE/DROP/RENAME), independentemente da linha: a `20260223000000` faz o
 * REVOKE antes do `CREATE OR REPLACE` de funções que já existiam (o Postgres
 * mantém o ACL), e o T0 confirma essas funções fechadas em produção.
 * QA Loop 1 (gate 33, C2): se a função tem DROP no MESMO arquivo, as permissões
 * dela voltam a contar POR LINHA (REVOKE → DROP → CREATE = nasce aberta).
 * Também lidos no QA Loop 1: `GRANT/REVOKE … ON ALL FUNCTIONS IN SCHEMA public`
 * (C1) e `ALTER FUNCTION … SECURITY DEFINER|INVOKER` (C1b).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// ───────────────────────────── leitor de SQL ─────────────────────────────

type Arquivo = { nome: string; sql: string };

type Evento =
  | { tipo: 'create'; ia: number; pos: number; nome: string; sig: string; definer: boolean; gatilho: boolean }
  | { tipo: 'drop'; ia: number; pos: number; nome: string; sig: string | null }
  | { tipo: 'rename'; ia: number; pos: number; nome: string; sig: string | null; novo: string }
  | { tipo: 'seguranca'; ia: number; pos: number; nome: string; sig: string | null; definer: boolean }
  | {
      tipo: 'revoke' | 'grant';
      ia: number;
      pos: number;
      nome: string;
      sig: string | null;
      papeis: string[];
      /** `… ON ALL FUNCTIONS IN SCHEMA public` (nome = '*'). */
      todas?: boolean;
    };

type Funcao = { nome: string; sig: string; definer: boolean; gatilho: boolean; fechada: boolean; criadaEm: string };

/** Tira `-- …` e `/* … *\/` (a palavra "SECURITY DEFINER" em comentário não conta). */
function tirarComentarios(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    if (sql.startsWith('--', i)) {
      const f = sql.indexOf('\n', i);
      i = f < 0 ? sql.length : f;
      continue;
    }
    if (sql.startsWith('/*', i)) {
      const f = sql.indexOf('*/', i + 2);
      i = f < 0 ? sql.length : f + 2;
      continue;
    }
    out += sql[i];
    i++;
  }
  return out;
}

function parenQueFecha(s: string, abre: number): number {
  let d = 0;
  for (let i = abre; i < s.length; i++) {
    if (s[i] === '(') d++;
    else if (s[i] === ')') {
      d--;
      if (d === 0) return i;
    }
  }
  return -1;
}

/** Texto do comando até o `;` final, SEM o corpo ($…$) e sem strings. */
function cabecalhoForaDoCorpo(s: string, de: number): string {
  let i = de;
  let fora = '';
  while (i < s.length) {
    const c = s[i];
    if (c === "'") {
      const f = s.indexOf("'", i + 1);
      i = f < 0 ? s.length : f + 1;
      continue;
    }
    if (c === '$') {
      const m = /^\$[A-Za-z_]*\$/.exec(s.slice(i));
      if (m) {
        const f = s.indexOf(m[0], i + m[0].length);
        fora += ' ';
        i = f < 0 ? s.length : f + m[0].length;
        continue;
      }
    }
    if (c === ';') return fora;
    fora += c;
    i++;
  }
  return fora;
}

function dividirNoTopo(s: string): string[] {
  const partes: string[] = [];
  let d = 0;
  let atual = '';
  for (const c of s) {
    if (c === '(') d++;
    if (c === ')') d--;
    if (c === ',' && d === 0) {
      partes.push(atual);
      atual = '';
    } else atual += c;
  }
  if (atual.trim()) partes.push(atual);
  return partes;
}

const TIPOS_DE_VARIAS_PALAVRAS = [
  'timestamp with time zone',
  'timestamp without time zone',
  'double precision',
  'character varying',
  'time with time zone',
  'time without time zone',
];
const APELIDOS: Record<string, string> = {
  timestamptz: 'timestamp with time zone',
  timestamp: 'timestamp without time zone',
  int: 'integer',
  int4: 'integer',
  int8: 'bigint',
  bool: 'boolean',
  float8: 'double precision',
  varchar: 'character varying',
};

/** `p_x timestamptz DEFAULT now()` → `timestamp with time zone`; OUT → null. */
function tipoDoArgumento(arg: string): string | null {
  let a = arg.trim().toLowerCase().replace(/\s+/g, ' ');
  a = a.replace(/\s+default\s+[\s\S]*$/, '').replace(/\s*=\s*[\s\S]*$/, '').trim();
  const modo = /^(in|out|inout|variadic)\s+/.exec(a);
  if (modo) {
    if (modo[1] === 'out') return null;
    a = a.slice(modo[0].length);
  }
  const tokens = a.split(' ');
  if (tokens.length > 1 && !TIPOS_DE_VARIAS_PALAVRAS.some(t => a.startsWith(t))) a = tokens.slice(1).join(' ');
  a = a.replace(/^public\./, '').replace(/"/g, '');
  return APELIDOS[a] ?? a;
}

/** Só o schema `public` (sem schema = `public`). Outros schemas → null. */
function nomeDaFuncao(n: string): string | null {
  const x = n.trim().replace(/"/g, '').toLowerCase();
  if (!x.includes('.')) return x;
  const [schema, nome] = x.split('.');
  return schema === 'public' ? nome : null;
}

function assinatura(nome: string, args: string): string {
  const tipos = dividirNoTopo(args)
    .map(tipoDoArgumento)
    .filter((t): t is string => !!t);
  return `${nome}(${tipos.join(',')})`;
}

function lerEventos(arquivos: Arquivo[]): Evento[] {
  const eventos: Evento[] = [];
  arquivos.forEach(({ sql }, ia) => {
    const s = tirarComentarios(sql);
    let m: RegExpExecArray | null;

    const reCria = /\bcreate\s+(?:or\s+replace\s+)?function\s+([\w."]+)\s*\(/gi;
    while ((m = reCria.exec(s))) {
      const nome = nomeDaFuncao(m[1]);
      if (!nome) continue;
      const abre = m.index + m[0].length - 1;
      const fecha = parenQueFecha(s, abre);
      const fora = cabecalhoForaDoCorpo(s, fecha + 1);
      eventos.push({
        tipo: 'create',
        ia,
        pos: m.index,
        nome,
        sig: assinatura(nome, s.slice(abre + 1, fecha)),
        definer: /\bsecurity\s+definer\b/i.test(fora),
        gatilho: /\breturns\s+trigger\b/i.test(fora),
      });
    }

    const rePermissao = /\b(revoke|grant)\b([^;]*?)\bon\s+function\s+([^;]*?)\b(from|to)\b([^;]*);/gi;
    while ((m = rePermissao.exec(s))) {
      const papeis = m[5].split(',').map(p => p.trim().toLowerCase().replace(/"/g, '').split(/\s/)[0]);
      for (const f of dividirNoTopo(m[3])) {
        const mf = /^\s*([\w."]+)\s*(?:\(([\s\S]*)\))?\s*$/.exec(f);
        if (!mf) continue;
        const nome = nomeDaFuncao(mf[1]);
        if (!nome) continue;
        eventos.push({
          tipo: m[1].toLowerCase() as 'revoke' | 'grant',
          ia,
          pos: m.index,
          nome,
          sig: mf[2] === undefined ? null : assinatura(nome, mf[2]),
          papeis,
        });
      }
    }

    // QA Loop 1, C1: `GRANT/REVOKE … ON ALL FUNCTIONS IN SCHEMA public` vale para
    // todas as funções que existem até ali. (O `ALTER DEFAULT PRIVILEGES … ON
    // FUNCTIONS` não casa aqui: ele só mexe em funções futuras.)
    const reTodas = /\b(revoke|grant)\b([^;]*?)\bon\s+all\s+functions\s+in\s+schema\s+([^;]*?)\b(from|to)\b([^;]*);/gi;
    while ((m = reTodas.exec(s))) {
      const schemas = m[3].split(',').map(x => x.trim().replace(/"/g, '').toLowerCase());
      if (!schemas.includes('public')) continue;
      const papeis = m[5].split(',').map(p => p.trim().toLowerCase().replace(/"/g, '').split(/\s/)[0]);
      eventos.push({ tipo: m[1].toLowerCase() as 'revoke' | 'grant', ia, pos: m.index, nome: '*', sig: null, papeis, todas: true });
    }

    // `ALTER FUNCTION … RENAME TO` e (QA Loop 1, C1b) `ALTER FUNCTION … SECURITY DEFINER|INVOKER`.
    const reAltera = /\balter\s+function\s+([\w."]+)\s*(\(([^)]*)\))?([^;]*)/gi;
    while ((m = reAltera.exec(s))) {
      const nome = nomeDaFuncao(m[1]);
      if (!nome) continue;
      const sig = m[2] ? assinatura(nome, m[3]) : null;
      const resto = m[4];
      const renomeia = /\brename\s+to\s+([\w"]+)/i.exec(resto);
      const novo = renomeia ? nomeDaFuncao(renomeia[1]) : null;
      if (novo) eventos.push({ tipo: 'rename', ia, pos: m.index, nome, sig, novo });
      const seguranca = /\bsecurity\s+(definer|invoker)\b/i.exec(resto);
      if (seguranca)
        eventos.push({ tipo: 'seguranca', ia, pos: m.index, nome, sig, definer: seguranca[1].toLowerCase() === 'definer' });
    }

    const reApaga = /\bdrop\s+function\s+(?:if\s+exists\s+)?([\w."]+)\s*(\(([^)]*)\))?/gi;
    while ((m = reApaga.exec(s))) {
      const nome = nomeDaFuncao(m[1]);
      if (!nome) continue;
      eventos.push({ tipo: 'drop', ia, pos: m.index, nome, sig: m[2] ? assinatura(nome, m[3]) : null });
    }
  });

  // Por arquivo: primeiro a estrutura, depois as permissões (ver cabeçalho),
  // com duas exceções que ficam POR LINHA (fase 0, junto com a estrutura):
  //   • C2 — permissão de uma função que tem DROP no mesmo arquivo: REVOKE → DROP
  //     → CREATE deixa a função recriada aberta, e só a ordem por linha vê isso;
  //   • REVOKE … ON ALL FUNCTIONS: só fecha o que já existe naquela linha
  //     (o GRANT … ON ALL FUNCTIONS fica na fase 1: reabre tudo do arquivo).
  const apagadasNoArquivo = new Set(
    eventos.filter(e => e.tipo === 'drop').map(e => `${e.ia}:${e.nome}`),
  );
  const fase = (e: Evento) => {
    if (e.tipo !== 'revoke' && e.tipo !== 'grant') return 0;
    if (e.todas) return e.tipo === 'revoke' ? 0 : 1;
    return apagadasNoArquivo.has(`${e.ia}:${e.nome}`) ? 0 : 1;
  };
  return eventos.sort((a, b) => a.ia - b.ia || fase(a) - fase(b) || a.pos - b.pos);
}

function estadoFinal(arquivos: Arquivo[]): Map<string, Funcao> {
  const estado = new Map<string, Funcao>();
  const alvos = (e: { nome: string; sig: string | null; todas?: boolean }) =>
    [...estado.keys()].filter(k => (e.todas ? true : e.sig ? k === e.sig : k.startsWith(`${e.nome}(`)));

  for (const e of lerEventos(arquivos)) {
    if (e.tipo === 'create') {
      estado.set(e.sig, {
        nome: e.nome,
        sig: e.sig,
        definer: e.definer,
        gatilho: e.gatilho,
        fechada: false,
        criadaEm: arquivos[e.ia].nome,
      });
    } else if (e.tipo === 'drop') {
      alvos(e).forEach(k => estado.delete(k));
    } else if (e.tipo === 'rename') {
      alvos(e).forEach(k => {
        const f = estado.get(k)!;
        const nova = e.novo + k.slice(e.nome.length);
        estado.delete(k);
        estado.set(nova, { ...f, nome: e.novo, sig: nova });
      });
    } else if (e.tipo === 'seguranca') {
      alvos(e).forEach(k => (estado.get(k)!.definer = e.definer));
    } else if (e.tipo === 'revoke' && e.papeis.includes('anon')) {
      alvos(e).forEach(k => (estado.get(k)!.fechada = true));
    } else if (e.tipo === 'grant' && (e.papeis.includes('anon') || e.papeis.includes('public'))) {
      alvos(e).forEach(k => (estado.get(k)!.fechada = false));
    }
  }
  return estado;
}

/** Exceções: o único jeito de uma função DEFINER ficar com `anon`. Motivo obrigatório. */
const EXCECOES: Record<string, string> = {
  validate_api_key:
    'S4 — a API pública valida a chave sem login (lib/public-api/auth.ts, cliente com a chave pública). Logs: 292× como anon em 9 dias.',
  is_instance_initialized:
    'S4 — a tela de instalação e o middleware perguntam antes de existir sessão (lib/supabase/middleware.ts, app/(protected)/setup). Logs: 135× como anon em 03/11.',
  resgatar_itens_presos:
    'S5 — ATÉ A 2.70: o cron stage-evaluations a chama com o cliente de cookie, sem sessão, ou seja, como anon (~288×/dia). Revogar sem trocar o cliente quebra o resgate em silêncio.',
};

function funcoesAbertas(arquivos: Arquivo[]): Funcao[] {
  return [...estadoFinal(arquivos).values()].filter(
    f => f.definer && !f.gatilho && !f.fechada && !(f.nome in EXCECOES),
  );
}

// ───────────────────────────── dados ─────────────────────────────

const PASTA = join(process.cwd(), 'supabase/migrations');
const NOVA = '20261104120000_funcoes_sem_execucao_anonima.sql';
const MIGRATIONS: Arquivo[] = readdirSync(PASTA)
  .filter(n => n.endsWith('.sql'))
  .sort()
  .map(nome => ({ nome, sql: readFileSync(join(PASTA, nome), 'utf-8') }));
const SEM_A_NOVA = MIGRATIONS.filter(a => a.nome !== NOVA);

/** D2 da story, linhas 1–22 (assinaturas como o regprocedure normaliza). */
const SO_SISTEMA = [
  'cleanup_rate_limits(integer)',
  'update_message_status_if_newer(text,text,timestamp with time zone,text,text)',
  'expire_old_pending_advances()',
  'trigger_hitl_alerts()',
  'recalcular_lead_scores_de_todas_as_orgs()',
  '_api_key_make_token()',
  '_api_key_sha256_hex(text)',
];
const LOGADO = [
  'mark_deal_won(uuid)',
  'mark_deal_lost(uuid,text)',
  'reopen_deal(uuid)',
  'log_audit_event(text,text,uuid,jsonb,text)',
  'mark_conversation_read(uuid)',
  'create_api_key(text)',
  'revoke_api_key(uuid)',
  'merge_contacts(uuid,uuid)',
  'recalcular_lead_scores(uuid)',
  'get_fila_de_atendimento(uuid,integer)',
  'get_lista_da_fila(uuid,integer,boolean,boolean,integer)',
  'get_messaging_metrics(uuid,timestamp with time zone,timestamp with time zone,uuid)',
  'get_metricas_de_atendimento(uuid,timestamp with time zone,timestamp with time zone)',
  'get_messaging_unread_count()',
  'get_user_org_id()',
];

// ───────────────────────────── testes ─────────────────────────────

describe('AC4 — controle positivo: o leitor enxerga as funções conhecidas', () => {
  const definers = [...estadoFinal(MIGRATIONS).values()].filter(f => f.definer);
  const nomes = new Set(definers.map(f => f.nome));

  it.each([
    'cleanup_rate_limits', // sem `public.`, maiúsculas
    'trigger_hitl_alerts', // SECURITY DEFINER depois do corpo
    'expire_old_pending_advances', // idem
    'update_message_status_if_newer',
    'validate_api_key',
    'get_lista_da_fila', // RETURNS TABLE(...)
    'get_user_org_id', // LANGUAGE sql STABLE antes do SECURITY DEFINER
  ])('acha %s como SECURITY DEFINER', nome => {
    expect(nomes.has(nome)).toBe(true);
  });

  it('acha pelo menos 38 funções SECURITY DEFINER (o número do código e de produção, T0)', () => {
    expect(nomes.size).toBeGreaterThanOrEqual(38);
  });

  it('gatilho (RETURNS trigger) vira exceção automática, sem lista', () => {
    const gatilho = definers.find(f => f.nome === 'handle_new_user');
    expect(gatilho?.gatilho).toBe(true);
  });

  it('acompanha o RENAME (get_metricas_do_atendimento → get_metricas_de_atendimento)', () => {
    expect(nomes.has('get_metricas_de_atendimento')).toBe(true);
    expect(nomes.has('get_metricas_do_atendimento')).toBe(false);
  });

  it('REVOKE sem assinatura vale para a função (custom_access_token_hook)', () => {
    expect(estadoFinal(MIGRATIONS).get('custom_access_token_hook(jsonb)')?.fechada).toBe(true);
  });
});

describe('AC4 — nenhuma função SECURITY DEFINER fica aberta para anon', () => {
  it('🎯 com todas as migrations, a lista de abertas está vazia', () => {
    expect(funcoesAbertas(MIGRATIONS).map(f => `${f.sig} <${f.criadaEm}>`)).toEqual([]);
  });

  it('🎯 caso real: SEM a migration nova, reprova exatamente as 22 do D2, incluindo get_user_org_id()', () => {
    const abertas = funcoesAbertas(SEM_A_NOVA).map(f => f.sig);
    expect(abertas).toContain('get_user_org_id()');
    expect([...abertas].sort()).toEqual([...SO_SISTEMA, ...LOGADO].sort());
  });

  it('toda exceção tem motivo escrito e ainda existe como DEFINER', () => {
    const estado = [...estadoFinal(MIGRATIONS).values()];
    for (const [nome, motivo] of Object.entries(EXCECOES)) {
      expect(motivo.length).toBeGreaterThan(30);
      expect(estado.some(f => f.nome === nome && f.definer)).toBe(true);
    }
  });
});

describe('AC4 — mutações de controle (o teste precisa FALHAR em cada uma)', () => {
  const nova = MIGRATIONS.find(a => a.nome === NOVA)!;

  it('(1) tirar o anon de uma linha da migration nova ⇒ reprova', () => {
    const mutada = nova.sql.replace(
      'REVOKE ALL ON FUNCTION public.cleanup_rate_limits(integer) FROM PUBLIC, anon, authenticated;',
      'REVOKE ALL ON FUNCTION public.cleanup_rate_limits(integer) FROM PUBLIC, authenticated;',
    );
    expect(mutada).not.toBe(nova.sql);
    const arquivos = [...SEM_A_NOVA, { nome: NOVA, sql: mutada }];
    expect(funcoesAbertas(arquivos).map(f => f.sig)).toEqual(['cleanup_rate_limits(integer)']);
  });

  it('(2) migration falsa com SECURITY DEFINER e sem REVOKE ⇒ reprova', () => {
    const falsa = {
      nome: '20991231000000_falsa.sql',
      sql: `CREATE OR REPLACE FUNCTION public.apaga_tudo(p_x uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN DELETE FROM public.rate_limits; END; $$;`,
    };
    expect(funcoesAbertas([...MIGRATIONS, falsa]).map(f => f.sig)).toEqual(['apaga_tudo(uuid)']);
  });

  it('(3) REVOKE numa migration ANTERIOR ao CREATE ⇒ reprova', () => {
    const revogaAntes = {
      nome: '20991230000000_revoga_antes.sql',
      sql: 'REVOKE ALL ON FUNCTION public.apaga_tudo(uuid) FROM PUBLIC, anon;',
    };
    const criaDepois = {
      nome: '20991231000000_cria_depois.sql',
      sql: `CREATE OR REPLACE FUNCTION public.apaga_tudo(p_x uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ select 1 $$;`,
    };
    expect(funcoesAbertas([...MIGRATIONS, revogaAntes, criaDepois]).map(f => f.sig)).toEqual(['apaga_tudo(uuid)']);
    // controle da mutação: na ordem certa, passa
    const revogaDepois = { ...revogaAntes, nome: '20991231000001_revoga_depois.sql' };
    expect(funcoesAbertas([...MIGRATIONS, criaDepois, revogaDepois])).toEqual([]);
  });

  it('(4) SECURITY DEFINER DEPOIS do corpo, sem `public.`, minúsculas, sem REVOKE ⇒ reprova', () => {
    const falsa = {
      nome: '20991231000000_estilo_antigo.sql',
      sql: `-- comentário com SECURITY DEFINER não conta
create or replace function limpa_fila(minutos integer default 5)
returns integer as $$
begin
  delete from public.rate_limits;
  return 0;
end;
$$ language plpgsql security definer;`,
    };
    expect(funcoesAbertas([...MIGRATIONS, falsa]).map(f => f.sig)).toEqual(['limpa_fila(integer)']);
  });

  it('(controle) comentário com "SECURITY DEFINER" não transforma função INVOKER em DEFINER', () => {
    const falsa = {
      nome: '20991231000000_so_comentario.sql',
      sql: `-- SECURITY DEFINER
CREATE FUNCTION public.soma(a int) RETURNS int LANGUAGE sql AS $$ select a + 1 $$; /* SECURITY DEFINER */`,
    };
    expect(funcoesAbertas([...MIGRATIONS, falsa])).toEqual([]);
  });

  it('(controle) GRANT … TO anon depois do REVOKE reabre ⇒ reprova', () => {
    const reabre = { nome: '20991231000000_reabre.sql', sql: 'GRANT EXECUTE ON FUNCTION public.mark_deal_won(uuid) TO anon;' };
    expect(funcoesAbertas([...MIGRATIONS, reabre]).map(f => f.sig)).toEqual(['mark_deal_won(uuid)']);
  });
});

describe('QA Loop 1 (gate 33) — os pontos cegos C1, C1b e C2', () => {
  const FECHADAS_HOJE = [...estadoFinal(MIGRATIONS).values()]
    .filter(f => f.definer && !f.gatilho && !(f.nome in EXCECOES))
    .map(f => f.sig)
    .sort();

  it.each(['anon', 'PUBLIC'])(
    '(C1) GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO %s numa migration posterior reabre TODAS ⇒ reprova',
    papel => {
      const reabreTudo = {
        nome: '20991231000000_reabre_tudo.sql',
        sql: `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${papel};`,
      };
      const abertas = funcoesAbertas([...MIGRATIONS, reabreTudo]).map(f => f.sig).sort();
      expect(abertas).toEqual(FECHADAS_HOJE);
      expect(abertas).toContain('cleanup_rate_limits(integer)');
      expect(abertas).toContain('get_user_org_id()');
      expect(abertas.length).toBeGreaterThanOrEqual(22);
    },
  );

  it('(C1, controle) GRANT ON ALL FUNCTIONS só a authenticated, ou em outro schema, não reabre', () => {
    const inofensivas = {
      nome: '20991231000000_inofensivas.sql',
      sql: `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA outro TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon;`,
    };
    expect(funcoesAbertas([...MIGRATIONS, inofensivas])).toEqual([]);
  });

  it('(C1, controle) REVOKE … ON ALL FUNCTIONS FROM anon fecha o que já existe, não o que é criado depois no mesmo arquivo', () => {
    const arquivo = {
      nome: '20991231000000_revoga_tudo.sql',
      sql: `CREATE FUNCTION public.antes() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ select 1 $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon;
CREATE FUNCTION public.depois() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ select 2 $$;`,
    };
    expect(funcoesAbertas([...MIGRATIONS, arquivo]).map(f => f.sig)).toEqual(['depois()']);
  });

  it('(C1b) ALTER FUNCTION … SECURITY DEFINER numa INVOKER sem REVOKE ⇒ reprova', () => {
    const cria = {
      nome: '20991230000000_invoker.sql',
      sql: 'CREATE FUNCTION public.vira_dono(p uuid) RETURNS void LANGUAGE sql AS $$ select 1 $$;',
    };
    expect(funcoesAbertas([...MIGRATIONS, cria])).toEqual([]); // INVOKER: fora do critério
    const altera = {
      nome: '20991231000000_vira_definer.sql',
      sql: 'ALTER FUNCTION public.vira_dono(uuid) SECURITY DEFINER;',
    };
    expect(funcoesAbertas([...MIGRATIONS, cria, altera]).map(f => f.sig)).toEqual(['vira_dono(uuid)']);
  });

  it('(C1b, controle) ALTER FUNCTION … SECURITY INVOKER tira a função do critério', () => {
    const cria = {
      nome: '20991230000000_definer.sql',
      sql: 'CREATE FUNCTION public.deixa_de_ser(p uuid) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ select 1 $$;',
    };
    const altera = { nome: '20991231000000_invoker.sql', sql: 'alter function deixa_de_ser(uuid) security invoker;' };
    expect(funcoesAbertas([...MIGRATIONS, cria]).map(f => f.sig)).toEqual(['deixa_de_ser(uuid)']);
    expect(funcoesAbertas([...MIGRATIONS, cria, altera])).toEqual([]);
  });

  it('(C2) no MESMO arquivo, REVOKE → DROP → CREATE: a função recriada nasce aberta ⇒ reprova', () => {
    const arquivo = {
      nome: '20991231000000_revoga_apaga_cria.sql',
      sql: `REVOKE ALL ON FUNCTION public.cleanup_rate_limits(integer) FROM PUBLIC, anon, authenticated;
DROP FUNCTION public.cleanup_rate_limits(integer);
CREATE FUNCTION public.cleanup_rate_limits(older_than_minutes integer DEFAULT 5)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN DELETE FROM public.rate_limits; RETURN 0; END; $$;`,
    };
    expect(funcoesAbertas([...MIGRATIONS, arquivo]).map(f => f.sig)).toEqual(['cleanup_rate_limits(integer)']);
  });

  it('(C2, controle) DROP → CREATE → REVOKE no mesmo arquivo continua fechada', () => {
    const arquivo = {
      nome: '20991231000000_apaga_cria_revoga.sql',
      sql: `DROP FUNCTION IF EXISTS public.cleanup_rate_limits(integer);
CREATE FUNCTION public.cleanup_rate_limits(older_than_minutes integer DEFAULT 5)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RETURN 0; END; $$;
REVOKE ALL ON FUNCTION public.cleanup_rate_limits(integer) FROM PUBLIC, anon, authenticated;`,
    };
    expect(funcoesAbertas([...MIGRATIONS, arquivo])).toEqual([]);
  });

  it('(C2, controle) sem DROP no arquivo, a regra de fase continua: as 3 da 20260223000000 seguem fechadas', () => {
    const estado = estadoFinal(MIGRATIONS);
    for (const sig of ['get_dashboard_stats()', 'get_contact_stage_counts()', 'get_singleton_organization_id()']) {
      expect(estado.get(sig)?.definer).toBe(true);
      expect(estado.get(sig)?.fechada).toBe(true);
    }
  });
});

describe('AC1 — a migration nova só mexe em permissões', () => {
  const nova = MIGRATIONS.find(a => a.nome === NOVA);
  const sql = nova?.sql ?? '';
  const comandos = tirarComentarios(sql);

  it('existe, com timestamp depois de 20261103180000', () => {
    expect(nova).toBeDefined();
    expect(NOVA.slice(0, 14) > '20261103180000').toBe(true);
  });

  it('sem CREATE FUNCTION, DROP, ALTER TABLE, BEGIN/COMMIT nem IF EXISTS', () => {
    expect(comandos).not.toMatch(/\bcreate\b/i);
    expect(comandos).not.toMatch(/\bdrop\b/i);
    expect(comandos).not.toMatch(/\balter\s+table\b/i);
    expect(comandos).not.toMatch(/\bbegin\b|\bcommit\b/i);
    expect(comandos).not.toMatch(/\bif\s+exists\b/i);
  });

  it('só tem REVOKE, GRANT, ALTER DEFAULT PRIVILEGES e o NOTIFY final', () => {
    const linhas = comandos
      .split(';')
      .map(c => c.trim())
      .filter(Boolean);
    for (const c of linhas) expect(c).toMatch(/^(REVOKE ALL ON FUNCTION|GRANT EXECUTE ON FUNCTION|ALTER DEFAULT PRIVILEGES FOR ROLE postgres|NOTIFY pgrst)/);
    expect(linhas[linhas.length - 1]).toBe("NOTIFY pgrst, 'reload schema'");
  });

  it.each(SO_SISTEMA)('só sistema: %s — FROM PUBLIC, anon, authenticated · TO service_role', sig => {
    const eventos = lerEventos([{ nome: NOVA, sql }]).filter(e => 'sig' in e && e.sig === sig);
    const rev = eventos.find(e => e.tipo === 'revoke');
    const gra = eventos.find(e => e.tipo === 'grant');
    expect(rev && 'papeis' in rev ? rev.papeis : []).toEqual(['public', 'anon', 'authenticated']);
    expect(gra && 'papeis' in gra ? gra.papeis : []).toEqual(['service_role']);
  });

  it.each(LOGADO)('logado: %s — FROM PUBLIC, anon · TO authenticated', sig => {
    const eventos = lerEventos([{ nome: NOVA, sql }]).filter(e => 'sig' in e && e.sig === sig);
    const rev = eventos.find(e => e.tipo === 'revoke');
    const gra = eventos.find(e => e.tipo === 'grant');
    expect(rev && 'papeis' in rev ? rev.papeis : []).toEqual(['public', 'anon']);
    const esperado = sig === 'get_user_org_id()' ? ['authenticated', 'service_role'] : ['authenticated'];
    expect(gra && 'papeis' in gra ? gra.papeis : []).toEqual(esperado);
  });

  it('não toca nas exceções (validate_api_key, is_instance_initialized, resgatar_itens_presos)', () => {
    for (const nome of Object.keys(EXCECOES)) expect(comandos).not.toContain(nome);
  });

  it('D4 — fecha as duas portas do padrão: anon no schema e PUBLIC sem schema', () => {
    expect(comandos).toContain(
      'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;',
    );
    expect(comandos).toContain('ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;');
  });
});
