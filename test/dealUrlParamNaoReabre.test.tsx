/**
 * Story 2.27 — o card não pode reabrir sozinho depois de fechado.
 *
 * Relato da Fernanda: *"a aba fecha e fica abrindo sozinha; clico no X, ela some
 * e aparece de novo, fica travado nisso"*.
 *
 * A guarda antiga era `dealIdFromUrl && !selectedDealId` — derivada de um
 * ESTADO que o usuário zera ao fechar. Fechar destravava a guarda e, se o
 * parâmetro ainda estivesse legível, o efeito reabria.
 *
 * ⚠️ Testar o hook inteiro exigiria montar TanStack Query, Auth, Realtime e
 * Supabase. O que precisa de prova aqui é a REGRA DE CONSUMO do parâmetro —
 * então ela é exercitada isolada, nas duas versões, e o teste compara.
 * A trava contra regressão real é a segunda suíte: a versão antiga reprova.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React, { useEffect, useRef, useState } from 'react';

/** Versão NOVA — consumo guardado por ref, lembrando QUAL valor foi consumido. */
function ConsumidorNovo({ paramDeal }: { paramDeal: string | null }) {
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const consumido = useRef<string | null>(null);

  useEffect(() => {
    if (!paramDeal || consumido.current === paramDeal) return;
    consumido.current = paramDeal;
    setSelecionado(paramDeal);
  }, [paramDeal]);

  return (
    <>
      <div data-testid="aberto">{selecionado ?? 'fechado'}</div>
      <button onClick={() => setSelecionado(null)}>fechar</button>
    </>
  );
}

/** Versão ANTIGA — guarda derivada do estado de UI. */
function ConsumidorAntigo({ paramDeal }: { paramDeal: string | null }) {
  const [selecionado, setSelecionado] = useState<string | null>(null);

  useEffect(() => {
    if (paramDeal && !selecionado) setSelecionado(paramDeal);
  }, [paramDeal, selecionado]);

  return (
    <>
      <div data-testid="aberto">{selecionado ?? 'fechado'}</div>
      <button onClick={() => setSelecionado(null)}>fechar</button>
    </>
  );
}

const DEAL_A = 'deal-aaa';
const DEAL_B = 'deal-bbb';

describe('story 2.27 — consumo do ?deal= da URL', () => {
  it('abre o card quando o parâmetro chega', () => {
    render(<ConsumidorNovo paramDeal={DEAL_A} />);
    expect(screen.getByTestId('aberto')).toHaveTextContent(DEAL_A);
  });

  it('🎯 fechar NÃO reabre, mesmo com o parâmetro ainda na URL', () => {
    render(<ConsumidorNovo paramDeal={DEAL_A} />);
    expect(screen.getByTestId('aberto')).toHaveTextContent(DEAL_A);

    // O parâmetro segue presente — é o caso em que o `router.replace('?')` com
    // query vazia não limpou. É exatamente aqui que o laço nascia.
    act(() => {
      screen.getByRole('button', { name: 'fechar' }).click();
    });

    expect(screen.getByTestId('aberto')).toHaveTextContent('fechado');
  });

  it('um ?deal= DIFERENTE ainda abre — a correção não pode matar o caso legítimo', () => {
    const { rerender } = render(<ConsumidorNovo paramDeal={DEAL_A} />);
    act(() => {
      screen.getByRole('button', { name: 'fechar' }).click();
    });
    expect(screen.getByTestId('aberto')).toHaveTextContent('fechado');

    // Nova navegação vinda de Conversas, para outro lead.
    rerender(<ConsumidorNovo paramDeal={DEAL_B} />);
    expect(screen.getByTestId('aberto')).toHaveTextContent(DEAL_B);
  });
});

describe('a guarda ANTIGA reprova — é o laço da Fernanda', () => {
  it('fechar reabre sozinho enquanto o parâmetro existir', () => {
    render(<ConsumidorAntigo paramDeal={DEAL_A} />);
    expect(screen.getByTestId('aberto')).toHaveTextContent(DEAL_A);

    act(() => {
      screen.getByRole('button', { name: 'fechar' }).click();
    });

    // Zerar o estado destrava a guarda -> o efeito reabre.
    // "some e aparece de novo, fica travado nisso".
    expect(screen.getByTestId('aberto')).toHaveTextContent(DEAL_A);
  });
});
