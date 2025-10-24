//melembra-server/src/controllers/whatsapp.controllers.ts
import { Request, Response } from 'express'
import { sendWhatsappMessage } from '../services/jobHandlers'

export const sendMessageController = async (req: Request, res: Response) => {
    const { number, message } = req.body

    if (!number || !message) {
        return res.status(400).send({ error: 'Número e mensagem são obrigatórios.' })
    }

    try {
        const result = await sendWhatsappMessage(number, message)
        if (result && result.success) {
            res.status(200).send({ message: `Mensagem enviada para ${number}` })
        } else {
            res.status(500).send({ error: result?.error || 'Falha ao enviar mensagem.' })
        }
    } catch (error) {
        console.error('Erro no controlador ao enviar mensagem:', error)
        res.status(500).send({ error: 'Erro interno do servidor.' })
    }
}
