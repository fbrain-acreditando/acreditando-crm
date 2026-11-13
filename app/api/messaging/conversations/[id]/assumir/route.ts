/**
 * Botão "Assumir conversa" — story 2.52, AC4.6.
 *
 * POST /api/messaging/conversations/[id]/assumir
 *
 * Um ciclo `startHuman` + leitura do `humanTalk` dentro da requisição, só para
 * conversa iniciada pelo CRM. Grava `metadata.assumido_em` a cada clique;
 * confirmou ⇒ `humano_confirmado_em` e some o `humano_falhou`.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createStaticAdminClient } from '@/lib/supabase/staticAdminClient';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { assumirConversa } from '@/lib/messaging/iniciar-conversa/servico';
import { criarProvedorDoCanal } from '@/lib/messaging/iniciar-conversa/provedor';

// Um ciclo = até 2 chamadas de 15 s.
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, { params }: RouteParams) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile?.organization_id) {
    return NextResponse.json({ error: 'Perfil não encontrado.' }, { status: 404 });
  }

  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Conversa não encontrada.' }, { status: 404 });

  const r = await assumirConversa({
    db: createStaticAdminClient(),
    orgId: profile.organization_id as string,
    userId: user.id,
    conversationId: id,
    criarProvedor: criarProvedorDoCanal,
  });
  return NextResponse.json(r.corpo, { status: r.status });
}
