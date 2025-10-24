// melembra-server/src/services/whatsapp.service.ts
import { initialize, getClient } from './whatsappClient'
import { startCronJobs, stopCronJobs } from './jobScheduler'

export function initializeWhatsAppService() {
    console.log("Orquestrador: Iniciando serviço do WhatsApp...")

    // 1. Inicia o processo de criação e conexão.
    initialize()

    // 2. Obtém o cliente (agora temos certeza que a variável 'client' será definida)
    //    e anexa os listeners de orquestração.
    const client = getClient()

    client.on('ready', () => {
        console.log("Orquestrador: Cliente pronto. Iniciando cron jobs.")
        startCronJobs()
    })

    client.on('disconnected', () => {
        console.log("Orquestrador: Cliente desconectado. Parando cron jobs.")
        stopCronJobs()
    })
}