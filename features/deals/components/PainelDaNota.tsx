/**
 * @fileoverview Painel da nota de prioridade (story 2.18 — AC4 e AC5)
 *
 * Mostra **por que** o lead tem aquela nota e deixa a Fernanda **discordar**.
 *
 * AC5: *"nota que não se explica vira nota que ninguém confia"*. Por isso os três
 * grupos aparecem separados — o que bateu, o que foi refutado e o que ainda não
 * se sabe. Esconder os desconhecidos faria a nota parecer mais certa do que é.
 *
 * AC4: a fala dela, literal — *"putz, mas não é isso aqui, acho que é três
 * estrelas. Você vai lá e muda."*
 *
 * @module features/deals/components/PainelDaNota
 */

import React, { useState } from 'react';
import { Check, X, HelpCircle, Star, Undo2 } from 'lucide-react';
import { ROTULO_DO_CRITERIO, type CriterioId } from '../leadScore';

interface Props {
    score: number | null | undefined;
    known: number | null | undefined;
    source: 'auto' | 'manual' | null | undefined;
    detail: Record<string, unknown> | null | undefined;
    /** Grava a nota manual. `null` devolve o card para a regra automática. */
    onAlterar: (nota: number | null) => Promise<void> | void;
}

function listaDe(detail: Props['detail'], chave: string): CriterioId[] {
    const bruto = detail?.[chave];
    return Array.isArray(bruto) ? (bruto as CriterioId[]) : [];
}

/** Itens com motivo, quando a nota veio da IA (story 2.35). */
interface ItemComMotivo {
    id: CriterioId;
    atende: 0 | 1;
    motivo: string;
}

function itensDe(detail: Props['detail']): ItemComMotivo[] {
    const bruto = detail?.['itens'];
    return Array.isArray(bruto) ? (bruto as ItemComMotivo[]) : [];
}

function Linha({
    icone: Icone,
    cor,
    criterio,
    motivo,
}: {
    icone: React.ElementType;
    cor: string;
    criterio: CriterioId;
    /**
     * O porquê daquele ponto, quando a nota veio da IA.
     *
     * É a mitigação da reversão do "fora de escopo" da story 2.18: a nota deixou
     * de ser regra determinística, então ela precisa se explicar frase por frase.
     * Sem isto, é opinião sem recurso.
     */
    motivo?: string;
}) {
    return (
        <li className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300">
            <Icone size={13} className={`${cor} mt-0.5 shrink-0`} aria-hidden="true" />
            <span>
                {ROTULO_DO_CRITERIO[criterio] ?? criterio}
                {motivo && (
                    <span className="block text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                        {motivo}
                    </span>
                )}
            </span>
        </li>
    );
}

export function PainelDaNota({ score, known, source, detail, onAlterar }: Props) {
    const [salvando, setSalvando] = useState(false);

    const bateram = listaDe(detail, 'matched');
    const refutados = listaDe(detail, 'refuted');
    const desconhecidos = listaDe(detail, 'unknown');

    // Nota da IA (story 2.35) traz um motivo por item. Nota calculada por regra
    // (2.18a/b) não traz — e aí as listas acima bastam.
    const motivoPor = new Map(itensDe(detail).map(i => [i.id, i.motivo]));

    const alterar = async (nota: number | null) => {
        setSalvando(true);
        try {
            await onAlterar(nota);
        } finally {
            setSalvando(false);
        }
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-bold text-slate-400 uppercase">Prioridade</h3>
                {source === 'manual' && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-primary-100 dark:bg-primary-500/20 text-primary-700 dark:text-primary-300">
                        definida por você
                    </span>
                )}
            </div>

            {/* A nota, sempre com o denominador. */}
            <div className="flex items-baseline gap-2 mb-1">
                <span className="text-2xl font-bold text-slate-900 dark:text-white">
                    {score === null || score === undefined ? '—' : `${score}/${known ?? 0}`}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                    {score === null || score === undefined
                        ? 'sem dado ainda'
                        : `${score} de ${known ?? 0} critérios conhecidos`}
                </span>
            </div>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mb-3">
                O total muda conforme o que a conversa revelou — não é sempre 5.
            </p>

            {(bateram.length > 0 || refutados.length > 0 || desconhecidos.length > 0) && (
                <ul className="space-y-1.5 mb-4">
                    {bateram.map(c => (
                        <Linha key={c} icone={Check} cor="text-green-500" criterio={c} motivo={motivoPor.get(c)} />
                    ))}
                    {refutados.map(c => (
                        <Linha key={c} icone={X} cor="text-slate-400" criterio={c} motivo={motivoPor.get(c)} />
                    ))}
                    {/*
                      Os desconhecidos aparecem de propósito. Omitir faria a nota
                      parecer mais firme do que é — e é justamente o que ela
                      precisa saber para decidir se vale perguntar.
                    */}
                    {desconhecidos.map(c => (
                        <Linha key={c} icone={HelpCircle} cor="text-amber-500" criterio={c} />
                    ))}
                </ul>
            )}

            <div className="pt-3 border-t border-slate-100 dark:border-white/5">
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-2">
                    Não concorda? Defina a nota na mão — o sistema para de recalcular este card.
                </p>
                <div className="flex items-center gap-1 flex-wrap">
                    {[1, 2, 3, 4, 5].map(n => (
                        <button
                            key={n}
                            type="button"
                            disabled={salvando}
                            onClick={() => alterar(n)}
                            aria-label={`Definir prioridade ${n} de 5`}
                            className={`p-1.5 rounded border transition-colors disabled:opacity-50 ${
                                source === 'manual' && score === n
                                    ? 'bg-amber-100 dark:bg-amber-500/20 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300'
                                    : 'border-slate-200 dark:border-white/10 text-slate-400 hover:text-amber-500 hover:border-amber-300'
                            }`}
                        >
                            <Star size={14} fill={source === 'manual' && (score ?? 0) >= n ? 'currentColor' : 'none'} />
                        </button>
                    ))}

                    {source === 'manual' && (
                        <button
                            type="button"
                            disabled={salvando}
                            onClick={() => alterar(null)}
                            className="ml-1 flex items-center gap-1 text-[11px] px-2 py-1.5 rounded border border-slate-200 dark:border-white/10 text-slate-500 hover:text-slate-700 disabled:opacity-50"
                        >
                            <Undo2 size={12} /> voltar ao automático
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

export default PainelDaNota;
