/**
 * Middleware per pulire le scene in caso di comandi lasciati in sospeso
 * Questo middleware controlla se l'utente sta eseguendo un nuovo comando
 * mentre ha una sessione di wizard attiva, e in tal caso cancella la sessione
 */
const logger = require('./logger');

/**
 * Controlla se il messaggio è un comando
 * @param {Object} message - Il messaggio da controllare
 * @returns {Boolean} true se il messaggio è un comando, false altrimenti
 */
const isCommand = (message) => {
  if (!message || !message.text) return false;
  return message.text.startsWith('/');
};

/**
 * Middleware che pulisce le scene attive quando si riceve un nuovo comando
 * @returns {Function} Middleware per la pulizia delle scene
 */
const sceneCleanerMiddleware = () => {
  return async (ctx, next) => {
    // Controlla se c'è una sessione e se il messaggio è un comando
    if (
      ctx.session && 
      ctx.session.__scenes && 
      ctx.session.__scenes.current && 
      ctx.message && 
      isCommand(ctx.message)
    ) {
      const currentScene = ctx.session.__scenes.current;
      const command = ctx.message.text.split(' ')[0]; // Prende solo il comando principale
      
      // Ignora il comando /annulla perché viene gestito direttamente dalla scena
      if (command === '/annulla') {
        return next();
      }
      
      logger.info(`Pulizia scena "${currentScene}" per utente ${ctx.from.id} a causa del comando ${command}`, {
        userId: ctx.from.id,
        username: ctx.from.username,
        currentScene,
        command
      });
      
      // Pulisci la scena attiva
      ctx.scene.leave();
      
      // Notifica all'utente
      await ctx.reply(`ℹ️ Ho interrotto la procedura precedente di "${currentScene}" a causa del nuovo comando "${command}".`);
    }
    
    return next();
  };
};

/**
 * Pulizia periodica delle sessioni inattive
 * @param {Object} bot - Istanza del bot Telegraf
 * @param {Number} inactivityTimeout - Timeout in millisecondi (default: 1 ora)
 */
const setupPeriodicCleaner = (bot, inactivityTimeout = 60 * 60 * 1000) => {
  // Mappa per tenere traccia dell'ultima attività per ogni utente
  const lastActivityMap = new Map();
  
  // Middleware per aggiornare la mappa delle attività
  bot.use((ctx, next) => {
    if (ctx.from && ctx.from.id) {
      lastActivityMap.set(ctx.from.id, Date.now());
    }
    return next();
  });
  
  // Funzione per la pulizia periodica
  const cleanInactiveSessions = async () => {
    try {
      logger.info('Pulizia stati inattivi completata');
      
      const now = Date.now();
      let cleanedCount = 0;
      
      // Controlla tutte le sessioni
      for (const [userId, lastActivity] of lastActivityMap.entries()) {
        // Se l'utente è inattivo da più del timeout
        if (now - lastActivity > inactivityTimeout) {
          try {
            // Qui potremmo fare richieste al bot per pulire la sessione
            // ma per sicurezza rimuoviamo solo dalla mappa
            lastActivityMap.delete(userId);
            cleanedCount++;
            
            logger.debug(`Pulizia stato per utente ${userId} dopo ${Math.round((now - lastActivity) / 1000 / 60)} minuti di inattività`);
          } catch (err) {
            logger.error(`Errore durante la pulizia della sessione per l'utente ${userId}:`, err);
          }
        }
      }
      
      if (cleanedCount > 0) {
        logger.info(`Pulite ${cleanedCount} sessioni inattive`);
      }
    } catch (err) {
      logger.error('Errore durante la pulizia periodica:', err);
    }
    
    // Pianifica la prossima pulizia
    setTimeout(cleanInactiveSessions, 60 * 60 * 1000); // Controlla ogni ora
  };
  
  // Avvia la pulizia periodica
  setTimeout(cleanInactiveSessions, 60 * 60 * 1000);
  
  logger.info('Pulizia periodica degli stati inattivi configurata');
};

module.exports = {
  sceneCleanerMiddleware,
  setupPeriodicCleaner
};
