// File di ingresso principale del bot
require('dotenv').config();
const { bot, stage } = require('./config/bot');
const { connectToDatabase } = require('./config/database');
const commands = require('./handlers/commands');
const callbacks = require('./handlers/callbacks');
const middleware = require('./handlers/middleware');
const logger = require('./utils/logger');
const { sceneCleanerMiddleware, setupPeriodicCleaner } = require('./utils/sceneCleaner');
const mongoose = require('mongoose');

// Flag per tracciare lo stato di shutdown
let isShuttingDown = false;
let lockCheckInterval = null;
let botRunning = false;

// Schema per il lock del bot
const botLockSchema = new mongoose.Schema({
  lockId: { type: String, required: true, unique: true },
  instanceId: { type: String, required: true },
  createdAt: { type: Date, default: Date.now, expires: 60 } // TTL di 60 secondi
});

// Crea il modello BotLock
const BotLock = mongoose.model('BotLock', botLockSchema);

// Genera un ID univoco per questa istanza
const INSTANCE_ID = `instance_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
logger.info(`ID istanza generato: ${INSTANCE_ID}`);

// Connessione al database e inizializzazione
const init = async () => {
  try {
    // Connetti al database
    await connectToDatabase();
    logger.info('Connesso al database MongoDB');
    
    // Assicurati che l'indice TTL sia impostato
    await BotLock.collection.createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 });
    
    // Imposta i middleware e i gestori
    setupBot();
    
    // Tenta di acquisire il lock per avviare il bot
    await acquireLock();
  } catch (err) {
    logger.error('Errore di inizializzazione:', err);
    process.exit(1);
  }
};

// Configura il bot con tutti i middleware e gli handler
const setupBot = () => {
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
};

// Funzione per acquisire il lock nel database
const acquireLock = async () => {
  try {
    // Creiamo un documento di lock
    await BotLock.create({
      lockId: 'bot_lock',
      instanceId: INSTANCE_ID
    });
    
    logger.info(`Lock acquisito con successo da ${INSTANCE_ID}`);
    
    // Avvia il bot
    await startBot();
    
    // Imposta un timer per aggiornare periodicamente il lock
    lockCheckInterval = setInterval(async () => {
      if (isShuttingDown) return;
      
      try {
        // Aggiorna il timestamp del documento lock per evitare che scada
        await BotLock.updateOne(
          { lockId: 'bot_lock', instanceId: INSTANCE_ID },
          { $set: { createdAt: new Date() } }
        );
        
        // Verifica anche che il lock sia ancora nostro
        const lock = await BotLock.findOne({ lockId: 'bot_lock' });
        
        if (!lock || lock.instanceId !== INSTANCE_ID) {
          logger.warn(`Il lock è stato acquisito da un'altra istanza: ${lock?.instanceId}. Termino.`);
          gracefulShutdown('LOCK_LOST');
        }
      } catch (err) {
        logger.error('Errore nell\'aggiornamento del lock:', err);
        
        // Verifica se il lock esiste ancora
        try {
          const lock = await BotLock.findOne({ lockId: 'bot_lock' });
          if (!lock || lock.instanceId !== INSTANCE_ID) {
            logger.warn('Lock non disponibile o acquisito da altra istanza. Termino.');
            gracefulShutdown('LOCK_ERROR');
          }
        } catch (checkErr) {
          logger.error('Errore nella verifica del lock:', checkErr);
        }
      }
    }, 20000); // Ogni 20 secondi
  } catch (err) {
    // Se c'è un errore duplicato, il lock è già stato preso
    if (err.code === 11000) { // Codice di errore MongoDB per chiave duplicata
      logger.info('Lock già acquisito da un\'altra istanza. Attendo e riprovo...');
      
      // Verifica se l'istanza corrente può acquisire il lock
      setTimeout(async () => {
        try {
          // Controlla se il lock esiste e se appartiene a qualcun altro
          const existingLock = await BotLock.findOne({ lockId: 'bot_lock' });
          
          if (!existingLock) {
            logger.info('Lock non trovato, provo ad acquisirlo di nuovo.');
            await acquireLock();
          } else {
            logger.info(`Lock attualmente detenuto da: ${existingLock.instanceId}`);
            
            // Calcoliamo quanto tempo fa è stato aggiornato il lock
            const lockAge = Date.now() - existingLock.createdAt.getTime();
            
            // Se il lock è vecchio, proviamo a sovrascriverlo
            if (lockAge > 45000) { // 45 secondi
              logger.warn(`Lock vecchio (${Math.round(lockAge/1000)}s), tento di sostituirlo.`);
              
              try {
                await BotLock.deleteOne({ lockId: 'bot_lock' });
                logger.info('Lock vecchio rimosso, provo a riottenerlo.');
                await acquireLock();
              } catch (delErr) {
                logger.error('Errore nella rimozione del lock vecchio:', delErr);
                
                // Attendi e riprova
                setTimeout(() => acquireLock(), 15000);
              }
            } else {
              // Lock recente, attendi e riprova
              logger.info(`Lock recente (${Math.round(lockAge/1000)}s), riprovo tra 30 secondi.`);
              setTimeout(() => acquireLock(), 30000);
            }
          }
        } catch (checkErr) {
          logger.error('Errore nel controllo del lock esistente:', checkErr);
          setTimeout(() => acquireLock(), 30000);
        }
      }, 10000);
    } else {
      logger.error('Errore nell\'acquisizione del lock:', err);
      setTimeout(() => acquireLock(), 15000);
    }
  }
};

