/**
 * @fileoverview Bloco B do painel — regras puras (story 2.19)
 *
 * Separado do componente de propósito: são as decisões que precisam de teste,
 * e testar decisão dentro de JSX custa montar a árvore inteira.
 *
 * @module features/dashboard/blocoB
 */

/** Fuso da operação. Ela conta o mês em horário de São Paulo, não em UTC. */
export const FUSO_DA_OPERACAO = 'America/Sao_Paulo';

/**
 * Percentual de leads que chegaram e ninguém respondeu.
 *
 * Devolve `null` quando não chegou ninguém — 0/0 não é 0%, é "não houve base".
 * Mostrar "0%" num mês sem lead é afirmar um desempenho que não aconteceu.
 */
export function percentualSemResposta(
    semResposta: number,
    chegaram: number
): number | null {
    if (chegaram <= 0) return null;
    return (semResposta / chegaram) * 100;
}

/**
 * O aviso de cobertura de dados, quando o período pedido começa ANTES de o CRM
 * existir.
 *
 * 🔑 Por que isto existe: o CRM só registra conversa desde **24/07/2026**. Pedir
 * "julho inteiro" devolveria um número que parece resposta e é recorte — e o
 * painel antigo dela dava 963 para julho, número que este CRM **não reproduz**.
 * A story 2.24 ainda apagou fisicamente os deals de julho, então nesse mês
 * "ganhos" e "perdidos" são estruturalmente zero.
 *
 * Um número sem essa frase embaixo é o tipo de número que não sobrevive à
 * primeira pergunta numa reunião de diretoria.
 *
 * @returns a frase a exibir, ou `null` quando o período está inteiro coberto
 */
export function avisoDeCobertura(
    coberturaDesde: string | null | undefined,
    inicioDoPeriodo: string
): string | null {
    if (!coberturaDesde) return null;

    const cobertura = new Date(coberturaDesde);
    const inicio = new Date(inicioDoPeriodo);
    if (Number.isNaN(cobertura.getTime()) || Number.isNaN(inicio.getTime())) return null;

    if (cobertura <= inicio) return null;

    const dia = cobertura.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone: FUSO_DA_OPERACAO,
    });

    return `O período começa antes do CRM: só há registro a partir de ${dia}. Os números abaixo cobrem de ${dia} em diante.`;
}

/**
 * Aviso de cobertura do **Total de Leads**, que é mais curta que a de conversas.
 *
 * 🔑 Medido em 19/08: os 491 deals vivos foram **todos** criados em agosto — a
 * story 2.24 apagou fisicamente os de julho. Então "Total de Leads" num período
 * de julho devolve `0`, e zero que parece medição é pior que ausência de número.
 *
 * Separado de {@link avisoDeCobertura} de propósito: são duas coberturas
 * diferentes na mesma tela (conversa desde 24/07, card desde 01/08), e juntá-las
 * numa frase só faria a mais curta desaparecer atrás da mais longa.
 *
 * @returns a frase a exibir, ou `null` quando o período está coberto
 */
export function avisoDeCoberturaDeDeals(
    coberturaDealsDesde: string | null | undefined,
    inicioDoPeriodo: string
): string | null {
    if (!coberturaDealsDesde) return null;

    const cobertura = new Date(coberturaDealsDesde);
    const inicio = new Date(inicioDoPeriodo);
    if (Number.isNaN(cobertura.getTime()) || Number.isNaN(inicio.getTime())) return null;
    if (cobertura <= inicio) return null;

    const dia = cobertura.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone: FUSO_DA_OPERACAO,
    });

    return `O "Total de Leads" conta cards do funil, e o card mais antigo é de ${dia} — períodos anteriores devolvem zero por ausência de card, não por ausência de lead.`;
}

/**
 * AC10 — a identidade que faz o painel "bater".
 *
 * Toda conversa do período ou foi iniciada pelo lead, ou pela equipe: não há
 * terceira opção. E toda transferência sai de uma conversa iniciada pelo lead —
 * medido em 19/08: as 203 transferências são, todas, de conversas do tipo `lead`.
 *
 * 🔑 Por que virou função testada em vez de comentário: a queixa que originou a
 * story 2.46 foi literalmente *"esses números não estão batendo"*. Uma identidade
 * que ninguém verifica volta a não bater na primeira mudança de query.
 *
 * @returns lista de inconsistências encontradas (vazia = o painel fecha)
 */
export function inconsistenciasDoPainel(m: {
    chegaram: number;
    euAbordei: number;
    chegaramAteMim: number;
    semResposta: number;
}): string[] {
    const problemas: string[] = [];

    if (m.chegaramAteMim > m.chegaram) {
        problemas.push(
            `transferidos (${m.chegaramAteMim}) não pode passar de quem chegou pelo WhatsApp (${m.chegaram})`
        );
    }
    if (m.semResposta > m.chegaram) {
        problemas.push(
            `sem resposta (${m.semResposta}) não pode passar de quem chegou pelo WhatsApp (${m.chegaram})`
        );
    }
    if (m.chegaram < 0 || m.euAbordei < 0 || m.chegaramAteMim < 0 || m.semResposta < 0) {
        problemas.push('há contagem negativa — a query devolveu algo impossível');
    }

    return problemas;
}

/**
 * AC9 — quanto da operação o log da IA realmente enxerga.
 *
 * 🚨 O card "Performance da IA" é construído sobre `ai_conversation_log`. Medido
 * em 19/08: **89 linhas no log** contra **8.386 mensagens de saída reais**.
 * Ou seja, ele apresentava ~1% da operação com cara de total — é a explicação
 * mais direta do "esses números não estão batendo" que originou a story 2.46.
 *
 * A correção não é inventar número: é a tela **declarar a cobertura**. Um painel
 * que diz "isto cobre 1%" é utilizável; um que omite não é.
 *
 * @param interacoesNoLog quantas interações o log registrou no período
 * @param mensagensReais mensagens de saída medidas em `messaging_messages`
 * @returns a frase a exibir, ou `null` quando não há como comparar
 */
export function coberturaDoLogDaIa(
    interacoesNoLog: number | null | undefined,
    mensagensReais: number | null | undefined
): string | null {
    if (typeof interacoesNoLog !== 'number' || typeof mensagensReais !== 'number') return null;
    if (mensagensReais <= 0) return null;

    const pct = (interacoesNoLog / mensagensReais) * 100;
    // Acima de 90% o aviso vira ruído — o log estaria cumprindo o papel dele.
    if (pct >= 90) return null;

    // Casas decimais onde elas mudam a leitura: 1,06% arredondado para "1%" some
    // com a ordem de grandeza do problema, e "0%" faria o aviso parecer defeito do
    // aviso, e nao do log. Acima de 10% o inteiro ja basta.
    const exibido = pct < 1 ? pct.toFixed(2) : pct < 10 ? pct.toFixed(1) : pct.toFixed(0);
    return `Estes números vêm do log da IA, que registrou ${interacoesNoLog} interações enquanto a operação enviou ${mensagensReais} mensagens no período — cobertura de ~${exibido}%. Leia como amostra, não como total.`;
}
