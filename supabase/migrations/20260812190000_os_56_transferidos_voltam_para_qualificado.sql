-- Story 2.33 (correção) — os 56 transferidos pela IA vão para `Qualificado`.
--
-- ✏️ CORREÇÃO DE UM ERRO MEU, registrada porque mudou uma decisão:
-- eu havia escrito que apontar a transferência para `Qualificado` faria "o lead
-- nascer qualificado sem ela ter qualificado", e movi os 56 para
-- `Contato Realizado`. Estava errado. O Filipe corrigiu:
--
--   • a IA transferir JÁ É a qualificação — ela fez o roteiro inteiro
--   • o "a partir do contato eu qualifico" da Fernanda é o OUTRO caminho: o lead
--     que abandona no meio, a IA não qualifica, ele fica em `Lead novo`, ela
--     assume, move para `Contato Realizado` e qualifica na mão
--
-- ⇒ São dois caminhos, não um conflito. E o T3 da story 2.17 NÃO ficou inerte:
-- ele cobre justamente o caminho manual (ela assume, os campos ficam
-- preenchidos, o card sobe sozinho).
--
-- 📊 Medido antes de mover: dos 56, **41** têm os dois campos da regra dela
-- (onde reside + tipo de lesão), 11 são parciais e 4 não têm nenhum. A mistura
-- existe porque até 11/08 a IA transferia com 1,32 perguntas em média (monobloco
-- em 5,9%); a regra que a faz completar o roteiro entrou ONTEM (4,23 e 77,5%).
-- Decisão do Filipe: todos os 56 vão, porque todos foram transferidos.
--
-- 🛡️ A cláusula `and stage_id = Contato Realizado` é proposital: se a Fernanda
-- já tiver movido algum destes cards nas últimas horas, ele NÃO é puxado de
-- volta. Nunca desfazer trabalho de usuário — mesmo critério do merge de
-- contatos e dos 3 cards que não foram movidos no Odoo.

update public.deals
   set stage_id = '3b1384fa-5fe2-4725-a8e1-7576a8690637'  -- Qualificado
 where id in ('d1e81e37-e8dd-48d6-84a7-5b48927b4cad','2ee61ee2-5018-4c0f-9824-54bd7c7e4487','ccc1722f-6488-4f4d-b6bc-443784594214','69216071-498c-422b-b9b0-34a8ec02e038','c7081180-bd76-4a82-bc4a-a11a0821d02b','740468e4-d078-49c7-bb63-90635417a1f1','60a1971e-ebb8-4e8d-ba52-30b04a3ad6b8','7e7ec350-9de2-41dd-8b47-ec4d4a47b626','92099f44-c21c-4503-a790-787c909755cf','888f27be-5e50-4c1f-8983-b295d39a2a45','9d42b9ca-a4ef-48e3-bccf-5e889e1e14b7','97239b46-9de3-4bf6-b2ae-b10cc4e812e6','2aa23c9a-d86e-4093-b281-ea84277256b8','74ba9a90-cd63-4180-afb7-0141963d4b66','b9986687-0587-401c-8e4d-9645299ad5ad','f88fa386-5a31-4f6a-8b39-cdc5717aa979','22451c8c-5d9e-488a-8a21-653a4c6c5dc1','bdba6144-3742-43f8-bde8-51e8fdfb0b6a','c1a5abac-991c-4ba3-ba17-75bd3a43348b','64b34ba5-dc7f-4fc5-a9c6-a4b26930efe9','f2839136-b023-4ed1-a850-551c88defb4e','67a6662f-2792-4525-95b3-a3594ffde044','8c4f90e8-601a-4f45-bc51-459d04d1977c','dd452fbe-5fd2-4b49-a506-d409640227fe','f330065e-2771-4baa-976a-f2159ded9752','3df36051-1ac4-4e83-b40c-465749300e3e','68551347-f5b3-492b-89be-43e1d942f712','0e624731-cdeb-45d1-99e5-f26d31e72d33','e0badc28-6f7b-4e99-9cdd-ff622414e05a','a24b4f4f-68e2-4c03-85c3-9aeff378fe33','0ec34505-d5b9-4538-aba7-86f137305e08','94ce9b1d-3bf6-4595-977f-5bc6a923ac92','5d281e52-ab06-4970-bc10-4691e06c9235','1de3fe16-63ef-4afb-9f07-09372f19172a','e6c46f40-07e7-4385-941b-e6c6f390e23b','08086761-e3a8-4060-8ee8-30c0430e85c4','85ffc722-1fdf-4ffa-a94d-f906c1f1a77b','55a4a2f7-fe17-4846-b8b9-88d4b0a5f17d','029ff545-467a-4e91-9ecf-2e684c04d4fd','7cc78889-ec98-401e-85c0-c20640fe90f1','02309fab-a459-4d09-a2de-abc729ae9980','cec46d80-7810-4e95-9b37-c69d4e8c5552','8b987858-98a1-4727-89f7-530e89a4618a','155b1a39-838f-45f1-a87d-aca8d1bc2c8c','28a2e530-9b34-4bc1-909b-34b9f8aaf708','a53fb436-5d80-438c-9028-d5164b13e9ad','a8880cb3-90ee-4d8e-9c58-cf12093eb0eb','7ce3ca1a-dc5c-4aa0-a5a0-61ec83752d44','4baa8400-23bd-4504-9a1a-2c1769e73160','66e2a1e0-b163-416d-a107-5be1bfa43a59','5bb1f914-373a-4593-b476-b812ad0e7261','ec715fbf-c35e-40f2-ba9f-5d50c048ec6f','1a4431bb-31da-431d-9a11-33159d48ff29','d82223b8-1d93-45b1-b86a-f5a22894df87','c18a7710-c142-44db-b237-39064c8fca26','7c3f79f1-7bec-40c8-8333-f9156bf196cd')
   and stage_id = '82a1cd0b-bd3d-48ba-af46-c9c7d70e77a9'; -- só os que seguem em Contato Realizado
