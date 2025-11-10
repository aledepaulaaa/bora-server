//bora-server/src/services/jobHandlers.ts
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
    console.log('--- ⏰ INICIANDO JOB: Verificando lembretes no horário (WhatsApp)... ---')
    const now = new Date()
    const nowTimestamp = admin.firestore.Timestamp.fromDate(now)

    // --- LOGS DE DEPURAÇÃO DE TEMPO ---
    console.log(`   - Hora atual do servidor (ISO/UTC): ${now.toISOString()}`)
    console.log(`   - Timestamp usado na query: ${nowTimestamp.toDate().toISOString()}`)

    const snapshot = await db.collection('reminders')
        .where('recurrence', '==', 'Não repetir')
        .where('sent', '==', false)
        .where('scheduledAt', '<=', nowTimestamp)
        .get()

    const recurringSnapshot = await db.collection('reminders')
        .where('recurrence', 'in', ['Diariamente', 'Semanalmente', 'Mensalmente', 'Anualmente'])
        .where('scheduledAt', '<=', nowTimestamp)
        .get()

    if (snapshot.empty && recurringSnapshot.empty) {
        console.log(`⏰ Nenhum lembrete encontrado para antes de ${now.toLocaleTimeString('pt-BR')}. Verificação concluída.`)
        return
    }

    const allDocs = [...snapshot.docs, ...recurringSnapshot.docs]
    console.log(`⏰ Encontrados ${allDocs.length} lembretes pendentes. Processando...`)

    for (const doc of allDocs) {
        const reminder = doc.data() as IReminder
        const scheduledAtDate = reminder.scheduledAt.toDate()

        console.log(`\n--- Processando Lembrete ID: ${doc.id} ---`)
        console.log(`   - Horário agendado (ISO/UTC): ${scheduledAtDate.toISOString()}`)
        console.log(`   - Título: "${reminder.title}"`)
        console.log(`   - Para Usuário ID: ${reminder.userId}`)

        // --- LOG DETALHADO DA BUSCA DO NÚMERO ---
        const phoneNumber = await findUserPhoneNumber(reminder.userId)

        if (phoneNumber) {
            console.log(`   - ✅ Número de telefone encontrado: ${phoneNumber}`)
            const time = reminder.scheduledAt.toDate().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
            const message = `Melembra veio te lembrar: "${reminder.title}" começa às ${time}!`

            console.log(`   - 💬 Preparando para enviar a mensagem: "${message}"`)
            await sendWhatsappMessage(phoneNumber, message)
        } else {
            console.log(`   - ⚠️ Número de telefone NÃO encontrado para o usuário ${reminder.userId}. Lembrete não pode ser enviado.`)
        }
        // --- FIM DO LOG DETALHADO ---

        const recurrence = reminder.recurrence || 'Não repetir'
        if (recurrence === 'Não repetir') {
            await doc.ref.update({ sent: true })
            console.log(`   - 🏁 Lembrete ${doc.id} marcado como concluído.`)
        } else {
            const currentScheduledAt = reminder.scheduledAt.toDate()
            const nextScheduledAt = new Date(currentScheduledAt)

            switch (recurrence) {
                case 'Diariamente': nextScheduledAt.setDate(nextScheduledAt.getDate() + 1); break
                case 'Semanalmente': nextScheduledAt.setDate(nextScheduledAt.getDate() + 7); break
                case 'Mensalmente': nextScheduledAt.setMonth(nextScheduledAt.getMonth() + 1); break
                case 'Anualmente': nextScheduledAt.setFullYear(nextScheduledAt.getFullYear() + 1); break
            }

            await doc.ref.update({ scheduledAt: admin.firestore.Timestamp.fromDate(nextScheduledAt) })
            console.log(`   - 🔄 Lembrete ${doc.id} reagendado para ${nextScheduledAt.toISOString()}.`)
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
        console.warn("Cliente não está conectado. Mensagem não enviada.")
        return { success: false, error: 'Cliente WhatsApp não conectado.' }
    }

    // --- LÓGICA DE FORMATAÇÃO E ENVIO PARA MÚLTIPLOS ALVOS ---

    let cleanNumber = number.replace(/\D/g, '')
    if (cleanNumber.startsWith('55')) cleanNumber = cleanNumber.substring(2)
    if (cleanNumber.startsWith('0')) cleanNumber = cleanNumber.substring(1)

    if (cleanNumber.length < 10 || cleanNumber.length > 11) {
        console.error(`❌ Número em formato irreconhecível: ${number}`)
        return { success: false, error: 'Número em formato inválido.' }
    }

    const ddd = cleanNumber.slice(0, 2)
    const baseNumber = cleanNumber.slice(2)

    const numberWith9 = `55${ddd}${baseNumber.length === 8 ? '9' + baseNumber : baseNumber}@c.us`
    const numberWithout9 = `55${ddd}${baseNumber.length === 9 ? baseNumber.slice(1) : baseNumber}@c.us`

    const targets: string[] = []
    console.log(`🔎 Investigando número: ${number}. Variações: ${numberWith9}, ${numberWithout9}`)

    const [isRegisteredWith9, isRegisteredWithout9] = await Promise.all([
        client.isRegisteredUser(numberWith9),
        client.isRegisteredUser(numberWithout9)
    ]);

    if (isRegisteredWith9) targets.push(numberWith9)
    if (isRegisteredWithout9) targets.push(numberWithout9)

    if (targets.length === 0) {
        console.error(`❌ Nenhuma variação válida encontrada para o número ${number}.`)
        return { success: false, error: 'O número fornecido não parece ter WhatsApp.' }
    }

    console.log(`🎯 Alvos válidos encontrados: ${targets.join(', ')}. Disparando mensagens...`)

    let wasSuccessful = false
    // Usamos Promise.allSettled para tentar enviar para todos, mesmo que um falhe.
    const sendPromises = targets.map(target =>
        client.sendMessage(target, message)
            .then(() => {
                console.log(`✅ Mensagem enviada com sucesso para o alvo: ${target}`)
                wasSuccessful = true
            })
            .catch(err => {
                console.error(`❌ Falha ao enviar para o alvo: ${target}`, err.message)
            })
    )

    await Promise.allSettled(sendPromises)

    if (wasSuccessful) {
        return { success: true }
    } else {
        console.error(`❌ Falha total ao enviar mensagem para ${number} após encontrar alvos válidos.`)
        return { success: false, error: 'Falha no envio final, mesmo após encontrar números válidos.' }
    }
}