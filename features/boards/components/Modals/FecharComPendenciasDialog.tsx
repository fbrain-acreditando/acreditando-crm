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

        <AlertDialogFooter className="sm:justify-center gap-2 flex-col sm:flex-row">
          {/* O Cancel do Radix recebe foco por padrão — e aqui a opção mais
              segura é justamente voltar a editar, não fechar. */}
          <AlertDialogCancel onClick={onContinuarEditando}>Continuar editando</AlertDialogCancel>
          <button
            type="button"
            onClick={onDescartarEFechar}
            className="inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5 focus-visible-ring"
          >
            Descartar e fechar
          </button>
          <AlertDialogAction onClick={onSalvarEFechar}>Salvar e fechar</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
