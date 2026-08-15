/**
 * @fileoverview Bloco A — "o que eu faço agora" (story 2.19)
 *
 * A fila viva da atendente. Cada card carrega **na tela** o que conta (AC1).
 *
 * 🔑 Este bloco nasceu de um áudio, não de um backlog: lendo só o Bloco B, a
 * Fernanda concluiu que *"meu chefe vai me substituir por uma IA (…) o que a
 * Fernanda faz? Nada"*. O painel media o que a IA fez e não media o que só ela
 * faz. Estes três números são o lado dela.
 *
 * ⚠️ Fica ACIMA do Bloco B na página, de propósito: o trabalho de hoje vem antes
 * do fechamento do mês. Um painel que abre pelo retrospectivo é relatório para
 * outra pessoa ler.
 *
 * @module features/dashboard/components/BlocoASection
 */

import React from 'react';
import { Inbox, Clock, PhoneCall, Info, ListChecks } from 'lucide-react';
import { useFilaDeAtendimentoQuery } from '@/lib/query/hooks';
import {
    avisoDeAlcanceDaIa,
    semBaseParaLigar,
    tomDoAtraso,
    definicaoDaEspera,
} from '../blocoA';
import { SkeletonStatCard } from '@/components/ui/Skeleton';

// =============================================================================
// Card
// =============================================================================

function CardDaFila({
    icon: Icon,
    titulo,
    valor,
    definicao,
    destaque = 'neutro',
    rodape,
}: {
    icon: React.ElementType;
    titulo: string;
    valor: string | number;
    /** O que este número conta. Obrigatório — é o AC1 da story. */
    definicao: string;
    destaque?: 'neutro' | 'bom' | 'atencao' | 'alarme' | 'humano';
    /** Ressalva de alcance (denominador), quando existe. */
    rodape?: string | null;
}) {
    const cores = {
        neutro: 'text-slate-500 bg-slate-100 dark:bg-slate-500/20',
        bom: 'text-green-500 bg-green-100 dark:bg-green-500/20',
        atencao: 'text-amber-500 bg-amber-100 dark:bg-amber-500/20',
        alarme: 'text-red-500 bg-red-100 dark:bg-red-500/20',
        humano: 'text-primary-500 bg-primary-100 dark:bg-primary-500/20',
    };

    return (
        <div className="glass p-4 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm flex flex-col">
            <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${cores[destaque]}`}>
                    <Icon size={18} />
                </div>
                <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-500 dark:text-slate-400 truncate">
                        {titulo}
                    </p>
                    <p className="text-2xl font-bold text-slate-900 dark:text-white">{valor}</p>
                </div>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-3 leading-snug">
                {definicao}
            </p>
            {rodape && (
                <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-2 leading-snug italic">
                    {rodape}
                </p>
            )}
        </div>
    );
}

// =============================================================================
// Seção
// =============================================================================

export function BlocoASection() {
    const { data, isLoading } = useFilaDeAtendimentoQuery();

    if (isLoading) {
        return (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {Array.from({ length: 3 }).map((_, i) => (
                    <SkeletonStatCard key={i} />
                ))}
            </div>
        );
    }

    if (!data) return null;

    const alcance = avisoDeAlcanceDaIa(data.pontuadosPelaIa, data.cardsVivos);
    const semBase = semBaseParaLigar(data.pontuadosPelaIa);
    const tom = tomDoAtraso(data.passouDoLimite, data.esperandoPorMim);

    return (
        <div className="space-y-3">
            <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white font-display flex items-center gap-2">
                    <ListChecks className="text-primary-500" size={20} />
                    O que eu faço agora
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    A fila de hoje. Estes números não dependem do período escolhido — é sempre agora.
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <CardDaFila
                    icon={Inbox}
                    titulo="Esperando minha resposta"
                    valor={data.esperandoPorMim}
                    destaque="humano"
                    definicao={definicaoDaEspera(data.horasDoLimite)}
                    rodape={`De ${data.transferidas} conversas que já saíram da IA.`}
                />
                <CardDaFila
                    icon={Clock}
                    titulo={`Passou de ${data.horasDoLimite}h`}
                    valor={data.passouDoLimite}
                    destaque={tom}
                    definicao={`Dessas que esperam, as que estão sem resposta há mais de ${data.horasDoLimite} horas. O limite é o seu critério.`}
                />
                <CardDaFila
                    icon={PhoneCall}
                    titulo="Prontos para ligar"
                    valor={semBase ? '—' : data.prontosParaLigar}
                    destaque={semBase ? 'neutro' : 'bom'}
                    definicao={
                        semBase
                            ? 'Nenhum card foi avaliado pela IA ainda, então não há como dizer quem está pronto. Não é que ninguém esteja: é que ninguém foi lido.'
                            : 'Cards em que a IA leu a conversa e confirmou os seus dois critérios: mora na cidade de São Paulo e chegou até o fim do roteiro.'
                    }
                    rodape={alcance}
                />
            </div>

            {alcance && (
                <div className="flex items-start gap-2 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 px-3 py-2">
                    <Info size={16} className="text-slate-400 mt-0.5 shrink-0" />
                    <p className="text-xs text-slate-600 dark:text-slate-400">
                        <strong>Prontos para ligar</strong> só olha os cards que a IA avaliou. Conforme
                        mais leads passam por Qualificado, esse número tende a crescer — ele não é um
                        teto.
                    </p>
                </div>
            )}
        </div>
    );
}

export default BlocoASection;
