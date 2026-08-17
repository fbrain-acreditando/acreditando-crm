/**
 * @fileoverview Story 2.43 — devolve à fila o item travado em `processing`.
 *
 * ## O buraco
 *
 * ```
 * 1. o item é travado:   status = 'processing'      (lock otimista, evita cobrar 2×)
 * 2. a função morre:     timeout / deploy / crash
 * 3. quem lê a fila:     where status = 'pending'    ⇒ o item nunca mais é visto
 * ```
 *
 * Não é sangria — é o oposto: o card fica sem nota e ninguém é cobrado. Mas é a
 * **única** forma de um lead sumir em definitivo.
 *
 * ## Sem cron novo (AC5)
 *
 * O resgate **pega carona** no que já roda: o disparo sob demanda, a rede diária
 * e o cron irmão. Em regime normal é um `UPDATE` que afeta **0 linhas**.
 *
 * O efeito prático é bom dos dois lados: fica **rápido** (qualquer lead novo
 * entrando em `Qualificado` já dispara um resgate) e **garantido** (a rede
 * diária roda mesmo sem tráfego nenhum).
 *
 * @module lib/ai/scoring/resgatarItensPresos
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { MAX_TENTATIVAS } from '@/lib/ai/scoring/filaDePontuacao';

/**
 * Idade mínima para um item ser considerado preso.
 *
 * ⚠️ Folga enorme de propósito sobre o maior `maxDuration` do caminho (300s no
 * lote, 60s no sob demanda). Item mais novo que isso **pode estar rodando** — e
 * resgatar quem está em voo faria a IA ser paga duas vezes pelo mesmo lead, que
 * é exatamente o que o lock existe para impedir.
 */
export const MINUTOS_PARA_RESGATE = 15;

export type ResultadoDoResgate =
    | { ok: true; pontuacoes: number; avaliacoes: number }
    | { ok: false; erro: string };

/**
 * Chama o resgate no banco. **Nunca lança.**
 *
 * O caminho principal (pontuar o lead) não pode cair porque a faxina falhou —
 * mas o erro também não pode sumir. Ele volta no retorno para entrar no corpo da
 * resposta, que é o que aparece no log da Vercel.
 *
 * 📌 `console.error` sozinho foi o que escondeu o problema de 13–16/08 por três
 *    dias: em produção ninguém lê.
 */
export async function resgatarItensPresos(
    supabase: SupabaseClient,
    minutos: number = MINUTOS_PARA_RESGATE
): Promise<ResultadoDoResgate> {
    try {
        const { data, error } = await supabase.rpc('resgatar_itens_presos', {
            p_minutos: minutos,
            // O teto vem do TypeScript — o SQL o recebe por parâmetro. Constante
            // duplicada é o defeito do `15` da carência, que este repo já
            // registrou vivendo em dois lugares.
            p_max_tentativas: MAX_TENTATIVAS,
        });

        if (error) {
            console.error('[resgate] falhou:', error.message);
            return { ok: false, erro: error.message };
        }

        const resultado = (data ?? {}) as { pontuacoes?: number; avaliacoes?: number };
        return {
            ok: true,
            pontuacoes: resultado.pontuacoes ?? 0,
            avaliacoes: resultado.avaliacoes ?? 0,
        };
    } catch (e) {
        const motivo = (e as Error).message;
        console.error('[resgate] excecao:', motivo);
        return { ok: false, erro: motivo };
    }
}
