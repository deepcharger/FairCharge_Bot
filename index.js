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
const fs = require('fs');
const path = require('path');

// Configurazioni per la stabilità in produzione
const NODE_ENV = process.env.NODE_ENV || 'development';
const REQUEST_TIMEOUT = parseInt(process.env.REQUEST_TIMEOUT || '60000', 10);
const LOCK_FILE_PATH = process.env.LOCK_FILE_PATH || path.join(__dirname, '.bot_lock');
const STARTUP_DELAY = parseInt(process.env.STARTUP_DELAY || '10000', 10); // Ritardo iniziale per evitare conflitti
const MASTER_LOCK_TIMEOUT = 120; // 2 minuti in secondi per il master lock
const LAUNCH_RETRY_COUNT = 3;

// Flag per tracciare lo stato di shutdown
let isShuttingDown = false;
let lockCheckInterval = null;
let botInstance = null;
let isBotRunning = false;
let restartAttempts = 0;

// Configurazione del logging in base all'ambiente
if (NODE_ENV === 'production') {
    logger.info('Applicazione avviata in modalità produzione');
}

// Schema per il master lock del bot (nel database)
const botMasterLockSchema = new mongoose.Schema({
  lockId: { type: String, required: true, unique: true },
  instanceId: { type: String, required: true },
  createdAt: { type: Date, default: Date.now, expires: MASTER_LOCK_TIMEOUT } // TTL di 2 minuti
});

// Schema per il lock di esecuzione (nel database)
const botExecutionLockSchema = new mongoose.Schema({
  lockId: { type: String, required: true, unique: true },
  instanceId: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

// Crea i modelli lock
const BotMasterLock = mongoose.model('BotMasterLock', botMasterLockSchema);
const BotExecutionLock = mongoose.model('BotExecutionLock', botExecutionLockSchema);

// Genera un ID univoco per questa istanza
const INSTANCE_ID = `instance_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
logger.info(`ID istanza generato: ${INSTANCE_ID}`);

// Assicurati che venga rimosso il lock file locale all'uscita
process.on('exit', () => {
  cleanupLocalLock();
});

// Funzione per pulire il lock file locale
function cleanupLocalLock() {
  try {
    if (fs.existsSync(LOCK_FILE_PATH)) {
      // Verifica che il file appartenga a questa istanza prima di rimuoverlo
      try {
        const lockData = fs.readFileSync(LOCK_FILE_PATH, 'utf8');
        const lockInfo = JSON.parse(lockData);
        
        if (lockInfo.instanceId === INSTANCE_ID) {
          fs.unlinkSync(LOCK_FILE_PATH);
          // Non è possibile loggare qui durante l'exit
        }
      } catch (e) {
        // Errore nella lettura del file, tenta comunque di rimuoverlo
        try { fs.unlinkSync(LOCK_FILE_PATH); } catch (e2) { /* ignora */ }
      }
    }
  } catch (e) {
    // Non possiamo fare molto durante l'exit
  }
}

// Funzione per rilasciare tutti i lock
const releaseAllLocks = async () => {
  try {
    logger.info(`Rilascio di tutti i lock per l'istanza ${INSTANCE_ID}...`);
    
    if (lockCheckInterval) {
      clearInterval(lockCheckInterval);
      lockCheckInterval = null;
    }
    
    // Rilascia il lock di esecuzione
    try {
      const execResult = await BotExecutionLock.deleteOne({ 
        lockId: 'bot_execution_lock', 
        instanceId: INSTANCE_ID 
      });
      
      if (execResult.deletedCount > 0) {
        logger.info(`Lock di esecuzione rilasciato da ${INSTANCE_ID}`);
      } else {
        logger.info(`Nessun lock di esecuzione da rilasciare per ${INSTANCE_ID}`);
      }
    } catch (execErr) {
      logger.error('Errore nel rilascio del lock di esecuzione:', execErr);
    }
    
    // Rilascia il master lock
    try {
      const masterResult = await BotMasterLock.deleteOne({ 
        lockId: 'bot_master_lock', 
        instanceId: INSTANCE_ID 
      });
      
      if (masterResult.deletedCount > 0) {
        logger.info(`Master lock rilasciato da ${INSTANCE_ID}`);
      } else {
        logger.info(`Nessun master lock da rilasciare per ${INSTANCE_ID}`);
      }
    } catch (masterErr) {
      logger.error('Errore nel rilascio del master lock:', masterErr);
    }
    
    // Rimuovi il lock file locale
    cleanupLocalLock();
    
  } catch (err) {
    logger.error('Errore nel rilascio di tutti i lock:', err);
  }
};

