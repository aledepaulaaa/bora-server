// testGemini.ts
import 'dotenv/config' // Carrega suas variáveis de ambiente
import { processarIntencaoUsuario } from './src/services/geminiService'

async function run() {
    console.log("Testando Gemini...")
    const res = await processarIntencaoUsuario("Me lembra de pagar o boleto da internet amanhã as 10 da manhã", "Alexandre")
    console.log("Resultado:", JSON.stringify(res, null, 2))
}

run()