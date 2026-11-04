-- =============================================================================
-- Story 2.69 — Fechar para quem não tem login as funções do banco que só o
-- sistema ou usuários logados deveriam executar
-- =============================================================================
--
-- Achado do @qa no re-gate da 2.67 (03/11): em produção,
-- has_function_privilege('anon', 'cleanup_rate_limits(integer)', 'EXECUTE') = true.
-- Qualquer pessoa com a chave pública do site (que não é segredo) chamava
-- POST /rest/v1/rpc/cleanup_rate_limits {"older_than_minutes":0} e apagava a
-- tabela rate_limits inteira, sem login. O T0 (04/11) achou 22 funções assim.
--
-- POR QUE A CORREÇÃO DE 23/02 (20260223000001_fix_rpc_anon_access.sql) NÃO VALEU
--   Ela fez `REVOKE ALL … FROM PUBLIC` e `GRANT … TO service_role`. Mas o
--   Supabase tem privilégios padrão no schema public (pg_default_acl do dono
--   postgres) que dão EXECUTE PELO NOME a anon, authenticated e service_role,
--   além do PUBLIC. Tirar o PUBLIC não tira a permissão nominal do anon, e o
--   GRANT só soma, não restringe. A migration rodou; só não fazia o que o
--   comentário dela dizia. A regra certa (a mesma do passo 5 da 2.67): revogar
--   PELO NOME — `FROM PUBLIC, anon` — e, nas funções que só o sistema usa,
--   também `authenticated`.
--
-- POR QUE A get_user_org_id() (linha 22) ESTAVA ABERTA
--   A 20260224000000 tem `REVOKE ALL … FROM PUBLIC, anon` para ela, mas essa
--   migration NUNCA RODOU em produção: nenhum dos 11 índices que ela cria existe
--   (medido pelo @po em 04/11; o banco não guarda histórico de migrations). Quem
--   criou a função em produção foi a 20260403000000:67, do zero, com o padrão
--   aberto (PUBLIC e anon). Aqui o REVOKE/GRANT é repetido.
--
-- POR QUE O PADRÃO DO BANCO PRECISA FECHAR O PUBLIC TAMBÉM (bloco D4, no fim)
--   O privilégio padrão POR SCHEMA é SOMADO ao padrão GERAL. Não existe linha
--   geral (defaclnamespace = 0) em produção, então vale o embutido do Postgres:
--   EXECUTE para PUBLIC. Tirar só o anon do padrão do schema deixaria a função
--   nova aberta pelo PUBLIC (o mesmo engano de 23/02, ao contrário). Por isso
--   são duas linhas de REVOKE: uma por porta. O padrão só vale para funções
--   criadas PELO PAPEL postgres; a proteção real continua sendo o teste
--   lib/supabase/funcoesSemExecucaoAnonima.test.ts (AC4).
--
-- O QUE ESTA MIGRATION FAZ (e só isso)
--   • REVOKE/GRANT com a assinatura exata de produção (T0, regprocedure);
--   • o bloco D4 de ALTER DEFAULT PRIVILEGES (se o ensaio T4 der
--     "permission denied" nele, o bloco SAI daqui e a story registra);
--   • NOTIFY pgrst no fim.
--   Nenhum CREATE OR REPLACE, nenhum DROP, nenhum corpo de função mudado.
--
-- FICAM DE FORA DE PROPÓSITO
--   • validate_api_key(text) e is_instance_initialized(): uso legítimo sem
--     login (API pública e tela de instalação) — continuam com anon;
--   • resgatar_itens_presos(integer,integer): o cron stage-evaluations a chama
--     como anon (~288×/dia). Vai para a story 2.70, junto com a troca do cliente;
--   • funções de gatilho: não são chamáveis por /rpc.
--
-- 🔁 Idempotente: REVOKE/GRANT repetidos dão o mesmo resultado, sem erro.
-- ⛔ Sem IF EXISTS: uma assinatura que não existir derruba o arquivo inteiro.
-- ⛔ Sem BEGIN/COMMIT: o texto roda numa transação só (T0, A10; o T4 (b)
--    confirma pelo caminho do scripts/db/aplicar-migracao.mjs).
--
-- Rollback (NÃO aplicar sem o Filipe): `GRANT EXECUTE ON FUNCTION <sig> TO anon`
-- (e `authenticated` nas linhas 1–7) por função; para o D4, os ALTER DEFAULT
-- PRIVILEGES … GRANT correspondentes (incluindo `GRANT … TO PUBLIC` sem schema).
-- =============================================================================

-- 1. Só o sistema (service_role). Linhas 1–7 do D2.
--    O dono (postgres) executa sempre: os jobs do pg_cron das linhas 3 e 4
--    rodam como postgres, que é o dono delas (T0, A4).
REVOKE ALL ON FUNCTION public.cleanup_rate_limits(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_message_status_if_newer(text, text, timestamp with time zone, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_old_pending_advances() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trigger_hitl_alerts() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recalcular_lead_scores_de_todas_as_orgs() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._api_key_make_token() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._api_key_sha256_hex(text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.cleanup_rate_limits(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_message_status_if_newer(text, text, timestamp with time zone, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_old_pending_advances() TO service_role;
GRANT EXECUTE ON FUNCTION public.trigger_hitl_alerts() TO service_role;
GRANT EXECUTE ON FUNCTION public.recalcular_lead_scores_de_todas_as_orgs() TO service_role;
GRANT EXECUTE ON FUNCTION public._api_key_make_token() TO service_role;
GRANT EXECUTE ON FUNCTION public._api_key_sha256_hex(text) TO service_role;

-- 2. Usuário logado (authenticated). Linhas 8–21 do D2.
REVOKE ALL ON FUNCTION public.mark_deal_won(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_deal_lost(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reopen_deal(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.log_audit_event(text, text, uuid, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_conversation_read(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_api_key(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_api_key(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.merge_contacts(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.recalcular_lead_scores(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_fila_de_atendimento(uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_lista_da_fila(uuid, integer, boolean, boolean, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_messaging_metrics(uuid, timestamp with time zone, timestamp with time zone, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_metricas_de_atendimento(uuid, timestamp with time zone, timestamp with time zone) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_messaging_unread_count() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.mark_deal_won(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_deal_lost(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_deal(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_audit_event(text, text, uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_api_key(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_api_key(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.merge_contacts(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recalcular_lead_scores(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_fila_de_atendimento(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_lista_da_fila(uuid, integer, boolean, boolean, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_messaging_metrics(uuid, timestamp with time zone, timestamp with time zone, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_metricas_de_atendimento(uuid, timestamp with time zone, timestamp with time zone) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_messaging_unread_count() TO authenticated;

-- 3. Linha 22 — usada só dentro das 2 políticas de RLS de board_ai_config.
REVOKE ALL ON FUNCTION public.get_user_org_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_org_id() TO authenticated, service_role;

-- 4. D4 — padrão do banco para funções NOVAS criadas pelo papel postgres.
--    1ª linha: tira o anon nominal do padrão do schema public.
--    2ª linha: cria a linha geral (sem IN SCHEMA) que hoje não existe e tira o PUBLIC.
--    3ª linha: redundante hoje, deixa escrito "função nova nasce para logado e sistema".
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
