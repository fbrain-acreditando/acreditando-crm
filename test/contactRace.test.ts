/**
 * A corrida na criação de contato — story 2.6.
 *
 * O GPT Maker entrega `onNewMessage` e `onFirstInteraction` quase juntos para um
 * contato novo. As duas entregas chegam concorrentes e **as duas** tentam criar o
 * contato. Em produção isso gerou **138 pares duplicados** (medido em 2026-08-04),
 * todos com menos de 0,5 s entre as criações.
 *
 * ## O que faz este teste valer
 *
 * O duplo de Supabase daqui **não deduplica sozinho**: o `insert` empurra uma linha
 * nova toda vez, exatamente como o banco real faz — `contacts` não tem constraint
 * de unicidade nenhuma além da PK (conferido em produção: só `contacts_pkey`).
 *
 * Isso é o ponto inteiro. Um duplo que rejeitasse o segundo insert faria o
 * algoritmo ANTIGO passar, e o teste diria "corrigido" sobre um bug intacto. Por
 * isso o primeiro bloco abaixo roda o algoritmo antigo contra o mesmo duplo e
 * **exige que ele produza 2 contatos**: se algum dia o duplo passar a deduplicar,
 * esse teste quebra e denuncia o próprio duplo.
 */
import { describe, expect, it } from 'vitest';

import {
  resolveContactId,
  type ContactResolverClient,
} from '../supabase/functions/messaging-webhook-gptmaker/contact';

const ORG = 'org-acreditando';
const PHONE = '5512981945826';

interface FakeRow {
  id: string;
  organization_id: string;
  name: string;
  phone: string | null;
  source: string;
  deleted_at: string | null;
}

interface FakeOptions {
  /** Faz a RPC falhar, para exercitar o fallback. */
  rpcError?: { message?: string; code?: string };
  /** Faz o insert direto falhar, para exercitar o "sem contato, mas sem throw". */
  insertError?: { message?: string; code?: string };
}

/**
 * Duplo do Supabase que modela o banco REAL:
 *  - `insert` sempre insere (não há unique constraint em `contacts`);
 *  - `rpc('find_or_create_contact')` serializa por `(org, phone)`, como o
 *    `pg_advisory_xact_lock` da migration `20260804120000`.
 */
function criarFake(opts: FakeOptions = {}) {
  const rows: FakeRow[] = [];
  let seq = 0;
  /** Uma fila por chave — é o que o advisory lock faz no banco. */
  const filas = new Map<string, Promise<unknown>>();

  const inserir = (v: Record<string, unknown>): FakeRow => {
    const row: FakeRow = {
      id: `contact-${++seq}`,
      organization_id: String(v.organization_id),
      name: String(v.name),
      phone: (v.phone as string | null) ?? null,
      source: String(v.source ?? 'whatsapp'),
      deleted_at: null,
    };
    rows.push(row);
    return row;
  };

  const buscar = (org: string, phone: string): FakeRow | undefined =>
    rows.find(
      (r) => r.organization_id === org && r.phone === phone && r.deleted_at === null
    );

  /** Dá uma volta no event loop — sem isso as duas chamadas nunca se cruzam. */
  const respirar = () => new Promise((r) => setTimeout(r, 0));

  const client: ContactResolverClient = {
    async rpc(fn, args) {
      if (opts.rpcError) return { data: null, error: opts.rpcError };
      if (fn !== 'find_or_create_contact') {
        return { data: null, error: { message: `função desconhecida: ${fn}` } };
      }

      const org = String(args.p_organization_id);
      const phone = (args.p_phone as string | null) ?? null;
      const name = String(args.p_name);

      // Sem telefone não há chave por onde serializar — cria direto, como a função.
      if (!phone) {
        await respirar();
        return { data: inserir({ organization_id: org, name, phone: null }).id, error: null };
      }

      const chave = `${org}|${phone}`;
      const anterior = filas.get(chave) ?? Promise.resolve();
      const atual = anterior.then(async () => {
        await respirar();
        const achado = buscar(org, phone);
        if (achado) return achado.id;
        await respirar();
        return inserir({ organization_id: org, name, phone }).id;
      });
      filas.set(chave, atual.catch(() => {}));
      return { data: await atual, error: null };
    },

    from() {
      return {
        insert(values: Record<string, unknown>) {
          return {
            select() {
              return {
                async single() {
                  if (opts.insertError) return { data: null, error: opts.insertError };
                  await respirar();
                  const row = inserir(values);
                  return { data: { id: row.id }, error: null };
                },
              };
            },
          };
        },
      };
    },
  };

  return { client, rows, buscar, inserir, respirar };
}

/**
 * O algoritmo que estava em `index.ts:762-820` até esta story: `SELECT` e depois
 * `INSERT`, em chamadas separadas. Existe aqui **só para provar que o duplo
 * reprova** — se este teste passar a devolver 1 contato, o duplo virou mentira.
 */
async function algoritmoAntigo(
  fake: ReturnType<typeof criarFake>,
  org: string,
  phone: string,
  name: string
): Promise<string> {
  await fake.respirar();
  const existente = fake.buscar(org, phone);
  if (existente) return existente.id;
  await fake.respirar();
  return fake.inserir({ organization_id: org, name, phone }).id;
}

