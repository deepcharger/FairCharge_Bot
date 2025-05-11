// Gestori delle callback per i bottoni inline
const { Markup } = require('telegraf');
const { bot, stage } = require('../config/bot');
const userService = require('../services/userService');
const announcementService = require('../services/announcementService');
const offerService = require('../services/offerService');
const paymentService = require('../services/paymentService');
const Announcement = require('../models/announcement');
const Offer = require('../models/offer');
const User = require('../models/user');
const moment = require('moment');
const logger = require('../utils/logger');

// Handler per selezionare il tipo di corrente
const connectorTypeCallback = async (ctx) => {
  // Estrai il tipo di corrente dal match
  const currentType = ctx.match[1];
  ctx.wizard.state.currentType = currentType;
  
  logger.debug(`Tipo di corrente selezionato: ${currentType} per utente ${ctx.from.id}`);
  await ctx.answerCbQuery(`Hai selezionato: ${currentType}`);
  
  let currentText;
  if (currentType === 'AC') {
    currentText = 'AC (corrente alternata)';
  } else if (currentType === 'DC') {
    currentText = 'DC (corrente continua)';
  } else if (currentType === 'both') {
    currentText = 'Entrambe (AC e DC)';
  }
  
  await ctx.reply(`✅ Tipo di corrente selezionato: *${currentText}*`, {
    parse_mode: 'Markdown'
  });
  await ctx.wizard.steps[2](ctx);
};

// Handler per pubblicare un annuncio di vendita
const publishSellCallback = async (ctx) => {
  try {
    await ctx.answerCbQuery('Pubblicazione in corso...');
    
    const user = await userService.registerUser(ctx.from);
    
    // Controlla se l'utente ha già un annuncio attivo
    const existingAnnouncement = await announcementService.getActiveAnnouncement(user.userId, 'sell');
    
    // Se esiste già un annuncio attivo, archivialo
    if (existingAnnouncement) {
      await announcementService.archiveAnnouncement(existingAnnouncement._id);
      await announcementService.updateUserActiveAnnouncement(user.userId, 'sell', null);
    }
    
    // Crea un nuovo annuncio
    const announcementData = {
      price: ctx.wizard.state.price,
      connectorType: ctx.wizard.state.currentType, // Usa currentType invece di connectorType
      brand: ctx.wizard.state.brand,
      location: ctx.wizard.state.location,
      nonActivatableBrands: ctx.wizard.state.nonActivatableBrands === 'nessuno' ? '' : ctx.wizard.state.nonActivatableBrands,
      additionalInfo: ctx.wizard.state.additionalInfo === 'nessuna' ? '' : ctx.wizard.state.additionalInfo
    };
    
    const newAnnouncement = await announcementService.createSellAnnouncement(announcementData, user.userId);
    
    // Pubblica l'annuncio nel topic
    await announcementService.publishAnnouncement(newAnnouncement, user);
    
    // Aggiorna l'utente con il riferimento al nuovo annuncio
    await announcementService.updateUserActiveAnnouncement(user.userId, 'sell', newAnnouncement._id);
    
    await ctx.reply('✅ *Il tuo annuncio è stato pubblicato con successo nel topic "Vendo kWh"!*', {
      parse_mode: 'Markdown'
    });
    
    return ctx.scene.leave();
  } catch (err) {
    console.error('Errore nella pubblicazione dell\'annuncio:', err);
    await ctx.reply('❌ Si è verificato un errore durante la pubblicazione. Per favore, riprova più tardi.');
    return ctx.scene.leave();
  }
};

// Handler per annullare la creazione di un annuncio
const cancelSellCallback = async (ctx) => {
  await ctx.answerCbQuery('Annuncio cancellato');
  await ctx.reply('❌ Creazione dell\'annuncio annullata.');
  return ctx.scene.leave();
};

