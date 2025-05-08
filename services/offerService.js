// Servizio per la gestione delle offerte e ricariche
const { bot } = require('../config/bot');
const Offer = require('../models/offer');
const Announcement = require('../models/announcement');
const User = require('../models/user');
const moment = require('moment');
const { Markup } = require('telegraf');
const logger = require('../utils/logger');

/**
 * Crea una nuova offerta di ricarica
 * @param {Object} offerData - Dati dell'offerta
 * @param {String} announcementId - ID dell'annuncio (opzionale per ricariche manuali)
 * @returns {Promise<Object>} L'offerta creata
 */
const createOffer = async (offerData, announcementId = null) => {
  try {
    logger.info(`Creazione offerta: ${offerData.buyerId} → ${offerData.sellerId}`, {
      buyerId: offerData.buyerId,
      sellerId: offerData.sellerId,
      date: offerData.date,
      time: offerData.time,
      brand: offerData.brand,
      announcementId: announcementId || 'nessuno'
    });
    
    // Crea l'oggetto offerta
    const newOffer = new Offer({
      announcementId: announcementId,
      buyerId: offerData.buyerId,
      sellerId: offerData.sellerId,
      date: moment(offerData.date, 'DD/MM/YYYY').toDate(),
      time: offerData.time,
      brand: offerData.brand,
      coordinates: offerData.coordinates,
      additionalInfo: offerData.additionalInfo,
      status: 'pending'
    });
    
    // Calcola la data di scadenza (24 ore dopo la data/ora della ricarica)
    newOffer.expiresAt = moment(offerData.date, 'DD/MM/YYYY')
      .hour(parseInt(offerData.time.split(':')[0]))
      .minute(parseInt(offerData.time.split(':')[1]))
      .add(24, 'hours')
      .toDate();
    
    await newOffer.save();
    logger.debug(`Offerta creata con ID: ${newOffer._id}`);
    
    // Se c'è un annuncio collegato, aggiungi l'offerta all'annuncio
    if (announcementId) {
      const announcement = await Announcement.findById(announcementId);
      if (announcement) {
        announcement.offers.push(newOffer._id);
        await announcement.save();
        logger.debug(`Offerta ${newOffer._id} aggiunta all'annuncio ${announcementId}`);
      } else {
        logger.warn(`Tentativo di collegare offerta ${newOffer._id} a un annuncio non esistente: ${announcementId}`);
      }
    }
    
    return newOffer;
  } catch (err) {
    logger.error('Errore nella creazione dell\'offerta:', err);
    throw err;
  }
};

/**
 * Invia una notifica di nuova offerta al venditore
 * @param {Object} offer - L'offerta creata
 * @param {Object} buyer - L'acquirente
 * @param {Object} announcement - L'annuncio collegato (opzionale)
 * @returns {Promise<void>}
 */
const notifySellerAboutOffer = async (offer, buyer, announcement = null) => {
  try {
    logger.info(`Invio notifica di nuova offerta al venditore ${offer.sellerId}`, {
      offerId: offer._id,
      buyerId: buyer.userId,
      buyerName: buyer.username || buyer.firstName
    });
    
    // Prepara il testo della notifica con formattazione migliorata
    let offerText = `
🔋 *Nuova richiesta di ricarica* 🔋

👤 *Da:* ${buyer.username ? '@' + buyer.username : buyer.firstName}
📅 *Data:* ${moment(offer.date).format('DD/MM/YYYY')}
🕙 *Ora:* ${offer.time}
🏭 *Colonnina:* ${offer.brand}
📍 *Posizione:* ${offer.coordinates}
${offer.additionalInfo ? `ℹ️ *Info aggiuntive:* ${offer.additionalInfo}\n` : ''}
`;

    // Aggiungi dettagli sull'annuncio se disponibile
    if (announcement) {
      offerText += `\n💰 *Prezzo tuo annuncio:* ${announcement.price}`;
    } else {
      offerText += '\n💰 *Nota:* Questa richiesta utilizza il saldo donato da te o da altri venditori.';
    }
    
    // Prepara i bottoni inline
    const inlineKeyboard = {
      inline_keyboard: [
        [
          { text: '✅ Accetta', callback_data: `accept_offer_${offer._id}` },
          { text: '❌ Rifiuta', callback_data: `reject_offer_${offer._id}` }
        ]
      ]
    };
    
    // Invia la notifica al venditore
    await bot.telegram.sendMessage(offer.sellerId, offerText, {
      parse_mode: 'Markdown',
      reply_markup: inlineKeyboard
    });
    
    logger.debug(`Notifica inviata al venditore ${offer.sellerId}`);
  } catch (err) {
    logger.error(`Errore nell'invio della notifica al venditore ${offer.sellerId}:`, err);
    throw err;
  }
};

