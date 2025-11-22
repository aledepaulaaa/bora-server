//bora-server/src/controllers/whatsapp.controllers.ts
import { Request, Response } from 'express'
import { enviarMensagemWhatsApp } from '../services/jobWhatsApp'

export const sendMessageController = async (req: Request, res: Response) => {
    const { number, message } = req.body

    if (!number || !message) {
        return res.status(400).send({ error: 'Número e mensagem são obrigatórios.' })
    }

    try {
        const result = await enviarMensagemWhatsApp(number, message)
        if (result && result.success) {
            res.status(200).send({ message: `Mensagem enviada para ${number}` })
        } else {
            res.status(500).send({ error: result?.error || 'Falha ao enviar mensagem.' })
        }
    } catch (error) {
        console.error('Erro no controlador ao enviar mensagem:', error)
        res.status(500).send({ error: 'Erro interno do servidor.' })
    }
}

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


//boraapp-server/src/services/jobPremiumUsers.ts
import { Buttons } from "whatsapp-web.js"
import { getFirebaseFirestore } from "../database/firebase-admin" // Seu path pode ser diferente, ajuste se necessário
import { encontrarNumeroCelular, enviarMensagemWhatsApp } from "./jobWhatsApp"
import { planToPriceId } from "../config/stripe"

const db = getFirebaseFirestore()

/**
 * Envia dicas diárias APENAS para usuários assinantes do Premium
 */
export async function enviarDicasPersonalizadasPremium() {
    console.log('Verificando dicas para enviar aos usuários PREMIUM...')

    const premiumPriceId = planToPriceId['premium']
    if (!premiumPriceId) {
        console.error('ERRO: Price ID para o plano Premium não foi encontrado nas variáveis de ambiente.')
        return
    }

    // --- LÓGICA CORRIGIDA ---
    // 1. Busca na coleção 'subscriptions' por planos premium ativos
    const premiumSubscriptions = await db.collection('subscriptions')
        .where('stripePriceId', '==', premiumPriceId)
        .where('status', 'in', ['active', 'trialing'])
        .get()

    if (premiumSubscriptions.empty) {
        console.log("Nenhum usuário premium ativo encontrado para enviar dicas.")
        return
    }

    console.log(`Encontrados ${premiumSubscriptions.docs.length} usuários premium.`)

    // 2. Itera sobre os assinantes encontrados
    for (const subDoc of premiumSubscriptions.docs) {
        const userId = subDoc.id // O ID do documento é o userId
        const userDoc = await db.collection('users').doc(userId).get() // Busca os dados do usuário

        if (!userDoc.exists) continue // Pula se não encontrar o documento do usuário

        let tipMessage: string | null = null
        const hour = new Date().getHours()
        const name = userDoc.data()?.name?.split(' ')[0] || 'Ei'

        if (hour === 8) tipMessage = `Bom dia, ${name} ☀️ Bora começar o dia criando seus lembretes importantes?`
        if (hour === 12) tipMessage = `Ei, ${name} hora do almoço! 🍽️ Quer criar um lembrete para não esquecer daquela pausa?`
        if (hour === 16) tipMessage = `Boa tarde, ${name} hora do café da tarde! ☕ Quer criar um lembrete enquanto faz aquela pausa?`
        if (hour === 18) tipMessage = `Dia finalizando, ${name}! Que tal agendar os lembretes importantes de amanhã?`
        if (hour === 21) tipMessage = `Hora de relaxar, ${name}! 😴 Tem algo para anotar e não esquecer amanhã?`

        if (tipMessage) {
            const phoneNumber = await encontrarNumeroCelular(userId)
            if (phoneNumber) {
                const buttons = new Buttons(tipMessage, [{ body: 'Criar Lembrete', id: 'create_reminder_tip' }], 'Dica do Bora', 'Responda para agendar')
                await enviarMensagemWhatsApp(phoneNumber, buttons)
                console.log(`Dica de ${hour}h enviada para o usuário premium: ${userId}`)
            }
        }
    }
}

