//bora-server/src/services/whatsapp.service.ts
import { initialize } from './whatsappClient'

// A única responsabilidade deste arquivo é iniciar o serviço.
// Toda a lógica de eventos foi movida para dentro de whatsappClient.ts
// para evitar problemas de timing e escopo.
export function initializeWhatsAppService() {
    console.log("Orquestrador: Disparando inicialização do serviço do WhatsApp...")
    initialize()
}