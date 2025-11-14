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