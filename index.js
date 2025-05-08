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

// Flag per tracciare lo stato di shutdown
let isShuttingDown = false;
let lockCheckInterval = null;
let botInstance = null;

// Imposta un file di lock locale nel sistema di file
const lockFilePath = path.join(__dirname, '.bot_lock');

// Schema per il lock del bot (nel database)
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
    // Verifica se esiste già un file di lock locale per prevenire avvii multipli sullo stesso server
    if (fs.existsSync(lockFilePath)) {
      try {
        const lockData = fs.readFileSync(lockFilePath, 'utf8');
        const lockInfo = JSON.parse(lockData);
        const lockAge = Date.now() - lockInfo.timestamp;
        
        if (lockAge < 60000) { // Il lock è recente (meno di 1 minuto)
          logger.warn(`Lock file locale trovato (${lockInfo.instanceId}) con età ${Math.round(lockAge/1000)}s. Terminazione.`);
          process.exit(0); // Esci senza errore per evitare che Render riavvii immediatamente
        } else {
          logger.warn(`Lock file locale trovato ma vecchio (${Math.round(lockAge/1000)}s). Sovrascrittura.`);
          // Continua e sovrascrive il lock vecchio
        }
      } catch (lockErr) {
        logger.error('Errore nella lettura del lock file:', lockErr);
        // Lock file corrotto, continua
      }
    }
    
    // Crea il lock file locale
    fs.writeFileSync(lockFilePath, JSON.stringify({
      instanceId: INSTANCE_ID,
      timestamp: Date.now()
    }));
    
    // Imposta rimozione del lock file alla chiusura
    process.on('exit', () => {
      try {
        if (fs.existsSync(lockFilePath)) {
          // Verifica che il file appartenga a questa istanza prima di rimuoverlo
          const lockData = fs.readFileSync(lockFilePath, 'utf8');
          const lockInfo = JSON.parse(lockData);
          
          if (lockInfo.instanceId === INSTANCE_ID) {
            fs.unlinkSync(lockFilePath);
            // Non è possibile loggare qui perché il processo sta terminando
          }
        }
      } catch (e) {
        // Non possiamo fare molto durante l'exit
      }
    });
    
    // Connetti al database
    await connectToDatabase();
    logger.info('Connesso al database MongoDB');
    
    // Assicurati che l'indice TTL sia impostato
    await BotLock.collection.createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 });
    
    // Avvia il bot dopo un breve ritardo per evitare conflitti con avvii multipli
    setTimeout(async () => {
      await acquireLock();
    }, 2000);
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

// Funzione per tenere aggiornato il lock file locale
const updateLockFile = () => {
  try {
    if (fs.existsSync(lockFilePath)) {
      const lockData = fs.readFileSync(lockFilePath, 'utf8');
      const lockInfo = JSON.parse(lockData);
      
      // Verifica che il file appartenga a questa istanza
      if (lockInfo.instanceId === INSTANCE_ID) {
        fs.writeFileSync(lockFilePath, JSON.stringify({
          instanceId: INSTANCE_ID,
          timestamp: Date.now()
        }));
      } else {
        logger.warn(`Lock file appartiene ad altra istanza: ${lockInfo.instanceId}`);
      }
    } else {
      // Se il file non esiste più, ricrealo
      fs.writeFileSync(lockFilePath, JSON.stringify({
        instanceId: INSTANCE_ID,
        timestamp: Date.now()
      }));
    }
  } catch (err) {
    logger.error('Errore nell\'aggiornamento del lock file:', err);
  }
};

