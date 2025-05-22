// Gestione delle callback per i bottoni inline
const { Markup } = require('telegraf');
const User = require('../models/user');
const Offer = require('../models/offer');
const Announcement = require('../models/announcement');
const Transaction = require('../models/transaction');
const Donation = require('../models/donation');
const logger = require('../utils/logger');
const moment = require('moment');
const { bot } = require('../config/bot');
const { isAdmin, ADMIN_USER_ID } = require('../config/admin');
const announcementService = require('../services/announcementService');
const offerService = require('../services/offerService');
const donationService = require('../services/donationService');
const transactionService = require('../services/transactionService');
const userService = require('../services/userService');
const whitelistService = require('../services/whitelistService');
const { formatSellAnnouncement } = require('../utils/formatters');
const uiElements = require('../utils/uiElements');

/**
 * Gestisce il click sul bottone "Compra kWh"
 * @param {Object} ctx - Contesto Telegraf
 */
const buyKwhCallback = async (ctx) => {
  try {
    logger.info(`Callback buy_kwh ricevuta da ${ctx.from.id}`, {
      userId: ctx.from.id,
      username: ctx.from.username,
      callbackData: ctx.callbackQuery.data
    });
    
    // Estrai l'ID dell'annuncio dalla callback data
    const announcementId = ctx.callbackQuery.data.split('_')[2];
    
    if (!announcementId) {
      await ctx.answerCbQuery('ID annuncio non valido', { show_alert: true });
      return;
    }
    
    // Registra l'utente se non esiste
    const user = await userService.registerUser(ctx.from);
    
    // Recupera l'annuncio
    const announcement = await Announcement.findById(announcementId);
    
    if (!announcement) {
      await ctx.answerCbQuery('Annuncio non trovato', { show_alert: true });
      return;
    }
    
    // Verifica se l'annuncio è attivo
    if (announcement.status !== 'active') {
      await ctx.answerCbQuery('Questo annuncio non è più attivo', { show_alert: true });
      return;
    }
    
    // Verifica che non sia il proprio annuncio
    if (announcement.userId === user.userId) {
      await ctx.answerCbQuery('Non puoi acquistare dal tuo stesso annuncio', { show_alert: true });
      return;
    }
    
    // Recupera info sul venditore
    const seller = await User.findOne({ userId: announcement.userId });
    
    if (!seller) {
      await ctx.answerCbQuery('Venditore non trovato', { show_alert: true });
      return;
    }
    
    // Memorizza l'ID dell'annuncio nella sessione dell'utente
    ctx.session.announcementId = announcementId;
    
    // Conferma la callback query
    await ctx.answerCbQuery();
    
    // Memorizza l'ID dell'offerta nella sessione
    ctx.session.paymentNotReceivedOfferId = offerId;
    
    // Chiedi al venditore di specificare il problema
    await ctx.reply(uiElements.formatErrorMessage(
      'Per favore, descrivi il problema con il pagamento. Questo messaggio verrà inviato all\'acquirente:',
      false
    ), {
      parse_mode: 'HTML'
    });
    
    // Imposta lo stato per gestire la risposta
    ctx.session.awaitingPaymentIssueDescription = true;
    
  } catch (err) {
    logger.error(`Errore nella callback paymentNotReceived per utente ${ctx.from.id}:`, err);
    await ctx.answerCbQuery('Si è verificato un errore. Per favore, riprova più tardi.', { show_alert: true });
  }
};

/**
 * Gestisce il feedback positivo
 * @param {Object} ctx - Contesto Telegraf
 */
const feedbackPositiveCallback = async (ctx) => {
  try {
    logger.info(`Callback feedback_positive ricevuta da ${ctx.from.id}`, {
      userId: ctx.from.id,
      username: ctx.from.username,
      callbackData: ctx.callbackQuery.data
    });
    
    // Estrai l'ID dell'offerta dalla callback data
    const offerId = ctx.callbackQuery.data.split('_')[2];
    
    // Cerca l'offerta
    const offer = await Offer.findById(offerId);
    
    if (!offer) {
      await ctx.answerCbQuery('Offerta non trovata', { show_alert: true });
      return;
    }
    
    // Verifica che l'utente sia l'acquirente o il venditore
    if (offer.buyerId !== ctx.from.id && offer.sellerId !== ctx.from.id) {
      await ctx.answerCbQuery('Non sei autorizzato a gestire questa offerta', { show_alert: true });
      return;
    }
    
    // Determina se l'utente è l'acquirente o il venditore
    const isbuyer = (offer.buyerId === ctx.from.id);
    
    // Verifica se l'utente ha già lasciato un feedback
    if (isbuyer && offer.buyerFeedback) {
      await ctx.answerCbQuery('Hai già lasciato un feedback per questa offerta', { show_alert: true });
      return;
    }
    
    if (!isbuyer && offer.sellerFeedback) {
      await ctx.answerCbQuery('Hai già lasciato un feedback per questa offerta', { show_alert: true });
      return;
    }
    
    // Aggiorna l'offerta con il feedback
    if (isbuyer) {
      offer.buyerFeedback = 'positive';
    } else {
      offer.sellerFeedback = 'positive';
    }
    await offer.save();
    
    // Aggiorna la valutazione dell'utente
    const targetUserId = isbuyer ? offer.sellerId : offer.buyerId;
    const targetUser = await User.findOne({ userId: targetUserId });
    
    if (targetUser) {
      targetUser.positiveRatings = (targetUser.positiveRatings || 0) + 1;
      targetUser.totalRatings = (targetUser.totalRatings || 0) + 1;
      await targetUser.save();
    }
    
    // Conferma la callback query
    await ctx.answerCbQuery('Feedback positivo registrato!');
    
    // Invia un messaggio di conferma
    await ctx.reply(uiElements.formatSuccessMessage(
      'Feedback Inviato',
      `Hai lasciato un feedback positivo per questa ricarica. Grazie per aver contribuito alla reputazione dell'utente!`
    ), {
      parse_mode: 'HTML',
      ...uiElements.mainMenuButton().reply_markup
    });
    
    // Notifica l'utente che ha ricevuto il feedback
    try {
      const sender = await User.findOne({ userId: ctx.from.id });
      const senderName = sender ? (sender.username ? '@' + sender.username : sender.firstName) : 'Un utente';
      
      await bot.telegram.sendMessage(
        targetUserId,
        uiElements.formatSuccessMessage(
          'Hai ricevuto un feedback positivo',
          `${senderName} ha lasciato un feedback positivo per la vostra ricarica. La tua reputazione è aumentata!`
        ),
        {
          parse_mode: 'HTML',
          ...uiElements.mainMenuButton().reply_markup
        }
      );
    } catch (notifyErr) {
      logger.error(`Errore nella notifica del feedback all'utente ${targetUserId}:`, notifyErr);
    }
    
  } catch (err) {
    logger.error(`Errore nella callback feedbackPositive per utente ${ctx.from.id}:`, err);
    await ctx.answerCbQuery('Si è verificato un errore. Per favore, riprova più tardi.', { show_alert: true });
  }
};

/**
 * Gestisce il feedback negativo
 * @param {Object} ctx - Contesto Telegraf
 */
const feedbackNegativeCallback = async (ctx) => {
  try {
    logger.info(`Callback feedback_negative ricevuta da ${ctx.from.id}`, {
      userId: ctx.from.id,
      username: ctx.from.username,
      callbackData: ctx.callbackQuery.data
    });
    
    // Estrai l'ID dell'offerta dalla callback data
    const offerId = ctx.callbackQuery.data.split('_')[2];
    
    // Cerca l'offerta
    const offer = await Offer.findById(offerId);
    
    if (!offer) {
      await ctx.answerCbQuery('Offerta non trovata', { show_alert: true });
      return;
    }
    
    // Verifica che l'utente sia l'acquirente o il venditore
    if (offer.buyerId !== ctx.from.id && offer.sellerId !== ctx.from.id) {
      await ctx.answerCbQuery('Non sei autorizzato a gestire questa offerta', { show_alert: true });
      return;
    }
    
    // Determina se l'utente è l'acquirente o il venditore
    const isbuyer = (offer.buyerId === ctx.from.id);
    
    // Verifica se l'utente ha già lasciato un feedback
    if (isbuyer && offer.buyerFeedback) {
      await ctx.answerCbQuery('Hai già lasciato un feedback per questa offerta', { show_alert: true });
      return;
    }
    
    if (!isbuyer && offer.sellerFeedback) {
      await ctx.answerCbQuery('Hai già lasciato un feedback per questa offerta', { show_alert: true });
      return;
    }
    
    // Conferma la callback query
    await ctx.answerCbQuery();
    
    // Memorizza nella sessione per raccogliere la motivazione
    ctx.session.negativeFeedbackOfferId = offerId;
    ctx.session.negativeFeedbackIsbuyer = isbuyer;
    
    // Chiedi la motivazione
    await ctx.reply(uiElements.formatErrorMessage(
      'Per favore, indica brevemente il motivo del feedback negativo:',
      false
    ), {
      parse_mode: 'HTML'
    });
    
    // Imposta lo stato per gestire la risposta
    ctx.session.awaitingNegativeFeedbackReason = true;
    
  } catch (err) {
    logger.error(`Errore nella callback feedbackNegative per utente ${ctx.from.id}:`, err);
    await ctx.answerCbQuery('Si è verificato un errore. Per favore, riprova più tardi.', { show_alert: true });
  }
};

/**
 * Gestisce l'annullamento di una ricarica
 * @param {Object} ctx - Contesto Telegraf
 */
const cancelChargeCallback = async (ctx) => {
  try {
    logger.info(`Callback cancel_charge ricevuta da ${ctx.from.id}`, {
      userId: ctx.from.id,
      username: ctx.from.username,
      callbackData: ctx.callbackQuery.data
    });
    
    // Estrai l'ID dell'offerta dalla callback data
    const offerId = ctx.callbackQuery.data.split('_')[2];
    
    // Cerca l'offerta
    const offer = await Offer.findById(offerId);
    
    if (!offer) {
      await ctx.answerCbQuery('Offerta non trovata', { show_alert: true });
      return;
    }
    
    // Verifica che l'utente sia l'acquirente o il venditore
    if (offer.buyerId !== ctx.from.id && offer.sellerId !== ctx.from.id) {
      await ctx.answerCbQuery('Non sei autorizzato a gestire questa offerta', { show_alert: true });
      return;
    }
    
    // Verifica che l'offerta non sia già completata o cancellata
    if (offer.status === 'completed' || offer.status === 'cancelled') {
      await ctx.answerCbQuery(`L'offerta è già ${offer.status === 'completed' ? 'completata' : 'cancellata'}`, { show_alert: true });
      return;
    }
    
    // Conferma la callback query
    await ctx.answerCbQuery();
    
    // Memorizza nella sessione per raccogliere la motivazione
    ctx.session.cancelChargeOfferId = offerId;
    
    // Chiedi la motivazione
    await ctx.reply(uiElements.formatErrorMessage(
      'Per favore, indica brevemente il motivo dell\'annullamento:',
      false
    ), {
      parse_mode: 'HTML'
    });
    
    // Imposta lo stato per gestire la risposta
    ctx.session.awaitingCancelChargeReason = true;
    
  } catch (err) {
    logger.error(`Errore nella callback cancelCharge per utente ${ctx.from.id}:`, err);
    await ctx.answerCbQuery('Si è verificato un errore. Per favore, riprova più tardi.', { show_alert: true });
  }
};

