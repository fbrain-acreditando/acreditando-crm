/**
 * @fileoverview Rótulo canônico → critério da nota (story 2.18b)
 *
 * Módulo **puro**. É a peça que mantém a promessa da story 2.18: a IA traduz
 * *frase* em *rótulo*; daqui em diante tudo é regra determinística.
 *
 * @module features/deals/criteriosNormalizados
 */

import type { CriterioId } from './leadScore';

// =============================================================================
// Rótulos
// =============================================================================

export const CAMPOS_NORMALIZAVEIS = [
    'ondeReside',
    'haQuantoTempo',
    'jaFezReabilitacao',
    'paraQuemE',
] as const;

export type CampoNormalizavel = (typeof CAMPOS_NORMALIZAVEIS)[number];

/**
 * Rótulos aceitos por campo. Espelha o CHECK da tabela
 * `normalizacao_de_criterio` — se um mudar, o outro tem de mudar junto.
 */
export const ROTULOS_POR_CAMPO: Record<CampoNormalizavel, readonly string[]> = {
    ondeReside: ['capital', 'grande_sp', 'interior_sp', 'outro_estado', 'indefinido'],
    haQuantoTempo: ['menos_de_1_ano', 'de_1_a_3_anos', 'mais_de_3_anos', 'indefinido'],
    jaFezReabilitacao: ['nunca_fez', 'ja_fez', 'fazendo_agora', 'indefinido'],
    paraQuemE: ['propria_pessoa', 'familiar', 'paciente_de_profissional', 'indefinido'],
} as const;

/** Qual critério da nota cada campo alimenta. */
export const CRITERIO_DO_CAMPO: Record<CampoNormalizavel, CriterioId> = {
    ondeReside: 'cidadeDeSaoPaulo',
    haQuantoTempo: 'lesaoRecente',
    jaFezReabilitacao: 'semReabilitacaoPrevia',
    paraQuemE: 'paraProprioLead',
};

/**
 * O rótulo que faz o critério BATER. Qualquer outro rótulo válido **refuta**;
 * `indefinido` e rótulo desconhecido viram `null`.
 */
const ROTULO_QUE_BATE: Record<CampoNormalizavel, string> = {
    ondeReside: 'capital',
    haQuantoTempo: 'menos_de_1_ano',
    jaFezReabilitacao: 'nunca_fez',
    paraQuemE: 'propria_pessoa',
};

// =============================================================================
// Canonicalização — tem de bater com `public.canonicalizar_valor` no banco
// =============================================================================

/**
 * Chave do dicionário: minúsculas, sem espaço nas pontas, espaços internos
 * colapsados.
 *
 * ⚠️ **Esta função e a SQL `canonicalizar_valor` têm de produzir exatamente a
 * mesma saída.** Se divergirem, o `join` falha em silêncio e o critério vira
 * "desconhecido" sem ninguém entender por quê — a mesma classe do
 * `Em qualificação ` com espaço no fim, da story 2.33.
 *
 * ⚠️ **Não remove acento**, de propósito: a versão SQL exigiria a extensão
 * `unaccent`. "Butantã" e "Butanta" são chaves diferentes e cada uma ganha sua
 * linha no dicionário — as duas podem apontar para o mesmo rótulo.
 */
export function canonicalizarValor(valor: string | null | undefined): string | null {
    if (valor === null || valor === undefined) return null;
    const limpo = valor.trim().replace(/\s+/g, ' ').toLowerCase();
    return limpo === '' ? null : limpo;
}

// =============================================================================
// Rótulo → critério
// =============================================================================

/**
 * Converte o rótulo canônico no estado do critério.
 *
 * @returns `true` bateu · `false` refutado · `null` desconhecido
 *
 * 🔑 A distinção `false` × `null` é o AC2 da story 2.18 e a razão de esta função
 * existir separada: `indefinido` **não** é "não mora na capital", é "não
 * sabemos onde mora". Tratar os dois igual foi o que reprovou a rev. 1.
 */
export function criterioDoRotulo(
    campo: CampoNormalizavel,
    rotulo: string | null | undefined
): boolean | null {
    if (!rotulo || rotulo === 'indefinido') return null;

    // Rótulo que não pertence ao campo é dado corrompido, não negativo. Devolver
    // `false` aqui seria inventar uma refutação a partir de um bug.
    if (!ROTULOS_POR_CAMPO[campo].includes(rotulo)) return null;

    return rotulo === ROTULO_QUE_BATE[campo];
}

/**
 * Resolve os quatro critérios normalizados de um deal a partir do dicionário já
 * aplicado (mapa `campo → rótulo`).
 *
 * Campo cujo valor não está no dicionário simplesmente não aparece no mapa — e
 * vira `null`, nunca `false`.
 */
export function criteriosNormalizadosDoDeal(
    rotulos: Partial<Record<CampoNormalizavel, string | null>>
): Partial<Record<CriterioId, boolean | null>> {
    const saida: Partial<Record<CriterioId, boolean | null>> = {};

    for (const campo of CAMPOS_NORMALIZAVEIS) {
        saida[CRITERIO_DO_CAMPO[campo]] = criterioDoRotulo(campo, rotulos[campo]);
    }

    return saida;
}
