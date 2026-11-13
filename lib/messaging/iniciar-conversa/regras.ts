/**
 * @fileoverview Regras da 1ª mensagem — story 2.52 (AC3, AC4.5, AC6).
 *
 * Sem I/O: só constantes e decisões, para os testes afirmarem os valores.
 *
 * @module lib/messaging/iniciar-conversa/regras
 */

/** Q3 (09/10, reconfirmada em 13/11): conversas iniciadas COM SUCESSO por dia, por organização. */
export const LIMITE_DIARIO = 20;

/** AC3: tamanho do texto. */
export const MAX_TEXTO = 4000;

/** AC3: abaixo do limite de corpo da Vercel (4,5 MB). */
export const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

/**
 * AC3: tipos que o WhatsApp toca. **Sem `audio/webm`** — o gravador converte
 * para MP3 antes (`useGravadorDeAudio`).
 */
export const TIPOS_DE_AUDIO: Record<string, string> = {
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/amr': 'amr',
};

/** Ação gravada em `audit_logs` (AC7) — a contagem do teto lê esta mesma ação. */
export const ACAO_INICIAR = 'whatsapp_conversa_iniciada';
export const ACAO_HUMANO = 'whatsapp_conversa_humano';
export const ACAO_ASSUMIR = 'whatsapp_conversa_assumir';

export const TEXTO_LIMITE_ATINGIDO = `Limite de ${LIMITE_DIARIO} conversas iniciadas hoje atingido. Tente amanhã.`;

/** Tipo-base do áudio (`audio/ogg;codecs=opus` ⇒ `audio/ogg`). */
export function tipoBaseDoAudio(tipo: string | null | undefined): string {
  return String(tipo ?? '').split(';')[0].trim().toLowerCase();
}

export type ConteudoDaPrimeiraMensagem =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'audio'; arquivo: Blob; mime: string; extensao: string };

/**
 * AC3 — exatamente um dos dois: texto (1–4.000, não só espaços) OU áudio (tipo da
 * lista, até 4 MB). Qualquer outra combinação devolve o motivo (a rota responde 422).
 */
export function validarConteudo(entrada: {
  texto?: unknown;
  audio?: unknown;
}): { ok: true; conteudo: ConteudoDaPrimeiraMensagem } | { ok: false; motivo: string } {
  const temTexto = typeof entrada.texto === 'string' && entrada.texto.length > 0;
  const audio = entrada.audio;
  const temAudio = audio !== null && audio !== undefined && audio !== '';

  if (temTexto && temAudio) return { ok: false, motivo: 'Envie texto ou áudio, não os dois.' };
  if (!temTexto && !temAudio) return { ok: false, motivo: 'Escreva uma mensagem ou grave um áudio.' };

  if (temTexto) {
    const texto = entrada.texto as string;
    if (!texto.trim()) return { ok: false, motivo: 'A mensagem está vazia.' };
    if (texto.length > MAX_TEXTO) {
      return { ok: false, motivo: `A mensagem passa de ${MAX_TEXTO} caracteres.` };
    }
    return { ok: true, conteudo: { tipo: 'texto', texto } };
  }

  if (!(audio instanceof Blob)) return { ok: false, motivo: 'Áudio inválido.' };
  const mime = tipoBaseDoAudio(audio.type);
  const extensao = TIPOS_DE_AUDIO[mime];
  if (!extensao) return { ok: false, motivo: 'Formato de áudio não aceito pelo WhatsApp.' };
  if (audio.size <= 0) return { ok: false, motivo: 'O áudio está vazio.' };
  if (audio.size > MAX_AUDIO_BYTES) return { ok: false, motivo: 'O áudio passa de 4 MB.' };
  return { ok: true, conteudo: { tipo: 'audio', arquivo: audio, mime, extensao } };
}

/**
 * Início do dia em `America/Sao_Paulo`, em ISO (AC3: o teto zera à meia-noite de
 * Brasília). O Brasil não tem horário de verão desde 2019 ⇒ `-03:00` fixo.
 */
export function inicioDoDiaEmSaoPaulo(agora: Date): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(agora); // "2026-11-13"
  return new Date(`${partes}T00:00:00-03:00`).toISOString();
}

/**
 * Motivo curto e sem nome de fornecedor para o toast (AC6). O detalhe técnico
 * fica no log do servidor, nunca na tela.
 */
export function motivoResumido(erro: string | null | undefined): string {
  const msg = String(erro ?? '');
  if (/abort|timeout|timed out/i.test(msg)) return 'a IA do WhatsApp não respondeu a tempo';
  const codigo = msg.match(/\b([45]\d{2})\b/)?.[1];
  if (codigo?.startsWith('4')) return `o WhatsApp recusou o envio (código ${codigo})`;
  if (codigo?.startsWith('5')) return `a IA do WhatsApp está fora do ar (código ${codigo})`;
  return 'falha de comunicação com a IA do WhatsApp';
}

// -----------------------------------------------------------------------------
// AC4.5 — tentativas de passar a conversa para o humano, com prazo pelo relógio
// -----------------------------------------------------------------------------

/** Relógio total da requisição (a rota exporta `maxDuration = 60`). */
export const PRAZO_TOTAL_MS = 55_000;
/** Pior caso de um ciclo: `startHuman` + leitura, 15 s cada (`REQUEST_TIMEOUT_MS`). */
export const CUSTO_MAXIMO_DO_CICLO_MS = 30_000;
/** Intervalo entre ciclos. */
export const INTERVALO_ENTRE_CICLOS_MS = 8_000;

/** Só começa um ciclo se tempo gasto + 30 s ≤ 55 s. */
export function podeComecarCiclo(gastoMs: number): boolean {
  return gastoMs + CUSTO_MAXIMO_DO_CICLO_MS <= PRAZO_TOTAL_MS;
}

/**
 * Laço do AC4.5. `tentar` faz UM ciclo (`startHuman` + leitura do chat) e diz se
 * o chat ficou com humano. Erro dentro de `tentar` conta como ciclo sem sucesso.
 */
export async function tentarAteConfirmar(deps: {
  inicioMs: number;
  agoraMs: () => number;
  esperar: (ms: number) => Promise<void>;
  tentar: () => Promise<boolean>;
}): Promise<{ confirmado: boolean; ciclos: number }> {
  let ciclos = 0;
  while (podeComecarCiclo(deps.agoraMs() - deps.inicioMs)) {
    ciclos++;
    let ok = false;
    try {
      ok = await deps.tentar();
    } catch {
      ok = false;
    }
    if (ok) return { confirmado: true, ciclos };
    if (!podeComecarCiclo(deps.agoraMs() - deps.inicioMs + INTERVALO_ENTRE_CICLOS_MS)) break;
    await deps.esperar(INTERVALO_ENTRE_CICLOS_MS);
  }
  return { confirmado: false, ciclos };
}
