/**
 * @fileoverview A IA lê a conversa e pontua o lead (story 2.35)
 *
 * Cinco itens, cada um **0 ou 1**, somados **por nós** — o modelo classifica,
 * ele não soma (exigência do @po: um erro de aritmética do modelo seria
 * indistinguível de um erro de julgamento).
 *
 * ⚠️ Esta é a peça em que a story 2.18 foi revertida: lá, *"pedir a nota ao
 * modelo torna o resultado não auditável"* estava em "fora de escopo". O Filipe
 * reverteu em 12/08, e a mitigação é o `motivo` gravado em cada item — sem ele a
 * nota vira opinião sem recurso.
 *
 * @module lib/ai/scoring/pontuarLead
 */

import { generateText, Output } from 'ai';
import { z } from 'zod';
import { getModel, type AIProvider } from '../config';
import { CRITERIOS, type CriterioId } from '@/features/deals/leadScore';

/** O que a IA precisa julgar, na linguagem da operação. */
const PERGUNTA_DO_CRITERIO: Record<CriterioId, string> = {
    roteiroCompleto:
        'O lead respondeu às perguntas de qualificação até o fim, em vez de abandonar no meio da conversa?',
    cidadeDeSaoPaulo:
        'O lead mora na CIDADE de São Paulo (capital)? Bairro ou zona da capital conta como SIM (ex.: Sapopemba, Morumbi, Butantã, Itaquera, zona leste). Grande São Paulo NÃO conta (Guarulhos, Osasco, Santo André, São Bernardo, São Caetano, Cotia, Diadema). Interior e outros estados NÃO contam (Campinas, Jundiaí, Santos, Praia Grande).',
    lesaoRecente:
        'A lesão aconteceu há MENOS de um ano? Se houver um ano, calcule a partir de 2026.',
    semReabilitacaoPrevia:
        'O lead ainda NÃO fez reabilitação/fisioterapia em nenhum lugar? Quem está fazendo agora ou já fez antes NÃO atende.',
    paraProprioLead:
        'O atendimento é para a PRÓPRIA pessoa que está conversando (e não para um filho, pai, cônjuge ou outro familiar)?',
};

const SYSTEM_PROMPT = `Você avalia conversas de leads de uma clínica de reabilitação de lesão medular, para ajudar a atendente a decidir quem ligar primeiro.

Regras:
1. Responda cada item com 1 (atende) ou 0 (não atende).
2. Baseie-se SÓ no que está na conversa. Não deduza o que não foi dito.
3. Se a conversa não disser, responda 0 e diga isso no motivo — "não atende" e "não informado" valem o mesmo ponto, mas o motivo tem de deixar claro qual é o caso.
4. O motivo é curto (uma frase) e cita o que a pessoa disse.
5. Não julgue a gravidade clínica nem faça recomendação de tratamento.`;

export interface ItemPontuado {
    id: CriterioId;
    atende: 0 | 1;
    motivo: string;
}

export interface PontuacaoDoLead {
    /** Soma dos `atende` — calculada AQUI, nunca pelo modelo. */
    score: number;
    /** Sempre 5 nesta story: o 0/1 elimina o estado "desconhecido". */
    known: number;
    itens: ItemPontuado[];
}

/** Motivo usado quando o modelo simplesmente não devolveu o item. */
export const MOTIVO_NAO_AVALIADO = 'A IA não avaliou este item.';

/**
 * Consolida a resposta do modelo em nota — **função pura, o coração testável**.
 *
 * Duas garantias que o modelo não dá:
 *
 * 1. **A soma é nossa.** Se o modelo mandasse o total, um erro de conta dele
 *    passaria por erro de julgamento e ninguém saberia qual foi.
 * 2. **Item que faltou vale 0, com motivo próprio.** Nunca 1 — inventar ponto a
 *    partir de omissão é o pior defeito possível numa fila de prioridade. E o
 *    motivo distingue *"avaliei e não atende"* de *"não avaliei"*, que valem o
 *    mesmo ponto e significam coisas diferentes para quem lê o card
 *    (exigência do @po).
 */
export function consolidarPontuacao(
    respostaDoModelo: Array<{ id?: string; atende?: number; motivo?: string }>
): PontuacaoDoLead {
    const porId = new Map<string, { atende?: number; motivo?: string }>();
    for (const item of respostaDoModelo ?? []) {
        if (item?.id) porId.set(item.id, item);
    }

    const itens: ItemPontuado[] = CRITERIOS.map(id => {
        const bruto = porId.get(id);

        // `=== 1` e não truthy: qualquer coisa que não seja exatamente 1 é 0.
        // Um modelo que devolvesse `atende: 2` não pode virar ponto.
        const atende: 0 | 1 = bruto?.atende === 1 ? 1 : 0;

        return {
            id,
            atende,
            motivo: bruto ? (bruto.motivo?.trim() || MOTIVO_NAO_AVALIADO) : MOTIVO_NAO_AVALIADO,
        };
    });

    return {
        score: itens.reduce((soma, i) => soma + i.atende, 0),
        known: CRITERIOS.length,
        itens,
    };
}

/**
 * Chama o modelo e devolve a pontuação consolidada.
 *
 * @param conversa texto da conversa, já montado pelo chamador
 */
export async function pontuarLead(
    conversa: string,
    aiConfig: { provider: AIProvider; apiKey: string; model: string }
): Promise<PontuacaoDoLead> {
    const schema = z.object({
        itens: z.array(
            z.object({
                id: z.enum(CRITERIOS as unknown as [string, ...string[]]),
                atende: z.number().int().min(0).max(1),
                motivo: z.string(),
            })
        ),
    });

    const model = getModel(aiConfig.provider, aiConfig.apiKey, aiConfig.model);

    const listaDeItens = CRITERIOS.map(
        id => `- ${id}: ${PERGUNTA_DO_CRITERIO[id]}`
    ).join('\n');

    const result = await generateText({
        model,
        output: Output.object({
            schema,
            name: 'PontuacaoDoLead',
            description: 'Avaliação de 5 itens de prioridade, 0 ou 1 cada',
        }),
        system: SYSTEM_PROMPT,
        prompt: `Itens a avaliar (responda TODOS os cinco):
${listaDeItens}

Conversa:
${conversa}`,
        maxRetries: 2,
    });

    return consolidarPontuacao(result.output?.itens ?? []);
}
