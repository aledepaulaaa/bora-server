// bora-server/src/services/geminiService.ts
import { GoogleGenerativeAI } from "@google/generative-ai"
import moment from 'moment-timezone'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "")

const model = genAI.getGenerativeModel({
    model: "gemini-flash-lite-latest", // Seu modelo testado
    generationConfig: { responseMimeType: "application/json" }
})

export interface IAIProcessedReminder {
    isValid: boolean
    missingInfo?: string
    reminderData?: {
        title?: string
        scheduledAt?: string
        recurrence?: string
        category?: string
        cor?: string
        sobre?: string
    }
}

export async function processarIntencaoUsuario(
    input: string | { mimeType: string; data: string },
    userName: string,
    dadosAtuais?: any // <--- NOVO: Recebe o JSON parcial que já temos
): Promise<IAIProcessedReminder> {

    const now = moment().tz("America/Sao_Paulo")
    const nowString = now.format("YYYY-MM-DD HH:mm:ss [Dia da semana:] dddd")

    // Montamos um resumo do que já sabemos para a IA completar
    const contextoAnterior = dadosAtuais
        ? `CONTEXTO DA CONVERSA (O que já sabemos): ${JSON.stringify(dadosAtuais)}. O usuário está respondendo para completar ou alterar estes dados.`
        : "Início de conversa. Extraia os dados do zero."

    const prompt = `
    Você é o assistente inteligente do app "Bora". Interprete o pedido e extraia dados JSON.
    
    DATA/HORA ATUAL (Brasil): ${nowString}
    USUÁRIO: ${userName}
    ${contextoAnterior}

    REGRAS:
    1. **Recorrência**: 'Não repetir' (padrão), 'Diariamente', 'Semanalmente', 'Mensalmente'.
    2. **Cor**: Hexadecimal (Padrão: '#BB86FC').
    3. **Categoria**: 'Saúde', 'Estudos', 'Trabalho', 'Casa', 'Financeiro', 'Lazer', 'Geral', 'Outros'. Se o usuário escolher 'outros', pedir para ele definir um nome específico.
    4. **Data**: Converta "amanhã", "hoje", "próxima sexta" para ISO 8601 exato. Se o usuário só der a hora, assuma o dia mais lógico (hoje ou amanhã).
    5. **Faltando Dados**: Se tiver título mas não tiver data/hora, retorne "isValid": false e pergunte em "missingInfo".
    6. **Mesclar**: Se já existir dados no contexto, mantenha-os a menos que o usuário peça para mudar.

    JSON DE RESPOSTA:
    {
      "isValid": boolean, (True apenas se tivermos pelo menos Título E Data/Hora)
      "missingInfo": string | null, (Pergunta amigável se faltar algo)
      "reminderData": {
        "title": string,
        "scheduledAt": string (ISO8601),
        "recurrence": string,
        "category": string,
        "cor": string,
        "sobre": string
      }
    }

    ENTRADA DO USUÁRIO:
    ${typeof input === 'string' ? `Texto: "${input}"` : `[Áudio enviado]`}
    `

    try {
        let result;
        if (typeof input === 'string') {
            result = await model.generateContent(prompt)
        } else {
            result = await model.generateContent([
                { inlineData: { mimeType: input.mimeType, data: input.data } },
                { text: prompt }
            ])
        }

        return JSON.parse(result.response.text()) as IAIProcessedReminder

    } catch (error) {
        console.error("❌ Erro Gemini:", error)
        return { isValid: false, missingInfo: "Erro técnico. Tente texto.", reminderData: undefined }
    }
}