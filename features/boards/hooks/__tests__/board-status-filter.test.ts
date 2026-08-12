/**
 * Story 2.31 — o board abre mostrando o que foi classificado.
 *
 * O defeito, medido em produção em 12/08/2026: o filtro de status do board nascia em `'open'`,
 * e a regra `matchesStatus = !l.isWon && !l.isLost` apagava da tela todo card Ganho ou Perdido.
 * Como mover um card para essas colunas é justamente o que marca `isWon`/`isLost`, o efeito era:
 * CLASSIFICAR = DESAPARECER. E, sendo `useState` e não preferência salva, o filtro voltava para
 * `'open'` a cada carregamento — o trabalho "sumia da noite para o dia" sem ninguém mexer.
 *
 * No banco havia 18 cards em `Perdido` e 4 em `Ganho`; a usuária via zero nas duas colunas.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const CONTROLLER = path.join(process.cwd(), 'features/boards/hooks/useBoardsController.ts');

describe('Story 2.31 — filtro de status do board', () => {
  it('nasce em "all": um board que esconde o que a pessoa classificou não é filtro, é armadilha', () => {
    const src = fs.readFileSync(CONTROLLER, 'utf-8');

    const declaracao = src.match(
      /useState<'open'\s*\|\s*'won'\s*\|\s*'lost'\s*\|\s*'all'>\(\s*'([a-z]+)'\s*\)/
    );

    expect(declaracao, 'declaração do statusFilter não encontrada — o teste envelheceu').not.toBeNull();
    expect(
      declaracao![1],
      "o statusFilter default precisa ser 'all'. Com 'open', o card ganho ou perdido some da tela " +
        'no instante em que é classificado.'
    ).toBe('all');
  });

  it('a regra do filtro continua sendo a que foi diagnosticada (se mudar, este teste tem de mudar junto)', () => {
    const src = fs.readFileSync(CONTROLLER, 'utf-8');
    expect(src).toMatch(/statusFilter === 'open'[\s\S]{0,120}!l\.isWon && !l\.isLost/);
  });
});

describe('a regra de exclusão, exercitada — prova que o default importa', () => {
  type Card = { id: string; isWon: boolean; isLost: boolean };

  // Réplica fiel de `matchesStatus` (useBoardsController.ts). Existe para demonstrar o efeito
  // do default sobre dados reais; a fonte da verdade é o controller, travado nos testes acima.
  const passaNoFiltro = (c: Card, statusFilter: 'open' | 'won' | 'lost' | 'all') => {
    if (statusFilter === 'open') return !c.isWon && !c.isLost;
    if (statusFilter === 'won') return c.isWon;
    if (statusFilter === 'lost') return c.isLost;
    return true;
  };

  // O board da usuária em 12/08/2026, medido: 22 cards classificados por ela.
  const classificados: Card[] = [
    ...Array.from({ length: 18 }, (_, i) => ({ id: `perdido-${i}`, isWon: false, isLost: true })),
    ...Array.from({ length: 4 }, (_, i) => ({ id: `ganho-${i}`, isWon: true, isLost: false })),
  ];

  it("com 'open', os 22 cards classificados somem — era o que ela via", () => {
    expect(classificados.filter((c) => passaNoFiltro(c, 'open'))).toHaveLength(0);
  });

  it("com 'all', os 22 aparecem — é o conserto", () => {
    expect(classificados.filter((c) => passaNoFiltro(c, 'all'))).toHaveLength(22);
  });

  it("um card em aberto nunca dependeu do conserto: aparece nos dois modos", () => {
    const emAberto: Card = { id: 'aberto', isWon: false, isLost: false };
    expect(passaNoFiltro(emAberto, 'open')).toBe(true);
    expect(passaNoFiltro(emAberto, 'all')).toBe(true);
  });
});
