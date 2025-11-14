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