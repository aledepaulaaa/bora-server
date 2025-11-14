# Bora — Servidor (bora-server)

Resumo rápido
-------------
Servidor Node.js + TypeScript que orquestra integração com WhatsApp (whatsapp-web.js) e Firebase Admin para enviar lembretes, executar jobs agendados e expor um endpoint de envio de mensagens. Desenvolvido por Alexandre de Paula — https://github.com/aledepaulaaa

Estrutura de pastas
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
- .wwebjs_auth/ (sessão do WhatsApp)
- .wwebjs_cache/ (cache do WhatsApp)

Arquivos principais (links para abrir)
-------------------------------------
- [src/index.ts](src/index.ts) — ponto de entrada do servidor.
- [src/controllers/whatsapp.controller.ts](src/controllers/whatsapp.controller.ts) — controlador HTTP para envio manual de mensagens (`sendMessageController`).
  - Símbolo: [`sendMessageController`](src/controllers/whatsapp.controller.ts)
- [src/routes/whatsapp.routes.ts](src/routes/whatsapp.routes.ts) — define rota POST /api/send-message.
- [src/database/firebase-admin.ts](src/database/firebase-admin.ts) — inicializa e exporta helpers do Firebase Admin.
  - Símbolo: [`getFirebaseFirestore`](src/database/firebase-admin.ts)
- [src/interfaces/IReminder.ts](src/interfaces/IReminder.ts) — interface TypeScript do lembrete (`IReminder`).
  - Símbolo: [`IReminder`](src/interfaces/IReminder.ts)
