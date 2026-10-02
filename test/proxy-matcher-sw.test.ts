/**
 * Story 2.61 — AC3a / AC4 (f): `/sw.js` fora do matcher do proxy de auth.
 *
 * ⚠️ LIMITAÇÃO: o Next interpreta `config.matcher` com path-to-regexp; aqui o
 * padrão é aplicado como RegExp crua (`^padrão$`), o que é uma APROXIMAÇÃO.
 * A prova que vale é o `curl -sI .../sw.js` sem login do AC5 (200, sem Location).
 */
import { describe, expect, it } from 'vitest';

import { config } from '@/proxy';

const casa = (path: string) => config.matcher.some((p) => new RegExp(`^${p}$`).test(path));

describe('proxy.ts matcher (story 2.61)', () => {
  it('/sw.js NÃO passa pelo proxy (nunca redireciona para /login)', () => {
    expect(casa('/sw.js')).toBe(false);
  });

  it('as 4 rotas autenticadas continuam protegidas', () => {
    for (const rota of ['/boards', '/inbox', '/contacts', '/activities']) {
      expect(casa(rota)).toBe(true);
    }
  });

  it('a exclusão é só do /sw.js exato, não de qualquer coisa que comece com "sw.js"', () => {
    expect(casa('/sw.jsx')).toBe(true);
  });
});
