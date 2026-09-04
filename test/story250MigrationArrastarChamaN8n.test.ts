/**
 * Story 2.50 — o arrastar que chama o n8n.
 *
 * As duas funções desta story são recriadas com `CREATE OR REPLACE`. Isso quer
 * dizer que **qualquer trecho esquecido some do trigger em produção, calado** —
 * não há erro, não há aviso, o payload simplesmente fica menor no dia seguinte.
 *
 * Não existe (ainda) harness de Postgres nesta suíte, então este teste lê o SQL
 * da migration como texto e trava as invariantes que uma reescrita distraída
 * quebraria primeiro:
 *
 *   • nenhuma chave do payload antigo desapareceu;
 *   • a busca da conversa está em bloco `EXCEPTION` PRÓPRIO — não no bloco que
 *     protege o `net.http_post` (armadilha #2 da story);
 *   • o filtro por etapa usa `pontua_lead` e não `conta_como_fila`;
 *   • o `search_path` das duas funções foi repetido no `CREATE OR REPLACE`
 *     (sem o `SET`, o Postgres zera a configuração e reabre o vetor de escalada
 *     de privilégio que `20260221200002` fechou);
 *   • a flag nasce desligada por UPDATE explícito, e não só pelo `default`;
 *   • nenhum segredo foi versionado junto.
 *
 * Segue o precedente de `test/tokenLog.test.ts`, que também compara o TypeScript
 * com o SQL da migration em vez de confiar na memória de quem escreveu.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const CAMINHO = 'supabase/migrations/20260902100000_o_arrastar_que_chama_o_n8n.sql';

const sql = readFileSync(join(process.cwd(), CAMINHO), 'utf-8');

/** Só o corpo da função do webhook, sem os comentários de cabeçalho da migration. */
const corpoNotify = sql.slice(
  sql.indexOf('create or replace function public.notify_deal_stage_changed()')
);

const corpoEnfileirar = sql.slice(
  sql.indexOf('create or replace function public.enfileirar_pontuacao_do_lead()'),
  sql.indexOf('create or replace function public.notify_deal_stage_changed()')
);

