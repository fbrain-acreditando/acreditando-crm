/**
 * Testes da guarda de card aberto — story 2.56, AC3 / AC7 (7, 8, 8b, 8c).
 *
 * O cliente falso aplica os filtros de verdade (`organization_id`, `contact_id`,
 * `board_id`, `deleted_at IS NULL`). Sem isso, o teste provaria que a função
 * chama `eq()` — não que ela deixa de contar card de outro quadro, de outro
 * contato ou já excluído, que é onde a guarda erraria calada.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  encontrarCardAberto,
  marcarCardComoAtualizado,
  estagiosTerminaisDoQuadro,
  BOARD_ACREDITANDO,
  ESTAGIOS_CONHECIDOS_ACREDITANDO,
  ESTAGIOS_TERMINAIS_ACREDITANDO,
  type DealGuardClient,
} from './deal-guard';

/**
 * O token de leitura existe nesta máquina? (Mesmos caminhos do `sql-ro.mjs`.)
 *
 * ⚠️ Serve para `it.skipIf` — e **skip é reportado como skip**, não como passed.
 * A versão anterior usava `return` dentro do `it()`, e o vitest contava
 * **passed** num teste que não tinha provado nada (achado MÉDIA-4 do @qa).
 */
const TEM_TOKEN =
  !!process.env.SUPABASE_CRM_MGMT_TOKEN ||
  [
    process.env.SUPABASE_CRM_MGMT_TOKEN_FILE,
    join(homedir(), 'grupo-acreditando', '.credenciais', 'supabase-crm-mgmt.token'),
    join(homedir(), '.credenciais', 'supabase-crm-mgmt.token'),
  ].some((p) => !!p && existsSync(p));

const ORG = 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5';
const CONTATO = 'd4e5f6a7-b8c9-4d0e-8f1a-b2c3d4e5f6a7';
const OUTRO_QUADRO = '11111111-2222-4333-8444-555555555555';

const GANHO = 'f359ee98-b7b1-460d-a7be-2ef92f92c4c7';
const PERDIDO = '78defbd3-6ca4-4b96-b67a-2268e7e6dce5';
const CLIENTES = '3ed212e5-32a9-4bda-8d70-bb8be49e790d';
const LEAD_NOVO = '82d1a222-eeff-4627-baed-881908dbd702';
const AVALIACAO_AGENDADA = 'c8f1ea2e-2607-4df8-ad3d-a25eb201de80';
/** 🔻 Com espaço no começo — é assim que está gravado no banco. */
const PROPOSTA = '9f1b2a7a-e6b1-4e04-b041-87581fc6a8a9';

interface DealFake {
  id: string;
  stage_id: string | null;
  organization_id: string;
  contact_id: string;
  board_id: string;
  deleted_at: string | null;
  created_at: string;
  [k: string]: unknown;
}

function criarCliente(deals: Partial<DealFake>[], falhar = false) {
  const linhas: DealFake[] = deals.map((d, i) => ({
    id: d.id ?? `deal-${i}`,
    stage_id: d.stage_id ?? LEAD_NOVO,
    organization_id: d.organization_id ?? ORG,
    contact_id: d.contact_id ?? CONTATO,
    board_id: d.board_id ?? BOARD_ACREDITANDO,
    deleted_at: d.deleted_at ?? null,
    created_at: d.created_at ?? `2026-09-0${i + 1}T00:00:00Z`,
  }));

  const client: DealGuardClient = {
    from() {
      return {
        select() {
          const eqs: Array<[string, unknown]> = [];
          const isNulls: string[] = [];
          let asc = true;
          const q = {
            eq(col: string, val: unknown) {
              eqs.push([col, val]);
              return q;
            },
            is(col: string) {
              isNulls.push(col);
              return q;
            },
            order(_col: string, opts: { ascending: boolean }) {
              asc = opts.ascending;
              return q;
            },
            async limit(n: number) {
              if (falhar) return { data: null, error: { message: 'banco fora do ar' } };
              const achadas = linhas
                .filter((l) => eqs.every(([c, v]) => l[c] === v))
                .filter((l) => isNulls.every((c) => l[c] === null))
                .sort((a, b) =>
                  asc
                    ? a.created_at.localeCompare(b.created_at)
                    : b.created_at.localeCompare(a.created_at)
                )
                .slice(0, n);
              return { data: achadas.map((l) => ({ id: l.id, stage_id: l.stage_id })), error: null };
            },
          };
          return q;
        },
      };
    },
  } as unknown as DealGuardClient;

  return client;
}

const entrada = { organizationId: ORG, contactId: CONTATO, boardId: BOARD_ACREDITANDO };

// =============================================================================
// AC7 — 7 e 8
// =============================================================================