/**
 * Gestisce la donazione di una quantità fissa di kWh
 * @param {Object} ctx - Contesto Telegraf
 */
const donateFixedCallback = async (ctx) => {
  try {
    logger.info(`Callback donate_fixed ricevuta da ${ctx.from.id}`, {
      userId: ctx.from.id,
      username: ctx.from.username,
      callbackData: ctx.callbackQuery.data
    });
    
    // Estrai l'ID dell'offerta dalla callback data
    const offerId = ctx.callbackQuery.data.split('_')[2];
    
    // Cerca l'offerta
    const offer = await Offer.findById(offerId);
    
    if (!offer) {
      await ctx.answerCbQuery('Offerta non trovata', { show_alert: true });
      return;
    }
    
    // Verifica che l'utente sia il venditore
    if (offer.sellerId !== ctx.from.id) {
      await ctx.answerCbQuery('Non sei autorizzato a fare donazioni per questa offerta', { show_alert: true });
      return;
    }
    
    // Verifica che l'offerta sia completata
    if (offer.status !== 'completed') {
      await ctx.answerCbQuery('Puoi donare solo per offerte completate', { show_alert: true });
      return;
    }
    
    // Verifica che l'ADMIN_USER_ID sia configurato
    if (!ADMIN_USER_ID) {
      await ctx.answerCbQuery('Admin non configurato. Impossibile donare.', { show_alert: true });
      return;
    }
    
    const donationAmount = 2; // kWh fissi
    
    // Crea la donazione
    try {
      await donationService.createDonation(offer.sellerId, ADMIN_USER_ID, donationAmount, offer._id);
      
      // Conferma la callback query
      await ctx.answerCbQuery('Donazione effettuata con successo!');
      
      // Invia un messaggio di conferma al venditore
      await ctx.reply(uiElements.formatSuccessMessage(
        'Donazione Effettuata',
        `Hai donato ${donationAmount.toFixed(2)} kWh all'amministratore. Questo credito sarà disponibile per le prossime ricariche che l'amministratore effettuerà presso di te.\n\nGrazie per il tuo supporto!`
      ), {
        parse_mode: 'HTML',
        ...uiElements.mainMenuButton().reply_markup
      });
      
      // Notifica l'amministratore
      try {
        const seller = await User.findOne({ userId: offer.sellerId });
        const sellerName = seller ? (seller.username ? '@' + seller.username : seller.firstName) : 'Un venditore';
        
        await bot.telegram.sendMessage(
          ADMIN_USER_ID,
          uiElements.formatSuccessMessage(
            'Donazione Ricevuta',
            `${sellerName} ha donato ${donationAmount.toFixed(2)} kWh al tuo account. Questo credito sarà disponibile per le tue prossime ricariche presso questo venditore.\n\nUsa /le_mie_donazioni per vedere tutte le donazioni ricevute.`
          ),
          {
            parse_mode: 'HTML',
            ...uiElements.mainMenuButton().reply_markup
          }
        );
      } catch (notifyErr) {
        logger.error(`Errore nella notifica all'admin ${ADMIN_USER_ID} della donazione:`, notifyErr);
      }
      
    } catch (donationErr) {
      logger.error(`Errore nella creazione della donazione:`, donationErr);
      await ctx.answerCbQuery('Si è verificato un errore durante la donazione', { show_alert: true });
    }
    
  } catch (err) {
    logger.error(`Errore nella callback donateFixed per utente ${ctx.from.id}:`, err);
    await ctx.answerCbQuery('Si è verificato un errore. Per favore, riprova più tardi.', { show_alert: true });
  }
};

/**
 * Gestisce la donazione di una quantità personalizzata di kWh
 * @param {Object} ctx - Contesto Telegraf
 */
const donateCustomCallback = async (ctx) => {
  try {
    logger.info(`Callback donate_custom ricevuta da ${ctx.from.id}`, {
      userId: ctx.from.id,
      username: ctx.from.username,
      callbackData: ctx.callbackQuery.data
    });
    
    // Estrai l'ID dell'offerta dalla callback data
    const offerId = ctx.callbackQuery.data.split('_')[2];
    
    // Cerca l'offerta
    const offer = await Offer.findById(offerId);
    
    if (!offer) {
      await ctx.answerCbQuery('Offerta non trovata', { show_alert: true });
      return;
    }
    
    // Verifica che l'utente sia il venditore
    if (offer.sellerId !== ctx.from.id) {
      await ctx.answerCbQuery('Non sei autorizzato a fare donazioni per questa offerta', { show_alert: true });
      return;
    }
    
    // Verifica che l'offerta sia completata
    if (offer.status !== 'completed') {
      await ctx.answerCbQuery('Puoi donare solo per offerte completate', { show_alert: true });
      return;
    }
    
    // Verifica che l'ADMIN_USER_ID sia configurato
    if (!ADMIN_USER_ID) {
      await ctx.answerCbQuery('Admin non configurato. Impossibile donare.', { show_alert: true });
      return;
    }
    
    // Conferma la callback query
    await ctx.answerCbQuery();
    
    // Memorizza l'offerta ID nella sessione
    ctx.session.donateCustomOfferId = offerId;
    
    // Chiedi la quantità
    await ctx.reply(uiElements.formatConfirmationMessage(
      'Donazione Personalizzata',
      [
        { label: 'Transazione', value: `ID: ${offerId}` },
        { label: 'kWh caricati', value: `${offer.kwhAmount.toFixed(2)} kWh` }
      ]
    ) + '\n\nInserisci la quantità di kWh che vuoi donare (es. 1.5):', {
      parse_mode: 'HTML'
    });
    
    // Imposta lo stato per gestire la risposta
    ctx.session.awaitingDonationAmount = true;
    
  } catch (err) {
    logger.error(`Errore nella callback donateCustom per utente ${ctx.from.id}:`, err);
    await ctx.answerCbQuery('Si è verificato un errore. Per favore, riprova più tardi.', { show_alert: true });
  }
};

/**
 * Gestisce il salto della donazione
 * @param {Object} ctx - Contesto Telegraf
 */
const donateSkipCallback = async (ctx) => {
  try {
    logger.info(`Callback donate_skip ricevuta da ${ctx.from.id}`, {
      userId: ctx.from.id,
      username: ctx.from.username,
      callbackData: ctx.callbackQuery.data
    });
    
    // Conferma la callback query
    await ctx.answerCbQuery('Nessun problema! Grazie comunque.');
    
    // Invia un messaggio di ringraziamento
    await ctx.reply(uiElements.formatSuccessMessage(
      'Nessuna Donazione',
      'Hai scelto di non donare kWh all\'amministratore. Nessun problema, grazie comunque per aver usato il servizio!'
    ), {
      parse_mode: 'HTML',
      ...uiElements.mainMenuButton().reply_markup
    });
    
  } catch (err) {
    logger.error(`Errore nella callback donateSkip per utente ${ctx.from.id}:`, err);
    await ctx.answerCbQuery('Si è verificato un errore. Per favore, riprova più tardi.', { show_alert: true });
  }
};

/**
 * Gestisce l'invio di una richiesta manuale
 * @param {Object} ctx - Contesto Telegraf
 */
const sendManualRequestCallback = async (ctx) => {
  try {
    logger.info(`Callback send_manual_request ricevuta da ${ctx.from.id}`, {
      userId: ctx.from.id,
      username: ctx.from.username
    });
    
    // Verifica che l'utente sia l'admin
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('Solo l\'amministratore può usare questa funzione', { show_alert: true });
      return;
    }
    
    // Recupera i dati dalla sessione
    const {
      manualChargeSellerId,
      manualChargeDate,
      manualChargeTime,
      manualChargeLocation,
      manualChargeKwh,
      manualChargeConnector
    } = ctx.session;
    
    if (!manualChargeSellerId || !manualChargeDate || !manualChargeTime || !manualChargeKwh) {
      await ctx.answerCbQuery('Dati incompleti. Riprova.', { show_alert: true });
      return;
    }
    
    // Cerca il venditore
    const seller = await User.findOne({ userId: manualChargeSellerId });
    
    if (!seller) {
      await ctx.answerCbQuery('Venditore non trovato', { show_alert: true });
      return;
    }
    
    // Conferma la callback query
    await ctx.answerCbQuery();
    
    try {
      // Recupera annuncio attivo del venditore (se disponibile)
      const announcement = await Announcement.findOne({
        userId: manualChargeSellerId,
        status: 'active',
        type: 'sell'
      });
      
      // Prezzo di default se non c'è un annuncio
      const pricePerKwh = announcement ? announcement.pricePerKwh : 0.40;
      
      // Crea la nuova offerta
      const newOffer = new Offer({
        buyerId: ctx.from.id,
        sellerId: manualChargeSellerId,
        status: 'pending',
        createdAt: new Date(),
        statusChangedAt: new Date(),
        pricePerKwh: pricePerKwh,
        kwhAmount: parseFloat(manualChargeKwh),
        totalAmount: parseFloat(manualChargeKwh) * pricePerKwh,
        chargeDate: `${manualChargeDate} ${manualChargeTime}`,
        additionalInfo: `Richiesta diretta dall'amministratore. Luogo: ${manualChargeLocation || 'Non specificato'}`,
        connectorType: manualChargeConnector || 'Non specificato'
      });
      
      await newOffer.save();
      
      // Pulisci la sessione
      delete ctx.session.manualChargeSellerId;
      delete ctx.session.manualChargeDate;
      delete ctx.session.manualChargeTime;
      delete ctx.session.manualChargeLocation;
      delete ctx.session.manualChargeKwh;
      delete ctx.session.manualChargeConnector;
      
      // Invia conferma all'admin
      await ctx.reply(uiElements.formatSuccessMessage(
        'Richiesta Inviata',
        `La tua richiesta di ricarica di ${manualChargeKwh} kWh è stata inviata a ${seller.username ? '@' + seller.username : seller.firstName}.`
      ), {
        parse_mode: 'HTML',
        ...uiElements.mainMenuButton().reply_markup
      });
      
      // Notifica il venditore
      try {
        const admin = await User.findOne({ userId: ctx.from.id });
        const adminName = admin ? (admin.username ? '@' + admin.username : admin.firstName) : 'L\'amministratore';
        
        await bot.telegram.sendMessage(
          seller.userId,
          uiElements.formatSuccessMessage(
            'Nuova Richiesta di Ricarica',
            `${adminName} ha richiesto di ricaricare ${manualChargeKwh} kWh presso di te il ${manualChargeDate} alle ${manualChargeTime}.`
          ),
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '✅ Accetta', callback_data: `accept_offer_${newOffer._id}` },
                  { text: '❌ Rifiuta', callback_data: `reject_offer_${newOffer._id}` }
                ]
              ]
            }
          }
        );
      } catch (notifyErr) {
        logger.error(`Errore nella notifica al venditore ${seller.userId}:`, notifyErr);
      }
      
    } catch (createErr) {
      logger.error('Errore nella creazione dell\'offerta manuale:', createErr);
      await ctx.reply(uiElements.formatErrorMessage('Si è verificato un errore nella creazione dell\'offerta. Riprova più tardi.', true), {
        parse_mode: 'HTML',
        ...uiElements.mainMenuButton().reply_markup
      });
    }
    
  } catch (err) {
    logger.error(`Errore nella callback sendManualRequest per utente ${ctx.from.id}:`, err);
    await ctx.answerCbQuery('Si è verificato un errore. Per favore, riprova più tardi.', { show_alert: true });
  }
};

