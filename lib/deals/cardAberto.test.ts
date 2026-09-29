/**
 * Story 2.59, T2.1 — "card aberto" do lado Next.js é a MESMA regra da guarda
 * da story 2.56 (Edge Function). Risco R5: as duas listas divergirem calado.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BOARD_ACREDITANDO,
  ESTAGIOS_TERMINAIS_ACREDITANDO,
  escolherCardAberto,
  estagiosTerminaisDoQuadro,
} from '@/lib/deals/cardAberto';

const GANHO = 'f359ee98-b7b1-460d-a7be-2ef92f92c4c7';
const PERDIDO = '78defbd3-6ca4-4b96-b67a-2268e7e6dce5';
const CLIENTES = '3ed212e5-32a9-4bda-8d70-bb8be49e790d';
const QUALIFICADO = '3b1384fa-5fe2-4725-a8e1-7576a8690637';
const PROPOSTA = '9f1b2a7a-e6b1-4e04-b041-87581fc6a8a9'; // " Proposta enviada", com espaço

const GUARDA_2_56 = path.resolve(
  __dirname,
  '../../supabase/functions/messaging-webhook-gptmaker/deal-guard.ts'
);
const guardaExiste = fs.existsSync(GUARDA_2_56);

describe('2.59 T2.1 — escolherCardAberto', () => {
  it('só terminais ⇒ não há card aberto (lead que volta ganha card novo)', () => {
    const r = escolherCardAberto(BOARD_ACREDITANDO, [
      { id: 'a', stage_id: GANHO, created_at: '2026-08-01' },
      { id: 'b', stage_id: PERDIDO, created_at: '2026-08-02' },
      { id: 'c', stage_id: CLIENTES, created_at: '2026-08-03' },
    ]);
    expect(r).toEqual({ temCardAberto: false, motivo: 'so-terminais', terminaisIgnorados: 3 });
  });

  it('mais de um aberto ⇒ o MAIS ANTIGO, mesmo fora de ordem na entrada', () => {
    const r = escolherCardAberto(BOARD_ACREDITANDO, [
      { id: 'novo', stage_id: QUALIFICADO, created_at: '2026-09-20T00:00:00Z' },
      { id: 'terminal', stage_id: PERDIDO, created_at: '2026-01-01T00:00:00Z' },
      { id: 'antigo', stage_id: PROPOSTA, created_at: '2026-09-01T00:00:00Z' },
    ]);
    expect(r).toEqual({ temCardAberto: true, dealId: 'antigo', stageId: PROPOSTA });
  });

  it('sem card ⇒ sem-card; card sem estágio conta como aberto', () => {
    expect(escolherCardAberto(BOARD_ACREDITANDO, [])).toEqual({ temCardAberto: false, motivo: 'sem-card' });
    expect(escolherCardAberto(BOARD_ACREDITANDO, [{ id: 'x', stage_id: null }])).toMatchObject({
      temCardAberto: true,
      dealId: 'x',
    });
  });

  it('quadro desconhecido ⇒ lista terminal vazia (tudo aberto)', () => {
    expect(estagiosTerminaisDoQuadro('00000000-0000-4000-8000-000000000000')).toEqual([]);
  });
});

describe('2.59 T2.1 — paridade com a guarda da 2.56 (deal-guard.ts)', () => {
  // A guarda da 2.56 vive na branch `feat/2.56-…` (em produção desde 26/09,
  // ainda não mesclada na `main`). Quando o arquivo existir na árvore, esta
  // comparação RODA. Sem ele, o motivo fica à vista — não é um "passou".
  it.skipIf(!guardaExiste)(
    'mesmo quadro e MESMOS 3 uuids terminais que a Edge Function (lido do arquivo, por id)',
    () => {
      const fonte = fs.readFileSync(GUARDA_2_56, 'utf8');
      const board = fonte.match(/BOARD_ACREDITANDO\s*=\s*["']([0-9a-f-]{36})["']/)?.[1];
      const bloco = fonte.match(/ESTAGIOS_TERMINAIS_ACREDITANDO[^=]*=\s*\[([\s\S]*?)\]/)?.[1] ?? '';
      const uuids = bloco.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? [];

      expect(board).toBe(BOARD_ACREDITANDO);
      expect(uuids.length).toBe(3);
      expect([...uuids].sort()).toEqual([...ESTAGIOS_TERMINAIS_ACREDITANDO].sort());
    }
  );

  it('registra por que a paridade não rodou quando a guarda ainda não está na árvore', () => {
    if (!guardaExiste) {
      console.warn(
        '[2.59 T2.1] deal-guard.ts (2.56) ausente nesta árvore — paridade PULADA. ' +
          'Roda sozinha depois do merge da 2.56 na main.'
      );
    }
    // A lista local é a lida do banco em 29/09 — âncora independente da guarda.
    expect([...ESTAGIOS_TERMINAIS_ACREDITANDO].sort()).toEqual([GANHO, PERDIDO, CLIENTES].sort());
  });
});
