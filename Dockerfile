# Estágio 1: Builder - Onde o código é compilado
# Usamos uma imagem Node completa para ter todas as ferramentas de build
FROM node:18-alpine AS builder

WORKDIR /app

# Copia os package.json e instala TODAS as dependências (incluindo devDependencies)
COPY package*.json ./
RUN npm install

# Copia o resto do código-fonte
COPY . .

# Executa o build do TypeScript para gerar o JavaScript em /dist
RUN npm run build

# --- PONTO CRÍTICO PARA O WHATSAPP ---
# A linha abaixo copia o binário do Chromium que o whatsapp-web.js baixa.
# Sem isso, a imagem final não terá o navegador para rodar!
RUN cp -r node_modules/puppeteer/.local-chromium /home/

# Estágio 2: Runner - A imagem final e otimizada
# Usamos uma imagem "slim" que é menor e mais segura
FROM node:18-slim

WORKDIR /app

# Copia os package.json do builder
COPY --from=builder /app/package*.json ./

# Instala SOMENTE as dependências de produção
RUN npm install --omit=dev

# --- PONTO CRÍTICO PARA O WHATSAPP (PARTE 2) ---
# Copia o binário do Chromium do estágio de build para o local correto
COPY --from=builder /home/.local-chromium /app/node_modules/puppeteer/.local-chromium

# Copia a pasta 'dist' (JavaScript compilado) do builder
COPY --from=builder /app/dist ./dist

# Expõe a porta que seu servidor usa (ajuste se for diferente)
EXPOSE 2525

# O comando para iniciar o servidor usando PM2-runtime
# PM2-runtime é otimizado para containers e gerencia o processo para nós.
CMD ["npx", "pm2-runtime", "dist/index.js"]