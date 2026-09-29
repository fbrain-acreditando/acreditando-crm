/**
 * @fileoverview Tradução do formulário instantâneo da Meta → campos do card —
 * story 2.59, AC2 (T3.1). Função pura, sem banco.
 *
 * A Meta devolve cada resposta como um "slug" da opção marcada
 * (`para_um_familiar_ou_pessoa_próxima`, `r$_500_a_r$_1.000`) e às vezes CORTA
 * o texto (`já_realizei,_mas_estou_sem_`). O card da Fernanda precisa do texto
 * da opção, com acento — e o campo `select` do CRM compara ignorando maiúscula,
 * mas NÃO acento (`customFields.schemas.ts:95-102`). Valor inventado ou sem
 * acento seria descartado calado.
 *
 * Regras (tabela de `02-data-engineer-campos-no-crm.md` §6):
 *   • normalização tolerante a acento, underscore, pontuação e caixa;
 *   • casamento por PREFIXO (a Meta corta valor longo);
 *   • pergunta achada por prefixo do nome da coluna (a Meta muda a chave se o
 *     texto da pergunta mudar);
 *   • valor NÃO mapeado ⇒ o campo NÃO é gravado e vai para `pulados` com motivo.
 *     Nunca se grava o valor cru num campo que a Fernanda lê (§6.3).
 *
 * @module lib/meta-form/traducao
 */

/** Chaves do card que recebem resposta do formulário (AC2). */
export type ChaveResposta =
  | 'paraQuemE'
  | 'tipoDeLesao'
  | 'haQuantoTempo'
  | 'jaFezReabilitacao'
  | 'ondeReside'
  | 'quandoPretendeIniciar'
  | 'faixaDeInvestimentoMensal';

/** Limite da porta de campos personalizados (`aiExtraction.ts:52-66`). */
export const LIMITE_VALOR_CAMPO = 500;

/** Formato `field_data` da Graph API da Meta (e o que o script do CSV monta). */
export interface CampoMeta {
  name: string;
  values?: Array<string | null | undefined> | null;
}

export type MotivoPulado =
  | 'valor_nao_mapeado'
  | 'campo_ja_preenchido'
  | 'valor_cortado_no_limite';

export interface CampoPulado {
  campo: string;
  motivo: MotivoPulado;
}

export interface RespostaParaNota {
  chave: ChaveResposta;
  pergunta: string;
  /** Texto da opção (com acento) ou, se não mapeado, o valor da Meta legível. */
  resposta: string;
}

export interface LeadTraduzido {
  contato: { nome: string | null; telefone: string | null; email: string | null };
  /** Só o que foi traduzido com certeza — é o que pode ir para o card. */
  campos: Partial<Record<ChaveResposta, string>>;
  pulados: CampoPulado[];
  /** Todas as respostas como a pessoa marcou, para a nota do histórico (AC4, P2). */
  respostasParaNota: RespostaParaNota[];
}

// =============================================================================
// Normalização
// =============================================================================

