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
    skipCommands = ['/help'] // Rimuovi /start dalla lista, lo gestiremo separatamente
  } = options;
  
  return async (ctx, next) => {
    // Salta i controlli per comandi specifici (NON include /start)
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
      
      // 4. Per tutti i comandi ECCETTO /start, verifica membership
      if (command !== '/start' && enforceGroupMembership) {
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
  
  // [... resto del codice per gli altri handler di testo ...]
  // Continua con gli altri handler esistenti per gestire tutti i casi
  
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
