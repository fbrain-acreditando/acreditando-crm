'use client'

import { usePathname } from 'next/navigation'

import { QueryProvider } from '@/lib/query'
import RealtimeBridge from '@/components/RealtimeBridge'
import { ToastProvider } from '@/context/ToastContext'
import { ThemeProvider } from '@/context/ThemeContext'
import { AuthProvider } from '@/context/AuthContext'
import { AIProvider } from '@/context/AIContext'
import Layout from '@/components/Layout'
import { TooltipProvider } from '@/components/ui/tooltip'

export default function ProtectedShell({
    children,
}: {
    children: React.ReactNode
}) {
    const pathname = usePathname()
    const isSetupRoute = pathname === '/setup'
    const isLabsRoute = pathname === '/labs' || pathname.startsWith('/labs/')
    const shouldUseAppShell = !isSetupRoute && !isLabsRoute

    return (
        <QueryProvider>
            <ToastProvider>
                <ThemeProvider>
                    <AuthProvider>
                        {/* Realtime global: TODAS as telas recebem push ao vivo, não só board/inbox. */}
                        <RealtimeBridge />
                        <AIProvider>
                            <TooltipProvider delayDuration={200}>
                                {shouldUseAppShell ? <Layout>{children}</Layout> : children}
                            </TooltipProvider>
                        </AIProvider>
                    </AuthProvider>
                </ThemeProvider>
            </ToastProvider>
        </QueryProvider>
    )
}
