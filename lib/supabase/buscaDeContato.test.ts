/**
 * Story 2.45 — a busca de contato passa a olhar o TELEFONE.
 *
 * O teste trava as três coisas que a Fernanda precisa e que não existiam:
 * achar pelo número, achar com o número formatado como ela digita, e não
 * quebrar quando o nome tem vírgula.
 */
import { describe, it, expect } from 'vitest';
import { apenasDigitos, escaparParaOr, filtroDeBuscaDeContato } from './buscaDeContato';

describe('apenasDigitos', () => {
    it('tira formatação de telefone', () => {
        expect(apenasDigitos('(12) 98194-5826')).toBe('12981945826');
        expect(apenasDigitos('+55 11 99999-9999')).toBe('5511999999999');
    });

    it('devolve string vazia quando não há dígito', () => {
        expect(apenasDigitos('Maria Silva')).toBe('');
    });
});

describe('filtroDeBuscaDeContato', () => {
    it('busca por nome e e-mail, como antes', () => {
        const filtro = filtroDeBuscaDeContato('Maria');
        expect(filtro).toContain('name.ilike.%Maria%');
        expect(filtro).toContain('email.ilike.%Maria%');
    });

    it('AGORA busca também por telefone — era o que faltava', () => {
        // O relato: "tem nome que eu não tô achando". Medido: 956 dos 957
        // contatos não têm e-mail e 52% têm nome de uma palavra só (pushName),
        // então na prática só se buscava por um nome que muitas vezes é apelido.
        const filtro = filtroDeBuscaDeContato('12981945826');
        expect(filtro).toContain('phone.ilike.%12981945826%');
    });

    it('acha mesmo com o número digitado formatado', () => {
        // O banco grava `+5512981945826`, sem formatação. Sem normalizar, buscar
        // "(12) 98194-5826" não casaria com nada e pareceria "não achou" — o
        // mesmo sintoma que esta story existe para consertar.
        const filtro = filtroDeBuscaDeContato('(12) 98194-5826');
        expect(filtro).toContain('phone.ilike.%12981945826%');
    });

    it('aceita pedaço do número — ela costuma ter só o final na tela', () => {
        expect(filtroDeBuscaDeContato('9819')).toContain('phone.ilike.%9819%');
    });

    it('não inventa filtro de telefone quando a busca é só texto', () => {
        // Sem isto, buscar "Maria" viraria `phone.ilike.%%`, que casa com QUALQUER
        // contato que tenha telefone — a busca devolveria a base inteira.
        expect(filtroDeBuscaDeContato('Maria')).not.toContain('phone.ilike');
    });

    // --- Achados na revisão do próprio diff, antes do deploy ---

    it('IGNORA dígito solto no meio do texto — senão a busca acha TODO MUNDO', () => {
        // Este é o caso que a 1ª versão errava: "Maria 2" tem um dígito, virava
        // `phone.ilike.%2%` e casava com quase todo telefone da base. O sintoma
        // seria o oposto do que a story conserta: em vez de "não acha ninguém",
        // "acha todo mundo" — e igualmente inútil para ela.
        expect(filtroDeBuscaDeContato('Maria 2')).not.toContain('phone.ilike');
        expect(filtroDeBuscaDeContato('Ana 12')).not.toContain('phone.ilike');
        expect(filtroDeBuscaDeContato('João 3º')).not.toContain('phone.ilike');
    });

    it('a partir de 4 dígitos passa a valer como telefone', () => {
        expect(filtroDeBuscaDeContato('582')).not.toContain('phone.ilike');
        expect(filtroDeBuscaDeContato('5826')).toContain('phone.ilike.%5826%');
    });

    it('devolve null quando não há termo', () => {
        expect(filtroDeBuscaDeContato('')).toBeNull();
        expect(filtroDeBuscaDeContato('   ')).toBeNull();
    });
});

describe('escaparParaOr — o parser do PostgREST não pode receber sintaxe crua', () => {
    it('neutraliza vírgula e parênteses', () => {
        // A vírgula separa condições dentro de `.or(...)`: um nome como
        // "Silva, Maria" partiria a expressão em duas e mudaria a consulta.
        // Só a vírgula e os parênteses viram `_`; o espaço fica como está.
        expect(escaparParaOr('Silva, Maria')).toBe('Silva_ Maria');
        expect(escaparParaOr('Ana (mãe)')).toBe('Ana _mãe_');
    });

    it('a busca com vírgula continua sendo UMA expressão válida', () => {
        const filtro = filtroDeBuscaDeContato('Silva, Maria');
        // 2 condições (nome, email) = 1 vírgula separadora. Se o termo tivesse
        // vazado cru, haveria 2.
        expect(filtro!.split(',')).toHaveLength(2);
    });

    it('neutraliza os CURINGAS do ilike — % e * casariam com tudo', () => {
        // Achado na revisão: `%` e `*` não são "texto que não acha nada", são
        // "casa com TUDO". Buscar `%` devolveria a base inteira.
        expect(escaparParaOr('%')).toBe('_');
        expect(escaparParaOr('Maria*')).toBe('Maria_');
        expect(filtroDeBuscaDeContato('%')).not.toContain('%%%');
    });
});