// Funzione per acquisire il lock nel database
const acquireLock = async () => {
  try {
    if (isShuttingDown) {
      logger.warn('Tentativo di acquisire lock durante fase di chiusura. Abortito.');
      return;
    }
    
    // Aggiorna il lock file locale
    updateLockFile();
    
    // Creiamo un documento di lock nel database
    await BotLock.create({
      lockId: 'bot_lock',
      instanceId: INSTANCE_ID
    });
    
    logger.info(`Lock acquisito con successo da ${INSTANCE_ID}`);
    
    // Configura una nuova istanza del bot
    setupBot();
    
    // Avvia il bot con ritardo progressivo (1 secondo)
    setTimeout(async () => {
      await startBot();
    }, 1000);
    
    // Imposta un timer per aggiornare periodicamente il lock
    if (lockCheckInterval) {
      clearInterval(lockCheckInterval);
    }
    
    lockCheckInterval = setInterval(async () => {
      if (isShuttingDown) {
        if (lockCheckInterval) {
          clearInterval(lockCheckInterval);
          lockCheckInterval = null;
        }
        return;
      }
      
      try {
        // Aggiorna il lock file locale
        updateLockFile();
        
        // Aggiorna il timestamp del documento lock per evitare che scada
        const result = await BotLock.updateOne(
          { lockId: 'bot_lock', instanceId: INSTANCE_ID },
          { $set: { createdAt: new Date() } }
        );
        
        if (result.matchedCount === 0) {
          logger.warn(`Il lock non esiste più nel database. Verifico lo stato.`);
          
          const lock = await BotLock.findOne({ lockId: 'bot_lock' });
          
          if (!lock) {
            logger.info('Lock non trovato nel DB, provo a riottenerlo.');
            try {
              await BotLock.create({
                lockId: 'bot_lock',
                instanceId: INSTANCE_ID
              });
              logger.info('Lock riottenuto con successo');
            } catch (lockErr) {
              if (lockErr.code === 11000) {
                logger.warn('Lock già preso da un\'altra istanza');
                const existingLock = await BotLock.findOne({ lockId: 'bot_lock' });
                if (existingLock && existingLock.instanceId !== INSTANCE_ID) {
                  logger.warn(`Lock detenuto da ${existingLock.instanceId}, termino.`);
                  await gracefulShutdown('LOCK_CONFLICT');
                }
              } else {
                logger.error('Errore nella riacquisizione del lock:', lockErr);
              }
            }
          } else if (lock.instanceId !== INSTANCE_ID) {
            logger.warn(`Lock detenuto da altra istanza: ${lock.instanceId}, termino.`);
            await gracefulShutdown('LOCK_LOST');
          }
        }
      } catch (err) {
        logger.error('Errore nell\'aggiornamento del lock:', err);
      }
    }, 20000); // Ogni 20 secondi
  } catch (err) {
    if (err.code === 11000) { // Errore duplicato MongoDB
      logger.info('Lock già acquisito da un\'altra istanza. Verifico se possibile acquisirlo.');
      
      setTimeout(async () => {
        if (isShuttingDown) return;
        
        try {
          const existingLock = await BotLock.findOne({ lockId: 'bot_lock' });
          
          if (!existingLock) {
            logger.info('Lock non trovato, provo ad acquisirlo.');
            if (!isShuttingDown) {
              await acquireLock();
            }
          } else {
            logger.info(`Lock detenuto da: ${existingLock.instanceId}`);
            
            // Verifica età del lock
            const lockAge = Date.now() - existingLock.createdAt.getTime();
            
            if (lockAge > 45000) { // 45 secondi
              logger.warn(`Lock vecchio (${Math.round(lockAge/1000)}s), tento rimozione.`);
              
              if (isShuttingDown) return;
              
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
                  logger.warn('Lock vecchio non rimosso, forse cambiato.');
                  if (!isShuttingDown) {
                    setTimeout(() => acquireLock(), 15000);
                  }
                }
              } catch (delErr) {
                logger.error('Errore nella rimozione del lock vecchio:', delErr);
                if (!isShuttingDown) {
                  setTimeout(() => acquireLock(), 15000);
                }
              }
            } else {
              // Lock recente, termino questa istanza
              logger.info(`Lock recente (${Math.round(lockAge/1000)}s), termino questa istanza.`);
              await gracefulShutdown('DUPLICATE_INSTANCE');
            }
          }
        } catch (checkErr) {
          logger.error('Errore nel controllo del lock esistente:', checkErr);
          if (!isShuttingDown) {
            setTimeout(() => acquireLock(), 15000);
          }
        }
      }, 5000); // Attendi 5 secondi prima di verificare
    } else {
      logger.error('Errore nell\'acquisizione del lock:', err);
      if (!isShuttingDown) {
        setTimeout(() => acquireLock(), 10000);
      }
    }
  }
};

// Funzione semplificata per avviare il bot con ritentativo
const startBot = async (attempt = 1, maxAttempts = 3) => {
  if (isShuttingDown) {
    logger.warn('Tentativo di avvio durante shutdown. Abortito.');
    return false;
  }
  
  if (attempt > maxAttempts) {
    logger.error(`Avvio fallito dopo ${maxAttempts} tentativi`);
    await releaseLock();
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
      
      logger.info(`Bot avviato con successo in modalità polling (tentativo ${attempt})`);
      
      // Una volta avviato con successo, assicurati che il lock file sia aggiornato
      updateLockFile();
      
      return true;
    } catch (pollingError) {
      if (isShuttingDown) return false;
      
      if (pollingError.message?.includes('409: Conflict')) {
        logger.warn(`[Tentativo ${attempt}] Errore 409: Conflict. Attendo prima di riprovare.`);
        
        // Non rilasciare il lock immediatamente, aspetta per vedere se l'altra istanza termina
        await new Promise(resolve => setTimeout(resolve, 7000 * attempt));
        
        if (isShuttingDown) return false;
        
        // Verifica se possiamo avviare il bot dopo l'attesa
        if (attempt < maxAttempts) {
          logger.info(`Riprovo avvio dopo pausa (tentativo ${attempt + 1}/${maxAttempts})`);
          return await startBot(attempt + 1, maxAttempts);
        } else {
          logger.warn(`Troppi errori 409, rilascio il lock e termino.`);
          await releaseLock();
          await gracefulShutdown('CONFLICT_ERROR');
          return false;
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
    
    // Prima di tutto, verifica se il lock è ancora nostro nel database
    const lock = await BotLock.findOne({ lockId: 'bot_lock' });
    if (lock && lock.instanceId === INSTANCE_ID) {
      const result = await BotLock.deleteOne({ 
        lockId: 'bot_lock', 
        instanceId: INSTANCE_ID 
      });
      
      if (result.deletedCount > 0) {
        logger.info(`Lock DB rilasciato da ${INSTANCE_ID}`);
      }
    } else {
      logger.warn(`Nessun lock DB da rilasciare per ${INSTANCE_ID}`);
    }
    
    // Rimuovi anche il lock file locale se appartiene a questa istanza
    try {
      if (fs.existsSync(lockFilePath)) {
        const lockData = fs.readFileSync(lockFilePath, 'utf8');
        const lockInfo = JSON.parse(lockData);
        
        if (lockInfo.instanceId === INSTANCE_ID) {
          fs.unlinkSync(lockFilePath);
          logger.info(`Lock file locale rimosso da ${INSTANCE_ID}`);
        } else {
          logger.warn(`Lock file locale appartiene ad altra istanza: ${lockInfo.instanceId}`);
        }
      }
    } catch (fileErr) {
      logger.error('Errore nella rimozione del lock file:', fileErr);
    }
  } catch (err) {
    logger.error('Errore nel rilascio del lock DB:', err);
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
  
  // Nei sistemi come Render, attendi un po' prima di uscire
  // per evitare riavvii troppo rapidi
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

// Avvia il processo di inizializzazione
init();
