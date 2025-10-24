//melembra-server/src/services/jobHandlers.ts
import admin from 'firebase-admin'
import { Buttons } from 'whatsapp-web.js'
import { getFirebaseFirestore } from '../database/firebase-admin'
import { getClient } from './whatsappClient'
import { IReminder } from '../interfaces/IReminder'

const db = getFirebaseFirestore()

// --- NOVA FUNÇÃO DE VALIDAÇÃO ---

/**
 * Valida um número de WhatsApp usando a RapidAPI.
 * @param number O número de telefone a ser validado.
 * @returns {Promise<boolean>} True se o número for válido, false caso contrário.
 */
async function validateWhatsappNumber(number: string): Promise<boolean> {
    // Normaliza o número para o formato esperado pela API (com código do país)
    let sanitizedNumber = number.replace(/\D/g, '')
    if (sanitizedNumber.length <= 11) {
        sanitizedNumber = `55${sanitizedNumber}`
    }

    const url = 'https://whatsapp-number-validator3.p.rapidapi.com/WhatsappNumberHasItWithToken'
    const options = {
        method: 'POST',
        headers: {
            'x-rapidapi-key': process.env.RAPID_API_KEY!,
            'x-rapidapi-host': process.env.RAPID_API_HOST!,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ phone_number: sanitizedNumber })
    }

    try {
        const response = await fetch(url, options)
        const result = await response.json() as { status: string }

        if (result.status === 'valid') {
            console.log(`✅ Validação bem-sucedida para o número: ${sanitizedNumber}`)
            return true
        } else {
            console.warn(`API de validação retornou status '${result.status}' para o número: ${sanitizedNumber}`)
            return false
        }
    } catch (error) {
        console.error('Erro ao chamar a API de validação de número:', error)
        return false // Em caso de erro na API, consideramos o número inválido por segurança
    }
}

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
            await fetch(`${nextAppUrl}/api/cron/notificar-usuarios-gratuitos?secret=${cronSecret}`, {
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

// export async function sendWhatsappMessage(number: string, message: string | Buttons) {
//     const client = getClient()
//     if (!client || (await client.getState()) !== 'CONNECTED') {
//         console.warn("Cliente não está conectado. Mensagem não enviada.")
//         return { success: false, error: 'Cliente WhatsApp não conectado.' }
//     }

//     // 1. Remove tudo que não for dígito.
//     let sanitizedNumber = number.replace(/\D/g, '')

//     // 2. Se o número tiver 11 dígitos (DDD + 9xxxxxxxx), adiciona o 55.
//     if (sanitizedNumber.length === 11) {
//         sanitizedNumber = `55${sanitizedNumber}`
//     }
//     // 3. Se tiver 10 dígitos (DDD + 8xxxxxxx), adiciona 55 e o 9.
//     else if (sanitizedNumber.length === 10) {
//         const ddd = sanitizedNumber.substring(0, 2)
//         const numero = sanitizedNumber.substring(2)
//         sanitizedNumber = `55${ddd}9${numero}`
//     }
//     // Garante que o número final tenha o formato correto do WhatsApp (55 + 11 dígitos)
//     else if (sanitizedNumber.length !== 13 || !sanitizedNumber.startsWith('55')) {
//         console.error(`Número de telefone inválido após normalização: ${number}`)
//         return { success: false, error: 'Número de telefone inválido.' }
//     }

//     const finalNumber = `${sanitizedNumber}@c.us`
//     // --- FIM DA CORREÇÃO ---

//     try {
//         const isRegistered = await client.isRegisteredUser(finalNumber)
//         if (isRegistered) {
//             await client.sendMessage(finalNumber, message)
//             console.log(`✅ Mensagem enviada com sucesso para ${number}`)
//             return { success: true }
//         } else {
//             console.error(`Número ${number} (${finalNumber}) não está registrado no WhatsApp.`)
//             return { success: false, error: 'Número não registrado no WhatsApp.' }
//         }
//     } catch (error) {
//         console.error(`Erro ao enviar mensagem para ${number}:`, error)
//         return { success: false, error: 'Falha ao enviar mensagem.' }
//     }
// }

export async function sendWhatsappMessage(number: string, message: string | Buttons) {
    const client = getClient()
    if (!client || (await client.getState()) !== 'CONNECTED') {
        console.warn("Cliente não está conectado. Mensagem não enviada.")
        return { success: false, error: 'Cliente WhatsApp não conectado.' }
    }

    // 2. CHAMA A VALIDAÇÃO PRIMEIRO
    const isValid = await validateWhatsappNumber(number)
    if (!isValid) {
        return { success: false, error: `Número ${number} foi considerado inválido pela API.` }
    }

    // A lógica de normalização agora vive dentro do validador, aqui apenas formatamos para a wweb.js
    let sanitizedNumber = number.replace(/\D/g, '')
    if (sanitizedNumber.length <= 11) {
        sanitizedNumber = `55${sanitizedNumber}`
    }
    const finalNumber = `${sanitizedNumber}@c.us`

    try {
        await client.sendMessage(finalNumber, message)
        console.log(`Mensagem enviada com sucesso para ${number}`)
        return { success: true }
    } catch (error) {
        console.error(`Erro ao enviar mensagem para ${number} (após validação):`, error)
        return { success: false, error: 'Falha ao enviar mensagem.' }
    }
}