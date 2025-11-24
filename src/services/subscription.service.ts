// boraapp-server/src/services/subscription.service.ts
import { priceIdToPlan } from '../config/stripe'
import { getFirebaseFirestore } from '../database/firebase-admin'
import admin from 'firebase-admin'

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
    if (!userId) { return { plan: 'free', status: 'inactive' } }
    const subscriptionRef = db.collection('subscriptions').doc(userId)
    const doc = await subscriptionRef.get()

    if (!doc.exists) { return { plan: 'free', status: 'inactive' } }
    const data = doc.data()
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

/**
 * Verifica se o usuário pode receber lembretes baseados na cota mensal.
 * - Free: 0 (ou limite diário tratado em outro lugar)
 * - Plus: 30 por mês
 * - Premium: Ilimitado
 */
export async function canUserReceiveWhatsapp(userId: string, plan: 'free' | 'plus' | 'premium'): Promise<boolean> {
    if (plan === 'premium') return true // Premium é ilimitado
    if (plan === 'free') return false // Free não recebe no WhatsApp (regra base, assumindo que só Plus/Premium recebem)

    // Lógica para PLUS (Cota de 30)
    const userUsageRef = db.collection('usage_stats').doc(userId)
    const doc = await userUsageRef.get()

    if (!doc.exists) return true // Nunca usou, pode enviar

    const data = doc.data()
    const currentMonth = new Date().getMonth()
    const lastUsageDate = data?.lastUsageDate ? (data.lastUsageDate as admin.firestore.Timestamp).toDate() : new Date()
    
    // Se mudou o mês, a cota reseta virtualmente (vamos atualizar no incremento)
    if (lastUsageDate.getMonth() !== currentMonth) {
        return true
    }

    // Limite do plano Plus
    if (data?.whatsappCount >= 30) {
        return false
    }

    return true
}

/**
 * Incrementa o contador de mensagens enviadas.
 * Deve ser chamado APÓS o envio com sucesso.
 */
export async function incrementWhatsappUsage(userId: string) {
    const userUsageRef = db.collection('usage_stats').doc(userId)
    const doc = await userUsageRef.get()
    const now = new Date()
    const currentMonth = now.getMonth()

    if (!doc.exists) {
        await userUsageRef.set({ whatsappCount: 1, lastUsageDate: admin.firestore.Timestamp.fromDate(now) })
        return
    }

    const data = doc.data()
    const lastUsageDate = data?.lastUsageDate ? (data.lastUsageDate as admin.firestore.Timestamp).toDate() : new Date()

    if (lastUsageDate.getMonth() !== currentMonth) {
        // Reset de mês novo
        await userUsageRef.set({ whatsappCount: 1, lastUsageDate: admin.firestore.Timestamp.fromDate(now) }, { merge: true })
    } else {
        // Mês atual, apenas incrementa
        await userUsageRef.update({ 
            whatsappCount: admin.firestore.FieldValue.increment(1),
            lastUsageDate: admin.firestore.Timestamp.fromDate(now)
        })
    }
}