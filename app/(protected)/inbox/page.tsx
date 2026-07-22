import type { Metadata } from 'next';
import { InboxPage } from '@/features/inbox/InboxPage'

export const metadata: Metadata = { title: 'Inbox | Acreditando CRM' };

export default function Inbox() {
    return <InboxPage />
}