// Handler per iniziare l'acquisto di kWh da un annuncio - Versione ultra-robusta
const buyKwhCallback = async (ctx) => {
  if (!ctx || !ctx.match || !ctx.match[1]) {
    console.error('Contesto incompleto nella buyKwhCallback');
    return;
  }
  
  const announcementId = ctx.match[1];
  
  try {
    // Verifica che ctx.from esista e abbia un id valido
    if (!ctx.from || !ctx.from.id) {
      console.error('ctx.from o ctx.from.id mancante in buyKwhCallback');
      return;
    }
    
    // Verifica se l'utente ha già avviato il bot in privato
    const user = await User.findOne({ userId: ctx.from.id });
    
    if (!user) {
      // Utente non ha mai avviato il bot, crea un deep link
      // Assicurati che il nome utente del bot venga recuperato correttamente
      let botUsername = '';
      try {
        // Prima prova a recuperare dal botInfo
        botUsername = bot.botInfo?.username;
        
        // Se non è disponibile, prova a ottenerlo dalle variabili d'ambiente
        if (!botUsername) {
          logger.info('botInfo.username non disponibile, utilizzo process.env.BOT_USERNAME');
          botUsername = process.env.BOT_USERNAME;
        }
        
        // Se ancora non disponibile, utilizza il valore corretto
        if (!botUsername) {
          logger.info('BOT_USERNAME non configurato, utilizzo valore hardcoded');
          botUsername = 'FairChargePro_Bot'; // Username corretto del bot
        }
      } catch (e) {
        logger.error('Errore nel recupero del nome utente del bot:', e);
        botUsername = 'FairChargePro_Bot'; // Username corretto del bot come fallback
      }
      
      logger.info(`Generazione deepLink con username: ${botUsername}`);
      const deepLink = `https://t.me/${botUsername}?start=buy_${announcementId}`;
      
      try {
        await ctx.answerCbQuery('Per procedere, avvia prima il bot in privato');
      } catch (e) {
        logger.error('Errore answerCbQuery:', e);
      }
      
      await ctx.reply('Per procedere con l\'acquisto, devi prima avviare il bot in chat privata.', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🚀 Avvia il bot', url: deepLink }]
          ]
        }
      });
      
      return;
    }
    
    // Utente già registrato, memorizza l'ID annuncio
    
    // Passa alla chat privata se siamo in un gruppo
    if (ctx.chat && ctx.chat.type !== 'private') {
      await ctx.answerCbQuery('Procedura di acquisto avviata');
      await ctx.reply(`📱 Per procedere con l'acquisto, ti invio un messaggio in privato.`);
      
      try {
        // Invia un messaggio in chat privata
        await bot.telegram.sendMessage(ctx.from.id, '🔋 *Procediamo con l\'acquisto kWh...*', {
          parse_mode: 'Markdown'
        });
        
        // Invia un secondo messaggio per avviare il wizard
        // Invece di usare la scena corrente, creiamo un comando speciale
        await bot.telegram.sendMessage(ctx.from.id, 
          `Per procedere con l'acquisto, usa il seguente comando:\n/inizia_acquisto_${announcementId}`, 
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔋 Procedi con l\'acquisto', callback_data: `start_buy_${announcementId}` }]
              ]
            }
          }
        );
      } catch (error) {
        // Questo errore si verifica se l'utente non ha ancora avviato il bot in privato
        logger.error('Errore nell\'invio del messaggio privato:', error);
        
        // Usa lo stesso approccio per generare il deeplink corretto
        let botUsername = '';
        try {
          botUsername = bot.botInfo?.username || process.env.BOT_USERNAME || 'FairChargePro_Bot';
        } catch (e) {
          botUsername = 'FairChargePro_Bot';
        }
        
        const deepLink = `https://t.me/${botUsername}?start=buy_${announcementId}`;
        
        await ctx.reply('Non riesco a inviarti un messaggio privato. Avvia prima il bot in chat privata.', {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🚀 Avvia il bot', url: deepLink }]
            ]
          }
        });
      }
      
      return;
    }
    
    // Se siamo già in chat privata
    await ctx.answerCbQuery('Procedura di acquisto avviata');
    
    // Memorizza l'ID dell'annuncio in una proprietà che verrà usata dalla scena
    ctx.session.announcementId = announcementId;
    
    // Entra nella scena
    return ctx.scene.enter('BUY_KWH_WIZARD');
  } catch (err) {
    logger.error('Errore nell\'avvio della procedura di acquisto:', err);
    try {
      await ctx.answerCbQuery('Si è verificato un errore');
    } catch (e) {
      logger.error('Errore in answerCbQuery:', e);
    }
    await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

// Nuova callback per avviare l'acquisto da chat privata
const startBuyCallback = async (ctx) => {
  if (!ctx || !ctx.match || !ctx.match[1]) {
    logger.error('Contesto incompleto nella startBuyCallback');
    return;
  }
  
  const announcementId = ctx.match[1];
  
  try {
    // Memorizza l'ID dell'annuncio in una proprietà che verrà usata dalla scena
    ctx.session.announcementId = announcementId;
    
    await ctx.answerCbQuery('Avvio procedura di acquisto...');
    
    // Entra nella scena
    return ctx.scene.enter('BUY_KWH_WIZARD');
  } catch (err) {
    logger.error('Errore nell\'avvio della procedura di acquisto da chat privata:', err);
    await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

// Handler per accettare le condizioni di acquisto
const acceptConditionsCallback = async (ctx) => {
  await ctx.answerCbQuery('Condizioni accettate');
  await ctx.reply('📅 *In quale data vorresti ricaricare?*\n\n_Inserisci la data nel formato DD/MM/YYYY, ad esempio 15/05/2023_', {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '❌ Annulla', callback_data: 'cancel_buy' }]
      ]
    }
  });
  ctx.wizard.next();
};

