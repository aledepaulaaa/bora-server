//melembra-server/src/services/whatsapp.service.ts
import fs from 'fs'
import * as chrono from 'chrono-node'
import { Buttons, Client, LocalAuth, Message } from 'whatsapp-web.js'
import qrcode from 'qrcode-terminal'
import cron, { ScheduledTask } from 'node-cron'
import admin from 'firebase-admin'
import { getFirebaseFirestore } from '../database/firebase-admin'
import { IReminder } from '../interfaces/IReminder'

// Connect to Firestore using the function from your new module
const db = getFirebaseFirestore()

let client: Client

/**
 * Cria, configura e anexa todos os listeners a uma nova instância do cliente.
 */
function createAndConfigureClient() {
    console.log("Iniciando nova instância do cliente WhatsApp...")
    client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: {
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        }
    })

    client.on('qr', (qr) => {
        console.log('Escaneie o QR Code abaixo com seu celular:')
        qrcode.generate(qr, { small: true })
    })

    client.on('ready', () => {
        console.log('✅ Cliente WhatsApp está pronto!')
        startCronJobs()
    })

    client.on('authenticated', () => console.log('✅ Autenticado com sucesso!'))
    client.on('auth_failure', (msg) => console.error('❌ Falha na autenticação:', msg))
    client.on('error', (err) => console.error('Ocorreu um erro inesperado no cliente:', err))

    client.on('disconnected', async (reason) => {
        console.log('Cliente desconectado:', reason)
        stopCronJobs()

        try {
            await client.destroy()
            console.log("Instância do cliente destruída.")
            const sessionPath = './.wwebjs_auth'
            if (fs.existsSync(sessionPath)) {
                await fs.promises.rm(sessionPath, { recursive: true, force: true })
                console.log("Sessão limpa com sucesso.")
            }
        } catch (error) {
            console.error("Erro ao limpar e destruir o cliente:", error)
        } finally {
            console.log("Reiniciando o processo de conexão em 10 segundos...")
            setTimeout(createAndInitialize, 10000)
        }
    })

    // --- CÉREBRO DO BOT: Listener para mensagens recebidas ---
    client.on('message', handleIncomingMessage)
}


/**
 * Chama a criação do cliente e inicia o processo de conexão.
 */
function createAndInitialize() {
    createAndConfigureClient()
    client.initialize().catch(err => {
        console.error("Falha crítica ao inicializar o cliente. O processo será encerrado.", err)
        process.exit(1) // Encerra se a inicialização falhar de forma irrecuperável
    })
}

// Inicia o fluxo pela primeira vez quando o servidor é ligado
createAndInitialize()

// --- GERENCIAMENTO DE TAREFAS AGENDADAS (CRON JOBS) ---
const scheduledTasks: ScheduledTask[] = []

function startCronJobs() {
    stopCronJobs() // Garante que não haja tarefas duplicadas rodando
    console.log('Agendando cron jobs...')

    scheduledTasks.push(cron.schedule('*/5 * * * *', sendPersonalReminders))
    scheduledTasks.push(cron.schedule('0 12,18,21 * * *', sendDailyTips))
    scheduledTasks.push(cron.schedule('0 8 * * *', sendDailyList))

    console.log('✅ Cron jobs agendados com sucesso!')
}

function stopCronJobs() {
    if (scheduledTasks.length > 0) {
        console.log('Parando cron jobs agendados...')
        scheduledTasks.forEach(task => task.stop())
        scheduledTasks.length = 0 // Limpa o array
    }
}

// --- LÓGICA DO BOT INTERATIVO ---

async function handleIncomingMessage(message: Message) {
    const chatId = message.from
    const conversationRef = db.collection('whatsapp_conversations').doc(chatId)
    const conversationDoc = await conversationRef.get()

    // Lida com cliques em botões
    if (message.type === 'buttons_response' && message.selectedButtonId === 'create_reminder_tip') {
        await startReminderFlow(chatId)
        return
    }

    // Se não há uma conversa ativa, ignora a mensagem
    if (!conversationDoc.exists) return

    const state = conversationDoc.data()
    if (!state) return

    switch (state.step) {
        case 'awaiting_title':
            await handleTitleResponse(message, conversationRef, state.userId)
            break
        case 'awaiting_datetime':
            await handleDateTimeResponse(message, conversationRef, state.userId)
            break
    }
}

