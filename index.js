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
const { Telegraf } = require('telegraf');
const fetch = require('node-fetch');

// Flag per tracciare lo stato di shutdown
let isShuttingDown = false;
let lockCheckInterval = null;
let botInstance = null;

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
    
    // Tenta di acquisire il lock per avviare il bot
    await acquireLock();
  } catch (err) {
    logger.error('Errore di inizializzazione:', err);
    process.exit(1);
  }
};

// Configura il bot con tutti i middleware e gli handler
const setupBot = () => {
  // IMPORTANTE: Crea una nuova istanza del bot per evitare problemi di stato condiviso
  const token = process.env.BOT_TOKEN;
  
  // Se l'istanza esistente del bot esiste, la fermiamo prima
  if (botInstance) {
    try {
      botInstance.stop();
      logger.info('Istanza precedente del bot fermata');
    } catch (err) {
      logger.warn('Errore nell\'arresto dell\'istanza precedente:', err);
    }
  }
  
  // Crea una nuova istanza del bot
  botInstance = new Telegraf(token);
  
  // Middleware di logging per tutte le richieste
  botInstance.use((ctx, next) => {
    const start = Date.now();
    return next().then(() => {
      const responseTime = Date.now() - start;
      logger.request(ctx, responseTime);
    });
  });

  // Registra i middleware
  botInstance.use(middleware.session());
  botInstance.use(stage.middleware());

  // Aggiungi il middleware di pulizia delle scene
  botInstance.use(sceneCleanerMiddleware());

  // Configura la pulizia periodica delle sessioni inattive
  setupPeriodicCleaner(botInstance);

  // Registra i gestori dei comandi
  botInstance.start(commands.startCommand);
  botInstance.command('vendi_kwh', commands.sellKwhCommand);
  botInstance.command('le_mie_ricariche', commands.myChargesCommand);
  botInstance.command('profilo', commands.profileCommand);
  botInstance.command('help', commands.helpCommand);
  botInstance.command('avvio_ricarica', commands.startChargeCommand);
  botInstance.command('update_commands', commands.updateBotCommandsCommand);
  botInstance.command('annulla', commands.cancelCommand);

  // Registra i gestori delle callback
  botInstance.action(/buy_kwh_(.+)/, callbacks.buyKwhCallback);
  // Modificato da connector_ a current_ per corrispondere al pattern nella scene
  botInstance.action(/current_(.+)/, callbacks.connectorTypeCallback);
  botInstance.action('publish_sell', callbacks.publishSellCallback);
  botInstance.action('cancel_sell', callbacks.cancelSellCallback);
  botInstance.action('accept_conditions', callbacks.acceptConditionsCallback);
  botInstance.action('cancel_buy', callbacks.cancelBuyCallback);
  botInstance.action('send_request', callbacks.sendRequestCallback);
  botInstance.action(/accept_offer_(.+)/, callbacks.acceptOfferCallback);
  botInstance.action(/reject_offer_(.+)/, callbacks.rejectOfferCallback);
  botInstance.action(/ready_to_charge_(.+)/, callbacks.readyToChargeCallback);
  botInstance.action(/charging_started_(.+)/, callbacks.chargingStartedCallback);
  botInstance.action(/charging_ok_(.+)/, callbacks.chargingOkCallback);
  botInstance.action(/charging_issues_(.+)/, callbacks.chargingIssuesCallback);
  botInstance.action(/charging_completed_(.+)/, callbacks.chargingCompletedCallback);
  botInstance.action(/confirm_kwh_(.+)/, callbacks.confirmKwhCallback);
  botInstance.action(/dispute_kwh_(.+)/, callbacks.disputeKwhCallback);
  botInstance.action(/set_payment_(.+)/, callbacks.setPaymentCallback);
  botInstance.action(/payment_sent_(.+)/, callbacks.paymentSentCallback);
  botInstance.action(/payment_confirmed_(.+)/, callbacks.paymentConfirmedCallback);
  botInstance.action(/payment_not_received_(.+)/, callbacks.paymentNotReceivedCallback);
  botInstance.action(/donate_2_(.+)/, callbacks.donateFixedCallback);
  botInstance.action(/donate_custom_(.+)/, callbacks.donateCustomCallback);
  botInstance.action(/donate_skip_(.+)/, callbacks.donateSkipCallback);
  botInstance.action(/feedback_positive_(.+)/, callbacks.feedbackPositiveCallback);
  botInstance.action(/feedback_negative_(.+)/, callbacks.feedbackNegativeCallback);
  botInstance.action(/cancel_charge_(.+)/, callbacks.cancelChargeCallback);
  botInstance.action('send_manual_request', callbacks.sendManualRequestCallback);
  botInstance.action('cancel_manual_request', callbacks.cancelManualRequestCallback);

  // Gestione dei messaggi nei topic
  botInstance.on(['message', 'channel_post'], middleware.topicMessageHandler);

  // Gestione dei messaggi di testo (per handler specifici)
  botInstance.on('text', middleware.textMessageHandler);

  // Gestione dei messaggi con foto
  botInstance.on('photo', middleware.photoMessageHandler);

  // Gestione degli errori
  botInstance.catch((err, ctx) => {
    logger.error(`Errore per ${ctx.updateType}:`, err);
  });
  
  return botInstance;
};

