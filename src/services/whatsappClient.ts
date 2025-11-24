// bora-server/src/services/whatsappClient.ts
import fs from 'fs'
import qrcode from 'qrcode-terminal'
import { Client, LocalAuth } from 'whatsapp-web.js'
import { handleIncomingMessage } from './whatsappBot'
import { startCronJobs, stopCronJobs } from './jobScheduler'

let client: Client
// Variável de controle para impedir disparos múltiplos do evento 'ready'
let isClientReady = false

function createAndConfigureClient() {
    console.log("Iniciando nova instância do cliente WhatsApp...")

    // Reset do estado
    isClientReady = false

    client = new Client({
        authStrategy: new LocalAuth({
            dataPath: './.wwebjs_auth',
            clientId: 'business_client' // Adiciona um ID específico para organizar a pasta
        }),
        // REMOVIDO: webVersionCache remoto. 
        // Para Business, vamos deixar a lib negociar a versão mais compatível localmente.

        // Aumenta o tempo de resposta para mensagens (Business demora mais)
        qrMaxRetries: 3,

        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage', // Crítico para evitar crash de memória
                '--disable-gpu',
                '--disable-extensions',
                '--no-first-run',
                '--no-zygote',
                // Argumento vital para contas com muitas conversas/dados:
                '--unhandled-rejections=strict'
            ],
            userAgent: 'Mozilla/5.0 (Macintosh Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
        } as any
    })

    client.on('qr', (qr) => {
        console.log('--- QR CODE GERADO (Escaneie com o WhatsApp Business) ---')
        qrcode.generate(qr, { small: true })
    })

    client.on('loading_screen', (percent, message) => {
        console.log(`⏳ Sincronizando: ${percent}% - ${message}`)
    })

    client.on('authenticated', () => {
        console.log('✅ Autenticado! Aguardando sincronização final...')
    })

    client.on('auth_failure', async (msg) => {
        console.error('❌ Falha crítica na autenticação:', msg)
        await cleanSessionAndRestart()
    })

    // --- CORREÇÃO DO LOOP DE READY ---
    client.on('ready', () => {
        if (isClientReady) {
            console.log('ℹ️ Evento Ready duplicado ignorado.')
            return
        }

        isClientReady = true
        console.log('✅✅ Cliente WhatsApp Business TOTALMENTE carregado!')
        startCronJobs()
    })

    client.on('message', handleIncomingMessage)

    client.on('disconnected', async (reason) => {
        console.warn(`⚠️ Cliente desconectado. Motivo: ${reason}`)
        stopCronJobs()
        isClientReady = false // Reseta o estado

        // Se for LOGOUT explícito ou conflito de navegação, limpamos tudo.
        if (reason === 'LOGOUT' || (reason as any) === 'NAVIGATION') {
            console.log("Detectado Logout/Navegação crítica. Limpando sessão...")
            await cleanSessionAndRestart()
        } else {
            // Se for queda de net, deixamos o wwebjs tentar reconectar (não chamamos initialize aqui)
            console.log("Desconexão leve. Aguardando tentativa automática de reconexão da lib...")
        }
    })
}

// Função auxiliar para limpeza segura
async function cleanSessionAndRestart() {
    try {
        if (client) await client.destroy()
    } catch (e) { console.log('Erro ao destruir cliente (ignorável):', e) }

    const sessionPath = './.wwebjs_auth'
    console.log(`Limpando pasta de sessão: ${sessionPath}`)

    try {
        if (fs.existsSync(sessionPath)) {
            await fs.promises.rm(sessionPath, { recursive: true, force: true })
            console.log("Pasta de sessão removida.")
        }
    } catch (err) {
        console.error("Erro ao apagar pasta:", err)
    }

    console.log("Reiniciando em 5 segundos...")
    setTimeout(initialize, 5000)
}

export function initialize() {
    createAndConfigureClient()
    client.initialize().catch((err: any) => {
        console.error("❌ Erro fatal ao inicializar cliente:", err)
    })
}

export function getClient(): Client {
    if (!client) {
        throw new Error("Cliente do WhatsApp não foi inicializado.")
    }
    return client
}

process.on('SIGINT', async () => {
    console.log('(SIGINT) Fechando servidor...')
    if (client) await client.destroy()
    process.exit(0)
})