// Gestione dello shutdown controllato
const gracefulShutdown = async (signal) => {
  // Previeni chiamate multiple
  if (isShuttingDown) {
    logger.info(`Shutdown già in corso (${signal}), ignoro.`);
    return;
  }
  
  isShuttingDown = true;
  
  logger.info(`Bot in fase di terminazione (${signal})`);
  
  // Rilascia tutti i lock
  await releaseAllLocks();
  
  // Ferma il bot
  if (botInstance && isBotRunning) {
    try {
      await botInstance.stop(signal);
      isBotRunning = false;
      logger.info('Bot fermato con successo');
    } catch (err) {
      logger.error('Errore nell\'arresto del bot:', err);
    }
  }
  
  // Registra i tentativi di riavvio effettuati
  if (restartAttempts > 0) {
    logger.info(`L'istanza ha tentato ${restartAttempts} riavvii durante il ciclo di vita`);
  }
  
  // Chiusura della connessione al database
  try {
    await mongoose.connection.close();
    logger.info('Connessione al database chiusa');
  } catch (err) {
    logger.error('Errore nella chiusura della connessione al database:', err);
  }
  
  // Imposta un timeout più breve per terminare
  const exitTimeout = signal === 'DUPLICATE_INSTANCE' ? 1000 : 5000;
  
  setTimeout(() => {
    logger.info(`Uscita con codice 0 dopo ${exitTimeout}ms`);
    
    // Se usciamo con codice 0, Render non riavvierà immediatamente
    process.exit(0);
  }, exitTimeout);
};

// Gestori dei segnali del sistema operativo
process.once('SIGINT', () => gracefulShutdown('SIGINT'));
process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.once('SIGQUIT', () => gracefulShutdown('SIGQUIT'));

// Gestori di errori non catturati
process.on('uncaughtException', async (err) => {
  logger.error('Eccezione non catturata:', err);
  await gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', async (reason, promise) => {
  logger.error('Promise non gestita:', reason);
  await gracefulShutdown('UNHANDLED_REJECTION');
});

// Connessione al database e inizializzazione
const init = async () => {
  try {
    // Connetti al database
    await connectToDatabase();
    logger.info('Connesso al database MongoDB');
    
    // Assicurati che l'indice TTL sia impostato
    await BotMasterLock.collection.createIndex({ createdAt: 1 }, { expireAfterSeconds: MASTER_LOCK_TIMEOUT });
    
    // In un ambiente come Render.com, attendi un breve ritardo casuale prima di provare a
    // ottenere il master lock, per ridurre la possibilità di collisioni
    const randomDelay = Math.floor(Math.random() * 5000); // 0-5 secondi
    const totalDelay = STARTUP_DELAY + randomDelay;
    
    logger.info(`Attesa di ${totalDelay}ms prima di tentare di acquisire il master lock...`);
    
    setTimeout(async () => {
      try {
        await acquireMasterLock();
      } catch (err) {
        logger.error('Errore durante l\'acquisizione del master lock:', err);
        // Se c'è un errore nell'acquisizione del master lock, aspetta e ripeti
        setTimeout(() => init(), 30000);
      }
    }, totalDelay);
  } catch (err) {
    logger.error('Errore di inizializzazione:', err);
    process.exit(1);
  }
};

