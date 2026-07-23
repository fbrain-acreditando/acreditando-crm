'use client'

import { useRealtimeSyncAll } from '@/lib/realtime'

/**
 * RealtimeBridge — monta as subscriptions do Supabase Realtime UMA vez para todo o
 * app protegido (deals, contacts, activities, boards, crm_companies).
 *
 * Antes, o Realtime só era montado dentro de board/inbox/contatos/atividades — então
 * dashboard, relatórios, detalhe de deal e qualquer outra tela NUNCA recebiam push
 * e só atualizavam no F5. Este componente invisível fecha esse buraco: com ele, uma
 * mudança em qualquer aba/usuário reflete ao vivo em TODAS as telas.
 *
 * Deve ficar dentro do QueryProvider (usa useQueryClient) e do AuthProvider (sessão).
 */
export default function RealtimeBridge() {
  useRealtimeSyncAll()
  return null
}
