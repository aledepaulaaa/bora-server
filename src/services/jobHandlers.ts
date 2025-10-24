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
        await fetch(`${nextAppUrl}/api/cron/notificar-proximos-lembretes?secret=${cronSecret}`, { method: 'POST' })
    } catch (error) {
        console.error('Erro de rede ao disparar o gatilho de avisos prévios:', error)
    }
}

export async function sendPersonalReminders() {
    console.log('Verificando lembretes no horário (WhatsApp)...')
    const nowTimestamp = admin.firestore.Timestamp.now()

    const snapshot = await db.collection('reminders')
        // CORREÇÃO SUTIL: Pega apenas lembretes que não são recorrentes E marcados como não enviados.
        // Lembretes recorrentes não usarão mais o campo 'sent'.
        .where('recurrence', '==', 'Não repetir')
        .where('sent', '==', false)
        .where('scheduledAt', '<=', nowTimestamp)
        .get()

    // Query separada para recorrentes, para simplificar a lógica
    const recurringSnapshot = await db.collection('reminders')
        .where('recurrence', 'in', ['Diariamente', 'Semanalmente', 'Mensalmente', 'Anualmente'])
        .where('scheduledAt', '<=', nowTimestamp)
        .get()

    if (snapshot.empty && recurringSnapshot.empty) {
        console.log('Nenhum lembrete para enviar no horário exato.')
        return
    }

    const allDocs = [...snapshot.docs, ...recurringSnapshot.docs]
    console.log(`Encontrados ${allDocs.length} lembretes para processar.`)

    for (const doc of allDocs) {
        const reminder = doc.data() as IReminder
        const phoneNumber = await findUserPhoneNumber(reminder.userId)

        if (phoneNumber) {
            const time = reminder.scheduledAt.toDate().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
            const message = `Melembra veio te lembrar: "${reminder.title}" começa às ${time}!`
            await sendWhatsappMessage(phoneNumber, message)
        }

        // --- LÓGICA DE ATUALIZAÇÃO REESTRUTURADA (A CORREÇÃO PRINCIPAL) ---
        const recurrence = reminder.recurrence || 'Não repetir'

        if (recurrence === 'Não repetir') {
            // Se não for recorrente, APENAS marca como enviado.
            await doc.ref.update({ sent: true })
            console.log(`Lembrete ${doc.id} marcado como concluído.`)
        } else {
            // Se for recorrente, APENAS reagenda para a próxima data.
            const currentScheduledAt = reminder.scheduledAt.toDate()
            const nextScheduledAt = new Date(currentScheduledAt)

            switch (recurrence) {
                case 'Diariamente': nextScheduledAt.setDate(nextScheduledAt.getDate() + 1); break
                case 'Semanalmente': nextScheduledAt.setDate(nextScheduledAt.getDate() + 7); break
                case 'Mensalmente': nextScheduledAt.setMonth(nextScheduledAt.getMonth() + 1); break
                case 'Anualmente': nextScheduledAt.setFullYear(nextScheduledAt.getFullYear() + 1); break
            }

            await doc.ref.update({ scheduledAt: admin.firestore.Timestamp.fromDate(nextScheduledAt) })
            console.log(`Lembrete ${doc.id} reagendado para ${nextScheduledAt.toISOString()}.`)
        }
    }
}