//bora-server/src/services/jobScheduler.ts
import cron, { ScheduledTask } from 'node-cron'

// 1. Importa apenas as funções que são realmente jobs do handler
import {
    enviarListaDiaria,
    enviarLembretesPessoais,
    acionarLembretesProximos,
    notificarUsuariosDoResetGratuito,
} from './jobHandlers'
import { enviarDicasPersonalizadasPremium } from './jobPremiumUsers'

const scheduledTasks: ScheduledTask[] = []

/**
 * Agenda todas as tarefas recorrentes do servidor.
 */
export function startCronJobs() {
    stopCronJobs() // Garante que não haja tarefas duplicadas
    console.log('Agendando cron jobs...')

    scheduledTasks.push(cron.schedule('*/2 * * * *', acionarLembretesProximos))
    scheduledTasks.push(cron.schedule('*/2 * * * *', enviarLembretesPessoais))
    scheduledTasks.push(cron.schedule('0 7 * * *', notificarUsuariosDoResetGratuito))
    scheduledTasks.push(cron.schedule('0 8 * * *', enviarListaDiaria))
    scheduledTasks.push(cron.schedule('0 8,12,16,18,21 * * *', enviarDicasPersonalizadasPremium))

    console.log('✅ Cron jobs agendados com sucesso!')
}

/**
 * Para todas as tarefas agendadas.
 */
export function stopCronJobs() {
    if (scheduledTasks.length > 0) {
        console.log('Parando cron jobs agendados...')
        scheduledTasks.forEach(task => task.stop())
        scheduledTasks.length = 0
    }
}

import { Buttons } from "whatsapp-web.js"
import { getFirebaseFirestore } from "../database/firebase-admin"
import { getClient } from "./whatsappClient"

const db = getFirebaseFirestore()

// --- FUNÇÃO AUXILIAR ---
export async function encontrarNumeroCelular(userId: string): Promise<string | undefined> {
    try {
        const userDoc = await db.collection('users').doc(userId).get()
        return userDoc.exists ? userDoc.data()?.whatsappNumber : undefined
    } catch (error) {
        console.error(`Erro ao buscar número de telefone para o usuário ${userId}:`, error)
        return undefined
    }
}

export async function enviarMensagemWhatsApp(number: string, message: string | Buttons) {
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
                // Se for "Não repetir" ou inválido, apenas ignora
                return
        }

        const reminderRef = db.collection('reminders').doc(reminderId)

        // --- CORREÇÃO CRÍTICA AQUI ---
        // Agora, além de atualizar a data, nós REDEFINIMOS 'sent' para 'false'.
        // Isso "rearmazena" o lembrete para que ele possa ser pego pelo job no futuro.
        await reminderRef.update({
            scheduledAt: admin.firestore.Timestamp.fromDate(nextScheduledAt),
            sent: false
        })

        console.log(`   - 🔄 Lembrete [${reminderId}] reagendado para ${nextScheduledAt.toISOString()} e resetado.`)

    } catch (error) {
        console.error(`   - ❌ Erro ao reagendar o lembrete [${reminderId}]:`, error)
    }
}

// boraapp-server/src/services/subscription.service.ts
import { priceIdToPlan } from '../config/stripe'
import { getFirebaseFirestore } from '../database/firebase-admin'

const db = getFirebaseFirestore()

// Define um tipo para a resposta para mantermos a consistência
export type UserPlan = {
    plan: 'free' | 'plus' | 'premium'
    status: string // 'active', 'trialing', 'inactive', etc.
    stripeSubscriptionId?: string
}

/**
 * Verifica a assinatura de um usuário no Firestore e retorna seu plano.
 * @param userId O ID do usuário do Firebase a ser verificado.
 * @returns Um objeto UserPlan com o plano e status do usuário.
 */
