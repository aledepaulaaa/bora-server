//bora-server/src/services/jobScheduler.ts
import cron, { ScheduledTask } from 'node-cron'

// 1. Importa as funções "o quê fazer" do nosso novo módulo de handlers
import {
    enviarListaDiaria,
    enviarLembretesPessoais,
    acionarLembretesProximos,
    notificarUsuariosDoResetGratuito,
} from './jobHandlers'
import { enviarDicasPersonalizadasPremium } from './jobPremiumUsers'
// import { sendAdminTestReminder } from './jobTestHandler'

// Array para manter o controle de todas as tarefas agendadas
const scheduledTasks: ScheduledTask[] = []

/**
 * Agenda todas as tarefas recorrentes do servidor.
 */
export function startCronJobs() {
    stopCronJobs() // Garante que não haja tarefas duplicadas
    console.log('Agendando cron jobs...')

    // Roda a cada 2 minutos para verificar lembretes próximos
    scheduledTasks.push(cron.schedule('*/2 * * * *', acionarLembretesProximos))

    // Roda a cada 5 minutos para enviar lembretes no horário
    scheduledTasks.push(cron.schedule('*/2 * * * *', enviarLembretesPessoais))
    // console.log("!!! MODO DE TESTE ATIVADO: Verificando lembretes a cada minuto. !!!")
    // scheduledTasks.push(cron.schedule('* * * * *', sendPersonalReminders))

    // Roda todo dia às 7h para notificar usuários do plano gratuito
    scheduledTasks.push(cron.schedule('0 7 * * *', notificarUsuariosDoResetGratuito))

    // Roda todo dia às 8h para enviar a lista de lembretes do dia
    scheduledTasks.push(cron.schedule('0 8 * * *', enviarListaDiaria))

    // Roda às 12h, 18h e 21h para enviar dicas interativas
    scheduledTasks.push(cron.schedule('0 12,18,21 * * *', enviarDicasPersonalizadasPremium))

    // console.log("!!! AGENDANDO JOB DE TESTE DE ADMIN PARA RODAR A CADA MINUTO !!!")
    // scheduledTasks.push(cron.schedule('* * * * *', sendAdminTestReminder))

    console.log('✅ Cron jobs agendados com sucesso!')
}

/**
 * Para todas as tarefas agendadas. Essencial ao reiniciar o cliente.
 */
export function stopCronJobs() {
    if (scheduledTasks.length > 0) {
        console.log('Parando cron jobs agendados...')
        scheduledTasks.forEach(task => task.stop())
        scheduledTasks.length = 0 // Limpa o array
    }
}