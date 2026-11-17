/**
 * Story 2.74 — o card antigo que a busca acha.
 *
 * O quadro carrega no máximo 1.000 cards. Este hook traz do BANCO os que
 * ficaram de fora, por dois caminhos, e os coloca no cache do quadro
 * (`DEALS_VIEW_KEY`) para que arrastar, perder, ganhar e abrir funcionem como
 * em qualquer outro card:
 *
 * 1. **Busca** (AC3/AC5): termo com 3+ letras/dígitos, 300 ms depois da última
 *    tecla → `dealsService.searchForBoard` → até 50 cards.
 * 2. **`?deal=<id>`** (AC4): o botão "Deal" das Mensagens (e Contatos/Inbox)
 *    abre qualquer card, mesmo fora dos 1.000.
 *
 * 🔁 Reaplicação (AC1, C2): qualquer recarga do cache (foco na aba,
 * invalidações de contatos/renomear/duplicados, prefetch de rota) reescreve
 * `DEALS_VIEW_KEY` só com os 1.000 do banco e TIRA o card acrescentado. Por
 * isso a reaplicação reage à mudança dos dados do cache (`dataUpdatedAt`), não
 * a um evento específico. Entre versões do mesmo card, vence a de `updatedAt`
 * mais novo — e a do cache, enquanto ele estiver lá (pode ter otimismo).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { hashKey, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DealView } from '@/types';
import { dealsService } from '@/lib/supabase';
import { queryKeys, DEALS_VIEW_KEY } from '@/lib/query/queryKeys';
import { enriquecerDeals } from '@/lib/query/hooks/enriquecerDeals';
import { CHAVE_DA_EXCLUSAO_DE_DEAL } from '@/lib/query/hooks/useDealsQuery';
import { acrescentarAoQuadro, juntarPorIdMaisNovo, versaoMaisNova } from '@/lib/query/acrescentarAoQuadro';
import { LIMITE_DA_BUSCA_NO_BANCO, termoSeguroParaBusca } from '@/lib/supabase/buscaDeCards';
import { isValidUUID } from '@/lib/supabase/utils';
import { useToast } from '@/context/ToastContext';

/** Espera depois da última tecla antes de ir ao banco (D6, padrão da 2.68). */
export const ESPERA_DA_BUSCA_MS = 300;

/** Textos da tela (AC4, AC5) — os testes afirmam estes literais. */
export const TEXTOS_DA_BUSCA_NO_BANCO = {
  procurando: 'Procurando também nos cards mais antigos…',
  erro: 'Não deu para procurar nos cards mais antigos. Mostrando só os carregados.',
  noLimite: `Mostrando os ${LIMITE_DA_BUSCA_NO_BANCO} mais recentes encontrados no banco. Digite mais para refinar.`,
  inclui: (n: number) =>
    n === 1
      ? 'Inclui 1 card mais antigo encontrado no banco.'
      : `Inclui ${n} cards mais antigos encontrados no banco.`,
  cardNaoExiste: 'Este card não existe mais ou foi excluído.',
  erroAoAbrir: 'Não deu para abrir este card. Tente de novo.',
} as const;

export interface EstadoDaBuscaNoBanco {
  situacao: 'ociosa' | 'procurando' | 'erro' | 'pronta';
  /** Cards devolvidos pelo banco para o termo atual. */
  total: number;
  /** Desses, quantos NÃO estavam carregados (foram acrescentados ao quadro). */
  maisAntigos: number;
}

/** Texto do estado da busca (AC5), ou `null` quando não há o que dizer. */
export function textoDoEstadoDaBusca(estado: EstadoDaBuscaNoBanco): string | null {
  switch (estado.situacao) {
    case 'procurando':
      return TEXTOS_DA_BUSCA_NO_BANCO.procurando;
    case 'erro':
      return TEXTOS_DA_BUSCA_NO_BANCO.erro;
    case 'pronta':
      if (estado.total >= LIMITE_DA_BUSCA_NO_BANCO) return TEXTOS_DA_BUSCA_NO_BANCO.noLimite;
      if (estado.maisAntigos > 0) return TEXTOS_DA_BUSCA_NO_BANCO.inclui(estado.maisAntigos);
      return null;
    default:
      return null;
  }
}

