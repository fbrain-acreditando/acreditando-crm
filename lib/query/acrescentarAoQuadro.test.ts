/**
 * Story 2.74 (AC1) — o card achado no banco entra no cache do quadro sem
 * sobrescrever o que já está lá.
 */
import { describe, expect, it } from 'vitest';
import type { DealView } from '@/types';
import { acrescentarAoQuadro, juntarPorIdMaisNovo, versaoMaisNova } from './acrescentarAoQuadro';

const card = (id: string, extra: Partial<DealView> = {}): DealView =>
  ({
    id,
    title: `Card ${id}`,
    updatedAt: '2026-11-01T10:00:00Z',
    status: 'stage-1',
    ...extra,
  }) as DealView;

describe('acrescentarAoQuadro', () => {
  it('card novo entra (no fim, sem mexer nos outros)', () => {
    const cache = [card('a'), card('b')];
    const resultado = acrescentarAoQuadro(cache, [card('c')])!;
    expect(resultado.map(d => d.id)).toEqual(['a', 'b', 'c']);
    expect(resultado[0]).toBe(cache[0]);
  });

  it('🎯 card já no cache com título diferente NÃO é trocado (nem campo, nem posição)', () => {
    const noCache = card('a', { title: 'Do cache (otimismo)', status: 'stage-2' });
    const cache = [noCache, card('b')];
    const resultado = acrescentarAoQuadro(cache, [card('a', { title: 'Do banco', status: 'stage-1' })])!;
    expect(resultado).toHaveLength(2);
    expect(resultado[0]).toBe(noCache);
    expect(resultado[0].title).toBe('Do cache (otimismo)');
    expect(resultado[0].status).toBe('stage-2');
  });

  it('lista vazia não muda nada (mesma referência)', () => {
    const cache = [card('a')];
    expect(acrescentarAoQuadro(cache, [])).toBe(cache);
  });

  it('só repetidos → mesma referência (sem re-render à toa)', () => {
    const cache = [card('a')];
    expect(acrescentarAoQuadro(cache, [card('a')])).toBe(cache);
  });

  it('cache undefined fica undefined (não cria o cache antes do quadro carregar)', () => {
    expect(acrescentarAoQuadro(undefined, [card('a')])).toBeUndefined();
  });

  it('o mesmo id repetido nos achados entra uma vez só', () => {
    expect(acrescentarAoQuadro([], [card('a'), card('a')])!.map(d => d.id)).toEqual(['a']);
  });
});

describe('versaoMaisNova / juntarPorIdMaisNovo (C2)', () => {
  const velho = card('a', { title: 'velho', updatedAt: '2026-11-01T10:00:00Z' });
  const novo = card('a', { title: 'novo', updatedAt: '2026-11-02T10:00:00Z' });

  it('vence o updatedAt mais novo, nas duas ordens', () => {
    expect(versaoMaisNova(velho, novo).title).toBe('novo');
    expect(versaoMaisNova(novo, velho).title).toBe('novo');
    expect(versaoMaisNova(undefined, velho).title).toBe('velho');
  });

  it('empate: a nova vence', () => {
    const outra = card('a', { title: 'outra', updatedAt: velho.updatedAt });
    expect(versaoMaisNova(velho, outra).title).toBe('outra');
  });

  it('juntar listas: um por id, o mais novo', () => {
    const r = juntarPorIdMaisNovo([novo, card('b')], [velho]);
    expect(r.map(d => [d.id, d.title])).toEqual([
      ['a', 'novo'],
      ['b', 'Card b'],
    ]);
  });
});
