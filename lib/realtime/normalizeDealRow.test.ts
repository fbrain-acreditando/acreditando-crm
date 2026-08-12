/**
 * Story 2.29 — a tradução banco→app do Realtime.
 *
 * O oráculo destes testes é a implementação ANTIGA, reconstruída no fim do
 * arquivo: ela reprova exatamente nas asserções que importam. Sem isso, um
 * teste que passa não prova nada — foi a lição escrita na 2.26.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizarDealDoRealtime,
  mesclarDealDoRealtime,
  linhaDoRealtimeEhMaisNova,
} from './normalizeDealRow';
import type { DealView } from '@/types';

/** Como o card está no cache: já enriquecido pelo `dealsViewQueryFn`. */
const NO_CACHE = {
  id: 'deal-1',
  organizationId: 'org-1',
  title: 'Maria Silva',
  value: 0,
  probability: 0,
  status: 'stage-novo',
  isWon: false,
  isLost: false,
  priority: 'medium',
  boardId: 'board-1',
  contactId: 'contact-1',
  tags: [],
  customFields: { ondeReside: 'Santos', tipoDeLesao: 'Medular' },
  createdAt: '2026-08-01T10:00:00.000Z',
  updatedAt: '2026-08-12T10:00:00.000Z',
  items: [{ id: 'item-1', organizationId: 'org-1', productId: 'p1', name: 'Kit', quantity: 1, price: 10 }],
  owner: { name: 'Fernanda', avatar: 'f.png' },
  // Enriquecimento que a tabela `deals` NÃO tem:
  companyName: 'Sem empresa',
  contactName: 'Maria Silva',
  contactEmail: 'maria@exemplo.com',
  stageLabel: 'Lead novo',
} as unknown as DealView;

/** A linha como o Postgres a entrega no Realtime: snake_case, linha inteira. */
const LINHA_DO_BANCO: Record<string, unknown> = {
  id: 'deal-1',
  organization_id: 'org-1',
  title: 'Maria Silva',
  value: 0,
  probability: 0,
  stage_id: 'stage-novo', // MESMO estágio — editar campo não move o card
  is_won: false,
  is_lost: false,
  priority: 'medium',
  board_id: 'board-1',
  contact_id: 'contact-1',
  tags: [],
  custom_fields: { ondeReside: 'Guarulhos', tipoDeLesao: 'Medular' },
  loss_reason: 'Distância',
  created_at: '2026-08-01T10:00:00.000Z',
  updated_at: '2026-08-12T10:00:05.000Z',
};

describe('mesclarDealDoRealtime — o defeito que a Fernanda viu', () => {
  it('🎯 `custom_fields` chega como `customFields` — o campo salvo aparece sem F5', () => {
    const resultado = mesclarDealDoRealtime(NO_CACHE, LINHA_DO_BANCO);

    expect(resultado.customFields).toEqual({ ondeReside: 'Guarulhos', tipoDeLesao: 'Medular' });
  });

  it('não sobra chave em snake_case no cache — o valor novo não fica escondido', () => {
    const resultado = mesclarDealDoRealtime(NO_CACHE, LINHA_DO_BANCO) as Record<string, unknown>;

    expect(resultado.custom_fields).toBeUndefined();
    expect(resultado.stage_id).toBeUndefined();
    expect(resultado.updated_at).toBeUndefined();
    expect(resultado.loss_reason).toBeUndefined();
  });

  it('cobre coluna que a lista antiga nem conhecia (`loss_reason`)', () => {
    const resultado = mesclarDealDoRealtime(NO_CACHE, LINHA_DO_BANCO);

    expect(resultado.lossReason).toBe('Distância');
  });

  it('preserva o enriquecimento que a tabela `deals` não carrega', () => {
    const resultado = mesclarDealDoRealtime(NO_CACHE, LINHA_DO_BANCO);

    // Sem isso, cada evento de Realtime apagaria o nome do contato do card.
    expect(resultado.contactName).toBe('Maria Silva');
    expect(resultado.companyName).toBe('Sem empresa');
    expect(resultado.stageLabel).toBe('Lead novo');
    expect(resultado.owner).toEqual({ name: 'Fernanda', avatar: 'f.png' });
    expect(resultado.items).toHaveLength(1);
  });

  it('o `stage_id` continua sendo a fonte de verdade do estágio', () => {
    const movido = { ...LINHA_DO_BANCO, stage_id: 'stage-qualificado' };

    expect(mesclarDealDoRealtime(NO_CACHE, movido).status).toBe('stage-qualificado');
  });
});

