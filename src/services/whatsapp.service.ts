//melembra-server/src/services/whatsapp.service.ts
import { Client, LocalAuth } from 'whatsapp-web.js'
import qrcode from 'qrcode-terminal'
import cron, { ScheduledTask } from 'node-cron'
import admin from 'firebase-admin'
import { getFirebaseFirestore } from '../database/firebase-admin'
import { IReminder } from '../interfaces/IReminder'
import fs from 'fs'

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
            // Necessário para rodar em ambientes de servidor (como Docker/Linux)
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        }
    })

    client.on('qr', (qr) => {
        console.log('Escaneie o QR Code abaixo com seu celular:')
        qrcode.generate(qr, { small: true })
    })

    client.on('ready', () => {
        console.log('✅ Cliente WhatsApp está pronto!')
        startCronJobs() // Inicia as tarefas agendadas apenas quando o cliente está online
    })

    client.on('authenticated', () => {
        console.log('✅ Autenticado com sucesso!')
    })

    client.on('auth_failure', (msg) => {
        console.error('❌ Falha na autenticação:', msg)
    })

    client.on('error', (err) => {
        console.error('Ocorreu um erro inesperado no cliente:', err)
    })

    client.on('disconnected', async (reason) => {
        console.log('Cliente desconectado:', reason)
        stopCronJobs() // Para as tarefas agendadas para evitar erros

        try {
            await client.destroy()
            console.log("Instância do cliente destruída.")

            const sessionPath = './.wwebjs_auth'
            if (fs.existsSync(sessionPath)) {
                console.log("Limpando pasta de sessão antiga...")
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
async function sendDailyTips() {
    console.log('Checking for tips to send...')
    const usersRef = db.collection('users')
    const usersSnapshot = await usersRef.get()

    usersSnapshot.forEach(async (userDoc) => {
        const userId = userDoc.id
        const userPreferencesRef = db.collection('preferences').doc(userId)
        const userPreferences = (await userPreferencesRef.get()).data()

        if (userPreferences?.enableTips !== false) {
            let tipMessage = ''
            const hour = new Date().getHours()

            if (hour === 12) {
                tipMessage = 'Lunch time! 🍽️ Want to create a reminder for this?'
            } else if (hour === 18) {
                const weekday = new Date().toLocaleDateString('pt-BR', { weekday: 'long' })
                tipMessage = `Good evening! ${weekday}, how about creating some reminders for the week?`
            } else if (hour === 21) {
                tipMessage = `${userDoc.data()?.name || 'Friend'}, time to sleep! 😴 Anything to jot down?`
            }

            if (tipMessage) {
                const phoneNumber = await findUserPhoneNumber(userId)
                if (phoneNumber) {
                    await sendWhatsappMessage(phoneNumber, tipMessage)
                }
            }
        }
    })
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
            let message = `Good morning, ${userDoc.data()?.name || 'friend'}! You have ${dailyRemindersSnapshot.size} reminders for today:\n\n`
            dailyRemindersSnapshot.forEach((doc) => {
                const reminder = doc.data() as IReminder
                const time = reminder.scheduledAt.toDate().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                message += `- [${time}] ${reminder.title}\n`
            })
            message += '\nFor more details, visit: [your-link-here]'

            const phoneNumber = await findUserPhoneNumber(userId)
            if (phoneNumber) {
                await sendWhatsappMessage(phoneNumber, message)
            }
        }
    })
}

export async function sendWhatsappMessage(number: string, message: string) {
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