/**
 * Gestisce l'annullamento di una richiesta manuale
 * @param {Object} ctx - Contesto Telegraf
 */
const cancelManualRequestCallback = async (ctx) => {
  try {
    logger.info(`Callback cancel_manual_request ricevuta da ${ctx.from.id}`, {
      userId: ctx.from.id,
      username: ctx.from.username
    });
    
    // Conferma la callback query
    await ctx.answerCbQuery('Richiesta annullata');
    
    // Pulisci la sessione
    delete ctx.session.manualChargeSellerId;
    delete ctx.session.manualChargeDate;
    delete ctx.session.manualChargeTime;
    delete ctx.session.manualChargeLocation;
    delete ctx.session.manualChargeKwh;
    delete ctx.session.manualChargeConnector;
    
    // Invia messaggio di conferma
    await ctx.reply(uiElements.formatErrorMessage('Richiesta di ricarica annullata.', false), {
      parse_mode: 'HTML',
      ...uiElements.mainMenuButton().reply_markup
    });
    
  } catch (err) {
    logger.error(`Errore nella callback cancelManualRequest per utente ${ctx.from.id}:`, err);
    await ctx.answerCbQuery('Si è verificato un errore. Per favore, riprova più tardi.', { show_alert: true });
  }
};

/**
 * Gestisce le callback di paginazione per le liste
 * @param {Object} ctx - Contesto Telegraf
 */
const handlePaginationCallback = async (ctx) => {
  try {
    // Estrai i dati dalla callback query
    const callbackData = ctx.callbackQuery.data;
    const [baseData, direction, currentPage] = callbackData.split('_');
    
    // Calcola la nuova pagina
    const page = parseInt(currentPage);
    const newPage = direction === 'next' ? page + 1 : page - 1;
    
    if (newPage < 1) {
      await ctx.answerCbQuery('Sei già alla prima pagina');
      return;
    }
    
    // Aggiorna la pagina nella sessione
    ctx.session[`${baseData}Page`] = newPage;
    
    // Conferma la callback query
    await ctx.answerCbQuery();
    
    // A seconda del tipo di dati da paginare, chiama il comando appropriato
    switch (baseData) {
      case 'transactions':
        return await commands.myTransactionsCommand(ctx);
      case 'offers':
        return await commands.myChargesCommand(ctx);
      case 'partners':
        return await commands.myPartnersCommand(ctx);
      case 'wallet':
        return await commands.walletDetailsCommand(ctx);
      case 'donation':
        return await commands.myDonationsCommand(ctx);
      default:
        await ctx.answerCbQuery('Paginazione non supportata per questo tipo di dati');
    }
  } catch (err) {
    logger.error('Errore nella gestione della paginazione:', err);
    await ctx.answerCbQuery('Errore nella paginazione', { show_alert: true });
  }
};

/**
 * Gestisce tutte le callback del menu
 * @param {Object} ctx - Contesto Telegraf
 */
const handleMenuCallback = async (ctx) => {
  try {
    const callbackData = ctx.callbackQuery.data;
    
    // Conferma la callback query
    await ctx.answerCbQuery();
    
    // Gestisci le callback in base al prefisso
    if (callbackData.startsWith('wallet_')) {
      // Callback del portafoglio
      switch (callbackData) {
        case 'wallet_sell':
          return await commands.sellKwhCommand(ctx);
        case 'wallet_buy':
          // Qui dovresti implementare la funzionalità per comprare kWh
          return await ctx.reply('Funzionalità in fase di implementazione');
        case 'wallet_stats':
          return await commands.walletStatsCommand(ctx);
        case 'wallet_transactions':
          return await commands.myTransactionsCommand(ctx);
      }
    } else if (callbackData.startsWith('admin_')) {
      // Callback del menu admin
      switch (callbackData) {
        case 'admin_donations':
          return await commands.myDonationsCommand(ctx);
        case 'admin_update_commands':
          return await commands.updateBotCommandsCommand(ctx);
        case 'admin_system_checkup':
          return await commands.systemCheckupCommand(ctx);
        case 'admin_db_stats':
          // Simuliamo il comando db_admin stats
          ctx.message = { text: '/db_admin stats' };
          return await commands.dbAdminCommand(ctx);
      }
    } else if (callbackData === 'back_to_main') {
      // Torna al menu principale
      const { createInlineMenus } = require('../utils/commandLoader');
      await createInlineMenus(ctx.from.id, isAdmin(ctx.from.id));
      
      // Eliminiamo il messaggio precedente per evitare confusione
      try {
        await ctx.deleteMessage();
      } catch (err) {
        logger.warn(`Impossibile eliminare il messaggio del menu:`, err);
      }
    } else if (callbackData.startsWith('refresh_')) {
      // Gestisci i callback di aggiornamento
      const refreshType = callbackData.split('_')[1];
      const id = callbackData.split('_')[2];
      
      switch (refreshType) {
        case 'partner':
          ctx.message = { text: `/portafoglio_partner ${id}` };
          return await commands.partnerWalletCommand(ctx);
        case 'vendor':
          ctx.message = { text: `/portafoglio_venditore ${id}` };
          return await commands.vendorWalletCommand(ctx);
        case 'donations':
          return await commands.myDonationsCommand(ctx);
      }
    } else if (callbackData === 'recheck_admin') {
      return await commands.checkAdminConfigCommand(ctx);
    } else if (callbackData === 'create_admin_now') {
      return await commands.createAdminAccountCommand(ctx);
    } else if (callbackData === 'system_checkup_again') {
      return await commands.systemCheckupCommand(ctx);
    }
    
  } catch (err) {
    logger.error(`Errore nella callback di menu per utente ${ctx.from.id}:`, err);
    await ctx.answerCbQuery('Si è verificato un errore. Per favore, riprova più tardi.', { show_alert: true });
  }
};

// ===== NUOVE CALLBACK PER SICUREZZA E WHITELIST =====

/**
 * Gestisce l'approvazione di un utente sospetto
 */
const approveUserCallback = async (ctx) => {
  try {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('Non autorizzato', { show_alert: true });
      return;
    }
    
    const userId = parseInt(ctx.callbackQuery.data.split('_')[2]);
    
    const result = await whitelistService.addToWhitelist(
      userId, 
      'Approvato dopo revisione sicurezza', 
      ctx.from.id
    );
    
    if (result.success) {
      await ctx.answerCbQuery('Utente approvato!');
      
      await ctx.editMessageText(
        ctx.callbackQuery.message.text + '\n\n✅ <b>APPROVATO</b> da ' + 
        (ctx.from.username ? '@' + ctx.from.username : ctx.from.first_name),
        { parse_mode: 'HTML' }
      );
      
      // Notifica l'utente
      try {
        await bot.telegram.sendMessage(
          userId,
          '🎉 <b>Account Approvato!</b>\n\n' +
          'Il tuo account è stato verificato e approvato.\n' +
          'Ora puoi utilizzare tutte le funzionalità di FairCharge Pro!',
          { parse_mode: 'HTML' }
        );
      } catch (notifyErr) {
        logger.warn(`Impossibile notificare l'utente ${userId}:`, notifyErr);
      }
      
    } else {
      await ctx.answerCbQuery('Errore nell\'approvazione', { show_alert: true });
    }
    
  } catch (err) {
    logger.error('Errore nella callback approveUser:', err);
    await ctx.answerCbQuery('Errore nell\'operazione', { show_alert: true });
  }
};

/**
 * Gestisce il blocco di un utente sospetto
 */
const blockUserCallback = async (ctx) => {
  try {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('Non autorizzato', { show_alert: true });
      return;
    }
    
    const userId = parseInt(ctx.callbackQuery.data.split('_')[2]);
    
    const user = await User.findOne({ userId });
    
    if (user) {
      await user.blockUser('Bloccato dopo revisione sicurezza', ctx.from.id);
      
      await ctx.answerCbQuery('Utente bloccato!');
      
      await ctx.editMessageText(
        ctx.callbackQuery.message.text + '\n\n🚫 <b>BLOCCATO</b> da ' + 
        (ctx.from.username ? '@' + ctx.from.username : ctx.from.first_name),
        { parse_mode: 'HTML' }
      );
      
      // Notifica l'utente
      try {
        await bot.telegram.sendMessage(
          userId,
          '🚫 <b>Account Bloccato</b>\n\n' +
          'Il tuo account è stato temporaneamente bloccato per motivi di sicurezza.\n' +
          'Per maggiori informazioni, contatta il supporto.',
          { parse_mode: 'HTML' }
        );
      } catch (notifyErr) {
        logger.warn(`Impossibile notificare l'utente ${userId}:`, notifyErr);
      }
      
    } else {
      await ctx.answerCbQuery('Utente non trovato', { show_alert: true });
    }
    
  } catch (err) {
    logger.error('Errore nella callback blockUser:', err);
    await ctx.answerCbQuery('Errore nell\'operazione', { show_alert: true });
  }
};

/**
 * Gestisce l'approvazione VIP di un utente
 */
const approveVipUserCallback = async (ctx) => {
  try {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('Non autorizzato', { show_alert: true });
      return;
    }
    
    const userId = parseInt(ctx.callbackQuery.data.split('_')[3]);
    
    // Prima approva l'utente nella whitelist
    const whitelistResult = await whitelistService.addToWhitelist(
      userId, 
      'Approvato VIP dopo revisione sicurezza', 
      ctx.from.id
    );
    
    if (whitelistResult.success) {
      // Poi prova ad aggiungerlo al gruppo VIP
      const vipResult = await whitelistService.addToVipGroup(userId);
      
      if (vipResult.success) {
        await ctx.answerCbQuery('Utente approvato come VIP!');
        
        await ctx.editMessageText(
          ctx.callbackQuery.message.text + '\n\n👑 <b>APPROVATO VIP</b> da ' + 
          (ctx.from.username ? '@' + ctx.from.username : ctx.from.first_name),
          { parse_mode: 'HTML' }
        );
        
        // Notifica l'utente con il link VIP
        try {
          await bot.telegram.sendMessage(
            userId,
            '👑 <b>Account VIP Approvato!</b>\n\n' +
            'Il tuo account è stato approvato con status VIP.\n' +
            'Ora puoi utilizzare tutte le funzionalità premium di FairCharge Pro!\n\n' +
            `🎯 <b>Link gruppo VIP:</b> ${vipResult.inviteLink}\n\n` +
            'Clicca sul link per unirti al gruppo VIP riservato ai venditori verificati.',
            { 
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '👑 Unisciti al Gruppo VIP', url: vipResult.inviteLink }]
                ]
              }
            }
          );
        } catch (notifyErr) {
          logger.warn(`Impossibile notificare l'utente VIP ${userId}:`, notifyErr);
        }
        
      } else {
        await ctx.answerCbQuery('Utente approvato ma errore gruppo VIP', { show_alert: true });
      }
      
    } else {
      await ctx.answerCbQuery('Errore nell\'approvazione', { show_alert: true });
    }
    
  } catch (err) {
    logger.error('Errore nella callback approveVipUser:', err);
    await ctx.answerCbQuery('Errore nell\'operazione', { show_alert: true });
  }
};

