/**
 * @fileoverview Classificação de erro de banco da API pública — story 2.51.
 *
 * Em 18/09/2026 duas chamadas seguidas a `POST /deals` voltaram
 * `500 {"code":"DB_ERROR"}` e minutos depois três idênticas voltaram 201. O que
 * derrubou o lead ninguém sabe: a rota só fazia `console.error` e devolvia um
 * código genérico, sem identificador.
 *
 * Este módulo responde três perguntas sobre um erro do Postgres/PostgREST:
 *
 *   1. **Vale a pena tentar de novo?** ({@link isTransientDbError})
 *   2. **Dá para saber se a escrita aconteceu?** ({@link isAmbiguousDbError})
 *   3. **Que resposta HTTP esse erro merece?** ({@link classifyDbError})
 *
 * A pergunta 2 é a que o QA cobrou e que não existia: um `08006` ("conexão
 * fechada") pode ter chegado ao Postgres, commitado, e só a RESPOSTA ter se
 * perdido. Retentar às cegas nesse caso cria um segundo negócio. Por isso os
 * transitórios se dividem em dois:
 *
 * | Tipo | Exemplos | O que a rota faz |
 * |---|---|---|
 * | **Inequívoco** (não commitou) | `57014` statement timeout, `53300` conexões demais | retenta direto |
 * | **Ambíguo** (não dá para saber) | classe `08`, `fetch failed`, erro **sem código** | lê de volta ANTES de retentar |
 *
 * ⚠️ **Erro sem código nenhum é ambíguo, não definitivo.** É o formato real que
 * o supabase-js produz quando um gateway devolve 502/503/504 com corpo HTML:
 * `JSON.parse` falha e sobra `{ message: '<html>…' }`, sem `code`. Ver a nota
 * sobre `status` em {@link isTransientDbError}.
 *
 * 🔒 Nada aqui pode vazar valor de campo do lead — ver {@link extractSafePgFields}.
 *
 * @module lib/public-api/db-errors
 */

/**
 * Forma mínima de um erro vindo do supabase-js (PostgrestError ou falha de rede).
 *
 * **Não tem `status`.** O postgrest-js devolve `{ data, error, status }` — o
 * status HTTP é irmão do erro, não campo dele, e a rota desestrutura só
 * `{ data, error }`. Um tipo com `status` aqui convidava a escrever ramos que
 * nunca executam (foi o ACHADO 6 do QA).
 */
export interface DbErrorLike {
  code?: string | number | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
  name?: string | null;
}

/** Marcadores de falha de rede (não chegam com SQLSTATE — são TypeError do fetch). */
const MARCADORES_DE_REDE = ['fetch failed', 'econnreset', 'etimedout', 'econnrefused', 'socket hang up'];

/**
 * SQLSTATEs transitórios em que é **certo** que nada foi gravado.
 *
 * `57014` = o statement foi cancelado antes de terminar. `53300` = o servidor
 * recusou a conexão antes de receber o comando. Nenhum dos dois chega a
 * commitar, então podem ser retentados sem verificação.
 */
const TRANSITORIOS_INEQUIVOCOS = new Set(['57014', '53300']);

/**
 * Códigos da classe 53 que **não** valem retentativa (ACHADO 7 do QA).
 *
 * `53100` disco cheio e `53200` memória estourada não passam por si sós: em
 * segundos o estado é o mesmo e a retentativa só empilha carga no servidor já
 * doente. Só `53300` (limite de conexões) se resolve sozinho.
 */
const CLASSE_53_TRANSITORIO = new Set(['53300']);

/** Código SQLSTATE → resposta HTTP. Tudo que não estiver aqui é 500 DB_ERROR. */
const MAPA_DEFINITIVO: Record<string, { status: number; code: string }> = {
  '23503': { status: 422, code: 'INVALID_REFERENCE' }, // FK: board/stage/contact que não existe
  '23505': { status: 409, code: 'CONFLICT' },          // unicidade
  '23514': { status: 422, code: 'CHECK_VIOLATION' },   // check constraint
  '42501': { status: 403, code: 'FORBIDDEN' },         // permissão negada
};

export type DbErrorClass = 'transitorio' | 'definitivo';

export interface ClassifiedDbError {
  classe: DbErrorClass;
  /** Status HTTP a devolver quando o erro for final. */
  status: number;
  /** `code` do corpo da resposta. */
  code: string;
  /** SQLSTATE quando houver (ex.: `23503`), senão `null`. */
  sqlstate: string | null;
  /** Campo apontado pela constraint, quando dá para extrair (ex.: `board_id`). */
  campo: string | null;
}

function comoObjeto(error: unknown): DbErrorLike {
  if (!error || typeof error !== 'object') return { message: String(error ?? '') };
  return error as DbErrorLike;
}

function textoDoErro(e: DbErrorLike): string {
  return [e.message, e.details, e.hint, e.name].filter(Boolean).join(' ').toLowerCase();
}