async function startReminderFlow(chatId: string) {
    const number = chatId.split('@')[0]
    const usersQuery = await db.collection('users').where('whatsappNumber', '==', number).limit(1).get()

    if (usersQuery.empty) {
        client.sendMessage(chatId, "Desculpe, não encontrei sua conta Me Lembra. Verifique se o número de WhatsApp cadastrado no app está correto.")
        return
    }
    const userId = usersQuery.docs[0].id

    await db.collection('whatsapp_conversations').doc(chatId).set({
        step: 'awaiting_title',
        userId: userId,
        reminderData: {},
    })

    client.sendMessage(chatId, 'Ótimo! Qual o título do seu lembrete?')
}

async function handleTitleResponse(message: Message, conversationRef: admin.firestore.DocumentReference, userId: string) {
    const title = message.body
    await conversationRef.update({
        'reminderData.title': title,
        step: 'awaiting_datetime',
    })
    client.sendMessage(message.from, `Entendido. E para quando é o lembrete "${title}"? (ex: amanhã às 15h, 25/12 18:00)`)
}

async function handleDateTimeResponse(message: Message, conversationRef: admin.firestore.DocumentReference, userId: string) {
    const dateTimeString = message.body
    const parsedDate = chrono.pt.parseDate(dateTimeString, new Date(), { forwardDate: true })

    if (!parsedDate) {
        client.sendMessage(message.from, 'Hum, não consegui entender essa data. 🤔 Tente um formato como "amanhã às 10:30" ou "25 de Dezembro às 20h".')
        return
    }

    const conversationDoc = await conversationRef.get()
    const reminderData = conversationDoc.data()?.reminderData

    try {
        await db.collection('reminders').add({
            title: reminderData.title,
            scheduledAt: admin.firestore.Timestamp.fromDate(parsedDate),
            userId: userId,
            createdAt: admin.firestore.Timestamp.now(),
            sent: false,
            recurrence: 'Não repetir',
        })

        await conversationRef.delete()

        const successMessage = `Lembrete salvo com sucesso para ${parsedDate.toLocaleString('pt-BR')}! ✨\n\nPara criar lembretes com recorrência (diários, semanais, etc.), abra o app Me Lembra e personalize do seu jeito! 😉\n\nhttps://melembra.vercel.app/`
        client.sendMessage(message.from, successMessage)
    } catch (error) {
        console.error("Erro ao salvar lembrete via WhatsApp:", error)
        client.sendMessage(message.from, "Ocorreu um erro ao salvar seu lembrete. Por favor, tente novamente mais tarde.")
    }
}


async function findUserPhoneNumber(userId: string): Promise<string | undefined> {
    try {
        const userDocRef = db.collection('users').doc(userId)
        const userDoc = await userDocRef.get()

        if (!userDoc.exists) {
            console.log(`Usuário ${userId} não encontrado na coleção 'users'.`)
            return undefined
        }

        return userDoc.data()?.whatsappNumber
    } catch (error) {
        console.error(`Erro ao buscar número de telefone para o usuário ${userId}:`, error)
        return undefined
    }
}