/**
 * Gestisce la visualizzazione dei dettagli utente
 */
const userDetailsCallback = async (ctx) => {
  try {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('Non autorizzato', { show_alert: true });
      return;
    }
    
    const userId = parseInt(ctx.callbackQuery.data.split('_')[2]);
    
    const user = await User.findOne({ userId });
    
    if (!user) {
      await ctx.answerCbQuery('Utente non trovato', { show_alert: true });
      return;
    }
    
    await ctx.answerCbQuery();
    
    let details = `👤 <b>Dettagli Utente</b>\n\n`;
    details += `<b>Nome:</b> ${user.firstName}`;
    if (user.lastName) details += ` ${user.lastName}`;
    details += `\n<b>ID:</b> ${user.userId}`;
    details += `\n<b>Username:</b> ${user.username ? '@' + user.username : 'N/A'}`;
    details += `\n<b>Registrato:</b> ${user.registrationDate.toLocaleDateString('it-IT')}`;
    details += `\n<b>Whitelist:</b> ${user.isWhitelisted ? '✅ Approvato' : '❌ Standard'}`;
    details += `\n<b>Bloccato:</b> ${user.isBlocked ? '🚫 Sì' : '✅ No'}`;
    details += `\n<b>Feedback:</b> ${user.positiveRatings}/${user.totalRatings}`;
    
    if (user.positiveRatings > 0) {
      const percentage = user.getPositivePercentage();
      details += ` (${percentage}%)`;
    }
    
    details += `\n<b>Risk Score:</b> ${user.riskScore || 0}/10`;
    details += `\n<b>Risk Level:</b> ${(user.riskLevel || 'low').toUpperCase()}`;
    
    if (user.securityFlags && user.securityFlags.length > 0) {
      details += `\n\n<b>🚨 Security Flags (${user.securityFlags.length}):</b>`;
      user.securityFlags.slice(-3).forEach(flag => {
        const icon = flag.severity === 'high' ? '🔴' : flag.severity === 'medium' ? '🟡' : '🟢';
        details += `\n${icon} ${flag.description}`;
      });
    }
    
    await ctx.reply(details, { 
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Approva', callback_data: `approve_user_${userId}` },
            { text: '❌ Blocca', callback_data: `block_user_${userId}` }
          ],
          [
            { text: '👑 Approva VIP', callback_data: `approve_vip_user_${userId}` }
          ],
          [
            { text: '🔍 Analizza Sicurezza', callback_data: `analyze_security_${userId}` }
          ]
        ]
      }
    });
    
  } catch (err) {
    logger.error('Errore nella callback userDetails:', err);
    await ctx.answerCbQuery('Errore nell\'operazione', { show_alert: true });
  }
};

/**
 * Gestisce l'analisi di sicurezza di un utente
 */
const analyzeSecurityCallback = async (ctx) => {
  try {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('Non autorizzato', { show_alert: true });
      return;
    }
    
    const userId = parseInt(ctx.callbackQuery.data.split('_')[2]);
    
    await ctx.answerCbQuery();
    
    // Simula il comando di analisi sicurezza
    const securityService = require('../services/securityService');
    ctx.message = { text: `/analyze_security ${userId}` };
    
    return await securityService.analyzeUserSecurityCommand(ctx);
    
  } catch (err) {
    logger.error('Errore nella callback analyzeSecurity:', err);
    await ctx.answerCbQuery('Errore nell\'operazione', { show_alert: true });
  }
};

/**
 * Gestisce l'aggiunta al gruppo VIP
 */
const addToVipCallback = async (ctx) => {
  try {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('Non autorizzato', { show_alert: true });
      return;
    }
    
    const userId = parseInt(ctx.callbackQuery.data.split('_')[3]);
    
    const vipResult = await whitelistService.addToVipGroup(userId);
    
    if (vipResult.success) {
      await ctx.answerCbQuery('Link VIP creato!');
      
      const user = await User.findOne({ userId });
      const userName = user ? (user.username ? '@' + user.username : user.firstName) : 'L\'utente';
      
      await ctx.reply(
        `👑 <b>Link VIP creato per ${userName}</b>\n\n` +
        `Link: ${vipResult.inviteLink}\n\n` +
        `Invia questo link all'utente per permettergli di unirsi al gruppo VIP.`,
        { 
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '📤 Invia link all\'utente', callback_data: `send_vip_link_${userId}` }]
            ]
          }
        }
      );
      
    } else {
      await ctx.answerCbQuery('Errore nella creazione del link VIP', { show_alert: true });
    }
    
  } catch (err) {
    logger.error('Errore nella callback addToVip:', err);
    await ctx.answerCbQuery('Errore nell\'operazione', { show_alert: true });
  }
};

/**
 * Gestisce l'invio del link VIP all'utente
 */
const sendVipLinkCallback = async (ctx) => {
  try {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('Non autorizzato', { show_alert: true });
      return;
    }
    
    const userId = parseInt(ctx.callbackQuery.data.split('_')[3]);
    
    const vipResult = await whitelistService.addToVipGroup(userId);
    
    if (vipResult.success) {
      // Invia il link all'utente
      try {
        await bot.telegram.sendMessage(
          userId,
          '👑 <b>Invito Gruppo VIP</b>\n\n' +
          'Sei stato invitato a unirti al gruppo VIP di FairCharge Pro!\n\n' +
          'Questo gruppo è riservato ai venditori verificati e offre:\n' +
          '• Accesso a funzionalità premium\n' +
          '• Supporto prioritario\n' +
          '• Networking con altri venditori verificati\n\n' +
          'Clicca sul bottone per unirti:',
          { 
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '👑 Unisciti al Gruppo VIP', url: vipResult.inviteLink }]
              ]
            }
          }
        );
        
        await ctx.answerCbQuery('Link VIP inviato all\'utente!');
        
      } catch (sendErr) {
        logger.error(`Errore nell'invio del link VIP all'utente ${userId}:`, sendErr);
        await ctx.answerCbQuery('Errore nell\'invio del link', { show_alert: true });
      }
      
    } else {
      await ctx.answerCbQuery('Errore nella creazione del link VIP', { show_alert: true });
    }
    
module.exports = {
  // Callback esistenti per il flusso di acquisto/vendita kWh
  buyKwhCallback,
  startBuyCallback,
  connectorTypeCallback,
  publishSellCallback,
  cancelSellCallback,
  acceptConditionsCallback,
  cancelBuyCallback,
  sendRequestCallback,
  acceptOfferCallback,
  rejectOfferCallback,
  readyToChargeCallback,
  chargingStartedCallback,
  chargingOkCallback,
  chargingIssuesCallback,
  chargingCompletedCallback,
  confirmKwhCallback,
  disputeKwhCallback,
  setPaymentCallback,
  verifyPaymentCallback,
  confirmPaymentRequestCallback,
  cancelPaymentRequestCallback,
  paymentSentCallback,
  paymentConfirmedCallback,
  paymentNotReceivedCallback,
  feedbackPositiveCallback,
  feedbackNegativeCallback,
  cancelChargeCallback,
  donateFixedCallback,
  donateCustomCallback,
  donateSkipCallback,
  sendManualRequestCallback,
  cancelManualRequestCallback,
  handlePaginationCallback,
  handleMenuCallback,
  
  // Nuove callback per sicurezza e whitelist
  approveUserCallback,
  blockUserCallback,
  approveVipUserCallback,
  userDetailsCallback,
  analyzeSecurityCallback,
  addToVipCallback,
  sendVipLinkCallback
};
    
    // Visualizza i dettagli dell'annuncio in un nuovo messaggio
    const message = `${uiElements.formatProgressMessage(1, 5, "Procedura di Acquisto kWh")}Hai selezionato questo annuncio:\n\n${formatSellAnnouncement(announcement, seller)}`;
    
    // Bottoni per procedere o annullare
    const buttons = Markup.inlineKeyboard([
      [
        Markup.button.callback('🔋 Procedi con l\'acquisto', `start_buy_${announcementId}`),
        Markup.button.callback('❌ Annulla', 'cancel_buy')
      ]
    ]);
    
    await ctx.reply(message, {
      parse_mode: 'HTML',
      reply_markup: buttons.reply_markup
    });
    
  } catch (err) {
    logger.error(`Errore nella callback buyKwh per utente ${ctx.from.id}:`, err);
    await ctx.answerCbQuery('Si è verificato un errore. Per favore, riprova più tardi.', { show_alert: true });
  }
};

/**
 * Gestisce il click su "Procedi con l'acquisto"
 * @param {Object} ctx - Contesto Telegraf
 */
const startBuyCallback = async (ctx) => {
  try {
    logger.info(`Callback start_buy ricevuta da ${ctx.from.id}`, {
      userId: ctx.from.id,
      username: ctx.from.username,
      callbackData: ctx.callbackQuery.data
    });
    
    // Estrai l'ID dell'annuncio dalla callback data
    const announcementId = ctx.callbackQuery.data.split('_')[2];
    
    if (!announcementId) {
      await ctx.answerCbQuery('ID annuncio non valido', { show_alert: true });
      return;
    }
    
    // Memorizza l'ID dell'annuncio nella sessione dell'utente
    ctx.session.announcementId = announcementId;
    
    // Conferma la callback query
    await ctx.answerCbQuery();
    
    // Entra nella scena della procedura guidata di acquisto
    return ctx.scene.enter('BUY_KWH_WIZARD');
    
  } catch (err) {
    logger.error(`Errore nella callback startBuy per utente ${ctx.from.id}:`, err);
    await ctx.answerCbQuery('Si è verificato un errore. Per favore, riprova più tardi.', { show_alert: true });
  }
};

/**
 * Gestisce la selezione del tipo di corrente
 * @param {Object} ctx - Contesto Telegraf
 */
const connectorTypeCallback = async (ctx) => {
  try {
    logger.info(`Callback current_type ricevuta da ${ctx.from.id}`, {
      userId: ctx.from.id,
      username: ctx.from.username,
      callbackData: ctx.callbackQuery.data
    });
    
    // Estrai il tipo di corrente dalla callback data
    const currentType = ctx.callbackQuery.data.split('_')[1];
    
    // Memorizza il tipo di corrente nella sessione dell'utente
    ctx.session.currentType = currentType;
    
    // Conferma la callback query
    await ctx.answerCbQuery();
    
    // Continua con il prossimo step del wizard
    if (ctx.wizard) {
      return ctx.wizard.next();
    }
    
  } catch (err) {
    logger.error(`Errore nella callback connectorType per utente ${ctx.from.id}:`, err);
    await ctx.answerCbQuery('Si è verificato un errore. Per favore, riprova più tardi.', { show_alert: true });
  }
};

