-- Story 2.34 — A coluna `Clientes` no board da Fernanda
--
-- Pedido dela em 12/08 (4o do mesmo dia):
--   "Tem muito cliente que entra em contato, ele vai ficar parado no lead. Entao acho que ja seria
--    bacana colocar ali, porque ai na hora que ele entrar em contato vai ficar la naquela coluna."
--
-- Decisao do Filipe: caminho A — criar a coluna. Registrada com o trade-off conhecido: a coluna
-- e MANUAL, nada poe o lead nela sozinho (mesma limitacao de `Profissional` e `Projeto Social`).
--
-- ==========================================================================================
-- 🛑 POR QUE `linked_lifecycle_stage` FICA **NULL** E NAO 'CUSTOMER'
-- ==========================================================================================
-- 'CUSTOMER' seria a escolha "obvia" — e quebraria duas coisas em silencio.
--
-- Medido antes: `boards.won_stage_id` E NULL neste board. Em `useMoveDeal.ts:70-81`, quando
-- `wonStageId` e nulo o codigo cai no FALLBACK por lifecycle:
--
--     board.wonStageId ? targetStageId === board.wonStageId
--                      : (board.linkedLifecycleStage !== 'CUSTOMER'
--                         && targetStage?.linkedLifecycleStage === 'CUSTOMER')
--
-- ⇒ mover um card para uma coluna 'CUSTOMER' marcaria **is_won = true**. Consequencias:
--
--   1. O card entraria na contagem de GANHO do dashboard (`useDashboardMetrics.ts:232`)
--      => o numero da apresentacao de sexta (14/08) passaria a contar cliente antigo como venda.
--
--   2. O card cairia no corte de 30 dias de `useBoardsController.ts:430-438`: card `is_won` com
--      `updated_at` mais velho que 30 dias some da tela **mesmo com o filtro em "Todos"**.
--      Seria a story 2.31 de novo, na coluna criada para resolver o problema oposto.
--
-- Custo aceito e registrado: com NULL, mover para `Clientes` **NAO** grava
-- `contacts.stage = CUSTOMER`. A coluna organiza a tela; ela nao ensina o sistema a saber quem e
-- cliente. Esse continua sendo o problema de fundo (4 de 813 contatos sao CUSTOMER hoje).
-- ==========================================================================================
--
-- POSICAO: `Clientes` entra em **10**, logo depois de `Perdido` (9), e empurra as outras duas
-- categorias para 11 e 12. Ordem escolhida pelo Filipe na propria tela, depois de a coluna nascer
-- em 12 — a reordenacao pela UI persistiu corretamente e foi lida de volta do banco.
--
-- As tres (`Clientes`, `Profissional`, `Projeto Social`) sao CATEGORIA do lead, nao etapa do funil
-- — por isso ficam agrupadas no fim, depois de Ganho/Perdido.
--
-- ⚠️ Os UPDATEs de `order` NAO sao decoracao: sem eles, num banco reconstruido do zero esta
-- migracao inseriria `Clientes` em 10 **colidindo com `Profissional`**, que a migracao anterior
-- (20260812170000) crava em 10. Duas colunas com o mesmo `order` = ordem indefinida na tela.
--
-- Idempotente: reexecutar nao duplica e nao move nada de lugar.

begin;

insert into public.board_stages (board_id, name, label, color, "order", is_default, linked_lifecycle_stage, organization_id)
select '5f6bded2-0f7c-418d-9598-7ea75d032242', 'Clientes', 'Clientes', 'bg-emerald-500', 10, false, null, '83160646-16a0-4cb7-9067-7ce7ef34ff50'
 where not exists (
   select 1 from public.board_stages
    where board_id = '5f6bded2-0f7c-418d-9598-7ea75d032242'
      and name = 'Clientes'
 );

-- Reordenacao das tres categorias, por UUID (nunca por nome — licao da 2.33, em que
-- `Em qualificação ` tinha espaco no fim e o casamento por nome teria falhado calado).
update public.board_stages set "order" = 10 where id = '3ed212e5-32a9-4bda-8d70-bb8be49e790d'; -- Clientes
update public.board_stages set "order" = 11 where id = '2da4a3f4-4333-4c79-a990-491e789d5096'; -- Profissional
update public.board_stages set "order" = 12 where id = '1b829bbd-b7de-42bd-beb2-6e0baaeb4d04'; -- Projeto Social

commit;
