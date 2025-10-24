//melembra-server/src/services/jobHandlers.ts
import admin from 'firebase-admin'
import { Buttons } from 'whatsapp-web.js'
import { getFirebaseFirestore } from '../database/firebase-admin'
import { getClient } from './whatsappClient'
import { IReminder } from '../interfaces/IReminder'

const db = getFirebaseFirestore()

// --- FUNÇÕES DE LÓGICA DOS JOBS ---
export async function triggerUpcomingRemindersCheck() {
    console.log('Disparando verificação de lembretes próximos (aviso de 5 min)...')
    try {
        const nextAppUrl = process.env.NEXT_APP_URL
        const cronSecret = process.env.CRON_SECRET
        await fetch(`${nextAppUrl}/api/cron/notify-upcoming-reminders?secret=${cronSecret}`, { method: 'POST' })
    } catch (error) {
        console.error('Erro de rede ao disparar o gatilho de avisos prévios:', error)
    }
}

export async function sendPersonalReminders() {
    console.log('Verificando lembretes no horário (WhatsApp)...')
    const nowTimestamp = admin.firestore.Timestamp.now()
    const snapshot = await db.collection('reminders')
        .where('sent', '==', false)
        .where('scheduledAt', '<=', nowTimestamp)
        .get()

    if (snapshot.empty) return

    for (const doc of snapshot.docs) {
        const reminder = doc.data() as IReminder
        const phoneNumber = await findUserPhoneNumber(reminder.userId)

        if (phoneNumber) {
            const time = reminder.scheduledAt.toDate().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
            const message = `Melembra veio te lembrar: "${reminder.title}" começa às ${time}!`
            await sendWhatsappMessage(phoneNumber, message)
        }

        if (reminder.recurrence === 'Não repetir') {
            await doc.ref.update({ sent: true })
            console.log(`Lembrete ${doc.id} marcado como concluído.`)
            continue
        }

        const currentScheduledAt = reminder.scheduledAt.toDate()
        const nextScheduledAt = new Date(currentScheduledAt)

        switch (reminder.recurrence) {
            case 'Diariamente': nextScheduledAt.setDate(nextScheduledAt.getDate() + 1); break
            case 'Semanalmente': nextScheduledAt.setDate(nextScheduledAt.getDate() + 7); break
            case 'Mensalmente': nextScheduledAt.setMonth(nextScheduledAt.getMonth() + 1); break
            case 'Anualmente': nextScheduledAt.setFullYear(nextScheduledAt.getFullYear() + 1); break
        }
        await doc.ref.update({ scheduledAt: admin.firestore.Timestamp.fromDate(nextScheduledAt) })
        console.log(`Lembrete ${doc.id} reagendado para ${nextScheduledAt.toISOString()}.`)
    }
}

export async function sendDailyTips() {
    console.log('Verificando dicas para enviar...')
    const usersSnapshot = await db.collection('users').get()

    for (const userDoc of usersSnapshot.docs) {
        let tipMessage: string | null = null
        const hour = new Date().getHours()
        const name = userDoc.data()?.name?.split(' ')[0] || 'Ei'

        if (hour === 12) tipMessage = `Ei, ${name} hora do almoço! 🍽️ Quer criar um lembrete para não esquecer daquela pausa?`
        if (hour === 18) tipMessage = `Final do dia, ${name}! Que tal agendar os lembretes importantes de amanhã?`
        if (hour === 21) tipMessage = `Hora de relaxar, ${name}! 😴 Tem algo para anotar e não esquecer amanhã?`

        if (tipMessage) {
            const phoneNumber = await findUserPhoneNumber(userDoc.id)
            if (phoneNumber) {
                const buttons = new Buttons(tipMessage, [{ body: 'Criar Lembrete', id: 'create_reminder_tip' }], 'Dica do Me Lembra', 'Responda para agendar')
                await sendWhatsappMessage(phoneNumber, buttons)
            }
        }
    }
}

export async function sendDailyList() {
    console.log('Enviando lista de lembretes do dia...')
    const usersSnapshot = await db.collection('users').get()

    for (const userDoc of usersSnapshot.docs) {
        const userId = userDoc.id
        const today = new Date()
        const startOfDay = admin.firestore.Timestamp.fromDate(new Date(today.setHours(0, 0, 0, 0)))
        const endOfDay = admin.firestore.Timestamp.fromDate(new Date(today.setHours(23, 59, 59, 999)))

        const dailySnapshot = await db.collection('reminders')
            .where('userId', '==', userId)
            .where('scheduledAt', '>=', startOfDay)
            .where('scheduledAt', '<=', endOfDay)
            .get()

        if (!dailySnapshot.empty) {
            let message = `Bom dia, ${userDoc.data()?.name || 'pessoinha'}! Você tem ${dailySnapshot.size} lembretes para hoje:\n\n`
            dailySnapshot.docs.forEach((doc) => {
                const reminder = doc.data() as IReminder
                const time = reminder.scheduledAt.toDate().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                message += `- [${time}] ${reminder.title}\n`
            })
            message += '\nPara mais detalhes, acesse o app!'

            const phoneNumber = await findUserPhoneNumber(userId)
            if (phoneNumber) {
                await sendWhatsappMessage(phoneNumber, message)
            }
        }
    }
}

