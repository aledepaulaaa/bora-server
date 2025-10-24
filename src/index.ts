//melembra-server/src/index.ts
import express from 'express'
import dotenv from 'dotenv'
import whatsappRoutes from './routes/whatsapp.routes'
import { getFirebaseFirestore } from './database/firebase-admin' // Ensure Firebase is initialized
import { initializeWhatsAppService } from './services/whatsapp.service'

dotenv.config()

const app = express()
app.use(express.json())

// Ensure Firebase is initialized when the server starts
getFirebaseFirestore()
initializeWhatsAppService()

app.get('/', (req, res) => {
    res.status(200).send('WhatsApp server is running.')
})

app.use('/api/whatsapp', whatsappRoutes)

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`)
})
