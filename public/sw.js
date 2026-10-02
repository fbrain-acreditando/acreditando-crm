/* eslint-disable no-restricted-globals */
// =============================================================================
// DESLIGADOR (kill switch) do service worker — story 2.61.
//
// ⚠️ NUNCA APAGUE ESTE ARQUIVO, e não volte a registrar SW sem uma story.
//
// Por que ele existe: o SW antigo (cache `nossocrm-shell-v2`) respondia as
// leituras do Supabase com a resposta da leitura ANTERIOR ("stale-while-
// revalidate"). A tela mostrava sempre "uma leitura atrás" e o card "voltava".
//
// Navegadores que ainda têm o v2 instalado só se curam quando buscam este
// endereço (/sw.js) de novo e recebem bytes novos. Se o arquivo sumir (404),
// o navegador MANTÉM o SW velho para sempre. Por isso este arquivo fica
// publicado por tempo indeterminado.
//
// O que ele faz:
// - install: skipWaiting(), sem pré-cache (a instalação nunca falha).
// - activate: clients.claim() ⇒ apaga TODOS os caches ⇒ unregister().
// - NÃO tem listener de `fetch`: tudo vai direto para a rede.
// - NÃO recarrega abas (não apaga formulário em edição).
// =============================================================================

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Falha no claim não pode impedir a limpeza.
      await self.clients.claim().catch(() => {});
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.registration.unregister();
    })()
  );
});
