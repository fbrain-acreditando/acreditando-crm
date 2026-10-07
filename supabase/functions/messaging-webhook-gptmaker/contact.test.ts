/**
 * Testes do nome do contato — story 2.56, AC8 (testes 11 e 12 do AC7).
 *
 * O que esta story arrisca errar aqui é **gravar texto de apresentação no
 * banco**: "Contato sem nome", "Contato do WhatsApp" ou o próprio `@lid` viram
 * nomes indistinguíveis de um nome real, e o contato some da fila de quem
 * precisa ser identificado.
 */

import { describe, it, expect } from 'vitest';
import { nomeParaContato, preencherNomeVazio, type ContactNameClient } from './contact';

const CONTATO = 'd4e5f6a7-b8c9-4d0e-8f1a-b2c3d4e5f6a7';

interface ContatoFake {
  id: string;
  name: string | null;
}

function criarCliente(linhas: ContatoFake[], falhar: 'select' | 'update' | null = null) {
  const client: ContactNameClient = {
    from() {
      return {
        select() {
          return {
            eq(_col: string, val: unknown) {
              return {
                async maybeSingle() {
                  if (falhar === 'select') return { data: null, error: { message: 'fora do ar' } };
                  const achado = linhas.find((l) => l.id === val) ?? null;
                  return { data: achado, error: null };
                },
              };
            },
          };
        },
        update(values: Record<string, unknown>) {
          return {
            eq(_col: string, val: unknown) {
              return {
                async select() {
                  if (falhar === 'update') return { data: null, error: { message: 'fora do ar' } };
                  const alvo = linhas.filter((l) => l.id === val);
                  alvo.forEach((l) => (l.name = values.name as string));
                  return { data: alvo.map((l) => ({ id: l.id })), error: null };
                },
              };
            },
          };
        },
      };
    },
  } as unknown as ContactNameClient;

  return { client, linhas };
}

describe('AC8 — o nome com que o contato NASCE', () => {
  it('nome de verdade vence', () => {
    expect(nomeParaContato('Bruno Nascimento Motta', '+5511951342931')).toBe(
      'Bruno Nascimento Motta'
    );
  });

  it('sem nome, usa o telefone — que é dado real', () => {
    expect(nomeParaContato(null, '+5511951342931')).toBe('+5511951342931');
  });

  it('sem nome E sem telefone (o caso do lid puro) ⇒ VAZIO', () => {
    // Nunca "Contato do WhatsApp", nunca o lid truncado, nunca "Contato sem nome".
    expect(nomeParaContato(null, null)).toBe('');
    expect(nomeParaContato('   ', '')).toBe('');
  });
});

describe('AC8 — teste 12: nome de verdade chegando depois preenche o vazio', () => {
  it('contato com nome vazio recebe o nome que chegou', async () => {
    const { client, linhas } = criarCliente([{ id: CONTATO, name: '' }]);

    const r = await preencherNomeVazio(client, { contactId: CONTATO, nome: 'Bruno Nascimento Motta' });

    expect(r.preenchido).toBe(true);
    expect(linhas[0].name).toBe('Bruno Nascimento Motta');
  });

  it('contato com nome NULL também é preenchido', async () => {
    const { client, linhas } = criarCliente([{ id: CONTATO, name: null }]);

    await preencherNomeVazio(client, { contactId: CONTATO, nome: 'Maria Aparecida' });

    expect(linhas[0].name).toBe('Maria Aparecida');
  });

  it('contato que JÁ tem nome não é tocado — nem para "melhorar"', async () => {
    const { client, linhas } = criarCliente([{ id: CONTATO, name: 'Bruno N. Motta' }]);

    const r = await preencherNomeVazio(client, { contactId: CONTATO, nome: 'Bruno Nascimento Motta' });

    expect(r.preenchido).toBe(false);
    expect(linhas[0].name).toBe('Bruno N. Motta');
  });

  it('D3 = não mexer no passado: contato que já se chama …@lid NÃO é renomeado', async () => {
    const { client, linhas } = criarCliente([{ id: CONTATO, name: '27870562914352@lid' }]);

    const r = await preencherNomeVazio(client, { contactId: CONTATO, nome: 'Bruno Nascimento Motta' });

    expect(r.preenchido).toBe(false);
    expect(linhas[0].name).toBe('27870562914352@lid');
  });

  it('nome vazio chegando não apaga nada e não escreve', async () => {
    const { client, linhas } = criarCliente([{ id: CONTATO, name: '' }]);

    const r = await preencherNomeVazio(client, { contactId: CONTATO, nome: '   ' });

    expect(r.preenchido).toBe(false);
    expect(linhas[0].name).toBe('');
  });

  it('falha de banco NÃO lança — nome é enfeite perto da mensagem', async () => {
    const a = await preencherNomeVazio(criarCliente([{ id: CONTATO, name: '' }], 'select').client, {
      contactId: CONTATO,
      nome: 'Bruno',
    });
    const b = await preencherNomeVazio(criarCliente([{ id: CONTATO, name: '' }], 'update').client, {
      contactId: CONTATO,
      nome: 'Bruno',
    });

    expect(a.preenchido).toBe(false);
    expect(b.preenchido).toBe(false);
  });

  it('UPDATE que afeta ZERO linhas não é reportado como sucesso (Rule 7)', async () => {
    const { client } = criarCliente([{ id: 'outro-contato', name: '' }]);

    const r = await preencherNomeVazio(client, { contactId: CONTATO, nome: 'Bruno' });

    expect(r.preenchido).toBe(false);
  });
});
