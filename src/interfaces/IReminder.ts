//melembra-server/src/interfaces/IReminder.ts
import { Timestamp } from "firebase-admin/firestore"

export interface IReminder {
    id: string
    userId: string
    title: string
    type: 'personal' | 'tip' // Define o tipo do lembrete
    phoneNumber?: string // Opcional, para o WhatsApp
    scheduledAt: Timestamp
    sent?: boolean
    recurrence?: 'Não repetir' | 'Diariamente' | 'Semanalmente' | 'Mensalmente' | 'Anualmente'
}