export async function sendDailyTips() {
    console.log('Verificando dicas para enviar...')
    const usersSnapshot = await db.collection('users').get()

    for (const userDoc of usersSnapshot.docs) {
        let tipMessage: string | null = null
        const hour = new Date().getHours()
        const name = userDoc.data()?.name?.split(' ')[0] || 'Ei'

        if (hour === 8) tipMessage = `Bom dia, ${name} ☀️ Bora começar o dia criando seus lembretes importantes?`
        if (hour === 12) tipMessage = `Ei, ${name} hora do almoço! 🍽️ Quer criar um lembrete para não esquecer daquela pausa?`
        if (hour === 16) tipMessage = `Boa tarde, ${name} hora do café da tarde! ☕ Quer criar um lembrete enquanto faz aquela pausa?`
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
    console.log('--- 🔄 EXECUTANDO JOB DE NOTIFICAÇÃO DE RESET DE COTA ---')

    // Pega o timestamp de 24 horas atrás
    const twentyFourHoursAgo = admin.firestore.Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000)

    // Query: Pega usuários que usaram a cota há mais de 24h E que ainda não foram notificados.
    const usersToNotify = await db.collection('users')
        .where('lastFreeReminderAt', '<=', twentyFourHoursAgo)
        .where('resetNotificationSent', '!=', true) // Chave da lógica!
        .get()

    if (usersToNotify.empty) {
        console.log('🔄 Nenhum usuário para notificar sobre o reset agora.')
        return
    }

    console.log(`🔄 Encontrados ${usersToNotify.docs.length} usuários para notificar sobre o reset.`)

    for (const userDoc of usersToNotify.docs) {
        const userId = userDoc.id
        const subscriptionDoc = await db.collection('subscriptions').doc(userId).get()

        if (subscriptionDoc.exists && subscriptionDoc.data()?.status === 'active') {
            // Se o usuário virou Plus, apenas marca como notificado para não verificar de novo.
            await userDoc.ref.update({ resetNotificationSent: true })
            continue
        }

        const userName = userDoc.data()?.name?.split(' ')[0] || 'pessoinha'
        const message = `Oi, ${userName}! ✨ Seu lembrete diário gratuito no Me Lembra já está disponível novamente. Vamos criar um?`

        // Envia notificação por WhatsApp
        const phoneNumber = userDoc.data()?.whatsappNumber
        if (phoneNumber) {
            await sendWhatsappMessage(phoneNumber, message)
        }

        // Dispara a notificação Push via API do Next.js
        try {
            const nextAppUrl = process.env.NEXT_APP_URL
            const cronSecret = process.env.CRON_SECRET
            await fetch(`${nextAppUrl}/api/cron/notificar-usuarios-gratuitos?secret=${cronSecret}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId }),
            })
            console.log(`🔄 Gatilho de push de reset enviado para ${userId}`)
        } catch (error) {
            console.error(`❌ Erro ao disparar gatilho de push para ${userId}:`, error)
        }

        // Marca o usuário como notificado para não enviar de novo até o próximo uso.
        await userDoc.ref.update({ resetNotificationSent: true })
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

export async function sendWhatsappMessage(number: string, message: string | Buttons) {
    const client = getClient()
    if (!client || (await client.getState()) !== 'CONNECTED') {
        console.warn("Cliente não conectado. Mensagem não enviada.")
        return { success: false, error: 'Cliente WhatsApp não conectado.' }
    }

    // 1. Limpa tudo que não for dígito.
    const cleanNumber = number.replace(/\D/g, '')

    // 2. Extrai DDD e número base usando Regex, de forma muito mais robusta.
    // Isso captura (DDD de 2 dígitos) + (Número de 8 ou 9 dígitos) do final da string.
    const match = cleanNumber.match(/(\d{2})(\d{8,9})$/)
    if (!match) {
        console.error(`Número em formato irreconhecível: ${number}`)
        return { success: false, error: 'Número em formato irreconhecível.' }
    }
    const [, ddd, baseNumber] = match

    // 3. Monta as variações com o código do país.
    const numberWith9 = `55${ddd}${baseNumber.length === 9 ? baseNumber : `9${baseNumber}`}@c.us`
    const numberWithout9 = `55${ddd}${baseNumber.length === 8 ? baseNumber : baseNumber.slice(1)}@c.us`

    // Tenta enviar para a primeira variação (a mais provável)
    try {
        console.log(`Tentando enviar para ${numberWith9}...`)
        await client.sendMessage(numberWith9, message)
        console.log(`✅ Mensagem enviada para ${number} (usando variação 1).`)
        return { success: true }
    } catch (error: any) {
        console.warn(`⚠️ Falha na 1ª tentativa para ${numberWith9}. Tentando variação 2...`)

        // Se a primeira falhar, tenta a segunda
        try {
            await client.sendMessage(numberWithout9, message)
            console.log(`✅ Mensagem enviada para ${number} (usando variação 2).`)
            return { success: true }
        } catch (secondError: any) {
            console.error(`❌ Erro final ao enviar para ${number} após duas tentativas.`, secondError.message)
            return { success: false, error: 'Número de WhatsApp inválido após duas tentativas.' }
        }
    }
}