/**
 * Gestisce la conferma di pubblicazione dell'annuncio di vendita
 * @param {Object} ctx - Contesto Telegraf
 */
const publishSellCallback = async (ctx) => {
  try {
    logger.info(`Callback publish_sell ricevuta da ${ctx.from.id}`, {
      userId: ctx.from.id,
      username: ctx.from.username
    });
    
    // Conferma la callback query
    await ctx.answerCbQuery();
    
    // Continua con il prossimo step del wizard
    if (ctx.wizard) {
      return ctx.wizard.next();
    }
    
  } catch (err) {
    logger.error(`Errore nella callback publishSell per utente ${ctx.from.id}:`, err);
    await ctx.answerCbQuery('Si è verificato un errore. Per favore, riprova più tardi.', { show_alert: true });
  }
};

/**
 * Gestisce l'annullamento della creazione dell'annuncio di vendita
 * @param {Object} ctx - Contesto Telegraf
 */
const cancelSellCallback = async (ctx) => {
  try {
    logger.info(`Callback cancel_sell ricevuta da ${ctx.from.id}`, {
      userId: ctx.from.id,
      username: ctx.from.username
    });
    
    // Conferma la callback query
    await ctx.answerCbQuery('Procedura annullata');
    
    // Esce dalla scena
    await ctx.scene.leave();
    
    // Invia messaggio di conferma annullamento
    await ctx.reply(uiElements.formatErrorMessage('Procedura di creazione annuncio annullata.', false), {
      parse_mode: 'HTML',
      ...uiElements.mainMenuButton().reply_markup
    });
    
  } catch (err) {
    logger.error(`Errore nella callback cancelSell per utente ${ctx.from.id}:`, err);
    await ctx.answerCbQuery('Si è verificato un errore. Per favore, riprova più tardi.', { show_alert: true });
  }
};

/**
 * Gestisce l'accettazione delle condizioni di acquisto
 * @param {Object} ctx - Contesto Telegraf
 */
const acceptConditionsCallback = async (ctx) => {
  try {
    logger.info(`Callback accept_conditions ricevuta da ${ctx.from.id}`, {
      userId: ctx.from.id,
      username: ctx.from.username
    });
    
    // Conferma la callback query
    await ctx.answerCbQuery();
    
    // Continua con il prossimo step del wizard
    if (ctx.wizard) {
      return ctx.wizard.next();
    }
    
  } catch (err) {
    logger.error(`Errore nella callback acceptConditions per utente ${ctx.from.id}:`, err);
    await ctx.answerCbQuery('Si è verificato un errore. Per favore, riprova più tardi.', { show_alert: true });
  }
};

/**
 * Gestisce l'annullamento della procedura di acquisto
 * @param {Object} ctx - Contesto Telegraf
 */
const cancelBuyCallback = async (ctx) => {
  try {
    logger.info(`Callback cancel_buy ricevuta da ${ctx.from.id}`, {
      userId: ctx.from.id,
      username: ctx.from.username
    });
    
    // Conferma la callback query
    await ctx.answerCbQuery('Procedura annullata');
    
    // Esce dalla scena se attiva
    if (ctx.scene && ctx.scene.current) {
      await ctx.scene.leave();
    }
    
    // Invia messaggio di conferma annullamento
    await ctx.reply(uiElements.formatErrorMessage('Procedura di acquisto annullata.', false), {
      parse_mode: 'HTML',
      ...uiElements.mainMenuButton().reply_markup
    });
    
  } catch (err) {
    logger.error(`Errore nella callback cancelBuy per utente ${ctx.from.id}:`, err);
    await ctx.answerCbQuery('Si è verificato un errore. Per favore, riprova più tardi.', { show_alert: true });
  }
};

/**
 * Gestisce l'invio della richiesta di acquisto
 * @param {Object} ctx - Contesto Telegraf
 */
const sendRequestCallback = async (ctx) => {
  try {
    logger.info(`Callback send_request ricevuta da ${ctx.from.id}`, {
      userId: ctx.from.id,
      username: ctx.from.username
    });
    
    // Conferma la callback query
    await ctx.answerCbQuery();
    
    // Continua con il prossimo step del wizard
    if (ctx.wizard) {
      return ctx.wizard.next();
    }
    
  } catch (err) {
    logger.error(`Errore nella callback sendRequest per utente ${ctx.from.id}:`, err);
    await ctx.answerCbQuery('Si è verificato un errore. Per favore, riprova più tardi.', { show_alert: true });
  }
};

/**
 * Gestisce l'accettazione di un'offerta di acquisto
 * @param {Object} ctx - Contesto Telegraf
 */
const acceptOfferCallback = async (ctx) => {
  try {
    logger.info(`Callback accept_offer ricevuta da ${ctx.from.id}`, {
      userId: ctx.from.id,
      username: ctx.from.username,
      callbackData: ctx.callbackQuery.data
    });
    
    // Estrai l'ID dell'offerta dalla callback data
    const offerId = ctx.callbackQuery.data.split('_')[2];
    
    // Cerca l'offerta
    const offer = await Offer.findById(offerId);
    
    if (!offer) {
      await ctx.answerCbQuery('Offerta non trovata', { show_alert: true });
      return;
    }
    
    // Verifica che l'utente sia il venditore
    if (offer.sellerId !== ctx.from.id) {
      await ctx.answerCbQuery('Non sei autorizzato a gestire questa offerta', { show_alert: true });
      return;
    }
    
    // Verifica che l'offerta sia in stato pending
    if (offer.status !== 'pending') {
      await ctx.answerCbQuery(`L'offerta è già stata ${offer.status === 'accepted' ? 'accettata' : 'gestita'}`, { show_alert: true });
      return;
    }
    
    // Aggiorna lo stato dell'offerta
    offer.status = 'accepted';
    offer.statusChangedAt = new Date();
    await offer.save();
    
    // Conferma la callback query
    await ctx.answerCbQuery('Offerta accettata con successo!');
    
    // Invia un messaggio al venditore
    await ctx.reply(uiElements.formatSuccessMessage(
      'Offerta Accettata', 
      'Hai accettato la richiesta di ricarica. Attendi che l\'acquirente ti comunichi quando è pronto per caricare.'
    ), {
      parse_mode: 'HTML',
      ...uiElements.mainMenuButton().reply_markup
    });
    
    // Cerca l'acquirente
    const buyer = await User.findOne({ userId: offer.buyerId });
    
    if (buyer) {
      // Invia una notifica all'acquirente
      try {
        await bot.telegram.sendMessage(
          buyer.userId,
          uiElements.formatSuccessMessage(
            'Offerta Accettata',
            `Il venditore ha accettato la tua richiesta di ricarica!\n\nQuando sei pronto per caricare, usa /le_mie_ricariche e seleziona "Sono pronto per caricare".`
          ),
          {
            parse_mode: 'HTML',
            ...uiElements.mainMenuButton().reply_markup
          }
        );
      } catch (notifyErr) {
        logger.error(`Errore nella notifica all'acquirente ${buyer.userId}:`, notifyErr);
      }
    }
    
  } catch (err) {
    logger.error(`Errore nella callback acceptOffer per utente ${ctx.from.id}:`, err);
    await ctx.answerCbQuery('Si è verificato un errore. Per favore, riprova più tardi.', { show_alert: true });
  }
};

/**
 * Gestisce il rifiuto di un'offerta di acquisto
 * @param {Object} ctx - Contesto Telegraf
 */
const rejectOfferCallback = async (ctx) => {
  try {
    logger.info(`Callback reject_offer ricevuta da ${ctx.from.id}`, {
      userId: ctx.from.id,
      username: ctx.from.username,
      callbackData: ctx.callbackQuery.data
    });
    
    // Estrai l'ID dell'offerta dalla callback data
    const offerId = ctx.callbackQuery.data.split('_')[2];
    
    // Cerca l'offerta
    const offer = await Offer.findById(offerId);
    
    if (!offer) {
      await ctx.answerCbQuery('Offerta non trovata', { show_alert: true });
      return;
    }
    
    // Verifica che l'utente sia il venditore
    if (offer.sellerId !== ctx.from.id) {
      await ctx.answerCbQuery('Non sei autorizzato a gestire questa offerta', { show_alert: true });
      return;
    }
    
    // Verifica che l'offerta sia in stato pending
    if (offer.status !== 'pending') {
      await ctx.answerCbQuery(`L'offerta è già stata ${offer.status === 'rejected' ? 'rifiutata' : 'gestita'}`, { show_alert: true });
      return;
    }
    
    // Conferma la callback query
    await ctx.answerCbQuery();
    
    // Chiedi il motivo del rifiuto
    ctx.session.rejectingOfferId = offerId;
    
    await ctx.reply('Per favore, indica il motivo del rifiuto dell\'offerta:', {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Non sono disponibile', callback_data: 'reject_reason_not_available' }],
          [{ text: 'Problema con la posizione', callback_data: 'reject_reason_location' }],
          [{ text: 'Problema con l\'orario', callback_data: 'reject_reason_time' }],
          [{ text: 'Altro (specifica)', callback_data: 'reject_reason_other' }],
          [{ text: '❌ Annulla', callback_data: 'reject_cancel' }]
        ]
      }
    });
    
  } catch (err) {
    logger.error(`Errore nella callback rejectOffer per utente ${ctx.from.id}:`, err);
    await ctx.answerCbQuery('Si è verificato un errore. Per favore, riprova più tardi.', { show_alert: true });
  }
};

/**
 * Gestisce la segnalazione di "pronto per caricare"
 * @param {Object} ctx - Contesto Telegraf
 */
const readyToChargeCallback = async (ctx) => {
  try {
    logger.info(`Callback ready_to_charge ricevuta da ${ctx.from.id}`, {
      userId: ctx.from.id,
      username: ctx.from.username,
      callbackData: ctx.callbackQuery.data
    });
    
    // Estrai l'ID dell'offerta dalla callback data
    const offerId = ctx.callbackQuery.data.split('_')[3];
    
    // Cerca l'offerta
    const offer = await Offer.findById(offerId);
    
    if (!offer) {
      await ctx.answerCbQuery('Offerta non trovata', { show_alert: true });
      return;
    }
    
    // Verifica che l'utente sia l'acquirente
    if (offer.buyerId !== ctx.from.id) {
      await ctx.answerCbQuery('Non sei autorizzato a gestire questa offerta', { show_alert: true });
      return;
    }
    
    // Verifica che l'offerta sia in stato accepted
    if (offer.status !== 'accepted') {
      await ctx.answerCbQuery(`L'offerta non è nello stato corretto per questa azione`, { show_alert: true });
      return;
    }
    
    // Aggiorna lo stato dell'offerta
    offer.status = 'ready_to_charge';
    offer.statusChangedAt = new Date();
    await offer.save();
    
    // Conferma la callback query
    await ctx.answerCbQuery('Segnalazione inviata al venditore!');
    
    // Invia un messaggio all'acquirente
    await ctx.reply(uiElements.formatSuccessMessage(
      'Sei Pronto per Caricare',
      'Hai segnalato al venditore che sei pronto per caricare. Attendi che il venditore avvii la ricarica.'
    ), {
      parse_mode: 'HTML',
      ...uiElements.mainMenuButton().reply_markup
    });
    
    // Cerca il venditore
    const seller = await User.findOne({ userId: offer.sellerId });
    
    if (seller) {
      // Invia una notifica al venditore
      try {
        const buyer = await User.findOne({ userId: offer.buyerId });
        const buyerName = buyer ? (buyer.username ? '@' + buyer.username : buyer.firstName) : 'L\'acquirente';
        
        await bot.telegram.sendMessage(
          seller.userId,
          uiElements.formatSuccessMessage(
            'Acquirente Pronto',
            `${buyerName} è pronto per ricaricare!\n\nQuando avvii la ricarica, usa /le_mie_ricariche e seleziona "Ho avviato la ricarica".`
          ),
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '▶️ Ho avviato la ricarica', callback_data: `charging_started_${offerId}` }]
              ]
            }
          }
        );
      } catch (notifyErr) {
        logger.error(`Errore nella notifica al venditore ${seller.userId}:`, notifyErr);
      }
    }
    
  } catch (err) {
    logger.error(`Errore nella callback readyToCharge per utente ${ctx.from.id}:`, err);
    await ctx.answerCbQuery('Si è verificato un errore. Per favore, riprova più tardi.', { show_alert: true });
  }
};