// Funzione per acquisire il master lock
const acquireMasterLock = async () => {
  try {
    if (isShuttingDown) {
      logger.warn('Tentativo di acquisire il master lock durante la fase di chiusura. Abortito.');
      return;
    }
    
    logger.info(`Tentativo di acquisire il master lock per l'istanza ${INSTANCE_ID}...`);
    
    // Prima controlla se esiste già un lock di esecuzione attivo
    const executionLock = await BotExecutionLock.findOne({ lockId: 'bot_execution_lock' });
    
    if (executionLock) {
      logger.info(`Rilevato un lock di esecuzione attivo: ${executionLock.instanceId}`);
      
      // Verifica se l'istanza del lock è ancora attiva
      try {
        const masterLock = await BotMasterLock.findOne({ instanceId: executionLock.instanceId });
        
        if (masterLock) {
          // L'istanza che ha il lock di esecuzione è ancora attiva, termina questa istanza
          logger.info(`L'istanza ${executionLock.instanceId} è attiva e ha il lock di esecuzione. Termino questa istanza.`);
          await gracefulShutdown('DUPLICATE_INSTANCE');
          return;
        } else {
          // L'istanza che ha il lock di esecuzione non è più attiva, possiamo provare a prendere il controllo
          logger.info(`L'istanza ${executionLock.instanceId} non è più attiva. Provo a prendere il controllo.`);
        }
      } catch (err) {
        logger.error('Errore nella verifica del master lock dell\'istanza corrente:', err);
        // Continua comunque, nel peggiore dei casi l'istanza si chiuderà dopo
      }
    }
    
    // Crea un nuovo master lock
    await BotMasterLock.create({
      lockId: 'bot_master_lock',
      instanceId: INSTANCE_ID
    });
    
    logger.info(`Master lock acquisito con successo da ${INSTANCE_ID}`);
    
    // Verifica se possiamo acquisire anche il lock di esecuzione
    await acquireExecutionLock();
    
  } catch (err) {
    if (err.code === 11000) { // Errore duplicato MongoDB
      logger.info('Master lock già acquisito da un\'altra istanza. Verifico se è attivo.');
      
      try {
        const masterLock = await BotMasterLock.findOne({ lockId: 'bot_master_lock' });
        
        if (!masterLock) {
          logger.info('Master lock non trovato nel database, riprovo tra 5 secondi.');
          setTimeout(() => acquireMasterLock(), 5000);
          return;
        }
        
        // Se non siamo noi a detenere il master lock, verifichiamo se possiamo comunque avviare il bot
        if (masterLock.instanceId !== INSTANCE_ID) {
          logger.info(`Master lock detenuto da ${masterLock.instanceId}. Verifico il lock di esecuzione.`);
          
          // Verifica lock di esecuzione
          const executionLock = await BotExecutionLock.findOne({ lockId: 'bot_execution_lock' });
          
          if (!executionLock) {
            logger.info('Nessun lock di esecuzione trovato. Provo ad acquisirlo.');
            await acquireExecutionLock();
          } else if (executionLock.instanceId === INSTANCE_ID) {
            logger.info('Questa istanza detiene già il lock di esecuzione.');
            // Avvia il bot se non è già in esecuzione
            if (!isBotRunning) {
              startupBot();
            }
          } else {
            // Un'altra istanza ha il lock di esecuzione
            logger.info(`Lock di esecuzione detenuto da ${executionLock.instanceId}. Questa istanza rimarrà in standby.`);
            
            // Imposta un controllo periodico per verificare se il lock di esecuzione si libera
            if (lockCheckInterval) {
              clearInterval(lockCheckInterval);
            }
            
            lockCheckInterval = setInterval(async () => {
              try {
                if (isShuttingDown) {
                  clearInterval(lockCheckInterval);
                  return;
                }
                
                // Verifica se il lock di esecuzione esiste ancora
                const currentExecutionLock = await BotExecutionLock.findOne({ lockId: 'bot_execution_lock' });
                
                if (!currentExecutionLock) {
                  logger.info('Lock di esecuzione non più disponibile. Provo ad acquisirlo.');
                  clearInterval(lockCheckInterval);
                  await acquireExecutionLock();
                }
                
                // Rinnova il master lock
                await BotMasterLock.updateOne(
                  { lockId: 'bot_master_lock', instanceId: INSTANCE_ID },
                  { $set: { createdAt: new Date() } }
                );
              } catch (err) {
                logger.error('Errore nel controllo del lock di esecuzione:', err);
              }
            }, 20000); // Controlla ogni 20 secondi
          }
        } else {
          // Siamo noi a detenere il master lock, verifichiamo se possiamo acquisire anche il lock di esecuzione
          logger.info('Questa istanza detiene già il master lock. Verifico il lock di esecuzione.');
          await acquireExecutionLock();
        }
      } catch (checkErr) {
        logger.error('Errore nella verifica del master lock:', checkErr);
        setTimeout(() => acquireMasterLock(), 10000);
      }
    } else {
      logger.error('Errore nell\'acquisizione del master lock:', err);
      setTimeout(() => acquireMasterLock(), 10000);
    }
  }
};

