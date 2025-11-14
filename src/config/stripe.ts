// boraapp-server/src/config/stripe.ts
import Stripe from 'stripe'
import 'dotenv/config' // Garante que o .env seja carregado

if (!process.env.STRIPE_SECRET_KEY_DEV) {
    throw new Error('A variável de ambiente STRIPE_SECRET_KEY_DEV não está definida.')
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY_DEV, {
    apiVersion: '2025-10-29.clover', // Use uma versão recente da API
    typescript: true,
})

// Mapeamento dos Price IDs para nomes de planos legíveis
// Isso centraliza a lógica e facilita a troca dos IDs no futuro
export const priceIdToPlan = {
    [process.env.STRIPE_PLUS_PLAN_PRICE_ID_DEV!]: 'plus',
    [process.env.STRIPE_PREMIUM_PLAN_PRICE_ID_DEV!]: 'premium',
}

export const planToPriceId = {
    'plus': process.env.STRIPE_PLUS_PLAN_PRICE_ID_DEV!,
    'premium': process.env.STRIPE_PREMIUM_PLAN_PRICE_ID_DEV!,
}