// 1. Cron job for personal reminders
async function sendPersonalReminders() {
    console.log('Verificando lembretes pessoais...')
    const now = new Date()
    // Buscamos lembretes até a hora atual para não perder nenhum
    const nowTimestamp = admin.firestore.Timestamp.fromDate(now)

    const snapshot = await db.collection('reminders')
        .where('sent', '==', false)
        .where('scheduledAt', '<=', nowTimestamp)
        .get()

    if (snapshot.empty) {
        console.log('Nenhum lembrete pessoal para enviar neste momento.')
        return
    }

    console.log(`Encontrados ${snapshot.docs.length} lembretes para processar.`)

    for (const doc of snapshot.docs) {
        const reminder = doc.data() as IReminder
        const phoneNumber = await findUserPhoneNumber(reminder.userId)

        if (phoneNumber) {
            const time = reminder.scheduledAt.toDate().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
            const message = `Melembra veio te lembrar: "${reminder.title}" começa às ${time}!`

            await sendWhatsappMessage(phoneNumber, message)
        }

        // --- LÓGICA DE RECORRÊNCIA ---
        const recurrence = reminder.recurrence || 'Não repetir'

        // Se não for recorrente, apenas marca como enviado e continua
        if (recurrence === 'Não repetir') {
            await doc.ref.update({ sent: true })
            console.log(`Lembrete ${doc.id} marcado como concluído.`)
            continue // Pula para o próximo lembrete
        }

        let nextScheduledAt: Date | null = null
        const currentScheduledAt = reminder.scheduledAt.toDate()
        nextScheduledAt = new Date(currentScheduledAt) // Cria uma nova instância

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
            case 'Anualmente':
                nextScheduledAt.setFullYear(nextScheduledAt.getFullYear() + 1)
                break
        }

        // Atualiza o lembrete com a nova data e mantém 'sent' como false
        if (nextScheduledAt) {
            await doc.ref.update({
                scheduledAt: admin.firestore.Timestamp.fromDate(nextScheduledAt)
            })
            console.log(`Lembrete ${doc.id} reagendado para ${nextScheduledAt.toISOString()}.`)
        }
    }
}

// 2. Cron job for tips
// async function sendDailyTips() {
//     console.log('Checking for tips to send...')
//     const usersRef = db.collection('users')
//     const usersSnapshot = await usersRef.get()

//     usersSnapshot.forEach(async (userDoc) => {
//         const userId = userDoc.id
//         const userPreferencesRef = db.collection('preferences').doc(userId)
//         const userPreferences = (await userPreferencesRef.get()).data()

//         if (userPreferences?.enableTips !== false) {
//             let tipMessage = ''
//             const hour = new Date().getHours()

//             if (hour === 12) {
//                 tipMessage = 'Ei, hora do almoço! 🍽️ Quer criar um lembrete para isso?'
//             } else if (hour === 18) {
//                 const weekday = new Date().toLocaleDateString('pt-BR', { weekday: 'long' })
//                 tipMessage = `Boa noite! ${weekday}, que tal criar alguns lembretes para a semana?`
//             } else if (hour === 21) {
//                 tipMessage = `${userDoc.data()?.name || 'Ei'}, hora de dormir! 😴 algo importante para anotar e não esquecer depois?`
//             }

//             if (tipMessage) {
//                 const phoneNumber = await findUserPhoneNumber(userId)
//                 if (phoneNumber) {
//                     await sendWhatsappMessage(phoneNumber, tipMessage)
//                 }
//             }
//         }
//     })
// }
async function sendDailyTips() {
    console.log('Verificando dicas para enviar...')
    const usersSnapshot = await db.collection('users').get()

    for (const userDoc of usersSnapshot.docs) {
        const userId = userDoc.id
        const userPreferences = (await db.collection('preferences').doc(userId).get()).data()

        if (userPreferences?.enableTips !== false) {
            let tipMessage: string | null = null
            const hour = new Date().getHours()
            const name = userDoc.data()?.name?.split(' ')[0] || 'Ei'

            if (hour === 12) tipMessage = 'Ei, hora do almoço! 🍽️ Quer criar um lembrete para não esquecer daquela pausa?'
            if (hour === 18) tipMessage = `Final do dia, ${name}! Que tal agendar os lembretes importantes de amanhã?`
            if (hour === 21) tipMessage = `Hora de relaxar, ${name}! 😴 Tem algo para anotar e não esquecer amanhã?`

            if (tipMessage) {
                const phoneNumber = await findUserPhoneNumber(userId)
                if (phoneNumber) {
                    const buttons = new Buttons(tipMessage, [{ body: 'Criar Lembrete', id: 'create_reminder_tip' }], 'Dica do Me Lembra', 'Responda para agendar')
                    await sendWhatsappMessage(phoneNumber, buttons)
                }
            }
        }
    }
}

