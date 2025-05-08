// Servizio per la gestione degli annunci
const Announcement = require('../models/announcement');
const User = require('../models/user');
const { formatSellAnnouncement } = require('../utils/formatters');
const logger = require('../utils/logger');
const { Markup } = require('telegraf');

// Evitare dipendenze circolari importando il bot on-demand
let botModule = null;

/**
 * Ottiene il modulo del bot e assicura che sia caricato
 * @returns {Object} Il modulo del bot con bot e configurazioni
 */
const getBotModule = () => {
  if (!botModule) {
    botModule = require('../config/bot');
  }
  return botModule;
};

/**
 * Crea un nuovo annuncio di vendita con ID personalizzato
 * @param {Object} announcementData - Dati dell'annuncio
 * @param {Number} userId - ID dell'utente che crea l'annuncio
 * @returns {Promise<Object>} L'annuncio creato
 */
const createSellAnnouncement = async (announcementData, userId) => {
  try {
    logger.info(`Creazione nuovo annuncio di vendita per l'utente ${userId}`, { announcementData });
    
    // Genera un ID personalizzato nel formato userId_yyyy-MM-dd_HH-mm
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    
    const customId = `${userId}_${year}-${month}-${day}_${hours}-${minutes}`;
    
    // Crea l'annuncio nel database
    const newAnnouncement = new Announcement({
      _id: customId, // ID personalizzato
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
    logger.debug(`Annuncio creato con ID personalizzato: ${customId}`);
    return newAnnouncement;
  } catch (err) {
    logger.error('Errore nella creazione dell\'annuncio:', err);
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
    const { bot, SELL_GROUPS_CONFIG, BUY_GROUPS_CONFIG } = getBotModule();
    
    // Determina quale configurazione usare in base al tipo di annuncio
    const groupConfig = announcement.type === 'sell' ? 
      SELL_GROUPS_CONFIG : 
      BUY_GROUPS_CONFIG;
    
    // Estrai le informazioni necessarie (verifica se è già un oggetto o un JSON string)
    let groupId, topicId;
    
    if (typeof groupConfig === 'string') {
      try {
        const parsedConfig = JSON.parse(groupConfig);
        groupId = parsedConfig.groupId;
        topicId = parsedConfig.topicId;
      } catch (e) {
        logger.error('Errore nel parsing della configurazione del gruppo:', e);
        throw new Error('Configurazione del gruppo non valida');
      }
    } else {
      groupId = groupConfig.groupId;
      topicId = groupConfig.topicId;
    }
    
    logger.info(`Pubblicazione annuncio ${announcement._id} nel gruppo ${groupId}, topic ${topicId}`);
    
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
    
    // Pubblica il messaggio specificando il message_thread_id
    const msg = await bot.telegram.sendMessage(
      groupId,  // ID del gruppo
      messageText,
      {
        message_thread_id: topicId,  // ID del topic/thread
        parse_mode: 'Markdown',
        reply_markup: buttons
      }
    );
    
    // Aggiorna l'annuncio con l'ID del messaggio
    announcement.messageId = msg.message_id;
    await announcement.save();
    
    logger.debug(`Annuncio pubblicato con messageId: ${msg.message_id}`);
    return announcement;
  } catch (err) {
    logger.error(`Errore nella pubblicazione dell'annuncio ${announcement._id}:`, err);
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
    logger.info(`Archiviazione annuncio: ${announcementId}`);
    
    const announcement = await Announcement.findById(announcementId);
    if (!announcement) {
      logger.warn(`Tentativo di archiviare un annuncio non esistente: ${announcementId}`);
      throw new Error('Annuncio non trovato');
    }
    
    // Archivia l'annuncio
    announcement.status = 'archived';
    await announcement.save();
    
    // Elimina il messaggio dal topic se presente
    if (announcement.messageId) {
      try {
        const { bot, SELL_GROUPS_CONFIG, BUY_GROUPS_CONFIG } = getBotModule();
        
        // Determina quale configurazione usare
        const groupConfig = announcement.type === 'sell' ? 
          SELL_GROUPS_CONFIG : 
          BUY_GROUPS_CONFIG;
        
        // Estrai l'ID del gruppo
        let groupId;
        if (typeof groupConfig === 'string') {
          try {
            const parsedConfig = JSON.parse(groupConfig);
            groupId = parsedConfig.groupId;
          } catch (e) {
            logger.error('Errore nel parsing della configurazione del gruppo:', e);
            groupId = null;
          }
        } else {
          groupId = groupConfig.groupId;
        }
        
        if (groupId) {
          logger.debug(`Eliminazione messaggio ${announcement.messageId} dal gruppo ${groupId}`);
          await bot.telegram.deleteMessage(groupId, announcement.messageId);
        }
      } catch (err) {
        logger.warn(`Errore nell'eliminazione del messaggio ${announcement.messageId}:`, err);
        // Continua anche se non riesce a eliminare il messaggio
      }
    }
    
    logger.debug(`Annuncio ${announcementId} archiviato con successo`);
    return announcement;
  } catch (err) {
    logger.error(`Errore nell'archiviazione dell'annuncio ${announcementId}:`, err);
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
    logger.debug(`Ricerca annuncio attivo per utente ${userId}, tipo ${type}`);
    
    return await Announcement.findOne({
      userId: userId,
      type: type,
      status: 'active'
    });
  } catch (err) {
    logger.error(`Errore nel recupero dell'annuncio attivo per utente ${userId}:`, err);
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
    logger.info(`Aggiornamento annuncio attivo per utente ${userId}, tipo ${type}, annuncio ${announcementId || 'null'}`);
    
    const user = await User.findOne({ userId: userId });
    if (!user) {
      logger.warn(`Tentativo di aggiornare annuncio per utente non esistente: ${userId}`);
      throw new Error('Utente non trovato');
    }
    
    if (type === 'sell') {
      user.activeAnnouncements.sell = announcementId;
    } else if (type === 'buy') {
      user.activeAnnouncements.buy = announcementId;
    }
    
    await user.save();
    logger.debug(`Annuncio attivo aggiornato per utente ${userId}`);
    return user;
  } catch (err) {
    logger.error(`Errore nell'aggiornamento dell'annuncio attivo per utente ${userId}:`, err);
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
