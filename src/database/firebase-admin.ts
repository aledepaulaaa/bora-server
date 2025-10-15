// mmelembra-server/src/database/firebase-admin.ts
import dotenv from 'dotenv'
dotenv.config()
import { initializeApp, getApps, cert, App } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { getMessaging } from 'firebase-admin/messaging'

// ✅ Função para formatar chave privada
function formatPrivateKey(key: string): string {
    if (!key) return ''

    // Remove aspas duplas e formata quebras de linha
    return key
        .replace(/\\n/g, '\n')
        .replace(/^"/, '')
        .replace(/"$/, '')
        .trim()
}

// ✅ Validar variáveis de ambiente
function validateEnvVars() {
    const requiredVars = [
        'FIREBASE_PROJECT_ID',
        'FIREBASE_CLIENT_EMAIL',
        'FIREBASE_PRIVATE_KEY'
    ]

    const missing = requiredVars.filter(varName => !process.env[varName])

    if (missing.length > 0) {
        throw new Error(`Variáveis de ambiente Firebase não configuradas: ${missing.join(', ')}`)
    }
}

// ✅ Inicializar Firebase Admin SDK
let firebaseApp: App | null = null

export function getFirebaseApp(): App {
    if (firebaseApp) return firebaseApp

    try {
        // Verificar se já existe uma instância
        const existingApps = getApps()
        if (existingApps.length > 0) {
            firebaseApp = existingApps[0]
            return firebaseApp
        }

        // Validar variáveis de ambiente
        validateEnvVars()

        // Inicializar nova instância
        firebaseApp = initializeApp({
            credential: cert({
                projectId: process.env.FIREBASE_PROJECT_ID!,
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL!,
                privateKey: formatPrivateKey(process.env.FIREBASE_PRIVATE_KEY!),
            }),
        })

        console.log('✅ Firebase Admin SDK inicializado:', firebaseApp.name)
        return firebaseApp

    } catch (error) {
        console.error('❌ Erro ao inicializar Firebase Admin SDK:', error)
        throw new Error(`Firebase Admin SDK initialization failed: ${error}`)
    }
}

// ✅ Funções auxiliares
export function getFirebaseFirestore() {
    const app = getFirebaseApp()
    return getFirestore(app)
}

export function getFirebaseMessaging() {
    const app = getFirebaseApp()
    return getMessaging(app)
}

export function getFirebaseAuth() {
    const app = getFirebaseApp()
    return getAuth(app)
}