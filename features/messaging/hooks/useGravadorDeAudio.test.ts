/**
 * Story 2.52, T5 — a gravação saiu do `MessageInput` para um hook, sem mudar o
 * comportamento: formato nativo do WhatsApp passa direto; webm só sai convertido
 * (falhou a conversão ⇒ descarta, nunca entrega webm).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { formatarDuracao, useGravadorDeAudio } from './useGravadorDeAudio';

class GravadorFalso {
  static suportado = 'audio/ogg;codecs=opus';
  static isTypeSupported(t: string) {
    return t === GravadorFalso.suportado;
  }
  state: 'inactive' | 'recording' = 'inactive';
  mimeType: string;
  stream = { getTracks: () => [{ stop: vi.fn() }] };
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void | Promise<void>) | null = null;
  constructor(_s: unknown, opts: { mimeType: string }) {
    this.mimeType = opts.mimeType;
  }
  start() {
    this.state = 'recording';
    this.ondataavailable?.({ data: new Blob([new Uint8Array(8)], { type: this.mimeType }) });
  }
  async stop() {
    this.state = 'inactive';
    await this.onstop?.();
  }
}

beforeEach(() => {
  vi.stubGlobal('MediaRecorder', GravadorFalso);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({})) },
  });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useGravadorDeAudio', () => {
  it('formato nativo (ogg) ⇒ entrega um File audio/ogg .ogg e zera o estado', async () => {
    GravadorFalso.suportado = 'audio/ogg;codecs=opus';
    const onAudioPronto = vi.fn();
    const { result } = renderHook(() => useGravadorDeAudio({ onAudioPronto }));

    await act(async () => {
      await result.current.startRecording();
    });
    expect(result.current.isRecording).toBe(true);

    await act(async () => {
      result.current.stopRecording();
    });

    expect(onAudioPronto).toHaveBeenCalledTimes(1);
    const file = onAudioPronto.mock.calls[0][0] as File;
    expect(file.type).toBe('audio/ogg');
    expect(file.name).toMatch(/^audio-\d+\.ogg$/);
    expect(result.current.isRecording).toBe(false);
    expect(result.current.recordingDuration).toBe(0);
  });

  it('webm sem o conversor ⇒ descarta (onFalhaNaConversao) e nunca entrega webm', async () => {
    GravadorFalso.suportado = 'audio/webm';
    const onAudioPronto = vi.fn();
    const onFalhaNaConversao = vi.fn();
    const { result } = renderHook(() => useGravadorDeAudio({ onAudioPronto, onFalhaNaConversao }));

    await act(async () => {
      await result.current.startRecording();
    });
    await act(async () => {
      result.current.stopRecording();
    });

    expect(onAudioPronto).not.toHaveBeenCalled();
    expect(onFalhaNaConversao).toHaveBeenCalledTimes(1);
    expect(result.current.isConverting).toBe(false);
  });

  it('cancelar ⇒ não entrega nada', async () => {
    GravadorFalso.suportado = 'audio/ogg;codecs=opus';
    const onAudioPronto = vi.fn();
    const { result } = renderHook(() => useGravadorDeAudio({ onAudioPronto }));

    await act(async () => {
      await result.current.startRecording();
    });
    await act(async () => {
      result.current.cancelRecording();
    });

    expect(onAudioPronto).not.toHaveBeenCalled();
    expect(result.current.isRecording).toBe(false);
  });

  it('formatarDuracao ⇒ mm:ss', () => {
    expect(formatarDuracao(0)).toBe('00:00');
    expect(formatarDuracao(75)).toBe('01:15');
  });
});
