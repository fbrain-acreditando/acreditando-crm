import React from 'react';
import FocusTrapReact from 'focus-trap-react';

export interface FocusTrapProps {
  /** Whether the trap is active */
  active: boolean;
  /** Element(s) to trap focus within */
  children: React.ReactNode;
  /** Callback when user presses Escape */
  onEscape?: () => void;
  /** Initial focus target (selector or ref) */
  initialFocus?: string | React.RefObject<HTMLElement> | false;
  /** Return focus to this element on deactivate */
  returnFocus?: boolean;
  /** Clicking outside DESATIVA o trap (default: false) */
  clickOutsideDeactivates?: boolean;
  /**
   * Cliques fora do container são PERMITIDOS sem desativar o trap (default: true).
   *
   * ⚠️ Story 2.28 — este default já foi `clickOutsideDeactivates` (ou seja, `false`),
   * e isso matava qualquer camada renderizada em **portal** por cima do trap: o
   * `focus-trap` dá `stopImmediatePropagation` no clique "de fora", e todo conteúdo
   * de portal está, por definição, fora do container. Custo real: o aviso "Você não
   * salvou" (2.27) e o "Excluir negócio" ficavam com os botões **mortos** dentro do
   * `DealDetailModal` — o segundo desde o primeiro commit, sem ninguém notar.
   *
   * Separar as duas opções é o ponto: `clickOutsideDeactivates: false` continua
   * dizendo "clicar fora não me desliga"; `allowOutsideClick: true` diz "mas eu não
   * cancelo o clique de ninguém". Confinamento de Tab — que é para o que o trap
   * existe — não muda.
   */
  allowOutsideClick?: boolean;
}

/**
 * FocusTrap - Traps keyboard focus within children
 * 
 * Wraps focus-trap-react for consistent modal/dialog accessibility.
 * When active, Tab/Shift+Tab cycles only through focusable elements
 * within the trap.
 * 
 * @example
 * ```tsx
 * <FocusTrap active={isOpen} onEscape={onClose}>
 *   <dialog>
 *     <button>First focusable</button>
 *     <button>Last focusable</button>
 *   </dialog>
 * </FocusTrap>
 * ```
 */
export const FocusTrap: React.FC<FocusTrapProps> = ({
  active,
  children,
  onEscape,
  initialFocus,
  returnFocus = true,
  clickOutsideDeactivates = false,
  allowOutsideClick = true,
}) => {
  const getInitialFocus = (): string | HTMLElement | (() => HTMLElement | null) | false | undefined => {
    if (initialFocus === false) {
      return false;
    }
    if (typeof initialFocus === 'string') {
      return initialFocus;
    }
    if (initialFocus && 'current' in initialFocus) {
      return () => initialFocus.current;
    }
    return undefined;
  };

  return (
    <FocusTrapReact
      active={active}
      focusTrapOptions={{
        initialFocus: getInitialFocus(),
        returnFocusOnDeactivate: returnFocus,
        escapeDeactivates: onEscape ? () => {
          onEscape();
          return false; // Don't deactivate, let parent handle it
        } : true,
        clickOutsideDeactivates,
        allowOutsideClick,
        // Fallback to container if no focusable elements found
        fallbackFocus: () => {
          const container = document.querySelector('[data-focus-trap-fallback]');
          return (container as HTMLElement) || document.body;
        },
      }}
    >
      <div data-focus-trap-fallback tabIndex={-1}>
        {children}
      </div>
    </FocusTrapReact>
  );
};

export default FocusTrap;