// Funzione per avviare il bot
const startBot = async () => {
  try {
    // Prima assicuriamoci che non ci siano webhook attivi
    await bot.telegram.deleteWebhook();
    logger.info('Eventuali webhook precedenti rimossi');
    
    // Attendiamo un breve momento dopo aver rimosso il webhook
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Avvia il bot in modalità polling
    await bot.launch({
      polling: {
        timeout: 30, // Timeout ridotto per essere più reattivi
        limit: 100   // Numero max di aggiornamenti da ottenere
      }
    });
    
    botRunning = true;
    logger.info('Bot avviato con successo in modalità polling (Background Worker)');
  } catch (error) {
    logger.error('Errore nell\'avvio del bot:', error);
    
    // Se abbiamo un errore 409, rilasciamo il lock e terminiamo
    if (error.message && error.message.includes('409: Conflict')) {
      logger.warn('Errore 409: Conflict. Rilascio il lock e termino.');
      await releaseLock();
      gracefulShutdown('CONFLICT_ERROR');
    } else {
      // Per altri errori, riprova tra 30 secondi
      logger.info('Riprovo l\'avvio tra 30 secondi...');
      setTimeout(startBot, 30000);
    }
  }
};

// Funzione per rilasciare il lock
const releaseLock = async () => {
  try {
    if (lockCheckInterval) {
      clearInterval(lockCheckInterval);
      lockCheckInterval = null;
    }
    
    await BotLock.deleteOne({ lockId: 'bot_lock', instanceId: INSTANCE_ID });
    logger.info(`Lock rilasciato da ${INSTANCE_ID}`);
  } catch (err) {
    logger.error('Errore nel rilascio del lock:', err);
  }
};

// Gestione della terminazione graceful
const gracefulShutdown = async (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  logger.info(`Bot in fase di terminazione (${signal})`);
  
  // Rilascia il lock
  await releaseLock();
  
  // Ferma il bot
  if (botRunning) {
    try {
      bot.stop(signal);
    } catch (err) {
      logger.error('Errore nell\'arresto del bot:', err);
    }
  }
  
  // Attendi che le connessioni esistenti si chiudano prima di uscire
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
process.on('uncaughtException', async (err) => {
  logger.error('Eccezione non catturata:', err);
  await gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', async (reason, promise) => {
  logger.error('Promise non gestita:', reason);
  await gracefulShutdown('UNHANDLED_REJECTION');
});

// Avvia il processo di inizializzazione
init();