/** SQLSTATE só quando o `code` tem cara de SQLSTATE (5 caracteres alfanuméricos). */
function sqlstateDe(e: DbErrorLike): string | null {
  const bruto = e.code == null ? '' : String(e.code).trim();
  return /^[0-9A-Za-z]{5}$/.test(bruto) ? bruto.toUpperCase() : null;
}

/**
 * O erro merece retentativa?
 *
 * - SQLSTATE classe `08` (conexão) e `57` (cancelamento/shutdown) → sim.
 * - Classe `53` → **só `53300`**; disco cheio e memória estourada não passam.
 * - Sem SQLSTATE → sim: é falha de rede ou gateway 5xx com corpo não-JSON, e
 *   nos dois casos a escrita pode ter acontecido. Quem chama precisa então
 *   consultar {@link isAmbiguousDbError} antes de repetir o comando.
 * - Qualquer outro SQLSTATE → não (definitivo).
 *
 * 📌 Não existe ramo por status HTTP aqui. O postgrest-js **não** põe o status
 * no objeto de erro: numa falha de rede ele monta `{ message, details, hint,
 * code: '' }` e num 5xx de gateway (corpo HTML) sobra `{ message: '<html>…' }`.
 * Os dois caem no ramo "sem SQLSTATE" acima, que é o caminho real.
 */
export function isTransientDbError(error: unknown): boolean {
  const e = comoObjeto(error);
  const sqlstate = sqlstateDe(e);

  if (sqlstate) {
    if (sqlstate.startsWith('53')) return CLASSE_53_TRANSITORIO.has(sqlstate);
    return sqlstate.startsWith('08') || sqlstate.startsWith('57');
  }

  return true;
}

/**
 * Dá para afirmar que a escrita NÃO aconteceu?
 *
 * `false` = dá (é seguro repetir o comando). `true` = **não dá** — a conexão
 * caiu ou a resposta se perdeu, e o INSERT pode ter commitado do outro lado.
 * Quem chama tem de ler de volta antes de retentar, senão duplica o negócio.
 *
 * Erro definitivo não é ambíguo: ele nunca escreveu.
 */
export function isAmbiguousDbError(error: unknown): boolean {
  if (!isTransientDbError(error)) return false;

  const sqlstate = sqlstateDe(comoObjeto(error));
  if (sqlstate && TRANSITORIOS_INEQUIVOCOS.has(sqlstate)) return false;

  return true;
}

/** É falha de rede (o erro nem chegou a virar SQLSTATE)? Usado só para log/leitura. */
export function isNetworkDbError(error: unknown): boolean {
  const texto = textoDoErro(comoObjeto(error));
  return MARCADORES_DE_REDE.some((marcador) => texto.includes(marcador));
}

/**
 * Nome do campo que a constraint reclamou.
 *
 * Só o **nome**: `Key (email)=(maria@x.com)` devolve `email`, nunca o valor.
 */
export function extractFieldName(error: unknown): string | null {
  const campos = extractSafePgFields(error);
  if (campos.colunas?.length) return campos.colunas[0];
  if (campos.constraint) {
    const porConstraint = campos.constraint.match(/^[a-z0-9_]*?_([a-z0-9_]+?)_(?:fkey|key|check)$/i);
    if (porConstraint?.[1]) return porConstraint[1];
  }
  return null;
}

/** Classifica o erro e diz que resposta HTTP ele merece. */
export function classifyDbError(error: unknown): ClassifiedDbError {
  const e = comoObjeto(error);
  const sqlstate = sqlstateDe(e);

  if (isTransientDbError(error)) {
    return { classe: 'transitorio', status: 500, code: 'DB_ERROR', sqlstate, campo: null };
  }

  const mapeado = sqlstate ? MAPA_DEFINITIVO[sqlstate] : undefined;
  if (mapeado) {
    return {
      classe: 'definitivo',
      status: mapeado.status,
      code: mapeado.code,
      sqlstate,
      campo: extractFieldName(error),
    };
  }

  return { classe: 'definitivo', status: 500, code: 'DB_ERROR', sqlstate, campo: null };
}

/** Mensagem pública de cada `code` — nunca repete texto do Postgres ao cliente. */
const MENSAGEM_POR_CODE: Record<string, string> = {
  INVALID_REFERENCE: 'Invalid reference',
  CONFLICT: 'Conflicts with an existing record',
  CHECK_VIOLATION: 'Value rejected by a database constraint',
  FORBIDDEN: 'Permission denied',
  DB_ERROR: 'Internal server error',
};

/** Texto do campo `error` da resposta, a partir do `code` classificado. */
export function messageForDbErrorCode(code: string, campo?: string | null): string {
  const base = MENSAGEM_POR_CODE[code] ?? 'Internal server error';
  return campo ? `${base} for field ${campo}` : base;
}

