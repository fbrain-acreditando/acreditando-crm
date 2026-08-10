-- Migration: propagacao do nome do lead — story 2.20
--
-- PROBLEMA
-- O nome do lead vive em TRES colunas e nenhuma conversa com a outra:
--   contacts.name                                 (a fonte, decidida pelo Filipe em 10/08)
--   deals.title                                   (a frase "Nome - WhatsApp", nao um nome)
--   messaging_conversations.external_contact_name (pushName do WhatsApp)
--
-- Todas as tres sao gravadas na CRIACAO e nunca mais. `find_or_create_contact`
-- (20260804120000) so cria — nunca atualiza. Resultado medido em 2026-08-10:
--   * 106 de 768 contatos (13,9%) com nome inutilizavel (40 vazios, 28 com "@lid",
--     13 so telefone, 23 com 1-2 caracteres);
--   * 34 conversas sem nome nenhum;
--   * e o caso Leandro/Rondonia, editado a mao em 10/08 11:11 — o WhatsApp mandou a
--     REGIAO como pushName, alguem foi corrigir e so conseguiu mexer no titulo do card,
--     porque e o unico campo editavel a partir do board. O lead ficou com dois nomes.
--
-- POR QUE TRIGGER, E NAO UMA RPC OU O HOOK DO CLIENTE
-- Existe mais de um caminho de escrita em `contacts`: o app, `lib/mcp/tools/
-- contacts-advanced.ts` e a API publica. Regra no `useUpdateContact` fecharia um so.
-- O repo ja usa trigger para invariante entre tabelas (`cascade_contact_delete`).
-- E o AC4 precisa do nome ANTIGO para reconhecer o titulo automatico: num trigger,
-- OLD.name esta disponivel sem leitura previa e sem janela de corrida.
--
-- REGRA DO TITULO (AC4, decisao do Filipe em 10/08)
-- So troca o titulo do card se ele ainda for EXATAMENTE um dos dois formatos
-- automaticos, montados com o nome ANTIGO. Se alguem escreveu outra coisa ali,
-- o texto e PRESERVADO. Comparacao por igualdade exata — nada de heuristica de
-- "contem o nome", que apagaria anotacao de gente.
--   "{nome} - WhatsApp"  → messaging-webhook-gptmaker/index.ts:867 e evolution:880
--   "Deal - {nome}"      → features/contacts/hooks/useContactsController.ts:540
--
-- external_contact_name (AC3)
-- Passa a ser CACHE DE BUSCA, nao fonte. A exibicao deriva de contacts.name
-- (ConversationItem/ContactPanel). O cache existe porque o PostgREST nao faz OR
-- entre coluna da tabela base e coluna de tabela embutida numa expressao so, e a
-- busca de conversas filtra `external_contact_name.ilike` em DOIS hooks
-- (useConversationsQuery:128 e useMessagingConversationsQuery:100).

CREATE OR REPLACE FUNCTION public.propagate_contact_name_change()
RETURNS trigger
LANGUAGE plpgsql
-- DEFINER para que a propagacao nao dependa de o papel do usuario ter UPDATE em
-- deals/messaging_conversations. O alcance e estreito: so linhas do proprio contato.
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Nada mudou no nome: sai sem tocar em nada.
  IF NEW.name IS NOT DISTINCT FROM OLD.name THEN
    RETURN NEW;
  END IF;

  -- `deals.title` e NOT NULL e o titulo automatico e montado a partir do nome.
  -- Renomear para vazio produziria o card " - WhatsApp". Barra na origem.
  IF coalesce(trim(NEW.name), '') = '' THEN
    RAISE EXCEPTION 'O nome do lead nao pode ficar vazio.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- AC4 — formato 1: "{nome} - WhatsApp"
  UPDATE public.deals
     SET title = NEW.name || ' - WhatsApp'
   WHERE contact_id = NEW.id
     AND title = OLD.name || ' - WhatsApp';

  -- AC4 — formato 2: "Deal - {nome}"
  UPDATE public.deals
     SET title = 'Deal - ' || NEW.name
   WHERE contact_id = NEW.id
     AND title = 'Deal - ' || OLD.name;

  -- AC3 — cache de busca da conversa acompanha sempre.
  UPDATE public.messaging_conversations
     SET external_contact_name = NEW.name
   WHERE contact_id = NEW.id;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.propagate_contact_name_change() IS
  'Story 2.20 — propaga contacts.name para deals.title (so quando o titulo ainda e automatico) e para messaging_conversations.external_contact_name (cache de busca). contacts.name e a fonte unica do nome do lead.';

DROP TRIGGER IF EXISTS trg_propagate_contact_name ON public.contacts;

-- AFTER UPDATE OF name: so dispara quando a coluna do nome entra no UPDATE, entao
-- edicao de telefone/e-mail/notas nao paga o custo.
CREATE TRIGGER trg_propagate_contact_name
AFTER UPDATE OF name ON public.contacts
FOR EACH ROW
EXECUTE FUNCTION public.propagate_contact_name_change();

-- ⚠️ NAO REMOVER — armadilha ja vivida na story 2.6, e aqui numa funcao SECURITY DEFINER.
-- O Supabase concede EXECUTE a `anon` e `authenticated` em funcoes novas de `public`
-- via ALTER DEFAULT PRIVILEGES. Sao grants EXPLICITOS a esses papeis, nao o pseudo-papel
-- PUBLIC — entao o REVOKE do PUBLIC passa por eles sem tocar. Confirmado no read-back
-- desta propria migration: a funcao nasceu com `anon=X` e `authenticated=X`.
-- Precisa revogar papel por papel.
REVOKE ALL ON FUNCTION public.propagate_contact_name_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.propagate_contact_name_change() FROM anon;
REVOKE ALL ON FUNCTION public.propagate_contact_name_change() FROM authenticated;
