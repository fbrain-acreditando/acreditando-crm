-- REVERSAO da migracao 20260812211500_board_ganha_coluna_clientes.sql
--
-- ⚠️ Renomeada de `20260812210000_` para `20260812211500_` em 12/08: o timestamp
-- original COLIDIA com `20260812210000_metricas_de_atendimento_bloco_b.sql`, de
-- outra sessao do mesmo dia. Duas migracoes com o mesmo prefixo = ordem de
-- replay indefinida num banco reconstruido do zero.
--
-- Seguro: apaga a coluna `Clientes` SOMENTE se ela estiver vazia.
-- A FK `deals_stage_id_fkey` e NO ACTION => se sobrar card, o banco aborta a transacao inteira.
-- Isso e proposital: e o mesmo gate usado na 2.33 — o banco recusa apagar estagio com card dentro,
-- em vez de deixar deal orfao.
--
-- Se houver card na coluna, MOVER PRIMEIRO (decidindo com a Fernanda para onde), depois reverter.

begin;

delete from public.board_stages
 where board_id = '5f6bded2-0f7c-418d-9598-7ea75d032242'
   and name = 'Clientes';

commit;
