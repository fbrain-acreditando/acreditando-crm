/**
 * Story 2.52 — regras puras: conteúdo (AC3), dia de Brasília (AC3), motivo do
 * toast (AC6) e o laço com prazo pelo relógio (AC4.5).
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_AUDIO_BYTES,
  inicioDoDiaEmSaoPaulo,
  motivoResumido,
  podeComecarCiclo,
  tentarAteConfirmar,
  validarConteudo,
} from './regras';

function audio(tipo: string, bytes = 10): Blob {
  return new Blob([new Uint8Array(bytes)], { type: tipo });
}

describe('validarConteudo (AC3)', () => {
  it('texto ⇒ ok, com o texto exatamente como digitado', () => {
    const r = validarConteudo({ texto: 'Olá, Maria! Tudo bem?' });
    expect(r).toEqual({ ok: true, conteudo: { tipo: 'texto', texto: 'Olá, Maria! Tudo bem?' } });
  });

  it('nem texto nem áudio ⇒ recusa', () => {
    expect(validarConteudo({}).ok).toBe(false);
    expect(validarConteudo({ texto: '' }).ok).toBe(false);
  });

  it('os dois juntos ⇒ recusa', () => {
    expect(validarConteudo({ texto: 'oi', audio: audio('audio/mpeg') }).ok).toBe(false);
  });

  it('só espaços ⇒ recusa; 4.001 caracteres ⇒ recusa; 4.000 ⇒ ok', () => {
    expect(validarConteudo({ texto: '   \n ' }).ok).toBe(false);
    expect(validarConteudo({ texto: 'a'.repeat(4001) }).ok).toBe(false);
    expect(validarConteudo({ texto: 'a'.repeat(4000) }).ok).toBe(true);
  });

  it('audio/webm ⇒ recusa (o WhatsApp não toca)', () => {
    expect(validarConteudo({ audio: audio('audio/webm') }).ok).toBe(false);
    expect(validarConteudo({ audio: audio('audio/webm;codecs=opus') }).ok).toBe(false);
  });

  it('tipo fora da lista ⇒ recusa', () => {
    expect(validarConteudo({ audio: audio('video/mp4') }).ok).toBe(false);
  });

  it('acima de 4 MB ⇒ recusa; exatamente 4 MB ⇒ ok', () => {
    expect(validarConteudo({ audio: audio('audio/mpeg', MAX_AUDIO_BYTES + 1) }).ok).toBe(false);
    const r = validarConteudo({ audio: audio('audio/mpeg', MAX_AUDIO_BYTES) });
    expect(r.ok).toBe(true);
  });

  it('ogg com codecs ⇒ tipo-base e extensão certos', () => {
    const r = validarConteudo({ audio: audio('audio/ogg;codecs=opus') });
    expect(r.ok && r.conteudo.tipo === 'audio' && [r.conteudo.mime, r.conteudo.extensao]).toEqual([
      'audio/ogg',
      'ogg',
    ]);
  });
});

describe('inicioDoDiaEmSaoPaulo (AC3)', () => {
  it('01:30 UTC de 14/11 ainda é 13/11 em Brasília', () => {
    expect(inicioDoDiaEmSaoPaulo(new Date('2026-11-14T01:30:00Z'))).toBe('2026-11-13T03:00:00.000Z');
  });
  it('03:00 UTC de 14/11 já é 14/11 em Brasília', () => {
    expect(inicioDoDiaEmSaoPaulo(new Date('2026-11-14T03:00:00Z'))).toBe('2026-11-14T03:00:00.000Z');
  });
});

describe('motivoResumido (AC6)', () => {
  it('nunca cita o nome do fornecedor', () => {
    for (const erro of [
      'GPT Maker API request failed: 400 {"error":"malformed"}',
      'GPT Maker API request failed: 503 down',
      'The operation was aborted',
      'GPTMaker qualquer coisa',
    ]) {
      expect(motivoResumido(erro)).not.toMatch(/gpt\s*maker/i);
    }
  });
  it('4xx ⇒ recusado com o código', () => {
    expect(motivoResumido('GPT Maker API request failed: 400 x')).toBe(
      'o WhatsApp recusou o envio (código 400)'
    );
  });
});

describe('tentarAteConfirmar (AC4.5)', () => {
  function relogioVirtual() {
    let t = 0;
    return {
      agoraMs: () => t,
      avancar: (ms: number) => {
        t += ms;
      },
      esperar: async (ms: number) => {
        t += ms;
      },
    };
  }

  it('só começa ciclo se gasto + 30 s ≤ 55 s', () => {
    expect(podeComecarCiclo(25_000)).toBe(true);
    expect(podeComecarCiclo(25_001)).toBe(false);
  });

  it('falha nas 2 primeiras e confirma na 3ª ⇒ 3 tentativas', async () => {
    const r = relogioVirtual();
    let chamadas = 0;
    const res = await tentarAteConfirmar({
      inicioMs: 0,
      agoraMs: r.agoraMs,
      esperar: r.esperar,
      tentar: async () => {
        chamadas++;
        r.avancar(500);
        return chamadas === 3;
      },
    });
    expect(chamadas).toBe(3);
    expect(res).toEqual({ confirmado: true, ciclos: 3 });
  });

  it('sempre falhando com chamadas rápidas ⇒ para antes de estourar 55 s', async () => {
    const r = relogioVirtual();
    const inicios: number[] = [];
    const res = await tentarAteConfirmar({
      inicioMs: 0,
      agoraMs: r.agoraMs,
      esperar: r.esperar,
      tentar: async () => {
        inicios.push(r.agoraMs());
        r.avancar(100);
        return false;
      },
    });
    expect(res.confirmado).toBe(false);
    // Nenhum ciclo começou com gasto + 30 s > 55 s.
    for (const t of inicios) expect(t + 30_000).toBeLessThanOrEqual(55_000);
    expect(inicios).toEqual([0, 8_100, 16_200, 24_300]);
  });

  it('chamadas lentas (15 s cada, 30 s por ciclo) ⇒ um ciclo só, e termina antes de 55 s', async () => {
    const r = relogioVirtual();
    const inicios: number[] = [];
    const res = await tentarAteConfirmar({
      inicioMs: 0,
      agoraMs: r.agoraMs,
      esperar: r.esperar,
      tentar: async () => {
        inicios.push(r.agoraMs());
        r.avancar(30_000);
        return false;
      },
    });
    expect(res).toEqual({ confirmado: false, ciclos: 1 });
    expect(inicios).toEqual([0]);
    expect(r.agoraMs()).toBeLessThanOrEqual(55_000);
  });

  it('a requisição já gastou 26 s antes do laço ⇒ nenhum ciclo começa', async () => {
    const r = relogioVirtual();
    r.avancar(26_000);
    let chamadas = 0;
    const res = await tentarAteConfirmar({
      inicioMs: 0,
      agoraMs: r.agoraMs,
      esperar: r.esperar,
      tentar: async () => {
        chamadas++;
        return true;
      },
    });
    expect(chamadas).toBe(0);
    expect(res).toEqual({ confirmado: false, ciclos: 0 });
  });

  it('erro dentro da tentativa conta como ciclo sem sucesso', async () => {
    const r = relogioVirtual();
    let chamadas = 0;
    const res = await tentarAteConfirmar({
      inicioMs: 0,
      agoraMs: r.agoraMs,
      esperar: r.esperar,
      tentar: async () => {
        chamadas++;
        if (chamadas === 1) throw new Error('rede');
        return true;
      },
    });
    expect(res).toEqual({ confirmado: true, ciclos: 2 });
  });
});
