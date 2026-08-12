-- Story 2.19 — a origem da conversa vira dado consultável.
--
-- O painel da Fernanda precisa separar:
--   • lead que CHEGOU     → a primeira mensagem da conversa é `inbound`
--   • lead que ELA ABORDOU → a primeira mensagem é `outbound`
--
-- Por que esta é a definição certa (medida em 12/08, não escolhida):
--   um card do CRM nasce quando o lead inicia a conversa, então "quantos
--   chegaram" contado por deal daria 100% e não separaria nada. A direção da
--   PRIMEIRA mensagem separa — e o número se validou contra a contagem manual
--   dela: ela anotou 116 conversas iniciadas por ela em julho; esta definição
--   devolve 118.
--
-- ⚠️ E é o único caminho para julho: a story 2.24 apagou FISICAMENTE os 431
-- deals de julho, mas preservou conversas e mensagens por escopo. Julho existe
-- aqui e não existe no board.

create or replace view public.v_origem_da_conversa
with (security_invoker = true) as
select distinct on (m.conversation_id)
  m.conversation_id,
  -- `organization_id` vem da CONVERSA: `messaging_messages` não tem essa coluna.
  c.organization_id,
  c.contact_id,
  m.created_at                                   as iniciada_em,
  case m.direction when 'inbound' then 'lead' else 'equipe' end as quem_iniciou
from public.messaging_messages m
join public.messaging_conversations c on c.id = m.conversation_id
order by m.conversation_id, m.created_at asc;

comment on view public.v_origem_da_conversa is
  'Story 2.19 — quem iniciou cada conversa, pela direção da primeira mensagem. '
  '`security_invoker` para a view herdar a RLS de quem consulta, em vez de virar '
  'um furo que devolve conversa de outra organização.';

-- O `distinct on` varre por (conversation_id, created_at): sem este índice ele
-- ordena a tabela inteira de mensagens a cada consulta do painel.
create index if not exists idx_messaging_messages_conversa_criada
  on public.messaging_messages (conversation_id, created_at);
