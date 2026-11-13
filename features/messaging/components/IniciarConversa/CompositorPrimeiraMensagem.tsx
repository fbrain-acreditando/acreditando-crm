'use client';

/**
 * Compositor da 1ª mensagem — story 2.52, AC6.
 *
 * Abre VAZIO (sem texto pronto, V10): a Fernanda escreve ou grava na hora. Texto
 * OU áudio, nunca os dois. Cancelar não chama a rota. Mostra o teto do dia.
 * Enviar trava o botão enquanto a requisição corre e por 60 s depois (sem
 * disparo duplo), mesmo que o compositor feche e abra de novo.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Mic, Send, Square, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { queryKeys } from '@/lib/query/queryKeys';
import { useGravadorDeAudio, formatarDuracao } from '../../hooks/useGravadorDeAudio';

export const TRAVA_MS = 60_000;
const LIMITE_PADRAO = 20;

/** Trava por card, fora do componente: sobrevive a fechar e abrir o compositor. */
const travas = new Map<string, number>();

export function limparTravasParaTeste() {
  travas.clear();
}

export type ResultadoDoEnvio =
  | { tipo: 'enviada'; conversationId: string }
  | { tipo: 'ja_tem_conversa'; conversationId: string | null }
  | { tipo: 'erro'; mensagem: string };

/** Pede à rota e traduz a resposta para a tela (texto sempre sem nome de fornecedor). */
export async function enviarPrimeiraMensagem(
  dealId: string,
  conteudo: { texto: string } | { audio: File }
): Promise<ResultadoDoEnvio> {
  let res: Response;
  try {
    if ('audio' in conteudo) {
      const form = new FormData();
      form.set('dealId', dealId);
      form.set('audio', conteudo.audio);
      res = await fetch('/api/messaging/conversations/start', { method: 'POST', body: form });
    } else {
      res = await fetch('/api/messaging/conversations/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dealId, text: conteudo.texto }),
      });
    }
  } catch {
    return { tipo: 'erro', mensagem: 'Não foi possível iniciar a conversa: sem conexão com o servidor' };
  }

  const corpo = (await res.json().catch(() => ({}))) as { conversationId?: string; error?: string };
  if (res.ok && corpo.conversationId) return { tipo: 'enviada', conversationId: corpo.conversationId };
  if (res.status === 409) return { tipo: 'ja_tem_conversa', conversationId: corpo.conversationId ?? null };
  if (res.status === 429) {
    return { tipo: 'erro', mensagem: corpo.error ?? 'Limite de 20 conversas iniciadas hoje atingido. Tente amanhã.' };
  }
  const motivo = corpo.error ?? `erro ${res.status}`;
  return {
    tipo: 'erro',
    mensagem: motivo.startsWith('Não foi possível') ? motivo : `Não foi possível iniciar a conversa: ${motivo}`,
  };
}

interface Props {
  dealId: string;
  onResultado: (r: ResultadoDoEnvio) => void;
  onCancelar: () => void;
}

export function CompositorPrimeiraMensagem({ dealId, onResultado, onCancelar }: Props) {
  const [texto, setTexto] = useState('');
  const [audio, setAudio] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [agora, setAgora] = useState(() => Date.now());

  const gravador = useGravadorDeAudio({
    onAudioPronto: (f) => setAudio(f),
    onFalhaNaConversao: () => setAudio(null),
  });

  const { data: contador } = useQuery({
    queryKey: queryKeys.messagingConversations.iniciadasHoje(),
    queryFn: async (): Promise<{ usadasHoje: number; limite: number }> => {
      const r = await fetch('/api/messaging/conversations/start');
      if (!r.ok) throw new Error('contador indisponível');
      return r.json();
    },
    staleTime: 15_000,
  });

  const travadoAte = travas.get(dealId) ?? 0;
  const segundosTravado = Math.max(0, Math.ceil((travadoAte - agora) / 1000));

  // Relógio do contador regressivo só enquanto houver trava.
  useEffect(() => {
    if (segundosTravado <= 0) return;
    const id = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(id);
  }, [segundosTravado]);

  const temConteudo = audio !== null || texto.trim().length > 0;
  const podeEnviar = temConteudo && !enviando && segundosTravado === 0 && !gravador.isRecording && !gravador.isConverting;

  const enviar = useCallback(async () => {
    if (!podeEnviar) return;
    setEnviando(true);
    const r = await enviarPrimeiraMensagem(dealId, audio ? { audio } : { texto });
    travas.set(dealId, Date.now() + TRAVA_MS);
    setAgora(Date.now());
    setEnviando(false);
    onResultado(r);
  }, [podeEnviar, dealId, audio, texto, onResultado]);

  const usadas = contador?.usadasHoje;
  const limite = contador?.limite ?? LIMITE_PADRAO;

  return (
    <div
      className="mt-3 w-full basis-full rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 p-3 space-y-2"
      role="group"
      aria-label="Primeira mensagem no WhatsApp"
    >
      <p className="text-xs text-slate-500 dark:text-slate-400" data-testid="contador-do-dia">
        Até {limite} conversas iniciadas por dia — {usadas ?? '…'} {usadas === 1 ? 'usada' : 'usadas'} hoje
      </p>

      {audio ? (
        <div className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
          <Mic size={14} aria-hidden="true" />
          <span className="flex-1">Áudio gravado, pronto para enviar</span>
          <button
            type="button"
            onClick={() => setAudio(null)}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10"
          >
            <Trash2 size={12} aria-hidden="true" /> Descartar áudio
          </button>
        </div>
      ) : gravador.isRecording ? (
        <div className="flex items-center gap-2 text-sm text-red-600">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" aria-hidden="true" />
          <span className="flex-1">Gravando {formatarDuracao(gravador.recordingDuration)}</span>
          <button type="button" onClick={gravador.cancelRecording} className="rounded px-2 py-1 text-xs hover:bg-slate-100 dark:hover:bg-white/10">
            <X size={12} aria-hidden="true" className="inline" /> Cancelar gravação
          </button>
          <button type="button" onClick={gravador.stopRecording} className="rounded px-2 py-1 text-xs hover:bg-slate-100 dark:hover:bg-white/10">
            <Square size={12} aria-hidden="true" className="inline" /> Parar
          </button>
        </div>
      ) : gravador.isConverting ? (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Preparando o áudio…
        </p>
      ) : (
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          maxLength={4000}
          rows={3}
          placeholder="Escreva a primeira mensagem para o lead"
          aria-label="Primeira mensagem"
          className="w-full resize-y rounded-md border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 p-2 text-sm text-slate-900 dark:text-white"
        />
      )}

      <div className="flex items-center justify-between gap-2">
        {!audio && !gravador.isRecording && !gravador.isConverting && !texto.trim() ? (
          <button
            type="button"
            onClick={gravador.startRecording}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10"
          >
            <Mic size={14} aria-hidden="true" /> Gravar áudio
          </button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              gravador.cancelRecording();
              onCancelar();
            }}
            className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={enviar}
            disabled={!podeEnviar}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-white bg-green-600 hover:bg-green-700',
              !podeEnviar && 'opacity-50 cursor-not-allowed'
            )}
          >
            {enviando ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Send size={14} aria-hidden="true" />}
            {segundosTravado > 0 ? `Aguarde ${segundosTravado} s` : 'Enviar'}
          </button>
        </div>
      </div>
    </div>
  );
}
