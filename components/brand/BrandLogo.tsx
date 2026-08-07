import Image from 'next/image';
import { cn } from '@/lib/utils';

/**
 * Marca do Acreditando.
 *
 * Fonte unica da identidade visual no app — qualquer tela que precise do logo
 * importa daqui. Evita o asset ser duplicado tela a tela e sair de sincronia.
 *
 * Gerado do logo oficial do site institucional (961x217, WebP com alfa):
 *   https://acreditando.com.br/wp-content/uploads/2022/10/logo-main.webp
 * Cores amostradas da fonte: ardosia #1F3C51 · ambar #F8B106.
 *
 * Duas variantes:
 *   padrao  — arquivo oficial intocado, usado no tema claro
 *   inverso — apenas os pixels ardosia viram branco; o ambar fica INTACTO.
 *             E o tratamento padrao de manual de marca para fundo escuro, sem
 *             o qual o wordmark some na sidebar escura.
 *
 * A troca e feita por CSS (`dark:`), nao por JavaScript, para nao piscar a marca
 * errada durante a hidratacao.
 *
 * Regeneracao: scripts/marca/gerar-marca.mjs (fora do git por convencao do repo).
 */

const LOCKUP = { padrao: '/brand/acreditando-lockup.png', inverso: '/brand/acreditando-lockup-inverso.png' };
const SYMBOL = { padrao: '/brand/acreditando-simbolo.png', inverso: '/brand/acreditando-simbolo-inverso.png' };

const ALT = 'Acreditando';

interface BrandProps {
  className?: string;
  /** Marca decorativa ao lado de um texto que ja identifica a marca. */
  decorative?: boolean;
}

/**
 * Simbolo isolado (quadrado). Para espacos estreitos: sidebar recolhida,
 * rail de tablet, avatar de app.
 */
export function BrandMark({ className, decorative = false }: BrandProps) {
  const alt = decorative ? '' : ALT;
  return (
    <span className={cn('relative block shrink-0', className)}>
      <Image
        src={SYMBOL.padrao}
        alt={alt}
        width={256}
        height={256}
        priority
        className="block h-full w-full object-contain dark:hidden"
        aria-hidden={decorative || undefined}
      />
      <Image
        src={SYMBOL.inverso}
        alt={alt}
        width={256}
        height={256}
        priority
        className="hidden h-full w-full object-contain dark:block"
        aria-hidden={decorative || undefined}
      />
    </span>
  );
}

/**
 * Lockup completo (simbolo + assinatura). Para a sidebar expandida e a tela
 * de login. A altura manda; a largura acompanha a proporcao do arquivo.
 */
export function BrandLockup({ className, decorative = false }: BrandProps) {
  const alt = decorative ? '' : ALT;
  return (
    <span className={cn('relative block', className)}>
      <Image
        src={LOCKUP.padrao}
        alt={alt}
        width={709}
        height={160}
        priority
        className="block h-full w-auto object-contain dark:hidden"
        aria-hidden={decorative || undefined}
      />
      <Image
        src={LOCKUP.inverso}
        alt={alt}
        width={709}
        height={160}
        priority
        className="hidden h-full w-auto object-contain dark:block"
        aria-hidden={decorative || undefined}
      />
    </span>
  );
}
