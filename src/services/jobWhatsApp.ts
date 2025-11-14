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