// ---------------------------------------------------------------------------
// 🔒 Redação: lista BRANCA, não lista negra
// ---------------------------------------------------------------------------

/** Quanto da `message` sobrevive no log, quando ela é considerada segura. */
const LIMITE_MESSAGE = 120;

/** O que é seguro guardar de um erro do Postgres. Nada além disto vai ao log. */
export interface SafePgErrorFields {
  /** SQLSTATE cru (`23505`) ou `null`. */
  code: string | null;
  /** Nome da constraint violada (`deals_board_id_fkey`). */
  constraint: string | null;
  /** Nomes das colunas de `Key (a, b)=` — só os nomes, nunca os valores. */
  colunas: string[] | null;
  /** Tabela/relação citada no texto (`deals`). */
  relacao: string | null;
  /** Primeira linha da `message`, truncada, **só quando comprovadamente sem valor**. */
  message: string | null;
  /** `true` quando a `message` foi descartada por poder conter valor. */
  message_suprimida: boolean;
  /** `details`/`hint` tinham conteúdo? O conteúdo em si nunca é gravado. */
  details_tinha_valor: boolean;
}

/** Sinais de que um texto carrega VALOR e não só nome de coisa. */
const SINAIS_DE_VALOR = ['=', '"', '(', ')'];
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const SEQUENCIA_NUMERICA = /\d[\d\s().-]{7,}\d/;

function primeiraLinha(texto: string): string {
  return texto.split('\n')[0]!.trim();
}

function pareceSeguro(linha: string): boolean {
  if (SINAIS_DE_VALOR.some((sinal) => linha.includes(sinal))) return false;
  return !EMAIL.test(linha) && !SEQUENCIA_NUMERICA.test(linha);
}

/**
 * Extrai do erro do Postgres **apenas o que é comprovadamente seguro**.
 *
 * ## Por que trocamos de abordagem (ACHADO 4 do QA — story 2.51)
 *
 * A versão anterior (`redactPgValues`) era lista **negra**: apagava o que
 * parecia perigoso e deixava passar o resto. O QA derrubou com três textos
 * reais que a regexp `\(([^()]*)\)` não casa, porque ela não entende
 * parênteses aninhados nem valor fora de parênteses:
 *
 * ```
 * Failing row contains (uuid, Lead da LP (Instagram), Maria Silva, maria@x.com, 11987654321)
 * duplicate key (Maria Silva) something
 * invalid input syntax for type uuid: "Maria Silva"
 * ```
 *
 * Lista negra erra para o lado do vazamento: basta um formato novo do Postgres
 * e o nome do lead entra no log. Lista **branca** erra para o lado da falta de
 * informação — o pior caso é um log menos rico, nunca um lead exposto.
 *
 * Então agora **nada do texto é copiado por padrão**. Só saem daqui:
 * `code`, nome da constraint, nomes de coluna, nome da relação, e a primeira
 * linha da `message` **se** ela não tiver `=`, aspas, parênteses, e-mail ou
 * sequência longa de dígitos. Na dúvida, `message_suprimida: true`.
 *
 * `details` e `hint` **nunca** são copiados: são justamente onde o Postgres
 * cola o valor (`Key (email)=(maria@x.com)`). Deles fica só o booleano
 * `details_tinha_valor`, que já responde "o banco mandou contexto?" sem
 * carregar o contexto.
 */
export function extractSafePgFields(error: unknown): SafePgErrorFields {
  const e = comoObjeto(error);
  const details = typeof e.details === 'string' ? e.details : '';
  const hint = typeof e.hint === 'string' ? e.hint : '';
  const message = typeof e.message === 'string' ? e.message : '';

  // Fonte de busca dos NOMES. Nenhum trecho daqui é copiado inteiro — só os
  // grupos capturados por regexps que casam exclusivamente identificadores.
  const alvo = `${message} ${details} ${hint}`;

  const constraint = alvo.match(/constraint "([A-Za-z0-9_]{1,63})"/)?.[1] ?? null;

  const colunasBrutas = alvo.match(/\bKey \(([A-Za-z0-9_, ]{1,200})\)/)?.[1] ?? null;
  const colunas = colunasBrutas
    ? colunasBrutas
        .split(',')
        .map((c) => c.trim())
        .filter((c) => /^[A-Za-z0-9_]{1,63}$/.test(c))
    : null;

  const relacao = alvo.match(/\b(?:table|relation) "([A-Za-z0-9_.]{1,127})"/)?.[1] ?? null;

  const linha = message ? primeiraLinha(message) : '';
  const messageSegura = linha && pareceSeguro(linha) ? linha.slice(0, LIMITE_MESSAGE) : null;

  return {
    code: e.code == null || e.code === '' ? null : String(e.code),
    constraint,
    colunas: colunas && colunas.length ? colunas : null,
    relacao,
    message: messageSegura,
    message_suprimida: !!linha && messageSegura === null,
    details_tinha_valor: details.length > 0 || hint.length > 0,
  };
}
