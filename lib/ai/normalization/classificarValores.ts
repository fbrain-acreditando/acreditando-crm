/**
 * @fileoverview Classificação de valores de texto livre em rótulos canônicos
 * (story 2.18b)
 *
 * A IA entra **aqui e em nenhum outro lugar** desta funcionalidade: ela traduz
 * uma frase que o lead escreveu em um rótulo de uma lista fechada. A nota do
 * card continua sendo contagem determinística sobre esses rótulos.
 *
 * 🔑 Classifica **valores distintos**, não deals. São 198 valores para 318
 * deals — e um valor repetido nunca é reclassificado, porque já está no
 * dicionário.
 *
 * @module lib/ai/normalization/classificarValores
 */

import { generateText, Output } from 'ai';
import { z } from 'zod';
import { getModel, type AIProvider } from '../config';
import type { CampoNormalizavel } from '@/features/deals/criteriosNormalizados';
import { ROTULOS_POR_CAMPO } from '@/features/deals/criteriosNormalizados';

/**
 * Abaixo disto a IA não decide (AC5).
 *
 * Mais severo que o `MIN_CONFIDENCE_TO_STORE = 0.6` da extração de campos, e de
 * propósito: lá um erro afeta um deal e alguém lê na conversa; aqui o erro entra
 * no dicionário e é **reaproveitado silenciosamente** por todos os leads que
 * disserem a mesma frase.
 */
export const CONFIANCA_MINIMA = 0.7;

/** Quantos valores por chamada. Lote grande economiza chamada e piora a atenção do modelo. */
export const TAMANHO_DO_LOTE = 25;

const INSTRUCOES_POR_CAMPO: Record<CampoNormalizavel, string> = {
    ondeReside: `O texto diz onde a pessoa mora. Classifique:
- "capital": bairro, distrito ou zona da CIDADE de São Paulo (ex.: Sapopemba, Morumbi, Butantã, Itaquera, Brooklin, Vila Mariana, zona leste/sul/norte/oeste), ou a própria cidade de São Paulo.
- "grande_sp": municípios da Região Metropolitana que NÃO são a capital (ex.: Guarulhos, Osasco, Santo André, São Bernardo, São Caetano, Diadema, Cotia, Mauá, Barueri, Taboão da Serra).
- "interior_sp": outros municípios do estado de São Paulo (ex.: Campinas, Jundiaí, Sorocaba, Taubaté, Praia Grande, Santos, Itu, Araçatuba, Guaratinguetá).
- "outro_estado": fora do estado de São Paulo.
- "indefinido": não dá para saber. ⚠️ "SP" sozinho é AMBÍGUO (pode ser o estado) ⇒ "indefinido".`,

    haQuantoTempo: `O texto diz há quanto tempo a lesão aconteceu. Classifique:
- "menos_de_1_ano": até 12 meses (ex.: "6 meses", "3 meses", "esse ano", "recente", "em janeiro" quando indica o ano corrente).
- "de_1_a_3_anos": mais de 12 e até 36 meses.
- "mais_de_3_anos": acima de 36 meses (ex.: "desde 2015", "10 anos", "desde criança", "de nascença").
- "indefinido": o texto não permite calcular. Se houver um ANO, calcule a partir de 2026.`,

    jaFezReabilitacao: `O texto diz se a pessoa já fez ou faz reabilitação/fisioterapia. Classifique:
- "nunca_fez": nunca fez nenhuma (ex.: "não", "ainda não", "nunca").
- "ja_fez": fez no passado e NÃO está fazendo agora (ex.: "já passou, no momento não", "fiz por 2 anos").
- "fazendo_agora": está em tratamento (ex.: "faz fisioterapia 2x por semana", "está na Lucy Montoro", "faz natação e fisioterapia").
- "indefinido": não dá para saber.`,

    paraQuemE: `O texto diz para quem é o atendimento. Classifique:
- "propria_pessoa": para quem está falando (ex.: "para mim", "para si mesmo", "para ela mesma", "próprio").
- "familiar": para parente ou conhecido (ex.: "filho", "pai", "mãe", "irmão", "minha esposa", "familiar", "amigo").
- "paciente_de_profissional": quem fala é profissional de saúde perguntando por um paciente.
- "indefinido": não dá para saber.`,
};

const SYSTEM_PROMPT = `Você classifica respostas de leads de uma clínica de reabilitação de lesão medular.

Regras:
1. Escolha SEMPRE um rótulo da lista fornecida. Nunca invente rótulo.
2. Use "indefinido" quando o texto for ambíguo ou insuficiente. "indefinido" é uma resposta CORRETA, não uma falha — é melhor que um palpite.
3. A confiança deve refletir a ambiguidade real do texto, não o seu esforço.
4. Não infira além do que está escrito. "São Paulo" sem mais nada pode ser a cidade ou o estado.`;

export interface ValorClassificado {
    valorBruto: string;
    rotulo: string;
    confianca: number;
}

/**
 * Classifica um lote de valores distintos de UM campo.
 *
 * O schema usa `z.enum` com os rótulos do campo: o modelo **não consegue**
 * devolver rótulo fora da lista, então o CHECK da tabela nunca é exercitado por
 * erro de modelo — só por bug nosso.
 */
export async function classificarValores(
    campo: CampoNormalizavel,
    valores: string[],
    aiConfig: { provider: AIProvider; apiKey: string; model: string }
): Promise<ValorClassificado[]> {
    if (valores.length === 0) return [];

    const rotulos = ROTULOS_POR_CAMPO[campo] as readonly string[];

    const schema = z.object({
        classificacoes: z.array(
            z.object({
                valorBruto: z.string().describe('O texto original, copiado exatamente'),
                rotulo: z.enum(rotulos as [string, ...string[]]),
                confianca: z.number().min(0).max(1),
            })
        ),
    });

    const model = getModel(aiConfig.provider, aiConfig.apiKey, aiConfig.model);

    const result = await generateText({
        model,
        output: Output.object({
            schema,
            name: 'ClassificacaoDeValores',
            description: `Classificação de valores do campo ${campo}`,
        }),
        system: SYSTEM_PROMPT,
        prompt: `${INSTRUCOES_POR_CAMPO[campo]}

Classifique cada um dos textos abaixo. Devolva um item por texto, copiando o texto original em "valorBruto".

Textos:
${valores.map((v, i) => `${i + 1}. ${v}`).join('\n')}`,
        maxRetries: 2,
    });

    const saida = result.output?.classificacoes ?? [];

    // Confiança baixa não entra como decisão — vira `indefinido`, que o
    // `criterioDoRotulo` traduz em "desconhecido". A linha ainda é gravada para
    // que o valor não seja reclassificado a cada execução do backfill.
    return saida.map(c => ({
        valorBruto: c.valorBruto,
        rotulo: c.confianca < CONFIANCA_MINIMA ? 'indefinido' : c.rotulo,
        confianca: c.confianca,
    }));
}

/** Quebra em lotes do tamanho definido. */
export function emLotes<T>(itens: T[], tamanho = TAMANHO_DO_LOTE): T[][] {
    const lotes: T[][] = [];
    for (let i = 0; i < itens.length; i += tamanho) {
        lotes.push(itens.slice(i, i + tamanho));
    }
    return lotes;
}
