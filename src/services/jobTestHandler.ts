//melembra-server/src/services/jobTestHandler.ts
import admin from 'firebase-admin'
import { getFirebaseFirestore } from '../database/firebase-admin'
import { IReminder } from '../interfaces/IReminder'
import { sendWhatsappMessage } from './jobHandlers' // Reutiliza a função de envio principal

const db = getFirebaseFirestore()
const ADMIN_PHONE_NUMBER = '553187424020' // Seu número de teste

/**
 * Job de teste que procura por um lembrete do admin agendado para os próximos
 * 5 minutos e envia uma notificação de teste para o WhatsApp.
 */
export async function sendAdminTestReminder() {
    console.log('--- 🧪 EXECUTANDO JOB DE TESTE DE ADMIN ---')

    try {
        // 1. Encontrar o seu userId a partir do seu número de telefone
        const userQuery = await db.collection('users').where('whatsappNumber', '==', ADMIN_PHONE_NUMBER).limit(1).get()
        if (userQuery.empty) {
            console.log('🧪 Teste: Usuário admin não encontrado no Firestore. Encerrando teste.')
            return
        }
        const userId = userQuery.docs[0].id
        console.log(`🧪 Teste: Usuário admin encontrado com ID: ${userId}`)

        // 2. Procurar por lembretes SEUS agendados para os próximos 5 minutos
        const now = admin.firestore.Timestamp.now()

        const reminderQuery = await db.collection('reminders')
            .where('userId', '==', userId)
            .limit(1) // Pega apenas um para não sobrecarregar
            .get()

        if (reminderQuery.empty) {
            console.log('🧪 Teste: Nenhum lembrete de teste encontrado no intervalo de 5 minutos.')
            return
        }

        const reminder = reminderQuery.docs[0].data() as IReminder
        console.log(`🧪 Teste: Lembrete encontrado: "${reminder.title}". Enviando notificação...`)

        // 3. Enviar a mensagem de teste
        const message = `[TESTE DE SERVIDOR] 🚀\nSeu lembrete "${reminder.title}" está funcionando!`
        const result = await sendWhatsappMessage(ADMIN_PHONE_NUMBER, message)

        if (result.success) {
            console.log('✅ 🧪 Teste: Mensagem de teste enviada com sucesso!')
        } else {
            console.error('❌ 🧪 Teste: Falha ao enviar mensagem de teste.', result.error)
        }

    } catch (error) {
        console.error('❌ 🧪 Teste: Ocorreu um erro crítico no job de teste.', error)
    }
}