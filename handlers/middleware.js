// handlers/middleware.js
// Middleware centralizzato per il bot con sicurezza avanzata

const { session, Markup } = require('telegraf');
const { SELL_GROUPS_CONFIG, BUY_GROUPS_CONFIG } = require('../config/bot');
const { isAdmin } = require('../config/admin');
const { membershipMiddleware } = require('../services/memberVerificationService');
const { securityMiddleware } = require('../services/securityService');
const { whitelistMiddleware } = require('../services/whitelistService');
const userService = require('../services/userService');
const offerService = require('../services/offerService');
const paymentService = require('../services/paymentService');
const commands = require('../handlers/commands');
const Offer = require('../models/offer');
const User = require('../models/user');
const moment = require('moment');
const logger = require('../utils/logger');
const { ADMIN_USER_ID } = require('../config/admin');

/**
 * Middleware per la gestione della sessione
 * @returns {Function} Middleware per la sessione
 */
const sessionMiddleware = () => {
  return session();
};

/**
 * Middleware per logging delle attività
 */
const loggingMiddleware = () => {
  return async (ctx, next) => {
    const logData = {
      userId: ctx.from?.id,
      username: ctx.from?.username,
      firstName: ctx.from?.first_name,
      chatId: ctx.chat?.id,
      messageType: ctx.message ? 'message' : ctx.callbackQuery ? 'callback' : 'other',
      text: ctx.message?.text || ctx.callbackQuery?.data || 'N/A'
    };
    
    logger.info('Bot interaction', logData);
    
    return next();
  };
};

/**
 * Middleware per gestire errori non catturati
 */
const errorHandlingMiddleware = () => {
  return async (ctx, next) => {
    try {
      await next();
    } catch (err) {
      logger.error('Errore non gestito nel middleware:', err);
      
      try {
        if (ctx.callbackQuery) {
          await ctx.answerCbQuery('Si è verificato un errore. Riprova più tardi.', { show_alert: true });
        } else {
          await ctx.reply('❌ Si è verificato un errore imprevisto. Riprova più tardi.');
        }
      } catch (replyErr) {
        logger.error('Errore nell\'invio del messaggio di errore:', replyErr);
      }
    }
  };
};

/**
 * Middleware per verificare se l'utente è bloccato
 */
const blockCheckMiddleware = () => {
  return async (ctx, next) => {
    try {
      const user = await User.findOne({ userId: ctx.from.id });
      
      if (user && user.isBlocked) {
        logger.warn(`Utente bloccato ha tentato di usare il bot: ${ctx.from.id}`, {
          userId: ctx.from.id,
          username: ctx.from.username,
          blockedReason: user.blockedReason,
          blockedAt: user.blockedAt
        });
        
        await ctx.reply(
          '🚫 <b>Accesso Bloccato</b>\n\n' +
          'Il tuo account è stato temporaneamente bloccato.\n\n' +
          `<b>Motivo:</b> ${user.blockedReason || 'Non specificato'}\n` +
          `<b>Data:</b> ${user.blockedAt ? user.blockedAt.toLocaleDateString('it-IT') : 'N/A'}\n\n` +
          'Per maggiori informazioni, contatta il supporto.',
          { 
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '📞 Contatta Support', url: 'https://t.me/your_support_username' }]
              ]
            }
          }
        );
        
        return; // Blocca l'esecuzione
      }
      
      return next();
      
    } catch (err) {
      logger.error('Errore nel middleware di controllo blocco:', err);
      return next(); // In caso di errore, permetti l'accesso
    }
  };
};

/**
 * Middleware per verificare i permessi di amministratore
 * @param {Boolean} requireAdmin - Se richiedere permessi admin
 */
const adminMiddleware = (requireAdmin = true) => {
  return async (ctx, next) => {
    if (!requireAdmin) {
      return next();
    }
    
    if (!isAdmin(ctx.from.id)) {
      await ctx.reply('❌ Comando riservato agli amministratori.');
      return;
    }
    
    return next();
  };
};

/**
 * Middleware per inizializzare la sessione utente
 */
const userSessionMiddleware = () => {
  return async (ctx, next) => {
    if (!ctx.session) {
      ctx.session = {};
    }
    
    // Inizializza dati utente nella sessione se non esistono
    if (!ctx.session.user) {
      ctx.session.user = {
        id: ctx.from.id,
        username: ctx.from.username,
        firstName: ctx.from.first_name,
        lastName: ctx.from.last_name
      };
    }
    
    return next();
  };
};

/**
 * Middleware per rate limiting (prevenzione spam)
 */
