//melembra-server/src/services/whatsapp.service.ts
import { Client, LocalAuth, MessageMedia } from 'whatsapp-web.js'
import qrcode from 'qrcode-terminal'
import cron from 'node-cron'
import admin from 'firebase-admin'
import { getFirebaseFirestore } from '../database/firebase-admin'
import { IReminder } from '../interfaces/IReminder'

// Connect to Firestore using the function from your new module
const db = getFirebaseFirestore()

// WhatsApp Web JS Configuration
const client = new Client({
    authStrategy: new LocalAuth(),
})

client.on('qr', (qr) => {
    console.log('Please scan the QR Code below with your mobile phone:')
    qrcode.generate(qr, { small: true })
})

client.on('ready', () => {
    console.log('✅ WhatsApp client is ready!')
    startCronJobs()
})

client.on('authenticated', () => {
    console.log('✅ Successfully authenticated!')
})

client.on('auth_failure', (msg) => {
    console.error('❌ Authentication failed:', msg)
})

client.on('disconnected', (reason) => {
    console.log('Client disconnected', reason)
})

client.initialize()

async function findUserPhoneNumber(userId: string): Promise<string | undefined> {
    try {
        const userDocRef = db.collection('users').doc(userId)
        const userDoc = await userDocRef.get()

        if (!userDoc.exists) {
            console.log(`Usuário ${userId} não encontrado na coleção 'users'.`)
            return undefined
        }

        return userDoc.data()?.whatsappNumber // <-- LÓGICA REAL AQUI
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
        let nextScheduledAt: Date | null = null
        const currentScheduledAt = reminder.scheduledAt.toDate()

        switch (recurrence) {
            case 'Diariamente':
                nextScheduledAt = new Date(currentScheduledAt)
                nextScheduledAt.setDate(nextScheduledAt.getDate() + 1)
                break
            case 'Semanalmente':
                nextScheduledAt = new Date(currentScheduledAt)
                nextScheduledAt.setDate(nextScheduledAt.getDate() + 7)
                break
            case 'Mensalmente':
                nextScheduledAt = new Date(currentScheduledAt)
                nextScheduledAt.setMonth(nextScheduledAt.getMonth() + 1)
                break
            case 'Anualmente':
                nextScheduledAt = new Date(currentScheduledAt)
                nextScheduledAt.setFullYear(nextScheduledAt.getFullYear() + 1)
                break
            case 'Não repetir':
            default:
                // Se não for recorrente, apenas marca como enviado
                await doc.ref.update({ sent: true })
                console.log(`Lembrete ${doc.id} marcado como concluído (não recorrente).`)
                continue // Pula para o próximo lembrete no loop
        }

        // Se for recorrente, atualiza para a próxima data
        if (nextScheduledAt) {
            await doc.ref.update({
                scheduledAt: admin.firestore.Timestamp.fromDate(nextScheduledAt)
            })
            console.log(`Lembrete ${doc.id} reagendado para ${nextScheduledAt.toISOString()} devido à recorrência '${recurrence}'.`)
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

function startCronJobs() {
    // Scheduling: Remember to use cron.guru to test schedules!
    // Schedule to run every 5 minutes
    cron.schedule('*/5 * * * *', () => {
        sendPersonalReminders()
    })

    // Schedule for tips at 12h, 18h, and 21h
    cron.schedule('0 12,18,21 * * *', () => {
        sendDailyTips()
    })

    // Schedule for daily list at 8 AM every day
    cron.schedule('0 8 * * *', () => {
        sendDailyList()
    })

    console.log('✅ Cron jobs scheduled successfully!')
}

export async function sendWhatsappMessage(number: string, message: string) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '')
    const finalNumber = `55${sanitizedNumber}@c.us`

    try {
        const isRegistered = await client.isRegisteredUser(finalNumber)
        if (!isRegistered) {
            console.error('Number not registered on WhatsApp.')
            return { success: false, error: 'Number not registered on WhatsApp.' }
        }

        await client.sendMessage(finalNumber, message)
        console.log(`Message sent to ${number}`)
        return { success: true }
    } catch (error) {
        console.error(`Error sending message to ${number}:`, error)
        return { success: false, error: 'Failed to send message.' }
    }
}
