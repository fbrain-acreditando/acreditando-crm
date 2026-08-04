-- Migration: find_or_create_contact — fecha a corrida na criação de contato (story 2.6)
--
-- PROBLEMA
-- O GPT Maker dispara `onNewMessage` e `onFirstInteraction` quase juntos para um
-- contato novo. As duas entregas do webhook chegam concorrentes, nenhuma acha o
-- contato pelo telefone, e AS DUAS inserem.
--
-- O tratamento de corrida já existia na edge function (index.ts:799-816), mas era
-- LETRA MORTA: ele depende de `23505 unique_violation`, e `contacts` não tem
-- nenhuma constraint de unicidade além da PK. Sem constraint, o insert concorrente
-- não falha — ninguém perde a corrida, e nascem dois contatos.
--
-- Medido em produção em 2026-08-04: 138 grupos (organization_id, phone) duplicados,
-- 276 contatos envolvidos, TODOS com diferença de criação abaixo de 0,5 s
-- (menor: 0,000171 s · maior: 0,457609 s). Ritmo de ~12/dia desde 25/07.
--
-- POR QUE NÃO UM ÍNDICE ÚNICO
-- Um `UNIQUE INDEX (organization_id, phone)` seria a correção mínima e faria o
-- tratamento já escrito funcionar sozinho. Duas razões o descartaram AGORA:
--   1. Ele proíbe contato duplicado no banco inteiro — decisão de produto que
--      contradiz a feature de dedup + merge (20260208200000), que existe
--      justamente porque duplicata é tratada como estado possível;
--   2. `CREATE UNIQUE INDEX` ABORTA com as 138 duplicatas que já existem, e
--      limpá-las esbarra no `contact_merge_log`, que hoje impede excluir contato
--      (NOT NULL + FK ON DELETE SET NULL se contradizem).
-- Decisão do Filipe em 2026-08-04: **advisory lock** (esta migration).
--
-- COMO FUNCIONA
-- `pg_advisory_xact_lock` serializa apenas as chamadas que disputam o MESMO
-- (organization_id, phone). A segunda entrega espera a primeira terminar, encontra
-- o contato já criado e o reusa. O lock é liberado no fim da transação da própria
-- função — ou seja, depois do INSERT ter commitado, que é o que torna a leitura da
-- segunda chamada confiável.
--
-- Duplicata segue PERMITIDA no resto do sistema: cadastro manual, importação e a
-- feature de merge continuam funcionando exatamente como hoje.

CREATE OR REPLACE FUNCTION public.find_or_create_contact(
  p_organization_id uuid,
  p_phone text,
  p_name text,
  p_source text DEFAULT 'whatsapp'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'find_or_create_contact: organization_id é obrigatório';
  END IF;

  -- Sem telefone não há chave por onde serializar — e travar por nome ou por
  -- organização inteira serializaria leads que não têm nada a ver um com o outro.
  -- Preserva o comportamento de hoje: cria direto.
  IF p_phone IS NULL OR p_phone = '' THEN
    INSERT INTO public.contacts (organization_id, name, phone, source)
    VALUES (p_organization_id, p_name, NULL, p_source)
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  -- A partir daqui, qualquer outra transação com o mesmo (org, phone) espera.
  PERFORM pg_advisory_xact_lock(
    hashtext(p_organization_id::text),
    hashtext(p_phone)
  );

  -- ⚠️ O predicado é IDÊNTICO ao que a edge function usava antes (só
  -- `deleted_at IS NULL`, ordenado por `created_at`, limit 1). Ele NÃO filtra
  -- `merged_into_id IS NULL` — de propósito: mudar isso faria um contato já
  -- mergeado deixar de ser reusado e passar a ser recriado, que é outro
  -- comportamento e outra story. Divergência conhecida em relação ao predicado
  -- do índice `idx_contacts_phone_dedup`, registrada na story 2.6.
  SELECT id INTO v_id
    FROM public.contacts
   WHERE organization_id = p_organization_id
     AND phone = p_phone
     AND deleted_at IS NULL
   ORDER BY created_at
   LIMIT 1;

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO public.contacts (organization_id, name, phone, source)
  VALUES (p_organization_id, p_name, p_phone, p_source)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.find_or_create_contact(uuid, text, text, text) IS
  'Resolve o contato por (organization_id, phone) sob advisory lock, criando se não existir. Fecha a corrida entre entregas concorrentes de webhook sem proibir contato duplicado no resto do sistema. Story 2.6.';

-- Blast radius mínimo: só o service role (usado pelas edge functions de webhook)
-- executa. Usuário autenticado não ganha um caminho novo de criar contato.
--
-- ⚠️ `REVOKE ... FROM PUBLIC` NÃO basta neste projeto. O Supabase concede EXECUTE
-- em funções novas de `public` para `anon` e `authenticated` via ALTER DEFAULT
-- PRIVILEGES — são grants EXPLÍCITOS a esses papéis, não o pseudo-papel PUBLIC,
-- e o revoke do PUBLIC passa por eles sem tocá-los. Descoberto no read-back da
-- própria aplicação desta migration (story 2.6): a função nasceu executável por
-- `anon`. Precisa revogar papel por papel.
REVOKE ALL ON FUNCTION public.find_or_create_contact(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.find_or_create_contact(uuid, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.find_or_create_contact(uuid, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.find_or_create_contact(uuid, text, text, text) TO service_role;
