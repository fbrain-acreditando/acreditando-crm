/**
 * @fileoverview Bloco B — "como foi o mês" (story 2.19)
 *
 * Os números que a Fernanda apresenta. Cada card carrega **na tela** o que
 * conta (AC1): foi a primeira coisa que ela questionou no painel antigo, e
 * número sem definição não sobrevive a uma reunião.
 *
 * @module features/dashboard/components/BlocoBSection
 */

import React from 'react';
import {
    Inbox,
    Send,
    UserCheck,
    Bot,
    AlertTriangle,
    Trophy,
    XCircle,
    Info,
    Users,
} from 'lucide-react';
import { useMetricasDeAtendimentoQuery } from '@/lib/query/hooks';
import { periodToDateRange } from '@/lib/utils/periodToDateRange';
import { percentualSemResposta, avisoDeCobertura, avisoDeCoberturaDeDeals } from '../blocoB';
import type { PeriodFilter } from '../hooks/useDashboardMetrics';
import { SkeletonStatCard } from '@/components/ui/Skeleton';

// =============================================================================
// Card
// =============================================================================

function CardComDefinicao({
    icon: Icon,
    titulo,
    valor,
    definicao,
    destaque = 'neutro',
}: {
    icon: React.ElementType;
    titulo: string;
    valor: string | number;
    /** O que este número conta. Obrigatório — é o AC1 da story. */
    definicao: string;
    destaque?: 'neutro' | 'bom' | 'atencao' | 'humano';
}) {
    const cores = {
        neutro: 'text-slate-500 bg-slate-100 dark:bg-slate-500/20',
        bom: 'text-green-500 bg-green-100 dark:bg-green-500/20',
        atencao: 'text-amber-500 bg-amber-100 dark:bg-amber-500/20',
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
        </div>
    );
}

// =============================================================================
// Seção
// =============================================================================

export function BlocoBSection({ period }: { period: PeriodFilter }) {
    const { data, isLoading } = useMetricasDeAtendimentoQuery(period);
    const { start } = periodToDateRange(period);

    if (isLoading) {
        return (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {Array.from({ length: 4 }).map((_, i) => (
                    <SkeletonStatCard key={i} />
                ))}
            </div>
        );
    }

    if (!data) return null;

    const percentual = percentualSemResposta(data.semResposta, data.chegaram);
    const aviso = avisoDeCobertura(data.coberturaDesde, start);
    const avisoDeDeals = avisoDeCoberturaDeDeals(data.coberturaDealsDesde, start);

    return (
        <div className="space-y-3">
            <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white font-display flex items-center gap-2">
                    <Inbox className="text-primary-500" size={20} />
                    Como foi o período
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Cada número diz embaixo o que ele conta.
                </p>
            </div>

            {aviso && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 dark:border-amber-900/30 bg-amber-50 dark:bg-amber-900/10 px-3 py-2">
                    <Info size={16} className="text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                    <p className="text-xs text-amber-800 dark:text-amber-300">{aviso}</p>
                </div>
            )}

            {avisoDeDeals && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 dark:border-amber-900/30 bg-amber-50 dark:bg-amber-900/10 px-3 py-2">
                    <Info size={16} className="text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                    <p className="text-xs text-amber-800 dark:text-amber-300">{avisoDeDeals}</p>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <CardComDefinicao
                    icon={Users}
                    titulo="Total de Leads"
                    valor={data.totalLeads}
                    destaque="humano"
                    definicao="Cards criados no funil dentro do período. É o número de leads que entraram, contado pela data de criação do card."
                />
                <CardComDefinicao
                    icon={Inbox}
                    titulo="Leads que chegaram no WhatsApp"
                    valor={data.chegaram}
                    definicao="Conversas em que o lead mandou a primeira mensagem. A origem do anúncio não é rastreada — este número não separa quem veio de anúncio de quem veio sozinho."
                />
                <CardComDefinicao
                    icon={Send}
                    titulo="Leads orgânicos"
                    valor={data.euAbordei}
                    destaque="humano"
                    definicao="Conversas em que a equipe mandou a primeira mensagem, em vez de o lead."
                />
                <CardComDefinicao
                    icon={UserCheck}
                    titulo="Leads transferidos"
                    valor={data.chegaramAteMim}
                    destaque="humano"
                    definicao="A IA transferiu o atendimento. A partir da transferência, quem responde é uma pessoa — a IA não volta."
                />
                <CardComDefinicao
                    icon={AlertTriangle}
                    titulo="Ficaram sem resposta"
                    valor={
                        percentual === null
                            ? data.semResposta
                            : `${data.semResposta} (${percentual.toFixed(1)}%)`
                    }
                    destaque={data.semResposta > 0 ? 'atencao' : 'bom'}
                    definicao="Chegaram e não receberam nenhuma resposta — nem da IA. O percentual é sobre os leads que chegaram."
                />
                <CardComDefinicao
                    icon={Trophy}
                    titulo="Viraram venda"
                    valor={data.ganhos}
                    destaque="bom"
                    definicao="Cards marcados como Ganho, contados pela data em que fecharam."
                />
                <CardComDefinicao
                    icon={XCircle}
                    titulo="Perdidos"
                    valor={data.perdidos}
                    definicao="Cards marcados como Perdido, contados pela data em que fecharam."
                />
            </div>

            {/*
              AC5 — mensagens por autor. É ESTIMATIVA, e a tela diz isso.
              A origem (GPT Maker) não marca quem escreveu: medido em 19/08, a
              mensagem da pessoa chega com o mesmo `role: assistant` e o mesmo
              `assistantId` da IA. O corte é a transferência.
            */}
            <div className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    Mensagens enviadas
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <CardComDefinicao
                        icon={Bot}
                        titulo="Enviadas pela IA"
                        valor={data.msgsIa}
                        definicao="Estimativa: mensagens enviadas antes da transferência, ou em conversas que nunca foram transferidas. A plataforma de atendimento não marca o autor de cada mensagem — o corte usado é a transferência."
                    />
                    <CardComDefinicao
                        icon={UserCheck}
                        titulo="Enviadas por uma pessoa"
                        valor={data.msgsPessoa}
                        destaque="humano"
                        definicao="Estimativa: mensagens enviadas depois da transferência. Se a IA mandar algo após transferir, cai aqui — por isso é estimativa, e não medição."
                    />
                </div>
            </div>

            {/* AC7 — leads por estágio, no mesmo período dos cards acima. */}
            {data.funil.length > 0 && (
                <div className="space-y-2">
                    <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                        Leads por etapa do funil
                    </h3>
                    <div className="glass rounded-xl border border-slate-200 dark:border-white/5 shadow-sm divide-y divide-slate-200 dark:divide-white/5">
                        {data.funil.map((etapa) => (
                            <div
                                key={`${etapa.ordem}-${etapa.estagio}`}
                                className="flex items-center justify-between px-4 py-2.5"
                            >
                                <span className="text-sm text-slate-600 dark:text-slate-300 truncate">
                                    {etapa.estagio}
                                </span>
                                <span className="text-sm font-bold text-slate-900 dark:text-white tabular-nums">
                                    {etapa.leads}
                                </span>
                            </div>
                        ))}
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                        Cards criados no período, na etapa em que estão hoje.
                    </p>
                </div>
            )}
        </div>
    );
}

export default BlocoBSection;
