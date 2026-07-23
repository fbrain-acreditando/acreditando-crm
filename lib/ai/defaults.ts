/**
 * Defaults por provider — fonte única de verdade.
 * Usados apenas como fallback quando o banco retorna null
 * (ex: org recém-criada antes do primeiro save).
 *
 * ⚠️ Usar SEMPRE um alias `-latest` como padrão, nunca uma versão fixa.
 * Aliases são reapontados pelo Google conforme os modelos evoluem; versões
 * fixas são aposentadas e passam a responder HTTP 404, derrubando toda a IA
 * do CRM sem que o painel consiga corrigir (foi o que aconteceu com
 * `gemini-2.0-flash`).
 */
export const AI_DEFAULT_MODELS = {
  google: 'gemini-flash-latest',
} as const;

export const AI_DEFAULT_PROVIDER = 'google' as const;