describe('normalizarDealDoRealtime — deal que ainda não está no cache', () => {
  it('entra traduzido, não cru', () => {
    const novo = normalizarDealDoRealtime(LINHA_DO_BANCO) as unknown as Record<string, unknown>;

    // Antes a linha crua era empurrada para o cache com `[...old, newData]`,
    // e o card nascia com todos os campos vazios até o próximo fetch.
    expect(novo.customFields).toEqual({ ondeReside: 'Guarulhos', tipoDeLesao: 'Medular' });
    expect(novo.status).toBe('stage-novo');
    expect(novo.custom_fields).toBeUndefined();
  });
});

describe('linhaDoRealtimeEhMaisNova — a proteção contra o card pular de volta', () => {
  it('aplica evento mais novo mesmo com o estágio IGUAL (era o que a regra antiga descartava)', () => {
    expect(linhaDoRealtimeEhMaisNova('2026-08-12T10:00:00.000Z', '2026-08-12T10:00:05.000Z')).toBe(true);
  });

  it('descarta evento fora de ordem (mais antigo que o cache)', () => {
    expect(linhaDoRealtimeEhMaisNova('2026-08-12T10:00:05.000Z', '2026-08-12T10:00:00.000Z')).toBe(false);
  });

  it('empate aplica — evento repetido é idempotente', () => {
    expect(linhaDoRealtimeEhMaisNova('2026-08-12T10:00:00.000Z', '2026-08-12T10:00:00.000Z')).toBe(true);
  });

  it('sem timestamp de um dos lados, aplica — perder atualização calado é pior', () => {
    expect(linhaDoRealtimeEhMaisNova(undefined, '2026-08-12T10:00:00.000Z')).toBe(true);
    expect(linhaDoRealtimeEhMaisNova('2026-08-12T10:00:00.000Z', undefined)).toBe(true);
    expect(linhaDoRealtimeEhMaisNova('nao-e-data', '2026-08-12T10:00:00.000Z')).toBe(true);
  });
});

/**
 * ⚖️ CONTROLE — a implementação ANTIGA, reconstruída.
 *
 * O código defeituoso era inline num hook de 1.019 linhas: não dá para
 * `git stash` só ele. Reconstruí-lo aqui e submetê-lo às MESMAS asserções é o
 * que prova que os testes acima discriminam — e não que passariam de qualquer
 * jeito.
 */
describe('CONTROLE — a normalização antiga reprova nas mesmas asserções', () => {
  const normalizacaoAntiga = (deal: Record<string, unknown>, newData: Record<string, unknown>) => {
    const normalizedData: Record<string, unknown> = { ...newData };
    if (newData.updated_at && !newData.updatedAt) {
      normalizedData.updatedAt = newData.updated_at;
      delete normalizedData.updated_at;
    }
    if (newData.created_at && !newData.createdAt) {
      normalizedData.createdAt = newData.created_at;
      delete normalizedData.created_at;
    }
    if (newData.stage_id !== undefined) {
      normalizedData.status = newData.stage_id;
      delete normalizedData.stage_id;
    }
    if (newData.is_won !== undefined && newData.isWon === undefined) {
      normalizedData.isWon = newData.is_won;
      delete normalizedData.is_won;
    }
    if (newData.is_lost !== undefined && newData.isLost === undefined) {
      normalizedData.isLost = newData.is_lost;
      delete normalizedData.is_lost;
    }
    return { ...deal, ...normalizedData };
  };

  it('a antiga deixa `customFields` com o valor VELHO', () => {
    const antiga = normalizacaoAntiga(NO_CACHE as unknown as Record<string, unknown>, LINHA_DO_BANCO);

    expect(antiga.customFields).toEqual({ ondeReside: 'Santos', tipoDeLesao: 'Medular' });
    expect(antiga.custom_fields).toEqual({ ondeReside: 'Guarulhos', tipoDeLesao: 'Medular' });
  });

  it('a antiga também perde `loss_reason`', () => {
    const antiga = normalizacaoAntiga(NO_CACHE as unknown as Record<string, unknown>, LINHA_DO_BANCO);

    expect(antiga.lossReason).toBeUndefined();
  });

  it('e a guarda antiga (por estágio) descartava a linha inteira quando o card não movia', () => {
    const guardaAntigaDescarta = (statusDoCache: string, stageIdDaLinha: string) =>
      statusDoCache === stageIdDaLinha;

    expect(guardaAntigaDescarta(NO_CACHE.status, LINHA_DO_BANCO.stage_id as string)).toBe(true);
  });
});
