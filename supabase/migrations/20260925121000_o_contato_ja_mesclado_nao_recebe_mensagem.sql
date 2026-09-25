-- Story 2.56 — T4 / AC2: `find_or_create_contact` para de escolher contato MORTO.
--
-- ============================================================================
-- O QUE MUDA (uma linha de predicado)
-- ============================================================================
-- A versão da story 2.6 (`20260804120000_find_or_create_contact_locked.sql:78-84`)
-- busca o contato por telefone assim:
--
--     WHERE organization_id = ... AND phone = ... AND deleted_at IS NULL
--     ORDER BY created_at LIMIT 1
--
-- Ela pega o MAIS ANTIGO e **não filtra `merged_into_id`**. Se o mais antigo já
-- foi mesclado para dentro de outro, o webhook passa a escrever num registro que
-- a interface considera extinto: a mensagem chega, mas na ficha errada — e some
-- da vista de quem atende.
--
-- Na 2.6 isso foi deixado de fora DE PROPÓSITO e registrado como divergência
-- conhecida (o comentário está lá). A story 2.56 traz de volta porque o AC2
-- passa a REUSAR contato por telefone com muito mais frequência (é o efeito do
-- mapa de alias), e reusar um contato morto é escrever no lugar errado.
--
-- ============================================================================
-- MEDIÇÃO ANTES DE MEXER (produção, 25/09/2026, via `scripts/db/sql-ro.mjs`)
-- ============================================================================
--   • contatos com `merged_into_id` preenchido: 6 de 1.812;
--   • grupos (organization_id, phone) com mais de um contato vivo: 5;
--   • contatos que são o MAIS ANTIGO do seu telefone E estão mesclados: **0**.
--
-- ⚠️ Leia o "0" pelo que ele é: HOJE nenhum caso está errado. Não é prova de que
-- não vai acontecer — é a razão de a mudança ser segura de aplicar agora, sem
-- mudar o destino de nenhuma mensagem já existente.
--
-- ============================================================================
-- E SE TODOS OS CONTATOS DAQUELE TELEFONE ESTIVEREM MESCLADOS?
-- ============================================================================
-- O `SELECT` não acha ninguém e a função **cria um contato novo** — que é o
-- comportamento correto e o mesmo de quando não existe contato nenhum. Não
-- seguimos a cadeia `merged_into_id` até o sobrevivente de propósito: cadeia
-- pode ter ciclo, pode apontar para contato de outra organização e pode apontar
-- para alguém já excluído. Criar um contato a mais é aborrecimento; escrever na
-- ficha errada some com a conversa. Na dúvida, NÃO casar (lição da story 2.53).

create or replace function public.find_or_create_contact(
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

  -- 🔻 A ÚNICA mudança da story 2.56: `merged_into_id IS NULL`.
  -- Contato mesclado é registro morto — a interface já não o mostra. Escrever
  -- nele faz a mensagem sumir da vista sem nenhum erro aparecer.
  SELECT id INTO v_id
    FROM public.contacts
   WHERE organization_id = p_organization_id
     AND phone = p_phone
     AND deleted_at IS NULL
     AND merged_into_id IS NULL
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
  'Resolve o contato por (organization_id, phone) sob advisory lock, criando se não existir. '
  'Ignora contato já mesclado (merged_into_id IS NOT NULL) — story 2.56, AC2/T4. '
  'Fecha a corrida entre entregas concorrentes de webhook sem proibir contato duplicado '
  'no resto do sistema (story 2.6).';

-- ⚠️ `CREATE OR REPLACE` mantém os grants existentes, mas repetimos o bloco da
-- 2.6 porque a migration precisa ser correta se aplicada num banco limpo — e
-- porque o Supabase concede EXECUTE a `anon`/`authenticated` por ALTER DEFAULT
-- PRIVILEGES em função NOVA, e `REVOKE FROM PUBLIC` passa por esses grants sem
-- tocá-los (descoberto no read-back da story 2.6).
REVOKE ALL ON FUNCTION public.find_or_create_contact(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.find_or_create_contact(uuid, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.find_or_create_contact(uuid, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.find_or_create_contact(uuid, text, text, text) TO service_role;
