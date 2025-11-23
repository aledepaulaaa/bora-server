// boraapp-server/src/services/reminder.service.ts
import { getFirebaseFirestore } from '../database/firebase-admin'
import admin from 'firebase-admin'

// Instancia o banco de dados uma vez aqui
const db = getFirebaseFirestore()

/**
 * Atualiza o status de um lembrete para 'sent: true'.
 * @param reminderId O ID do lembrete a ser atualizado.
 */
export async function updateReminderSentStatus(reminderId: string): Promise<void> {
    try {
        const reminderRef = db.collection('reminders').doc(reminderId)
        await reminderRef.update({ sent: true })
        console.log(`   - ✅ Status do lembrete [${reminderId}] atualizado para 'sent'`)
    } catch (error) {
        console.error(`   - ❌ Erro ao atualizar status do lembrete [${reminderId}]:`, error)
    }
}

/**
 * Recalcula e atualiza a próxima data de agendamento de um lembrete recorrente.
 * @param reminderId O ID do lembrete.
 * @param recurrence A regra de recorrência ('Diariamente', 'Semanalmente', 'Mensalmente').
 * @param currentScheduledAt A data de agendamento atual.
 */
export async function updateNextRecurrence(
    reminderId: string,
    recurrence: string,
    currentScheduledAt: Date
): Promise<void> {
    try {
        const nextScheduledAt = new Date(currentScheduledAt)
        const now = new Date()

        while (nextScheduledAt <= now) {
            switch (recurrence) {
                case 'Diariamente':
                    nextScheduledAt.setDate(nextScheduledAt.getDate() + 1)
                    break
                case 'Semanalmente':
                    nextScheduledAt.setDate(nextScheduledAt.getDate() + 7)
                    break
                case 'Mensalmente':
                    nextScheduledAt.setMonth(nextScheduledAt.getMonth() + 1)
                    break
                default:
                    // Se a recorrência for desconhecida, apenas sai do loop para evitar travamento
                    // e joga 1 dia pra frente por segurança ou não faz nada.
                    console.warn(`Recorrência desconhecida: ${recurrence}`)
                    return
            }
        }

        const reminderRef = db.collection('reminders').doc(reminderId)
        await reminderRef.update({
            scheduledAt: admin.firestore.Timestamp.fromDate(nextScheduledAt),
            sent: false
        })

        console.log(`   - 🔄 Lembrete [${reminderId}] reagendado para ${nextScheduledAt.toLocaleString('pt-BR')} (Data Futura Garantida).`)

    } catch (error) {
        console.error(`   - ❌ Erro ao reagendar o lembrete [${reminderId}]:`, error)
    }
}