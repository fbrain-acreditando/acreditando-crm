/**
 * @fileoverview A lista de quem espera resposta (story 2.48)
 *
 * É o que o clique no card "Esperando minha resposta" abre.
 *
 * 🔑 Nasceu de uma frase da Fernanda em 21/08: *"eu fico tentando adivinhar"*.
 * O card dizia **quantas** e não dizia **quem** — e um número que não abre não
 * vira trabalho.
 *
 * ⚠️ O TEXTO REAL da última mensagem é a peça central, não enfeite. Medido em
 * 24/08: dentro do funil, a última mensagem ainda é cortesia de encerramento em
 * boa parte ("Ok obrigada", "Perfeito", "Valeu") no mesmo balde que "Me
 * explica", "Telefone" e "qto custa". Nenhum filtro de etapa separa esses dois
 * grupos — mas **ler a frase separa em um segundo**, sem modelo nenhum no meio.
 *
 * @module features/dashboard/components/ListaDaFilaModal
 */

import React from 'react';
import { X, MessageSquare, AlertCircle, ExternalLink } from 'lucide-react';
import { useListaDaFilaQuery, type ItemDaFilaDeEspera } from '@/lib/query/hooks';
import { rotuloDaEspera, textoDoItem } from '../blocoA';

// =============================================================================
// Linha
// =============================================================================

function LinhaDaFila({
    item,
    aoAbrir,
}: {
    item: ItemDaFilaDeEspera;
    aoAbrir: (item: ItemDaFilaDeEspera) => void;
}) {
    return (
        <button
            type="button"
            onClick={() => aoAbrir(item)}
            className="w-full text-left px-4 py-3 border-b border-slate-100 dark:border-white/5 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-inset"
        >
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-slate-900 dark:text-white truncate">
                            {item.nome}
                        </span>
                        {item.etapa && (
                            <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300">
                                {item.etapa.trim()}
                            </span>
                        )}
                        {item.semCard && (
                            <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300">
                                sem card no CRM
                            </span>
                        )}
                    </div>

                    {/* A frase real. É ela que dispensa o classificador. */}
                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-1 line-clamp-2">
                        {textoDoItem(item.tipo, item.texto)}
                    </p>

                    {item.telefone && (
                        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
                            {item.telefone}
                        </p>
                    )}
                </div>

                <div className="shrink-0 text-right">
                    <span
                        className={
                            item.passouDoLimite
                                ? 'text-xs font-medium text-amber-600 dark:text-amber-400'
                                : 'text-xs text-slate-400 dark:text-slate-500'
                        }
                    >
                        {rotuloDaEspera(item.horasEsperando)}
                    </span>
                    <ExternalLink
                        size={14}
                        className="text-slate-300 dark:text-slate-600 mt-1 ml-auto"
                    />
                </div>
            </div>
        </button>
    );
}

// =============================================================================
// Modal
// =============================================================================

export function ListaDaFilaModal({
    aberto,
    aoFechar,
    aoAbrirConversa,
    horasDoLimite,
    apenasFunil = true,
    incluiSemCard = true,
}: {
    aberto: boolean;
    aoFechar: () => void;
    /** Leva para a conversa. Quem sabe navegar é a página, não a lista. */
    aoAbrirConversa: (item: ItemDaFilaDeEspera) => void;
    horasDoLimite: number;
    apenasFunil?: boolean;
    incluiSemCard?: boolean;
}) {
    const { data, isLoading, error } = useListaDaFilaQuery({
        apenasFunil,
        incluiSemCard,
        habilitado: aberto,
    });

    // Esc fecha. Sem isto o modal prende quem abriu sem querer.
    React.useEffect(() => {
        if (!aberto) return;
        const aoTeclar = (e: KeyboardEvent) => {
            if (e.key === 'Escape') aoFechar();
        };
        window.addEventListener('keydown', aoTeclar);
        return () => window.removeEventListener('keydown', aoTeclar);
    }, [aberto, aoFechar]);

    if (!aberto) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
            onClick={aoFechar}
            role="presentation"
        >
            <div
                className="glass w-full max-w-2xl max-h-[80vh] rounded-xl border border-slate-200 dark:border-white/10 shadow-xl flex flex-col bg-white dark:bg-slate-900"
                onClick={e => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label="Quem está esperando resposta"
            >
                <header className="flex items-start justify-between gap-3 px-4 py-3 border-b border-slate-200 dark:border-white/10">
                    <div>
                        <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            <MessageSquare size={18} className="text-primary-500" />
                            Esperando minha resposta
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            Da mais antiga para a mais recente. O texto é a última mensagem que a
                            pessoa mandou.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={aoFechar}
                        aria-label="Fechar"
                        className="p-1 rounded hover:bg-slate-100 dark:hover:bg-white/10 text-slate-400"
                    >
                        <X size={18} />
                    </button>
                </header>

                <div className="overflow-y-auto flex-1">
                    {isLoading && (
                        <p className="px-4 py-8 text-center text-sm text-slate-500">
                            Carregando a fila…
                        </p>
                    )}

                    {error && (
                        <div className="px-4 py-8 text-center">
                            <AlertCircle size={20} className="mx-auto text-amber-500" />
                            <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
                                Não consegui carregar a lista. O número do card continua válido.
                            </p>
                        </div>
                    )}

                    {!isLoading && !error && data?.length === 0 && (
                        <p className="px-4 py-8 text-center text-sm text-slate-500">
                            Ninguém esperando resposta agora.
                        </p>
                    )}

                    {!isLoading &&
                        !error &&
                        data?.map(item => (
                            <LinhaDaFila
                                key={item.conversationId}
                                item={item}
                                aoAbrir={aoAbrirConversa}
                            />
                        ))}
                </div>

                {!isLoading && !error && (data?.length ?? 0) > 0 && (
                    <footer className="px-4 py-2 border-t border-slate-200 dark:border-white/10">
                        <p className="text-[11px] text-slate-400 dark:text-slate-500">
                            Em destaque, quem espera há mais de {horasDoLimite}h. Uma mensagem de
                            cortesia (&quot;Ok, obrigada&quot;) também aparece aqui — a lista mostra
                            o texto para você decidir, ela não decide por você.
                        </p>
                    </footer>
                )}
            </div>
        </div>
    );
}

export default ListaDaFilaModal;
