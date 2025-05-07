// Servizio per la gestione degli utenti
const User = require('../models/user');
const Transaction = require('../models/transaction');
const Announcement = require('../models/announcement');

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
      console.log(`Nuovo utente registrato: ${userInfo.id}`);
    } else {
      // Aggiorna le informazioni dell'utente se necessario
      if (dbUser.username !== userInfo.username || 
          dbUser.firstName !== userInfo.first_name || 
          dbUser.lastName !== userInfo.last_name) {
        
        dbUser.username = userInfo.username;
        dbUser.firstName = userInfo.first_name;
        dbUser.lastName = userInfo.last_name;
        await dbUser.save();
        console.log(`Informazioni utente aggiornate: ${userInfo.id}`);
      }
    }
    
    return dbUser;
  } catch (err) {
    console.error('Errore durante la registrazione dell\'utente:', err);
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
    // Ottieni l'utente
    const user = await User.findOne({ userId: userId });
    if (!user) {
      throw new Error('Utente non trovato');
    }
    
    // Ottieni le transazioni recenti
    const transactions = await Transaction.find({
      $or: [
        { buyerId: userId },
        { sellerId: userId }
      ]
    }).sort({ createdAt: -1 }).limit(5);
    
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
    console.error('Errore nel recupero del profilo utente:', err);
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
    const user = await User.findOne({ userId: userId });
    if (!user) {
      throw new Error('Utente non trovato');
    }
    
    user.balance += amount;
    await user.save();
    
    return user;
  } catch (err) {
    console.error('Errore nell\'aggiornamento del saldo utente:', err);
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
    const user = await User.findOne({ userId: userId });
    if (!user) {
      throw new Error('Utente non trovato');
    }
    
    user.totalRatings += 1;
    if (isPositive) {
      user.positiveRatings += 1;
    }
    
    await user.save();
    
    return user;
  } catch (err) {
    console.error('Errore nell\'aggiornamento del feedback utente:', err);
    throw err;
  }
};

module.exports = {
  registerUser,
  getUserProfile,
  updateUserBalance,
  updateUserFeedback
};
