-- Story 2.63 — T3 / AC4: o contato é achado com e sem o 9º dígito.
--
-- ============================================================================
-- O QUE ESTA MIGRATION FAZ (e o que ela NÃO faz)
-- ============================================================================
-- Cria uma função NOVA, `find_or_create_contact_por_variantes`, com os mesmos
-- parâmetros da antiga. A antiga, `find_or_create_contact(uuid, text, text, text)`
-- (`20260925121000_o_contato_ja_mesclado_nao_recebe_mensagem.sql`), fica
-- INTACTA, com os mesmos grants: é ela que a Edge Function v15 chama, e o
-- rollback da 2.63 é republicar a v15 (AC8). Nada aqui precisa ser desfeito
-- para o rollback; se for preciso, basta:
--
--     DROP FUNCTION IF EXISTS public.find_or_create_contact_por_variantes(uuid, text, text, text);
--
-- Nome novo (e não sobrecarga): o PostgREST resolve RPC pelos NOMES dos
-- argumentos; duas funções com o mesmo nome e os mesmos argumentos nomeados
-- seriam ambíguas.
--
-- ============================================================================
-- A REGRA (a mesma de `lib/meta-form/telefone.ts` e de `nono-digito.ts`)
-- ============================================================================
--   • `+55 DD 9XXXXXXXX`, dígito após o 9 entre 6–9   ⇒ também `+55 DD XXXXXXXX`
--     (`9` + 2–5 ⇒ só a própria forma — QA-1)
--   • `+55 DD XXXXXXXX`, assinante começando com 6–9   ⇒ também `+55 DD 9XXXXXXXX`
--   • fixo (assinante 2–5) e estrangeiro               ⇒ só a própria forma
--
-- A ordem da busca: telefone EXATO primeiro; só se não houver, a VARIANTE. O
-- mais antigo vence dentro de cada etapa. Mesmos filtros da antiga
-- (`deleted_at IS NULL`, `merged_into_id IS NULL`). Só cria se nenhuma forma
-- existir — e cria com o telefone COMO VEIO. O telefone de contato existente
-- NUNCA é alterado.
--
-- A trava passa a ser pela forma CANÔNICA (com o 9): duas entregas com formas
-- diferentes do mesmo número também se serializam.
--
-- ⚠️ A busca compara texto `+<dígitos>`. Contato gravado com máscara ou sem o
-- `+` não casa pela variante (R3 do @po — a foto do AC9.3 confere o formato).
--
-- Idempotente: `CREATE OR REPLACE` + REVOKE/GRANT repetíveis.

create or replace function public.find_or_create_contact_por_variantes(
  p_organization_id uuid,
  p_phone text,
  p_name text,
  p_source text DEFAULT 'whatsapp'
)
RETURNS TABLE (contact_id uuid, casou_por text, telefone_casado text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_canonico text;
  v_variante text;
  v_m text[];
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'find_or_create_contact_por_variantes: organization_id é obrigatório';
  END IF;

  -- Sem telefone: igual à antiga — cria direto, sem trava.
  IF p_phone IS NULL OR p_phone = '' THEN
    INSERT INTO public.contacts (organization_id, name, phone, source)
    VALUES (p_organization_id, p_name, NULL, p_source)
    RETURNING id INTO v_id;
    RETURN QUERY SELECT v_id, 'criado'::text, NULL::text;
    RETURN;
  END IF;

  -- Formas do número.
  v_canonico := p_phone;
  v_variante := NULL;

  -- QA-1 (03/11): só tira o 9 quando ele vem seguido de 6–9 (91…–95… nunca
  -- existiram com 8 dígitos; sem o 9 virariam número com cara de fixo).
  v_m := regexp_match(p_phone, '^\+55(\d{2})9([6-9]\d{7})$');
  IF v_m IS NOT NULL THEN
    v_variante := '+55' || v_m[1] || v_m[2];                 -- sem o 9
  ELSE
    v_m := regexp_match(p_phone, '^\+55(\d{2})([6-9]\d{7})$');
    IF v_m IS NOT NULL THEN
      v_canonico := '+55' || v_m[1] || '9' || v_m[2];        -- com o 9
      v_variante := v_canonico;
    END IF;
  END IF;

  -- Trava pela forma canônica: `+55DD9…` e `+55DD…` esperam um pelo outro.
  PERFORM pg_advisory_xact_lock(
    hashtext(p_organization_id::text),
    hashtext(v_canonico)
  );

  -- 1) Exato.
  SELECT c.id INTO v_id
    FROM public.contacts c
   WHERE c.organization_id = p_organization_id
     AND c.phone = p_phone
     AND c.deleted_at IS NULL
     AND c.merged_into_id IS NULL
   ORDER BY c.created_at
   LIMIT 1;

  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT v_id, 'exato'::text, p_phone;
    RETURN;
  END IF;

  -- 2) Variante (só celular BR).
  IF v_variante IS NOT NULL THEN
    SELECT c.id INTO v_id
      FROM public.contacts c
     WHERE c.organization_id = p_organization_id
       AND c.phone = v_variante
       AND c.deleted_at IS NULL
       AND c.merged_into_id IS NULL
     ORDER BY c.created_at
     LIMIT 1;

    IF v_id IS NOT NULL THEN
      RETURN QUERY SELECT v_id, 'variante'::text, v_variante;
      RETURN;
    END IF;
  END IF;

  -- 3) Nenhuma forma existe: cria com o telefone como veio.
  INSERT INTO public.contacts (organization_id, name, phone, source)
  VALUES (p_organization_id, p_name, p_phone, p_source)
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, 'criado'::text, p_phone;
END;
$$;

COMMENT ON FUNCTION public.find_or_create_contact_por_variantes(uuid, text, text, text) IS
  'Story 2.63: resolve o contato por telefone exato e, se não houver, pela outra forma '
  '(com/sem o 9º dígito, só celular BR), sob advisory lock pela forma canônica; cria com o '
  'telefone como veio se nenhuma forma existir. Ignora contato excluído ou mesclado. '
  'A find_or_create_contact antiga continua intacta (rollback da Edge Function v15).';

-- Mesmo bloco de grants da antiga (`20260925121000…sql:112-115`): o Supabase
-- concede EXECUTE a anon/authenticated em função NOVA por default privileges, e
-- `REVOKE FROM PUBLIC` não toca esses grants.
REVOKE ALL ON FUNCTION public.find_or_create_contact_por_variantes(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.find_or_create_contact_por_variantes(uuid, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.find_or_create_contact_por_variantes(uuid, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.find_or_create_contact_por_variantes(uuid, text, text, text) TO service_role;
