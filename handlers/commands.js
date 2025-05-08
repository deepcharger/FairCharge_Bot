// Gestori dei comandi principali del bot
const { Markup } = require('telegraf');
const userService = require('../services/userService');
const offerService = require('../services/offerService');
const announcementService = require('../services/announcementService');
const { formatUserProfile, formatOfferListItem, formatWelcomeMessage } = require('../utils/formatters');
const User = require('../models/user');
const Offer = require('../models/offer');
const Announcement = require('../models/announcement');
const Transaction = require('../models/transaction');
const moment = require('moment');
const logger = require('../utils/logger');
const { isAdmin, ADMIN_USER_ID } = require('../config/admin');
const { bot } = require('../config/bot');

/**
 * Gestisce il comando /start
 * @param {Object} ctx - Contesto Telegraf
 */
const startCommand = async (ctx) => {
  try {
    logger.info(`Comando /start ricevuto da ${ctx.from.id}`, {
      userId: ctx.from.id,
      username: ctx.from.username
    });
    
    await userService.registerUser(ctx.from);
    
    // Utilizzo formatWelcomeMessage dall'utility formatters
    const welcomeMessage = formatWelcomeMessage();
    
    await ctx.reply(welcomeMessage, {
      parse_mode: 'HTML'
    });
    
    logger.debug(`Messaggio di benvenuto inviato a ${ctx.from.id}`);
  } catch (err) {
    logger.error(`Errore nel comando start per utente ${ctx.from.id}:`, err);
    await ctx.reply('Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

/**
 * Gestisce il comando /vendi_kwh
 * @param {Object} ctx - Contesto Telegraf
 */
const sellKwhCommand = (ctx) => {
  logger.info(`Comando /vendi_kwh ricevuto da ${ctx.from.id}`, {
    userId: ctx.from.id,
    username: ctx.from.username
  });
  
  return ctx.scene.enter('SELL_ANNOUNCEMENT_WIZARD');
};

/**
 * Gestisce il comando /le_mie_ricariche
 * @param {Object} ctx - Contesto Telegraf
 */
const myChargesCommand = async (ctx) => {
  try {
    logger.info(`Comando /le_mie_ricariche ricevuto da ${ctx.from.id}`, {
      userId: ctx.from.id,
      username: ctx.from.username
    });
    
    const user = await userService.registerUser(ctx.from);
    
    // Recupera le offerte organizzate per stato
    const offers = await offerService.getActiveOffers(user.userId);
    
    if (Object.values(offers).flat().length === 0) {
      logger.debug(`Nessuna ricarica attiva per utente ${ctx.from.id}`);
      await ctx.reply('Non hai ricariche attive al momento.');
      return;
    }
    
    // Funzione per generare pulsanti inline per un'offerta
    const generateButtons = async (offer, index) => {
      const offerId = offer._id;
      const isbuyer = user.userId === offer.buyerId;
      let buttons = [];
      
      // Bottoni per le offerte accettate (acquirente)
      if (offer.status === 'accepted' && isbuyer) {
        buttons = [
          [
            Markup.button.callback('🔋 Sono pronto per caricare', `ready_to_charge_${offerId}`),
            Markup.button.callback('❌ Annulla', `cancel_charge_${offerId}`)
          ]
        ];
      }
      
      // Bottoni per le offerte pronte (venditore)
      else if (offer.status === 'ready_to_charge' && !isbuyer) {
        buttons = [
          [Markup.button.callback('▶️ Ho avviato la ricarica', `charging_started_${offerId}`)]
        ];
      }
      
      // Bottoni per la ricarica iniziata (acquirente)
      else if (offer.status === 'charging_started' && isbuyer) {
        buttons = [
          [
            Markup.button.callback('✅ Ricarica partita', `charging_ok_${offerId}`),
            Markup.button.callback('❌ Problemi', `charging_issues_${offerId}`)
          ]
        ];
      }
      
      // Bottoni per la ricarica in corso (acquirente)
      else if (offer.status === 'charging' && isbuyer) {
        buttons = [
          [Markup.button.callback('🔋 Ho terminato la ricarica', `charging_completed_${offerId}`)]
        ];
      }
      
      // Bottoni per i kWh confermati (venditore)
      else if (offer.status === 'kwh_confirmed' && !isbuyer) {
        buttons = [
          [Markup.button.callback('💶 Inserisci importo da pagare', `set_payment_${offerId}`)]
        ];
      }
      
      // Bottoni per il pagamento in attesa (acquirente)
      else if (offer.status === 'payment_pending' && isbuyer) {
        buttons = [
          [Markup.button.callback('💸 Ho effettuato il pagamento', `payment_sent_${offerId}`)]
        ];
      }
      
      // Bottoni per il pagamento inviato (venditore)
      else if (offer.status === 'payment_sent' && !isbuyer) {
        buttons = [
          [
            Markup.button.callback('✅ Confermo pagamento ricevuto', `payment_confirmed_${offerId}`),
            Markup.button.callback('❌ Non ho ricevuto', `payment_not_received_${offerId}`)
          ]
        ];
      }
      
      // Bottoni per il feedback (offerte completate)
      else if (offer.status === 'completed') {
        const hasGivenFeedback = isbuyer ? offer.buyerFeedback && offer.buyerFeedback.rating !== undefined : 
          offer.sellerFeedback && offer.sellerFeedback.rating !== undefined;
        
        if (!hasGivenFeedback) {
          buttons = [
            [
              Markup.button.callback('👍 Positivo', `feedback_positive_${offerId}`),
              Markup.button.callback('👎 Negativo', `feedback_negative_${offerId}`)
            ]
          ];
        }
      }
      
      return buttons.length > 0 ? buttons : null;
    };
    
    // Funzione per inviare il messaggio di una categoria
    const sendCategoryMessage = async (title, offersList, icon) => {
      if (offersList.length === 0) return;
      
      logger.debug(`Invio lista di ${offersList.length} ricariche con stato "${title}" a ${ctx.from.id}`);
      
      let text = `<b>${icon} ${title}:</b>\n`;
      
      for (let i = 0; i < offersList.length; i++) {
        const offer = offersList[i];
        const otherUserId = user.userId === offer.buyerId ? offer.sellerId : offer.buyerId;
        const otherUser = await User.findOne({ userId: otherUserId });
        const role = user.userId === offer.buyerId ? 'Acquirente' : 'Venditore';
        
        text += await formatOfferListItem(offer, i, otherUser, role) + '\n';
        
        // Invia i bottoni per questa offerta
        const buttons = await generateButtons(offer, i);
        if (buttons) {
          await ctx.reply(`Opzioni per ricarica #${i + 1}:`, {
            reply_markup: Markup.inlineKeyboard(buttons)
          });
        }
      }
      
      await ctx.reply(text, { parse_mode: 'HTML' });
    };
    
    // Invia i messaggi per ogni categoria
    if (offers.pending.length > 0) {
      await sendCategoryMessage('In attesa di conferma', offers.pending, '🕒');
    }
    
    if (offers.accepted.length > 0) {
      await sendCategoryMessage('Accettate', offers.accepted, '✅');
    }
    
    if (offers.readyToCharge.length > 0) {
      await sendCategoryMessage('Pronte per la ricarica', offers.readyToCharge, '🔌');
    }
    
    if (offers.charging.length > 0) {
      await sendCategoryMessage('In carica', offers.charging, '⚡');
    }
    
    if (offers.payment.length > 0) {
      await sendCategoryMessage('Da pagare/confermare', offers.payment, '💰');
    }
    
    if (offers.completed.length > 0) {
      await sendCategoryMessage('Completate', offers.completed, '✅');
    }
    
    if (offers.disputed.length > 0) {
      await sendCategoryMessage('Contestate', offers.disputed, '⚠️');
    }
    
    if (offers.cancelled.length > 0) {
      await sendCategoryMessage('Annullate', offers.cancelled, '❌');
    }
    
    logger.info(`Liste ricariche inviate a ${ctx.from.id}`);
  } catch (err) {
    logger.error(`Errore nel recupero delle ricariche per utente ${ctx.from.id}:`, err);
    await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

/**
 * Gestisce il comando /profilo
 * @param {Object} ctx - Contesto Telegraf
 */
const profileCommand = async (ctx) => {
  try {
    logger.info(`Comando /profilo ricevuto da ${ctx.from.id}`, {
      userId: ctx.from.id,
      username: ctx.from.username
    });
    
    // Ottieni il profilo dell'utente
    const userProfile = await userService.getUserProfile(ctx.from.id);
    
    // Formatta il profilo e invialo
    const profileText = formatUserProfile(
      userProfile.user, 
      userProfile.transactions, 
      userProfile.sellAnnouncement, 
      userProfile.buyAnnouncement
    );
    
    await ctx.reply(profileText, { parse_mode: 'HTML' });
    logger.debug(`Profilo inviato a ${ctx.from.id}`);
  } catch (err) {
    logger.error(`Errore nel recupero del profilo per utente ${ctx.from.id}:`, err);
    await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

/**
 * Gestisce il comando /help
 * @param {Object} ctx - Contesto Telegraf
 */
const helpCommand = async (ctx) => {
  try {
    logger.info(`Comando /help ricevuto da ${ctx.from.id}`, {
      userId: ctx.from.id,
      username: ctx.from.username
    });
    
    // Usa lo stesso formato del messaggio di benvenuto
    const helpMessage = formatWelcomeMessage();
    
    await ctx.reply(helpMessage, { parse_mode: 'HTML' });
    logger.debug(`Messaggio di aiuto inviato a ${ctx.from.id}`);
  } catch (err) {
    logger.error(`Errore nell'invio del messaggio di aiuto per utente ${ctx.from.id}:`, err);
    await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

/**
 * Gestisce il comando /avvio_ricarica
 * @param {Object} ctx - Contesto Telegraf
 */
const startChargeCommand = async (ctx) => {
  try {
    logger.info(`Comando /avvio_ricarica ricevuto da ${ctx.from.id}`, {
      userId: ctx.from.id,
      username: ctx.from.username,
      messageText: ctx.message.text
    });
    
    const user = await userService.registerUser(ctx.from);
    
    // Verifica che l'utente sia l'admin usando la funzione isAdmin
    if (!isAdmin(user.userId)) {
      logger.warn(`Tentativo non autorizzato di usare /avvio_ricarica da parte di ${ctx.from.id}`);
      await ctx.reply('❌ Solo l\'amministratore può usare questo comando.');
      return;
    }
    
    // Estrai il parametro username
    const text = ctx.message.text.split(' ');
    if (text.length < 2) {
      logger.warn(`Comando /avvio_ricarica usato con formato errato da ${ctx.from.id}`);
      await ctx.reply('⚠️ Formato corretto: /avvio\\_ricarica username o ID');
      return;
    }
    
    const targetUser = text[1].replace('@', ''); // Rimuovi @ se presente
    logger.debug(`Ricerca utente target: ${targetUser}`);
    
    // Cerca l'utente target
    let seller;
    if (/^\d+$/.test(targetUser)) {
      // È un ID numerico
      seller = await User.findOne({ userId: parseInt(targetUser) });
    } else {
      // È uno username
      seller = await User.findOne({ username: targetUser });
    }
    
    if (!seller) {
      logger.warn(`Utente ${targetUser} non trovato per /avvio_ricarica`);
      await ctx.reply('❌ Utente non trovato.');
      return;
    }
    
    // Verifica se l'admin ha un saldo disponibile
    if (user.balance <= 0) {
      logger.warn(`Tentativo di /avvio_ricarica con saldo insufficiente: ${user.balance} kWh`);
      await ctx.reply('❌ Non hai un saldo disponibile. Attendi di ricevere donazioni dai venditori.');
      return;
    }
    
    logger.info(`Avvio procedura ricarica manuale con venditore ${seller.userId}`, {
      sellerName: seller.username || seller.firstName,
      adminBalance: user.balance
    });
    
    // Avvia una chat privata con l'admin per prenotare una ricarica
    await ctx.reply(`
🔋 <b>Avvio ricarica con ${seller.username ? '@' + seller.username : seller.firstName}</b> 🔋

Hai un saldo di ${user.balance.toFixed(2)} kWh.

Per prenotare una ricarica, inserisci i seguenti dettagli:
`, {
      parse_mode: 'HTML'
    });
    
    // Memorizza l'ID del venditore per la procedura guidata
    ctx.session.manualChargeSellerId = seller.userId;
    
    await ctx.reply('1️⃣ In quale data vorresti ricaricare? (Inserisci la data nel formato DD/MM/YYYY, ad esempio 15/05/2023)');
  } catch (err) {
    logger.error(`Errore nel comando avvio_ricarica per utente ${ctx.from.id}:`, err);
    await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

/**
 * Gestisce il comando di aggiornamento comandi bot per admin
 * @param {Object} ctx - Contesto Telegraf
 */
const updateBotCommandsCommand = async (ctx) => {
  try {
    logger.info(`Comando /update_commands ricevuto da ${ctx.from.id}`, {
      userId: ctx.from.id,
      username: ctx.from.username
    });
    
    const user = await userService.registerUser(ctx.from);
    
    // Verifica che l'utente sia l'admin usando la funzione isAdmin
    if (!isAdmin(user.userId)) {
      logger.warn(`Tentativo non autorizzato di usare /update_commands da parte di ${ctx.from.id}`);
      await ctx.reply('❌ Solo l\'amministratore può usare questo comando.');
      return;
    }
    
    // Array dei comandi da impostare per utenti normali
    const userCommands = [
      { command: 'start', description: 'Avvia il bot' },
      { command: 'help', description: 'Mostra i comandi disponibili' },
      { command: 'vendi_kwh', description: 'Crea un annuncio per vendere kWh' },
      { command: 'le_mie_ricariche', description: 'Visualizza le tue ricariche attive' },
      { command: 'profilo', description: 'Visualizza il tuo profilo' },
      { command: 'archivia_annuncio', description: 'Archivia il tuo annuncio attivo' },
      { command: 'annulla', description: 'Annulla la procedura in corso' }
    ];
    
    // Array dei comandi per amministratori
    const adminCommands = [
      ...userCommands,
      { command: 'avvio_ricarica', description: 'Avvia una ricarica usando il saldo (solo admin)' },
      { command: 'update_commands', description: 'Aggiorna i comandi del bot (solo admin)' },
      { command: 'cancella_dati_utente', description: 'Cancella i dati di un utente (solo admin)' },
      { command: 'aggiungi_feedback', description: 'Aggiungi feedback a un utente (solo admin)' }
    ];
    
    // Imposta i comandi per gli utenti normali
    await ctx.telegram.setMyCommands(userCommands);
    
    // Imposta i comandi per l'amministratore
    await ctx.telegram.setMyCommands(adminCommands, {
      scope: { type: 'chat', chat_id: ADMIN_USER_ID }
    });
    
    logger.info(`Comandi del bot aggiornati da admin ${ctx.from.id}`);
    await ctx.reply('✅ I comandi del bot sono stati aggiornati con successo!');
  } catch (err) {
    logger.error(`Errore nell'aggiornamento dei comandi per utente ${ctx.from.id}:`, err);
    await ctx.reply('❌ Si è verificato un errore durante l\'aggiornamento dei comandi. Per favore, riprova più tardi.');
  }
};

/**
 * Gestisce il comando /annulla
 * @param {Object} ctx - Contesto Telegraf
 */
const cancelCommand = async (ctx) => {
  try {
    logger.info(`Comando /annulla ricevuto da ${ctx.from.id}`, {
      userId: ctx.from.id,
      username: ctx.from.username
    });
    
    // Verifica se l'utente ha una scena attiva
    if (ctx.session && ctx.session.__scenes && ctx.session.__scenes.current) {
      const currentScene = ctx.session.__scenes.current;
      
      logger.debug(`Annullamento scena ${currentScene} per utente ${ctx.from.id}`);
      
      // Pulisci la scena e lo stato
      await ctx.scene.leave();
      
      await ctx.reply(`❌ Hai annullato la procedura di "${currentScene}".`);
    } else {
      await ctx.reply('ℹ️ Non hai nessuna procedura attiva da annullare.');
    }
  } catch (err) {
    logger.error(`Errore nel comando annulla per utente ${ctx.from.id}:`, err);
    await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

/**
 * Gestisce il comando /archivia_annuncio
 * @param {Object} ctx - Contesto Telegraf
 */
const archiveAnnouncementCommand = async (ctx) => {
  try {
    logger.info(`Comando /archivia_annuncio ricevuto da ${ctx.from.id}`, {
      userId: ctx.from.id,
      username: ctx.from.username
    });
    
    const user = await userService.registerUser(ctx.from);
    
    // Verifica se l'utente ha un annuncio attivo
    const activeAnnouncement = await announcementService.getActiveAnnouncement(user.userId, 'sell');
    
    if (!activeAnnouncement) {
      await ctx.reply('❌ Non hai nessun annuncio attivo da archiviare.');
      return;
    }
    
    // Archivia l'annuncio (questa funzione include già l'eliminazione del messaggio dal topic)
    await announcementService.archiveAnnouncement(activeAnnouncement._id);
    
    // Aggiorna il riferimento nell'utente
    await announcementService.updateUserActiveAnnouncement(user.userId, 'sell', null);
    
    await ctx.reply(`✅ Il tuo annuncio (ID: ${activeAnnouncement._id}) è stato archiviato con successo.`);
    
  } catch (err) {
    logger.error(`Errore nell'archiviazione dell'annuncio per l'utente ${ctx.from.id}:`, err);
    await ctx.reply('❌ Si è verificato un errore durante l\'archiviazione dell\'annuncio. Per favore, riprova più tardi.');
  }
};

/**
 * Gestisce il comando /cancella_dati_utente (solo per admin)
 * @param {Object} ctx - Contesto Telegraf
 */
const deleteUserDataCommand = async (ctx) => {
  try {
    logger.info(`Comando /cancella_dati_utente ricevuto da ${ctx.from.id}`, {
      userId: ctx.from.id,
      username: ctx.from.username
    });
    
    // Verifica che sia l'admin
    if (!isAdmin(ctx.from.id)) {
      logger.warn(`Tentativo non autorizzato di usare /cancella_dati_utente da parte di ${ctx.from.id}`);
      await ctx.reply('❌ Solo l\'amministratore può usare questo comando.');
      return;
    }
    
    // Estrai il parametro username o userId
    const text = ctx.message.text.split(' ');
    if (text.length < 2) {
      await ctx.reply('⚠️ Formato corretto: /cancella\\_dati\\_utente username o ID');
      return;
    }
    
    const targetUser = text[1].replace('@', ''); // Rimuovi @ se presente
    
    // Cerca l'utente target
    let user;
    if (/^\d+$/.test(targetUser)) {
      // È un ID numerico
      user = await User.findOne({ userId: parseInt(targetUser) });
    } else {
      // È uno username
      user = await User.findOne({ username: targetUser });
    }
    
    if (!user) {
      await ctx.reply(`❌ Utente "${targetUser}" non trovato.`);
      return;
    }
    
    // Chiedi conferma prima di procedere
    await ctx.reply(`⚠️ <b>Conferma cancellazione dati</b>\n\nStai per cancellare definitivamente i dati dell'utente:\nID: ${user.userId}\nUsername: ${user.username || 'N/A'}\nNome: ${user.firstName || 'N/A'}\n\nPer confermare, rispondi "CONFERMA CANCELLAZIONE ${user.userId}"`, {
      parse_mode: 'HTML'
    });
    
    // Imposta il flag di conferma nella sessione
    ctx.session.awaitingDeletionConfirmation = user.userId;
    
  } catch (err) {
    logger.error(`Errore nell'elaborazione del comando cancella_dati_utente:`, err);
    await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

/**
 * Gestisce il comando /aggiungi_feedback (solo per admin)
 * @param {Object} ctx - Contesto Telegraf
 */
const addFeedbackCommand = async (ctx) => {
  try {
    logger.info(`Comando /aggiungi_feedback ricevuto da ${ctx.from.id}`, {
      userId: ctx.from.id,
      username: ctx.from.username,
      text: ctx.message.text
    });
    
    // Verifica che sia l'admin
    if (!isAdmin(ctx.from.id)) {
      logger.warn(`Tentativo non autorizzato di usare /aggiungi_feedback da parte di ${ctx.from.id}`);
      await ctx.reply('❌ Solo l\'amministratore può usare questo comando.');
      return;
    }
    
    // Formato: /aggiungi_feedback @username o ID positivi:X negativi:Y
    const text = ctx.message.text.split(' ');
    if (text.length < 3) {
      await ctx.reply(`⚠️ Formato corretto: /aggiungi\\_feedback username o ID positivi:X negativi:Y\n\nEsempio: /aggiungi\\_feedback @ciccio11218 positivi:5 negativi:1`);
      return;
    }
    
    const targetUser = text[1].replace('@', ''); // Rimuovi @ se presente
    
    // Cerca l'utente target
    let user;
    if (/^\d+$/.test(targetUser)) {
      // È un ID numerico
      user = await User.findOne({ userId: parseInt(targetUser) });
    } else {
      // È uno username
      user = await User.findOne({ username: targetUser });
    }
    
    if (!user) {
      await ctx.reply(`❌ Utente "${targetUser}" non trovato.`);
      return;
    }
    
    // Estrai i numeri di feedback positivi e negativi
    let positivesToAdd = 0;
    let negativesToAdd = 0;
    
    for (let i = 2; i < text.length; i++) {
      if (text[i].startsWith('positivi:')) {
        positivesToAdd = parseInt(text[i].replace('positivi:', ''));
      } else if (text[i].startsWith('negativi:')) {
        negativesToAdd = parseInt(text[i].replace('negativi:', ''));
      }
    }
    
    if (isNaN(positivesToAdd) && isNaN(negativesToAdd)) {
      await ctx.reply('❌ Specificare almeno un valore per positivi e/o negativi.');
      return;
    }
    
    // Valori di feedback prima dell'aggiornamento
    const oldPositive = user.positiveRatings || 0;
    const oldTotal = user.totalRatings || 0;
    const oldPercentage = user.getPositivePercentage();
    
    // Aggiorna il feedback
    if (!isNaN(positivesToAdd) && positivesToAdd > 0) {
      user.positiveRatings = (user.positiveRatings || 0) + positivesToAdd;
      user.totalRatings = (user.totalRatings || 0) + positivesToAdd;
    }
    
    if (!isNaN(negativesToAdd) && negativesToAdd > 0) {
      // Aggiungiamo solo al totale, non ai positivi
      user.totalRatings = (user.totalRatings || 0) + negativesToAdd;
    }
    
    await user.save();
    
    // Calcola i nuovi valori
    const newPositive = user.positiveRatings;
    const newTotal = user.totalRatings;
    const newPercentage = user.getPositivePercentage();
    
    // Invia conferma
    await ctx.reply(`✅ Feedback aggiornato per utente ${user.username || user.firstName} (ID: ${user.userId}):\n\nFeedback positivi: ${oldPositive} → ${newPositive}\nFeedback totali: ${oldTotal} → ${newTotal}\nPercentuale positivi: ${oldPercentage !== null ? oldPercentage + '%' : 'N/A'} → ${newPercentage !== null ? newPercentage + '%' : 'N/A'}`);
    
    // Notifica all'utente dell'aggiornamento dei feedback (opzionale)
    try {
      await bot.telegram.sendMessage(user.userId, `ℹ️ Il tuo feedback è stato aggiornato da un amministratore.\nNuovo stato: ${newPositive}/${newTotal} (${newPercentage}% positivi).`);
    } catch (notifyErr) {
      logger.warn(`Impossibile notificare l'utente ${user.userId} dell'aggiornamento del feedback:`, notifyErr);
      // Ignora l'errore, non è critico
    }
    
  } catch (err) {
    logger.error(`Errore nell'aggiunta del feedback:`, err);
    await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

/**
 * Handler per gestire la conferma di cancellazione dei dati utente
 * @param {Object} ctx - Contesto Telegraf
 * @returns {Boolean} True se il messaggio è stato gestito, false altrimenti
 */
const deleteUserDataHandler = async (ctx) => {
  // Verifica che ci sia un'attesa di conferma e che il messaggio corrisponda
  if (ctx.session && 
      ctx.session.awaitingDeletionConfirmation && 
      ctx.message && ctx.message.text === `CONFERMA CANCELLAZIONE ${ctx.session.awaitingDeletionConfirmation}`) {
  
    const targetUserId = ctx.session.awaitingDeletionConfirmation;
    
    try {
      // Cancella la sessione
      delete ctx.session.awaitingDeletionConfirmation;
      
      // Recupera l'utente
      const targetUser = await User.findOne({ userId: targetUserId });
      
      if (!targetUser) {
        await ctx.reply('❌ Utente non trovato.');
        return true; // Impedisce che altri handler gestiscano questo messaggio
      }
      
      // Archivia tutti gli annunci attivi dell'utente
      const activeAnnouncements = await Announcement.find({ userId: targetUserId, status: 'active' });
      for (const announcement of activeAnnouncements) {
        await announcementService.archiveAnnouncement(announcement._id);
      }
      
      // Anonimizza tutte le offerte
      await Offer.updateMany(
        { $or: [{ buyerId: targetUserId }, { sellerId: targetUserId }] },
        { $set: { 
          additionalInfo: '[Dati eliminati]',
          coordinates: '[Dati eliminati]',
          rejectionReason: '[Dati eliminati]',
          paymentMethod: '[Dati eliminati]',
          paymentDetails: '[Dati eliminati]'
        }}
      );
      
      // Elimina i feedback dalle offerte
      await Offer.updateMany(
        { buyerId: targetUserId },
        { $unset: { buyerFeedback: 1 } }
      );
      
      await Offer.updateMany(
        { sellerId: targetUserId },
        { $unset: { sellerFeedback: 1 } }
      );
      
      // Aggiorna la proprietà dell'utente
      await User.updateOne(
        { userId: targetUserId },
        { 
          $set: {
            username: '[Utente cancellato]',
            firstName: '[Utente cancellato]',
            lastName: '[Utente cancellato]',
            activeAnnouncements: { sell: null, buy: null }
          }
        }
      );
      
      // Non eliminiamo completamente l'utente per mantenere la storia delle transazioni,
      // ma rimuoviamo tutti i dati personali
      
      await ctx.reply(`✅ I dati dell'utente ${targetUserId} sono stati cancellati con successo dal sistema.\n\nLe transazioni storiche sono state anonimizzate, ma rimangono nel sistema per scopi di audit.`);
      
      // Prova a notificare l'utente
      try {
        await bot.telegram.sendMessage(targetUserId, `ℹ️ I tuoi dati sono stati cancellati da un amministratore su tua richiesta.`);
      } catch (notifyErr) {
        logger.warn(`Impossibile notificare l'utente ${targetUserId} della cancellazione dei dati:`, notifyErr);
        // Ignora l'errore, non è critico
      }
      
      return true; // Impedisce che altri handler gestiscano questo messaggio
    } catch (err) {
      logger.error(`Errore nella cancellazione dei dati dell'utente ${targetUserId}:`, err);
      await ctx.reply('❌ Si è verificato un errore durante la cancellazione dei dati. Per favore, contatta l\'amministratore.');
      return true; // Impedisce che altri handler gestiscano questo messaggio
    }
  }
  
  return false; // Permette ad altri handler di gestire questo messaggio
};

module.exports = {
  startCommand,
  sellKwhCommand,
  myChargesCommand,
  profileCommand,
  helpCommand,
  startChargeCommand,
  updateBotCommandsCommand,
  cancelCommand,
  archiveAnnouncementCommand,
  deleteUserDataCommand,
  addFeedbackCommand,
  deleteUserDataHandler
};