const rateLimitMiddleware = () => {
  const userRequests = new Map();
  const RATE_LIMIT_WINDOW = 60000; // 1 minuto
  const MAX_REQUESTS = 30; // 30 richieste per minuto
  
  return async (ctx, next) => {
    const userId = ctx.from.id;
    const now = Date.now();
    
    // Salta il rate limiting per gli admin
    if (isAdmin(userId)) {
      return next();
    }
    
    // Pulisce le richieste vecchie
    const userRequestHistory = userRequests.get(userId) || [];
    const recentRequests = userRequestHistory.filter(
      timestamp => now - timestamp < RATE_LIMIT_WINDOW
    );
    
    if (recentRequests.length >= MAX_REQUESTS) {
      logger.warn(`Rate limit superato per utente ${userId}`, {
        userId,
        username: ctx.from.username,
        requestCount: recentRequests.length
      });
      
      await ctx.reply(
        '⚠️ <b>Troppi messaggi</b>\n\n' +
        'Hai inviato troppi messaggi in poco tempo.\n' +
        'Aspetta un momento prima di riprovare.',
        { parse_mode: 'HTML' }
      );
      return;
    }
    
    // Aggiunge la richiesta corrente
    recentRequests.push(now);
    userRequests.set(userId, recentRequests);
    
    return next();
  };
};

/**
 * Middleware combinato per la sicurezza completa
 * @param {Object} options - Opzioni per i controlli
 */
const securityMiddlewareStack = (options = {}) => {
  const {
    enforceGroupMembership = true,
    requireVip = false,
    requireWhitelist = false,
    skipSecurityCheck = false,
    skipCommands = ['/start', '/help']
  } = options;
  
  return async (ctx, next) => {
    // Salta i controlli per comandi specifici
    const command = ctx.message?.text?.split(' ')[0];
    if (skipCommands.includes(command)) {
      return next();
    }
    
    // Salta tutti i controlli per gli admin
    if (isAdmin(ctx.from.id)) {
      return next();
    }
    
    try {
      // 1. Controllo sessione
      if (!ctx.session) {
        ctx.session = {};
      }
      
      // 2. Controllo blocco utente (già gestito da blockCheckMiddleware, ma doppio controllo)
      const user = await User.findOne({ userId: ctx.from.id });
      if (user && user.isBlocked) {
        await ctx.reply(
          '🚫 <b>Accesso Bloccato</b>\n\n' +
          'Il tuo account è stato temporaneamente bloccato.\n' +
          'Per maggiori informazioni, contatta il supporto.',
          { parse_mode: 'HTML' }
        );
        return;
      }
      
      // 3. Controllo sicurezza per nuovi utenti
      if (!skipSecurityCheck) {
        const securityCheck = securityMiddleware();
        const securityResult = await new Promise((resolve) => {
          securityCheck(ctx, () => resolve(true)).catch(() => resolve(false));
        });
        
        if (!securityResult) {
          return; // Bloccato dal controllo sicurezza
        }
      }
      
      // 4. Controllo membership gruppi
      if (enforceGroupMembership) {
        const membershipCheck = membershipMiddleware(true, requireVip);
        const membershipResult = await new Promise((resolve) => {
          membershipCheck(ctx, () => resolve(true)).catch(() => resolve(false));
        });
        
        if (!membershipResult) {
          return; // Bloccato dal controllo membership
        }
      }
      
      // 5. Controllo whitelist (se richiesto)
      if (requireWhitelist) {
        const whitelistCheck = whitelistMiddleware(true);
        const whitelistResult = await new Promise((resolve) => {
          whitelistCheck(ctx, () => resolve(true)).catch(() => resolve(false));
        });
        
        if (!whitelistResult) {
          return; // Bloccato dal controllo whitelist
        }
      }
      
      // Se tutti i controlli sono passati, continua
      return next();
      
    } catch (err) {
      logger.error('Errore nel middleware di sicurezza:', err);
      await ctx.reply('❌ Si è verificato un errore durante la verifica. Riprova più tardi.');
      return;
    }
  };
};

/**
 * Gestore per i messaggi nei topic
 * @param {Object} ctx - Contesto Telegraf
 * @param {Function} next - Funzione next
 */
const topicMessageHandler = async (ctx, next) => {
  try {
    // Controlla se il messaggio è in un topic di annunci
    const chatId = ctx.chat.id;
    const messageThreadId = ctx.message && ctx.message.message_thread_id;
    
    // Se non c'è un thread ID, passa al prossimo handler
    if (!messageThreadId) {
      return next();
    }
    
    // Controlla se il thread è un topic di annunci (compra o vendi)
    let isSellTopic = false;
    let isBuyTopic = false;
    
    // Gestione della configurazione come stringa JSON o oggetto
    if (typeof SELL_GROUPS_CONFIG === 'string') {
      try {
        const config = JSON.parse(SELL_GROUPS_CONFIG);
        isSellTopic = config.topicId === messageThreadId && config.groupId === chatId;
      } catch (e) {
        logger.error('Errore nel parsing di SELL_GROUPS_CONFIG:', e);
      }
    } else {
      isSellTopic = SELL_GROUPS_CONFIG.topicId === messageThreadId && SELL_GROUPS_CONFIG.groupId === chatId;
    }
    
    if (typeof BUY_GROUPS_CONFIG === 'string') {
      try {
        const config = JSON.parse(BUY_GROUPS_CONFIG);
        isBuyTopic = config.topicId === messageThreadId && config.groupId === chatId;
      } catch (e) {
        logger.error('Errore nel parsing di BUY_GROUPS_CONFIG:', e);
      }
    } else {
      isBuyTopic = BUY_GROUPS_CONFIG.topicId === messageThreadId && BUY_GROUPS_CONFIG.groupId === chatId;
    }
    
    if (!isSellTopic && !isBuyTopic) {
      return next();
    }
    
    // Se il messaggio è dal bot, permettilo
    if (ctx.from.id === ctx.botInfo.id) {
      return next();
    }
    
    // Altrimenti, avvisa l'utente e cancella il messaggio dopo 10 secondi
    const warningMessage = await ctx.reply(`⚠️ In questo topic può scrivere solo il bot. Contattami in privato: @${ctx.botInfo.username}`);
    
    // Aspetta 10 secondi e poi elimina entrambi i messaggi
    setTimeout(async () => {
      try {
        // Elimina il messaggio dell'utente
        await ctx.deleteMessage(ctx.message.message_id);
        
        // Elimina anche il messaggio di avviso del bot
        await ctx.deleteMessage(warningMessage.message_id);
      } catch (err) {
        logger.error('Errore nell\'eliminazione dei messaggi:', err);
      }
    }, 10000);
  } catch (err) {
    logger.error('Errore nella gestione del messaggio nel topic:', err);
    return next();
  }
};

