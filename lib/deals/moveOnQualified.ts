/**
 * @fileoverview T3 da story 2.17 — o I/O que leva o card para "Qualificado".
 *
 * A DECISÃO mora em `./autoStage` (pura, testada). Aqui fica só o que fala com
 * o banco: ler o destino configurado, ler as ordens dos estágios, gravar e
 * CONFERIR que gravou.
 *
 * ⚠️ Nunca derruba a extração. Se qualquer coisa aqui falhar, os campos já
 * foram gravados e valem mais que o movimento — que a Fernanda refaz num
 * arrasto. O erro vai para o log, não para cima.
 *
 * @module lib/deals/moveOnQualified
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { decideAutoStageMove, type AutoStageReason } from './autoStage'

export interface MoveOnQualifiedParams {
  supabase: SupabaseClient
  dealId: string
  organizationId: string
  /** `custom_fields` como ficaram DEPOIS da gravação da extração. */
  customFields: Record<string, unknown>
}

export interface MoveOnQualifiedResult {
  moved: boolean
  reason: AutoStageReason | 'deal_nao_encontrado' | 'erro'
  /** Nome do estágio de destino, quando houve movimento. */
  toStageName?: string
}

/**
 * Move o card para o estágio de "qualificado", se a regra do board mandar.
 *
 * Silencioso por natureza: a maioria das chamadas termina em
 * `sem_destino_configurado` — que é o estado normal enquanto ninguém ligar a
 * automação (AC10).
 */
export async function moveDealIfQualified(
  params: MoveOnQualifiedParams
): Promise<MoveOnQualifiedResult> {
  const { supabase, dealId, organizationId, customFields } = params

  try {
    // 1. O deal. `organization_id` explícito além da RLS (defense-in-depth), e
    //    `deleted_at` porque card excluído não anda — story 2.25.
    const { data: deal, error: dealErr } = await supabase
      .from('deals')
      .select('id, stage_id, board_id, contact_id')
      .eq('id', dealId)
      .eq('organization_id', organizationId)
      .is('deleted_at', null)
      .maybeSingle()

    if (dealErr || !deal?.board_id) {
      return { moved: false, reason: 'deal_nao_encontrado' }
    }

    // 2. O destino configurado para o board deste deal.
    //
    //    A regra vive por CANAL, e o deal não sabe por qual canal nasceu — só
    //    sabe o board. Se dois canais alimentam o mesmo board com destinos
    //    DIFERENTES, não há resposta certa: parar é melhor que sortear.
    const { data: rules, error: rulesErr } = await supabase
      .from('lead_routing_rules')
      .select('qualified_stage_id, enabled')
      .eq('board_id', deal.board_id)
      .eq('enabled', true)

    if (rulesErr) {
      console.error('[T3] Falha ao ler regras de roteamento:', rulesErr)
      return { moved: false, reason: 'erro' }
    }

    const destinos = Array.from(
      new Set(
        (rules ?? [])
          .map((r) => r.qualified_stage_id as string | null)
          .filter((id): id is string => Boolean(id))
      )
    )

    if (destinos.length === 0) {
      return { moved: false, reason: 'sem_destino_configurado' }
    }

    if (destinos.length > 1) {
      console.error(
        `[T3] Board ${deal.board_id} tem ${destinos.length} destinos de "qualificado" conflitantes — não movendo o deal ${dealId}`
      )
      return { moved: false, reason: 'erro' }
    }

    const qualifiedStageId = destinos[0]

    // 3. As ordens dos dois estágios, numa leitura só.
    const stageIds = [qualifiedStageId, deal.stage_id].filter(Boolean) as string[]
    const { data: stages, error: stagesErr } = await supabase
      .from('board_stages')
      .select('id, name, "order", board_id')
      .in('id', stageIds)

    if (stagesErr) {
      console.error('[T3] Falha ao ler estágios:', stagesErr)
      return { moved: false, reason: 'erro' }
    }

    const rows = (stages ?? []) as Array<{
      id: string
      name: string
      order: number
      board_id: string
    }>
    const target = rows.find((s) => s.id === qualifiedStageId)
    const current = rows.find((s) => s.id === deal.stage_id)

    const decision = decideAutoStageMove({
      customFields,
      currentStageId: deal.stage_id,
      currentStageOrder: current?.order ?? null,
      qualifiedStageId,
      qualifiedStageOrder: target?.order ?? null,
      dealBoardId: deal.board_id,
      ruleBoardId: target?.board_id ?? null,
    })

    if (!decision.move) {
      return { moved: false, reason: decision.reason }
    }

    // 4. Grava — e CONFERE. O PostgREST devolve sucesso mesmo quando a RLS
    //    filtra a linha e ZERO são atualizadas: sem `.select()`, "respondeu OK"
    //    não significa que gravou (AC6, e a Rule 7 do Meta Ads dentro do código).
    const { data: moved, error: moveErr } = await supabase
      .from('deals')
      .update({ stage_id: qualifiedStageId })
      .eq('id', dealId)
      .eq('organization_id', organizationId)
      .is('deleted_at', null)
      .select('id')

    if (moveErr) {
      console.error('[T3] Falha ao mover o card:', moveErr)
      return { moved: false, reason: 'erro' }
    }

    if (!moved || moved.length === 0) {
      console.error(
        `[T3] UPDATE do deal ${dealId} afetou 0 linhas — card NÃO foi movido (verificar RLS)`
      )
      return { moved: false, reason: 'erro' }
    }

    console.log(`[T3] Deal ${dealId} movido para "${target?.name ?? qualifiedStageId}"`)

    // 5. AC5 — o rastro. `owner_id` fica de fora: não foi pessoa, e a autoria
    //    da automação vai explícita na descrição. Card que muda de coluna
    //    sozinho e sem explicação vira chamado ("quem moveu meu lead?").
    //    Mesmo formato do movimento manual, para a linha do tempo não ficar
    //    com dois dialetos.
    const { error: actErr } = await supabase.from('activities').insert({
      organization_id: organizationId,
      deal_id: dealId,
      contact_id: deal.contact_id,
      type: 'STATUS_CHANGE',
      title: `Moveu para ${target?.name ?? ''}`.trim(),
      description:
        'Movido automaticamente: a IA preencheu onde o lead mora e o tipo de lesão.',
      date: new Date().toISOString(),
      completed: true,
    })

    // Histórico é rastro, não pré-requisito: falhar aqui não desfaz o movimento.
    if (actErr) {
      console.error('[T3] Falha ao registrar a atividade do movimento (não fatal):', actErr.message)
    }

    return { moved: true, reason: 'mover', toStageName: target?.name }
  } catch (error) {
    console.error('[T3] Erro ao mover o card (não fatal):', error)
    return { moved: false, reason: 'erro' }
  }
}
