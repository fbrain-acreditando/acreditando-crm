import type { Metadata } from 'next';
import SettingsPage from '@/features/settings/SettingsPage'

export const metadata: Metadata = { title: 'Configurações | Acreditando CRM' };

export default function Settings() {
    return <SettingsPage />
}