// Handler per annullare l'acquisto
const cancelBuyCallback = async (ctx) => {
  await ctx.answerCbQuery('Procedura annullata');
  await ctx.reply('❌ Procedura di acquisto annullata.');
  return ctx.scene.leave();
};

// Handler per inviare una richiesta di ricarica
const sendRequestCallback = async (ctx) => {
  try {
    await ctx.answerCbQuery('Invio richiesta in corso...');
    
    const buyer = await userService.registerUser(ctx.from);
    
    // Prepara i dati dell'offerta
    const offerData = {
      buyerId: buyer.userId,
      sellerId: ctx.wizard.state.seller.userId,
      date: ctx.wizard.state.date,
      time: ctx.wizard.state.time,
      brand: ctx.wizard.state.brand,
      coordinates: ctx.wizard.state.coordinates,
      additionalInfo: ctx.wizard.state.additionalInfo
    };
    
    // Crea la nuova offerta
    const newOffer = await offerService.createOffer(offerData, ctx.wizard.state.announcement._id);
    
    // Notifica il venditore
    await offerService.notifySellerAboutOffer(newOffer, buyer, ctx.wizard.state.announcement);
    
    await ctx.reply('✅ *La tua richiesta è stata inviata al venditore!*\n\nRiceverai una notifica quando risponderà.', {
      parse_mode: 'Markdown'
    });
    
    return ctx.scene.leave();
  } catch (err) {
    console.error('Errore nell\'invio della richiesta:', err);
    await ctx.reply('❌ Si è verificato un errore durante l\'invio della richiesta. Per favore, riprova più tardi.');
    return ctx.scene.leave();
  }
};