/** Minúsculas, sem acento, tudo que não é letra/número vira `_`, sem `_` nas pontas. */
export function norm(s: unknown): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Valor da Meta "legível" para a nota quando não há tradução: sem underscore. */
function legivel(valor: string): string {
  return valor.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

// =============================================================================
// Tabelas (prefixo normalizado → texto gravado no CRM) — `02-…` §6.2
// =============================================================================

type Tabela = ReadonlyArray<readonly [prefixo: string, opcao: string]>;

export const TABELAS: Record<Exclude<ChaveResposta, 'ondeReside'>, Tabela> = {
  paraQuemE: [
    ['para_mim', 'Para mim'],
    ['para_um_familiar', 'Para um familiar ou pessoa próxima'],
  ],
  tipoDeLesao: [
    ['lesao_medular', 'Lesão medular'],
    ['avc', 'AVC'],
    ['tce', 'TCE (Traumatismo Cranioencefálico)'],
    ['outra_condicao', 'Outra condição neurológica'],
  ],
  haQuantoTempo: [
    ['menos_de_3', 'Menos de 3 meses'],
    ['de_3_a_6', 'De 3 a 6 meses'],
    ['de_6_meses', 'De 6 meses a 1 ano'],
    ['de_1_a_3', 'De 1 a 3 anos'],
    ['mais_de_3', 'Mais de 3 anos'],
  ],
  jaFezReabilitacao: [
    ['sim', 'Sim, atualmente'],
    ['ja_realizei', 'Já realizei, mas estou sem acompanhamento'],
    ['nunca', 'Nunca realizei'],
    ['estou_buscando', 'Estou buscando uma segunda opinião'],
  ],
  quandoPretendeIniciar: [
    ['imediatamente', 'Imediatamente'],
    ['nos_proximos', 'Nos próximos 30 dias'],
    ['ainda_estou', 'Ainda estou só pesquisando'],
  ],
  // ⚠️ `r_500_a` e `r_1_000_a` não colidem: norm("r$_1.000_a…") = "r_1_000_a…".
  faixaDeInvestimentoMensal: [
    ['ainda_nao_sei', 'Ainda não sei'],
    ['ate_r_500', 'Até R$ 500'],
    ['r_500_a', 'R$ 500 a R$ 1.000'],
    ['r_1_000_a', 'R$ 1.000 a R$ 2.000'],
    ['r_2_000_a', 'R$ 2.000 a R$ 3.000'],
    // L3 do QA: `acima` sozinho casaria "acima de R$ 1.000" e inventaria a faixa.
    ['acima_de_r_3_000', 'Acima de R$ 3.000'],
  ],
};

/** Casa por prefixo. `null` = vazio; `undefined` = não mapeado. */
export function casar(valor: unknown, tabela: Tabela): string | null | undefined {
  const v = norm(valor);
  if (!v) return null;
  for (const [prefixo, opcao] of tabela) if (v.startsWith(prefixo)) return opcao;
  return undefined;
}

// =============================================================================
// Perguntas (coluna da Meta → chave do card)
// =============================================================================

export const PERGUNTAS: Record<ChaveResposta, string> = {
  paraQuemE: 'Para quem é o acompanhamento?',
  tipoDeLesao: 'Qual é a sua principal condição ou diagnóstico?',
  haQuantoTempo: 'Há quanto tempo ocorreu a lesão ou diagnóstico?',
  jaFezReabilitacao: 'Você já realiza algum tipo de acompanhamento ou reabilitação?',
  quandoPretendeIniciar: 'Quando pretende iniciar?',
  faixaDeInvestimentoMensal: 'Faixa de investimento mensal',
  ondeReside: 'Endereço',
};

/** Ordem em que as respostas aparecem na nota (a do formulário). */
export const ORDEM_DAS_PERGUNTAS: ReadonlyArray<ChaveResposta> = [
  'paraQuemE',
  'tipoDeLesao',
  'haQuantoTempo',
  'jaFezReabilitacao',
  'quandoPretendeIniciar',
  'faixaDeInvestimentoMensal',
  'ondeReside',
];

/** Coluna da Meta (normalizada) → chave do card. `null` = não é pergunta de resposta. */
export function chaveDaColuna(nomeColuna: string): ChaveResposta | 'nome' | 'telefone' | 'email' | null {
  const c = norm(nomeColuna);
  if (!c) return null;
  // Contato primeiro: "email" e "phone_number" são padrão da Meta.
  if (c === 'full_name' || c.startsWith('nome')) return 'nome';
  if (c === 'phone_number' || c.startsWith('telefone') || c.startsWith('celular')) return 'telefone';
  if (c === 'email' || c.startsWith('e_mail')) return 'email';

  if (c.startsWith('para_quem')) return 'paraQuemE';
  if (c.startsWith('qual_e_a_sua_principal')) return 'tipoDeLesao';
  if (c.startsWith('ha_quanto_tempo')) return 'haQuantoTempo';
  if (c.startsWith('voce_ja_realiza')) return 'jaFezReabilitacao';
  if (c.startsWith('quando_pretende')) return 'quandoPretendeIniciar';
  if (c.startsWith('para_entendermos_melhor') || c.includes('investimento')) return 'faixaDeInvestimentoMensal';
  if (c.startsWith('endereco') || c === 'street_address') return 'ondeReside';
  return null;
}

/** Primeiro valor não vazio do campo. */
function primeiroValor(campo: CampoMeta): string | null {
  for (const v of campo.values ?? []) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

/** Remove o prefixo que o CSV da Meta põe no telefone (`p:+55…`). */
export function limparTelefoneMeta(valor: string): string {
  return valor.replace(/^p:/i, '').trim();
}

// =============================================================================
// Tradução do lead inteiro
// =============================================================================

export function traduzirLead(fieldData: ReadonlyArray<CampoMeta>): LeadTraduzido {
  const contato: LeadTraduzido['contato'] = { nome: null, telefone: null, email: null };
  const campos: LeadTraduzido['campos'] = {};
  const pulados: CampoPulado[] = [];
  const nota = new Map<ChaveResposta, RespostaParaNota>();

  for (const campo of fieldData) {
    const destino = chaveDaColuna(campo.name);
    if (!destino) continue;
    const valor = primeiroValor(campo);
    if (valor === null) continue;

    if (destino === 'nome') {
      contato.nome = contato.nome ?? valor.replace(/\s+/g, ' ');
      continue;
    }
    if (destino === 'telefone') {
      contato.telefone = contato.telefone ?? limparTelefoneMeta(valor);
      continue;
    }
    if (destino === 'email') {
      contato.email = contato.email ?? valor.toLowerCase();
      continue;
    }
    if (nota.has(destino)) continue; // pergunta repetida: vale a primeira

    if (destino === 'ondeReside') {
      // F4: endereço completo, como digitado — só respeitando o limite da porta.
      const endereco = valor.replace(/\s+/g, ' ');
      if (endereco.length > LIMITE_VALOR_CAMPO) {
        campos.ondeReside = endereco.slice(0, LIMITE_VALOR_CAMPO);
        pulados.push({ campo: 'ondeReside', motivo: 'valor_cortado_no_limite' });
      } else {
        campos.ondeReside = endereco;
      }
      nota.set('ondeReside', { chave: 'ondeReside', pergunta: PERGUNTAS.ondeReside, resposta: endereco });
      continue;
    }

    const opcao = casar(valor, TABELAS[destino]);
    if (opcao) {
      campos[destino] = opcao;
      nota.set(destino, { chave: destino, pergunta: PERGUNTAS[destino], resposta: opcao });
    } else {
      // Não mapeado: NÃO grava no campo; a nota guarda o que a pessoa marcou.
      pulados.push({ campo: destino, motivo: 'valor_nao_mapeado' });
      nota.set(destino, { chave: destino, pergunta: PERGUNTAS[destino], resposta: legivel(valor) });
    }
  }

  const respostasParaNota = ORDEM_DAS_PERGUNTAS.flatMap((k) => (nota.has(k) ? [nota.get(k)!] : []));
  return { contato, campos, pulados, respostasParaNota };
}