/**
 * Gestisce la segnalazione di "ricarica avviata"
 * @param {Object} ctx - Contesto Telegraf
 */
const chargingStartedCallback = async (ctx) => {
  try {
    logger.info(`Callback charging_started ricevuta da ${ctx.from.id}`, {
      userId: ctx.from.id,
      username: ctx.from.username,
      callbackData: ctx.callbackQuery.data
    });
    
    // Estrai l'ID dell'offerta dalla callback data
    const offerId = ctx.callbackQuery.data.split('_')[2];
    
    // Cerca l'offerta
    const offer = await Offer.findById(offerId);
    
    if (!offer) {
      await ctx.answerCbQuery('Offerta non trovata', { show_alert: true });
      return;
    }
    
    // Verifica che l'utente sia il venditore
    if (offer.sellerId !== ctx.from.id) {
      await ctx.answerCbQuery('Non sei autorizzato a gestire questa offerta', { show_alert: true });
      return;
    }
    
    // Verifica che l'offerta sia in stato ready_to_charge
    if (offer.status !== 'ready_to_charge') {
      await ctx.answerCbQuery(`L'offerta non è nello stato corretto per questa azione`, { show_alert: true });
      return;
    }
    
    // Aggiorna lo stato dell'offerta
    offer.status = 'charging_started';
    offer.statusChangedAt = new Date();
    await offer.save();
    
    // Conferma la callback query
    await ctx.answerCbQuery('Segnalazione inviata all\'acquirente!');
    
    // Invia un messaggio al venditore
    await ctx.reply(uiElements.formatSuccessMessage(
      'Ricarica Avviata',
      'Hai segnalato all\'acquirente che la ricarica è stata avviata. Attendi conferma.'
    ), {
      parse_mode: 'HTML',
      ...uiElements.mainMenuButton().reply_markup
    });
    
    // Cerca l'acquirente
    const buyer = await User.findOne({ userId: offer.buyerId });
    
    if (buyer) {
      // Invia una notifica all'acquirente
      try {
        const seller = await User.findOne({ userId: offer.sellerId });
        const sellerName = seller ? (seller.username ? '@' + seller.username : seller.firstName) : 'Il venditore';
        
        await bot.telegram.sendMessage(
          buyer.userId,
          uiElements.formatSuccessMessage(
            'Ricarica Avviata',
            `${sellerName} ha avviato la ricarica. Controlla se la tua auto ha iniziato a caricare.`
          ),
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '✅ Ricarica partita', callback_data: `charging_ok_${offerId}` },
                  { text: '❌ Problemi', callback_data: `charging_issues_${offerId}` }
                ]
              ]
            }
          }
        );
      } catch (notifyErr) {
        logger.error(`Errore nella notifica all'acquirente ${buyer.userId}:`, notifyErr);
      }
    }
    
  } catch (err) {
    logger.error(`Errore nella callback chargingStarted per utente ${ctx.from.id}:`, err);
    await ctx.answerCbQuery('Si è verificato un errore. Per favore, riprova più tardi.', { show_alert: true });
  }
};

/**
 * Gestisce la conferma che la ricarica sta funzionando
 * @param {Object} ctx - Contesto Telegraf
 */
const chargingOkCallback = async (ctx) => {
  try {
    logger.info(`Callback charging_ok ricevuta da ${ctx.from.id}`, {
      userId: ctx.from.id,
      username: ctx.from.username,
      callbackData: ctx.callbackQuery.data
    });
    
    // Estrai l'ID dell'offerta dalla callback data
    const offerId = ctx.callbackQuery.data.split('_')[2];
    
    // Cerca l'offerta
    const offer = await Offer.findById(offerId);
    
    if (!offer) {
      await ctx.answerCbQuery('Offerta non trovata', { show_alert: true });
      return;
    }
    
    // Verifica che l'utente sia l'acquirente
    if (offer.buyerId !== ctx.from.id) {
      await ctx.answerCbQuery('Non sei autorizzato a gestire questa offerta', { show_alert: true });
      return;
    }
    
    // Verifica che l'offerta sia in stato charging_started
    if (offer.status !== 'charging_started') {
      await ctx.answerCbQuery(`L'offerta non è nello stato corretto per questa azione`, { show_alert: true });
      return;
    }
    
    // Aggiorna lo stato dell'offerta
    offer.status = 'charging';
    offer.statusChangedAt = new Date();
    await offer.save();
    
    // Conferma la callback query
    await ctx.answerCbQuery('Confermato! Ora puoi ricaricare.');
    
    // Invia un messaggio all'acquirente
    await ctx.reply(uiElements.formatSuccessMessage(
      'Ricarica in Corso',
      'Hai confermato che la ricarica è partita correttamente. Quando hai terminato, clicca "Ho terminato la ricarica".'
    ), {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔋 Ho terminato la ricarica', callback_data: `charging_completed_${offerId}` }]
        ]
      }
    });
    
    // Cerca il venditore
    const seller = await User.findOne({ userId: offer.sellerId });
    
    if (seller) {
      // Invia una notifica al venditore
      try {
        const buyer = await User.findOne({ userId: offer.buyerId });
        const buyerName = buyer ? (buyer.username ? '@' + buyer.username : buyer.firstName) : 'L\'acquirente';
        
        await bot.telegram.sendMessage(
          seller.userId,
          uiElements.formatSuccessMessage(
            'Ricarica Confermata',
            `${buyerName} ha confermato che la ricarica è partita correttamente. Attendi il termine della ricarica.`
          ),
          {
            parse_mode: 'HTML',
            ...uiElements.mainMenuButton().reply_markup
          }
        );
      } catch (notifyErr) {
        logger.error(`Errore nella notifica al venditore ${seller.userId}:`, notifyErr);
      }
    }
    
  } catch (err) {
    logger.error(`Errore nella callback chargingOk per utente ${ctx.from.id}:`, err);
    await ctx.answerCbQuery('Si è verificato un errore. Per favore, riprova più tardi.', { show_alert: true });
  }
};

/**
 * Gestisce la segnalazione di problemi con la ricarica
 * @param {Object} ctx - Contesto Telegraf
 */
const chargingIssuesCallback = async (ctx) => {
  try {
    logger.info(`Callback charging_issues ricevuta da ${ctx.from.id}`, {
      userId: ctx.from.id,
      username: ctx.from.username,
      callbackData: ctx.callbackQuery.data
    });
    
    // Estrai l'ID dell'offerta dalla callback data
    const offerId = ctx.callbackQuery.data.split('_')[2];
    
    // Conferma la callback query
    await ctx.answerCbQuery();
    
    // Memorizza l'ID dell'offerta nella sessione
    ctx.session.issuesOfferId = offerId;
    
    // Chiedi all'utente di descrivere il problema
    await ctx.reply(uiElements.formatErrorMessage(
      'Per favore, descrivi brevemente il problema che stai riscontrando con la ricarica.\n\nQuesto messaggio verrà inviato al venditore per risolvere il problema.',
      false
    ), {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '❌ Annulla', callback_data: `cancel_issue_${offerId}` }]
        ]
      }
    });
    
    // Imposta lo stato per gestire la risposta
    ctx.session.awaitingIssueDescription = true;
    
  } catch (err) {
    logger.error(`Errore nella callback chargingIssues per utente ${ctx.from.id}:`, err);
    await ctx.answerCbQuery('Si è verificato un errore. Per favore, riprova più tardi.', { show_alert: true });
  }
};

/**
 * Gestisce la segnalazione di ricarica completata
 * @param {Object} ctx - Contesto Telegraf
 */
const chargingCompletedCallback = async (ctx) => {
  try {
    logger.info(`Callback charging_completed ricevuta da ${ctx.from.id}`, {
      userId: ctx.from.id,
      username: ctx.from.username,
      callbackData: ctx.callbackQuery.data
    });
    
    // Estrai l'ID dell'offerta dalla callback data
    const offerId = ctx.callbackQuery.data.split('_')[2];
    
    // Conferma la callback query
    await ctx.answerCbQuery();
    
    // Memorizza l'ID dell'offerta nella sessione
    ctx.session.completedOfferId = offerId;
    
    // Chiedi quanti kWh sono stati caricati
    await ctx.reply(uiElements.formatProgressMessage(4, 5, "Ricarica Completata") + 
      'Per favore, inserisci quanti kWh hai caricato (es. 15.5):', {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '❌ Annulla', callback_data: `cancel_completed_${offerId}` }]
        ]
      }
    });
    
    // Imposta lo stato per gestire la risposta
    ctx.session.awaitingKwhAmount = true;
    
  } catch (err) {
    logger.error(`Errore nella callback chargingCompleted per utente ${ctx.from.id}:`, err);
    await ctx.answerCbQuery('Si è verificato un errore. Per favore, riprova più tardi.', { show_alert: true });
  }
};

/**
 * Gestisce la conferma dei kWh caricati
 * @param {Object} ctx - Contesto Telegraf
 */