/**
 * Gestore per i messaggi di testo
 * @param {Object} ctx - Contesto Telegraf
 * @param {Function} next - Funzione next
 */
const textMessageHandler = async (ctx, next) => {
  // Gestione della conferma di cancellazione dei dati utente (solo admin)
  if (await commands.deleteUserDataHandler(ctx)) {
    return; // Termina l'esecuzione se l'handler ha gestito il messaggio
  }
  
  // Gestione della conferma di reset del database (solo admin)
  if (await commands.dbResetConfirmationHandler(ctx)) {
    return; // Termina l'esecuzione se l'handler ha gestito il messaggio
  }
  
  // Controlla se stiamo aspettando un motivo di rifiuto
  if (ctx.message.reply_to_message && ctx.session.rejectOfferId) {
    const offerId = ctx.session.rejectOfferId;
    const rejectionReason = ctx.message.text;
    
    try {
      const offer = await Offer.findById(offerId);
      if (!offer || offer.status !== 'pending') {
        await ctx.reply('❌ Questa richiesta non è più disponibile o è già stata elaborata.');
        delete ctx.session.rejectOfferId;
        return;
      }
      
      // Aggiorna lo stato dell'offerta
      await offerService.updateOfferStatus(offerId, 'rejected', { rejectionReason });
      
      // Notifica all'acquirente
      const message = `
❌ *Richiesta di ricarica rifiutata* ❌

Il venditore ha rifiutato la tua richiesta di ricarica per il ${moment(offer.date).format('DD/MM/YYYY')} alle ${offer.time}.

*Motivo:* ${rejectionReason}

Puoi cercare un altro venditore o riprovare più tardi.
`;
      
      await offerService.notifyUserAboutOfferUpdate(offer, offer.buyerId, message);
      
      await ctx.reply('✅ Hai rifiutato la richiesta e l\'acquirente è stato notificato.');
      
      // Pulisci il contesto
      delete ctx.session.rejectOfferId;
    } catch (err) {
      logger.error('Errore nel processare il motivo del rifiuto:', err);
      await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
      delete ctx.session.rejectOfferId;
    }
    
    return;
  }
  
  // Controlla se stiamo aspettando un numero di connettore
  if (ctx.session.connectorOfferId) {
    const offerId = ctx.session.connectorOfferId;
    const connectorInfo = ctx.message.text;
    
    try {
      const offer = await Offer.findById(offerId);
      if (!offer || offer.status !== 'ready_to_charge') {
        await ctx.reply('❌ Questa ricarica non è più disponibile o non è nello stato corretto.');
        delete ctx.session.connectorOfferId;
        return;
      }
      
      // Memorizza il numero del connettore
      await offerService.updateOfferStatus(offerId, 'ready_to_charge', { chargerConnector: connectorInfo });
      
      // Notifica al venditore
      const message = `
🔌 *Informazioni connettore* 🔌

L'acquirente utilizzerà il connettore: ${connectorInfo}

Puoi ora avviare la ricarica dalla tua app.
`;
      
      const keyboard = {
        inline_keyboard: [
          [{ text: '▶️ Ho avviato la ricarica', callback_data: `charging_started_${offerId}` }]
        ]
      };
      
      await offerService.notifyUserAboutOfferUpdate(offer, offer.sellerId, message, keyboard);
      
      await ctx.reply('✅ Informazioni sul connettore inviate al venditore. Attendi che avvii la ricarica.');
      
      // Pulisci il contesto
      delete ctx.session.connectorOfferId;
    } catch (err) {
      logger.error('Errore nel processare il numero del connettore:', err);
      await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
      delete ctx.session.connectorOfferId;
    }
    
    return;
  }
  
  // Controlla se stiamo aspettando una descrizione del problema
  if (ctx.message.reply_to_message && ctx.session.issueOfferId) {
    const offerId = ctx.session.issueOfferId;
    const issueDescription = ctx.message.text;
    
    try {
      const offer = await Offer.findById(offerId);
      if (!offer) {
        await ctx.reply('❌ Questa ricarica non è più disponibile.');
        delete ctx.session.issueOfferId;
        return;
      }
      
      // Notifica al venditore
      const buyer = await User.findOne({ userId: offer.buyerId });
      const buyerName = buyer ? 
        (buyer.username ? '@' + buyer.username : buyer.firstName) : 
        'Acquirente';
      
      const message = `
⚠️ *Problema con la ricarica* ⚠️

${buyerName} ha riscontrato un problema con la ricarica:

"${issueDescription}"

Per favore, contattalo direttamente per risolvere il problema.
`;
      
      await offerService.notifyUserAboutOfferUpdate(offer, offer.sellerId, message);
      
      await ctx.reply(`✅ Problema segnalato al venditore. Ti consigliamo di contattarlo direttamente per risolvere il problema più rapidamente.`);
      
      // Pulisci il contesto
      delete ctx.session.issueOfferId;
    } catch (err) {
      logger.error('Errore nel processare la descrizione del problema:', err);
      await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
      delete ctx.session.issueOfferId;
    }
    
    return;
  }
  
  // Controlla se stiamo aspettando i kWh caricati
  if (ctx.session.completedOfferId) {
    const offerId = ctx.session.completedOfferId;
    const kwhText = ctx.message.text;
    
    try {
      // Verifica che sia un numero valido
      const kwh = parseFloat(kwhText);
      if (isNaN(kwh) || kwh <= 0) {
        await ctx.reply('❌ Per favore, inserisci un numero valido maggiore di zero.');
        return;
      }
      
      const offer = await Offer.findById(offerId);
      if (!offer || offer.status !== 'charging') {
        await ctx.reply('❌ Questa ricarica non è più disponibile o non è nello stato corretto.');
        delete ctx.session.completedOfferId;
        return;
      }
      
      // Aggiorna i kWh caricati e lo stato
      await offerService.updateOfferStatus(offerId, 'charging_completed', { kwhCharged: kwh });
      
      // Chiedi la foto del display della colonnina
      await ctx.reply('📸 Per favore, invia una foto del display della colonnina dove si leggono i kWh caricati.');
      
      // Manteniamo l'ID dell'offerta nel contesto per l'handler della foto
      ctx.session.photoOfferId = offerId;
      delete ctx.session.completedOfferId;
    } catch (err) {
      logger.error('Errore nel processare i kWh caricati:', err);
      await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
      delete ctx.session.completedOfferId;
    }
    
    return;
  }
  
  // Controlla se stiamo aspettando un motivo di contestazione
  if (ctx.session.disputeKwhOfferId) {
    const offerId = ctx.session.disputeKwhOfferId;
    const disputeReason = ctx.message.text;
    
    try {
      const offer = await Offer.findById(offerId);
      if (!offer || offer.status !== 'kwh_confirmed') {
        await ctx.reply('❌ Questa ricarica non è più disponibile o non è nello stato corretto.');
        delete ctx.session.disputeKwhOfferId;
        return;
      }
      
      // Notifica all'acquirente
      const message = `
⚠️ *Contestazione kWh* ⚠️

Il venditore ha contestato i kWh dichiarati:

"${disputeReason}"

Per favore, verifica e rispondi usando il comando /le_mie_ricariche.
`;
      
      await offerService.notifyUserAboutOfferUpdate(offer, offer.buyerId, message);
      
      await ctx.reply('✅ Contestazione inviata all\'acquirente. Attendi la sua risposta.');
      
      // Pulisci il contesto
      delete ctx.session.disputeKwhOfferId;
    } catch (err) {
      logger.error('Errore nel processare il motivo della contestazione:', err);
      await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
      delete ctx.session.disputeKwhOfferId;
    }
    
    return;
  }
  
  // Controlla se stiamo aspettando l'importo da pagare
  if (ctx.session.paymentAmountOfferId) {
    const offerId = ctx.session.paymentAmountOfferId;
    const unitPriceText = ctx.message.text;
    
    try {
      // Verifica che sia un numero valido
      const unitPrice = parseFloat(unitPriceText);
      if (isNaN(unitPrice) || unitPrice <= 0) {
        await ctx.reply('❌ Per favore, inserisci un costo unitario valido maggiore di zero (esempio: 0.22).');
        return;
      }
      
      const offer = await Offer.findById(offerId);
      if (!offer || offer.status !== 'kwh_confirmed') {
        await ctx.reply('❌ Questa ricarica non è più disponibile o non è nello stato corretto.');
        delete ctx.session.paymentAmountOfferId;
        return;
      }
      
      // Calcola l'importo totale
      const totalAmount = await paymentService.calculateTotalAmount(offer, unitPrice);
      
      // Mostra il calcolo al venditore per conferma
      await paymentService.showCalculationToSeller(offer, unitPrice, totalAmount);
      
      // Salviamo il prezzo unitario nella sessione per la callback di conferma
      ctx.session.unitPrice = unitPrice;
      
      // Pulisci il contesto
      delete ctx.session.paymentAmountOfferId;
    } catch (err) {
      logger.error(`Errore nel processare il costo unitario per kWh:`, err);
      await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
      delete ctx.session.paymentAmountOfferId;
    }
    
    return;
  }
  
  // Controlla se stiamo aspettando un metodo di pagamento
  if (ctx.session.paymentMethodOfferId) {
    const offerId = ctx.session.paymentMethodOfferId;
    const paymentDetails = ctx.message.text;
    
    try {
      const offer = await Offer.findById(offerId);
      if (!offer || offer.status !== 'payment_pending') {
        await ctx.reply('❌ Questa ricarica non è più disponibile o non è nello stato corretto.');
        delete ctx.session.paymentMethodOfferId;
        return;
      }
      
      // Aggiorna l'offerta con il metodo di pagamento e lo stato
      await offerService.updateOfferStatus(offerId, 'payment_sent', { paymentMethod: paymentDetails });
      
      // Notifica al venditore
      const buyer = await User.findOne({ userId: offer.buyerId });
      const buyerName = buyer ? 
        (buyer.username ? '@' + buyer.username : buyer.firstName) : 
        'Acquirente';
      
      const message = `
💸 *Pagamento effettuato* 💸

${buyerName} dichiara di aver effettuato il pagamento di ${offer.totalAmount.toFixed(2)}€ per ${offer.kwhCharged} kWh.

*Dettagli pagamento:* 
${paymentDetails}

Per favore, verifica di aver ricevuto il pagamento e conferma.
`;
      
      const keyboard = {
        inline_keyboard: [
          [
            { text: '✅ Confermo pagamento ricevuto', callback_data: `payment_confirmed_${offerId}` },
            { text: '❌ Non ho ricevuto', callback_data: `payment_not_received_${offerId}` }
          ]
        ]
      };
      
      await offerService.notifyUserAboutOfferUpdate(offer, offer.sellerId, message, keyboard);
      
      await ctx.reply('✅ Hai segnalato di aver effettuato il pagamento. Attendi la conferma del venditore.');
      
      // Pulisci il contesto
      delete ctx.session.paymentMethodOfferId;
    } catch (err) {
      logger.error('Errore nel processare il metodo di pagamento:', err);
      await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
      delete ctx.session.paymentMethodOfferId;
    }
    
    return;
  }
  
  // Controlla se stiamo aspettando un motivo di contestazione del pagamento
  if (ctx.session.paymentDisputeOfferId) {
    const offerId = ctx.session.paymentDisputeOfferId;
    const disputeReason = ctx.message.text;
    
    try {
      const offer = await Offer.findById(offerId);
      if (!offer || offer.status !== 'payment_sent') {
        await ctx.reply('❌ Questa ricarica non è più disponibile o non è nello stato corretto.');
        delete ctx.session.paymentDisputeOfferId;
        return;
      }
      
      // Aggiorna lo stato dell'offerta a contestato
      await offerService.updateOfferStatus(offerId, 'disputed', { rejectionReason: disputeReason });
      
      // Notifica all'acquirente
      const message = `
⚠️ *Contestazione pagamento* ⚠️

Il venditore non ha ricevuto il pagamento o ha riscontrato un problema:

"${disputeReason}"

Per favore, verifica e contatta direttamente il venditore per risolvere il problema.
`;
      
      await offerService.notifyUserAboutOfferUpdate(offer, offer.buyerId, message);
      
      await ctx.reply('✅ Contestazione inviata all\'acquirente. Ti consigliamo di contattarlo direttamente per risolvere il problema più rapidamente.');
      
      // Pulisci il contesto
      delete ctx.session.paymentDisputeOfferId;
    } catch (err) {
      logger.error('Errore nel processare il motivo della contestazione del pagamento:', err);
      await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
      delete ctx.session.paymentDisputeOfferId;
    }
    
    return;
  }
  
  // Controlla se stiamo aspettando un commento di feedback
  if (ctx.session.feedbackOfferId && ctx.session.feedbackType) {
    const offerId = ctx.session.feedbackOfferId;
    const feedbackType = ctx.session.feedbackType;
    const comment = ctx.message.text === 'nessuno' ? '' : ctx.message.text;
    
    try {
      const offer = await Offer.findById(offerId);
      if (!offer || offer.status !== 'completed') {
        await ctx.reply('❌ Questa ricarica non è più disponibile o non è nello stato corretto.');
        delete ctx.session.feedbackOfferId;
        delete ctx.session.feedbackType;
        return;
      }
      
      const user = await userService.registerUser(ctx.from);
      const isbuyer = user.userId === offer.buyerId;
      const feedbackRating = feedbackType === 'positive';
      
      // Aggiorna l'offerta con il feedback
      const updateData = isbuyer ? 
        { buyerFeedback: { rating: feedbackRating, comment: comment } } : 
        { sellerFeedback: { rating: feedbackRating, comment: comment } };
      
      await offerService.updateOfferStatus(offerId, 'completed', updateData);
      
      // Aggiorna le statistiche dell'altro utente
      const otherUserId = isbuyer ? offer.sellerId : offer.buyerId;
      await userService.updateUserFeedback(otherUserId, feedbackRating);
      
      // Notifica all'altro utente
      const otherUser = await User.findOne({ userId: otherUserId });
      const feedbackFrom = user.username ? '@' + user.username : user.firstName;
      const feedbackText = feedbackRating ? '👍 positivo' : '👎 negativo';
      
      const message = `
⭐ *Nuovo feedback ricevuto* ⭐

${feedbackFrom} ti ha lasciato un feedback ${feedbackText}${comment ? `:

"${comment}"` : '.'}

Il tuo punteggio di feedback è ora al ${otherUser.getPositivePercentage()}% positivo (${otherUser.positiveRatings}/${otherUser.totalRatings}).
`;
      
      await offerService.notifyUserAboutOfferUpdate(offer, otherUserId, message);
      
      await ctx.reply('✅ Grazie per aver lasciato il tuo feedback!');
      
      // Pulisci il contesto
      delete ctx.session.feedbackOfferId;
      delete ctx.session.feedbackType;
    } catch (err) {
      logger.error('Errore nel processare il commento del feedback:', err);
      await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
      delete ctx.session.feedbackOfferId;
      delete ctx.session.feedbackType;
    }
    
    return;
  }
  
  // Controlla se stiamo aspettando un motivo di annullamento
  if (ctx.session.cancelChargeOfferId) {
    const offerId = ctx.session.cancelChargeOfferId;
    const cancelReason = ctx.message.text;
    
    try {
      const offer = await Offer.findById(offerId);
      if (!offer || offer.status !== 'accepted') {
        await ctx.reply('❌ Questa ricarica non è più disponibile o non è nello stato corretto.');
        delete ctx.session.cancelChargeOfferId;
        return;
      }
      
      // Aggiorna lo stato dell'offerta
      await offerService.updateOfferStatus(offerId, 'cancelled', { rejectionReason: cancelReason });
      
      // Notifica al venditore
      const buyer = await User.findOne({ userId: offer.buyerId });
      const buyerName = buyer ? 
        (buyer.username ? '@' + buyer.username : buyer.firstName) : 
        'Acquirente';
      
      const message = `
❌ *Ricarica annullata* ❌

${buyerName} ha annullato la ricarica prevista per il ${moment(offer.date).format('DD/MM/YYYY')} alle ${offer.time}.

*Motivo:* ${cancelReason}
`;
      
      await offerService.notifyUserAboutOfferUpdate(offer, offer.sellerId, message);
      
      await ctx.reply('✅ Hai annullato la ricarica e il venditore è stato notificato.');
      
      // Pulisci il contesto
      delete ctx.session.cancelChargeOfferId;
    } catch (err) {
      logger.error('Errore nel processare il motivo dell\'annullamento:', err);
      await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
      delete ctx.session.cancelChargeOfferId;
    }
    
    return;
  }
  
  // Controlla se stiamo aspettando una quantità di donazione
  if (ctx.session.donateCustomOfferId) {
    const offerId = ctx.session.donateCustomOfferId;
    const kwhText = ctx.message.text;
    
    try {
      // Verifica che sia un numero valido
      const kwh = parseFloat(kwhText);
      if (isNaN(kwh) || kwh <= 0) {
        await ctx.reply('❌ Per favore, inserisci un numero valido maggiore di zero.');
        return;
      }
      
      const offer = await Offer.findById(offerId);
      if (!offer || offer.status !== 'completed') {
        await ctx.reply('❌ Questa ricarica non è più disponibile o non è nello stato corretto.');
        delete ctx.session.donateCustomOfferId;
        return;
      }
      
      // Se l'admin ID non è configurato, avvisa l'utente
      if (!ADMIN_USER_ID) {
        logger.error('ADMIN_USER_ID non configurato nelle variabili d\'ambiente');
        await ctx.reply('❌ Impossibile elaborare la donazione: configurazione amministratore mancante. Contatta il supporto.');
        delete ctx.session.donateCustomOfferId;
        return;
      }
      
      // Recupera gli utenti
      const seller = await User.findOne({ userId: offer.sellerId });
      
      // Verifica se l'utente admin esiste
      const adminExists = await User.findOne({ userId: ADMIN_USER_ID });
      if (!adminExists) {
        logger.warn(`Admin con ID ${ADMIN_USER_ID} non registrato nel sistema. Creazione account admin automatica.`);
        // Crea automaticamente l'account admin se non esiste
        const newAdmin = new User({
          userId: ADMIN_USER_ID,
          username: 'admin',
          firstName: 'Administrator',
          balance: 0
        });
        await newAdmin.save();
        logger.info(`Account admin creato automaticamente con ID ${ADMIN_USER_ID}`);
      }
      
      // Crea la donazione
      const donation = await paymentService.createDonation(seller.userId, ADMIN_USER_ID, kwh);
      
      // Notifica all'utente
      await ctx.reply(`🙏 *Grazie per la tua donazione di ${kwh} kWh!*\n\nIl tuo contributo aiuta a mantenere e migliorare il servizio.`, {
        parse_mode: 'Markdown'
      });
      
      // Notifica all'admin
      await paymentService.notifyAdminAboutDonation(donation, seller);
      
      // Pulisci il contesto
      delete ctx.session.donateCustomOfferId;
    } catch (err) {
      logger.error('Errore nel processare la quantità di donazione:', err);
      await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
      delete ctx.session.donateCustomOfferId;
    }
    
    return;
  }
  
  // Gestione delle date e tempi per la ricarica manuale
  if (ctx.session.manualChargeSellerId && !ctx.session.manualChargeDate) {
    try {
      const dateText = ctx.message.text;
      
      // Verifica che la data sia valida (formato DD/MM/YYYY)
      const dateRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
      if (!dateRegex.test(dateText)) {
        await ctx.reply('❌ Formato data non valido. Inserisci la data nel formato DD/MM/YYYY.');
        return;
      }
      
      // Memorizza la data
      ctx.session.manualChargeDate = dateText;
      
      // Chiedi l'ora
      await ctx.reply('2️⃣ *A che ora vorresti ricaricare?*\n\n_Inserisci l\'ora nel formato HH:MM, ad esempio 14:30_', {
        parse_mode: 'Markdown'
      });
    } catch (err) {
      logger.error('Errore nel processare la data della ricarica manuale:', err);
      await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
      delete ctx.session.manualChargeSellerId;
    }
    
    return;
  }
  
  if (ctx.session.manualChargeSellerId && ctx.session.manualChargeDate && !ctx.session.manualChargeTime) {
    try {
      const timeText = ctx.message.text;
      
      // Verifica che l'ora sia valida (formato HH:MM)
      const timeRegex = /^(\d{1,2}):(\d{2})$/;
      if (!timeRegex.test(timeText)) {
        await ctx.reply('❌ Formato ora non valido. Inserisci l\'ora nel formato HH:MM.');
        return;
      }
      
      // Memorizza l'ora
      ctx.session.manualChargeTime = timeText;
      
      // Chiedi il brand della colonnina
      await ctx.reply('3️⃣ *Quale brand di colonnina utilizzerai?*\n\n_Ad esempio: Enel X, A2A, Be Charge..._', {
        parse_mode: 'Markdown'
      });
    } catch (err) {
      logger.error('Errore nel processare l\'ora della ricarica manuale:', err);
      await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
      delete ctx.session.manualChargeSellerId;
      delete ctx.session.manualChargeDate;
    }
    
    return;
  }
  
  if (ctx.session.manualChargeSellerId && 
      ctx.session.manualChargeDate && 
      ctx.session.manualChargeTime && 
      !ctx.session.manualChargeBrand) {
    try {
      // Memorizza il brand
      ctx.session.manualChargeBrand = ctx.message.text;
      
      // Chiedi le coordinate
      await ctx.reply('4️⃣ *Inserisci le coordinate GPS della colonnina*\n\n_Nel formato numerico, ad esempio 41.87290, 12.47326_', {
        parse_mode: 'Markdown'
      });
    } catch (err) {
      logger.error('Errore nel processare il brand della ricarica manuale:', err);
      await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
      delete ctx.session.manualChargeSellerId;
      delete ctx.session.manualChargeDate;
      delete ctx.session.manualChargeTime;
    }
    
    return;
  }
  
  if (ctx.session.manualChargeSellerId && 
      ctx.session.manualChargeDate && 
      ctx.session.manualChargeTime && 
      ctx.session.manualChargeBrand && 
      !ctx.session.manualChargeCoordinates) {
    try {
      // Memorizza le coordinate
      ctx.session.manualChargeCoordinates = ctx.message.text;
      
      // Chiedi informazioni aggiuntive
      await ctx.reply('5️⃣ *Vuoi aggiungere altre informazioni per il venditore?*\n\n_Scrivi "nessuna" se non ce ne sono_', {
        parse_mode: 'Markdown'
      });
    } catch (err) {
      logger.error('Errore nel processare le coordinate della ricarica manuale:', err);
      await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
      delete ctx.session.manualChargeSellerId;
      delete ctx.session.manualChargeDate;
      delete ctx.session.manualChargeTime;
      delete ctx.session.manualChargeBrand;
    }
    
    return;
  }
  
  if (ctx.session.manualChargeSellerId && 
      ctx.session.manualChargeDate && 
      ctx.session.manualChargeTime && 
      ctx.session.manualChargeBrand && 
      ctx.session.manualChargeCoordinates && 
      !ctx.session.manualChargeInfo) {
    try {
      // Memorizza le informazioni aggiuntive
      ctx.session.manualChargeInfo = ctx.message.text === 'nessuna' ? '' : ctx.message.text;
      
      // Recupera gli utenti coinvolti
      const buyer = await userService.registerUser(ctx.from);
      const seller = await User.findOne({ userId: ctx.session.manualChargeSellerId });
      
      if (!seller) {
        await ctx.reply('❌ Venditore non trovato.');
        // Pulisci il contesto
        Object.keys(ctx.session).forEach(key => {
          if (key.startsWith('manualCharge')) {
            delete ctx.session[key];
          }
        });
        return;
      }
      
      // Prepara l'anteprima della richiesta con formattazione migliorata
      const previewText = `
🔋 *Richiesta di ricarica* 🔋

📅 *Data:* ${ctx.session.manualChargeDate}
🕙 *Ora:* ${ctx.session.manualChargeTime}
🏭 *Colonnina:* ${ctx.session.manualChargeBrand}
📍 *Posizione:* ${ctx.session.manualChargeCoordinates}
${ctx.session.manualChargeInfo ? `ℹ️ *Info aggiuntive:* ${ctx.session.manualChargeInfo}\n` : ''}

👤 *Venditore:* ${seller.username ? '@' + seller.username : seller.firstName}
`;
      
      await ctx.reply(`*Anteprima della tua richiesta:*\n\n${previewText}`, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Conferma e invia', callback_data: 'send_manual_request' },
              { text: '❌ Annulla', callback_data: 'cancel_manual_request' }
            ]
          ]
        }
      });
    } catch (err) {
      logger.error('Errore nel processare le informazioni aggiuntive della ricarica manuale:', err);
      await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
      // Pulisci il contesto
      Object.keys(ctx.session).forEach(key => {
        if (key.startsWith('manualCharge')) {
          delete ctx.session[key];
        }
      });
    }
    
    return;
  }
  
  // Passa al prossimo handler se questo non è rilevante
  return next();
};

