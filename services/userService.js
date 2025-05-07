// Servizio per la gestione degli utenti
const User = require('../models/user');
const Transaction = require('../models/transaction');
const Announcement = require('../models/announcement');
const logger = require('../utils/logger');

/**
 * Registra o aggiorna un utente nel database
 * @param {Object} userInfo - Informazioni dell'utente da Telegram
 * @returns {Promise<Object>} L'utente registrato o aggiornato
 */
const registerUser = async (userInfo) => {
  try {
    // Cerca l'utente nel database
    let dbUser = await User.findOne({ userId: userInfo.id });
    
    // Se l'utente non esiste, crealo
    if (!dbUser) {
      dbUser = new User({
        userId: userInfo.id,
        username: userInfo.username,
        firstName: userInfo.first_name,
        lastName: userInfo.last_name
      });
      await dbUser.save();
      logger.info(`Nuovo utente registrato: ${userInfo.id}`, { 
        userId: userInfo.id, 
        username: userInfo.username
      });
    } else {
      // Aggiorna le informazioni dell'utente se necessario
      if (dbUser.username !== userInfo.username || 
          dbUser.firstName !== userInfo.first_name || 
          dbUser.lastName !== userInfo.last_name) {
        
        const oldValues = {
          username: dbUser.username,
          firstName: dbUser.firstName,
          lastName: dbUser.lastName
        };
        
        dbUser.username = userInfo.username;
        dbUser.firstName = userInfo.first_name;
        dbUser.lastName = userInfo.last_name;
        await dbUser.save();
        
        logger.debug(`Informazioni utente aggiornate: ${userInfo.id}`, {
          userId: userInfo.id,
          oldValues,
          newValues: {
            username: userInfo.username,
            firstName: userInfo.first_name,
            lastName: userInfo.last_name
          }
        });
      }
    }
    
    return dbUser;
  } catch (err) {
    logger.error('Errore durante la registrazione dell\'utente:', err);
    throw err;
  }
};

/**
 * Ottiene il profilo completo di un utente
 * @param {Number} userId - ID dell'utente
 * @returns {Promise<Object>} Oggetto con i dati del profilo
 */
const getUserProfile = async (userId) => {
  try {
    logger.info(`Recupero profilo per utente ${userId}`);
    
    // Ottieni l'utente
    const user = await User.findOne({ userId: userId });
    if (!user) {
      logger.warn(`Tentativo di recuperare profilo per un utente non esistente: ${userId}`);
      throw new Error('Utente non trovato');
    }
    
    // Ottieni le transazioni recenti
    const transactions = await Transaction.find({
      $or: [
        { buyerId: userId },
        { sellerId: userId }
      ]
    }).sort({ createdAt: -1 }).limit(5);
    
    logger.debug(`Recuperate ${transactions.length} transazioni per l'utente ${userId}`);
    
    // Ottieni gli annunci attivi
    const sellAnnouncement = user.activeAnnouncements.sell ? 
      await Announcement.findById(user.activeAnnouncements.sell) : 
      null;
    
    const buyAnnouncement = user.activeAnnouncements.buy ? 
      await Announcement.findById(user.activeAnnouncements.buy) : 
      null;
    
    return {
      user,
      transactions,
      sellAnnouncement,
      buyAnnouncement
    };
  } catch (err) {
    logger.error(`Errore nel recupero del profilo utente ${userId}:`, err);
    throw err;
  }
};

/**
 * Aggiorna il saldo di un utente
 * @param {Number} userId - ID dell'utente
 * @param {Number} amount - Importo da aggiungere (o sottrarre se negativo)
 * @returns {Promise<Object>} L'utente aggiornato
 */
const updateUserBalance = async (userId, amount) => {
  try {
    logger.info(`Aggiornamento saldo per utente ${userId}`, {
      userId,
      amount,
      operation: amount >= 0 ? 'incremento' : 'decremento'
    });
    
    const user = await User.findOne({ userId: userId });
    if (!user) {
      logger.warn(`Tentativo di aggiornare il saldo per un utente non esistente: ${userId}`);
      throw new Error('Utente non trovato');
    }
    
    const oldBalance = user.balance;
    user.balance += amount;
    await user.save();
    
    logger.debug(`Saldo utente ${userId} aggiornato: ${oldBalance} -> ${user.balance}`);
    
    return user;
  } catch (err) {
    logger.error(`Errore nell'aggiornamento del saldo utente ${userId}:`, err);
    throw err;
  }
};

/**
 * Aggiorna il feedback di un utente
 * @param {Number} userId - ID dell'utente
 * @param {Boolean} isPositive - Se il feedback è positivo
 * @returns {Promise<Object>} L'utente aggiornato
 */
const updateUserFeedback = async (userId, isPositive) => {
  try {
    logger.info(`Aggiornamento feedback per utente ${userId}`, {
      userId,
      feedbackType: isPositive ? 'positivo' : 'negativo'
    });
    
    const user = await User.findOne({ userId: userId });
    if (!user) {
      logger.warn(`Tentativo di aggiornare il feedback per un utente non esistente: ${userId}`);
      throw new Error('Utente non trovato');
    }
    
    const oldTotalRatings = user.totalRatings;
    const oldPositiveRatings = user.positiveRatings;
    
    user.totalRatings += 1;
    if (isPositive) {
      user.positiveRatings += 1;
    }
    
    await user.save();
    
    const newPercentage = user.getPositivePercentage();
    logger.debug(`Feedback utente ${userId} aggiornato`, {
      oldStats: {
        total: oldTotalRatings,
        positive: oldPositiveRatings,
        percentage: oldTotalRatings ? Math.round((oldPositiveRatings / oldTotalRatings) * 100) : null
      },
      newStats: {
        total: user.totalRatings,
        positive: user.positiveRatings,
        percentage: newPercentage
      }
    });
    
    return user;
  } catch (err) {
    logger.error(`Errore nell'aggiornamento del feedback utente ${userId}:`, err);
    throw err;
  }
};

module.exports = {
  registerUser,
  getUserProfile,
  updateUserBalance,
  updateUserFeedback
};