describe('story 2.50 — migration do webhook que chama o n8n', () => {
  describe('notify_deal_stage_changed — o payload não pode encolher', () => {
    // Lidas de `pg_proc.prosrc` no banco de produção em 02/09/2026, antes de a
    // migration ser escrita. Se alguma sumir da migration, o n8n (ou qualquer
    // outro consumidor futuro) perde o campo sem ninguém perceber.
    const CHAVES_DO_PAYLOAD_ANTIGO = [
      "'event_type', 'deal.stage_changed'",
      "'occurred_at', now()",
      "'id', NEW.id",
      "'title', NEW.title",
      "'value', NEW.value",
      "'board_id', NEW.board_id",
      "'board_name', board_name",
      "'from_stage_id', OLD.stage_id",
      "'from_stage_label', from_label",
      "'to_stage_id', NEW.stage_id",
      "'to_stage_label', to_label",
      "'contact_id', NEW.contact_id",
      "'name', contact_name",
      "'phone', contact_phone",
      "'email', contact_email",
    ];

    it.each(CHAVES_DO_PAYLOAD_ANTIGO)('preserva %s', (chave) => {
      expect(corpoNotify).toContain(chave);
    });

    it('acrescenta o bloco conversation com id e gptmaker_chat_id', () => {
      expect(corpoNotify).toContain("'conversation', jsonb_build_object(");
      expect(corpoNotify).toContain("'id', conversation_id");
      expect(corpoNotify).toContain("'gptmaker_chat_id', gptmaker_chat_id");
    });

    it('mantém as escritas de rastro e o disparo assíncrono', () => {
      expect(corpoNotify).toContain('INSERT INTO public.webhook_events_out');
      expect(corpoNotify).toContain('INSERT INTO public.webhook_deliveries');
      expect(corpoNotify).toContain('net.http_post(');
    });
  });

  describe('notify_deal_stage_changed — as proteções', () => {
    it('busca a conversa por deal_id e só depois cai no fallback por contato', () => {
      const porDeal = corpoNotify.indexOf("mc.metadata->>'deal_id' = NEW.id::text");
      const fallback = corpoNotify.indexOf('mc.contact_id = NEW.contact_id');

      expect(porDeal).toBeGreaterThan(-1);
      expect(fallback).toBeGreaterThan(porDeal);
      // O fallback é condicional: só entra quando o vínculo explícito não achou.
      expect(corpoNotify).toContain('IF conversation_id IS NULL AND NEW.contact_id IS NOT NULL THEN');
      // Mais recente primeiro, com quem nunca falou no fim da fila.
      expect(corpoNotify).toContain('ORDER BY mc.last_message_at DESC NULLS LAST');
    });

    it('isola a busca da conversa num EXCEPTION próprio, antes do loop de endpoints', () => {
      const buscaConversa = corpoNotify.indexOf('FROM public.messaging_conversations mc');
      const loopEndpoints = corpoNotify.indexOf('FOR endpoint IN');

      // Se a busca vivesse dentro do loop, um erro dela seria contabilizado como
      // falha de entrega do webhook — o motivo errado no lugar errado.
      expect(buscaConversa).toBeGreaterThan(-1);
      expect(loopEndpoints).toBeGreaterThan(buscaConversa);

      // O bloco de exceção próprio zera as duas variáveis e deixa o webhook sair.
      expect(corpoNotify).toContain('conversation_id := NULL;');
      expect(corpoNotify).toContain('gptmaker_chat_id := NULL;');
    });

    it('filtra pelo estágio de destino usando pontua_lead, nunca conta_como_fila', () => {
      expect(corpoNotify).toContain('SELECT bs.pontua_lead INTO pontua_lead_destino');
      expect(corpoNotify).toContain('WHERE bs.id = NEW.stage_id');
      expect(corpoNotify).toContain('IF COALESCE(pontua_lead_destino, false) IS NOT TRUE THEN');
      expect(corpoNotify).not.toContain('conta_como_fila');
    });

    it('sai do filtro ANTES de escrever qualquer rastro', () => {
      const filtro = corpoNotify.indexOf('IF COALESCE(pontua_lead_destino, false) IS NOT TRUE THEN');
      const primeiraEscrita = corpoNotify.indexOf('INSERT INTO public.webhook_events_out');

      expect(filtro).toBeGreaterThan(-1);
      expect(primeiraEscrita).toBeGreaterThan(filtro);
    });

    it('repete o search_path vazio no CREATE OR REPLACE', () => {
      expect(corpoNotify).toContain("set search_path = ''");
    });
  });

  describe('enfileirar_pontuacao_do_lead — o desligamento reversível', () => {
    it('cria a coluna dedicada, e não reusa ai_enabled', () => {
      expect(sql).toContain(
        'add column if not exists pontuacao_automatica_habilitada boolean not null default true'
      );
      expect(corpoEnfileirar).not.toContain('ai_enabled');
    });

    it('retorna cedo quando a flag está desligada', () => {
      expect(corpoEnfileirar).toContain('select os.pontuacao_automatica_habilitada into v_habilitada');
      expect(corpoEnfileirar).toContain('if coalesce(v_habilitada, true) is not true then');

      // O early return vem ANTES do insert na fila e do disparo.
      const flag = corpoEnfileirar.indexOf('if coalesce(v_habilitada, true) is not true then');
      const insercao = corpoEnfileirar.indexOf('insert into public.ai_pending_lead_scores');

      expect(flag).toBeGreaterThan(-1);
      expect(insercao).toBeGreaterThan(flag);
    });

    it('preserva os early returns que já existiam', () => {
      expect(corpoEnfileirar).toContain('if new.deleted_at is not null then');
      expect(corpoEnfileirar).toContain('if new.pontuada_pela_ia_em is not null then');
      expect(corpoEnfileirar).toContain("if new.lead_score_source = 'manual' then");
      expect(corpoEnfileirar).toContain('select s.pontua_lead into v_pontua');
    });

    it('desliga por flag, nunca removendo os triggers', () => {
      expect(sql).not.toMatch(/drop\s+trigger/i);
      expect(sql).not.toMatch(/alter\s+table[^;]*disable\s+trigger/i);
    });

    it('desliga a organização por UPDATE explícito, não só pelo default', () => {
      expect(sql).toMatch(
        /update public\.organization_settings\s+set pontuacao_automatica_habilitada = false/
      );
    });

    it('repete o search_path public no CREATE OR REPLACE', () => {
      expect(corpoEnfileirar).toContain('set search_path = public');
    });

    it('explica no COMMENT ON COLUMN por que a coluna existe e como religar', () => {
      const comentario = sql.slice(
        sql.indexOf('comment on column public.organization_settings.pontuacao_automatica_habilitada'),
        sql.indexOf('-- 2. `enfileirar_pontuacao_do_lead()`')
      );

      expect(comentario).toContain('PARA RELIGAR');
      expect(comentario).toMatch(/cr[ée]dito do Google/);
    });
  });

  describe('nada de segredo versionado', () => {
    it('deixa o INSERT do endpoint como template comentado, com placeholders', () => {
      expect(sql).toContain('<URL DO WEBHOOK N8N>');
      expect(sql).toContain('<SECRET GERADO FORA DO REPOSITÓRIO>');
    });

    it('não executa nenhum insert em integration_outbound_endpoints', () => {
      const linhasExecutaveis = sql
        .split('\n')
        .filter((linha) => !linha.trimStart().startsWith('--'))
        .join('\n');

      expect(linhasExecutaveis).not.toMatch(/insert\s+into\s+public\.integration_outbound_endpoints/i);
    });
  });
});