describe('a corrida, como ela acontece hoje em produção', () => {
  it('o algoritmo ANTIGO cria DOIS contatos para o mesmo telefone', async () => {
    const fake = criarFake();

    const [a, b] = await Promise.all([
      algoritmoAntigo(fake, ORG, PHONE, 'Lead via onNewMessage'),
      algoritmoAntigo(fake, ORG, PHONE, 'Lead via onFirstInteraction'),
    ]);

    // É este o defeito: ninguém perde a corrida, porque não há constraint.
    expect(fake.rows).toHaveLength(2);
    expect(a).not.toBe(b);
  });
});

describe('resolveContactId — AC1 e AC2', () => {
  it('duas entregas concorrentes resultam em UM contato só', async () => {
    const fake = criarFake();

    const [a, b] = await Promise.all([
      resolveContactId(fake.client, {
        organizationId: ORG,
        phone: PHONE,
        name: 'Lead via onNewMessage',
      }),
      resolveContactId(fake.client, {
        organizationId: ORG,
        phone: PHONE,
        name: 'Lead via onFirstInteraction',
      }),
    ]);

    expect(fake.rows).toHaveLength(1);
    expect(a.contactId).toBe(b.contactId);
    expect(a.via).toBe('rpc');
    expect(b.via).toBe('rpc');
  });

  it('cinco entregas simultâneas continuam resultando em um contato', async () => {
    const fake = criarFake();

    const saidas = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        resolveContactId(fake.client, {
          organizationId: ORG,
          phone: PHONE,
          name: `entrega ${i}`,
        })
      )
    );

    expect(fake.rows).toHaveLength(1);
    expect(new Set(saidas.map((s) => s.contactId)).size).toBe(1);
  });

  it('telefones diferentes NÃO se serializam entre si', async () => {
    const fake = criarFake();

    const [a, b] = await Promise.all([
      resolveContactId(fake.client, { organizationId: ORG, phone: PHONE, name: 'A' }),
      resolveContactId(fake.client, { organizationId: ORG, phone: '5511999999999', name: 'B' }),
    ]);

    expect(fake.rows).toHaveLength(2);
    expect(a.contactId).not.toBe(b.contactId);
  });
});

describe('resolveContactId — AC3: contato existente é reusado', () => {
  it('não cria contato novo quando o telefone já está na base', async () => {
    const fake = criarFake();
    const antigo = fake.inserir({ organization_id: ORG, name: 'Já cadastrado', phone: PHONE });

    const r = await resolveContactId(fake.client, {
      organizationId: ORG,
      phone: PHONE,
      name: 'Nome novo que veio no webhook',
    });

    expect(r.contactId).toBe(antigo.id);
    expect(fake.rows).toHaveLength(1);
  });
});

describe('resolveContactId — AC4: evento sem telefone', () => {
  it('cria o contato mesmo sem telefone (comportamento de hoje preservado)', async () => {
    const fake = criarFake();

    const r = await resolveContactId(fake.client, {
      organizationId: ORG,
      phone: null,
      name: 'Contato do WhatsApp',
    });

    expect(r.contactId).toBeTruthy();
    expect(fake.rows[0].phone).toBeNull();
  });

  it('string vazia é tratada como ausência de telefone', async () => {
    const fake = criarFake();

    await resolveContactId(fake.client, { organizationId: ORG, phone: '', name: 'X' });

    expect(fake.rows[0].phone).toBeNull();
  });

  it('dois eventos SEM telefone geram dois contatos — não há chave para unir', async () => {
    const fake = criarFake();

    await Promise.all([
      resolveContactId(fake.client, { organizationId: ORG, phone: null, name: 'A' }),
      resolveContactId(fake.client, { organizationId: ORG, phone: null, name: 'B' }),
    ]);

    // Documenta o limite da correção: sem telefone não há corrida a fechar.
    expect(fake.rows).toHaveLength(2);
  });
});

describe('resolveContactId — AC5: a mensagem nunca é perdida', () => {
  it('RPC indisponível cai no insert direto e ainda devolve contato', async () => {
    const fake = criarFake({
      rpcError: { message: 'function public.find_or_create_contact does not exist', code: '42883' },
    });

    const r = await resolveContactId(fake.client, {
      organizationId: ORG,
      phone: PHONE,
      name: 'Lead',
    });

    expect(r.via).toBe('fallback');
    expect(r.contactId).toBeTruthy();
    expect(fake.rows).toHaveLength(1);
  });

  it('RPC e insert falhando devolve contactId nulo — sem lançar', async () => {
    const fake = criarFake({
      rpcError: { message: 'timeout' },
      insertError: { message: 'permission denied', code: '42501' },
    });

    const r = await resolveContactId(fake.client, {
      organizationId: ORG,
      phone: PHONE,
      name: 'Lead',
    });

    // Perder o contato é aceitável; perder a mensagem não. Lição de `5e53bdd`.
    expect(r).toEqual({ contactId: null, via: 'none' });
    expect(fake.rows).toHaveLength(0);
  });

  it('registra no log por que caiu no fallback', async () => {
    const fake = criarFake({ rpcError: { message: 'boom', code: 'XX000' } });
    const linhas: string[] = [];

    await resolveContactId(
      fake.client,
      { organizationId: ORG, phone: PHONE, name: 'Lead' },
      (m) => linhas.push(m)
    );

    expect(linhas.join('\n')).toContain('boom');
    expect(linhas.join('\n')).toContain('XX000');
  });
});
