/**
 * @fileoverview Tabela única da loja do Instituto — story 2.64 (AC1, AC3, AC6, AC16).
 *
 * TUDO o que o pedido da loja pode ter mora aqui, num lugar só:
 *   • os 8 produtos (slug da página → nome do card → preço);
 *   • os 4 perfis ("Para quem é o produto?");
 *   • as versões do aviso de privacidade aceitas;
 *   • os uuids das 2 etapas novas e o perfil da Fernanda.
 *
 * A migration `…_produtos_de_treinamento.sql` grava as MESMAS opções; o teste
 * `test/stories/US-2.64-*.test.ts` lê a migration e compara com esta tabela —
 * se um lado mudar sem o outro, o teste quebra. Produto do card e preço SEMPRE
 * batem porque saem da mesma linha.
 *
 * Os slugs, nomes e preços são os da página (`site/api/lead.js`, objeto
 * `PRODUTOS`, campo `crm`), aprovados pela Izadira em 26/10 (decisão B1 do
 * Filipe: a story se ajusta à página, sem tradução no n8n).
 *
 * @module lib/instituto/catalogo
 */

// =============================================================================
// Versões do aviso de privacidade (AC3, AC16 — parecer 39 do pipeline)
// =============================================================================

/**
 * Versões do aviso de privacidade que a rota aceita.
 *
 * ⚠️ É AQUI que se muda. Mudou o texto do aviso na página = versão nova =
 * acrescentar nesta lista ANTES de publicar a página (senão todo pedido real
 * volta 422). A lista do n8n (story 2.65, AC3) tem de ter as mesmas.
 *
 * - `2026-10-v3` — a que a página publicada manda em 05/11 ("Ao continuar, você
 *   aceita os Termos de uso e a Política de Privacidade").
 * - `2026-11-v4` — a proposta pelo parecer LGPD do AC16 (pipeline 39, item 2.2:
 *   "Usamos seus dados só para responder ao seu pedido de compra…"). Aceita
 *   desde já para a troca não derrubar pedido: página aberta em cache ainda
 *   manda a v3 por um tempo. ✅ Texto aprovado pelo Filipe em 05/11
 *   (a página passa a mandar a v4 na story 2.65, T0).
 */
export const VERSOES_DO_AVISO_ACEITAS = ['2026-10-v3', '2026-11-v4'] as const;

// =============================================================================
// Produtos e perfis (AC1, AC3)
// =============================================================================

export interface ProdutoDaLoja {
  /** Nome gravado em `produtoDeTreinamento` — EXATAMENTE a opção do select da migration. */
  nome: string;
  /** Preço em reais; vai para `deals.value` (D9). */
  preco: number;
}

/** slug (o que a página manda em `produto`) → nome e preço. */
export const PRODUTOS_DA_LOJA = {
  'colete-suspensao-parcial': { nome: 'Colete para suspensão parcial de peso', preco: 869.9 },
  'luvas-inclusivas': { nome: 'Luvas inclusivas', preco: 185.9 },
  'bolsa-impermeavel': { nome: 'Bolsa impermeável', preco: 95.9 },
  'cinto-de-transferencia': { nome: 'Cinto de transferência', preco: 185.9 },
  'faixa-de-joelho': { nome: 'Faixa de joelho', preco: 49.9 },
  'kit-tornozeleira-tracao': { nome: 'Kit tornozeleira de tração horizontal', preco: 199.0 },
  'cinturao-de-musculacao': { nome: 'Cinturão de musculação', preco: 139.9 },
  'ats-pro': { nome: 'ATS Pró', preco: 179.9 },
} as const satisfies Record<string, ProdutoDaLoja>;

export type SlugDoProduto = keyof typeof PRODUTOS_DA_LOJA;
export const SLUGS_DOS_PRODUTOS = Object.keys(PRODUTOS_DA_LOJA) as [SlugDoProduto, ...SlugDoProduto[]];

