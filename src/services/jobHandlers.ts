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

export async function enviarLembretesPessoais() {
    console.log('--- ⏰ INICIANDO JOB: Verificando lembretes no horário (WhatsApp)... ---')
    const now = new Date()

    // DEFINIÇÃO DA JANELA DE SEGURANÇA (CRUCIAL PARA EVITAR SPAM)
    // Vamos buscar apenas lembretes agendados entre 20 minutos atrás e Agora.
    // Lembretes mais antigos que 20 min serão ignorados nesta rodada para evitar
    // disparar 500 mensagens se o servidor ficou fora do ar por 2 dias.
    const TOLERANCE_MINUTES = 20
    const windowStart = new Date(now.getTime() - TOLERANCE_MINUTES * 60000)

    const nowTimestamp = admin.firestore.Timestamp.fromDate(now)
    const windowStartTimestamp = admin.firestore.Timestamp.fromDate(windowStart)

    console.log(`   - Janela de busca: ${windowStart.toISOString()} até ${now.toISOString()}`)

    // Query Unificada (Lembretes únicos E recorrentes que não foram enviados)
    // Adicionamos a cláusula .where('scheduledAt', '>=', windowStartTimestamp)
    const snapshot = await db.collection('reminders')
        .where('sent', '==', false)
        .where('scheduledAt', '<=', nowTimestamp)
        .where('scheduledAt', '>=', windowStartTimestamp)
        .get()

    if (snapshot.empty) {
        console.log(`⏰ Nenhum lembrete pendente na janela de tempo (${TOLERANCE_MINUTES}min).`)
        return
    }

    console.log(`⏰ Encontrados ${snapshot.docs.length} lembretes para processar.`)

    for (const doc of snapshot.docs) {
        const reminder = doc.data() as IReminder
        const isRecurring = reminder.recurrence && reminder.recurrence !== 'Não repetir'

        console.log(`\n--- Processando Lembrete ID: ${doc.id} | Recorrente: ${isRecurring} ---`)

        // --- 1. VERIFICAÇÃO DE PLANO (Mantida) ---
        if (isRecurring) {
            const userPlan = await getUserSubscriptionPlan(reminder.userId)
            // Lógica de restrição (ponto 1 do seu pedido):
            // Aqui você pode expandir. Ex: Se for Plus, só aceita 'Diariamente'. Se Free, bloqueia.
            if (userPlan.plan === 'free') {
                console.log(`   - 🚫 Lembrete recorrente [${doc.id}] PULADO/DESATIVADO para usuário free.`)
                // IMPORTANTE: Marque como enviado para não processar de novo em loop
                await updateReminderSentStatus(doc.id)
                continue
            }
        }

        // --- 2. ENVIO DA MENSAGEM ---
        const phoneNumber = await encontrarNumeroCelular(reminder.userId)
        let messageSent = false

        if (phoneNumber) {
            const time = reminder.scheduledAt.toDate().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
            const message = `Bora veio te lembrar: "${reminder.title}" começa às ${time}!`

            // Tenta enviar. Se der erro no whats, a gente decide se reagenda ou não.
            const result = await enviarMensagemWhatsApp(phoneNumber, message)
            messageSent = result && result.success ? true : false
        } else {
            console.log(`   - ⚠️ Número NÃO encontrado para o usuário ${reminder.userId}.`)
        }

        // --- 3. ATUALIZAÇÃO (CRUCIAL PARA EVITAR LOOP) ---
        if (isRecurring) {
            // Se enviou (ou tentou), calculamos a próxima data
            // Passamos 'now' para garantir que a próxima data seja baseada no momento da execução
            // e não fique presa no passado.
            await updateNextRecurrence(doc.id, reminder.recurrence!, reminder.scheduledAt.toDate())
        } else {
            // Lembrete único: marca como enviado para nunca mais pegar na query
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
