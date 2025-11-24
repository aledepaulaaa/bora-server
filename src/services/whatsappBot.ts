// bora-server/src/services/whatsappBot.ts
import { Message } from 'whatsapp-web.js'
import admin from 'firebase-admin'
import { getFirebaseFirestore } from '../database/firebase-admin'
import { getClient } from './whatsappClient'
import { getUserSubscriptionPlan } from './subscription.service'
import { processarIntencaoUsuario } from './geminiService' // Importa nosso service de IA

const db = getFirebaseFirestore()

export async function handleIncomingMessage(message: Message) {
    const chatId = message.from
    const client = getClient()

    // Ignora grupos e status
    if (chatId.includes('@g.us') || chatId === 'status@broadcast') return

    // 1. Identificar usuário
    const number = chatId.split('@')[0]
    const usersQuery = await db.collection('users').where('whatsappNumber', '==', number).limit(1).get()

    if (usersQuery.empty) return // Usuário não encontrado, ignora

    const userDoc = usersQuery.docs[0]
    const userId = userDoc.id
    const userData = userDoc.data()
    const userName = userData.name?.split(' ')[0] || 'Usuário'

    // 2. Verificar Plano (Apenas Premium usa a IA)
    const subscription = await getUserSubscriptionPlan(userId)
    if (subscription.plan !== 'premium') {
        // Envia mensagem de upgrade apenas se o usuário mandar um comando explícito de criar, 
        // para não responder "bom dia" com "assine o premium". 
        // Como simplificação, respondemos uma vez e marcamos que avisamos (opcional).
        // Por hora, apenas retornamos.
        await client.sendMessage(chatId, "🔒 O assistente de IA por voz/texto é exclusivo para assinantes Premium.\nAcesse o app para assinar: https://www.aplicativobora.com.br/")
        return
    }

    // 3. Comando de Cancelamento
    if (message.body.toLowerCase() === 'cancelar') {
        await db.collection('whatsapp_conversations').doc(chatId).delete()
        await client.sendMessage(chatId, "👍 Conversa cancelada. Pode me pedir algo novo quando quiser!")
        return
    }

    // 4. Obter Contexto Anterior (Conversa em andamento)
    const conversationRef = db.collection('whatsapp_conversations').doc(chatId)
    const conversationDoc = await conversationRef.get()
    let currentData = conversationDoc.exists ? conversationDoc.data()?.reminderData : null

    // Feedback visual (Simulando digitação)
    const chat = await message.getChat()
    await chat.sendStateTyping()

    try {
        // 5. Preparar Input (Texto ou Áudio)
        let inputForAI: string | { mimeType: string; data: string }

        if (message.hasMedia) {
            // É áudio ou imagem? Focamos em áudio PTT (push to talk) ou audio geral
            if (message.type === 'ptt' || message.type === 'audio') {
                const media = await message.downloadMedia()
                if (!media) throw new Error("Falha ao baixar áudio")

                // O Gemini aceita base64 direto. O wwebjs já devolve media.data em base64.
                inputForAI = { mimeType: media.mimetype, data: media.data }
            } else {
                await client.sendMessage(chatId, "Desculpe, por enquanto só entendo Texto ou Áudio. 😅")
                return
            }
        } else {
            inputForAI = message.body
        }

        // 6. Chamar a IA (Gemini)
        const aiResponse = await processarIntencaoUsuario(inputForAI, userName, currentData)

        // 7. Lógica de Decisão
        if (aiResponse.isValid && aiResponse.reminderData?.title && aiResponse.reminderData?.scheduledAt) {

            // --- CENÁRIO A: TUDO PRONTO, SALVAR! ---

            const rData = aiResponse.reminderData
            const scheduledDate = new Date(rData.scheduledAt!)

            // Salvar no Firestore
            await db.collection('reminders').add({
                title: rData.title,
                scheduledAt: admin.firestore.Timestamp.fromDate(scheduledDate),
                userId: userId,
                createdAt: admin.firestore.Timestamp.now(),
                sent: false,
                recurrence: rData.recurrence || 'Não repetir',
                category: rData.category || 'Geral',
                cor: rData.cor || '#BB86FC',
                sobre: rData.sobre || '',
                // Campos de controle
                origin: 'whatsapp_bot'
            })

            // Atualiza estatística de uso gratuito (se aplicável, mas aqui é premium)
            // Limpar conversa
            await conversationRef.delete()

            // Confirmar ao usuário
            const dateStr = scheduledDate.toLocaleString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
            await client.sendMessage(chatId, `✅ Feito! Agendei: *${rData.title}* para ${dateStr}.\n\nSe precisar de mais alguma coisa, é só falar!`)

        } else {

            // --- CENÁRIO B: FALTA INFORMAÇÃO ---

            // Salva o que a IA já entendeu (ex: Título ok, falta data) para a próxima mensagem
            if (aiResponse.reminderData) {
                await conversationRef.set({
                    reminderData: aiResponse.reminderData,
                    updatedAt: admin.firestore.Timestamp.now(),
                    userId: userId
                }, { merge: true })
            }

            // Envia a pergunta da IA (ex: "Para quando é o lembrete?")
            const reply = aiResponse.missingInfo || "Entendi, mas preciso de mais detalhes. Para quando é?"
            await client.sendMessage(chatId, reply)
        }

    } catch (error) {
        console.error("Erro no fluxo do Bot:", error)
        await client.sendMessage(chatId, "Tive um problema técnico para processar seu pedido. 😵‍💫 Tente novamente em alguns instantes.")
    } finally {
        await chat.clearState()
    }
}