/**
 * Aggiorna lo stato di un'offerta
 * @param {String} offerId - ID dell'offerta
 * @param {String} newStatus - Nuovo stato dell'offerta
 * @param {Object} additionalData - Dati aggiuntivi da aggiornare
 * @returns {Promise<Object>} L'offerta aggiornata
 */
const updateOfferStatus = async (offerId, newStatus, additionalData = {}) => {
  try {
    logger.info(`Aggiornamento stato offerta ${offerId}: "${newStatus}"`, {
      offerId,
      newStatus,
      additionalData
    });
    
    const offer = await Offer.findById(offerId);
    if (!offer) {
      logger.warn(`Tentativo di aggiornare un'offerta non esistente: ${offerId}`);
      throw new Error('Offerta non trovata');
    }
    
    const oldStatus = offer.status;
    
    // Aggiorna lo stato
    offer.status = newStatus;
    
    // Aggiorna eventuali dati aggiuntivi
    Object.keys(additionalData).forEach(key => {
      offer[key] = additionalData[key];
    });
    
    // Se lo stato è 'completed', imposta la data di completamento
    if (newStatus === 'completed' && !offer.completedAt) {
      offer.completedAt = new Date();
    }
    
    await offer.save();
    
    logger.debug(`Stato offerta ${offerId} aggiornato: ${oldStatus} → ${newStatus}`);
    return offer;
  } catch (err) {
    logger.error(`Errore nell'aggiornamento dello stato dell'offerta ${offerId}:`, err);
    throw err;
  }
};

/**
 * Ottiene le offerte attive per un utente
 * @param {Number} userId - ID dell'utente
 * @returns {Promise<Object>} Oggetto con le offerte raggruppate per stato
 */
const getActiveOffers = async (userId) => {
  try {
    logger.info(`Recupero offerte attive per utente ${userId}`);
    
    // Trova tutte le offerte non rifiutate per questo utente
    const offers = await Offer.find({
      $or: [
        { buyerId: userId },
        { sellerId: userId }
      ],
      status: { $ne: 'rejected' }
    }).sort({ date: 1 });
    
    logger.debug(`Recuperate ${offers.length} offerte per l'utente ${userId}`);
    
    // Raggruppa le offerte per stato
    const groupedOffers = {
      pending: offers.filter(o => o.status === 'pending'),
      accepted: offers.filter(o => o.status === 'accepted'),
      readyToCharge: offers.filter(o => o.status === 'ready_to_charge'),
      charging: offers.filter(o => 
        ['charging_started', 'charging', 'charging_completed'].includes(o.status)
      ),
      payment: offers.filter(o => 
        ['kwh_confirmed', 'payment_pending', 'payment_sent'].includes(o.status)
      ),
      completed: offers.filter(o => o.status === 'completed'),
      disputed: offers.filter(o => o.status === 'disputed'),
      cancelled: offers.filter(o => o.status === 'cancelled')
    };
    
    // Log delle quantità per ogni categoria
    Object.keys(groupedOffers).forEach(key => {
      logger.debug(`Offerte con stato "${key}": ${groupedOffers[key].length}`);
    });
    
    return groupedOffers;
  } catch (err) {
    logger.error(`Errore nel recupero delle offerte attive per utente ${userId}:`, err);
    throw err;
  }
};

/**
 * Notifica l'utente quando lo stato di un'offerta cambia
 * @param {Object} offer - L'offerta aggiornata
 * @param {Number} targetUserId - L'ID dell'utente da notificare
 * @param {String} message - Il messaggio da inviare
 * @param {Object} keyboard - La tastiera inline da mostrare (opzionale)
 * @returns {Promise<void>}
 */
const notifyUserAboutOfferUpdate = async (offer, targetUserId, message, keyboard = null) => {
  try {
    logger.info(`Invio notifica per offerta ${offer._id} a ${targetUserId}`, {
      offerId: offer._id,
      targetUserId,
      offerStatus: offer.status,
      hasKeyboard: keyboard !== null
    });
    
    const options = {
      parse_mode: 'Markdown'
    };
    
    if (keyboard) {
      options.reply_markup = keyboard;
    }
    
    await bot.telegram.sendMessage(targetUserId, message, options);
    logger.debug(`Notifica inviata con successo a ${targetUserId}`);
  } catch (err) {
    logger.error(`Errore nell'invio della notifica all'utente ${targetUserId}:`, err);
    throw err;
  }
};

module.exports = {
  createOffer,
  notifySellerAboutOffer,
  updateOfferStatus,
  getActiveOffers,
  notifyUserAboutOfferUpdate
};