/** perfil (o que a página manda) → opção gravada em `paraQuemEOProduto`. */
export const PERFIS_DA_LOJA = {
  para_mim: 'Para mim',
  familiar_ou_cuidador: 'Para um familiar ou pessoa de quem cuido',
  uso_profissional: 'Para uso profissional',
  outro: 'Outro',
} as const;

export type PerfilDaLoja = keyof typeof PERFIS_DA_LOJA;
export const VALORES_DOS_PERFIS = Object.keys(PERFIS_DA_LOJA) as [PerfilDaLoja, ...PerfilDaLoja[]];

// =============================================================================
// Campos do card (AC1, AC6) — chaves técnicas (E3: os RÓTULOS da tela mudam, as chaves não)
// =============================================================================

export const CAMPO_PRODUTO = 'produtoDeTreinamento';
export const CAMPO_PARA_QUEM = 'paraQuemEOProduto';
export const CAMPO_AVISO_EM = 'consentimentoEm';
export const CAMPO_AVISO_VERSAO = 'consentimentoVersao';
export const CAMPO_ORIGEM = 'origemDoLead';

/** Opção de `origemDoLead` — tem de bater, com acento e maiúsculas, com a migration. */
export const ORIGEM_LP_INSTITUTO = 'LP Instituto';

/** Origem (`contacts.source`) do contato que nasce por esta rota (AC4). */
export const SOURCE_LP_INSTITUTO = 'lp_instituto';

// =============================================================================
// Etapas e dono (AC1, AC5, AC6) — sempre por uuid, NUNCA por nome
// =============================================================================

/**
 * Etapa "Produtos de treinamento" — uuid fixo, gravado pela migration
 * `20261105120000_produtos_de_treinamento.sql` (D1).
 */
export const ETAPA_PRODUTOS_DE_TREINAMENTO = '2f8091f5-90a8-4eae-bd2a-12f0d44b9517';

/** Etapa "Produto vendido" — uuid fixo, gravado pela mesma migration (D8). */
export const ETAPA_PRODUTO_VENDIDO = '824878b0-2ab4-4c07-81d7-ec367b5ebd68';

/** As 2 etapas da loja (AC12, AC15). */
export const ETAPAS_DA_LOJA: ReadonlyArray<string> = [ETAPA_PRODUTOS_DE_TREINAMENTO, ETAPA_PRODUTO_VENDIDO];

/**
 * Etapas FECHADAS para a decisão desta rota (AC5, E8): Ganho · Perdido ·
 * Clientes · Produto vendido.
 *
 * ⚠️ De propósito DIFERENTE de `ESTAGIOS_TERMINAIS_ACREDITANDO`
 * (`lib/deals/cardAberto.ts`), que a guarda do WhatsApp usa e que NÃO muda
 * nesta story (P1 de 23/10, E8): lá "Produto vendido" segue aberto.
 */
export const ETAPAS_FECHADAS_PARA_A_LOJA: ReadonlyArray<string> = [
  'f359ee98-b7b1-460d-a7be-2ef92f92c4c7', // Ganho
  '78defbd3-6ca4-4b96-b67a-2268e7e6dce5', // Perdido
  '3ed212e5-32a9-4bda-8d70-bb8be49e790d', // Clientes
  ETAPA_PRODUTO_VENDIDO,
];

/**
 * Perfil da Fernanda (dona dos cards da loja, AC6). Lido do banco de produção
 * em 05/11/2026 (`profiles`, primeiro nome Fernanda, papel `vendedor`) pela
 * @data-engineer (pipeline 37) e relido pelo @dev no mesmo dia — ler, não presumir.
 */
export const DONA_DOS_PEDIDOS_DA_LOJA = '767d620e-5f13-4d25-a283-5b50141f02d8';

// =============================================================================
// Utilidades
// =============================================================================

/** `869.9` → `R$ 869,90`. */
export function precoEmReais(preco: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(preco).replace(/ /g, ' ');
}
