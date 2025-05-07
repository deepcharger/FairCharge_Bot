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

module.exports = sceneCleanerMiddleware;
