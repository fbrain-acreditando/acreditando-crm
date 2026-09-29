/**
 * Seção "Preenchido pelo lead (Formulário Meta)" do card — story 2.60.
 *
 * Pedido do Filipe (29/09): um título antes dos campos que SÓ o formulário da
 * Meta preenche, para a Fernanda saber que quem marcou foi o próprio lead.
 *
 * 🔑 A separação é pela `key` da definição, nunca pelo `label`: o rótulo pode
 * ser renomeado em Configurações; a chave, não. A ordem de exibição é a desta
 * constante, não a ordem em que as definições chegam do banco.
 *
 * Os outros campos que o formulário também grava (os 5 compartilhados com a IA
 * do WhatsApp, `origemDoLead` e o rastreio `meta*`) ficam em "Campos
 * Personalizados" — decisão D3 da story.
 */
import type { ChaveResposta } from '@/lib/meta-form/traducao';

/** Chaves que só o formulário da Meta preenche, na ordem em que aparecem no card. */
export const CHAVES_SO_DO_FORMULARIO_META: ReadonlyArray<ChaveResposta> = [
  'quandoPretendeIniciar',
  'faixaDeInvestimentoMensal',
];

export const TITULO_SECAO_FORMULARIO_META = '📋 Preenchido pelo lead (Formulário Meta)';

/**
 * Separa as definições em "do formulário" (na ordem da constante) e "demais"
 * (na ordem original). Uma definição cai em um grupo só — nunca nos dois.
 */
export function separarCamposDoFormularioMeta<T extends { key: string }>(
  definicoes: readonly T[]
): { doFormulario: T[]; demais: T[] } {
  const chaves: ReadonlyArray<string> = CHAVES_SO_DO_FORMULARIO_META;
  const doFormulario = chaves
    .map(chave => definicoes.find(d => d.key === chave))
    .filter((d): d is T => d !== undefined);
  const demais = definicoes.filter(d => !chaves.includes(d.key));
  return { doFormulario, demais };
}