- Serviços relacionados ao WhatsApp e jobs:
  - [src/services/whatsapp.service.ts](src/services/whatsapp.service.ts) — orquestrador que inicia o serviço WhatsApp.
    - Símbolo: [`initializeWhatsAppService`](src/services/whatsapp.service.ts)
  - [src/services/whatsappClient.ts](src/services/whatsappClient.ts) — cria/configura cliente whatsapp-web.js.
    - Símbolos: [`createAndConfigureClient`](src/services/whatsappClient.ts), [`initialize`](src/services/whatsappClient.ts), [`getClient`](src/services/whatsappClient.ts)
  - [src/services/whatsappBot.ts](src/services/whatsappBot.ts) — lógica de conversas e fluxo de criação de lembretes via WhatsApp.
    - Símbolos: [`handleIncomingMessage`](src/services/whatsappBot.ts), [`startReminderFlow`](src/services/whatsappBot.ts), [`handleDateTimeResponse`](src/services/whatsappBot.ts)
  - [src/services/jobHandlers.ts](src/services/jobHandlers.ts) — funções que executam o envio de lembretes agendados.
    - Símbolo: [`sendWhatsappMessage`](src/services/jobHandlers.ts)
  - [src/services/jobScheduler.ts](src/services/jobScheduler.ts) — agenda tarefas cron (`startCronJobs`, `stopCronJobs`).
    - Símbolos: [`startCronJobs`](src/services/jobScheduler.ts), [`stopCronJobs`](src/services/jobScheduler.ts)
  - [src/services/jobTestHandler.ts](src/services/jobTestHandler.ts) — job de teste para admin (`sendAdminTestReminder`).
    - Símbolo: [`sendAdminTestReminder`](src/services/jobTestHandler.ts)
  - [src/services/jobPremiumUsers.ts` / `jobWhatsApp.ts`] — módulos auxiliares para jobs premium / integrações.

Funcionalidade por módulo
-------------------------
- controllers/
  - whatsapp.controller.ts
    - Exponibiliza endpoint HTTP para enviar mensagem via Whatsapp. Valida payload e chama função de envio de `jobHandlers`.
    - Veja: [`sendMessageController`](src/controllers/whatsapp.controller.ts)

- database/
  - firebase-admin.ts
    - Inicializa Firebase Admin SDK usando variáveis de ambiente seguras, provê helpers: [`getFirebaseFirestore`](src/database/firebase-admin.ts), [`getFirebaseAuth`](src/database/firebase-admin.ts), [`getFirebaseMessaging`](src/database/firebase-admin.ts).
    - Trata formatação da chave privada e validação das variáveis de ambiente.

- interfaces/
  - IReminder.ts
    - Define `IReminder` (campos: id, userId, title, type, phoneNumber?, scheduledAt, sent?, recurrence?).

- routes/
  - whatsapp.routes.ts
    - Roteador Express que registra o controlador: [src/routes/whatsapp.routes.ts](src/routes/whatsapp.routes.ts)

- services/
  - whatsappClient.ts
    - Cria o cliente `whatsapp-web.js`, configura eventos (qr, authenticated, ready, message, disconnected), e arranca/paralisa cron jobs quando necessário.
    - Funções: [`createAndConfigureClient`](src/services/whatsappClient.ts), [`initialize`](src/services/whatsappClient.ts), [`getClient`](src/services/whatsappClient.ts)
  - whatsappBot.ts
    - Lógica de fluxo conversacional: inicia fluxo de criação de lembrete, salva estado em Firestore, faz parsing de datas com `chrono-node`, persiste lembrete no Firestore.
    - Funções: [`handleIncomingMessage`](src/services/whatsappBot.ts), [`startReminderFlow`](src/services/whatsappBot.ts), [`handleDateTimeResponse`](src/services/whatsappBot.ts)
  - whatsapp.service.ts
    - Wrapper que chama [`initialize`](src/services/whatsappClient.ts) e centraliza inicialização.
    - Símbolo: [`initializeWhatsAppService`](src/services/whatsapp.service.ts)
  - jobHandlers.ts
    - Funções que consultam Firestore e enviam mensagens (WhatsApp) para usuários conforme agendamento; reutilizado por cron jobs.
    - Símbolo: [`sendWhatsappMessage`](src/services/jobHandlers.ts)
  - jobScheduler.ts
    - Agenda cron jobs com `node-cron` e expõe `startCronJobs` / `stopCronJobs`.
    - Símbolos: [`startCronJobs`](src/services/jobScheduler.ts), [`stopCronJobs`](src/services/jobScheduler.ts)
  - jobTestHandler.ts
    - Job de teste que pesquisa lembretes do admin e envia mensagem de teste.
    - Símbolo: [`sendAdminTestReminder`](src/services/jobTestHandler.ts)
  - jobPremiumUsers.ts / jobWhatsApp.ts
    - Jobs auxiliares para casos específicos (premium, listas, dicas).

Como instalar e executar

-----------------------
1. No diretório `bora-server`:
   ```bash
   npm install

-----------------------
2. Variáveis de ambiente: crie um arquivo .env com pelo menos:
```
FIREBASE_PROJECT_ID
FIREBASE_CLIENT_EMAIL
FIREBASE_PRIVATE_KEY (formatada com quebras de linha como \n ou sem aspas — firebase-admin.ts faz formatação)
PORT (opcional, padrão 3001)
Outras variáveis específicas do fluxo WhatsApp ou testes (p.ex. telefone admin), se aplicável.
```
-----------------------
3. Rodar em desenvolvimento:
```
npm run dev
```
-----------------------
## Script usa nodemon --exec ts-node src/index.ts (ver package.json). ##

4. Build e start para produção:
```
npm run build    # transpila TypeScript (tsc)
npm start        # executa node dist/index.js
```
-----------------------

### Pontos de inicialização ###

*** A inicialização principal chama: ***

```
index.ts -> chama getFirebaseFirestore[](src/database/firebase-admin.ts) para garantir Firebase e [](http://_vscodecontentref_/1)initializeWhatsAppService para iniciar WhatsApp.
```
-----------------------
Quando o cliente WhatsApp fica pronto, são disparados os cron jobs (startCronJobs) via jobScheduler.ts.
-----------------------

## Lista de pacotes NPM usados (conforme package.json) ##

```
Dependencies:

@types/dotenv ^6.1.1
@types/qrcode-terminal ^0.12.2
chrono-node ^2.9.0
dotenv ^17.2.2
express ^5.1.0
firebase-admin ^13.5.0
node-cron ^4.2.1
nodemon ^3.1.10
qrcode-terminal ^0.12.0
whatsapp-web.js ^1.34.1
```
DevDependencies:
```
@types/node-cron ^3.0.11
```
### Observações importantes ###
A sessão do WhatsApp é armazenada em .wwebjs_auth/. Não comitar credenciais sensíveis.
firebase-admin.ts valida variáveis de ambiente e formata a private key; garanta que elas existam no .env.
Jobs de cron e envio dependem do cliente WhatsApp estar pronto; whatsappClient cuida de reinicialização e limpeza de sessão quando necessário.
Logs de diagnóstico estão espalhados nos módulos para ajudar rastrear autenticação, QR e erros.

### Referências rápidas (links) ###
Arquivo principal: index.ts
Controlador: sendMessageController — whatsapp.controller.ts
Rota: whatsapp.routes.ts
Firebase Admin: getFirebaseFirestore — firebase-admin.ts
Interface: IReminder — IReminder.ts
Inicialização WhatsApp: initializeWhatsAppService — whatsapp.service.ts
Cliente WhatsApp: createAndConfigureClient[](src/services/whatsappClient.ts), [](http://_vscodecontentref_/12)initialize[](src/services/whatsappClient.ts), [](http://_vscodecontentref_/13)getClient — whatsappClient.ts
Bot/Fluxo: handleIncomingMessage — whatsappBot.ts
Jobs e scheduler: sendWhatsappMessage — jobHandlers.ts, startCronJobs — jobScheduler.ts, sendAdminTestReminder — jobTestHandler.ts

## Créditos ##
Desenvolvido por Alexandre de Paula — https://github.com/aledepaulaaa

## Licença ##
