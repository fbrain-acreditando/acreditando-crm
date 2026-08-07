import Image from 'next/image';
import { cn } from '@/lib/utils';

/**
 * Marca do Grupo Acreditando.
 *
 * Fonte unica da identidade visual no app — qualquer tela que precise do logo
 * importa daqui. Evita o asset ser duplicado tela a tela e sair de sincronia.
 *
 * Duas variantes oficiais, nenhuma recolorida em codigo:
 *   navy  (#2A2A63) — usada no tema claro
 *   gold  (#FBB000) — usada no tema escuro, onde o navy nao teria contraste
 *
 * A troca e feita por CSS (`dark:`), nao por JavaScript, para nao piscar a marca
 * errada durante a hidratacao.
 */

const LOCKUP = { navy: '/brand/acreditando-lockup-navy.png', gold: '/brand/acreditando-lockup-gold.png' };
const SYMBOL = { navy: '/brand/acreditando-symbol-navy.png', gold: '/brand/acreditando-symbol-gold.png' };

const ALT = 'Grupo Acreditando';

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
        src={SYMBOL.navy}
        alt={alt}
        width={256}
        height={256}
        priority
        className="block h-full w-full object-contain dark:hidden"
        aria-hidden={decorative || undefined}
      />
      <Image
        src={SYMBOL.gold}
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
        src={LOCKUP.navy}
        alt={alt}
        width={739}
        height={160}
        priority
        className="block h-full w-auto object-contain dark:hidden"
        aria-hidden={decorative || undefined}
      />
      <Image
        src={LOCKUP.gold}
        alt={alt}
        width={735}
        height={160}
        priority
        className="hidden h-full w-auto object-contain dark:block"
        aria-hidden={decorative || undefined}
      />
    </span>
  );
}
