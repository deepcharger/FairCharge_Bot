// Gestori dei comandi principali del bot
const { Markup } = require('telegraf');
const userService = require('../services/userService');
const offerService = require('../services/offerService');
const { formatUserProfile, formatOfferListItem } = require('../utils/formatters');
const User = require('../models/user');
const Transaction = require('../models/transaction');
const moment = require('moment');
const logger = require('../utils/logger');
const { isAdmin } = require('../config/admin');

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
    
    // Messaggio di benvenuto direttamente inserito qui per evitare dipendenze
    const welcomeMessage = `
👋 *Benvenuto nel bot di compravendita kWh!*

Questo bot ti permette di vendere o comprare kWh per la ricarica di veicoli elettrici.

🔌 *Comandi disponibili:*
/vendi\\_kwh - Crea un annuncio per vendere kWh
/le\\_mie\\_ricariche - Visualizza le tue ricariche attive
/profilo - Visualizza il tuo profilo
/help - Mostra questo messaggio di aiuto

Se hai domande, contatta @admin_username.
`;
    
    await ctx.reply(welcomeMessage, {
      parse_mode: 'Markdown'
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
      
      let text = `*${icon} ${title}:*\n`;
      
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
      
      await ctx.reply(text, { parse_mode: 'Markdown' });
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
    
    await ctx.reply(profileText, { parse_mode: 'Markdown' });
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
    const helpMessage = `
👋 *Bot di compravendita kWh*

Questo bot ti permette di vendere o comprare kWh per la ricarica di veicoli elettrici.

🔌 *Comandi disponibili:*
/vendi\\_kwh - Crea un annuncio per vendere kWh
/le\\_mie\\_ricariche - Visualizza le tue ricariche attive
/profilo - Visualizza il tuo profilo
/help - Mostra questo messaggio di aiuto

Se hai domande, contatta @admin_username.
`;
    
    await ctx.reply(helpMessage, { parse_mode: 'Markdown' });
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
🔋 *Avvio ricarica con ${seller.username ? '@' + seller.username : seller.firstName}* 🔋

Hai un saldo di ${user.balance.toFixed(2)} kWh.

Per prenotare una ricarica, inserisci i seguenti dettagli:
`, {
      parse_mode: 'Markdown'
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
    
    // Array dei comandi da impostare
    const commands = [
      { command: 'start', description: 'Avvia il bot' },
      { command: 'help', description: 'Mostra i comandi disponibili' },
      { command: 'vendi_kwh', description: 'Crea un annuncio per vendere kWh' },
      { command: 'le_mie_ricariche', description: 'Visualizza le tue ricariche attive' },
      { command: 'profilo', description: 'Visualizza il tuo profilo' },
      // Solo per admin, quindi non visibile agli utenti normali
      { command: 'avvio_ricarica', description: 'Avvia una ricarica usando il saldo (solo admin)' },
      { command: 'update_commands', description: 'Aggiorna i comandi del bot (solo admin)' }
    ];
    
    // Imposta i comandi per l'intera applicazione
    await ctx.telegram.setMyCommands(commands);
    
    logger.info(`Comandi del bot aggiornati da admin ${ctx.from.id}`);
    await ctx.reply('✅ I comandi del bot sono stati aggiornati con successo!');
  } catch (err) {
    logger.error(`Errore nell'aggiornamento dei comandi per utente ${ctx.from.id}:`, err);
    await ctx.reply('❌ Si è verificato un errore durante l\'aggiornamento dei comandi. Per favore, riprova più tardi.');
  }
};

module.exports = {
  startCommand,
  sellKwhCommand,
  myChargesCommand,
  profileCommand,
  helpCommand,
  startChargeCommand,
  updateBotCommandsCommand
};
