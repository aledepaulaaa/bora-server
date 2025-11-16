//bora-server/src/services/jobHandlers.ts
import admin from 'firebase-admin'
import { getFirebaseFirestore } from '../database/firebase-admin'
import { IReminder } from '../interfaces/IReminder'
import { encontrarNumeroCelular, enviarMensagemWhatsApp } from './jobWhatsApp'
import { getUserSubscriptionPlan } from './subscription.service'
import { updateNextRecurrence, updateReminderSentStatus } from './reminder.service'

const db = getFirebaseFirestore()

// --- FUNÇÕES DE LÓGICA DOS JOBS ---
export async function acionarLembretesProximos() {
    console.log('Disparando verificação de lembretes próximos (aviso de 5 min)...')
    try {
        const nextAppUrl = process.env.NEXT_APP_URL
        const cronSecret = process.env.CRON_SECRET
        await fetch(`${nextAppUrl}/api/cron/notificar-proximos-lembretes?secret=${cronSecret}`, { method: 'POST' })
    } catch (error) {
        console.error('Erro de rede ao disparar o gatilho de avisos prévios:', error)
    }
}

// Copie e cole a função inteira para substituir a existente
export async function enviarLembretesPessoais() {
    console.log('--- ⏰ INICIANDO JOB: Verificando lembretes no horário (WhatsApp)... ---')
    const now = new Date()
    const nowTimestamp = admin.firestore.Timestamp.fromDate(now)

    // Log para verificar o tempo do servidor, crucial para depuração
    console.log(`   - Hora atual do servidor (UTC): ${now.toISOString()}`)

    // Query para lembretes únicos
    const snapshot = await db.collection('reminders')
        .where('recurrence', '==', 'Não repetir')
        .where('sent', '==', false)
        .where('scheduledAt', '<=', nowTimestamp)
        .get()

    // Query para lembretes recorrentes
    const recurringSnapshot = await db.collection('reminders')
        .where('recurrence', 'in', ['Diariamente', 'Semanalmente', 'Mensalmente'])
        .where('sent', '==', false)
        .where('scheduledAt', '<=', nowTimestamp)
        .get()

    if (snapshot.empty && recurringSnapshot.empty) {
        console.log(`⏰ Nenhum lembrete pendente encontrado. Verificação concluída.`)
        return
    }

    const allDocs = [...snapshot.docs, ...recurringSnapshot.docs]
    console.log(`⏰ Encontrados ${allDocs.length} lembretes pendentes. Processando...`)

    for (const doc of allDocs) {
        const reminder = doc.data() as IReminder
        const isRecurring = reminder.recurrence !== 'Não repetir'

        console.log(`\n--- Processando Lembrete ID: ${doc.id} | Recorrente: ${isRecurring} ---`)
        console.log(`   - Agendado para (UTC): ${reminder.scheduledAt.toDate().toISOString()}`)

        // Sua lógica de verificação de plano (continua correta)
        if (isRecurring) {
            const userPlan = await getUserSubscriptionPlan(reminder.userId)
            if (userPlan.plan === 'free') {
                console.log(`   - 🚫 Lembrete recorrente [${doc.id}] PULADO para usuário free.`)
                await updateReminderSentStatus(doc.id)
                continue
            }
        }

        // A lógica de enviar a mensagem continua a mesma
        const phoneNumber = await encontrarNumeroCelular(reminder.userId)
        if (phoneNumber) {
            const time = reminder.scheduledAt.toDate().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
            const message = `Bora veio te lembrar: "${reminder.title}" começa às ${time}!`
            await enviarMensagemWhatsApp(phoneNumber, message)
        } else {
            console.log(`   - ⚠️ Número NÃO encontrado para o usuário ${reminder.userId}.`)
        }

        // --- LÓGICA DE ATUALIZAÇÃO FINAL E CORRETA ---
        if (isRecurring) {
            // Se for recorrente, chama a função que atualiza a data E reseta o 'sent'
            await updateNextRecurrence(doc.id, reminder.recurrence!, reminder.scheduledAt.toDate())
        } else {
            // Se NÃO for recorrente, apenas marca como 'sent: true' para nunca mais ser enviado.
            await updateReminderSentStatus(doc.id)
        }
    }
}

export async function enviarListaDiaria() {
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

            const phoneNumber = await encontrarNumeroCelular(userId)
            if (phoneNumber) {
                await enviarMensagemWhatsApp(phoneNumber, message)
            }
        }
    }
}

export async function notificarUsuariosDoResetGratuito() {
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
            await enviarMensagemWhatsApp(phoneNumber, message)
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