describe('AC3 — a guarda de card aberto', () => {
  it('teste 7: contato com card aberto no mesmo quadro ⇒ NÃO cria outro', async () => {
    const client = criarCliente([{ id: 'deal-aberto', stage_id: AVALIACAO_AGENDADA }]);

    const r = await encontrarCardAberto(client, entrada);

    expect(r.temCardAberto).toBe(true);
    if (r.temCardAberto) expect(r.dealId).toBe('deal-aberto');
  });

  it('teste 8: contato SEM card ⇒ cria, como hoje', async () => {
    const r = await encontrarCardAberto(criarCliente([]), entrada);

    expect(r.temCardAberto).toBe(false);
    if (!r.temCardAberto) expect(r.motivo).toBe('sem-card');
  });

  it('teste 8b (D4): único card em Ganho ⇒ cria card novo, sem reusar o fechado', async () => {
    const client = criarCliente([{ id: 'deal-ganho', stage_id: GANHO }]);

    const r = await encontrarCardAberto(client, entrada);

    expect(r.temCardAberto).toBe(false);
    if (!r.temCardAberto) {
      expect(r.motivo).toBe('so-terminais');
      expect(r.terminaisIgnorados).toBe(1);
    }
  });

  it('teste 8b: Perdido e Clientes também não contam como card aberto', async () => {
    for (const terminal of [PERDIDO, CLIENTES]) {
      const r = await encontrarCardAberto(criarCliente([{ stage_id: terminal }]), entrada);
      expect(r.temCardAberto).toBe(false);
    }
  });

  it('teste 8b: um terminal + um aberto ⇒ reusa o ABERTO', async () => {
    const client = criarCliente([
      { id: 'deal-perdido', stage_id: PERDIDO, created_at: '2026-01-01T00:00:00Z' },
      { id: 'deal-vivo', stage_id: PROPOSTA, created_at: '2026-09-01T00:00:00Z' },
    ]);

    const r = await encontrarCardAberto(client, entrada);

    expect(r.temCardAberto).toBe(true);
    if (r.temCardAberto) expect(r.dealId).toBe('deal-vivo');
  });

  it('" Proposta enviada" (espaço no começo) conta como ABERTO — casamento por id', async () => {
    const r = await encontrarCardAberto(criarCliente([{ stage_id: PROPOSTA }]), entrada);
    expect(r.temCardAberto).toBe(true);
  });

  it('card EXCLUÍDO não conta como aberto — o filtro vai na query', async () => {
    const client = criarCliente([
      { id: 'deal-morto', stage_id: LEAD_NOVO, deleted_at: '2026-09-01T00:00:00Z' },
    ]);

    const r = await encontrarCardAberto(client, entrada);
    expect(r.temCardAberto).toBe(false);
  });

  it('card de OUTRO quadro não bloqueia a criação neste', async () => {
    const client = criarCliente([{ stage_id: LEAD_NOVO, board_id: OUTRO_QUADRO }]);

    const r = await encontrarCardAberto(client, entrada);
    expect(r.temCardAberto).toBe(false);
  });

  it('AC5-3: card de OUTRO contato não bloqueia — nada junta duas pessoas', async () => {
    const client = criarCliente([{ stage_id: LEAD_NOVO, contact_id: 'outro-contato' }]);

    const r = await encontrarCardAberto(client, entrada);
    expect(r.temCardAberto).toBe(false);
  });

  it('card sem estágio conta como ABERTO — na dúvida, não espalha card', async () => {
    const r = await encontrarCardAberto(criarCliente([{ stage_id: null }]), entrada);
    expect(r.temCardAberto).toBe(true);
  });

  it('falha de banco NÃO lança e mantém o comportamento de hoje (cria)', async () => {
    const r = await encontrarCardAberto(criarCliente([{ stage_id: GANHO }], true), entrada);

    expect(r.temCardAberto).toBe(false);
    if (!r.temCardAberto) expect(r.motivo).toBe('erro');
  });

  it('quadro sem lista terminal cadastrada trata tudo como aberto', async () => {
    expect(estagiosTerminaisDoQuadro(OUTRO_QUADRO)).toEqual([]);

    const client = criarCliente([{ stage_id: GANHO, board_id: OUTRO_QUADRO }]);
    const r = await encontrarCardAberto(client, {
      ...entrada,
      boardId: OUTRO_QUADRO,
    });

    expect(r.temCardAberto).toBe(true);
  });
});

// =============================================================================
// AC7 — 8c: a constante não pode envelhecer calada
// =============================================================================

