/**
 * Story 2.74 (AC5, AC6, AC7) — os textos do cabeçalho do quadro, literais.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import type { Board } from '@/types';

vi.mock('../BoardSelector', () => ({ BoardSelector: () => null }));

import { KanbanHeader } from './KanbanHeader';
import { TEXTOS_DA_BUSCA_NO_BANCO, textoDoEstadoDaBusca } from '../../hooks/useCardsDoBanco';

const board = { id: 'board-1', name: 'Funil', stages: [] } as unknown as Board;

function renderizar(extra: Partial<React.ComponentProps<typeof KanbanHeader>> = {}) {
  return render(
    <KanbanHeader
      boards={[board]}
      activeBoard={board}
      onSelectBoard={vi.fn()}
      onCreateBoard={vi.fn()}
      viewMode="kanban"
      setViewMode={vi.fn()}
      searchTerm=""
      setSearchTerm={vi.fn()}
      ownerFilter="all"
      setOwnerFilter={vi.fn()}
      statusFilter="all"
      setStatusFilter={vi.fn()}
      onNewDeal={vi.fn()}
      {...extra}
    />
  );
}

describe('KanbanHeader — busca no banco (story 2.74)', () => {
  it('AC7 — placeholder "Buscar por nome, telefone ou empresa…"', () => {
    renderizar();
    expect(screen.getByPlaceholderText('Buscar por nome, telefone ou empresa…')).toBeInTheDocument();
  });

  it('🎯 AC6 — aviso novo quando o quadro bate no teto', () => {
    renderizar({ quadroNoTeto: true });
    expect(
      screen.getByText(
        'O quadro mostra os 1.000 cards com movimento mais recente. Para achar um card mais antigo, digite o nome ou o telefone na busca: ela procura em todos os cards.'
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/Cards mais antigos podem não aparecer/)).not.toBeInTheDocument();
  });

  it('sem teto, sem aviso', () => {
    renderizar({ quadroNoTeto: false });
    expect(screen.queryByText(/1\.000 cards com movimento/)).not.toBeInTheDocument();
  });

  it.each([
    ['procurando', 'Procurando também nos cards mais antigos…'],
    ['erro', 'Não deu para procurar nos cards mais antigos. Mostrando só os carregados.'],
    ['noLimite', 'Mostrando os 50 mais recentes encontrados no banco. Digite mais para refinar.'],
  ] as const)('AC5 — texto %s aparece literal com role="status"', (chave, literal) => {
    renderizar({ textoDaBusca: TEXTOS_DA_BUSCA_NO_BANCO[chave] });
    const el = screen.getByText(literal);
    expect(el).toHaveAttribute('role', 'status');
  });

  it('AC5 — "Inclui 2 cards mais antigos encontrados no banco."', () => {
    renderizar({ textoDaBusca: TEXTOS_DA_BUSCA_NO_BANCO.inclui(2) });
    expect(screen.getByText('Inclui 2 cards mais antigos encontrados no banco.')).toBeInTheDocument();
  });

  it('sem texto da busca, nada aparece', () => {
    const { container } = renderizar({ textoDaBusca: null });
    expect(container.textContent).not.toMatch(/cards mais antigos/);
  });
});

describe('textoDoEstadoDaBusca (AC5)', () => {
  it.each([
    [{ situacao: 'ociosa', total: 0, maisAntigos: 0 }, null],
    [{ situacao: 'procurando', total: 0, maisAntigos: 0 }, 'Procurando também nos cards mais antigos…'],
    [{ situacao: 'erro', total: 0, maisAntigos: 0 }, 'Não deu para procurar nos cards mais antigos. Mostrando só os carregados.'],
    [{ situacao: 'pronta', total: 3, maisAntigos: 0 }, null],
    [{ situacao: 'pronta', total: 3, maisAntigos: 1 }, 'Inclui 1 card mais antigo encontrado no banco.'],
    [{ situacao: 'pronta', total: 3, maisAntigos: 2 }, 'Inclui 2 cards mais antigos encontrados no banco.'],
    [{ situacao: 'pronta', total: 50, maisAntigos: 40 }, 'Mostrando os 50 mais recentes encontrados no banco. Digite mais para refinar.'],
  ] as const)('%j → %j', (estado, esperado) => {
    expect(textoDoEstadoDaBusca(estado)).toBe(esperado);
  });
});
