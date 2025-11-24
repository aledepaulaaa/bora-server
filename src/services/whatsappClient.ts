// bora-server/src/services/whatsappClient.ts
import fs from 'fs'
import qrcode from 'qrcode-terminal'
import { Client, LocalAuth } from 'whatsapp-web.js'
import { handleIncomingMessage } from './whatsappBot'
import { startCronJobs, stopCronJobs } from './jobScheduler'

let client: Client

function createAndConfigureClient() {
    console.log("Iniciando nova instância do cliente WhatsApp...")

    client = new Client({
        authStrategy: new LocalAuth({ 
            dataPath: './.wwebjs_auth' // Define explicitamente o caminho para organização
        }),
        // --- CORREÇÃO 1: Fixar versão do WhatsApp Web ---
        // Isso impede que o bot quebre quando o WhatsApp atualiza o site deles.
        // Usamos o tipo 'remote' para pegar uma versão compatível confirmada pela comunidade.
        webVersionCache: {
            type: 'remote',
            remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
        },
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-extensions'
            ],
            // Mantemos o UserAgent pois ajuda no WhatsApp Business
            userAgent: 'Mozilla/5.0 (Macintosh Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
        } as any
    })

    client.on('qr', (qr) => {
        console.log('--- QR CODE GERADO ---')
        qrcode.generate(qr, { small: true })
    })

    client.on('code', (code) => {
        console.log(`> Código de conexão: ${code}`)
    })

    client.on('loading_screen', (percent, message) => {
        console.log(`⏳ Carregando WhatsApp Web: ${percent}% - ${message}`)
    })

    client.on('authenticated', () => {
        console.log('✅ Autenticado com sucesso!')
    })

    // --- CORREÇÃO 2: Só apagar sessão se a senha estiver errada ---
    client.on('auth_failure', async (msg) => {
        console.error('❌ Falha crítica na autenticação (Sessão inválida):', msg)
        stopCronJobs()
        
        // Aqui sim, se a autenticação falhou, apagamos a pasta para gerar novo QR Code
        const sessionPath = './.wwebjs_auth'
        if (fs.existsSync(sessionPath)) {
            console.log("Apagando sessão corrompida...")
            await fs.promises.rm(sessionPath, { recursive: true, force: true })
        }
        
        // Reinicia processo drasticamente ou aguarda intervenção manual
        // process.exit(1) // Opcional: força o PM2 a reiniciar limpo
    })

    client.on('ready', () => {
        console.log('✅✅ Cliente WhatsApp está pronto e operante!')
        startCronJobs()
    })

    client.on('message', handleIncomingMessage)

    // --- CORREÇÃO 3: Lógica de Desconexão Suave ---
    // Não apague a sessão aqui! Apenas tente reconectar.
    client.on('disconnected', async (reason) => {
        console.warn(`⚠️ Cliente desconectado. Motivo: ${reason}`)
        stopCronJobs()

        // O whatsapp-web.js geralmente tenta reconectar sozinho se não destruirmos o client.
        // Mas se a conexão cair de vez (ex: "LOGOUT" pelo celular), precisamos reiniciar.
        
        if (reason === 'LOGOUT') {
             console.log("Detectado Logout ou Navegação indevida. Reiniciando sessão...")
             try {
                 await client.destroy()
             } catch (e) { /* ignorar erro de destroy */ }
             
             // Se foi logout, aí sim limpamos a sessão
             if (reason === 'LOGOUT') {
                 const sessionPath = './.wwebjs_auth'
                 if (fs.existsSync(sessionPath)) {
                    await fs.promises.rm(sessionPath, { recursive: true, force: true })
                 }
             }
             initialize() // Recria o cliente
        } else {
            console.log("Desconexão temporária. O cliente tentará reconectar automaticamente...")
            // Não fazemos nada drástico, deixamos a lib tentar o resume.
        }
    })
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

// --- Tratamento de encerramento do servidor (CTRL+C) ---
// Isso evita que o Chrome fique aberto em background travando a reconexão futura
process.on('SIGINT', async () => {
    console.log('(SIGINT) Fechando servidor e cliente WhatsApp...')
    if (client) {
        await client.destroy()
    }
    process.exit(0)
})