# Bora — Servidor (bora-server) 🚀

Pequeno servidor Node.js + TypeScript que integra WhatsApp (whatsapp-web.js) com Firebase Admin para enviar lembretes, executar jobs agendados e expor endpoints HTTP. Desenvolvido por Alexandre de Paula — https://github.com/aledepaulaaa ✨

Resumo rápido
-------------
- Tecnologias principais: Node.js, TypeScript, Express, whatsapp-web.js, Firebase Admin, node-cron. 🔧
- Objetivo: receber comandos/fluxos via WhatsApp, agendar lembretes e enviar mensagens programadas. ⏰

Estrutura de pastas 📁
-------------------
- src/
  - index.ts
  - controllers/
    - whatsapp.controller.ts
  - database/
    - firebase-admin.ts
  - interfaces/
    - IReminder.ts
  - routes/
    - whatsapp.routes.ts
  - services/
    - jobHandlers.ts
    - jobPremiumUsers.ts
    - jobScheduler.ts
    - jobTestHandler.ts
    - jobWhatsApp.ts
    - whatsapp.service.ts
    - whatsappBot.ts
    - whatsappClient.ts
- .env
- package.json
- tsconfig.json
- .wwebjs_auth/ (sessão do WhatsApp — não versionar) 🔐
- .wwebjs_cache/ (cache do WhatsApp) 🗂️

Arquivos principais 📂
---------------------
- src/index.ts — ponto de entrada.  
- src/controllers/whatsapp.controller.ts — endpoint HTTP para envio manual de mensagens.  
- src/routes/whatsapp.routes.ts — roteamento Express (ex: POST /api/send-message).  
- src/database/firebase-admin.ts — inicializa Firebase Admin (Firestore, Auth, Messaging).  
- src/interfaces/IReminder.ts — modelo TypeScript do lembrete.  
- src/services/** — lógica de integração com WhatsApp, jobs e scheduler.

Funcionalidade por módulo 🧭
---------------------------
- controllers/
  - whatsapp.controller.ts — valida payloads e aciona envio via serviços (jobHandlers). ✉️

- database/
  - firebase-admin.ts — prepara e exporta instâncias do Firebase Admin; trata private key e variáveis de ambiente. 🔑

- interfaces/
  - IReminder.ts — define propriedades de um lembrete (id, userId, title, phone, scheduledAt, recurrence, sent). 📝

- routes/
  - whatsapp.routes.ts — registra rotas HTTP e associa controllers. 🌐

- services/
  - whatsappClient.ts — cria/configura o cliente whatsapp-web.js e eventos (qr, ready, message, disconnected). 📡
  - whatsappBot.ts — fluxo conversacional (criação de lembretes, parsing de datas com chrono-node). 🤖
  - whatsapp.service.ts — orquestra a inicialização do serviço WhatsApp. ⚙️
  - jobHandlers.ts — envia mensagens programadas consultando Firestore. 📨
  - jobScheduler.ts — agenda jobs com node-cron (start/stop). 🗓️
  - jobTestHandler.ts — jobs de teste/admin. 🧪
  - jobPremiumUsers.ts / jobWhatsApp.ts — jobs auxiliares para funcionalidades específicas. ⭐

Instalação e execução ⚙️
-----------------------
1. No diretório do projeto:
   ```bash
   npm install
   ```
2. Crie um arquivo `.env` com pelo menos:
   - FIREBASE_PROJECT_ID  
   - FIREBASE_CLIENT_EMAIL  
   - FIREBASE_PRIVATE_KEY (formatada com quebras de linha como `\n` ou conforme firebase-admin.ts)  
   - PORT (opcional — padrão 3001)  
   - Outras variáveis específicas do projeto (telefone admin, flags, etc.)  
3. Rodar em desenvolvimento:
   ```bash
   npm run dev
   ```
   (usa nodemon + ts-node)  
4. Build e produção:
   ```bash
   npm run build
   npm start
   ```

Observações importantes ⚠️
-------------------------
<ul>
  <li>🔐 <strong>Sessão WhatsApp:</strong> armazenada em <code>.wwebjs_auth/</code> — <em>não</em> commitar.</li>
  <li>🧾 <strong>Chave privada do Firebase:</strong> mantenha <code>FIREBASE_PRIVATE_KEY</code> segura no <code>.env</code>; o módulo <code>firebase-admin.ts</code> faz formatações necessárias.</li>
  <li>🕒 <strong>Jobs e cron:</strong> só enviam mensagens quando o cliente WhatsApp estiver <em>ready</em>; o <code>whatsappClient</code> gerencia eventos e reinicializações.</li>
  <li>🧰 <strong>Logs:</strong> verifique logs gerados nos serviços para diagnosticar QR, autenticação e entrega de mensagens.</li>
  <li>📦 <strong>Arquivos sensíveis:</strong> adicionar <code>.wwebjs_auth/</code> e credenciais ao <code>.gitignore</code>.</li>
</ul>

Referências rápidas 🔎
--------------------
<ul>
  <li>📌 <a href="src/index.ts">src/index.ts</a> — ponto de entrada</li>
  <li>📌 <a href="src/controllers/whatsapp.controller.ts">src/controllers/whatsapp.controller.ts</a> — controlador HTTP</li>
  <li>📌 <a href="src/routes/whatsapp.routes.ts">src/routes/whatsapp.routes.ts</a> — rotas</li>
  <li>📌 <a href="src/database/firebase-admin.ts">src/database/firebase-admin.ts</a> — inicialização do Firebase Admin</li>
  <li>📌 <a href="src/interfaces/IReminder.ts">src/interfaces/IReminder.ts</a> — interface de lembrete</li>
  <li>📌 <a href="src/services/whatsappClient.ts">src/services/whatsappClient.ts</a> — cliente whatsapp-web.js</li>
  <li>📌 <a href="src/services/whatsappBot.ts">src/services/whatsappBot.ts</a> — fluxo do bot</li>
  <li>📌 <a href="src/services/jobScheduler.ts">src/services/jobScheduler.ts</a> — agendamento (cron)</li>
</ul>

Pacotes NPM utilizados 📦
------------------------
- Dependências:
  - express
  - whatsapp-web.js
  - firebase-admin
  - dotenv
  - chrono-node
  - node-cron
  - qrcode-terminal
  - nodemon (listado em dependencies aqui para conveniência)
  - @types/dotenv, @types/qrcode-terminal (tipos)

- DevDependencies:
  - @types/node-cron

(versões exatas em <code>package.json</code>) ✅

Créditos ✨
----------
Desenvolvido por Alexandre de Paula — https://github.com/aledepaulaaa

Licença 📜
---------
Verifique o arquivo de licença do projeto (se aplicável).  
Boa sorte — e mãos à obra! 👨‍💻✨
