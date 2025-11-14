//bora-server/src/services/jobScheduler.ts
import cron, { ScheduledTask } from 'node-cron'

// 1. Importa apenas as funções que são realmente jobs do handler
import {
    enviarListaDiaria,
    enviarLembretesPessoais,
    acionarLembretesProximos,
    notificarUsuariosDoResetGratuito,
} from './jobHandlers'
import { enviarDicasPersonalizadasPremium } from './jobPremiumUsers'

const scheduledTasks: ScheduledTask[] = []

/**
 * Agenda todas as tarefas recorrentes do servidor.
 */
export function startCronJobs() {
    stopCronJobs() // Garante que não haja tarefas duplicadas
    console.log('Agendando cron jobs...')

    scheduledTasks.push(cron.schedule('*/2 * * * *', acionarLembretesProximos))
    scheduledTasks.push(cron.schedule('*/2 * * * *', enviarLembretesPessoais))
    scheduledTasks.push(cron.schedule('0 7 * * *', notificarUsuariosDoResetGratuito))
    scheduledTasks.push(cron.schedule('0 8 * * *', enviarListaDiaria))
    scheduledTasks.push(cron.schedule('0 8,12,16,18,21 * * *', enviarDicasPersonalizadasPremium))

    console.log('✅ Cron jobs agendados com sucesso!')
}

/**
 * Para todas as tarefas agendadas.
 */
export function stopCronJobs() {
    if (scheduledTasks.length > 0) {
        console.log('Parando cron jobs agendados...')
        scheduledTasks.forEach(task => task.stop())
        scheduledTasks.length = 0
    }
}