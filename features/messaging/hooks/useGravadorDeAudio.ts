'use client';

/**
 * Gravação de áudio do WhatsApp — extraída do `MessageInput` (story 2.52, T5)
 * para o compositor da 1ª mensagem usar a MESMA gravação e a MESMA conversão
 * WebM→MP3. O comportamento é o de antes, linha a linha; só mudou de lugar.
 *
 * @module features/messaging/hooks/useGravadorDeAudio
 */

import { useState, useRef, useCallback, useEffect } from 'react';

// lamejs is loaded as a global script (/lame.min.js) to avoid Turbopack CJS interop issues.
// See: app/(protected)/layout.tsx — <Script src="/lame.min.js" />
declare global {
  var lamejs: { Mp3Encoder: new (channels: number, sampleRate: number, bitRate: number) => {
    encodeBuffer(left: Int16Array, right?: Int16Array): Int8Array;
    flush(): Int8Array;
  }};
}

/**
 * Convert a WebM/Opus blob (Chrome MediaRecorder output) to an MP3 file.
 * Uses AudioContext to decode PCM + lamejs to encode to MP3.
 * WhatsApp Cloud API accepts audio/mpeg; Chrome never produces it natively.
 */
export async function convertWebmToMp3(webmBlob: Blob): Promise<File> {
  const Mp3Encoder = window.lamejs?.Mp3Encoder;
  if (!Mp3Encoder) throw new Error('lamejs not loaded — /lame.min.js missing');

  const arrayBuffer = await webmBlob.arrayBuffer();
  const audioContext = new AudioContext();

  // decodeAudioData can hang indefinitely in Chrome on malformed WebM —
  // wrap with a 15s timeout to guarantee resolution.
  const audioBuffer = await Promise.race([
    new Promise<AudioBuffer>((resolve, reject) =>
      audioContext.decodeAudioData(arrayBuffer, resolve, reject)
    ),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('decodeAudioData timeout')), 15_000)
    ),
  ]);

  await audioContext.close();

  const channels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  // 96 kbps — good quality/size tradeoff for voice messages
  const encoder = new Mp3Encoder(channels >= 2 ? 2 : 1, sampleRate, 96);

  const BLOCK_SIZE = 1152; // lamejs required block size

  const leftPCM = floatToInt16(audioBuffer.getChannelData(0));
  const rightPCM = channels >= 2 ? floatToInt16(audioBuffer.getChannelData(1)) : null;

  const mp3Chunks: Int8Array[] = [];

  for (let i = 0; i < leftPCM.length; i += BLOCK_SIZE) {
    const leftChunk = leftPCM.subarray(i, i + BLOCK_SIZE);
    const encoded = rightPCM
      ? encoder.encodeBuffer(leftChunk, rightPCM.subarray(i, i + BLOCK_SIZE))
      : encoder.encodeBuffer(leftChunk);
    if (encoded.length > 0) mp3Chunks.push(encoded);
  }

  const finalBlock = encoder.flush();
  if (finalBlock.length > 0) mp3Chunks.push(finalBlock);

  const mp3Blob = new Blob(mp3Chunks as BlobPart[], { type: 'audio/mpeg' });
  return new File([mp3Blob], `audio-${Date.now()}.mp3`, { type: 'audio/mpeg' });
}

function floatToInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

/** `mm:ss` da duração da gravação. */
export function formatarDuracao(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export interface OpcoesDoGravador {
  /** Áudio pronto num formato que o WhatsApp toca (nunca webm). */
  onAudioPronto: (file: File) => void;
  /** A conversão de webm falhou: o arquivo quebrado é descartado. */
  onFalhaNaConversao?: () => void;
}

export function useGravadorDeAudio({ onAudioPronto, onFalhaNaConversao }: OpcoesDoGravador) {
  const [isRecording, setIsRecording] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Os callbacks vêm de quem usa; lidos por ref para os handlers seguirem estáveis
  // (como eram no `MessageInput`, com dependências vazias).
  const onAudioProntoRef = useRef(onAudioPronto);
  const onFalhaRef = useRef(onFalhaNaConversao);
  useEffect(() => {
    onAudioProntoRef.current = onAudioPronto;
    onFalhaRef.current = onFalhaNaConversao;
  }, [onAudioPronto, onFalhaNaConversao]);

  // Cleanup recording on unmount
  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        recorder.stream?.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Prefer formats WhatsApp accepts natively (no conversion needed):
      //   1. audio/ogg;codecs=opus  — Firefox
      //   2. audio/mp4              — macOS/iOS Chrome (AAC) ← fixes Chrome on macOS
      //   3. audio/webm             — Windows Chrome fallback (needs conversion)
      const PREFERRED_TYPES = [
        'audio/ogg;codecs=opus',
        'audio/mp4',
        'audio/mp4;codecs=mp4a.40.2',
        'audio/webm;codecs=opus',
        'audio/webm',
      ];
      const mimeType = PREFERRED_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.start(100);
      setIsRecording(true);
      setRecordingDuration(0);

      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration((d) => d + 1);
      }, 1000);
    } catch {
      // User denied microphone or device unavailable — fail silently
    }
  }, []);

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;

    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    recorder.onstop = async () => {
      recorder.stream?.getTracks().forEach((t) => t.stop());
      setIsRecording(false);

      const baseMimeType = recorder.mimeType.split(';')[0];
      const isWhatsAppNative = baseMimeType === 'audio/ogg'
        || baseMimeType === 'audio/mp4'
        || baseMimeType === 'audio/mpeg'
        || baseMimeType === 'audio/aac'
        || baseMimeType === 'audio/amr';

      if (isWhatsAppNative) {
        // Format already accepted by WhatsApp — no conversion needed
        const MIME_TO_EXT: Record<string, string> = {
          'audio/ogg': 'ogg',
          'audio/mp4': 'm4a',
          'audio/mpeg': 'mp3',
          'audio/aac': 'aac',
          'audio/amr': 'amr',
        };
        const ext = MIME_TO_EXT[baseMimeType] ?? 'audio';
        const file = new File(
          audioChunksRef.current,
          `audio-${Date.now()}.${ext}`,
          { type: baseMimeType }
        );
        onAudioProntoRef.current(file);
        setRecordingDuration(0);
        audioChunksRef.current = [];
        return;
      }

      // audio/webm (Windows Chrome) — try MP3 conversion via lamejs
      setIsConverting(true);
      try {
        const rawBlob = new Blob(audioChunksRef.current, { type: recorder.mimeType });
        const mp3File = await convertWebmToMp3(rawBlob);
        onAudioProntoRef.current(mp3File);
      } catch (err) {
        console.error('[Audio] MP3 conversion failed:', err);
        // webm not accepted by WhatsApp — clear media rather than send a broken file
        onFalhaRef.current?.();
      } finally {
        setIsConverting(false);
        setRecordingDuration(0);
        audioChunksRef.current = [];
      }
    };

    recorder.stop();
  }, []);

  const cancelRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = () => {
        recorder.stream?.getTracks().forEach((t) => t.stop());
      };
      recorder.stop();
    }
    setIsRecording(false);
    setRecordingDuration(0);
    audioChunksRef.current = [];
  }, []);

  return {
    isRecording,
    isConverting,
    recordingDuration,
    startRecording,
    stopRecording,
    cancelRecording,
  };
}
