/**
 * Story 2.45 — o cadastro manual exigia o campo que ninguém tem.
 *
 * ============================================================================
 * O QUE A MEDIÇÃO MOSTROU (18/08)
 * ============================================================================
 * O formulário de contato marcava **Nome e E-mail** como obrigatórios, e deixava
 * **Telefone** opcional. O banco diz o contrário:
 *
 *   957 contatos no total
 *   956 SEM e-mail  (99,9%)   ← o campo que o formulário exigia
 *    90 sem telefone  (9%)    ← o campo que o formulário dispensava
 *
 * ⇒ **O formulário pedia justamente o que quase ninguém tem.** Os leads chegam
 * por WhatsApp: têm telefone e nome, nunca e-mail. Cadastrar à mão um cliente
 * que fechou era impossível sem inventar um e-mail.
 *
 * Foi isto que a Fernanda relatou em 18/08:
 *   *"Ele tem a opção de incluir cadastro e tudo mais, só que não tá pedindo
 *   informações básicas como nome, telefone, ele pede mais, então eu acho que
 *   quanto mais simples a gente deixar, melhor."*
 *
 * ============================================================================
 * POR QUE "PELO MENOS UM", E NÃO "TELEFONE OBRIGATÓRIO"
 * ============================================================================
 * Inverter a regra (exigir telefone) consertaria o cadastro novo e **quebraria a
 * edição**: os 90 contatos que hoje não têm telefone ficariam impossíveis de
 * salvar depois de qualquer edição — a mesma classe de defeito que estamos
 * consertando, só que mirando outro grupo.
 *
 * A regra que serve aos dois casos é: **nome + ao menos uma forma de contato**.
 * Um contato sem nenhuma das duas não é um cadastro, é uma linha órfã.
 */

export interface DadosDeContatoParaValidar {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
}

/** Motivo pelo qual o cadastro não pode ser salvo. `null` = pode salvar. */
export type ImpedimentoDeContato = 'sem_nome' | 'sem_forma_de_contato';

/**
 * Mensagens em pt-BR, no lugar onde a pessoa erra — não em código de erro.
 *
 * ⚠️ A mensagem diz **o que fazer**, não só o que faltou: a Fernanda já relatou
 * duas vezes no mês desconfiar da própria competência diante de um aviso do
 * sistema (*"não sei se eu preciso mexer em alguma coisa (…) mas não deveria, né?"*).
 */
export const MENSAGEM_DO_IMPEDIMENTO: Record<ImpedimentoDeContato, string> = {
    sem_nome: 'Informe o nome do contato.',
    sem_forma_de_contato: 'Informe ao menos o telefone ou o e-mail — o telefone basta.',
};

function vazio(valor?: string | null): boolean {
    return !valor || valor.trim() === '';
}

/**
 * Diz se o contato pode ser salvo, e por que não, quando não pode.
 *
 * @returns `null` quando está válido; o impedimento quando não está.
 */
export function impedimentoParaSalvarContato(
    dados: DadosDeContatoParaValidar
): ImpedimentoDeContato | null {
    if (vazio(dados.name)) return 'sem_nome';

    // O "ou" é o coração desta story: telefone SOZINHO basta, e é o caso real de
    // 99,9% da base. E-mail sozinho também basta — é o que mantém editáveis os
    // 90 contatos que nasceram sem telefone.
    if (vazio(dados.phone) && vazio(dados.email)) return 'sem_forma_de_contato';

    return null;
}
