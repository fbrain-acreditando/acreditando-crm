/**
 * @fileoverview Configuração de provedores de IA para o CRM.
 * 
 * Este módulo abstrai a criação de clientes de diferentes provedores de IA
 * (Google Gemini, OpenAI, Anthropic Claude), permitindo trocar entre eles
 * de forma transparente.
 * 
 * @module services/ai/config
 */

import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { AI_DEFAULT_MODELS, AI_DEFAULT_PROVIDER } from './defaults';

export type AIProvider = 'google';

/**
 * Formato válido de ID de modelo Google Gemini.
 *
 * Substitui a antiga lista branca fixa (`ALLOWED_GOOGLE_MODELS`), que congelava
 * os nomes de modelo no código: quando o Google aposentava uma versão, o CRM
 * caía no modelo padrão — que também acabava aposentado — e TODA a IA
 * respondia HTTP 404 (`This model is no longer available`), sem que nenhuma
 * configuração no painel pudesse corrigir.
 *
 * A lista real de modelos vem de `GET /api/ai/models`, que consulta a conta do
 * cliente na hora. Aqui validamos apenas o FORMATO — o motivo pelo qual a lista
 * branca existia: o ID é interpolado na URL da API do Google, então precisa ser
 * blindado contra path traversal e injeção de caminho/query.
 */
const GOOGLE_MODEL_ID_PATTERN = /^gemini-[a-z0-9.-]+$/;
const GOOGLE_MODEL_ID_MAX_LENGTH = 80;

/**
 * Valida o formato de um ID de modelo Google.
 *
 * @param modelId - ID do modelo a validar.
 * @returns `true` se o ID for seguro para uso na URL da API.
 */
export const isValidGoogleModelId = (modelId: string): boolean =>
    typeof modelId === 'string' &&
    modelId.length > 0 &&
    modelId.length <= GOOGLE_MODEL_ID_MAX_LENGTH &&
    GOOGLE_MODEL_ID_PATTERN.test(modelId);

/**
 * Cria e retorna uma instância do modelo de IA configurada.
 * 
 * Provedor único: Google Gemini. O modelo vem de `organization_settings.ai_model`
 * (escolhido pelo usuário na Central de I.A.); se estiver vazio ou em formato
 * inválido, cai no padrão `AI_DEFAULT_MODELS.google`.
 *
 * @param provider - Provedor de IA a ser utilizado.
 * @param apiKey - Chave de API do provedor.
 * @param modelId - ID do modelo específico (opcional, usa padrão se não informado).
 * @returns Instância configurada do modelo de IA.
 * @throws Error se a API key não for fornecida.
 *
 * @example
 * ```typescript
 * // Modelo escolhido pelo usuário
 * const model = getModel('google', 'sua-api-key', 'gemini-3-flash-preview');
 *
 * // Sem modelo → usa o padrão (alias -latest)
 * const model = getModel('google', 'sua-api-key', '');
 * ```
 */
export const getModel = (provider: AIProvider, apiKey: string, modelId: string) => {
    if (!apiKey) {
        throw new Error('API Key is missing');
    }

    const resolvedModel = isValidGoogleModelId(modelId)
        ? modelId
        : AI_DEFAULT_MODELS.google;

    const google = createGoogleGenerativeAI({ apiKey });
    return google(resolvedModel);
};

/**
 * Configuração de modelo para uso com env vars.
 */
export interface ModelConfig {
    provider?: AIProvider;
    model?: string;
}

/**
 * Retorna um modelo de IA usando variáveis de ambiente.
 *
 * Usa as seguintes env vars:
 * - GOOGLE_GENERATIVE_AI_API_KEY
 * - OPENAI_API_KEY
 * - ANTHROPIC_API_KEY
 *
 * @param config - Configuração opcional (provider e model)
 * @returns Instância configurada do modelo de IA
 *
 * @example
 * ```typescript
 * // Usa provider padrão (google) com model padrão
 * const model = getModelFromEnv();
 *
 * // Especifica provider e model
 * const model = getModelFromEnv({ provider: 'openai', model: 'gpt-4o-mini' });
 * ```
 */
export const getModelFromEnv = (config?: ModelConfig) => {
    const model = config?.model || '';
    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;

    if (!apiKey) {
        throw new Error('API Key for google not found in environment (GOOGLE_GENERATIVE_AI_API_KEY)');
    }

    return getModel(AI_DEFAULT_PROVIDER, apiKey, model);
};