describe('AC7 item 8c — guarda da lista de estágios', () => {
  it('os 3 terminais estão entre os 13 estágios conhecidos', () => {
    const ids = new Set(ESTAGIOS_CONHECIDOS_ACREDITANDO.map((s) => s.id));
    for (const t of ESTAGIOS_TERMINAIS_ACREDITANDO) expect(ids.has(t)).toBe(true);
  });

  it('a lista conhecida tem exatamente 13 colunas, sem id repetido', () => {
    expect(ESTAGIOS_CONHECIDOS_ACREDITANDO).toHaveLength(13);
    const ids = new Set(ESTAGIOS_CONHECIDOS_ACREDITANDO.map((s) => s.id));
    expect(ids.size).toBe(13);
  });

  it('o estágio de proposta continua gravado COM espaço no começo', () => {
    const proposta = ESTAGIOS_CONHECIDOS_ACREDITANDO.find((s) => s.id === PROPOSTA);
    // Se alguém "consertar" este nome sem conferir o banco, a constante passa a
    // mentir sobre a produção. O nome está aqui só para o teste conferir.
    expect(proposta?.name).toBe(' Proposta enviada');
  });

  /**
   * ⚠️ **LIMITE CONHECIDO, escrito com todas as letras.**
   *
   * Este é o único teste que confere a constante contra o BANCO — e ele só roda
   * onde existe o token de leitura (`scripts/db/sql-ro.mjs`). Sem token, ele é
   * **pulado**: num CI sem credencial, a lista PODE envelhecer sem ninguém ver.
   *
   * O que o AC7 item 8c pede ("o teste falha se o quadro mudar") está entregue
   * **na máquina que tem o token**, não no CI. Fechar isso de verdade exige a
   * coluna `is_closing` em `board_stages` (opção B da D4) — registrada na story
   * como evolução fora do escopo.
   */
  it.skipIf(!TEM_TOKEN)('a lista bate com o banco de produção', () => {
    let saida: string;
    try {
      saida = execFileSync(
        process.execPath,
        [
          'scripts/db/sql-ro.mjs',
          `SELECT json_agg(json_build_object('id', id, 'name', name, 'order', "order") ORDER BY "order") AS stages FROM board_stages WHERE board_id = '${BOARD_ACREDITANDO}'`,
        ],
        { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 }
      );
    } catch (e) {
      // ⚠️ O token EXISTE (senão o teste nem rodaria) — então falhar aqui é
      // falha de verdade: token vencido, rede caída ou consulta quebrada. Antes
      // isto era um `return` e o vitest reportava **passed** sem ter provado
      // nada (achado MÉDIA-4 do @qa). Teste verde que não provou nada é pior
      // que teste ausente.
      throw new Error(
        `8c não conseguiu ler o banco com o token presente: ${
          e instanceof Error ? e.message : String(e)
        }`
      );
    }

    const doBanco = JSON.parse(saida)?.[0]?.stages as Array<{
      id: string;
      name: string;
      order: number;
    }> | null;

    expect(doBanco, 'a consulta não devolveu estágio nenhum').toBeTruthy();

    expect((doBanco ?? []).map((s) => ({ id: s.id, name: s.name, order: s.order }))).toEqual(
      ESTAGIOS_CONHECIDOS_ACREDITANDO.map((s) => ({ id: s.id, name: s.name, order: s.order }))
    );
  });
});

// =============================================================================
// D5 (Filipe, 25/09) — o card reusado DA SINAL
// =============================================================================

function clienteDeUpdate(existentes: string[], falhar = false) {
  const tocados: Array<{ id: string; values: Record<string, unknown> }> = [];
  const client = {
    from() {
      return {
        update(values: Record<string, unknown>) {
          const filtros: Array<[string, unknown]> = [];
          const q = {
            eq(col: string, val: unknown) {
              filtros.push([col, val]);
              return q;
            },
            async select() {
              if (falhar) return { data: null, error: { message: 'banco fora do ar' } };
              const alvo = filtros.find(([c]) => c === 'id')?.[1] as string;
              if (!existentes.includes(alvo)) return { data: [], error: null };
              tocados.push({ id: alvo, values });
              return { data: [{ id: alvo }], error: null };
            },
          };
          return q;
        },
      };
    },
  } as unknown as DealGuardClient;
  return { client, tocados };
}

describe('D5 — card reusado sobe na lista, sem mudar de coluna', () => {
  it('carimba `updated_at` no card reaproveitado', async () => {
    const { client, tocados } = clienteDeUpdate(['deal-aberto']);

    const r = await marcarCardComoAtualizado(client, 'deal-aberto', () => {}, '2026-09-25T13:00:00.000Z');

    expect(r.marcado).toBe(true);
    expect(tocados).toHaveLength(1);
    expect(tocados[0].values).toEqual({ updated_at: '2026-09-25T13:00:00.000Z' });
  });

  it('NAO mexe em stage_id — mover card sozinho vira chamado', async () => {
    const { client, tocados } = clienteDeUpdate(['deal-aberto']);

    await marcarCardComoAtualizado(client, 'deal-aberto');

    expect(Object.keys(tocados[0].values)).toEqual(['updated_at']);
  });

  it('UPDATE que afeta ZERO linhas nao e reportado como sucesso (Rule 7)', async () => {
    const { client } = clienteDeUpdate(['outro-deal']);

    const r = await marcarCardComoAtualizado(client, 'deal-aberto');

    expect(r.marcado).toBe(false);
  });

  it('falha de banco NAO lanca — o card ja foi reusado de qualquer jeito', async () => {
    const { client } = clienteDeUpdate(['deal-aberto'], true);

    const r = await marcarCardComoAtualizado(client, 'deal-aberto');

    expect(r.marcado).toBe(false);
  });
});
