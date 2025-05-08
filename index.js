// File di ingresso principale del bot
require('dotenv').config();
const { bot, stage } = require('./config/bot');
const { connectToDatabase } = require('./config/database');
const commands = require('./handlers/commands');
const callbacks = require('./handlers/callbacks');
const middleware = require('./handlers/middleware');
const logger = require('./utils/logger');
const { sceneCleanerMiddleware, setupPeriodicCleaner } = require('./utils/sceneCleaner');

// Flag per tracciare lo stato di shutdown
let isShuttingDown = false;

// Connessione al database
connectToDatabase()
  .then(() => logger.info('Connesso al database MongoDB'))
  .catch(err => {
    logger.error('Errore nella connessione al database:', err);
    process.exit(1);
  });

// Middleware di logging per tutte le richieste
bot.use((ctx, next) => {
  const start = Date.now();
  return next().then(() => {
    const responseTime = Date.now() - start;
    logger.request(ctx, responseTime);
  });
});

// Registra i middleware
bot.use(middleware.session());
bot.use(stage.middleware());

// Aggiungi il middleware di pulizia delle scene
bot.use(sceneCleanerMiddleware());

// Configura la pulizia periodica delle sessioni inattive
setupPeriodicCleaner(bot);

// Registra i gestori dei comandi
bot.start(commands.startCommand);
bot.command('vendi_kwh', commands.sellKwhCommand);
bot.command('le_mie_ricariche', commands.myChargesCommand);
bot.command('profilo', commands.profileCommand);
bot.command('help', commands.helpCommand);
bot.command('avvio_ricarica', commands.startChargeCommand);
bot.command('update_commands', commands.updateBotCommandsCommand);
bot.command('annulla', commands.cancelCommand);

// Registra i gestori delle callback
bot.action(/buy_kwh_(.+)/, callbacks.buyKwhCallback);
// Modificato da connector_ a current_ per corrispondere al pattern nella scene
bot.action(/current_(.+)/, callbacks.connectorTypeCallback);
bot.action('publish_sell', callbacks.publishSellCallback);
bot.action('cancel_sell', callbacks.cancelSellCallback);
bot.action('accept_conditions', callbacks.acceptConditionsCallback);
bot.action('cancel_buy', callbacks.cancelBuyCallback);
bot.action('send_request', callbacks.sendRequestCallback);
bot.action(/accept_offer_(.+)/, callbacks.acceptOfferCallback);
bot.action(/reject_offer_(.+)/, callbacks.rejectOfferCallback);
bot.action(/ready_to_charge_(.+)/, callbacks.readyToChargeCallback);
bot.action(/charging_started_(.+)/, callbacks.chargingStartedCallback);
bot.action(/charging_ok_(.+)/, callbacks.chargingOkCallback);
bot.action(/charging_issues_(.+)/, callbacks.chargingIssuesCallback);
bot.action(/charging_completed_(.+)/, callbacks.chargingCompletedCallback);
bot.action(/confirm_kwh_(.+)/, callbacks.confirmKwhCallback);
bot.action(/dispute_kwh_(.+)/, callbacks.disputeKwhCallback);
bot.action(/set_payment_(.+)/, callbacks.setPaymentCallback);
bot.action(/payment_sent_(.+)/, callbacks.paymentSentCallback);
bot.action(/payment_confirmed_(.+)/, callbacks.paymentConfirmedCallback);
bot.action(/payment_not_received_(.+)/, callbacks.paymentNotReceivedCallback);
bot.action(/donate_2_(.+)/, callbacks.donateFixedCallback);
bot.action(/donate_custom_(.+)/, callbacks.donateCustomCallback);
bot.action(/donate_skip_(.+)/, callbacks.donateSkipCallback);
bot.action(/feedback_positive_(.+)/, callbacks.feedbackPositiveCallback);
bot.action(/feedback_negative_(.+)/, callbacks.feedbackNegativeCallback);
bot.action(/cancel_charge_(.+)/, callbacks.cancelChargeCallback);
bot.action('send_manual_request', callbacks.sendManualRequestCallback);
bot.action('cancel_manual_request', callbacks.cancelManualRequestCallback);

// Gestione dei messaggi nei topic
bot.on(['message', 'channel_post'], middleware.topicMessageHandler);

// Gestione dei messaggi di testo (per handler specifici)
bot.on('text', middleware.textMessageHandler);

// Gestione dei messaggi con foto
bot.on('photo', middleware.photoMessageHandler);

// Gestione degli errori
bot.catch((err, ctx) => {
  logger.error(`Errore per ${ctx.updateType}:`, err);
});

// Funzione per avviare il bot con gestione errori e riprova
async function startBot(retryCount = 0, maxRetries = 5) {
  try {
    // Per i Background Worker su Render, dobbiamo usare sempre polling
    // Prima assicuriamoci che non ci siano webhook attivi
    await bot.telegram.deleteWebhook();
    logger.info('Eventuali webhook precedenti rimossi');
    
    // Attendiamo un breve momento dopo aver rimosso il webhook
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Imposta un timeout per il polling (importante per i Background Worker)
    await bot.launch({
      polling: {
        timeout: 30, // Timeout ridotto per essere più reattivi
        limit: 100   // Numero max di aggiornamenti da ottenere
      }
    });
    
    logger.info('Bot avviato in modalità polling (Background Worker)');
  } catch (error) {
    // Gestione specifica per il conflitto 409
    if (error.message && error.message.includes('409: Conflict')) {
      logger.warn(`Conflitto rilevato (409). Tentativo ${retryCount + 1}/${maxRetries}`);
      
      if (retryCount < maxRetries) {
        // Incrementa il tempo di attesa a ogni retry
        const waitTime = Math.min(5000 + (retryCount * 5000), 30000);
        logger.info(`Attendo ${waitTime/1000} secondi prima di riprovare...`);
        
        // Attendiamo un po' più a lungo prima di riprovare
        setTimeout(() => {
          startBot(retryCount + 1, maxRetries);
        }, waitTime);
      } else {
        logger.error('Numero massimo di tentativi raggiunto. Uscita.');
        process.exit(1);
      }
    } else {
      // Altro tipo di errore
      logger.error('Errore nell\'avvio del bot:', error);
      
      // In caso di errori gravi, attendiamo e riproviamo una volta
      if (retryCount < 1) {
        logger.info('Riprovo l\'avvio tra 10 secondi...');
        setTimeout(() => {
          startBot(retryCount + 1, maxRetries);
        }, 10000);
      } else {
        logger.error('Errore persistente nell\'avvio del bot. Uscita.');
        process.exit(1);
      }
    }
  }
}

// Gestione di shutdown grazia
const gracefulShutdown = (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  logger.info(`Bot in fase di terminazione (${signal})`);
  
  // Ferma il bot e termina il processo
  bot.stop(signal);
  
  // Se per qualche motivo il bot non si ferma, forziamo l'uscita dopo alcuni secondi
  setTimeout(() => {
    logger.info('Uscita forzata dopo timeout');
    process.exit(0);
  }, 5000);
};

// Gestione segnali di terminazione
process.once('SIGINT', () => gracefulShutdown('SIGINT'));
process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.once('SIGQUIT', () => gracefulShutdown('SIGQUIT'));

// Gestione eccezioni non catturate
process.on('uncaughtException', (err) => {
  logger.error('Eccezione non catturata:', err);
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Promise non gestita:', reason);
  gracefulShutdown('UNHANDLED_REJECTION');
});

// Avvia il bot
startBot();
