//bora-server/src/routes/whatsapp.routes.ts
import { Router } from 'express'
import { sendMessageController } from '../controllers/whatsapp.controller'

const router = Router()

router.post('/api/send-message', sendMessageController)

export default router
