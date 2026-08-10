-- Migration: RPC `rename_lead` — story 2.20 (AC5)
--
-- POR QUE ELA EXISTE, JA HAVENDO O TRIGGER
-- O trigger `trg_propagate_contact_name` (20260810150000) garante a propagacao em
-- QUALQUER caminho de escrita — app, MCP tools, API publica, importacao. Ele e a
-- rede de seguranca e continua sendo a regra.
--
-- O que ele NAO consegue e devolver ao cliente o que aconteceu. E o AC5 exige
-- exatamente isso: "a tela informa o que aconteceu — ex.: 2 cards renomeados,
-- 1 card manteve o titulo personalizado". Card que muda (ou que deixa de mudar)
-- sem a tela dizer e a familia de defeito que esta epic vem catalogando.
--
-- Entao: a UI chama esta RPC e recebe os numeros; o trigger faz a propagacao.
-- Cada um resolve um problema diferente, e nenhum depende do outro estar certo.
--
-- SECURITY INVOKER de proposito: a RLS do usuario decide se ele pode renomear
-- aquele contato. A propagacao para deals/conversas e que roda como owner, dentro
-- do trigger — separacao deliberada entre "posso renomear?" e "a propagacao nao
-- pode falhar por permissao".

CREATE OR REPLACE FUNCTION public.rename_lead(
  p_contact_id uuid,
  p_new_name   text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old          text;
  v_novo         text := trim(p_new_name);
  v_renomeados   int;
  v_preservados  int;
  v_conversas    int;
BEGIN
  SELECT name INTO v_old FROM public.contacts WHERE id = p_contact_id;
  IF v_old IS NULL THEN
    RAISE EXCEPTION 'Lead nao encontrado (ou sem permissao para ve-lo).';
  END IF;

  IF coalesce(v_novo, '') = '' THEN
    RAISE EXCEPTION 'O nome do lead nao pode ficar vazio.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_novo = v_old THEN
    RETURN jsonb_build_object(
      'mudou', false, 'nome_antigo', v_old, 'nome_novo', v_novo,
      'cards_renomeados', 0, 'cards_preservados', 0, 'conversas_atualizadas', 0
    );
  END IF;

  -- Contado ANTES da escrita, com o nome ANTIGO — que e o que define se o titulo
  -- ainda e automatico. Sem filtro de deleted_at: o trigger tambem nao filtra, e os
  -- dois numeros TEM de descrever a mesma coisa, senao a tela mente.
  SELECT
    count(*) FILTER (WHERE title = v_old || ' - WhatsApp' OR title = 'Deal - ' || v_old),
    count(*) FILTER (WHERE title <> v_old || ' - WhatsApp' AND title <> 'Deal - ' || v_old)
  INTO v_renomeados, v_preservados
  FROM public.deals
  WHERE contact_id = p_contact_id;

  SELECT count(*) INTO v_conversas
    FROM public.messaging_conversations
   WHERE contact_id = p_contact_id;

  -- Esta escrita dispara o trigger, que faz a propagacao de verdade.
  UPDATE public.contacts
     SET name = v_novo, updated_at = now()
   WHERE id = p_contact_id;

  RETURN jsonb_build_object(
    'mudou', true,
    'nome_antigo', v_old,
    'nome_novo', v_novo,
    'cards_renomeados', v_renomeados,
    'cards_preservados', v_preservados,
    'conversas_atualizadas', v_conversas
  );
END;
$$;

COMMENT ON FUNCTION public.rename_lead(uuid, text) IS
  'Story 2.20 — renomeia o lead e devolve o que aconteceu (cards renomeados x preservados, conversas atualizadas). A propagacao em si e do trigger trg_propagate_contact_name; esta funcao existe para a tela poder dizer ao usuario o que mudou (AC5).';

-- Mesma armadilha da story 2.6: o Supabase concede EXECUTE a anon/authenticated via
-- ALTER DEFAULT PRIVILEGES, e o REVOKE do PUBLIC nao toca nesses grants explicitos.
-- Aqui `authenticated` PRECISA executar (e a UI logada que chama), mas `anon` NAO.
REVOKE ALL ON FUNCTION public.rename_lead(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rename_lead(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.rename_lead(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rename_lead(uuid, text) TO service_role;
