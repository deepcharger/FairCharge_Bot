// Servizio per la gestione degli annunci
const { bot, SELL_GROUPS_CONFIG, BUY_GROUPS_CONFIG } = require('../config/bot');
const Announcement = require('../models/announcement');
const User = require('../models/user');
const { formatSellAnnouncement } = require('../utils/formatters');
const { Markup } = require('telegraf');

/**
 * Crea un nuovo annuncio di vendita
 * @param {Object} announcementData - Dati dell'annuncio
 * @param {Number} userId - ID dell'utente che crea l'annuncio
 * @returns {Promise<Object>} L'annuncio creato
 */
const createSellAnnouncement = async (announcementData, userId) => {
  try {
    // Crea l'annuncio nel database
    const newAnnouncement = new Announcement({
      type: 'sell',
      userId: userId,
      price: announcementData.price,
      connectorType: announcementData.connectorType,
      brand: announcementData.brand,
      location: announcementData.location,
      nonActivatableBrands: announcementData.nonActivatableBrands,
      additionalInfo: announcementData.additionalInfo
    });
    
    await newAnnouncement.save();
    return newAnnouncement;
  } catch (err) {
    console.error('Errore nella creazione dell\'annuncio:', err);
    throw err;
  }
};

/**
 * Pubblica un annuncio nel topic appropriato
 * @param {Object} announcement - L'annuncio da pubblicare
 * @param {Object} user - L'utente che ha creato l'annuncio
 * @returns {Promise<Object>} L'annuncio aggiornato con l'ID del messaggio
 */
const publishAnnouncement = async (announcement, user) => {
  try {
    const topicId = announcement.type === 'sell' ? 
      SELL_GROUPS_CONFIG.topicId : 
      BUY_GROUPS_CONFIG.topicId;
    
    // Formatta il messaggio appropriato
    const messageText = announcement.type === 'sell' ? 
      formatSellAnnouncement(announcement, user) : 
      formatBuyAnnouncement(announcement, user);
    
    // Prepara i bottoni inline
    const buttons = announcement.type === 'sell' ? 
      Markup.inlineKeyboard([
        [Markup.button.callback('🔋 Acquista kWh', `buy_kwh_${announcement._id}`)]
      ]) : 
      Markup.inlineKeyboard([
        [Markup.button.callback('🔌 Vendi kWh', `sell_kwh_${announcement._id}`)]
      ]);
    
    // Pubblica il messaggio
    const msg = await bot.telegram.sendMessage(
      topicId,
      messageText,
      {
        parse_mode: 'Markdown',
        reply_markup: buttons
      }
    );
    
    // Aggiorna l'annuncio con l'ID del messaggio
    announcement.messageId = msg.message_id;
    await announcement.save();
    
    return announcement;
  } catch (err) {
    console.error('Errore nella pubblicazione dell\'annuncio:', err);
    throw err;
  }
};

/**
 * Archivia un annuncio esistente
 * @param {String} announcementId - ID dell'annuncio da archiviare
 * @returns {Promise<Object>} L'annuncio archiviato
 */
const archiveAnnouncement = async (announcementId) => {
  try {
    const announcement = await Announcement.findById(announcementId);
    if (!announcement) {
      throw new Error('Annuncio non trovato');
    }
    
    // Archivia l'annuncio
    announcement.status = 'archived';
    await announcement.save();
    
    // Elimina il messaggio dal topic se presente
    if (announcement.messageId) {
      try {
        const topicId = announcement.type === 'sell' ? 
          SELL_GROUPS_CONFIG.topicId : 
          BUY_GROUPS_CONFIG.topicId;
        
        await bot.telegram.deleteMessage(topicId, announcement.messageId);
      } catch (err) {
        console.error('Errore nell\'eliminazione del messaggio:', err);
        // Continua anche se non riesce a eliminare il messaggio
      }
    }
    
    return announcement;
  } catch (err) {
    console.error('Errore nell\'archiviazione dell\'annuncio:', err);
    throw err;
  }
};

/**
 * Trova l'annuncio attivo di un utente
 * @param {Number} userId - ID dell'utente
 * @param {String} type - Tipo di annuncio (sell o buy)
 * @returns {Promise<Object>} L'annuncio attivo, o null se non trovato
 */
const getActiveAnnouncement = async (userId, type) => {
  try {
    return await Announcement.findOne({
      userId: userId,
      type: type,
      status: 'active'
    });
  } catch (err) {
    console.error('Errore nel recupero dell\'annuncio attivo:', err);
    throw err;
  }
};

/**
 * Aggiorna il riferimento all'annuncio attivo dell'utente
 * @param {Number} userId - ID dell'utente
 * @param {String} type - Tipo di annuncio (sell o buy)
 * @param {String} announcementId - ID dell'annuncio o null per rimuovere
 * @returns {Promise<Object>} L'utente aggiornato
 */
const updateUserActiveAnnouncement = async (userId, type, announcementId) => {
  try {
    const user = await User.findOne({ userId: userId });
    if (!user) {
      throw new Error('Utente non trovato');
    }
    
    if (type === 'sell') {
      user.activeAnnouncements.sell = announcementId;
    } else if (type === 'buy') {
      user.activeAnnouncements.buy = announcementId;
    }
    
    await user.save();
    return user;
  } catch (err) {
    console.error('Errore nell\'aggiornamento dell\'annuncio attivo dell\'utente:', err);
    throw err;
  }
};

module.exports = {
  createSellAnnouncement,
  publishAnnouncement,
  archiveAnnouncement,
  getActiveAnnouncement,
  updateUserActiveAnnouncement
};
