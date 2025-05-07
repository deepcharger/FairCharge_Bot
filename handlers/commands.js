// Gestori dei comandi principali del bot
const { Markup } = require('telegraf');
const userService = require('../services/userService');
const offerService = require('../services/offerService');
const { formatUserProfile, formatOfferListItem } = require('../utils/formatters');
const User = require('../models/user');
const Transaction = require('../models/transaction');
const moment = require('moment');

/**
 * Gestisce il comando /start
 * @param {Object} ctx - Contesto Telegraf
 */
const startCommand = async (ctx) => {
  try {
    await userService.registerUser(ctx.from);
    
    await ctx.reply(`
👋 Benvenuto nel bot di compravendita kWh!

Questo bot ti permette di vendere o comprare kWh per la ricarica di veicoli elettrici.

🔌 *Comandi disponibili:*
/vendi_kwh - Crea un annuncio per vendere kWh
/le_mie_ricariche - Visualizza le tue ricariche attive
/profilo - Visualizza il tuo profilo

Se hai domande, contatta @admin_username.
`, {
      parse_mode: 'Markdown'
    });
  } catch (err) {
    console.error('Errore nel comando start:', err);
    await ctx.reply('Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

/**
 * Gestisce il comando /vendi_kwh
 * @param {Object} ctx - Contesto Telegraf
 */
const sellKwhCommand = (ctx) => {
  return ctx.scene.enter('SELL_ANNOUNCEMENT_WIZARD');
};

/**
 * Gestisce il comando /le_mie_ricariche
 * @param {Object} ctx - Contesto Telegraf
 */
const myChargesCommand = async (ctx) => {
  try {
    const user = await userService.registerUser(ctx.from);
    
    // Recupera le offerte organizzate per stato
    const offers = await offerService.getActiveOffers(user.userId);
    
    if (Object.values(offers).flat().length === 0) {
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
  } catch (err) {
    console.error('Errore nel recupero delle ricariche:', err);
    await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

/**
 * Gestisce il comando /profilo
 * @param {Object} ctx - Contesto Telegraf
 */
const profileCommand = async (ctx) => {
  try {
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
  } catch (err) {
    console.error('Errore nel recupero del profilo:', err);
    await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

/**
 * Gestisce il comando /avvio_ricarica
 * @param {Object} ctx - Contesto Telegraf
 */
const startChargeCommand = async (ctx) => {
  try {
    const user = await userService.registerUser(ctx.from);
    
    // Verifica che l'utente sia l'admin
    const adminId = 123456789; // Sostituisci con il tuo ID Telegram
    
    if (user.userId !== adminId) {
      await ctx.reply('❌ Solo l\'amministratore può usare questo comando.');
      return;
    }
    
    // Estrai il parametro username
    const text = ctx.message.text.split(' ');
    if (text.length < 2) {
      await ctx.reply('⚠️ Formato corretto: /avvio_ricarica username o ID');
      return;
    }
    
    const targetUser = text[1].replace('@', ''); // Rimuovi @ se presente
    
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
      await ctx.reply('❌ Utente non trovato.');
      return;
    }
    
    // Verifica se l'admin ha un saldo disponibile
    if (user.balance <= 0) {
      await ctx.reply('❌ Non hai un saldo disponibile. Attendi di ricevere donazioni dai venditori.');
      return;
    }
    
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
    console.error('Errore nel comando avvio_ricarica:', err);
    await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

module.exports = {
  startCommand,
  sellKwhCommand,
  myChargesCommand,
  profileCommand,
  startChargeCommand
};
