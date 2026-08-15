-- Story 2.40 — arquivar em `Clientes` não pode APAGAR a venda.
--
-- ============================================================================
-- O DEFEITO, E ELE JÁ MORDEU — medido em 14/08, não suposto
-- ============================================================================
-- `useMoveDeal` tem um ramo "reopen if was closed": mover um card fechado para
-- uma coluna comum zera `is_won`/`is_lost` e anula `closed_at`. A intenção é
-- legítima — arrastar um card de volta para o funil É reabrir.
--
-- 🛑 Só que TRÊS das treze colunas deste board não são etapa de funil, são
-- CATEGORIA: `Clientes`, `Profissional` e `Projeto Social` (story 2.33 e 2.34).
-- Arquivar uma venda ganha em `Clientes` não é reabrir a negociação — é dizer
-- "esta pessoa agora é cliente". E o sistema apagava a venda.
--
-- MEDIDO — 4 cards já perderam a marca, todos no mesmo lote:
--   contato            marcado Ganho      arquivado
--   (sem nome)         11/08 10:43        13/08 11:53:30
--   Paulo              11/08 16:19        13/08 11:53:36
--   Fillipe (profis.)  11/08 16:26        13/08 11:53:59
--   Edir               12/08 09:47        13/08 11:53:33
-- Os quatro estão hoje com `is_won = false` e `closed_at = null`.
-- ⚠️ Se essas quatro eram vendas de agosto ou clientes antigos que passaram por
-- `Ganho` de passagem, quem sabe é a Fernanda — a story NÃO afirma isso. O que
-- está provado é o MECANISMO. (Precedente de 13/08: eu afirmei que o número
-- dela estava errado e ela me corrigiu, com a tela aberta na frente.)
--
-- ============================================================================
-- POR QUE UMA COLUNA NOVA, E NÃO INFERIR
-- ============================================================================
-- Inferir por `linked_lifecycle_stage is null` NÃO serve: `Lead novo` também é
-- null e ali reabrir é o comportamento CERTO.
-- Casar por NOME é proibido neste repo, com cicatriz: `Em qualificação ` tem
-- espaço no fim e a story 2.33 quase apagou a coluna errada por isso.
-- ⇒ o sinal é explícito e vive no banco, igual a `board_stages.pontua_lead`
-- (story 2.35): "qual estágio faz o quê vem da coluna, não do nome".

alter table public.board_stages
  add column if not exists arquiva_sem_reabrir boolean not null default false;

comment on column public.board_stages.arquiva_sem_reabrir is
  'Story 2.40 — quando true, mover um card FECHADO para esta coluna preserva '
  '`is_won`/`is_lost`/`closed_at`. É para coluna de CATEGORIA (Clientes, '
  'Profissional, Projeto Social), que arquiva em vez de reabrir a negociação. '
  'Default false: etapa de funil continua reabrindo, que é o certo.';

-- Marcadas por UUID, nunca por nome (lição da story 2.33).
update public.board_stages
   set arquiva_sem_reabrir = true
 where id in (
   '3ed212e5-32a9-4bda-8d70-bb8be49e790d',  -- Clientes
   '2da4a3f4-4333-4c79-a990-491e789d5096',  -- Profissional
   '1b829bbd-b7de-42bd-beb2-6e0baaeb4d04'   -- Projeto Social
 );

-- ⚠️ O que esta migração NÃO faz, de propósito: restaurar as 4 vendas já
-- apagadas. `is_won` e `closed_at` deles são recuperáveis pelo `activities`
-- (a data do "Moveu para Ganho"), mas reescrever o número de vendas de um mês
-- que ela já apresentou é decisão DELA, não minha. Fica como pendência com o
-- dado ao lado.
