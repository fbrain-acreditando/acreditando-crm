/**
 * Story 2.67 (AC8) — os motivos rápidos de perda, fora do componente.
 *
 * Moram fora do `LossReasonModal` pelo mesmo motivo do `localDaPerda.ts`: as
 * suítes que mockam o modal inteiro (ex.: `test/stories/US-001-…`) não podem
 * depender desta lista, e a Lista de Perdidos da 2.68 vai reusá-la no filtro.
 *
 * ⚠️ Ordem NÃO é arbitrária: o 1º é o mais frequente na operação. "Distância"
 * entrou primeiro (pedido da Fernanda, story 2.26) porque a medição mostrou que
 * ele é **6 dos 11** deals perdidos — enquanto os 5 botões que já existiam,
 * somados, foram usados 2 vezes. Era o único motivo comum sem botão, e por isso
 * vinha digitado à mão: o banco já tem `distância`, `distãncia` e
 * `distância e parte financeira` — três grafias do mesmo motivo, impossíveis de agrupar.
 *
 * `value` é o que fica gravado em `deals.loss_reason` e é o que os relatórios
 * agrupam ⇒ **um motivo, um `value` canônico**. Mudar um `value` daqui
 * fragmenta o histórico; para renomear, migrar as linhas existentes junto.
 *
 * ⚠️ **Story 2.45 (18/08) — os `value` novos NÃO casam com o texto livre antigo.**
 * O botão *Só "bom dia"* grava `Lead só mandou bom dia`, enquanto as 7 perdas já
 * existentes estão em 5 grafias diferentes. ⇒ **o relatório só agrupa daqui para
 * a frente.** Consolidar o passado exige migrar as linhas antigas, e isso
 * **sobrescreve texto que a Fernanda escreveu** — é decisão dela, não do código.
 * Enquanto não for feita, a cauda antiga continua visível no Bloco C.
 *
 * ⚠️ **Story 2.67 (03/11) — "Sem interação" passa a ser o 1º** (P3 do Filipe).
 * A medição dos 810 perdidos (pipeline `21`) mostrou ~380 variações de
 * "sem interação" digitadas no "Outro" (44% de tudo), das quais 297 são
 * exatamente `lead sem interação`. O `value` do botão é **esse mesmo texto**,
 * com a caixa do botão: sem diferenciar maiúscula, as 297 antigas e as novas
 * agrupam juntas (a 2.68 compara pela chave normalizada), sem reescrever o banco.
 * Os números entre parênteses agora são da medição de 03/11.
 */
import type { LucideIcon } from 'lucide-react';
import {
  X, ThumbsDown, DollarSign, Users, Clock, HelpCircle, MapPin,
  MessageSquare, Baby, Home, ArrowRightLeft, MousePointerClick,
  MessageSquareOff, Car, Wallet, ShieldPlus,
} from 'lucide-react';

export interface MotivoDePerda {
  /** Texto do botão. */
  label: string;
  icon: LucideIcon;
  /** O que fica gravado em `deals.loss_reason`. `''` = "Outro" (texto livre). */
  value: string;
}

export const MOTIVOS_DE_PERDA: ReadonlyArray<MotivoDePerda> = [
  // Story 2.67 — ~380 em texto livre (297 exatamente "lead sem interação").
  { label: 'Sem interação', icon: MessageSquareOff, value: 'Lead sem interação' },           // ~380

  { label: 'Distância', icon: MapPin, value: 'Distância' },                                  // 129

  // Story 2.67 — pedido da Fernanda (03/11): mora perto, mas não tem como vir.
  // No CRM só 2 registram isso hoje; nas conversas, até 24–40 (teto).
  { label: 'Sem transporte/apoio', icon: Car, value: 'Sem transporte ou apoio para vir' },   // 2

  { label: 'Preço', icon: DollarSign, value: 'Preço muito alto' },                           // 45

  // Story 2.67 — D2 do Filipe: separar quem não tem condição financeira (≥ 26
  // em texto livre + nota em "Preço") para não receber oferta de remarketing.
  { label: 'Sem perfil financeiro', icon: Wallet, value: 'Sem perfil financeiro' },          // ≥ 26

  { label: 'Desistência', icon: X, value: 'Cliente desistiu' },                              // 26

  // Pedido da Fernanda (18/08) — e o caso mais caro da cauda: 7 perdas em CINCO
  // grafias (`lead bom dia`, `cliente bom dia`, `cliente de bom dia`,
  // `lead de bom dia`, `cliente bom dia e oração`). Nenhuma agrupa com a outra.
  // É o mesmo enredo que "Distância" já viveu na 2.26, com o dobro do volume.
  { label: 'Só "bom dia"', icon: MessageSquare, value: 'Lead só mandou bom dia' },           // 23

  // Pedidos da Fernanda. Volume baixo na 2.45, mas é ela quem digita: o custo do
  // texto livre é dela, não do relatório.
  { label: 'Clicou sem querer', icon: MousePointerClick, value: 'Lead clicou sem querer' },  // 16

  // NÃO foi pedido na 2.45 — saiu da medição. Não estava na fala dela porque ela
  // digitava caso a caso, e caso a caso não vira categoria na cabeça de ninguém:
  // `bebê` (2) · `criança de 5 anos` · `criança inferior à 12 anos` · `bebê 1 ano e 3 meses`.
  { label: 'Perfil/idade', icon: Baby, value: 'Perfil fora do atendimento (idade)' },        // 14

  { label: 'Sem interesse', icon: ThumbsDown, value: 'Lead sem interesse' },                 // 11

  // Story 2.67 — 55 conversas de perdidos falam em convênio/plano/SUS (teto);
  // no motivo, 4.
  { label: 'Convênio/plano', icon: ShieldPlus, value: 'Quer atendimento por convênio/plano' }, // 4

  // ⚠️ Os dois abaixo são, a rigor, ENCAMINHAMENTO e não perda. Entram como
  // botão de perda por decisão do Filipe (18/08): padronizar o texto agora vale
  // mais que a distinção — que é decisão de operação e fica para quando a
  // Fernanda separar "não era lead" de "perdemos a venda" no número da diretoria.
  { label: 'Domiciliar', icon: Home, value: 'Precisa de atendimento domiciliar' },           // 1
  { label: 'Para a Livre', icon: ArrowRightLeft, value: 'Encaminhado para a Livre' },        // 1 (na 2.45: `Livre` e `livre` — duas grafias só pela caixa alta)

  // ⚠️ Herança B2B do CRM de origem, que não descreve nada numa clínica.
  // MANTIDOS de propósito: aposentar botão é decisão da Fernanda, não minha, e
  // remover um `value` fragmentaria o histórico de quem já tenha usado.
  { label: 'Timing', icon: Clock, value: 'Momento inadequado' },                             // 1
  { label: 'Concorrência', icon: Users, value: 'Perdeu para concorrente' },                  // 0

  { label: 'Outro', icon: HelpCircle, value: '' },
];