// Funzione per acquisire il lock di esecuzione
const acquireExecutionLock = async () => {
  try {
    if (isShuttingDown) {
      logger.warn('Tentativo di acquisire lock di esecuzione durante fase di chiusura. Abortito.');
      return;
    }
    
    logger.info(`Tentativo di acquisire il lock di esecuzione per l'istanza ${INSTANCE_ID}...`);
    
    // Verifica se esiste già un lock di esecuzione
    const existingLock = await BotExecutionLock.findOne({ lockId: 'bot_execution_lock' });
    
    if (existingLock) {
      // Se l'istanza che ha il lock è la nostra, non facciamo nulla
      if (existingLock.instanceId === INSTANCE_ID) {
        logger.info('Questa istanza detiene già il lock di esecuzione.');
        
        // Avvia il bot se non è già in esecuzione
        if (!isBotRunning) {
          startupBot();
        }
        
        return;
      }
      
      // Verifica se l'istanza che ha il lock è ancora attiva
      const masterLock = await BotMasterLock.findOne({ instanceId: existingLock.instanceId });
      
      if (masterLock) {
        logger.info(`L'istanza ${existingLock.instanceId} è attiva e ha il lock di esecuzione. Rimango in standby.`);
        return;
      }
      
      // L'istanza che ha il lock non è più attiva, rimuovi il lock
      logger.info(`L'istanza ${existingLock.instanceId} non è più attiva. Rimuovo il suo lock di esecuzione.`);
      await BotExecutionLock.deleteOne({ lockId: 'bot_execution_lock' });
    }
    
    // Crea un nuovo lock di esecuzione
    await BotExecutionLock.create({
      lockId: 'bot_execution_lock',
      instanceId: INSTANCE_ID
    });
    
    logger.info(`Lock di esecuzione acquisito con successo da ${INSTANCE_ID}`);
    
    // Crea anche il lock file locale
    try {
      fs.writeFileSync(LOCK_FILE_PATH, JSON.stringify({
        instanceId: INSTANCE_ID,
        timestamp: Date.now()
      }));
      logger.debug('Lock file locale creato');
    } catch (fileErr) {
      logger.warn('Impossibile creare il lock file locale:', fileErr);
      // Continua anche senza lock file locale
    }
    
    // Imposta il controllo periodico del lock
    if (lockCheckInterval) {
      clearInterval(lockCheckInterval);
    }
    
    lockCheckInterval = setInterval(async () => {
      try {
        if (isShuttingDown) {
          clearInterval(lockCheckInterval);
          return;
        }
        
        // Aggiorna il timestamp del master lock
        await BotMasterLock.updateOne(
          { lockId: 'bot_master_lock', instanceId: INSTANCE_ID },
          { $set: { createdAt: new Date() } }
        );
      } catch (err) {
        logger.error('Errore nell\'aggiornamento del master lock:', err);
      }
    }, 20000); // Ogni 20 secondi
    
    // Avvia il bot
    startupBot();
    
  } catch (err) {
    if (err.code === 11000) {
      logger.warn('Lock di esecuzione già acquisito da un\'altra istanza. Rimango in standby.');
    } else {
      logger.error('Errore nell\'acquisizione del lock di esecuzione:', err);
      // Riprova dopo un po'
      setTimeout(() => acquireExecutionLock(), 10000);
    }
  }
};

// Funzione per avviare il bot
const startupBot = async () => {
  if (isBotRunning || isShuttingDown) {
    return;
  }
  
  logger.info('Avvio del bot...');
  
  // Configura una nuova istanza del bot
  setupBot();
  
  // Avvia il bot
  try {
    await startBot();
  } catch (err) {
    logger.error('Errore nell\'avvio del bot:', err);
    // Se c'è un errore nell'avvio, rilascia il lock di esecuzione
    try {
      await BotExecutionLock.deleteOne({ lockId: 'bot_execution_lock', instanceId: INSTANCE_ID });
      logger.info('Lock di esecuzione rilasciato dopo errore di avvio');
    } catch (releaseErr) {
      logger.error('Errore nel rilascio del lock di esecuzione:', releaseErr);
    }
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
  botInstance = new Telegraf(token, {
    telegram: {
      // Timeout per le richieste HTTP
      timeoutMs: REQUEST_TIMEOUT
    }
  });
  
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
  botInstance.command('archivia_annuncio', commands.archiveAnnouncementCommand);
  botInstance.command('cancella_dati_utente', commands.deleteUserDataCommand);
  botInstance.command('aggiungi_feedback', commands.addFeedbackCommand);
  // Aggiungi il nuovo comando admin
  botInstance.command('db_admin', commands.dbAdminCommand);

  // Nuovo handler per il comando speciale inizia_acquisto_ID
  botInstance.command(/inizia_acquisto_(.+)/, async (ctx) => {
    try {
      const announcementId = ctx.match[1];
      
      // Memorizza l'ID dell'annuncio nella sessione
      ctx.session.announcementId = announcementId;
      
      // Entra nella scena
      return ctx.scene.enter('BUY_KWH_WIZARD');
    } catch (err) {
      logger.error('Errore nell\'avvio del wizard dal comando:', err);
      await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
    }
  });

  // Registra i gestori delle callback
  botInstance.action(/buy_kwh_(.+)/, callbacks.buyKwhCallback);
  botInstance.action(/start_buy_(.+)/, callbacks.startBuyCallback); // Nuovo handler per l'avvio in chat privata
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
  // Registrazione delle callback per confermare/annullare la richiesta di pagamento
  botInstance.action(/confirm_payment_(.+)_(.+)/, callbacks.confirmPaymentRequestCallback);
  botInstance.action(/cancel_payment_(.+)/, callbacks.cancelPaymentRequestCallback);
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
    logger.error(`Errore per ${ctx?.updateType || 'unknown'}:`, err);
  });
  
  return botInstance;
};

