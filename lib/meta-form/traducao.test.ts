/**
 * Story 2.59 — AC2 (T3.1) e AC5 (T3.2): tradução Meta → opção do CRM e variantes
 * de telefone. Funções puras; cada valor da tabela `02-…` §6.2 é afirmado pelo
 * TEXTO FINAL, com acento — é o que o `select` do CRM compara.
 */
import { describe, expect, it } from 'vitest';
import { casar, chaveDaColuna, norm, TABELAS, traduzirLead, LIMITE_VALOR_CAMPO } from '@/lib/meta-form/traducao';
import { paraE164, variantesDoTelefone } from '@/lib/meta-form/telefone';

// Nomes REAIS das colunas do CSV exportado da Meta (cabeçalho lido em 29/09).
const COL = {
  paraQuem: 'para_quem_é_o_acompanhamento?',
  diagnostico: 'qual_é_a_sua_principal_condição_ou_diagnóstico?',
  tempo: 'há_quanto_tempo_ocorreu_a_lesão_ou_diagnóstico?',
  reab: 'você_já_realiza_algum_tipo_de_acompanhamento_ou_reabilitação?',
  quando: 'quando_pretende_iniciar?',
  faixa:
    'para_entendermos_melhor_suas_possibilidades_e_apresentarmos_as_opções_de_acompanhamento,_qual_faixa_de_investimento_mensal_você_considera_possível?',
  nome: 'nome_completo',
  email: 'email',
  fone: 'phone_number',
  endereco: 'endereço',
};

/** [coluna, valor da Meta, texto esperado no CRM] — TODOS os valores de §6.2. */
const CASOS: Array<[keyof typeof COL, string, string]> = [
  ['paraQuem', 'para_mim', 'Para mim'],
  ['paraQuem', 'para_um_familiar_ou_pessoa_próxima', 'Para um familiar ou pessoa próxima'],
  ['diagnostico', 'lesão_medular', 'Lesão medular'],
  ['diagnostico', 'avc', 'AVC'],
  ['diagnostico', 'tce_(traumatismo_cranioencefálico)', 'TCE (Traumatismo Cranioencefálico)'], // inferido
  ['diagnostico', 'outra_condição_neurológica', 'Outra condição neurológica'],
  ['tempo', 'menos_de_3_meses', 'Menos de 3 meses'],
  ['tempo', 'de_3_a_6_meses', 'De 3 a 6 meses'],
  ['tempo', 'de_6_meses_a_1_ano', 'De 6 meses a 1 ano'],
  ['tempo', 'de_1_a_3_anos', 'De 1 a 3 anos'],
  ['tempo', 'mais_de_3_anos', 'Mais de 3 anos'],
  ['reab', 'sim,_atualmente', 'Sim, atualmente'],
  ['reab', 'já_realizei,_mas_estou_sem_', 'Já realizei, mas estou sem acompanhamento'], // cortado pela Meta
  ['reab', 'nunca_realizei', 'Nunca realizei'],
  ['reab', 'estou_buscando_uma_segunda_opinião', 'Estou buscando uma segunda opinião'],
  ['quando', 'imediatamente', 'Imediatamente'],
  ['quando', 'nos_próximos_30_dias', 'Nos próximos 30 dias'],
  ['quando', 'ainda_estou_só_pesquisando', 'Ainda estou só pesquisando'],
  ['faixa', 'até_r$_500', 'Até R$ 500'],
  ['faixa', 'r$_500_a_r$_1.000', 'R$ 500 a R$ 1.000'],
  ['faixa', 'r$_1.000_a_r$_2.000', 'R$ 1.000 a R$ 2.000'], // inferido
  ['faixa', 'r$_2.000_a_r$_3.000', 'R$ 2.000 a R$ 3.000'], // inferido
  ['faixa', 'acima_de_r$_3.000', 'Acima de R$ 3.000'], // inferido
  ['faixa', 'ainda_não_sei_/_gostaria_de_entender_as_opções', 'Ainda não sei'],
];

const CHAVE: Record<string, string> = {
  paraQuem: 'paraQuemE',
  diagnostico: 'tipoDeLesao',
  tempo: 'haQuantoTempo',
  reab: 'jaFezReabilitacao',
  quando: 'quandoPretendeIniciar',
  faixa: 'faixaDeInvestimentoMensal',
};

