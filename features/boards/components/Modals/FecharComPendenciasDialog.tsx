'use client';

/**
 * Aviso de "você tem alterações não salvas" — story 2.27.
 *
 * Pedido da Fernanda junto com o botão Salvar: *"se puder dar um aviso quando
 * fechar e não tiver salvo alguma coisa, seria interessante também"*.
 *
 * Por que não reusar o `ConfirmDialog`: ele é de duas saídas (confirmar /
 * cancelar), e aqui a decisão é genuinamente de **três** — salvar, descartar,
 * ou voltar a editar. Espremer isso em duas obrigaria a fechar o aviso, clicar
 * em Descartar na barra e fechar de novo. O rótulo de cada botão diz o que ele
 * FAZ ("Salvar e fechar"), não uma resposta abstrata a uma pergunta.
 */
import * as React from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface FecharComPendenciasDialogProps {
  isOpen: boolean;
  /** Quantidade de campos alterados — a mensagem diz o tamanho do que se perde. */
  quantidade: number;
  onSalvarEFechar: () => void;
  onDescartarEFechar: () => void;
  onContinuarEditando: () => void;
}

export function FecharComPendenciasDialog({
  isOpen,
  quantidade,
  onSalvarEFechar,
  onDescartarEFechar,
  onContinuarEditando,
}: FecharComPendenciasDialogProps) {
  return (
    <AlertDialog open={isOpen} onOpenChange={open => !open && onContinuarEditando()}>
      <AlertDialogContent className="max-w-sm">
        <AlertDialogHeader className="items-center text-center sm:text-center">
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center mb-2 bg-amber-100 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400"
            aria-hidden="true"
          >
            <AlertTriangle size={24} />
          </div>
          <AlertDialogTitle className="font-display">Você não salvou</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>
              {quantidade === 1
                ? 'Tem 1 campo alterado que ainda não foi salvo.'
                : `Tem ${quantidade} campos alterados que ainda não foram salvos.`}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        {/* EMPILHADO, também no desktop — e é decisão, não descuido.
            Três rótulos em pt-BR ("Continuar editando", "Descartar e fechar",
            "Salvar e fechar") somam ~446 px de botão; o diálogo tem ~336 px
            úteis. Em linha, ou estoura ou algum rótulo quebra — foi exatamente
            o que apareceu na tela. Empilhado não depende da largura nem do
            tamanho da tradução.

            `flex-col` (não `col-reverse`): assim a ordem do DOM é a ordem que
            se lê, e o leitor de tela ouve na mesma sequência que o olho vê.
            `sm:space-x-0` porque o footer padrão traz `sm:space-x-2` e somar com
            `gap-2` espaçaria em dobro. */}
        <AlertDialogFooter className="flex-col sm:flex-col gap-2 sm:space-x-0 [&>*]:w-full">
          <AlertDialogAction onClick={onSalvarEFechar}>Salvar e fechar</AlertDialogAction>

          {/* ⚠️ Este botão JÁ FOI um `<button>` cru com `px-4 py-2` na mão — e por
              isso ficava sem o `h-10` e sem o `whitespace-nowrap` que o
              `buttonVariants` dá aos outros dois: o rótulo quebrava em duas
              linhas e o botão crescia, desalinhando a fileira inteira.
              Botão dentro de um AlertDialog usa a MESMA fábrica de estilo dos
              irmãos, senão a geometria diverge em silêncio. */}
          <button
            type="button"
            onClick={onDescartarEFechar}
            className={cn(
              buttonVariants({ variant: 'outline' }),
              // Descartar é a ação que joga trabalho fora: precisa se distinguir
              // do "Continuar editando" sem virar um segundo botão primário.
              'text-red-600 hover:text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20'
            )}
          >
            Descartar e fechar
          </button>

          {/* O Cancel do Radix recebe foco por padrão — e aqui a opção mais
              segura é justamente voltar a editar, não fechar. Por último na
              ordem visual, porque é a saída, não a decisão.

              ⚠️ SEM `onClick` de propósito: o Cancel já fecha pelo Radix, e o
              fechamento cai no `onOpenChange` acima, que é quem chama
              `onContinuarEditando`. Ter os dois fazia o handler disparar DUAS
              vezes por clique — inofensivo hoje (só zera um booleano), mas é a
              armadilha que espera alguém pôr algo não-idempotente ali. */}
          <AlertDialogCancel className="mt-0">Continuar editando</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