// Handler per accettare un'offerta di ricarica
const acceptOfferCallback = async (ctx) => {
  const offerId = ctx.match[1];
  
  try {
    await ctx.answerCbQuery('Elaborazione in corso...');
    
    // Aggiorna lo stato dell'offerta
    const offer = await offerService.updateOfferStatus(offerId, 'accepted');
    
    // Notifica all'acquirente
    const message = `
✅ *Ricarica accettata!* ✅

Il venditore ha accettato la tua richiesta di ricarica per il ${moment(offer.date).format('DD/MM/YYYY')} alle ${offer.time}.

Quando sarai vicino alla colonnina, usa il comando /le_mie_ricariche per avviare la procedura di ricarica.
`;
    
    await offerService.notifyUserAboutOfferUpdate(offer, offer.buyerId, message);
    
    await ctx.reply(`
✅ *Hai accettato la richiesta di ricarica* per il ${moment(offer.date).format('DD/MM/YYYY')} alle ${offer.time}.

Quando l'acquirente sarà pronto per ricaricare, riceverai una notifica.
`, {
      parse_mode: 'Markdown'
    });
  } catch (err) {
    console.error('Errore nell\'accettazione dell\'offerta:', err);
    await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

// Handler per rifiutare un'offerta di ricarica
const rejectOfferCallback = async (ctx) => {
  const offerId = ctx.match[1];
  
  try {
    await ctx.answerCbQuery('Richiesta rifiutata');
    
    // Chiedi il motivo del rifiuto
    await ctx.reply('📝 *Per quale motivo stai rifiutando questa richiesta?*', {
      parse_mode: 'Markdown',
      reply_markup: { force_reply: true }
    });
    
    // Salva l'ID dell'offerta in un contesto per l'handler successivo
    ctx.session.rejectOfferId = offerId;
  } catch (err) {
    console.error('Errore nel rifiuto dell\'offerta:', err);
    await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

// Handler per segnalare che l'acquirente è pronto per caricare
const readyToChargeCallback = async (ctx) => {
  const offerId = ctx.match[1];
  
  try {
    await ctx.answerCbQuery('Elaborazione in corso...');
    
    // Aggiorna lo stato dell'offerta
    const offer = await offerService.updateOfferStatus(offerId, 'ready_to_charge');
    
    // Chiedi informazioni sul connettore
    await ctx.reply('🔌 *Quale numero di connettore utilizzerai?*\n\n_Scrivi il numero o "altro" se non c\'è o se vuoi contattare direttamente il venditore_', {
      parse_mode: 'Markdown'
    });
    
    // Salva l'ID dell'offerta in un contesto per l'handler successivo
    ctx.session.connectorOfferId = offerId;
    
    // Notifica al venditore
    const buyer = await User.findOne({ userId: offer.buyerId });
    const buyerName = buyer ? 
      (buyer.username ? '@' + buyer.username : buyer.firstName) : 
      'Acquirente';
    
    const message = `
🔋 *L'acquirente è pronto per caricare!* 🔋

${buyerName} è arrivato alla colonnina e sta per iniziare la ricarica.
*Località:* ${offer.coordinates}
*Colonnina:* ${offer.brand}

Ti invierà a breve il numero del connettore.
`;
    
    await offerService.notifyUserAboutOfferUpdate(offer, offer.sellerId, message);
  } catch (err) {
    console.error('Errore nella segnalazione di prontezza:', err);
    await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

// Handler per segnalare che il venditore ha avviato la ricarica
const chargingStartedCallback = async (ctx) => {
  const offerId = ctx.match[1];
  
  try {
    await ctx.answerCbQuery('Elaborazione in corso...');
    
    // Aggiorna lo stato dell'offerta
    const offer = await offerService.updateOfferStatus(offerId, 'charging_started');
    
    // Notifica all'acquirente
    const message = `
▶️ *Il venditore ha avviato la ricarica!* ▶️

Verifica se la colonnina ha iniziato a caricare correttamente.
`;
    
    const keyboard = {
      inline_keyboard: [
        [
          { text: '✅ Ricarica partita', callback_data: `charging_ok_${offerId}` },
          { text: '❌ Problemi', callback_data: `charging_issues_${offerId}` }
        ]
      ]
    };
    
    await offerService.notifyUserAboutOfferUpdate(offer, offer.buyerId, message, keyboard);
    
    await ctx.reply('✅ *Hai segnalato di aver avviato la ricarica.*\n\nL\'acquirente confermerà se tutto funziona correttamente.', {
      parse_mode: 'Markdown'
    });
  } catch (err) {
    console.error('Errore nella segnalazione di avvio ricarica:', err);
    await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

// Handler per confermare che la ricarica è partita correttamente
const chargingOkCallback = async (ctx) => {
  const offerId = ctx.match[1];
  
  try {
    await ctx.answerCbQuery('Elaborazione in corso...');
    
    // Aggiorna lo stato dell'offerta
    const offer = await offerService.updateOfferStatus(offerId, 'charging');
    
    // Notifica al venditore
    const message = `
✅ *Ricarica confermata!* ✅

L'acquirente ha confermato che la ricarica è partita correttamente.
`;
    
    await offerService.notifyUserAboutOfferUpdate(offer, offer.sellerId, message);
    
    await ctx.reply('✅ *Hai confermato che la ricarica è partita correttamente.*\n\nQuando la ricarica sarà terminata, usa il comando /le_mie_ricariche per completare la procedura.', {
      parse_mode: 'Markdown'
    });
  } catch (err) {
    console.error('Errore nella conferma di ricarica ok:', err);
    await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

// Handler per segnalare problemi con la ricarica
const chargingIssuesCallback = async (ctx) => {
  const offerId = ctx.match[1];
  
  try {
    await ctx.answerCbQuery('Elaborazione in corso...');
    
    // Chiedi all'utente di specificare il problema
    await ctx.reply('⚠️ *Descrivi il problema che stai riscontrando con la ricarica:*', {
      parse_mode: 'Markdown',
      reply_markup: { force_reply: true }
    });
    
    // Salva l'ID dell'offerta in un contesto per l'handler successivo
    ctx.session.issueOfferId = offerId;
  } catch (err) {
    console.error('Errore nella segnalazione di problemi:', err);
    await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

// Handler per segnalare che la ricarica è completata
const chargingCompletedCallback = async (ctx) => {
  const offerId = ctx.match[1];
  
  try {
    await ctx.answerCbQuery('Elaborazione in corso...');
    
    const offer = await Offer.findById(offerId);
    if (!offer || offer.status !== 'charging') {
      await ctx.reply('❌ Questa ricarica non è disponibile o non è nello stato corretto.');
      return;
    }
    
    // Chiedi quanti kWh sono stati caricati
    await ctx.reply('⚡ *Quanti kWh hai caricato?*\n\n_Inserisci un numero, ad esempio 22.5_', {
      parse_mode: 'Markdown'
    });
    
    // Salva l'ID dell'offerta in un contesto per l'handler successivo
    ctx.session.completedOfferId = offerId;
  } catch (err) {
    console.error('Errore nella segnalazione di ricarica completata:', err);
    await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

// Handler per confermare i kWh dichiarati
const confirmKwhCallback = async (ctx) => {
  const offerId = ctx.match[1];
  
  try {
    await ctx.answerCbQuery('Elaborazione in corso...');
    
    const offer = await Offer.findById(offerId);
    if (!offer || offer.status !== 'kwh_confirmed') {
      await ctx.reply('❌ Questa ricarica non è più disponibile o non è nello stato corretto.');
      return;
    }
    
    // Richiedi al venditore di inserire il costo unitario per kWh
    await paymentService.requestUnitPriceFromSeller(offer);
    
    // Salva l'ID dell'offerta in un contesto per l'handler successivo
    ctx.session.paymentAmountOfferId = offerId;
  } catch (err) {
    console.error('Errore nella conferma dei kWh:', err);
    await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

// Handler per contestare i kWh dichiarati
const disputeKwhCallback = async (ctx) => {
  const offerId = ctx.match[1];
  
  try {
    await ctx.answerCbQuery('Elaborazione in corso...');
    
    // Chiedi il motivo della contestazione
    await ctx.reply('📝 *Per quale motivo contesti i kWh dichiarati?*\n\n_Specifica anche il valore corretto se lo conosci._', {
      parse_mode: 'Markdown'
    });
    
    // Salva l'ID dell'offerta in un contesto per l'handler successivo
    ctx.session.disputeKwhOfferId = offerId;
  } catch (err) {
    console.error('Errore nella contestazione dei kWh:', err);
    await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

// Handler per impostare il pagamento
const setPaymentCallback = async (ctx) => {
  const offerId = ctx.match[1];
  
  try {
    await ctx.answerCbQuery('Elaborazione in corso...');
    
    const offer = await Offer.findById(offerId);
    if (!offer || offer.status !== 'kwh_confirmed') {
      await ctx.reply('❌ Questa ricarica non è più disponibile o non è nello stato corretto.');
      return;
    }
    
    // Richiedi al venditore di inserire il costo unitario per kWh
    await ctx.reply(`⚡ *Inserisci il costo unitario per kWh*

L'acquirente ha dichiarato di aver caricato *${offer.kwhCharged} kWh*.

Per favore, inserisci il costo unitario per ogni kWh (esempio: 0.22 per 22 centesimi).
Il sistema calcolerà automaticamente l'importo totale da pagare.`, {
      parse_mode: 'Markdown'
    });
    
    // Salva l'ID dell'offerta in un contesto per l'handler successivo
    ctx.session.paymentAmountOfferId = offerId;
  } catch (err) {
    logger.error(`Errore nella richiesta di pagamento:`, err);
    await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

// Handler per verificare lo stato del pagamento
const verifyPaymentCallback = async (ctx) => {
  const offerId = ctx.match[1];
  
  try {
    await ctx.answerCbQuery('Verifica pagamento in corso...');
    
    const offer = await Offer.findById(offerId);
    if (!offer || offer.status !== 'payment_pending') {
      await ctx.reply('❌ Questa ricarica non è più disponibile o non è nello stato corretto.');
      return;
    }
    
    // Recupera l'acquirente
    const buyer = await User.findOne({ userId: offer.buyerId });
    const buyerName = buyer ? 
      (buyer.username ? '@' + buyer.username : buyer.firstName) : 
      'Acquirente';
    
    await ctx.reply(`
💰 *Verifica pagamento* 💰

${buyerName} deve ancora confermare di aver effettuato il pagamento di ${offer.totalAmount.toFixed(2)}€ per ${offer.kwhCharged} kWh.

Ti verrà inviata una notifica non appena l'acquirente confermerà il pagamento.
`, {
      parse_mode: 'Markdown'
    });
    
  } catch (err) {
    logger.error(`Errore nella verifica del pagamento per offerta ${offerId}:`, err);
    await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

// Handler per confermare e inviare la richiesta di pagamento
const confirmPaymentRequestCallback = async (ctx) => {
  try {
    // Formato: confirm_payment_OFFERID_TOTALAMOUNT
    const match = ctx.match[0].match(/confirm_payment_(.+)_(.+)/);
    if (!match) {
      await ctx.answerCbQuery('Formato callback non valido');
      return;
    }
    
    const offerId = match[1];
    const totalAmount = parseFloat(match[2]);
    
    if (isNaN(totalAmount) || totalAmount <= 0) {
      await ctx.answerCbQuery('Importo non valido');
      return;
    }
    
    await ctx.answerCbQuery('Invio richiesta di pagamento...');
    
    // Recupera l'offerta
    const offer = await Offer.findById(offerId);
    if (!offer || offer.status !== 'kwh_confirmed') {
      await ctx.reply('❌ Questa ricarica non è più disponibile o non è nello stato corretto.');
      return;
    }
    
    // Aggiorna l'offerta con l'importo totale e lo stato
    await offerService.updateOfferStatus(offerId, 'payment_pending', { totalAmount: totalAmount });
    
    // Recupera l'offerta aggiornata per avere il totalAmount salvato
    const updatedOffer = await Offer.findById(offerId);
    
    // Recupera l'acquirente
    const buyer = await User.findOne({ userId: updatedOffer.buyerId });
    
    // Gestisci il pagamento con saldo
    const paymentInfo = await paymentService.handlePaymentWithBalance(updatedOffer, buyer);
    
    // Invia la richiesta di pagamento all'acquirente
    await paymentService.sendPaymentRequest(updatedOffer, paymentInfo);
    
    await ctx.reply(`✅ Richiesta di pagamento di ${totalAmount.toFixed(2)}€ inviata all'acquirente. Riceverai una notifica quando effettuerà il pagamento.`);
  } catch (err) {
    logger.error(`Errore nella conferma della richiesta di pagamento:`, err);
    await ctx.answerCbQuery('Si è verificato un errore');
    await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

// Handler per annullare la richiesta di pagamento
const cancelPaymentRequestCallback = async (ctx) => {
  try {
    const offerId = ctx.match[1];
    
    await ctx.answerCbQuery('Richiesta di pagamento annullata');
    
    // Recupera l'offerta
    const offer = await Offer.findById(offerId);
    if (!offer || offer.status !== 'kwh_confirmed') {
      await ctx.reply('❌ Questa ricarica non è più disponibile o non è nello stato corretto.');
      return;
    }
    
    await ctx.reply('❌ Richiesta di pagamento annullata. Puoi inserire nuovamente il costo unitario per kWh quando sei pronto.');
    
    // Richiedi nuovamente il costo unitario
    await paymentService.requestUnitPriceFromSeller(offer);
  } catch (err) {
    logger.error(`Errore nell'annullamento della richiesta di pagamento:`, err);
    await ctx.answerCbQuery('Si è verificato un errore');
    await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

// Handler per segnalare che il pagamento è stato inviato
const paymentSentCallback = async (ctx) => {
  const offerId = ctx.match[1];
  
  try {
    await ctx.answerCbQuery('Elaborazione in corso...');
    
    const offer = await Offer.findById(offerId);
    if (!offer || offer.status !== 'payment_pending') {
      await ctx.reply('❌ Questa ricarica non è più disponibile o non è nello stato corretto.');
      return;
    }
    
    // Chiedi all'acquirente di specificare il metodo di pagamento
    await ctx.reply('💳 *Specifica il metodo di pagamento utilizzato e altri dettagli utili:*\n\n_Es: PayPal, Bonifico, Cripto, Revolut, ecc._', {
      parse_mode: 'Markdown'
    });
    
    // Salva l'ID dell'offerta in un contesto per l'handler successivo
    ctx.session.paymentMethodOfferId = offerId;
  } catch (err) {
    console.error('Errore nella segnalazione di pagamento inviato:', err);
    await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

// Handler per confermare la ricezione del pagamento
const paymentConfirmedCallback = async (ctx) => {
  const offerId = ctx.match[1];
  
  try {
    await ctx.answerCbQuery('Elaborazione in corso...');
    
    // Recupera l'offerta
    const offer = await Offer.findById(offerId);
    if (!offer || offer.status !== 'payment_sent') {
      await ctx.reply('❌ Questa ricarica non è più disponibile o non è nello stato corretto.');
      return;
    }
    
    // Aggiorna lo stato dell'offerta
    await offerService.updateOfferStatus(offerId, 'completed', { completedAt: new Date() });
    
    // Crea una nuova transazione
    const transaction = await paymentService.createTransaction(offer);
    
    // Recupera acquirente e venditore
    const buyer = await User.findOne({ userId: offer.buyerId });
    const seller = await User.findOne({ userId: offer.sellerId });
    
    // Gestisci il saldo dell'acquirente
    if (buyer) {
      await paymentService.handlePaymentWithBalance(offer, buyer);
    }
    
    // Notifica all'acquirente
    const buyerMessage = `
✅ *Transazione completata* ✅

Il venditore ha confermato di aver ricevuto il pagamento di ${offer.totalAmount.toFixed(2)}€ per ${offer.kwhCharged} kWh.

Grazie per aver utilizzato il nostro servizio! Per favore, lascia un feedback al venditore utilizzando il comando /le_mie_ricariche.
`;
    
    await offerService.notifyUserAboutOfferUpdate(offer, offer.buyerId, buyerMessage);
    
    // Richiedi al venditore di fare una donazione allo sviluppatore
    const adminId = 123456789; // Sostituisci con il tuo ID Telegram
    
    await ctx.reply(`
✅ *Transazione completata* ✅

Hai confermato di aver ricevuto il pagamento di ${offer.totalAmount.toFixed(2)}€ per ${offer.kwhCharged} kWh.

Grazie per aver utilizzato il nostro servizio! Per favore, lascia un feedback all'acquirente utilizzando il comando /le_mie_ricariche.

🙏 Ti piacerebbe fare una donazione allo sviluppatore del bot? Questo aiuta a mantenere e migliorare il servizio.
`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🎁 Dona 2 kWh', callback_data: `donate_2_${offerId}` },
            { text: '🎁 Altra quantità', callback_data: `donate_custom_${offerId}` }
          ],
          [{ text: '👍 No, grazie', callback_data: `donate_skip_${offerId}` }]
        ]
      }
    });
  } catch (err) {
    console.error('Errore nella conferma del pagamento:', err);
    await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

// Handler per segnalare mancata ricezione del pagamento
const paymentNotReceivedCallback = async (ctx) => {
  const offerId = ctx.match[1];
  
  try {
    await ctx.answerCbQuery('Elaborazione in corso...');
    
    // Chiedi il motivo della contestazione
    await ctx.reply('📝 *Specifica perché non hai ricevuto il pagamento o cosa c\'è di sbagliato:*', {
      parse_mode: 'Markdown'
    });
    
    // Salva l'ID dell'offerta in un contesto per l'handler successivo
    ctx.session.paymentDisputeOfferId = offerId;
  } catch (err) {
    console.error('Errore nella segnalazione di mancato pagamento:', err);
    await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

// Handler per lasciare un feedback positivo
const feedbackPositiveCallback = async (ctx) => {
  const offerId = ctx.match[1];
  
  try {
    await ctx.answerCbQuery('Elaborazione in corso...');
    
    // Chiedi un commento per il feedback
    await ctx.reply('🌟 *Grazie per il tuo feedback positivo!*\n\n_Vuoi aggiungere un breve commento? (o scrivi "nessuno" se preferisci non lasciare commenti)_', {
      parse_mode: 'Markdown'
    });
    
    // Salva l'ID dell'offerta e il tipo di feedback in un contesto per l'handler successivo
    ctx.session.feedbackOfferId = offerId;
    ctx.session.feedbackType = 'positive';
  } catch (err) {
    console.error('Errore nel feedback positivo:', err);
    await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

// Handler per lasciare un feedback negativo
const feedbackNegativeCallback = async (ctx) => {
  const offerId = ctx.match[1];
  
  try {
    await ctx.answerCbQuery('Elaborazione in corso...');
    
    // Chiedi un commento per il feedback
    await ctx.reply('😔 *Ci dispiace che la tua esperienza non sia stata positiva.*\n\n_Per favore, spiega brevemente cosa è andato storto:_', {
      parse_mode: 'Markdown'
    });
    
    // Salva l'ID dell'offerta e il tipo di feedback in un contesto per l'handler successivo
    ctx.session.feedbackOfferId = offerId;
    ctx.session.feedbackType = 'negative';
  } catch (err) {
    console.error('Errore nel feedback negativo:', err);
    await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

// Handler per annullare una carica
const cancelChargeCallback = async (ctx) => {
  const offerId = ctx.match[1];
  
  try {
    await ctx.answerCbQuery('Elaborazione in corso...');
    
    // Chiedi il motivo dell'annullamento
    await ctx.reply('📝 *Per quale motivo stai annullando questa ricarica?*', {
      parse_mode: 'Markdown'
    });
    
    // Salva l'ID dell'offerta in un contesto per l'handler successivo
    ctx.session.cancelChargeOfferId = offerId;
  } catch (err) {
    console.error('Errore nell\'annullamento della ricarica:', err);
    await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

// Handler per donare 2 kWh
const donateFixedCallback = async (ctx) => {
  const offerId = ctx.match[1];
  
  try {
    await ctx.answerCbQuery('Elaborazione in corso...');
    
    const offer = await Offer.findById(offerId);
    if (!offer || offer.status !== 'completed') {
      await ctx.reply('❌ Questa ricarica non è più disponibile o non è nello stato corretto.');
      return;
    }
    
    // Crea una nuova donazione
    const adminId = 123456789; // Sostituisci con il tuo ID Telegram
    
    // Recupera gli utenti
    const seller = await User.findOne({ userId: offer.sellerId });
    const admin = await User.findOne({ userId: adminId });
    
    // Crea la donazione
    const donation = await paymentService.createDonation(seller.userId, adminId, 2);
    
    // Notifica all'utente
    await ctx.reply('🙏 *Grazie per la tua donazione di 2 kWh!*\n\nIl tuo contributo aiuta a mantenere e migliorare il servizio.', {
      parse_mode: 'Markdown'
    });
    
    // Notifica all'admin
    await paymentService.notifyAdminAboutDonation(donation, seller);
  } catch (err) {
    console.error('Errore nella donazione:', err);
    await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

// Handler per donare una quantità personalizzata
const donateCustomCallback = async (ctx) => {
  const offerId = ctx.match[1];
  
  try {
    await ctx.answerCbQuery('Elaborazione in corso...');
    
    await ctx.reply('🎁 *Quanti kWh vorresti donare?*\n\n_Inserisci un numero, ad esempio 5_', {
      parse_mode: 'Markdown'
    });
    
    // Salva l'ID dell'offerta in un contesto per l'handler successivo
    ctx.session.donateCustomOfferId = offerId;
  } catch (err) {
    console.error('Errore nella richiesta di donazione personalizzata:', err);
    await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

// Handler per saltare la donazione
const donateSkipCallback = async (ctx) => {
  try {
    await ctx.answerCbQuery('Donazione saltata');
    await ctx.reply('👍 Nessun problema! Grazie per aver utilizzato il nostro servizio.');
  } catch (err) {
    console.error('Errore nel saltare la donazione:', err);
    await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

// Handler per inviare richiesta manuale di ricarica
const sendManualRequestCallback = async (ctx) => {
  try {
    await ctx.answerCbQuery('Invio richiesta in corso...');
    
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
    
    // Prepara i dati dell'offerta
    const offerData = {
      buyerId: buyer.userId,
      sellerId: seller.userId,
      date: ctx.session.manualChargeDate,
      time: ctx.session.manualChargeTime,
      brand: ctx.session.manualChargeBrand,
      coordinates: ctx.session.manualChargeCoordinates,
      additionalInfo: ctx.session.manualChargeInfo
    };
    
    // Crea una nuova offerta senza annuncio collegato
    const newOffer = await offerService.createOffer(offerData);
    
    // Notifica il venditore
    await offerService.notifySellerAboutOffer(newOffer, buyer);
    
    await ctx.reply('✅ *La tua richiesta è stata inviata al venditore!*\n\nRiceverai una notifica quando risponderà.', {
      parse_mode: 'Markdown'
    });
    
    // Pulisci il contesto
    Object.keys(ctx.session).forEach(key => {
      if (key.startsWith('manualCharge')) {
        delete ctx.session[key];
      }
    });
  } catch (err) {
    console.error('Errore nell\'invio della richiesta manuale:', err);
    await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
    // Pulisci il contesto
    Object.keys(ctx.session).forEach(key => {
      if (key.startsWith('manualCharge')) {
        delete ctx.session[key];
      }
    });
  }
};

// Handler per annullare la richiesta manuale
const cancelManualRequestCallback = async (ctx) => {
  try {
    await ctx.answerCbQuery('Richiesta annullata');
    await ctx.reply('❌ Richiesta annullata.');
    
    // Pulisci il contesto
    Object.keys(ctx.session).forEach(key => {
      if (key.startsWith('manualCharge')) {
        delete ctx.session[key];
      }
    });
  } catch (err) {
    console.error('Errore nell\'annullamento della richiesta manuale:', err);
    await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
    // Pulisci il contesto
    Object.keys(ctx.session).forEach(key => {
      if (key.startsWith('manualCharge')) {
        delete ctx.session[key];
      }
    });
  }
};

module.exports = {
  connectorTypeCallback,
  publishSellCallback,
  cancelSellCallback,
  buyKwhCallback,
  startBuyCallback,
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
  verifyPaymentCallback // Aggiunta la nuova callback
};
