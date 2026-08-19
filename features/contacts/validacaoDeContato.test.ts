/**
 * Story 2.45 — o cadastro manual deixa de exigir e-mail.
 *
 * O teste trava a regra nos dois sentidos: o caso da Fernanda (só telefone)
 * passa a valer, e o caso que a inversão ingênua quebraria (só e-mail, os 90
 * contatos sem telefone) continua valendo.
 */
import { describe, it, expect } from 'vitest';
import { impedimentoParaSalvarContato, MENSAGEM_DO_IMPEDIMENTO } from './validacaoDeContato';

describe('impedimentoParaSalvarContato', () => {
    it('aceita nome + telefone, SEM e-mail — o caso de 99,9% da base', () => {
        // Era exatamente isto que o formulário recusava: 956 dos 957 contatos
        // não têm e-mail, e o campo era obrigatório.
        expect(
            impedimentoParaSalvarContato({ name: 'Maria Silva', phone: '+5512981945826', email: '' })
        ).toBeNull();
    });

    it('aceita nome + e-mail, SEM telefone — não quebra os 90 que nasceram assim', () => {
        // Inverter a regra (exigir telefone) consertaria o cadastro novo e
        // impediria de salvar a edição destes 90. Mesma classe de defeito,
        // mirando outro grupo.
        expect(
            impedimentoParaSalvarContato({ name: 'Ana Souza', phone: '', email: 'ana@x.com' })
        ).toBeNull();
    });

    it('recusa contato sem nenhuma forma de contato', () => {
        expect(
            impedimentoParaSalvarContato({ name: 'Fulano', phone: '', email: '' })
        ).toBe('sem_forma_de_contato');
    });

    it('recusa sem nome', () => {
        expect(
            impedimentoParaSalvarContato({ name: '', phone: '+5511999999999', email: '' })
        ).toBe('sem_nome');
    });

    it('espaço em branco não conta como preenchido', () => {
        expect(
            impedimentoParaSalvarContato({ name: '   ', phone: '+5511999999999' })
        ).toBe('sem_nome');
        expect(
            impedimentoParaSalvarContato({ name: 'Maria', phone: '  ', email: '   ' })
        ).toBe('sem_forma_de_contato');
    });

    it('campo ausente (undefined/null) é tratado como vazio', () => {
        expect(impedimentoParaSalvarContato({ name: 'Maria' })).toBe('sem_forma_de_contato');
        expect(impedimentoParaSalvarContato({ name: null, phone: null, email: null })).toBe('sem_nome');
    });

    // --- Achado na revisão do próprio diff, antes do deploy ---

    it('recusa e-mail malformado — o `noValidate` tirou a checagem do navegador', () => {
        // O formulário passou a usar `noValidate` para que as mensagens em pt-BR
        // apareçam (o `required` nativo barra antes do nosso handler). Isso
        // desligou também a validação de formato do `type="email"`. Sem esta
        // regra, tirar a obrigatoriedade do e-mail passaria a ACEITAR "abc".
        expect(
            impedimentoParaSalvarContato({ name: 'Maria', phone: '+5511999999999', email: 'abc' })
        ).toBe('email_invalido');
        expect(
            impedimentoParaSalvarContato({ name: 'Maria', email: 'maria@sem-ponto' })
        ).toBe('email_invalido');
    });

    it('e-mail em branco continua válido — é o normal desta base', () => {
        expect(
            impedimentoParaSalvarContato({ name: 'Maria', phone: '+5511999999999', email: '' })
        ).toBeNull();
    });

    it('aceita e-mail comum sem frescura de regex', () => {
        for (const email of ['a@b.co', 'maria.silva@acreditando.com.br', 'x+tag@dominio.org']) {
            expect(impedimentoParaSalvarContato({ name: 'Maria', email })).toBeNull();
        }
    });

    it('toda mensagem diz o que fazer, não só o que faltou', () => {
        // Ela já relatou duas vezes no mês desconfiar da própria competência
        // diante de um aviso do sistema. Mensagem que só acusa piora isso.
        for (const mensagem of Object.values(MENSAGEM_DO_IMPEDIMENTO)) {
            expect(mensagem).toMatch(/informe/i);
        }
    });
});
