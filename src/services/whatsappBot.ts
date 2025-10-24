//melembra-server/src/services/whatsappBot.ts
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
        client.sendMessage(chatId, "Desculpe, não encontrei sua conta Me Lembra. Verifique se o número de WhatsApp cadastrado no app está correto.")
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
        abra o app Me Lembra e personalize do seu jeito! 😉\n\nhttps://melembra.vercel.app/`
        client.sendMessage(message.from, successMessage)
    } catch (error) {
        console.error("Erro ao salvar lembrete via WhatsApp:", error)
        client.sendMessage(message.from, "Ocorreu um erro ao salvar seu lembrete. Tente novamente.")
    }
}