const confirmKwhCallback = async (ctx) => {
  try {
    logger.info(`Callback confirm_kwh ricevuta da ${ctx.from.id}`, {
      userId: ctx.from.id,
      username: ctx.from.username,
      callbackData: ctx.callbackQuery.data
    });
    
    // Estrai l'ID dell'offerta dalla callback data
    const offerId = ctx.callbackQuery.data.split('_')[2];
    
    // Cerca l'offerta
    const offer = await Offer.findById(offerId);
    
    if (!offer) {
      await ctx.answerCbQuery('Offerta non trovata', { show_alert: true });
      return;
    }
    
    // Verifica che l'utente sia il venditore
    if (offer.sellerId !== ctx.from.id) {
      await ctx.answerCbQuery('Non sei autorizzato a gestire questa offerta', { show_alert: true });
      return;
    }
    
    // Aggiorna lo stato dell'offerta
    offer.status = 'kwh_confirmed';
    offer.statusChangedAt = new Date();
    await offer.save();
    
    // Conferma la callback query
    await ctx.answerCbQuery('kWh confermati con successo!');
    
    // Invia un messaggio al venditore
    await ctx.reply(uiElements.formatSuccessMessage(
      'kWh Confermati',
      `Hai confermato che sono stati caricati ${offer.kwhAmount.toFixed(2)} kWh.\n\nOra inserisci l'importo totale da pagare per questa ricarica.`
    ), {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '💶 Inserisci importo', callback_data: `set_payment_${offerId}` }]
        ]
      }
    });
    
    // Cerca l'acquirente
    const buyer = await User.findOne({ userId: offer.buyerId });
    
    if (buyer) {
      // Invia una notifica all'acquirente
      try {
        const seller = await User.findOne({ userId: offer.sellerId });
        const sellerName = seller ? (seller.username ? '@' + seller.username : seller.firstName) : 'Il venditore';
        
        await bot.telegram.sendMessage(
          buyer.userId,
          uiElements.formatSuccessMessage(
            'kWh Confermati',
            `${sellerName} ha confermato che hai caricato ${offer.kwhAmount.toFixed(2)} kWh. Attendi che ti comunichi l'importo da pagare.`
          ),
          {
            parse_mode: 'HTML',
            ...uiElements.mainMenuButton().reply_markup
          }
        );
      } catch (notifyErr) {
        logger.error(`Errore nella notifica all'acquirente ${buyer.userId}:`, notifyErr);
      }
    }
    
  } catch (err) {
    logger.error(`Errore nella callback confirmKwh per utente ${ctx.from.id}:`, err);
    await ctx.answerCbQuery('Si è verificato un errore. Per favore, riprova più tardi.', { show_alert: true });
  }
};

/**
 * Gestisce la contestazione dei kWh caricati
 * @param {Object} ctx - Contesto Telegraf
 */
const disputeKwhCallback = async (ctx) => {
  try {
    logger.info(`Callback dispute_kwh ricevuta da ${ctx.from.id}`, {
      userId: ctx.from.id,
      username: ctx.from.username,
      callbackData: ctx.callbackQuery.data
    });
    
    // Estrai l'ID dell'offerta dalla callback data
    const offerId = ctx.callbackQuery.data.split('_')[2];
    
    // Conferma la callback query
    await ctx.answerCbQuery();
    
    // Memorizza l'ID dell'offerta nella sessione
    ctx.session.disputeOfferId = offerId;
    
    // Chiedi all'utente di inserire il corretto numero di kWh
    await ctx.reply(uiElements.formatErrorMessage(
      'Per favore, inserisci il numero corretto di kWh caricati secondo te:',
      false
    ), {
      parse_mode: 'HTML'
    });
    
    // Imposta lo stato per gestire la risposta
    ctx.session.awaitingDisputeKwh = true;
    
  } catch (err) {
    logger.error(`Errore nella callback disputeKwh per utente ${ctx.from.id}:`, err);
    await ctx.answerCbQuery('Si è verificato un errore. Per favore, riprova più tardi.', { show_alert: true });
  }
};

/**
 * Gestisce l'impostazione del pagamento
 * @param {Object} ctx - Contesto Telegraf
 */
const setPaymentCallback = async (ctx) => {
  try {
    logger.info(`Callback set_payment ricevuta da ${ctx.from.id}`, {
      userId: ctx.from.id,
      username: ctx.from.username,
      callbackData: ctx.callbackQuery.data
    });
    
    // Estrai l'ID dell'offerta dalla callback data
    const offerId = ctx.callbackQuery.data.split('_')[2];
    
    // Cerca l'offerta
    const offer = await Offer.findById(offerId);
    
    if (!offer) {
      await ctx.answerCbQuery('Offerta non trovata', { show_alert: true });
      return;
    }
    
    // Verifica che l'utente sia il venditore
    if (offer.sellerId !== ctx.from.id) {
      await ctx.answerCbQuery('Non sei autorizzato a gestire questa offerta', { show_alert: true });
      return;
    }
    
    // Verifica lo stato dell'offerta
    if (offer.status !== 'kwh_confirmed') {
      await ctx.answerCbQuery('L\'offerta non è nello stato corretto per questa azione', { show_alert: true });
      return;
    }
    
    // Conferma la callback query
    await ctx.answerCbQuery();
    
    // Memorizza l'ID dell'offerta nella sessione
    ctx.session.paymentOfferId = offerId;
    
    // Calcola l'importo suggerito
    const suggestedAmount = offer.kwhAmount * offer.pricePerKwh;
    
    // Chiedi al venditore di inserire l'importo totale
    await ctx.reply(uiElements.formatConfirmationMessage(
      'Impostazione Importo Pagamento',
      [
        { label: 'kWh caricati', value: offer.kwhAmount.toFixed(2) },
        { label: 'Prezzo per kWh', value: offer.pricePerKwh.toFixed(2) + '€' },
        { label: 'Importo calcolato', value: suggestedAmount.toFixed(2) + '€' }
      ]
    ) + '\n\nInserisci l\'importo totale da pagare in €:', {
      parse_mode: 'HTML'
    });
    
    // Imposta lo stato per gestire la risposta
    ctx.session.awaitingPaymentAmount = true;
    
  } catch (err) {
    logger.error(`Errore nella callback setPayment per utente ${ctx.from.id}:`, err);
    await ctx.answerCbQuery('Si è verificato un errore. Per favore, riprova più tardi.', { show_alert: true });
  }
};

/**
 * Gestisce la verifica del pagamento
 * @param {Object} ctx - Contesto Telegraf
 */
const verifyPaymentCallback = async (ctx) => {
  try {
    logger.info(`Callback verify_payment ricevuta da ${ctx.from.id}`, {
      userId: ctx.from.id,
      username: ctx.from.username,
      callbackData: ctx.callbackQuery.data
    });
    
    // Estrai l'ID dell'offerta dalla callback data
    const offerId = ctx.callbackQuery.data.split('_')[2];
    
    // Cerca l'offerta
    const offer = await Offer.findById(offerId);
    
    if (!offer) {
      await ctx.answerCbQuery('Offerta non trovata', { show_alert: true });
      return;
    }
    
    // Verifica che l'utente sia il venditore
    if (offer.sellerId !== ctx.from.id) {
      await ctx.answerCbQuery('Non sei autorizzato a gestire questa offerta', { show_alert: true });
      return;
    }
    
    // Verifica lo stato dell'offerta
    if (offer.status !== 'payment_pending' && offer.status !== 'payment_sent') {
      await ctx.answerCbQuery('L\'offerta non è nello stato corretto per questa azione', { show_alert: true });
      return;
    }
    
    // Conferma la callback query
    await ctx.answerCbQuery();
    
    // Verifica se il pagamento è già stato inviato
    if (offer.status === 'payment_sent') {
      // Chiedi al venditore di confermare il pagamento
      await ctx.reply(uiElements.formatConfirmationMessage(
        'Verifica Pagamento',
        [
          { label: 'Importo', value: offer.totalAmount.toFixed(2) + '€' },
          { label: 'Stato pagamento', value: 'Segnalato come inviato dall\'acquirente' }
        ]
      ), {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Confermo pagamento ricevuto', callback_data: `payment_confirmed_${offerId}` },
              { text: '❌ Non ho ricevuto', callback_data: `payment_not_received_${offerId}` }
            ]
          ]
        }
      });
    } else {
      // Mostra i dettagli di pagamento al venditore
      await ctx.reply(uiElements.formatConfirmationMessage(
        'Dettagli Pagamento',
        [
          { label: 'Importo', value: offer.totalAmount.toFixed(2) + '€' },
          { label: 'Stato pagamento', value: 'In attesa' },
          { label: 'Metodo di pagamento', value: offer.paymentMethod || 'Non specificato' },
          { label: 'Dettagli', value: offer.paymentDetails || 'Nessun dettaglio specificato' }
        ]
      ) + '\n\nAttendi che l\'acquirente effettui il pagamento o contattalo direttamente.', {
        parse_mode: 'HTML',
        ...uiElements.mainMenuButton().reply_markup
      });
    }
    
  } catch (err) {
    logger.error(`Errore nella callback verifyPayment per utente ${ctx.from.id}:`, err);
    await ctx.answerCbQuery('Si è verificato un errore. Per favore, riprova più tardi.', { show_alert: true });
  }
};

/**
 * Gestisce la conferma di richiesta di pagamento
 * @param {Object} ctx - Contesto Telegraf
 */
const confirmPaymentRequestCallback = async (ctx) => {
  try {
    logger.info(`Callback confirm_payment_request ricevuta da ${ctx.from.id}`, {
      userId: ctx.from.id,
      username: ctx.from.username,
      callbackData: ctx.callbackQuery.data
    });
    
    // Estrai l'ID dell'offerta e l'importo dalla callback data
    const parts = ctx.callbackQuery.data.split('_');
    const offerId = parts[2];
    const amount = parseFloat(parts[3]);
    
    // Cerca l'offerta
    const offer = await Offer.findById(offerId);
    
    if (!offer) {
      await ctx.answerCbQuery('Offerta non trovata', { show_alert: true });
      return;
    }
    
    // Verifica che l'utente sia il venditore
    if (offer.sellerId !== ctx.from.id) {
      await ctx.answerCbQuery('Non sei autorizzato a gestire questa offerta', { show_alert: true });
      return;
    }
    
    // Aggiorna l'offerta con l'importo e lo stato
    offer.totalAmount = amount;
    offer.status = 'payment_pending';
    offer.statusChangedAt = new Date();
    await offer.save();
    
    // Conferma la callback query
    await ctx.answerCbQuery('Richiesta di pagamento inviata!');
    
    // Ora chiedi al venditore di specificare i dettagli di pagamento
    ctx.session.paymentDetailsOfferId = offerId;
    
    await ctx.reply('Ora specifica il metodo di pagamento preferito (es. Bonifico, PayPal, Satispay, etc.):', {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Bonifico bancario', callback_data: 'payment_method_bank' }],
          [{ text: 'PayPal', callback_data: 'payment_method_paypal' }],
          [{ text: 'Satispay', callback_data: 'payment_method_satispay' }],
          [{ text: 'Contanti', callback_data: 'payment_method_cash' }],
          [{ text: 'Altro (specifica)', callback_data: 'payment_method_other' }]
        ]
      }
    });
    
  } catch (err) {
    logger.error(`Errore nella callback confirmPaymentRequest per utente ${ctx.from.id}:`, err);
    await ctx.answerCbQuery('Si è verificato un errore. Per favore, riprova più tardi.', { show_alert: true });
  }
};

/**
 * Gestisce l'annullamento della richiesta di pagamento
 * @param {Object} ctx - Contesto Telegraf
 */
