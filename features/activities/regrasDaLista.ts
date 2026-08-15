/**
 * @fileoverview Regras puras da lista de Atividades (story 2.39)
 *
 * 🔑 Por que este arquivo existe, em uma frase: **a nota estava salva e a tela
 * negava as quatro formas de chegar nela.**
 *
 * A Fernanda perguntou em áudio (14/08): *"as informações que eu coloco ali na
 * timeline do cliente, onde fica? Onde que eu visualizo depois? Quando eu tiver
 * que revisar, fazer um follow-up, onde que eu consigo olhar essas notas?"*
 *
 * Medido antes de escrever — a nota dela (card do Francisco Melo, 14/08 11:10)
 * estava íntegra no banco. O que falhava era a recuperação, em quatro pontos:
 *
 *  1. o filtro por tipo oferecia `Ligações · Reuniões · Emails · Tarefas` — e os
 *     únicos tipos que existem na base são `NOTE` (54) e `STATUS_CHANGE` (839).
 *     **As quatro opções devolviam vazio, sempre;**
 *  2. `ActivityRow` nunca renderizava `description` — o texto da nota, que é a
 *     única coisa que importa nela, **não ia para a tela**;
 *  3. as 54 notas têm `completed = true`, e a linha risca e esmaece o que está
 *     concluído ⇒ **a nota dela aparecia como tarefa cancelada**;
 *  4. a busca só olhava `title`, e **todas as 54 notas têm o mesmo título**
 *     (*"Nota Adicionada"*) ⇒ procurar "Cubatão" não achava nada.
 *
 * @module features/activities/regrasDaLista
 */

import type { Activity } from '@/types';

/**
 * Nota é registro, não tarefa.
 *
 * A distinção governa toda a apresentação: nota não se "conclui", não se risca e
 * não ganha caixa de marcar. O `completed = true` que o sistema grava nelas é
 * detalhe de armazenamento — tratá-lo como estado de tarefa foi o que fez o
 * trabalho dela aparecer cancelado na tela.
 */
export function ehNota(activity: Pick<Activity, 'type'>): boolean {
    return activity.type === 'NOTE';
}

/**
 * Se a linha deve aparecer riscada/esmaecida.
 *
 * ⚠️ **Nunca para nota**, mesmo com `completed = true` — e é justamente o caso
 * de 54 em 54 delas hoje.
 */
export function deveRiscar(activity: Pick<Activity, 'type' | 'completed'>): boolean {
    if (ehNota(activity)) return false;
    return !!activity.completed;
}

/**
 * A busca da lista.
 *
 * Procura no **título e no texto**. Só no título é inútil aqui: as 54 notas
 * compartilham o título *"Nota Adicionada"* — o que distingue uma da outra vive
 * inteiramente na `description`.
 *
 * Busca vazia casa com tudo (é o estado inicial da tela).
 */
export function combinaComABusca(
    activity: Pick<Activity, 'title' | 'description'>,
    termo: string
): boolean {
    const q = termo.trim().toLowerCase();
    if (!q) return true;

    const titulo = (activity.title || '').toLowerCase();
    const texto = (activity.description || '').toLowerCase();

    return titulo.includes(q) || texto.includes(q);
}

/**
 * O texto que a linha exibe como corpo, ou `null` quando não há o que exibir.
 *
 * Existe como regra (e não como `{activity.description}` solto no JSX) porque a
 * decisão *"o que aparece embaixo do título"* é o coração desta story e precisa
 * de teste — foi ela que faltou.
 */
export function corpoDaLinha(
    activity: Pick<Activity, 'description'>
): string | null {
    const texto = (activity.description || '').trim();
    return texto.length > 0 ? texto : null;
}