/**
 * Gestore per i messaggi con foto
 * @param {Object} ctx - Contesto Telegraf
 */
const photoMessageHandler = async (ctx) => {
  // Controlla se stiamo aspettando una foto del display
  if (ctx.session.photoOfferId) {
    const offerId = ctx.session.photoOfferId;
    
    try {
      const offer = await Offer.findById(offerId);
      if (!offer || offer.status !== 'charging_completed') {
        await ctx.reply('❌ Questa ricarica non è più disponibile o non è nello stato corretto.');
        delete ctx.session.photoOfferId;
        return;
      }
      
      // Ottieni l'ID della foto (prendi la versione più grande)
      const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
      
      // Aggiorna l'offerta con l'ID della foto e lo stato
      await offerService.updateOfferStatus(offerId, 'kwh_confirmed', { chargerPhoto: photoId });
      
      // Notifica al venditore
      const buyer = await User.findOne({ userId: offer.buyerId });
      const buyerName = buyer ? 
        (buyer.username ? '@' + buyer.username : buyer.firstName) : 
        'Acquirente';
      
      // Invia la foto e i dettagli al venditore
      const message = `
🔋 *Ricarica completata* 🔋

${buyerName} ha terminato la ricarica e dichiara di aver caricato *${offer.kwhCharged} kWh*.

Controlla la foto del display e conferma o contesta i kWh dichiarati.
`;
      
      const keyboard = {
        inline_keyboard: [
          [
            { text: '✅ Confermo', callback_data: `confirm_kwh_${offerId}` },
            { text: '❌ Contesto', callback_data: `dispute_kwh_${offerId}` }
          ]
        ]
      };
      
      // Invia la foto con il messaggio
      await ctx.telegram.sendPhoto(offer.sellerId, photoId, {
        caption: message,
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
      
      await ctx.reply('✅ Foto e kWh inviati al venditore per la conferma. Attendi la sua risposta.');
      
      // Pulisci il contesto
      delete ctx.session.photoOfferId;
    } catch (err) {
      logger.error('Errore nel processare la foto:', err);
      await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
      delete ctx.session.photoOfferId;
    }
  }
};

/**
 * Applica tutti i middleware di base
 */
const applyBaseMiddleware = (bot) => {
  // Middleware base in ordine di priorità
  bot.use(sessionMiddleware());
  bot.use(userSessionMiddleware());
  bot.use(loggingMiddleware());
  bot.use(errorHandlingMiddleware());
  bot.use(rateLimitMiddleware());
  bot.use(blockCheckMiddleware());
  
  logger.info('Middleware di base applicati al bot');
};

/**
 * Applica middleware di sicurezza avanzata
 */
const applySecurityMiddleware = (bot, options = {}) => {
  bot.use(securityMiddlewareStack(options));
  logger.info('Middleware di sicurezza applicati al bot', options);
};

/**
 * Applica middleware per i gestori di contenuto
 */
const applyContentHandlers = (bot) => {
  // Gestori per diversi tipi di contenuto
  bot.on('message', topicMessageHandler);
  bot.on('text', textMessageHandler);
  bot.on('photo', photoMessageHandler);
  
  logger.info('Gestori di contenuto applicati al bot');
};

module.exports = {
  // Middleware individuali
  sessionMiddleware,
  userSessionMiddleware,
  loggingMiddleware,
  errorHandlingMiddleware,
  blockCheckMiddleware,
  adminMiddleware,
  rateLimitMiddleware,
  securityMiddlewareStack,
  
  // Gestori di contenuto
  topicMessageHandler,
  textMessageHandler,
  photoMessageHandler,
  
  // Funzioni di applicazione
  applyBaseMiddleware,
  applySecurityMiddleware,
  applyContentHandlers,
  
  // Mantenimento compatibilità con il nome precedente
  session: sessionMiddleware
};
