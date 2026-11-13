/**
 * Iniciar conversa no WhatsApp a partir do card do lead — story 2.52.
 *
 * POST /api/messaging/conversations/start
 *   JSON      `{ dealId, text }`
 *   multipart `dealId` + `audio` (ogg/mpeg/mp4/aac/amr, até 4 MB — sem webm)
 *
 * Telefone, contato e canal vêm do BANCO, nunca do corpo (AC3). A regra está em
 * `lib/messaging/iniciar-conversa/servico.ts`.
 *
 * GET /api/messaging/conversations/start ⇒ `{ usadasHoje, limite }` (contador do
 * compositor, AC6).
 */
import { NextResponse, after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createStaticAdminClient } from '@/lib/supabase/staticAdminClient';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { LIMITE_DIARIO, validarConteudo } from '@/lib/messaging/iniciar-conversa/regras';
import {
  confirmarHumano,
  contarIniciadasHoje,
  iniciarConversa,
} from '@/lib/messaging/iniciar-conversa/servico';
import { criarProvedorDoCanal } from '@/lib/messaging/iniciar-conversa/provedor';
import { agoraMs } from '@/lib/messaging/iniciar-conversa/relogio';

// AC4.5: o laço do `startHuman` roda em `after()` com prazo de 55 s pelo relógio.
// 60 é o maior valor já usado no repositório (`app/api/ai/chat/route.ts`).
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function usuarioEOrganizacao(): Promise<
  { ok: true; userId: string; orgId: string } | { ok: false; resposta: Response }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, resposta: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile?.organization_id) {
    return { ok: false, resposta: NextResponse.json({ error: 'Perfil não encontrado.' }, { status: 404 }) };
  }
  return { ok: true, userId: user.id, orgId: profile.organization_id as string };
}

async function lerCorpo(req: Request): Promise<{ dealId: unknown; texto: unknown; audio: unknown } | null> {
  const tipo = req.headers.get('content-type') ?? '';
  try {
    if (tipo.includes('multipart/form-data')) {
      const form = await req.formData();
      return { dealId: form.get('dealId'), texto: form.get('text') ?? undefined, audio: form.get('audio') ?? undefined };
    }
    const json = (await req.json()) as Record<string, unknown>;
    // Só estes campos são lidos: telefone/canal/contato no corpo são ignorados.
    return { dealId: json?.dealId, texto: json?.text, audio: undefined };
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const inicioMs = agoraMs();
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const quem = await usuarioEOrganizacao();
  if (!quem.ok) return quem.resposta;

  const corpo = await lerCorpo(req);
  if (!corpo) return NextResponse.json({ error: 'Corpo inválido.' }, { status: 422 });
  if (typeof corpo.dealId !== 'string' || !UUID.test(corpo.dealId)) {
    return NextResponse.json({ error: 'dealId inválido.' }, { status: 422 });
  }

  const validado = validarConteudo({ texto: corpo.texto, audio: corpo.audio });
  if (!validado.ok) return NextResponse.json({ error: validado.motivo }, { status: 422 });

  const db = createStaticAdminClient();
  const resultado = await iniciarConversa({
    db,
    orgId: quem.orgId,
    userId: quem.userId,
    dealId: corpo.dealId,
    conteudo: validado.conteudo,
    criarProvedor: criarProvedorDoCanal,
  });

  if (resultado.confirmarHumano) {
    const { conversationId, canal } = resultado.confirmarHumano;
    after(async () => {
      try {
        await confirmarHumano({
          db,
          orgId: quem.orgId,
          userId: quem.userId,
          conversationId,
          canal,
          criarProvedor: criarProvedorDoCanal,
          inicioMs,
        });
      } catch (e) {
        console.error('[conversations/start] confirmarHumano falhou:', e instanceof Error ? e.message : e);
      }
    });
  }

  return NextResponse.json(resultado.corpo, { status: resultado.status });
}

export async function GET() {
  const quem = await usuarioEOrganizacao();
  if (!quem.ok) return quem.resposta;
  try {
    const usadasHoje = await contarIniciadasHoje(createStaticAdminClient(), quem.orgId);
    return NextResponse.json({ usadasHoje, limite: LIMITE_DIARIO });
  } catch {
    return NextResponse.json({ error: 'Falha ao contar.' }, { status: 500 });
  }
}