// Funzione per acquisire il lock nel database
const acquireLock = async () => {
  try {
    // Prima verifichiamo se stiamo già in fase di chiusura
    if (isShuttingDown) {
      logger.warn('Tentativo di acquisire lock durante fase di chiusura. Abortito.');
      return;
    }
    
    // Creiamo un documento di lock
    await BotLock.create({
      lockId: 'bot_lock',
      instanceId: INSTANCE_ID
    });
    
    logger.info(`Lock acquisito con successo da ${INSTANCE_ID}`);
    
    // Configura una nuova istanza del bot
    setupBot();
    
    // Avvia il bot
    await startBot();
    
    // Imposta un timer per aggiornare periodicamente il lock
    if (lockCheckInterval) {
      clearInterval(lockCheckInterval);
    }
    
    lockCheckInterval = setInterval(async () => {
      if (isShuttingDown) {
        // Se siamo in fase di chiusura, ferma l'intervallo
        if (lockCheckInterval) {
          clearInterval(lockCheckInterval);
          lockCheckInterval = null;
        }
        return;
      }
      
      try {
        // Aggiorna il timestamp del documento lock per evitare che scada
        const result = await BotLock.updateOne(
          { lockId: 'bot_lock', instanceId: INSTANCE_ID },
          { $set: { createdAt: new Date() } }
        );
        
        // Se l'aggiornamento non ha toccato nessun documento, il lock è andato perso
        if (result.matchedCount === 0) {
          logger.warn(`Il lock non esiste più. Tentativo di riacquisizione.`);
          
          // Verifica anche che il lock sia ancora nostro
          const lock = await BotLock.findOne({ lockId: 'bot_lock' });
          
          if (!lock) {
            // Se il lock non esiste, prova a riottenerlo
            logger.info('Lock non trovato, provo ad acquisirlo di nuovo.');
            
            try {
              await acquireLock();
            } catch (lockErr) {
              if (lockErr.code !== 11000) { // Non è un errore di duplicazione
                logger.error('Errore nella riacquisizione del lock:', lockErr);
              }
            }
          } else if (lock.instanceId !== INSTANCE_ID) {
            logger.warn(`Il lock è stato acquisito da un'altra istanza: ${lock.instanceId}. Termino.`);
            await gracefulShutdown('LOCK_LOST');
          }
        }
      } catch (err) {
        logger.error('Errore nell\'aggiornamento del lock:', err);
        
        // Verifica se il lock esiste ancora
        try {
          const lock = await BotLock.findOne({ lockId: 'bot_lock' });
          if (!lock) {
            logger.warn('Lock non disponibile. Tento di riottenerlo.');
            try {
              await acquireLock();
            } catch (acquireErr) {
              if (acquireErr.code !== 11000) { // Non è un errore di duplicazione
                logger.error('Errore nella riacquisizione del lock:', acquireErr);
              }
            }
          } else if (lock.instanceId !== INSTANCE_ID) {
            logger.warn(`Lock appartenente ad altra istanza: ${lock.instanceId}. Termino.`);
            await gracefulShutdown('LOCK_ERROR');
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
        if (isShuttingDown) return; // Non procedere se in fase di chiusura
        
        try {
          // Controlla se il lock esiste e se appartiene a qualcun altro
          const existingLock = await BotLock.findOne({ lockId: 'bot_lock' });
          
          if (!existingLock) {
            logger.info('Lock non trovato, provo ad acquisirlo di nuovo.');
            if (!isShuttingDown) {
              await acquireLock();
            }
          } else {
            logger.info(`Lock attualmente detenuto da: ${existingLock.instanceId}`);
            
            // Calcoliamo quanto tempo fa è stato aggiornato il lock
            const lockAge = Date.now() - existingLock.createdAt.getTime();
            
            // Se il lock è vecchio, proviamo a sovrascriverlo
            if (lockAge > 45000) { // 45 secondi
              logger.warn(`Lock vecchio (${Math.round(lockAge/1000)}s), tento di sostituirlo.`);
              
              if (isShuttingDown) return; // Non procedere se in fase di chiusura
              
              try {
                const deleteResult = await BotLock.deleteOne({
                  lockId: 'bot_lock',
                  instanceId: existingLock.instanceId
                });
                
                if (deleteResult.deletedCount > 0) {
                  logger.info('Lock vecchio rimosso, provo a riottenerlo.');
                  if (!isShuttingDown) {
                    await acquireLock();
                  }
                } else {
                  logger.warn('Lock vecchio non rimosso, già cambiato?');
                  // Attendi e riprova
                  if (!isShuttingDown) {
                    setTimeout(() => acquireLock(), 15000);
                  }
                }
              } catch (delErr) {
                logger.error('Errore nella rimozione del lock vecchio:', delErr);
                
                // Attendi e riprova
                if (!isShuttingDown) {
                  setTimeout(() => acquireLock(), 15000);
                }
              }
            } else {
              // Lock recente, attendi e riprova
              logger.info(`Lock recente (${Math.round(lockAge/1000)}s), riprovo tra 30 secondi.`);
              if (!isShuttingDown) {
                setTimeout(() => acquireLock(), 30000);
              }
            }
          }
        } catch (checkErr) {
          logger.error('Errore nel controllo del lock esistente:', checkErr);
          if (!isShuttingDown) {
            setTimeout(() => acquireLock(), 30000);
          }
        }
      }, 10000);
    } else {
      logger.error('Errore nell\'acquisizione del lock:', err);
      if (!isShuttingDown) {
        setTimeout(() => acquireLock(), 15000);
      }
    }
  }
};

// Funzione per avviare il bot con diverse strategie
const startBot = async (attempt = 1, maxAttempts = 3) => {
  if (isShuttingDown) {
    logger.warn('Tentativo di avvio del bot durante fase di chiusura. Abortito.');
    return false;
  }
  
  if (attempt > maxAttempts) {
    logger.error(`Tentativi di avvio del bot esauriti dopo ${maxAttempts} tentativi`);
    await releaseLock();
    await gracefulShutdown('STARTUP_FAILURE');
    return false;
  }
  
  try {
    // Strategia 1: Prima proviamo a rimuovere i webhook
    await botInstance.telegram.deleteWebhook({ drop_pending_updates: true });
    logger.info(`[Tentativo ${attempt}] Webhook rimossi`);
    
    // Attendi un breve momento
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    try {
      // Strategia 2: Avvia il bot con polling aggressivo
      await botInstance.launch({
        dropPendingUpdates: true,
        polling: {
          timeout: 10, // Timeout molto breve
          limit: 100,
          allowedUpdates: ['message', 'callback_query', 'inline_query', 'edited_message', 'channel_post']
        }
      });
      
      logger.info(`Bot avviato con successo in modalità polling (tentativo ${attempt})`);
      return true;
    } catch (pollingError) {
      if (isShuttingDown) {
        logger.info('Bot in fase di chiusura, interrompo i tentativi di avvio');
        return false;
      }
      
      if (pollingError.message?.includes('409: Conflict')) {
        logger.warn(`[Tentativo ${attempt}] Errore 409: Conflict. Rilascio il lock e termino.`);
        
        // Rilascia immediatamente il lock
        await releaseLock();
        
        // Termina l'esecuzione con un codice specifico
        await gracefulShutdown('CONFLICT_ERROR');
        return false;
      } else {
        // Altro tipo di errore non relativo al conflitto
        throw pollingError;
      }
    }
  } catch (error) {
    if (isShuttingDown) {
      logger.info('Bot in fase di chiusura, interrompo i tentativi di avvio');
      return false;
    }
    
    logger.error(`[Tentativo ${attempt}] Errore nell'avvio del bot:`, error);
    
    // Se non siamo all'ultimo tentativo, riprova
    if (attempt < maxAttempts) {
      const retryDelay = attempt * 10000; // 10s, 20s, 30s...
      logger.info(`Riprovo l'avvio tra ${retryDelay/1000} secondi (tentativo ${attempt + 1}/${maxAttempts})...`);
      
      await new Promise(resolve => setTimeout(resolve, retryDelay));
      return await startBot(attempt + 1, maxAttempts);
    } else {
      // All'ultimo tentativo, rilascia il lock e termina
      await releaseLock();
      await gracefulShutdown('STARTUP_ERROR');
      return false;
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
    
    const result = await BotLock.deleteOne({ 
      lockId: 'bot_lock', 
      instanceId: INSTANCE_ID 
    });
    
    if (result.deletedCount > 0) {
      logger.info(`Lock rilasciato da ${INSTANCE_ID}`);
    } else {
      logger.warn(`Nessun lock da rilasciare per ${INSTANCE_ID}`);
    }
  } catch (err) {
    logger.error('Errore nel rilascio del lock:', err);
  }
};

// Gestione della terminazione graceful
const gracefulShutdown = async (signal) => {
  // Prevenire chiamate multiple
  if (isShuttingDown) {
    logger.info(`Shutdown già in corso (segnale: ${signal}), ignoro.`);
    return;
  }
  
  isShuttingDown = true;
  
  logger.info(`Bot in fase di terminazione (${signal})`);
  
  // Rilascia il lock
  await releaseLock();
  
  // Ferma il bot
  if (botInstance) {
    try {
      await botInstance.stop(signal);
      logger.info('Bot fermato con successo');
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
