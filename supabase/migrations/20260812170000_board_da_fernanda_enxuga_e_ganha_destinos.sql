-- Story 2.33 — o board passa a ser o funil que a Fernanda usa.
--
-- Pedido dela (áudio de 12/08):
--   "Será que a gente pode tirar essa coluna Em negociação? Porque se eu já
--    mandei a proposta, significa que eu já estou em negociação com esse
--    cliente. (...) Qualificação também do lead não tem necessidade, pode
--    deixar só o contato realizado, e a partir do contato ou eu qualifico, ou
--    ele está perdido. E colocar profissional e Instituto Acreditando, ou
--    projeto social."
--
-- Decisões do Filipe (12/08), depois da medição:
--   • os 56 cards de `Em qualificação` vão para `Contato Realizado` — eles
--     chegaram ali porque a IA TRANSFERIU, ou seja houve contato; não houve
--     qualificação. Mandá-los para `Qualificado` marcaria como qualificado
--     quem ela nunca qualificou, na semana em que ela apresenta o board.
--   • a regra de roteamento passa a apontar para `Qualificado`, valendo do
--     próximo lead em diante.
--   • `Profissional` e `Projeto Social` entram NO FIM: são destinos (Educa e
--     Instituto), não etapas do funil de venda dela. No fim, mover para lá
--     nunca esbarra na regra de o card não andar para trás.
--
-- ⚠️ REGISTRADO, não escondido: apontar a transferência para `Qualificado` faz
-- o lead nascer qualificado sem ela ter qualificado — o que contraria a frase
-- dela ("a partir do contato, ou eu qualifico, ou ele está perdido") e torna o
-- T3 da story 2.17 inerte, porque origem e destino viram a mesma coluna.
-- Decisão consciente do Filipe; fica escrito para quem ler depois.
--
-- Ordem de execução importa: mover os cards ANTES de apagar o estágio. A FK
-- `deals_stage_id_fkey` é NO ACTION e ABORTA o delete se sobrar card — é rede
-- de segurança, não obstáculo. Tudo por UUID: `Em qualificação ` tem espaço no
-- FIM do nome e casar por texto já falhou neste projeto antes.

begin;

-- 1. Os 56 cards saem de `Em qualificação` e vão para `Contato Realizado`.
update public.deals
   set stage_id = '82a1cd0b-bd3d-48ba-af46-c9c7d70e77a9'  -- Contato Realizado
 where stage_id = '08da2c2b-0b29-4e3b-bfbc-93c373284b93'; -- Em qualificação

-- 2. A transferência automática (story 2.5) passa a cair em `Qualificado`.
update public.lead_routing_rules
   set transfer_stage_id = '3b1384fa-5fe2-4725-a8e1-7576a8690637'  -- Qualificado
 where transfer_stage_id = '08da2c2b-0b29-4e3b-bfbc-93c373284b93';

-- 3. As duas colunas saem. `Em negociação` está vazia; `Em qualificação` ficou
--    vazia no passo 1. Se algum card tiver escapado, a FK aborta a transação
--    inteira — e é exatamente o que se quer.
delete from public.board_stages
 where id in (
   '08da2c2b-0b29-4e3b-bfbc-93c373284b93',  -- Em qualificação
   'bb373b0c-85b0-47f8-8e54-eae9d6b26ab3'   -- Em negociação
 );

-- 4. Fecha os buracos na ordem (sobravam 2 e 9 vazios).
update public.board_stages set "order" = 0  where id = '82d1a222-eeff-4627-baed-881908dbd702'; -- Lead novo
update public.board_stages set "order" = 1  where id = '82a1cd0b-bd3d-48ba-af46-c9c7d70e77a9'; -- Contato Realizado
update public.board_stages set "order" = 2  where id = '3b1384fa-5fe2-4725-a8e1-7576a8690637'; -- Qualificado
update public.board_stages set "order" = 3  where id = 'c97424a3-9107-419e-82dc-e6431cafbee3'; -- Apresentação enviada
update public.board_stages set "order" = 4  where id = 'fef376be-5c81-48de-bccd-95264abd28e6'; -- Aguardando retorno
update public.board_stages set "order" = 5  where id = 'c8f1ea2e-2607-4df8-ad3d-a25eb201de80'; -- Avaliação agendada
update public.board_stages set "order" = 6  where id = 'd0ceffc3-bd49-4921-bb4a-77a187ddc562'; -- Avaliação realizada
update public.board_stages set "order" = 7  where id = '9f1b2a7a-e6b1-4e04-b041-87581fc6a8a9'; -- Proposta enviada
update public.board_stages set "order" = 8  where id = 'f359ee98-b7b1-460d-a7be-2ef92f92c4c7'; -- Ganho
update public.board_stages set "order" = 9  where id = '78defbd3-6ca4-4b96-b67a-2268e7e6dce5'; -- Perdido

-- 5. Os dois destinos novos. `linked_lifecycle_stage` fica NULL de propósito:
--    eles não são fase do ciclo de venda dela — são para onde o lead SAI.
insert into public.board_stages (board_id, name, label, color, "order", is_default, linked_lifecycle_stage, organization_id)
select '5f6bded2-0f7c-418d-9598-7ea75d032242', 'Profissional', 'Profissional', 'bg-indigo-500', 10, false, null, '83160646-16a0-4cb7-9067-7ce7ef34ff50'
 where not exists (select 1 from public.board_stages where board_id = '5f6bded2-0f7c-418d-9598-7ea75d032242' and name = 'Profissional');

insert into public.board_stages (board_id, name, label, color, "order", is_default, linked_lifecycle_stage, organization_id)
select '5f6bded2-0f7c-418d-9598-7ea75d032242', 'Projeto Social', 'Projeto Social', 'bg-teal-500', 11, false, null, '83160646-16a0-4cb7-9067-7ce7ef34ff50'
 where not exists (select 1 from public.board_stages where board_id = '5f6bded2-0f7c-418d-9598-7ea75d032242' and name = 'Projeto Social');

commit;
