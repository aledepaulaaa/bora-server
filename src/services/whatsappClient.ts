import { Client, LocalAuth } from 'whatsapp-web.js'
import qrcode from 'qrcode-terminal'
import fs from 'fs'
import { handleIncomingMessage } from './whatsappBot'
import { startCronJobs, stopCronJobs } from './jobScheduler'
// import puppeteer from 'puppeteer'

let client: Client

function createAndConfigureClient() {
    console.log("Iniciando nova instância do cliente WhatsApp...")
    client = new Client({
        authStrategy: new LocalAuth({ dataPath: undefined}),
        puppeteer: ({
            headless: true, // Garante que o navegador rode em segundo plano
            // executablePath: puppeteer.executablePath(),
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu', // Desabilitar GPU é bom para ambientes de servidor sem interface gráfica
            ],
            // <<< MELHORIA PRINCIPAL AQUI >>>
            // O User Agent abaixo é conhecido por ser estável e compatível com contas do WhatsApp Business.
            // Para satisfazer as tipagens do pacote, fazemos um cast para `any`.
            userAgent: 'Mozilla/5.0 (Macintosh Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
        }) as any
    })

    client.on('qr', (qr) => qrcode.generate(qr, { small: true }))
    // handler do 'code' para pegar o código de 8 caracteres conectar sem qr-code
    client.on('code', (code) => {
        console.log('================================================')
        console.log(`> Código de conexão: ${code}`)
        console.log('> Abra seu WhatsApp no celular > Aparelhos Conectados > Conectar com número de telefone e digite o código acima.')
        console.log('================================================')
    })
    client.on('authenticated', () => console.log('✅ Autenticado com sucesso!'))
    client.on('auth_failure', (msg) => console.error('❌ Falha na autenticação:', msg))
    client.on('error', (err) => console.error('Ocorreu um erro inesperado no cliente:', err))
    client.on('message', handleIncomingMessage)

    // Sua lógica de orquestração (que está excelente)
    client.on('ready', () => {
        console.log('✅ Cliente WhatsApp está pronto!')
        startCronJobs() // Inicia os jobs somente quando a conexão está 100%
    })

    // Sua lógica de reconexão autocurável (excelente!)
    client.on('disconnected', async (reason) => {
        console.warn('Cliente desconectado:', reason)
        stopCronJobs() // Para os jobs imediatamente para evitar erros
        try {
            await client.destroy()
            console.log("Instância do cliente destruída.")
            const sessionPath = './.wwebjs_auth'
            if (fs.existsSync(sessionPath)) {
                // Usando a API de promessas do fs para consistência
                await fs.promises.rm(sessionPath, { recursive: true, force: true })
                console.log("Sessão antiga limpa com sucesso.")
            }
        } catch (error) {
            console.error("Erro ao limpar e destruir o cliente:", error)
        } finally {
            console.log("Tentando reinicializar o processo em 10 segundos...")
            setTimeout(initialize, 10000) // Tenta reconectar após 10s
        }
    })
}

export function initialize() {
    createAndConfigureClient()
    client.initialize().catch((err: any) => {
        console.error("Falha crítica ao inicializar o cliente. O erro pode ser falta de dependências ou sessão corrompida.", err)
        // O process.exit(1) é uma boa estratégia aqui, pois o PM2 irá reiniciar o processo automaticamente.
        process.exit(1)
    })
}

export function getClient(): Client {
    if (!client) {
        throw new Error("Cliente do WhatsApp não foi inicializado.")
    }
    return client
}