/** O valor depois de `ms` sem mudar. */
function useValorComEspera<T>(valor: T, ms: number): T {
  const [comEspera, setComEspera] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setComEspera(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return comEspera;
}

/** Chave da busca no banco — debaixo de `deals.all` (invalidações gerais a alcançam). */
export const chaveDaBuscaNoBanco = (boardId: string, termo: string) =>
  [...queryKeys.deals.all, 'busca-no-banco', boardId, termo] as const;

export interface OpcoesDoCardsDoBanco {
  /** Quadro ativo (a busca é só nele). */
  boardId: string;
  /** O que está no campo de busca agora. */
  searchTerm: string;
  /** `dataUpdatedAt` do cache do quadro: muda a cada reescrita de `DEALS_VIEW_KEY`. */
  cacheAtualizadoEm: number;
  /** Card com a janela aberta (o do `?deal=` deixa de ser reaplicado quando ela fecha). */
  selectedDealId: string | null;
  /** Abre a janela do card. */
  abrirJanela: (dealId: string) => void;
}

export function useCardsDoBanco({
  boardId,
  searchTerm,
  cacheAtualizadoEm,
  selectedDealId,
  abrirJanela,
}: OpcoesDoCardsDoBanco) {
  const queryClient = useQueryClient();
  const { addToast } = useToast();

  // ---------------------------------------------------------------- busca
  const termoComEspera = useValorComEspera(searchTerm, ESPERA_DA_BUSCA_MS);
  const termoVaiAoBanco = termoSeguroParaBusca(termoComEspera) !== null;
  const boardValido = !!boardId && !boardId.startsWith('temp-');
  // Enquanto a pessoa digita, o resultado do termo anterior não vale.
  const termoEmDia = termoComEspera === searchTerm;
  const buscaAtiva = termoVaiAoBanco && boardValido && termoEmDia;

  const busca = useQuery<DealView[], Error>({
    queryKey: chaveDaBuscaNoBanco(boardId, termoComEspera),
    queryFn: async ({ signal }) => {
      const { data, error } = await dealsService.searchForBoard(boardId, termoComEspera, { signal });
      if (error) throw error;
      return enriquecerDeals(data || [], { signal });
    },
    enabled: termoVaiAoBanco && boardValido,
    staleTime: 30 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const cardsDaBusca = useMemo<DealView[]>(
    () => (buscaAtiva && busca.data ? busca.data : []),
    [buscaAtiva, busca.data]
  );
  const idsDaBusca = useMemo(() => new Set(cardsDaBusca.map(d => d.id)), [cardsDaBusca]);

  // ---------------------------------------------------------------- ?deal=
  const [trazidoPelaUrl, setTrazidoPelaUrl] = useState<DealView | null>(null);
  const [idPendente, setIdPendente] = useState<string | null>(null);
  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  /** Pede para abrir o card `id` — carregado ou não. */
  const abrirPeloId = useCallback((id: string) => setIdPendente(id), []);

  useEffect(() => {
    if (!idPendente) return;
    // Espera o quadro ter carregado ao menos uma vez: antes disso não dá para
    // saber se o card "não está carregado" ou "ainda não chegou".
    const estado = queryClient.getQueryState(DEALS_VIEW_KEY);
    if (!estado || !estado.dataUpdatedAt) return;

    const id = idPendente;
    setIdPendente(null);

    const cache = queryClient.getQueryData<DealView[]>(DEALS_VIEW_KEY) ?? [];
    if (cache.some(d => d.id === id)) {
      abrirJanela(id);
      return;
    }

    // M-1 (QA) — id que não é UUID (URL digitada à mão) não existe: nem vai ao
    // banco (o Postgres responderia erro de sintaxe e a tela diria "tente de novo").
    if (!isValidUUID(id)) {
      addToast(TEXTOS_DA_BUSCA_NO_BANCO.cardNaoExiste, 'warning');
      return;
    }

    void (async () => {
      try {
        const { data, error } = await dealsService.getById(id);
        if (!montado.current) return;
        if (error) {
          addToast(TEXTOS_DA_BUSCA_NO_BANCO.erroAoAbrir, 'error');
          return;
        }
        if (!data) {
          addToast(TEXTOS_DA_BUSCA_NO_BANCO.cardNaoExiste, 'warning');
          return;
        }
        const [card] = await enriquecerDeals([data]);
        if (!montado.current || !card) return;
        queryClient.setQueryData<DealView[]>(DEALS_VIEW_KEY, old => acrescentarAoQuadro(old, [card]));
        setTrazidoPelaUrl(card);
        abrirJanela(id);
      } catch {
        if (montado.current) addToast(TEXTOS_DA_BUSCA_NO_BANCO.erroAoAbrir, 'error');
      }
    })();
  }, [idPendente, cacheAtualizadoEm, queryClient, abrirJanela, addToast]);

  // O do `?deal=` deixa de ser reaplicado quando a janela dele fecha.
  useEffect(() => {
    if (trazidoPelaUrl && selectedDealId !== trazidoPelaUrl.id) setTrazidoPelaUrl(null);
  }, [selectedDealId, trazidoPelaUrl]);

  // ---------------------------------------------------------------- reaplicação
  /** Cards candidatos a guardar: busca do termo atual + o `?deal=` com a janela aberta. */
  const candidatos = useRef(new Map<string, DealView>());
  /** Versão mais nova conhecida de cada card guardado. */
  const versoes = useRef(new Map<string, DealView>());
  /** Ids guardados agora (candidatos menos os removidos de propósito). */
  const idsGuardados = useRef(new Set<string>());
  /**
   * QA 2.74 B1/C-3 — ids EXCLUÍDOS: saíram do cache por escrita manual
   * (`useDeleteDeal.onMutate`) enquanto a exclusão deles estava em voo. Não voltam, nem
   * se a busca ainda os devolver antes de o banco refletir a exclusão.
   */
  const removidos = useRef(new Set<string>());
  /** Ids que NÃO estavam no cache quando chegaram (os "mais antigos" do AC5). */
  const [idsAcrescentados, setIdsAcrescentados] = useState<ReadonlySet<string>>(() => new Set());

  /**
   * QA 2.74 C-3 — este card está sendo excluído agora? (`useDeleteDeal` com
   * esta variável no MutationCache, ainda não falhou). Durante o `onMutate` e
   * o `onSettled` a mutação está lá; num rollback de OUTRA mutação, não.
   */
  const estaSendoExcluido = useCallback(
    (id: string) =>
      queryClient
        .getMutationCache()
        .findAll({ mutationKey: CHAVE_DA_EXCLUSAO_DE_DEAL })
        .some(m => m.state.variables === id && m.state.status !== 'error'),
    [queryClient]
  );

  /** Recalcula os guardados a partir dos candidatos, sem os removidos. */
  const recalcularGuardados = useCallback(() => {
    const ids = new Set<string>();
    for (const [id, card] of candidatos.current) {
      if (removidos.current.has(id)) continue;
      ids.add(id);
      versoes.current.set(id, versaoMaisNova(versoes.current.get(id), card));
    }
    idsGuardados.current = ids;
    // Esquece quem deixou de ser guardado (busca limpa, janela fechada, removido).
    for (const id of Array.from(versoes.current.keys())) {
      if (!ids.has(id)) versoes.current.delete(id);
    }
  }, []);

  /**
   * Confere o cache do quadro contra os guardados.
   *
   * - Card no cache: a versão do cache vale (otimismo/Realtime), guardada se for mais nova.
   * - Card fora do cache:
   *   - escrita MANUAL (`setQueryData`) e ESTE card está sendo excluído
   *     (`useDeleteDeal` em voo): foi REMOVIDO de propósito → esquece, não
   *     volta (QA 2.74 B1);
   *   - qualquer outro caso — cache vindo do banco (refetch, foco, invalidação,
   *     prefetch), card recém-chegado da busca/`?deal=`, ou escrita manual que
   *     o tirou sem ser exclusão (rollback com retrato anterior, QA C-3): volta.
   * - Removido que reaparece numa escrita manual (rollback do `onError`) volta a ser guardado.
   */
  const sincronizar = useCallback(
    ({ reaplicar }: { reaplicar: boolean }) => {
      const cache = queryClient.getQueryData<DealView[]>(DEALS_VIEW_KEY);
      if (cache === undefined) return;
      const noCache = new Map(cache.map(d => [d.id, d]));

      if (!reaplicar && removidos.current.size > 0) {
        let voltou = false;
        for (const id of Array.from(removidos.current)) {
          if (noCache.has(id)) {
            removidos.current.delete(id);
            voltou = true;
          }
        }
        if (voltou) recalcularGuardados();
      }
      if (idsGuardados.current.size === 0) return;

      const faltando: DealView[] = [];
      let removeu = false;
      for (const id of Array.from(idsGuardados.current)) {
        const guardado = versoes.current.get(id);
        const doCache = noCache.get(id);
        if (doCache) {
          versoes.current.set(id, versaoMaisNova(guardado, doCache));
        } else if (!reaplicar && estaSendoExcluido(id)) {
          // QA C-3: só é exclusão se ESTE card está sendo excluído agora
          // (`useDeleteDeal` em voo). Escrita manual que o tira por outro
          // motivo — rollback de outra mutação com retrato anterior ao card —
          // cai no `else` e ele volta na hora.
          removidos.current.add(id);
          removeu = true;
        } else if (guardado) {
          faltando.push(guardado);
        }
      }
      if (removeu) recalcularGuardados();
      if (faltando.length === 0) return;

      queryClient.setQueryData<DealView[]>(DEALS_VIEW_KEY, old => acrescentarAoQuadro(old, faltando));
      setIdsAcrescentados(prev => {
        const novos = faltando.filter(d => !prev.has(d.id));
        if (novos.length === 0) return prev;
        const proximo = new Set(prev);
        for (const d of novos) proximo.add(d.id);
        return proximo;
      });
    },
    [queryClient, recalcularGuardados, estaSendoExcluido]
  );

  // Candidatos mudaram (resultado da busca, `?deal=` aberto/fechado).
  useEffect(() => {
    candidatos.current = new Map(
      juntarPorIdMaisNovo(cardsDaBusca, trazidoPelaUrl ? [trazidoPelaUrl] : []).map(d => [d.id, d])
    );
    recalcularGuardados();
    sincronizar({ reaplicar: true });
  }, [cardsDaBusca, trazidoPelaUrl, recalcularGuardados, sincronizar]);

  // C2 — TODA reescrita de `DEALS_VIEW_KEY`, ouvida no QueryCache (duas escritas
  // seguidas — otimismo e logo depois a recarga — acontecem antes do próximo
  // efeito, e a versão do otimismo se perderia).
  // `action.manual` separa as duas naturezas (QA 2.74 B1):
  //   - sem `manual`: o cache veio do BANCO (refetch, foco, invalidação,
  //     prefetch `queryFn`) → quem sumiu volta;
  //   - `manual` (`setQueryData`: otimismo, Realtime, exclusão, rollback) → quem
  //     sumiu foi tirado de propósito → não volta.
  useEffect(() => {
    const hashDoQuadro = hashKey(DEALS_VIEW_KEY);
    return queryClient.getQueryCache().subscribe(evento => {
      if (
        evento.type === 'updated' &&
        evento.action.type === 'success' &&
        evento.query.queryHash === hashDoQuadro
      ) {
        sincronizar({ reaplicar: !evento.action.manual });
      }
    });
  }, [queryClient, sincronizar]);

  // Rede de segurança: o `dataUpdatedAt` do quadro mudou. Removidos já saíram
  // dos guardados (o ouvinte acima roda antes), então nada "ressuscita" aqui.
  useEffect(() => {
    sincronizar({ reaplicar: true });
  }, [cacheAtualizadoEm, sincronizar]);

  // ---------------------------------------------------------------- estado (AC5)
  const estado = useMemo<EstadoDaBuscaNoBanco>(() => {
    if (!termoSeguroParaBusca(searchTerm) || !boardValido) {
      return { situacao: 'ociosa', total: 0, maisAntigos: 0 };
    }
    if (!termoEmDia || busca.isFetching || busca.isPending) {
      return { situacao: 'procurando', total: 0, maisAntigos: 0 };
    }
    if (busca.isError) return { situacao: 'erro', total: 0, maisAntigos: 0 };
    return {
      situacao: 'pronta',
      total: cardsDaBusca.length,
      maisAntigos: cardsDaBusca.filter(d => idsAcrescentados.has(d.id)).length,
    };
  }, [searchTerm, boardValido, termoEmDia, busca.isFetching, busca.isPending, busca.isError, cardsDaBusca, idsAcrescentados]);

  return {
    /** Ids que o BANCO devolveu para o termo atual: contam como "bate com a busca". */
    idsDaBusca,
    estadoDaBusca: estado,
    textoDaBusca: textoDoEstadoDaBusca(estado),
    abrirPeloId,
  };
}
