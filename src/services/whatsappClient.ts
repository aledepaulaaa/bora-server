// melembra-server/src/services/whatsappClient.ts
import { Client, LocalAuth, Message } from 'whatsapp-web.js'
import qrcode from 'qrcode-terminal'
import fs from 'fs'
import { handleIncomingMessage } from './whatsappBot'

let client: Client

function createAndConfigureClient() {
    console.log("Iniciando nova instância do cliente WhatsApp...")
    client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: {
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        }
    })

    client.on('qr', (qr) => qrcode.generate(qr, { small: true }))
    client.on('ready', () => console.log('✅ Cliente WhatsApp está pronto!'))
    client.on('authenticated', () => console.log('✅ Autenticado com sucesso!'))
    client.on('auth_failure', (msg) => console.error('❌ Falha na autenticação:', msg))
    client.on('error', (err) => console.error('Ocorreu um erro inesperado no cliente:', err))
    client.on('disconnected', async (reason) => {
        console.log('Cliente desconectado:', reason)
        try {
            // A lógica de parar os jobs será feita pelo orquestrador
            await client.destroy()
            console.log("Instância do cliente destruída.")
            const sessionPath = './.wwebjs_auth'
            if (fs.existsSync(sessionPath)) {
                await fs.promises.rm(sessionPath, { recursive: true, force: true })
                console.log("Sessão limpa.")
            }
        } catch (error) {
            console.error("Erro ao limpar e destruir o cliente:", error)
        } finally {
            console.log("Reiniciando o processo de conexão em 10 segundos...")
            // Chama a função de inicialização global, não a si mesma
            setTimeout(initialize, 10000)
        }
    })
    client.on('message', handleIncomingMessage)
}

/**
 * Função de inicialização exportada. Cria e inicializa o cliente.
 */
export function initialize() {
    createAndConfigureClient()
    client.initialize().catch((err: any) => { // Tipagem explícita para o erro
        console.error("Falha crítica ao inicializar o cliente:", err)
        process.exit(1)
    })
}

/**
 * Exporta uma função para obter a instância do cliente.
 */
export const getClient = (): Client => {
    if (!client) {
        throw new Error("Cliente do WhatsApp não foi inicializado.")
    }
    return client
}