const cancelPaymentRequestCallback = async (ctx) => {
  try {
    logger.info(`Callback cancel_payment_request ricevuta da ${ctx.from.id}`, {
      userId: ctx.from.id,
      username: ctx.from.username,
      callbackData: ctx.callbackQuery.data
    });
    
    // Estrai l'ID dell'offerta dalla callback data
    const offerId = ctx.callbackQuery.data.split('_')[2];
    
    // Conferma la callback query
    await ctx.answerCbQuery('Richiesta di pagamento annullata');
    
    // Chiedi nuovamente l'importo
    ctx.session.paymentOfferId = offerId;
    
    await ctx.reply('Per favore, inserisci un nuovo importo totale da pagare in €:', {
      parse_mode: 'HTML'
    });
    
    // Imposta lo stato per gestire la risposta
    ctx.session.awaitingPaymentAmount = true;
    
  } catch (err) {
    logger.error(`Errore nella callback cancelPaymentRequest per utente ${ctx.from.id}:`, err);
    await ctx.answerCbQuery('Si è verificato un errore. Per favore, riprova più tardi.', { show_alert: true });
  }
};

/**
 * Gestisce la segnalazione di pagamento inviato
 * @param {Object} ctx - Contesto Telegraf
 */
const paymentSentCallback = async (ctx) => {
  try {
    logger.info(`Callback payment_sent ricevuta da ${ctx.from.id}`, {
      userId: ctx.from.id,
      username: ctx.from.username,
      callbackData: ctx.callbackQuery.data
    });
    
    // Estrai l'ID dell'offerta dalla callback data
    const offerId = ctx.callbackQuery.data.split('_')[2];
    
    // Cerca l'offerta
    const offer = await Offer.findById(offerId);
    
    if (!offer) {
      await ctx.answerCbQuery('Offerta non trovata', { show_alert: true });
      return;
    }
    
    // Verifica che l'utente sia l'acquirente
    if (offer.buyerId !== ctx.from.id) {
      await ctx.answerCbQuery('Non sei autorizzato a gestire questa offerta', { show_alert: true });
      return;
    }
    
    // Verifica lo stato dell'offerta
    if (offer.status !== 'payment_pending') {
      await ctx.answerCbQuery('L\'offerta non è nello stato corretto per questa azione', { show_alert: true });
      return;
    }
    
    // Aggiorna lo stato dell'offerta
    offer.status = 'payment_sent';
    offer.statusChangedAt = new Date();
    await offer.save();
    
    // Conferma la callback query
    await ctx.answerCbQuery('Segnalazione di pagamento inviata!');
    
    // Invia un messaggio all'acquirente
    await ctx.reply(uiElements.formatSuccessMessage(
      'Pagamento Segnalato',
      `Hai segnalato di aver effettuato il pagamento di ${offer.totalAmount.toFixed(2)}€. Attendi la conferma del venditore.`
    ), {
      parse_mode: 'HTML',
      ...uiElements.mainMenuButton().reply_markup
    });
    
    // Cerca il venditore
    const seller = await User.findOne({ userId: offer.sellerId });
    
    if (seller) {
      // Invia una notifica al venditore
      try {
        const buyer = await User.findOne({ userId: offer.buyerId });
        const buyerName = buyer ? (buyer.username ? '@' + buyer.username : buyer.firstName) : 'L\'acquirente';
        
        await bot.telegram.sendMessage(
          seller.userId,
          uiElements.formatSuccessMessage(
            'Pagamento Segnalato',
            `${buyerName} ha segnalato di aver effettuato il pagamento di ${offer.totalAmount.toFixed(2)}€. Verifica di averlo ricevuto.`
          ),
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '✅ Confermo pagamento ricevuto', callback_data: `payment_confirmed_${offerId}` },
                  { text: '❌ Non ho ricevuto', callback_data: `payment_not_received_${offerId}` }
                ]
              ]
            }
          }
        );
      } catch (notifyErr) {
        logger.error(`Errore nella notifica al venditore ${seller.userId}:`, notifyErr);
      }
    }
    
  } catch (err) {
    logger.error(`Errore nella callback paymentSent per utente ${ctx.from.id}:`, err);
    await ctx.answerCbQuery('Si è verificato un errore. Per favore, riprova più tardi.', { show_alert: true });
  }
};

/**
 * Gestisce la conferma di pagamento ricevuto
 * @param {Object} ctx - Contesto Telegraf
 */
const paymentConfirmedCallback = async (ctx) => {
  try {
    logger.info(`Callback payment_confirmed ricevuta da ${ctx.from.id}`, {
      userId: ctx.from.id,
      username: ctx.from.username,
      callbackData: ctx.callbackQuery.data
    });
    
    // Estrai l'ID dell'offerta dalla callback data
    const offerId = ctx.callbackQuery.data.split('_')[2];
    
    // Cerca l'offerta
    const offer = await Offer.findById(offerId);
    
    if (!offer) {
      await ctx.answerCbQuery('Offerta non trovata', { show_alert: true });
      return;
    }
    
    // Verifica che l'utente sia il venditore
    if (offer.sellerId !== ctx.from.id) {
      await ctx.answerCbQuery('Non sei autorizzato a gestire questa offerta', { show_alert: true });
      return;
    }
    
    // Verifica lo stato dell'offerta
    if (offer.status !== 'payment_sent') {
      await ctx.answerCbQuery('L\'offerta non è nello stato corretto per questa azione', { show_alert: true });
      return;
    }
    
    // Aggiorna lo stato dell'offerta
    offer.status = 'completed';
    offer.statusChangedAt = new Date();
    offer.completedAt = new Date();
    await offer.save();
    
    // Crea una transazione
    const transaction = await transactionService.createTransaction(
      offer.buyerId,
      offer.sellerId,
      offer.kwhAmount,
      offer.pricePerKwh,
      offer.totalAmount,
      offer._id
    );
    
    // Conferma la callback query
    await ctx.answerCbQuery('Pagamento confermato! Procedura completata.');
    
    // Invia un messaggio al venditore
    await ctx.reply(uiElements.formatSuccessMessage(
      'Pagamento Confermato',
      `Hai confermato di aver ricevuto il pagamento di ${offer.totalAmount.toFixed(2)}€. La ricarica è stata completata con successo!`
    ), {
      parse_mode: 'HTML',
      ...uiElements.mainMenuButton().reply_markup
    });
    
    // Cerca l'acquirente
    const buyer = await User.findOne({ userId: offer.buyerId });
    
    if (buyer) {
      // Invia una notifica all'acquirente
      try {
        const seller = await User.findOne({ userId: offer.sellerId });
        const sellerName = seller ? (seller.username ? '@' + seller.username : seller.firstName) : 'Il venditore';
        
        await bot.telegram.sendMessage(
          buyer.userId,
          uiElements.formatSuccessMessage(
            'Pagamento Confermato',
            `${sellerName} ha confermato di aver ricevuto il tuo pagamento di ${offer.totalAmount.toFixed(2)}€. La ricarica è stata completata con successo!`
          ),
          {
            parse_mode: 'HTML',
            ...uiElements.mainMenuButton().reply_markup
          }
        );
      } catch (notifyErr) {
        logger.error(`Errore nella notifica all'acquirente ${buyer.userId}:`, notifyErr);
      }
    }
    
    // Verifica se è una ricarica con l'admin e crea una donazione se necessario
    if (offer.sellerId !== ADMIN_USER_ID && offer.buyerId === ADMIN_USER_ID) {
      try {
        // L'admin è l'acquirente e il privato è il venditore, creiamo una donazione
        await donationService.createDonation(offer.sellerId, ADMIN_USER_ID, offer.kwhAmount, offer._id);
        
        // Notifica al venditore della donazione
        const sellerUser = await User.findOne({ userId: offer.sellerId });
        
        if (sellerUser) {
          await bot.telegram.sendMessage(
            sellerUser.userId,
            uiElements.formatSuccessMessage(
              'Donazione Effettuata',
              `Hai donato ${offer.kwhAmount.toFixed(2)} kWh all'amministratore. Questo credito sarà disponibile per le prossime ricariche che l'amministratore effettuerà presso di te.`
            ),
            {
              parse_mode: 'HTML',
              ...uiElements.mainMenuButton().reply_markup
            }
          );
        }
      } catch (donationErr) {
        logger.error(`Errore nella creazione della donazione per la ricarica ${offerId}:`, donationErr);
      }
    }
    
    // Chiedi feedback
    setTimeout(async () => {
      try {
        // Chiedi feedback all'acquirente
        await bot.telegram.sendMessage(
          offer.buyerId,
          'Come valuti questa ricarica? Il tuo feedback aiuta altri utenti a scegliere i venditori migliori.',
          {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '👍 Positivo', callback_data: `feedback_positive_${offerId}` },
                  { text: '👎 Negativo', callback_data: `feedback_negative_${offerId}` }
                ]
              ]
            }
          }
        );
        
        // Chiedi feedback al venditore
        await bot.telegram.sendMessage(
          offer.sellerId,
          'Come valuti questo acquirente? Il tuo feedback aiuta altri venditori a decidere se accettare future richieste.',
          {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '👍 Positivo', callback_data: `feedback_positive_${offerId}` },
                  { text: '👎 Negativo', callback_data: `feedback_negative_${offerId}` }
                ]
              ]
            }
          }
        );
      } catch (feedbackErr) {
        logger.error(`Errore nell'invio della richiesta di feedback per l'offerta ${offerId}:`, feedbackErr);
      }
    }, 30000); // Chiedi feedback dopo 30 secondi
    
    // Chiedi al venditore se vuole donare kWh all'admin (tranne se l'admin è l'acquirente)
    if (offer.buyerId !== ADMIN_USER_ID && ADMIN_USER_ID) {
      setTimeout(async () => {
        try {
          await bot.telegram.sendMessage(
            offer.sellerId,
            `🎁 <b>Vuoi donare un po' di kWh all'amministratore?</b>\n\nLe donazioni permettono all'amministratore di mantenere attivo e migliorare questo servizio. Quando l'amministratore vorrà ricaricare presso di te, il credito donato verrà utilizzato automaticamente.`,
            {
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: '🎁 Dona 2 kWh', callback_data: `donate_2_${offerId}` },
                    { text: '🎁 Altra quantità', callback_data: `donate_custom_${offerId}` }
                  ],
                  [{ text: '👍 No, grazie', callback_data: `donate_skip_${offerId}` }]
                ]
              }
            }
          );
        } catch (donationPromptErr) {
          logger.error(`Errore nell'invio della richiesta di donazione per l'offerta ${offerId}:`, donationPromptErr);
        }
      }, 60000); // Chiedi donazione dopo 1 minuto
    }
    
  } catch (err) {
    logger.error(`Errore nella callback paymentConfirmed per utente ${ctx.from.id}:`, err);
    await ctx.answerCbQuery('Si è verificato un errore. Per favore, riprova più tardi.', { show_alert: true });
  }
};

/**
 * Gestisce la segnalazione di pagamento non ricevuto
 * @param {Object} ctx - Contesto Telegraf
 */
const paymentNotReceivedCallback = async (ctx) => {
  try {
    logger.info(`Callback payment_not_received ricevuta da ${ctx.from.id}`, {
      userId: ctx.from.id,
      username: ctx.from.username,
      callbackData: ctx.callbackQuery.data
    });
    
    // Estrai l'ID dell'offerta dalla callback data
    const offerId = ctx.callbackQuery.data.split('_')[3];
    
    // Conferma la callback query
    await ctx.answerCbQuery();