export async function getUserSubscriptionPlan(userId: string): Promise<UserPlan> {
    if (!userId) {
        return { plan: 'free', status: 'inactive' }
    }

    const subscriptionRef = db.collection('subscriptions').doc(userId)
    const doc = await subscriptionRef.get()

    if (!doc.exists) {
        return { plan: 'free', status: 'inactive' }
    }

    const data = doc.data()

    // Assegura que temos um status válido e que a assinatura está ativa
    const validStatus = ['active', 'trialing']
    if (!data || !validStatus.includes(data.status)) {
        return { plan: 'free', status: data?.status || 'inactive' }
    }

    const priceId = data.stripePriceId
    const plan = priceIdToPlan[priceId] || 'free' // Retorna o plano ou 'free' se o priceId não for mapeado

    return {
        plan: plan as 'plus' | 'premium' | 'free',
        status: data.status,
        stripeSubscriptionId: data.stripeSubscriptionId,
    }
}

//bora-server/src/services/whatsapp.service.ts
import { initialize } from './whatsappClient'

// A única responsabilidade deste arquivo é iniciar o serviço.
// Toda a lógica de eventos foi movida para dentro de whatsappClient.ts
// para evitar problemas de timing e escopo.
export function initializeWhatsAppService() {
    console.log("Orquestrador: Disparando inicialização do serviço do WhatsApp...")
    initialize()
}

//bora-server/src/services/whatsappBot.ts
import { Message } from 'whatsapp-web.js'
import * as chrono from 'chrono-node'
import admin from 'firebase-admin'
import { getFirebaseFirestore } from '../database/firebase-admin'
import { getClient } from './whatsappClient' // Importa a função para pegar o cliente

const db = getFirebaseFirestore()

/**
 * Ponto de entrada para todas as mensagens recebidas.
 * Determina o estado da conversa e delega para o handler apropriado.
 */
export async function handleIncomingMessage(message: Message) {
    const chatId = message.from
    const conversationRef = db.collection('whatsapp_conversations').doc(chatId)
    const conversationDoc = await conversationRef.get()

    // Lida com cliques em botões de dicas
    if (message.type === 'buttons_response' && message.selectedButtonId === 'create_reminder_tip') {
        await startReminderFlow(chatId)
        return
    }

    // Se não há uma conversa ativa, ignora a mensagem de texto
    if (!conversationDoc.exists) return

    const state = conversationDoc.data()
    if (!state) return

    // Delega a resposta com base na etapa atual da conversa
    switch (state.step) {
        case 'awaiting_title':
            await handleTitleResponse(message, conversationRef)
            break
        case 'awaiting_datetime':
            await handleDateTimeResponse(message, conversationRef, state.userId)
            break
    }
}

/**
 * Inicia o fluxo de criação de lembrete via WhatsApp.
 */
async function startReminderFlow(chatId: string) {
    const client = getClient()
    const number = chatId.split('@')[0]
    const usersQuery = await db.collection('users').where('whatsappNumber', '==', number).limit(1).get()

    if (usersQuery.empty) {
        client.sendMessage(chatId, "Desculpe, não encontrei sua conta Bora. Verifique se o número de WhatsApp cadastrado no app está correto.")
        return
    }
    const userId = usersQuery.docs[0].id

    await db.collection('whatsapp_conversations').doc(chatId).set({
        step: 'awaiting_title',
        userId: userId,
    })

    client.sendMessage(chatId, 'Ótimo! Qual o título do seu lembrete?')
}

/**
 * Lida com a resposta do título e avança para a próxima etapa.
 */
async function handleTitleResponse(message: Message, conversationRef: admin.firestore.DocumentReference) {
    const client = getClient()
    const title = message.body
    await conversationRef.update({
        'reminderData.title': title,
        step: 'awaiting_datetime',
    })
    client.sendMessage(message.from, `Entendido. E para quando é o lembrete "${title}"? (ex: amanhã às 15h, 25/12 18:00)`)
}

/**
 * Lida com a resposta de data/hora, salva o lembrete e finaliza o fluxo.
 */