export async function notifyFreeUsersOfReset() {
    console.log('Verificando usuários gratuitos para notificar sobre o reset da cota...')
    const today = new Date()
    const yesterdayStart = admin.firestore.Timestamp.fromDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1))
    const yesterdayEnd = admin.firestore.Timestamp.fromDate(new Date(today.getFullYear(), today.getMonth(), today.getDate()))

    const usersWhoUsedQuota = await db.collection('users')
        .where('lastFreeReminderAt', '>=', yesterdayStart)
        .where('lastFreeReminderAt', '<', yesterdayEnd)
        .get()

    if (usersWhoUsedQuota.empty) return

    for (const userDoc of usersWhoUsedQuota.docs) {
        const userId = userDoc.id
        const subscriptionDoc = await db.collection('subscriptions').doc(userId).get()

        if (subscriptionDoc.exists && subscriptionDoc.data()?.status === 'active') continue

        const userName = userDoc.data()?.name?.split(' ')[0] || 'pessoinha'
        const message = `Oi, ${userName}! ✨ Seu lembrete diário gratuito no Me Lembra já está disponível novamente. Toque para criar!`

        const phoneNumber = userDoc.data()?.whatsappNumber
        if (phoneNumber) {
            await sendWhatsappMessage(phoneNumber, message)
        }

        try {
            const nextAppUrl = process.env.NEXT_APP_URL
            const cronSecret = process.env.CRON_SECRET
            await fetch(`${nextAppUrl}/api/cron/notify-free-users?secret=${cronSecret}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId }),
            })
        } catch (error) {
            console.error(`Erro ao disparar gatilho de push para o usuário ${userId}:`, error)
        }
    }
}


// --- FUNÇÕES AUXILIARES ---
async function findUserPhoneNumber(userId: string): Promise<string | undefined> {
    try {
        const userDoc = await db.collection('users').doc(userId).get()
        return userDoc.exists ? userDoc.data()?.whatsappNumber : undefined
    } catch (error) {
        console.error(`Erro ao buscar número de telefone para o usuário ${userId}:`, error)
        return undefined
    }
}

/**
 * Gera diferentes formatos de número de telefone para aumentar a chance de sucesso.
 */
function generateNumberVariants(number: string): string[] {
    const digits = number.replace(/\D/g, '')
    const variants = new Set<string>()

    // 1. Número como está (sem 55)
    if (digits.length >= 10 && digits.length <= 11) {
        variants.add(digits)
    }
    // 2. Número com 55
    if (digits.length >= 10 && digits.length <= 11) {
        variants.add(`55${digits}`)
    }
    // 3. Se o número original já tinha 55, tenta sem ele
    if (digits.startsWith('55') && digits.length > 11) {
        variants.add(digits.substring(2))
    }

    return Array.from(variants)
}

export async function sendWhatsappMessage(number: string, message: string | Buttons) {
    const client = getClient()
    if (!client || (await client.getState()) !== 'CONNECTED') {
        console.warn("Cliente não está conectado. Mensagem não enviada.")
        return { success: false, error: 'Cliente WhatsApp não conectado.' }
    }

    // --- NOVA LÓGICA DE TENTATIVAS ---
    const variants = generateNumberVariants(number)
    if (variants.length === 0) {
        console.error(`Número inválido fornecido: ${number}`)
        return { success: false, error: 'Número de telefone inválido.' }
    }

    console.log(`Tentando enviar para ${number}, variantes: [${variants.join(', ')}]`)

    for (const variant of variants) {
        try {
            const chatId = `${variant}@c.us`
            // Tenta verificar se o chat existe antes de enviar
            const isRegistered = await client.isRegisteredUser(chatId)
            if (isRegistered) {
                await client.sendMessage(chatId, message)
                console.log(`✅ Mensagem enviada com sucesso para a variante ${variant}`)
                return { success: true }
            }
        } catch (error) {
            console.warn(`Falha ao enviar para a variante ${variant}:`, error)
            // Continua para a próxima variante
        }
    }

    // Se o loop terminar sem sucesso
    console.error(`Falha ao enviar mensagem para todas as variantes do número ${number}`)
    return { success: false, error: 'Falha ao enviar mensagem para todas as variantes testadas.' }
}