// Funzione per avviare il bot con ritentativo
const startBot = async (attempt = 1, maxAttempts = LAUNCH_RETRY_COUNT) => {
  restartAttempts++;
  
  if (isShuttingDown) {
    logger.warn('Tentativo di avvio durante shutdown. Abortito.');
    return false;
  }
  
  if (attempt > maxAttempts) {
    logger.error(`Avvio fallito dopo ${maxAttempts} tentativi`);
    await releaseAllLocks();
    await gracefulShutdown('STARTUP_FAILURE');
    return false;
  }
  
  try {
    // Pulisci eventuali webhook precedenti
    await botInstance.telegram.deleteWebhook({ drop_pending_updates: true });
    logger.info(`[Tentativo ${attempt}] Webhook rimossi`);
    
    // Pausa breve dopo la rimozione del webhook
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    try {
      // Avvia il bot in modalità polling con ritardo tra i tentativi
      await botInstance.launch({
        dropPendingUpdates: true,
        polling: {
          timeout: 30, // Timeout più lungo per stabilità
          limit: 100,
          allowedUpdates: ['message', 'callback_query', 'inline_query', 'edited_message', 'channel_post']
        }
      });
      
      isBotRunning = true;
      
      logger.info(`Bot avviato con successo in modalità polling (tentativo ${attempt})`);
      
      // Reset del contatore di tentativi dopo successo
      restartAttempts = 0;
      
      return true;
    } catch (pollingError) {
      if (isShuttingDown) return false;
      
      if (pollingError.message?.includes('409: Conflict')) {
        logger.warn(`[Tentativo ${attempt}] Errore 409: Conflict. Attendo prima di riprovare.`);
        
        // Prova a rilasciare il lock di esecuzione per permettere a un'altra istanza di provare
        if (attempt >= maxAttempts - 1) {
          logger.warn(`Rilascio il lock di esecuzione per permettere a un'altra istanza di provare.`);
          await BotExecutionLock.deleteOne({ lockId: 'bot_execution_lock', instanceId: INSTANCE_ID });
          await gracefulShutdown('CONFLICT_ERROR');
          return false;
        }
        
        // Attendi prima di riprovare
        const retryDelay = 7000 * attempt;
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        
        if (isShuttingDown) return false;
        
        // Verifica se possiamo avviare il bot dopo l'attesa
        if (attempt < maxAttempts) {
          logger.info(`Riprovo avvio dopo pausa (tentativo ${attempt + 1}/${maxAttempts})`);
          return await startBot(attempt + 1, maxAttempts);
        }
      } else {
        throw pollingError;
      }
    }
  } catch (error) {
    if (isShuttingDown) return false;
    
    logger.error(`[Tentativo ${attempt}] Errore nell'avvio del bot:`, error);
    
    if (attempt < maxAttempts) {
      const retryDelay = 5000 * attempt; // Ritardo crescente: 5s, 10s, 15s...
      logger.info(`Riprovo l'avvio tra ${retryDelay/1000} secondi (tentativo ${attempt + 1}/${maxAttempts})...`);
      
      await new Promise(resolve => setTimeout(resolve, retryDelay));
      return await startBot(attempt + 1, maxAttempts);
    } else {
      await releaseAllLocks();
      await gracefulShutdown('STARTUP_ERROR');
      return false;
    }
  }
};

// Avvia il processo di inizializzazione
init();