describe('2.59 AC2 — tradução valor da Meta → opção do CRM', () => {
  it.each(CASOS)('%s: "%s" ⇒ "%s"', (col, valor, esperado) => {
    const r = traduzirLead([{ name: COL[col], values: [valor] }]);
    expect(r.campos[CHAVE[col] as keyof typeof r.campos]).toBe(esperado);
    expect(r.pulados).toEqual([]);
  });

  it('as 24 linhas da tabela cobrem TODAS as opções de todas as tabelas (nada fica sem teste)', () => {
    const cobertas = new Set(CASOS.map(([, , e]) => e));
    for (const tabela of Object.values(TABELAS)) {
      for (const [, opcao] of tabela) expect(cobertas.has(opcao)).toBe(true);
    }
  });

  it('valor NÃO mapeado não é gravado: vai para pulados com motivo, e a nota guarda o que a pessoa marcou', () => {
    const r = traduzirLead([
      { name: COL.diagnostico, values: ['esclerose_múltipla'] },
      { name: COL.faixa, values: ['mais_de_r$_10.000'] },
    ]);
    expect(r.campos).toEqual({});
    expect(r.pulados).toEqual([
      { campo: 'tipoDeLesao', motivo: 'valor_nao_mapeado' },
      { campo: 'faixaDeInvestimentoMensal', motivo: 'valor_nao_mapeado' },
    ]);
    expect(r.respostasParaNota.map((n) => n.resposta)).toEqual(['esclerose múltipla', 'mais de r$ 10.000']);
  });

  it('endereço completo, como digitado (F4), e cortado no limite de 500 da porta de campos', () => {
    const curto = traduzirLead([{ name: COL.endereco, values: ['Rua das Flores, 123 — Pouso Alegre/MG'] }]);
    expect(curto.campos.ondeReside).toBe('Rua das Flores, 123 — Pouso Alegre/MG');

    const longo = 'Rua '.padEnd(600, 'x');
    const r = traduzirLead([{ name: COL.endereco, values: [longo] }]);
    expect(r.campos.ondeReside).toHaveLength(LIMITE_VALOR_CAMPO);
    expect(r.pulados).toEqual([{ campo: 'ondeReside', motivo: 'valor_cortado_no_limite' }]);
  });

  it('contato sai das colunas padrão; telefone sem o "p:" do CSV; e-mail em minúsculas', () => {
    const r = traduzirLead([
      { name: COL.nome, values: ['Maria  da Silva'] },
      { name: COL.email, values: ['Maria@Exemplo.com'] },
      { name: COL.fone, values: ['p:+5535998205552'] },
    ]);
    expect(r.contato).toEqual({ nome: 'Maria da Silva', telefone: '+5535998205552', email: 'maria@exemplo.com' });
  });

  it('colunas acham a pergunta por prefixo, sem confundir "para quem" com "para entendermos"', () => {
    expect(chaveDaColuna(COL.paraQuem)).toBe('paraQuemE');
    expect(chaveDaColuna(COL.faixa)).toBe('faixaDeInvestimentoMensal');
    expect(chaveDaColuna('lead_status')).toBeNull();
    expect(chaveDaColuna('full_name')).toBe('nome');
  });

  it('norm e casar: tolerantes a acento, caixa e pontuação', () => {
    expect(norm('Já_Realizei,_Mas')).toBe('ja_realizei_mas');
    expect(casar('', TABELAS.paraQuemE)).toBeNull();
    expect(casar('xyz', TABELAS.paraQuemE)).toBeUndefined();
  });
});

describe('2.59 AC5 — variantes do telefone com e sem o 9º dígito', () => {
  it('celular COM 9 ⇒ procura também SEM (formato do WhatsApp)', () => {
    expect(variantesDoTelefone('p:+5535998205552')).toEqual({
      principal: '+5535998205552',
      variantes: ['+5535998205552', '+553598205552'],
    });
  });

  it('celular SEM 9 ⇒ procura também COM, e cria contato COM', () => {
    expect(variantesDoTelefone('+553598205552')).toEqual({
      principal: '+5535998205552',
      variantes: ['+5535998205552', '+553598205552'],
    });
  });

  it('fixo e estrangeiro: só a própria forma; lixo ⇒ null', () => {
    expect(variantesDoTelefone('+551133334444')?.variantes).toEqual(['+551133334444']);
    expect(variantesDoTelefone('+14155550100')?.variantes).toEqual(['+14155550100']);
    expect(variantesDoTelefone('abc')).toBeNull();
    expect(paraE164('5535998205552')).toBe('+5535998205552');
  });
});

describe('2.59 QA L3 — as 6 faixas de investimento, e nada além delas', () => {
  it.each([
    ['até_r$_500', 'Até R$ 500'],
    ['r$_500_a_r$_1.000', 'R$ 500 a R$ 1.000'],
    ['r$_1.000_a_r$_2.000', 'R$ 1.000 a R$ 2.000'],
    ['r$_2.000_a_r$_3.000', 'R$ 2.000 a R$ 3.000'],
    ['acima_de_r$_3.000', 'Acima de R$ 3.000'],
    ['ainda_não_sei_/_gostaria_de_entender_as_opções', 'Ainda não sei'],
  ])('"%s" ⇒ "%s"', (valor, esperado) => {
    expect(casar(valor, TABELAS.faixaDeInvestimentoMensal)).toBe(esperado);
  });

  it.each(['acima_de_r$_1.000', 'acima_de_r$_5.000', 'acima_de_r$_30.000'])(
    '"%s" NÃO vira "Acima de R$ 3.000" (não inventa faixa)',
    (valor) => {
      expect(casar(valor, TABELAS.faixaDeInvestimentoMensal)).toBeUndefined();
    }
  );
});
