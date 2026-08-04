-- Migration: contact_merge_log — ponteiros nullable (story 2.7 / item 3 da fila)
--
-- PROBLEMA
-- `contact_merge_log.source_contact_id` e `target_contact_id` eram `NOT NULL`, e as
-- FKs para `contacts` são `ON DELETE SET NULL`. As duas regras se contradizem:
-- quando alguém apaga um contato que já passou por merge, o Postgres tenta gravar
-- NULL numa coluna que não aceita NULL, e a transação inteira aborta com
--
--   null value in column "source_contact_id" of relation "contact_merge_log"
--   violates not-null constraint
--   CONTEXT: UPDATE ... SET "source_contact_id" = NULL
--
-- Efeito prático: **contato mergeado é indeletável**, e a mensagem de erro não diz
-- nada sobre a causa. Descoberto em 2026-08-03 tentando apagar dados de teste.
--
-- ⚖️ POR QUE ISTO É LGPD, NÃO SÓ UM ERRO FEIO
-- O direito ao apagamento (LGPD Art. 18, VI) deixa de ser atendível para qualquer
-- titular cujo contato já tenha sido fundido a outro. Não é hipótese — aconteceu.
--
-- DECISÃO (Filipe, 2026-08-04): opção B — as colunas viram NULLABLE.
--
-- As alternativas descartadas:
--   A) FK vira ON DELETE CASCADE ⇒ apagar o contato APAGA o registro do merge.
--      Trilha de auditoria que se apaga sozinha a pedido de terceiro deixa de ser
--      trilha de auditoria.
--   C) Igual a B, mas enriquecendo `source_snapshot` com nome/telefone. Não foi
--      necessário: `source_snapshot` já é JSONB NOT NULL e já guarda o conteúdo do
--      contato de origem.
--
-- O QUE MUDA NA PRÁTICA
-- O log sobrevive ao contato. O ponteiro fica NULL, mas `source_snapshot`,
-- `records_moved`, `merged_by` e `created_at` continuam contando o que aconteceu.
-- O log deixa de ser uma REFERÊNCIA para virar uma MEMÓRIA — que é o que uma
-- trilha de auditoria precisa ser quando o dado referenciado tem de poder sumir.

ALTER TABLE public.contact_merge_log
  ALTER COLUMN source_contact_id DROP NOT NULL;

ALTER TABLE public.contact_merge_log
  ALTER COLUMN target_contact_id DROP NOT NULL;

COMMENT ON COLUMN public.contact_merge_log.source_contact_id IS
  'Contato de origem do merge. NULLABLE de propósito: a FK é ON DELETE SET NULL, e o contato precisa poder ser apagado (LGPD Art. 18). Quando nulo, o conteúdo do contato está em source_snapshot.';

COMMENT ON COLUMN public.contact_merge_log.target_contact_id IS
  'Contato de destino do merge. NULLABLE pelo mesmo motivo de source_contact_id.';
