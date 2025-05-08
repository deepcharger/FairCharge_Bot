// Middleware e gestori generici per il bot
const { session, Markup } = require('telegraf');
const { SELL_GROUPS_CONFIG, BUY_GROUPS_CONFIG } = require('../config/bot');
const userService = require('../services/userService');
const offerService = require('../services/offerService');
const paymentService = require('../services/paymentService');
const commands = require('../handlers/commands');
const Offer = require('../models/offer');
const User = require('../models/user');
const moment = require('moment');
const logger = require('../utils/logger');

/**
 * Middleware per la gestione della sessione
 * @returns {Function} Middleware per la sessione
 */
const sessionMiddleware = () => {
  return session();
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
    await ctx.reply(`⚠️ In questo topic può scrivere solo il bot. Contattami in privato: @${ctx.botInfo.username}`);
    
    // Aspetta 10 secondi e poi elimina entrambi i messaggi
    setTimeout(async () => {
      try {
        // Elimina il messaggio dell'utente
        await ctx.deleteMessage(ctx.message.message_id);
        
        // Elimina anche il messaggio di avviso del bot
        // Assumendo che ctx.message.reply sia il messaggio di avviso
        if (ctx.message.reply) {
          await ctx.deleteMessage(ctx.message.reply.message_id);
        }
      } catch (err) {
        console.error('Errore nell\'eliminazione dei messaggi:', err);
      }
    }, 10000);
  } catch (err) {
    console.error('Errore nella gestione del messaggio nel topic:', err);
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
❌ <b>Richiesta di ricarica rifiutata</b> ❌

Il venditore ha rifiutato la tua richiesta di ricarica per il ${moment(offer.date).format('DD/MM/YYYY')} alle ${offer.time}.

<b>Motivo:</b> ${rejectionReason}

Puoi cercare un altro venditore o riprovare più tardi.
`;
      
      await offerService.notifyUserAboutOfferUpdate(offer, offer.buyerId, message);
      
      await ctx.reply('✅ Hai rifiutato la richiesta e l\'acquirente è stato notificato.');
      
      // Pulisci il contesto
      delete ctx.session.rejectOfferId;
    } catch (err) {
      console.error('Errore nel processare il motivo del rifiuto:', err);
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
🔌 <b>Informazioni connettore</b> 🔌

L'acquirente utilizzerà il connettore: ${connectorInfo}

Puoi ora avviare la ricarica dalla tua app.
`;
      
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('▶️ Ho avviato la ricarica', `charging_started_${offerId}`)]
      ]);
      
      await offerService.notifyUserAboutOfferUpdate(offer, offer.sellerId, message, keyboard);
      
      await ctx.reply('✅ Informazioni sul connettore inviate al venditore. Attendi che avvii la ricarica.');
      
      // Pulisci il contesto
      delete ctx.session.connectorOfferId;
    } catch (err) {
      console.error('Errore nel processare il numero del connettore:', err);
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
⚠️ <b>Problema con la ricarica</b> ⚠️

${buyerName} ha riscontrato un problema con la ricarica:

"${issueDescription}"

Per favore, contattalo direttamente per risolvere il problema.
`;
      
      await offerService.notifyUserAboutOfferUpdate(offer, offer.sellerId, message);
      
      await ctx.reply(`✅ Problema segnalato al venditore. Ti consigliamo di contattarlo direttamente per risolvere il problema più rapidamente.`);
      
      // Pulisci il contesto
      delete ctx.session.issueOfferId;
    } catch (err) {
      console.error('Errore nel processare la descrizione del problema:', err);
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
      await ctx.reply('Per favore, invia una foto del display della colonnina dove si leggono i kWh caricati.');
      
      // Manteniamo l'ID dell'offerta nel contesto per l'handler della foto
      ctx.session.photoOfferId = offerId;
      delete ctx.session.completedOfferId;
    } catch (err) {
      console.error('Errore nel processare i kWh caricati:', err);
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
⚠️ <b>Contestazione kWh</b> ⚠️

Il venditore ha contestato i kWh dichiarati:

"${disputeReason}"

Per favore, verifica e rispondi usando il comando /le_mie_ricariche.
`;
      
      await offerService.notifyUserAboutOfferUpdate(offer, offer.buyerId, message);
      
      await ctx.reply('✅ Contestazione inviata all\'acquirente. Attendi la sua risposta.');
      
      // Pulisci il contesto
      delete ctx.session.disputeKwhOfferId;
    } catch (err) {
      console.error('Errore nel processare il motivo della contestazione:', err);
      await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
      delete ctx.session.disputeKwhOfferId;
    }
    
    return;
  }
  
  // Controlla se stiamo aspettando l'importo da pagare
  if (ctx.session.paymentAmountOfferId) {
    const offerId = ctx.session.paymentAmountOfferId;
    const amountText = ctx.message.text;
    
    try {
      // Verifica che sia un numero valido
      const amount = parseFloat(amountText);
      if (isNaN(amount) || amount <= 0) {
        await ctx.reply('❌ Per favore, inserisci un importo valido maggiore di zero.');
        return;
      }
      
      const offer = await Offer.findById(offerId);
      if (!offer || offer.status !== 'kwh_confirmed') {
        await ctx.reply('❌ Questa ricarica non è più disponibile o non è nello stato corretto.');
        delete ctx.session.paymentAmountOfferId;
        return;
      }
      
      // Aggiorna l'offerta con l'importo totale e lo stato
      await offerService.updateOfferStatus(offerId, 'payment_pending', { totalAmount: amount });
      
      // Recupera l'acquirente
      const buyer = await User.findOne({ userId: offer.buyerId });
      
      // Gestisci il pagamento con saldo
      const paymentInfo = await paymentService.handlePaymentWithBalance(offer, buyer);
      
      // Invia la richiesta di pagamento all'acquirente
      await paymentService.sendPaymentRequest(offer, paymentInfo);
      
      await ctx.reply(`✅ Richiesta di pagamento di ${amount.toFixed(2)}€ inviata all'acquirente. Riceverai una notifica quando effettuerà il pagamento.`);
      
      // Pulisci il contesto
      delete ctx.session.paymentAmountOfferId;
    } catch (err) {
      console.error('Errore nel processare l\'importo da pagare:', err);
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
💸 <b>Pagamento effettuato</b> 💸

${buyerName} dichiara di aver effettuato il pagamento di ${offer.totalAmount.toFixed(2)}€ per ${offer.kwhCharged} kWh.

<b>Dettagli pagamento:</b> 
${paymentDetails}

Per favore, verifica di aver ricevuto il pagamento e conferma.
`;
      
      const keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ Confermo pagamento ricevuto', `payment_confirmed_${offerId}`),
          Markup.button.callback('❌ Non ho ricevuto', `payment_not_received_${offerId}`)
        ]
      ]);
      
      await offerService.notifyUserAboutOfferUpdate(offer, offer.sellerId, message, keyboard);
      
      await ctx.reply('✅ Hai segnalato di aver effettuato il pagamento. Attendi la conferma del venditore.');
      
      // Pulisci il contesto
      delete ctx.session.paymentMethodOfferId;
    } catch (err) {
      console.error('Errore nel processare il metodo di pagamento:', err);
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
⚠️ <b>Contestazione pagamento</b> ⚠️

Il venditore non ha ricevuto il pagamento o ha riscontrato un problema:

"${disputeReason}"

Per favore, verifica e contatta direttamente il venditore per risolvere il problema.
`;
      
      await offerService.notifyUserAboutOfferUpdate(offer, offer.buyerId, message);
      
      await ctx.reply('✅ Contestazione inviata all\'acquirente. Ti consigliamo di contattarlo direttamente per risolvere il problema più rapidamente.');
      
      // Pulisci il contesto
      delete ctx.session.paymentDisputeOfferId;
    } catch (err) {
      console.error('Errore nel processare il motivo della contestazione del pagamento:', err);
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
⭐ <b>Nuovo feedback ricevuto</b> ⭐

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
      console.error('Errore nel processare il commento del feedback:', err);
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
❌ <b>Ricarica annullata</b> ❌

${buyerName} ha annullato la ricarica prevista per il ${moment(offer.date).format('DD/MM/YYYY')} alle ${offer.time}.

<b>Motivo:</b> ${cancelReason}
`;
      
      await offerService.notifyUserAboutOfferUpdate(offer, offer.sellerId, message);
      
      await ctx.reply('✅ Hai annullato la ricarica e il venditore è stato notificato.');
      
      // Pulisci il contesto
      delete ctx.session.cancelChargeOfferId;
    } catch (err) {
      console.error('Errore nel processare il motivo dell\'annullamento:', err);
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
      
      // Recupera gli utenti
      const seller = await User.findOne({ userId: offer.sellerId });
      const adminId = require('../config/admin').ADMIN_USER_ID;
      
      // Crea la donazione
      const donation = await paymentService.createDonation(seller.userId, adminId, kwh);
      
      // Notifica all'utente
      await ctx.reply(`🙏 Grazie per la tua donazione di ${kwh} kWh! Il tuo contributo aiuta a mantenere e migliorare il servizio.`);
      
      // Notifica all'admin
      await paymentService.notifyAdminAboutDonation(donation, seller);
      
      // Pulisci il contesto
      delete ctx.session.donateCustomOfferId;
    } catch (err) {
      console.error('Errore nel processare la quantità di donazione:', err);
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
      await ctx.reply('2️⃣ A che ora vorresti ricaricare? (Inserisci l\'ora nel formato HH:MM, ad esempio 14:30)');
    } catch (err) {
      console.error('Errore nel processare la data della ricarica manuale:', err);
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
      await ctx.reply('3️⃣ Quale brand di colonnina utilizzerai? (ad esempio Enel X, A2A, Be Charge...)');
    } catch (err) {
      console.error('Errore nel processare l\'ora della ricarica manuale:', err);
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
      await ctx.reply('4️⃣ Inserisci le coordinate GPS della colonnina (nel formato numerico, ad esempio 41.87290, 12.47326)');
    } catch (err) {
      console.error('Errore nel processare il brand della ricarica manuale:', err);
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
      await ctx.reply('5️⃣ Vuoi aggiungere altre informazioni per il venditore? (Scrivi "nessuna" se non ce ne sono)');
    } catch (err) {
      console.error('Errore nel processare le coordinate della ricarica manuale:', err);
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
      
      // Prepara l'anteprima della richiesta
      const previewText = `
🔋 <b>Richiesta di ricarica</b> 🔋

📅 <b>Data:</b> ${ctx.session.manualChargeDate}
🕙 <b>Ora:</b> ${ctx.session.manualChargeTime}
🏭 <b>Colonnina:</b> ${ctx.session.manualChargeBrand}
📍 <b>Posizione:</b> ${ctx.session.manualChargeCoordinates}
${ctx.session.manualChargeInfo ? `ℹ️ <b>Info aggiuntive:</b> ${ctx.session.manualChargeInfo}\n` : ''}

👤 <b>Venditore:</b> ${seller.username ? '@' + seller.username : seller.firstName}
`;
      
      await ctx.reply(`<b>Anteprima della tua richiesta:</b>\n\n${previewText}`, {
        parse_mode: 'HTML',
        reply_markup: Markup.inlineKeyboard([
          [
            Markup.button.callback('✅ Conferma e invia', 'send_manual_request'),
            Markup.button.callback('❌ Annulla', 'cancel_manual_request')
          ]
        ])
      });
    } catch (err) {
      console.error('Errore nel processare le informazioni aggiuntive della ricarica manuale:', err);
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
🔋 <b>Ricarica completata</b> 🔋

${buyerName} ha terminato la ricarica e dichiara di aver caricato <b>${offer.kwhCharged} kWh</b>.

Controlla la foto del display e conferma o contesta i kWh dichiarati.
`;
      
      const keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ Confermo', `confirm_kwh_${offerId}`),
          Markup.button.callback('❌ Contesto', `dispute_kwh_${offerId}`)
        ]
      ]);
      
      // Invia la foto con il messaggio
      await ctx.telegram.sendPhoto(offer.sellerId, photoId, {
        caption: message,
        parse_mode: 'HTML',
        reply_markup: keyboard
      });
      
      await ctx.reply('✅ Foto e kWh inviati al venditore per la conferma. Attendi la sua risposta.');
      
      // Pulisci il contesto
      delete ctx.session.photoOfferId;
    } catch (err) {
      console.error('Errore nel processare la foto:', err);
      await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
      delete ctx.session.photoOfferId;
    }
  }
};

module.exports = {
  session: sessionMiddleware,
  topicMessageHandler,
  textMessageHandler,
  photoMessageHandler
};
