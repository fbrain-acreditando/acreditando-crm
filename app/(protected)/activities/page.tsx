import type { Metadata } from 'next';
import { ActivitiesPage } from '@/features/activities/ActivitiesPage'

export const metadata: Metadata = { title: 'Atividades | Acreditando CRM' };

export default function Activities() {
    return <ActivitiesPage />
}