// 3. Cron job for daily list
async function sendDailyList() {
    console.log('Sending daily reminder list...')
    const usersRef = db.collection('users')
    const usersSnapshot = await usersRef.get()

    usersSnapshot.forEach(async (userDoc) => {
        const userId = userDoc.id
        const remindersRef = db.collection('reminders')
        const today = new Date()
        const startOfDay = admin.firestore.Timestamp.fromDate(new Date(today.getFullYear(), today.getMonth(), today.getDate()))
        const endOfDay = admin.firestore.Timestamp.fromDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1))

        const dailyRemindersSnapshot = await remindersRef
            .where('userId', '==', userId)
            .where('scheduledAt', '>=', startOfDay)
            .where('scheduledAt', '<', endOfDay)
            .get()

        if (!dailyRemindersSnapshot.empty) {
            let message = `Bom dia, ${userDoc.data()?.name || 'amigo'}! Você tem ${dailyRemindersSnapshot.size} lembretes para hoje:\n\n`
            dailyRemindersSnapshot.forEach((doc) => {
                const reminder = doc.data() as IReminder
                const time = reminder.scheduledAt.toDate().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                message += `- [${time}] ${reminder.title}\n`
            })
            message += '\nPara mais detalhes, visite: http://melembra.vercel.app/lembretes'

            const phoneNumber = await findUserPhoneNumber(userId)
            if (phoneNumber) {
                await sendWhatsappMessage(phoneNumber, message)
            }
        }
    })
}

export async function sendWhatsappMessage(number: string, message: string | Buttons) {
    // Verificação de segurança para garantir que o cliente está pronto
    if (!client || (await client.getState()) !== 'CONNECTED') {
        console.warn("Cliente não está conectado. A mensagem não foi enviada.")
        return { success: false, error: 'Cliente WhatsApp não conectado.' }
    }

    const sanitizedNumber = number.replace(/\D/g, '')
    const finalNumber = `55${sanitizedNumber}@c.us`

    try {
        await client.sendMessage(finalNumber, message)
        console.log(`Mensagem enviada para ${number}`)
        return { success: true }
    } catch (error) {
        console.error(`Erro ao enviar mensagem para ${number}:`, error)
        return { success: false, error: 'Falha ao enviar mensagem.' }
    }
}

async function notifyFreeUsersOfReset() {
    console.log('Verificando usuários gratuitos para notificar sobre o reset da cota...')

    const today = new Date()
    const yesterdayStart = admin.firestore.Timestamp.fromDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1))
    const yesterdayEnd = admin.firestore.Timestamp.fromDate(new Date(today.getFullYear(), today.getMonth(), today.getDate()))

    const usersWhoUsedQuota = await db.collection('users')
        .where('lastFreeReminderAt', '>=', yesterdayStart)
        .where('lastFreeReminderAt', '<', yesterdayEnd)
        .get()

    if (usersWhoUsedQuota.empty) {
        console.log('Nenhum usuário para notificar hoje.')
        return
    }

    console.log(`Encontrados ${usersWhoUsedQuota.docs.length} usuários. Verificando assinaturas e enviando notificações...`)

    for (const userDoc of usersWhoUsedQuota.docs) {
        const userId = userDoc.id
        const subscriptionDoc = await db.collection('subscriptions').doc(userId).get()
        
        if (subscriptionDoc.exists && subscriptionDoc.data()?.status === 'active') {
            continue
        }

        const userName = userDoc.data()?.name?.split(' ')[0] || 'pessoinha'
        const message = `Oi, ${userName}! ✨ Seu lembrete diário gratuito no Me Lembra já está disponível novamente. Toque para criar!`

        // 1. Envia notificação por WhatsApp (responsabilidade deste servidor)
        const phoneNumber = userDoc.data()?.whatsappNumber
        if (phoneNumber) {
            await sendWhatsappMessage(phoneNumber, message)
        }

        // 2. Dispara a notificação Push (responsabilidade do app Next.js)
        // Chama a API Route no app da Vercel para que ELE envie a notificação.
        try {
            const nextAppUrl = process.env.NEXT_APP_URL
            const cronSecret = process.env.CRON_SECRET
            await fetch(`${nextAppUrl}/api/cron/notificar-usuarios-gratuitos?secret=${cronSecret}`, {
                method: 'POST',
                // A API que criamos não precisa de um corpo, mas é uma boa prática
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId }), // Opcional: envia o userId para logs futuros
            })
            console.log(`Gatilho de notificação push enviado para o usuário: ${userId}`)
        } catch (error) {
            console.error(`Erro ao disparar gatilho de push para o usuário ${userId}:`, error)
        }
    }
}