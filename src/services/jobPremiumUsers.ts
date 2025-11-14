import { Buttons } from "whatsapp-web.js"
import { getFirebaseFirestore } from "../database/firebase-admin"
import { encontrarNumeroCelular, enviarMensagemWhatsApp } from "./jobWhatsApp"

const db = getFirebaseFirestore()

/**
 * Envia dicas diárias para todos os usuários assinantes do Premium
 */

export async function enviarDicasPersonalizadasPremium() {
    console.log('Verificando dicas para enviar...')
    const usersSnapshot = await db.collection('users').get()

    for (const userDoc of usersSnapshot.docs) {
        let tipMessage: string | null = null
        const hour = new Date().getHours()
        const name = userDoc.data()?.name?.split(' ')[0] || 'Ei'

        if (hour === 8) tipMessage = `Bom dia, ${name} ☀️ Bora começar o dia criando seus lembretes importantes?`
        if (hour === 12) tipMessage = `Ei, ${name} hora do almoço! 🍽️ Quer criar um lembrete para não esquecer daquela pausa?`
        if (hour === 16) tipMessage = `Boa tarde, ${name} hora do café da tarde! ☕ Quer criar um lembrete enquanto faz aquela pausa?`
        if (hour === 18) tipMessage = `Dia finalizando, ${name}! Que tal agendar os lembretes importantes de amanhã?`
        if (hour === 21) tipMessage = `Hora de relaxar, ${name}! 😴 Tem algo para anotar e não esquecer amanhã?`

        if (tipMessage) {
            const phoneNumber = await encontrarNumeroCelular(userDoc.id)
            if (phoneNumber) {
                const buttons = new Buttons(tipMessage, [{ body: 'Criar Lembrete', id: 'create_reminder_tip' }], 'Dica do Bora', 'Responda para agendar')
                await enviarMensagemWhatsApp(phoneNumber, buttons)
            }
        }
    }
}