async function handleDateTimeResponse(message: Message, conversationRef: admin.firestore.DocumentReference, userId: string) {
    const client = getClient()
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

        const successMessage = `Lembrete salvo com sucesso para ${parsedDate.toLocaleString('pt-BR')}! ✨\n\nPara criar lembretes com recorrência, 
        abra o app Bora e personalize do seu jeito! 😉\n\nhttps://www.aplicativobora.com.br/`
        client.sendMessage(message.from, successMessage)
    } catch (error) {
        console.error("Erro ao salvar lembrete via WhatsApp:", error)
        client.sendMessage(message.from, "Ocorreu um erro ao salvar seu lembrete. Tente novamente.")
    }
}

//bora-server/src/services/whatsappClient.ts
import { Client, LocalAuth } from 'whatsapp-web.js'
import qrcode from 'qrcode-terminal'
import fs from 'fs'
import { handleIncomingMessage } from './whatsappBot'
import { startCronJobs, stopCronJobs } from './jobScheduler'
// import puppeteer from 'puppeteer'

let client: Client

function createAndConfigureClient() {
    console.log("Iniciando nova instância do cliente WhatsApp...")
    client = new Client({
        authStrategy: new LocalAuth({ dataPath: undefined}),
        puppeteer: ({
            headless: true, // Garante que o navegador rode em segundo plano
            // executablePath: puppeteer.executablePath(),
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu', // Desabilitar GPU é bom para ambientes de servidor sem interface gráfica
            ],
            // <<< MELHORIA PRINCIPAL AQUI >>>
            // O User Agent abaixo é conhecido por ser estável e compatível com contas do WhatsApp Business.
            // Para satisfazer as tipagens do pacote, fazemos um cast para `any`.
            userAgent: 'Mozilla/5.0 (Macintosh Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
        }) as any
    })

    client.on('qr', (qr) => qrcode.generate(qr, { small: true }))
    // handler do 'code' para pegar o código de 8 caracteres conectar sem qr-code
    client.on('code', (code) => {
        console.log('================================================')
        console.log(`> Código de conexão: ${code}`)
        console.log('> Abra seu WhatsApp no celular > Aparelhos Conectados > Conectar com número de telefone e digite o código acima.')
        console.log('================================================')
    })
    client.on('authenticated', () => console.log('✅ Autenticado com sucesso!'))
    client.on('auth_failure', (msg) => console.error('❌ Falha na autenticação:', msg))
    client.on('error', (err) => console.error('Ocorreu um erro inesperado no cliente:', err))
    client.on('message', handleIncomingMessage)

    // Sua lógica de orquestração (que está excelente)
    client.on('ready', () => {
        console.log('✅ Cliente WhatsApp está pronto!')
        startCronJobs() // Inicia os jobs somente quando a conexão está 100%
    })

    // Sua lógica de reconexão autocurável (excelente!)
    client.on('disconnected', async (reason) => {
        console.warn('Cliente desconectado:', reason)
        stopCronJobs() // Para os jobs imediatamente para evitar erros
        try {
            await client.destroy()
            console.log("Instância do cliente destruída.")
            const sessionPath = './.wwebjs_auth'
            if (fs.existsSync(sessionPath)) {
                // Usando a API de promessas do fs para consistência
                await fs.promises.rm(sessionPath, { recursive: true, force: true })
                console.log("Sessão antiga limpa com sucesso.")
            }
        } catch (error) {
            console.error("Erro ao limpar e destruir o cliente:", error)
        } finally {
            console.log("Tentando reinicializar o processo em 10 segundos...")
            setTimeout(initialize, 10000) // Tenta reconectar após 10s
        }
    })
}

export function initialize() {
    createAndConfigureClient()
    client.initialize().catch((err: any) => {
        console.error("Falha crítica ao inicializar o cliente. O erro pode ser falta de dependências ou sessão corrompida.", err)
        // O process.exit(1) é uma boa estratégia aqui, pois o PM2 irá reiniciar o processo automaticamente.
        process.exit(1)
    })
}

export function getClient(): Client {
    if (!client) {
        throw new Error("Cliente do WhatsApp não foi inicializado.")
    }
    return client
}