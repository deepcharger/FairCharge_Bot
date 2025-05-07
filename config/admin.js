// Configurazione per l'amministratore del bot
const logger = require('../utils/logger');

// Ottieni l'ID dell'amministratore dalle variabili d'ambiente
const ADMIN_USER_ID = parseInt(process.env.ADMIN_USER_ID);

if (!ADMIN_USER_ID) {
  logger.warn('ADMIN_USER_ID non impostato nelle variabili d\'ambiente. Alcune funzionalità admin non funzioneranno.');
}

/**
 * Verifica se un utente è amministratore
 * @param {Number} userId - ID dell'utente da verificare
 * @returns {Boolean} true se l'utente è admin, false altrimenti
 */
const isAdmin = (userId) => {
  return userId === ADMIN_USER_ID;
};

module.exports = {
  ADMIN_USER_ID,
  isAdmin
};
