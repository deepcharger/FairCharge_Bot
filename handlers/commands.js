// Gestori dei comandi principali del bot
const { Markup } = require('telegraf');
const userService = require('../services/userService');
const offerService = require('../services/offerService');
const announcementService = require('../services/announcementService');
const walletService = require('../services/walletService');
const { formatUserProfile, formatOfferListItem, formatWelcomeMessage, formatAdminHelpMessage } = require('../utils/formatters');
const User = require('../models/user');
const Offer = require('../models/offer');
const Announcement = require('../models/announcement');
const Transaction = require('../models/transaction');
const Donation = require('../models/donation');
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
        const isbuyer = user.userId === offer.buyerId;
        
        text += await formatOfferListItem(offer, i, otherUser, role) + '\n';
        
        logger.debug(`Dettagli offerta #${i + 1} ${offer._id}:`, {
          status: offer.status,
          isbuyer: isbuyer,
          buyerId: offer.buyerId,
          sellerId: offer.sellerId,
          userId: user.userId
        });
        
        // Invia i bottoni per questa offerta usando direttamente ctx.telegram.sendMessage
        // che è più affidabile per i bottoni rispetto a ctx.reply con Markup
        if (offer.status === 'accepted' && isbuyer) {
          // Bottoni per le offerte accettate (acquirente)
          logger.debug(`Inviando bottoni per offerta accettata ${offer._id} (acquirente)`);
          
          await ctx.telegram.sendMessage(
            ctx.chat.id,
            `Opzioni per ricarica #${i + 1}:`,
            {
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: '🔋 Sono pronto per caricare', callback_data: `ready_to_charge_${offer._id}` },
                    { text: '❌ Annulla', callback_data: `cancel_charge_${offer._id}` }
                  ]
                ]
              }
            }
          );
        } 
        else if (offer.status === 'ready_to_charge' && !isbuyer) {
          // Bottoni per le offerte pronte (venditore)
          logger.debug(`Inviando bottoni per offerta ready_to_charge ${offer._id} (venditore)`);
          
          await ctx.telegram.sendMessage(
            ctx.chat.id,
            `Opzioni per ricarica #${i + 1}:`,
            {
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: '▶️ Ho avviato la ricarica', callback_data: `charging_started_${offer._id}` }
                  ]
                ]
              }
            }
          );
        } 
        else if (offer.status === 'charging_started' && isbuyer) {
          // Bottoni per la ricarica iniziata (acquirente)
          logger.debug(`Inviando bottoni per offerta charging_started ${offer._id} (acquirente)`);
          
          await ctx.telegram.sendMessage(
            ctx.chat.id,
            `Opzioni per ricarica #${i + 1}:`,
            {
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: '✅ Ricarica partita', callback_data: `charging_ok_${offer._id}` },
                    { text: '❌ Problemi', callback_data: `charging_issues_${offer._id}` }
                  ]
                ]
              }
            }
          );
        } 
        else if (offer.status === 'charging' && isbuyer) {
          // Bottoni per la ricarica in corso (acquirente)
          logger.debug(`Inviando bottoni per offerta charging ${offer._id} (acquirente)`);
          
          await ctx.telegram.sendMessage(
            ctx.chat.id,
            `Opzioni per ricarica #${i + 1}:`,
            {
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: '🔋 Ho terminato la ricarica', callback_data: `charging_completed_${offer._id}` }
                  ]
                ]
              }
            }
          );
        } 
        else if (offer.status === 'kwh_confirmed' && !isbuyer) {
          // Bottoni per i kWh confermati (venditore)
          logger.debug(`Inviando bottoni per offerta kwh_confirmed ${offer._id} (venditore)`);
          
          await ctx.telegram.sendMessage(
            ctx.chat.id,
            `Opzioni per ricarica #${i + 1}:`,
            {
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: '💶 Inserisci importo da pagare', callback_data: `set_payment_${offer._id}` }
                  ]
                ]
              }
            }
          );
        } 
        else if (offer.status === 'payment_pending' && isbuyer) {
          // Bottoni per il pagamento in attesa (acquirente)
          logger.debug(`Inviando bottoni per offerta payment_pending ${offer._id} (acquirente)`);
          
          await ctx.telegram.sendMessage(
            ctx.chat.id,
            `Opzioni per ricarica #${i + 1}:`,
            {
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: '💸 Ho effettuato il pagamento', callback_data: `payment_sent_${offer._id}` }
                  ]
                ]
              }
            }
          );
        } 
        else if (offer.status === 'payment_sent' && !isbuyer) {
          // Bottoni per il pagamento inviato (venditore)
          logger.debug(`Inviando bottoni per offerta payment_sent ${offer._id} (venditore)`);
          
          await ctx.telegram.sendMessage(
            ctx.chat.id,
            `Opzioni per ricarica #${i + 1}:`,
            {
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: '✅ Confermo pagamento ricevuto', callback_data: `payment_confirmed_${offer._id}` },
                    { text: '❌ Non ho ricevuto', callback_data: `payment_not_received_${offer._id}` }
                  ]
                ]
              }
            }
          );
        } 
        // CORREZIONE: Aggiunto handler per payment_pending per il venditore
        else if (offer.status === 'payment_pending' && !isbuyer) {
          // Bottoni per il pagamento in attesa (venditore)
          logger.debug(`Inviando bottoni per offerta payment_pending ${offer._id} (venditore - in attesa di pagamento)`);
          
          await ctx.telegram.sendMessage(
            ctx.chat.id,
            `Opzioni per ricarica #${i + 1}:`,
            {
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: '💸 Verifica pagamento', callback_data: `verify_payment_${offer._id}` }
                  ]
                ]
              }
            }
          );
        }
        else if (offer.status === 'completed') {
          // Bottoni per il feedback (offerte completate)
          const hasGivenFeedback = isbuyer ? 
            offer.buyerFeedback && offer.buyerFeedback.rating !== undefined : 
            offer.sellerFeedback && offer.sellerFeedback.rating !== undefined;
          
          if (!hasGivenFeedback) {
            logger.debug(`Inviando bottoni per feedback offerta completed ${offer._id}`);
            
            await ctx.telegram.sendMessage(
              ctx.chat.id,
              `Opzioni per ricarica #${i + 1}:`,
              {
                reply_markup: {
                  inline_keyboard: [
                    [
                      { text: '👍 Positivo', callback_data: `feedback_positive_${offer._id}` },
                      { text: '👎 Negativo', callback_data: `feedback_negative_${offer._id}` }
                    ]
                  ]
                }
              }
            );
          }
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
    
    // Verifica se l'utente è un amministratore
    const isAdminUser = isAdmin(ctx.from.id);
    
    // Usa il messaggio di help appropriato
    const helpMessage = isAdminUser ? formatAdminHelpMessage() : formatWelcomeMessage();
    
    await ctx.reply(helpMessage, { parse_mode: 'HTML' });
    logger.debug(`Messaggio di aiuto (${isAdminUser ? 'admin' : 'utente'}) inviato a ${ctx.from.id}`);
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
      { command: 'portafoglio', description: 'Visualizza il tuo portafoglio' },
      { command: 'portafoglio_partner', description: 'Dettagli portafoglio con un partner' },
      { command: 'archivia_annuncio', description: 'Archivia il tuo annuncio attivo' },
      { command: 'annulla', description: 'Annulla la procedura in corso' }
    ];
    
    // Array dei comandi per amministratori
    const adminCommands = [
      ...userCommands,
      { command: 'avvio_ricarica', description: 'Avvia una ricarica usando il saldo (solo admin)' },
      { command: 'le_mie_donazioni', description: 'Visualizza le donazioni ricevute (solo admin)' },
      { command: 'portafoglio_venditore', description: 'Dettagli portafoglio con un venditore (solo admin)' },
      { command: 'update_commands', description: 'Aggiorna i comandi del bot (solo admin)' },
      { command: 'cancella_dati_utente', description: 'Cancella i dati di un utente (solo admin)' },
      { command: 'aggiungi_feedback', description: 'Aggiungi feedback a un utente (solo admin)' },
      { command: 'db_admin', description: 'Gestione database (solo admin)' },
      // Aggiungi i nuovi comandi admin
      { command: 'check_admin_config', description: 'Verifica configurazione admin (solo admin)' },
      { command: 'create_admin_account', description: 'Crea account admin (solo admin)' },
      { command: 'system_checkup', description: 'Controllo di sistema (solo admin)' }
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
    
    // Archivia l'annuncio 
    const archivedAnnouncement = await announcementService.archiveAnnouncement(activeAnnouncement._id);
    
    if (!archivedAnnouncement) {
      // Se l'annuncio non è stato trovato o c'è stato un errore nell'archiviazione
      logger.warn(`Annuncio ID ${activeAnnouncement._id} non trovato o errore nell'archiviazione`);
      
      // Aggiorna comunque il riferimento nell'utente per risolvere l'incoerenza
      await announcementService.updateUserActiveAnnouncement(user.userId, 'sell', null);
      
      await ctx.reply(`⚠️ Non è stato possibile trovare l'annuncio nel database, ma il riferimento è stato rimosso dal tuo profilo.`);
      return;
    }
    
    // Aggiorna il riferimento nell'utente
    await announcementService.updateUserActiveAnnouncement(user.userId, 'sell', null);
    
    await ctx.reply(`✅ Il tuo annuncio (ID: ${activeAnnouncement._id}) è stato archiviato con successo.`);
    
  } catch (err) {
    logger.error(`Errore nell'archiviazione dell'annuncio per l'utente ${ctx.from.id}:`, err);
    await ctx.reply('❌ Si è verificato un errore durante l\'archiviazione dell\'annuncio. Per favore, riprova più tardi.');
  }
};

/**
 * Gestisce il comando /portafoglio (per tutti gli utenti)
 * @param {Object} ctx - Contesto Telegraf
 */
const walletCommand = async (ctx) => {
  try {
    logger.info(`Comando /portafoglio ricevuto da ${ctx.from.id}`, {
      userId: ctx.from.id,
      username: ctx.from.username
    });
    
    // Recupera il riepilogo del portafoglio
    const walletService = require('../services/walletService');
    const walletSummary = await walletService.getUserWalletSummary(ctx.from.id);
    
    // Prepara il messaggio con le statistiche
    let message = `💼 <b>Il tuo portafoglio</b>\n\n`;
    
    // Riepilogo generale
    message += `<b>Riepilogo transazioni:</b>\n`;
    message += `- <b>kWh acquistati:</b> ${walletSummary.totals.totalKwhBought.toFixed(2)}\n`;
    message += `- <b>kWh venduti:</b> ${walletSummary.totals.totalKwhSold.toFixed(2)}\n`;
    message += `- <b>Spesa totale:</b> ${walletSummary.totals.amountSpent.toFixed(2)}€\n`;
    message += `- <b>Guadagno totale:</b> ${walletSummary.totals.amountEarned.toFixed(2)}€\n`;
    message += `- <b>Saldo attuale:</b> ${walletSummary.totals.currentBalance.toFixed(2)} kWh\n`;
    
    // Per l'admin, mostra anche i crediti donati
    if (isAdmin(ctx.from.id)) {
      message += `- <b>Crediti ricevuti disponibili:</b> ${walletSummary.totals.totalReceivedKwh.toFixed(2)} kWh\n`;
      message += `\n<i>Usa /le_mie_donazioni per vedere i dettagli dei crediti ricevuti</i>\n`;
    } 
    // Per i venditori, mostra i crediti donati all'admin
    else if (walletSummary.totals.totalDonatedKwh > 0) {
      message += `- <b>kWh donati all'admin:</b> ${walletSummary.totals.totalDonatedKwh.toFixed(2)}\n`;
    }
    
    // Resoconto transazioni
    message += `\n<b>Stato transazioni:</b>\n`;
    message += `- <b>Completate:</b> ${walletSummary.totals.successfulTransactions}\n`;
    message += `- <b>In corso:</b> ${walletSummary.totals.pendingTransactions}\n`;
    message += `- <b>Annullate:</b> ${walletSummary.totals.canceledTransactions}\n`;
    
    // Partners con cui si è interagito
    const partners = Object.values(walletSummary.partners);
    
    if (partners.length > 0) {
      message += `\n<b>I tuoi partner (${partners.length}):</b>\n`;
      
      // Mostra i primi 5 partner (ordinati per numero di transazioni)
      const topPartners = [...partners]
        .sort((a, b) => b.totalTransactions - a.totalTransactions)
        .slice(0, 5);
      
      for (const partner of topPartners) {
        const partnerName = partner.partnerInfo?.username 
          ? '@' + partner.partnerInfo.username 
          : (partner.partnerInfo?.firstName || `Partner ${partner.partnerId}`);
        
        message += `- <b>${partnerName}</b>: ${partner.totalTransactions} transazioni`;
        
        // Per l'admin mostra anche quanti crediti sono disponibili per ogni venditore
        if (isAdmin(ctx.from.id) && partner.donations && partner.donations.length > 0) {
          const availableCredits = partner.donations.reduce((total, d) => total + (d.isUsed ? 0 : d.kwhAmount), 0);
          if (availableCredits > 0) {
            message += `, ${availableCredits.toFixed(2)} kWh disponibili`;
          }
        }
        
        message += `\n`;
      }
      
      // Se ci sono più di 5 partner
      if (partners.length > 5) {
        message += `<i>...e altri ${partners.length - 5} partner</i>\n`;
      }
      
      // Aggiungere istruzioni per visualizzare i dettagli
      message += `\nPer vedere i dettagli di un partner specifico, usa:\n/portafoglio_partner ID_PARTNER`;
    } else {
      message += `\n<i>Non hai ancora interagito con altri utenti.</i>`;
    }
    
    await ctx.reply(message, { parse_mode: 'HTML' });
    
  } catch (err) {
    logger.error(`Errore nel recupero del portafoglio per utente ${ctx.from.id}:`, err);
    await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

/**
 * Gestisce il comando /portafoglio_partner (per tutti gli utenti)
 * @param {Object} ctx - Contesto Telegraf
 */
const partnerWalletCommand = async (ctx) => {
  try {
    logger.info(`Comando /portafoglio_partner ricevuto da ${ctx.from.id}`, {
      userId: ctx.from.id,
      username: ctx.from.username,
      text: ctx.message.text
    });
    
    // Estrai l'ID del partner
    const parts = ctx.message.text.split(' ');
    if (parts.length < 2) {
      await ctx.reply('⚠️ Formato corretto: /portafoglio_partner ID_PARTNER\n\nPer vedere l\'elenco dei partner, usa /portafoglio');
      return;
    }
    
    const partnerId = parseInt(parts[1]);
    if (isNaN(partnerId)) {
      await ctx.reply('❌ ID partner non valido. Deve essere un numero.');
      return;
    }
    
    // Recupera i dettagli del portafoglio con questo partner
    const walletService = require('../services/walletService');
    const detail = await walletService.getPartnerWalletDetail(ctx.from.id, partnerId);
    
    // Recupera info sul partner
    const User = require('../models/user');
    const partner = await User.findOne({ userId: partnerId });
    
    if (!partner) {
      await ctx.reply(`❌ Partner con ID ${partnerId} non trovato.`);
      return;
    }
    
    // Crea il messaggio con i dettagli
    let message = `📊 <b>Portafoglio con ${partner.username ? '@' + partner.username : partner.firstName}</b>\n\n`;
    
    // Statistiche principali
    message += `<b>Statistiche:</b>\n`;
    message += `- <b>kWh acquistati:</b> ${detail.partnerDetail.totalKwhBought.toFixed(2)}\n`;
    message += `- <b>kWh venduti:</b> ${detail.partnerDetail.totalKwhSold.toFixed(2)}\n`;
    message += `- <b>Spesa totale:</b> ${detail.partnerDetail.amountSpent.toFixed(2)}€\n`;
    message += `- <b>Guadagno totale:</b> ${detail.partnerDetail.amountEarned.toFixed(2)}€\n`;
    message += `- <b>Transazioni completate:</b> ${detail.partnerDetail.successfulTransactions}\n`;
    message += `- <b>Transazioni in corso:</b> ${detail.partnerDetail.pendingTransactions}\n`;
    
    // Se l'utente è l'admin e questo è un venditore, mostra le donazioni
    if (isAdmin(ctx.from.id) && detail.partnerDetail.donationsDetail) {
      const donationsDetail = detail.partnerDetail.donationsDetail;
      
      message += `\n<b>Riepilogo donazioni:</b>\n`;
      message += `- <b>Totale donato:</b> ${donationsDetail.totalDonations.toFixed(2)} kWh\n`;
      message += `- <b>Disponibili:</b> ${donationsDetail.availableDonations.toFixed(2)} kWh\n`;
      message += `- <b>Utilizzati:</b> ${donationsDetail.usedDonations.toFixed(2)} kWh\n`;
      
      if (donationsDetail.availableDonations > 0) {
        message += `\n✅ Hai ${donationsDetail.availableDonations.toFixed(2)} kWh disponibili per future ricariche con questo venditore.`;
      }
    }
    
    // Ultime transazioni
    if (detail.partnerDetail.transactions && detail.partnerDetail.transactions.length > 0) {
      message += `\n\n<b>Ultime transazioni:</b>\n`;
      
      // Mostra le ultime 3 transazioni
      const recentTransactions = detail.partnerDetail.transactions
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 3);
      
      for (const tx of recentTransactions) {
        const date = tx.createdAt.toLocaleDateString('it-IT');
        const isUserBuyer = tx.buyerId === ctx.from.id;
        const role = isUserBuyer ? "Acquisto" : "Vendita";
        
        message += `- ${date}: ${role} di ${tx.kwhAmount.toFixed(2)} kWh (${tx.totalAmount.toFixed(2)}€)\n`;
      }
      
      // Se ci sono più di 3 transazioni
      if (detail.partnerDetail.transactions.length > 3) {
        message += `<i>...e altre ${detail.partnerDetail.transactions.length - 3} transazioni</i>\n`;
      }
    } else {
      message += `\n<i>Non ci sono transazioni completate con questo partner</i>\n`;
    }
    
    // Offerte in corso
    const pendingOffers = detail.partnerDetail.offers.filter(o => 
      o.status !== 'completed' && 
      o.status !== 'cancelled' && 
      o.status !== 'rejected'
    );
    
    if (pendingOffers.length > 0) {
      message += `\n<b>Ricariche in corso:</b> ${pendingOffers.length}\n`;
      message += `<i>Usa /le_mie_ricariche per gestire le ricariche in corso</i>\n`;
    }
    
    await ctx.reply(message, { parse_mode: 'HTML' });
    
  } catch (err) {
    logger.error(`Errore nel recupero dei dettagli del portafoglio per utente ${ctx.from.id} con partner ${partnerId}:`, err);
    await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

/**
 * Gestisce il comando /le_mie_donazioni (solo per admin)
 * @param {Object} ctx - Contesto Telegraf
 */
const myDonationsCommand = async (ctx) => {
  try {
    logger.info(`Comando /le_mie_donazioni ricevuto da ${ctx.from.id}`, {
      userId: ctx.from.id,
      username: ctx.from.username
    });
    
    // Verifica che sia l'admin
    if (!isAdmin(ctx.from.id)) {
      await ctx.reply('❌ Solo l\'amministratore può usare questo comando.');
      return;
    }
    
    // Recupera le statistiche delle donazioni
    const walletService = require('../services/walletService');
    const stats = await walletService.getAdminDonationStats(ctx.from.id);
    
    if (stats.totalVendors === 0) {
      await ctx.reply('Non hai ancora ricevuto donazioni.');
      return;
    }
    
    // Crea il messaggio con le statistiche
    let message = `📊 <b>I tuoi crediti per venditore</b>\n\n`;
    message += `<b>Riepilogo totale:</b>\n`;
    message += `- <b>Crediti totali ricevuti:</b> ${stats.totalDonated.toFixed(2)} kWh\n`;
    message += `- <b>Crediti disponibili:</b> ${stats.totalAvailable.toFixed(2)} kWh\n`;
    message += `- <b>Crediti utilizzati:</b> ${stats.totalUsed.toFixed(2)} kWh\n`;
    message += `- <b>Venditori donatori:</b> ${stats.totalVendors}\n\n`;
    
    message += `<b>Dettaglio per venditore:</b>\n`;
    
    // Aggiungi dettagli per ogni venditore (massimo 10 per non superare i limiti di Telegram)
    const topVendors = stats.vendorSummary.slice(0, 10);
    
    for (const vendor of topVendors) {
      const vendorName = vendor.vendorInfo.username ? 
        '@' + vendor.vendorInfo.username : 
        vendor.vendorInfo.firstName;
      
      message += `\n<b>${vendorName}</b> (ID: ${vendor._id}):\n`;
      message += `- <b>Disponibili:</b> ${vendor.availableAmount.toFixed(2)} kWh\n`;
      message += `- <b>Utilizzati:</b> ${vendor.usedAmount.toFixed(2)} kWh\n`;
      message += `- <b>Totale donato:</b> ${vendor.totalDonated.toFixed(2)} kWh\n`;
      message += `- <b>Ultima donazione:</b> ${vendor.lastDonation.toLocaleDateString('it-IT')}\n`;
    }
    
    // Se ci sono più di 10 venditori, aggiungi una nota
    if (stats.vendorSummary.length > 10) {
      message += `\n<i>...e altri ${stats.vendorSummary.length - 10} venditori</i>`;
    }
    
    // Aggiungi note finali
    message += `\n\nPer vedere dettagli specifici su un venditore, usa:\n/portafoglio_venditore ID_VENDITORE`;
    
    await ctx.reply(message, { parse_mode: 'HTML' });
    
  } catch (err) {
    logger.error('Errore nel recupero delle donazioni:', err);
    await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
  }
};

/**
 * Gestisce il comando /portafoglio_venditore (solo per admin)
 * @param {Object} ctx - Contesto Telegraf
 */
const vendorWalletCommand = async (ctx) => {
  try {
    logger.info(`Comando /portafoglio_venditore ricevuto da ${ctx.from.id}`, {
      userId: ctx.from.id,
      username: ctx.from.username,
      text: ctx.message.text
    });
    
    // Verifica che sia l'admin
    if (!isAdmin(ctx.from.id)) {
      await ctx.reply('❌ Solo l\'amministratore può usare questo comando.');
      return;
    }
    
    // Estrai l'ID del venditore
    const parts = ctx.message.text.split(' ');
    if (parts.length < 2) {
      await ctx.reply('⚠️ Formato corretto: /portafoglio_venditore ID_VENDITORE\n\nPer vedere l\'elenco dei venditori, usa /le_mie_donazioni');
      return;
    }
    
    const vendorId = parseInt(parts[1]);
    if (isNaN(vendorId)) {
      await ctx.reply('❌ ID venditore non valido. Deve essere un numero.');
      return;
    }
    
    // Recupera i dettagli del portafoglio con questo venditore
    const walletService = require('../services/walletService');
    const detail = await walletService.getPartnerWalletDetail(ctx.from.id, vendorId);
    
    // Recupera info sul venditore
    const User = require('../models/user');
    const vendor = await User.findOne({ userId: vendorId });
    
    if (!vendor) {
      await ctx.reply(`❌ Venditore con ID ${vendorId} non trovato.`);
      return;
    }
    
    // Ottieni le donazioni
    const donationsDetail = detail.partnerDetail.donationsDetail;
    
    // Crea il messaggio con i dettagli
    let message = `📊 <b>Portafoglio con ${vendor.username ? '@' + vendor.username : vendor.firstName}</b>\n\n`;
    
    // Riepilogo transazioni
    message += `<b>Riepilogo transazioni:</b>\n`;
    message += `- <b>kWh acquistati:</b> ${detail.partnerDetail.totalKwhBought.toFixed(2)}\n`;
    message += `- <b>Importo speso:</b> ${detail.partnerDetail.amountSpent.toFixed(2)}€\n`;
    message += `- <b>Transazioni completate:</b> ${detail.partnerDetail.successfulTransactions}\n`;
    
    // Riepilogo donazioni
    message += `\n<b>Riepilogo donazioni:</b>\n`;
    message += `- <b>Totale donato:</b> ${donationsDetail.totalDonations.toFixed(2)} kWh\n`;
    message += `- <b>Disponibili:</b> ${donationsDetail.availableDonations.toFixed(2)} kWh\n`;
    message += `- <b>Utilizzati:</b> ${donationsDetail.usedDonations.toFixed(2)} kWh\n`;
    
    // Ultime donazioni disponibili
    if (donationsDetail.donationsList && donationsDetail.donationsList.length > 0) {
      message += `\n<b>Ultime donazioni disponibili:</b>\n`;
      
      // Mostra le ultime 5 donazioni disponibili
      const recentDonations = donationsDetail.donationsList
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 5);
      
      for (const donation of recentDonations) {
        const date = donation.createdAt.toLocaleDateString('it-IT');
        message += `- ${date}: ${donation.kwhAmount.toFixed(2)} kWh\n`;
      }
      
      // Se ci sono più di 5 donazioni, aggiungi una nota
      if (donationsDetail.donationsList.length > 5) {
        message += `\n<i>...e altre ${donationsDetail.donationsList.length - 5} donazioni</i>\n`;
      }
    } else {
      message += `\n<i>Non ci sono donazioni disponibili da questo venditore</i>\n`;
    }
    
    // Aggiungi info sul prossimo pagamento
    message += `\n<b>Informazioni pagamento:</b>\n`;
    if (donationsDetail.availableDonations > 0) {
      message += `✅ Hai ${donationsDetail.availableDonations.toFixed(2)} kWh disponibili per future ricariche con questo venditore.\n`;
      message += `Quando avvierai una ricarica con questo venditore, il sistema utilizzerà automaticamente questi kWh donati.`;
    } else {
      message += `❌ Non hai kWh disponibili da questo venditore. Dovrai pagare l'intero importo per le prossime ricariche.`;
    }
    
    await ctx.reply(message, { parse_mode: 'HTML' });
    
  } catch (err) {
    logger.error(`Errore nel recupero dei dettagli del portafoglio con venditore ${ctx.message?.text}:`, err);
    await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
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

/**
 * Gestisce il comando /db_admin per operazioni sul database
 * @param {Object} ctx - Contesto Telegraf
 */
const dbAdminCommand = async (ctx) => {
  try {
    logger.info(`Comando /db_admin ricevuto da ${ctx.from.id}`, {
      userId: ctx.from.id,
      username: ctx.from.username,
      messageText: ctx.message.text
    });
    
    // Verifica che l'utente sia l'admin
    if (!isAdmin(ctx.from.id)) {
      logger.warn(`Tentativo non autorizzato di usare /db_admin da parte di ${ctx.from.id}`);
      await ctx.reply('❌ Solo l\'amministratore può usare questo comando.');
      return;
    }
    
    // Estrai i parametri
    const text = ctx.message.text.split(' ');
    if (text.length < 2) {
      await ctx.reply(`
⚠️ Formato corretto: /db_admin <operazione> [opzioni]

Operazioni disponibili:
- reset_all: Resetta completamente il database
- reset_announcements: Cancella solo gli annunci
- reset_offers: Cancella solo le offerte
- reset_transactions: Cancella solo le transazioni
- cleanup_refs: Pulisce i riferimenti non validi
- check: Verifica la coerenza del database
- fix_user <userId>: Ripulisce i riferimenti di un utente specifico
- stats: Mostra statistiche del database
      `);
      return;
    }
    
    const operation = text[1].toLowerCase();
    
    // Gestione delle diverse operazioni
    switch (operation) {
      case 'reset_all':
        await resetAll(ctx);
        break;
      case 'reset_announcements':
        await resetAnnouncements(ctx);
        break;
      case 'reset_offers':
        await resetOffers(ctx);
        break;
      case 'reset_transactions':
        await resetTransactions(ctx);
        break;
      case 'cleanup_refs':
        await cleanupReferences(ctx);
        break;
      case 'check':
        await checkConsistency(ctx);
        break;
      case 'fix_user':
        if (text.length < 3) {
          await ctx.reply('⚠️ Specificare l\'ID utente: /db_admin fix_user <userId>');
          return;
        }
        await fixUser(ctx, text[2]);
        break;
      case 'stats':
        await showDatabaseStats(ctx);
        break;
      default:
        await ctx.reply('❌ Operazione non riconosciuta. Usa /db_admin per vedere le operazioni disponibili.');
    }
  } catch (err) {
    logger.error(`Errore nel comando db_admin per utente ${ctx.from.id}:`, err);
    await ctx.reply('❌ Si è verificato un errore durante l\'esecuzione del comando. Per favore, controlla i log per maggiori dettagli.');
  }
};

/**
 * Resetta completamente il database
 * @param {Object} ctx - Contesto Telegraf
 */
const resetAll = async (ctx) => {
  // Chiedi conferma
  await ctx.reply('⚠️ ATTENZIONE: Stai per cancellare TUTTI i dati del database. Questa operazione NON è reversibile!\n\nInvia "CONFERMA RESET TOTALE" per procedere.');
  
  // Imposta il flag di conferma nella sessione
  ctx.session.awaitingDbResetConfirmation = true;
};

/**
 * Resetta solo gli annunci
 * @param {Object} ctx - Contesto Telegraf
 */
const resetAnnouncements = async (ctx) => {
  await ctx.reply('🔄 Cancellazione annunci in corso...');
  
  // Conta gli annunci prima della cancellazione
  const countBefore = await Announcement.countDocuments();
  
  // Cancella tutti gli annunci
  await Announcement.deleteMany({});
  
  // Rimuovi i riferimenti agli annunci dagli utenti
  await User.updateMany({}, {
    $set: {
      'activeAnnouncements.sell': null,
      'activeAnnouncements.buy': null
    }
  });
  
  await ctx.reply(`✅ Operazione completata con successo!\n\nCancellati ${countBefore} annunci.\nRimossi i riferimenti dagli utenti.`);
};

/**
 * Resetta solo le offerte
 * @param {Object} ctx - Contesto Telegraf
 */
const resetOffers = async (ctx) => {
  await ctx.reply('🔄 Cancellazione offerte in corso...');
  
  // Conta le offerte prima della cancellazione
  const countBefore = await Offer.countDocuments();
  
  // Cancella tutte le offerte
  await Offer.deleteMany({});
  
  // Rimuovi i riferimenti alle offerte dagli annunci
  await Announcement.updateMany({}, {
    $set: {
      offers: []
    }
  });
  
  await ctx.reply(`✅ Operazione completata con successo!\n\nCancellate ${countBefore} offerte.\nRimossi i riferimenti dagli annunci.`);
};

/**
 * Resetta solo le transazioni
 * @param {Object} ctx - Contesto Telegraf
 */
const resetTransactions = async (ctx) => {
  await ctx.reply('🔄 Cancellazione transazioni in corso...');
  
  // Conta le transazioni prima della cancellazione
  const countBefore = await Transaction.countDocuments();
  
  // Cancella tutte le transazioni
  await Transaction.deleteMany({});
  
  // Rimuovi i riferimenti alle transazioni dagli utenti
  await User.updateMany({}, {
    $set: {
      transactions: []
    }
  });
  
  await ctx.reply(`✅ Operazione completata con successo!\n\nCancellate ${countBefore} transazioni.\nRimossi i riferimenti dagli utenti.`);
};

/**
 * Pulisce i riferimenti non validi nel database
 * @param {Object} ctx - Contesto Telegraf
 */
const cleanupReferences = async (ctx) => {
  await ctx.reply('🔄 Pulizia riferimenti non validi in corso...');
  
  let fixedCount = 0;
  
  // Controlla riferimenti agli annunci attivi negli utenti
  const users = await User.find({
    $or: [
      { 'activeAnnouncements.sell': { $ne: null } },
      { 'activeAnnouncements.buy': { $ne: null } }
    ]
  });
  
  for (const user of users) {
    let updated = false;
    
    // Controlla annuncio di vendita
    if (user.activeAnnouncements.sell) {
      const sellAnnouncement = await Announcement.findById(user.activeAnnouncements.sell);
      if (!sellAnnouncement || sellAnnouncement.status !== 'active') {
        user.activeAnnouncements.sell = null;
        updated = true;
        fixedCount++;
      }
    }
    
    // Controlla annuncio di acquisto
    if (user.activeAnnouncements.buy) {
      const buyAnnouncement = await Announcement.findById(user.activeAnnouncements.buy);
      if (!buyAnnouncement || buyAnnouncement.status !== 'active') {
        user.activeAnnouncements.buy = null;
        updated = true;
        fixedCount++;
      }
    }
    
    if (updated) {
      await user.save();
    }
  }
  
  // Controlla annunci che fanno riferimento a utenti inesistenti
  const announcements = await Announcement.find();
  let deletedAnnouncements = 0;
  
  for (const announcement of announcements) {
    const owner = await User.findOne({ userId: announcement.userId });
    if (!owner) {
      await Announcement.deleteOne({ _id: announcement._id });
      deletedAnnouncements++;
      fixedCount++;
    }
  }
  
  // Controlla offerte che fanno riferimento ad annunci inesistenti
  const offers = await Offer.find({ announcementId: { $ne: null } });
  let updatedOffers = 0;
  
  for (const offer of offers) {
    const announcement = await Announcement.findById(offer.announcementId);
    if (!announcement) {
      offer.announcementId = null;
      await offer.save();
      updatedOffers++;
      fixedCount++;
    }
  }
  
  await ctx.reply(`✅ Pulizia completata!\n\nRiferimenti corretti: ${fixedCount}\n- ${deletedAnnouncements} annunci eliminati\n- ${updatedOffers} offerte aggiornate\n- ${fixedCount - deletedAnnouncements - updatedOffers} riferimenti utenti corretti`);
};

/**
 * Verifica la coerenza del database
 * @param {Object} ctx - Contesto Telegraf
 */
const checkConsistency = async (ctx) => {
  await ctx.reply('🔍 Verifica della coerenza del database in corso...');
  
  let issues = 0;
  let report = '';
  
  // Verifica utenti con riferimenti a annunci inesistenti
  const usersWithInvalidAnnouncements = await User.find({
    $or: [
      { 'activeAnnouncements.sell': { $ne: null } },
      { 'activeAnnouncements.buy': { $ne: null } }
    ]
  });
  
  let invalidAnnouncementRefs = 0;
  
  for (const user of usersWithInvalidAnnouncements) {
    if (user.activeAnnouncements.sell) {
      const sellAnnouncement = await Announcement.findById(user.activeAnnouncements.sell);
      if (!sellAnnouncement || sellAnnouncement.status !== 'active') {
        invalidAnnouncementRefs++;
        issues++;
      }
    }
    
    if (user.activeAnnouncements.buy) {
      const buyAnnouncement = await Announcement.findById(user.activeAnnouncements.buy);
      if (!buyAnnouncement || buyAnnouncement.status !== 'active') {
        invalidAnnouncementRefs++;
        issues++;
      }
    }
  }
  
  report += `- Riferimenti a annunci non validi: ${invalidAnnouncementRefs}\n`;
  
  // Verifica annunci con riferimenti a utenti inesistenti
  const announcements = await Announcement.find();
  let announceWithInvalidUser = 0;
  
  for (const announcement of announcements) {
    const owner = await User.findOne({ userId: announcement.userId });
    if (!owner) {
      announceWithInvalidUser++;
      issues++;
    }
  }
  
  report += `- Annunci con riferimenti a utenti non validi: ${announceWithInvalidUser}\n`;
  
  // Verifica offerte con riferimenti a annunci inesistenti
  const offersWithInvalidAnnouncements = await Offer.find({ announcementId: { $ne: null } });
  let invalidOfferRefs = 0;
  
  for (const offer of offersWithInvalidAnnouncements) {
    const announcement = await Announcement.findById(offer.announcementId);
    if (!announcement) {
      invalidOfferRefs++;
      issues++;
    }
  }
  
  report += `- Offerte con riferimenti a annunci non validi: ${invalidOfferRefs}\n`;
  
  // Statistiche del database
  const userCount = await User.countDocuments();
  const announcementCount = await Announcement.countDocuments();
  const offerCount = await Offer.countDocuments();
  const transactionCount = await Transaction.countDocuments();
  
  const stats = `
📊 <b>Statistiche del database:</b>
- Utenti: ${userCount}
- Annunci: ${announcementCount}
- Offerte: ${offerCount}
- Transazioni: ${transactionCount}
`;
  
  if (issues === 0) {
    await ctx.reply(`✅ Nessun problema di coerenza trovato!\n\n${stats}`, { parse_mode: 'HTML' });
  } else {
    await ctx.reply(`⚠️ Trovati ${issues} problemi di coerenza:\n\n${report}\nPuoi risolvere questi problemi con /db_admin cleanup_refs\n\n${stats}`, { parse_mode: 'HTML' });
  }
};

/**
 * Corregge i riferimenti di un utente specifico
 * @param {Object} ctx - Contesto Telegraf
 * @param {String} userIdStr - ID dell'utente da correggere
 */
const fixUser = async (ctx, userIdStr) => {
  try {
    const userId = parseInt(userIdStr);
    
    if (isNaN(userId)) {
      await ctx.reply('❌ ID utente non valido. Deve essere un numero.');
      return;
    }
    
    // Trova l'utente
    const user = await User.findOne({ userId: userId });
    
    if (!user) {
      await ctx.reply(`❌ Utente con ID ${userId} non trovato.`);
      return;
    }
    
    await ctx.reply(`🔍 Analisi in corso per l'utente: ${user.username || user.firstName} (ID: ${userId})...`);
    
    // Verifica riferimenti agli annunci
    let updates = [];
    
    if (user.activeAnnouncements.sell) {
      const sellAnnouncement = await Announcement.findById(user.activeAnnouncements.sell);
      if (!sellAnnouncement || sellAnnouncement.status !== 'active') {
        user.activeAnnouncements.sell = null;
        updates.push('- Rimosso riferimento all\'annuncio di vendita');
      }
    }
    
    if (user.activeAnnouncements.buy) {
      const buyAnnouncement = await Announcement.findById(user.activeAnnouncements.buy);
      if (!buyAnnouncement || buyAnnouncement.status !== 'active') {
        user.activeAnnouncements.buy = null;
        updates.push('- Rimosso riferimento all\'annuncio di acquisto');
      }
    }
    
    if (updates.length > 0) {
      await user.save();
      await ctx.reply(`✅ Utente corretto con successo!\n\nModifiche effettuate:\n${updates.join('\n')}`);
    } else {
      await ctx.reply('✅ Nessun problema trovato per questo utente.');
    }
  } catch (err) {
    logger.error(`Errore nella correzione dell'utente:`, err);
    await ctx.reply('❌ Si è verificato un errore durante la correzione dell\'utente.');
  }
};

/**
 * Mostra le statistiche del database
 * @param {Object} ctx - Contesto Telegraf
 */
const showDatabaseStats = async (ctx) => {
  await ctx.reply('📊 Recupero statistiche in corso...');
  
  // Conteggi base
  const userCount = await User.countDocuments();
  const announcementCount = await Announcement.countDocuments();
  const offerCount = await Offer.countDocuments();
  const transactionCount = await Transaction.countDocuments();
  const donationCount = await Donation.countDocuments();
  
  // Conteggi dettagliati
  const activeAnnouncementCount = await Announcement.countDocuments({ status: 'active' });
  const archivedAnnouncementCount = await Announcement.countDocuments({ status: 'archived' });
  const sellAnnouncementCount = await Announcement.countDocuments({ type: 'sell' });
  const buyAnnouncementCount = await Announcement.countDocuments({ type: 'buy' });
  
  // Conteggi offerte per stato
  const pendingOfferCount = await Offer.countDocuments({ status: 'pending' });
  const acceptedOfferCount = await Offer.countDocuments({ status: 'accepted' });
  const completedOfferCount = await Offer.countDocuments({ status: 'completed' });
  const cancelledOfferCount = await Offer.countDocuments({ status: 'cancelled' });
  const disputedOfferCount = await Offer.countDocuments({ status: 'disputed' });
  
  // Invio delle statistiche
  await ctx.reply(`
📊 <b>Statistiche database</b>

<b>Panoramica:</b>
- Utenti: ${userCount}
- Annunci: ${announcementCount}
- Offerte: ${offerCount}
- Transazioni: ${transactionCount}
- Donazioni: ${donationCount}

<b>Dettaglio annunci:</b>
- Attivi: ${activeAnnouncementCount}
- Archiviati: ${archivedAnnouncementCount}
- Di vendita: ${sellAnnouncementCount}
- Di acquisto: ${buyAnnouncementCount}

<b>Dettaglio offerte:</b>
- In attesa: ${pendingOfferCount}
- Accettate: ${acceptedOfferCount}
- Completate: ${completedOfferCount}
- Annullate: ${cancelledOfferCount}
- Contestate: ${disputedOfferCount}
`, { parse_mode: 'HTML' });
};

/**
 * Handler per la conferma di reset del database
 * @param {Object} ctx - Contesto Telegraf
 * @returns {Boolean} True se il messaggio è stato gestito, false altrimenti
 */
const dbResetConfirmationHandler = async (ctx) => {
  // Verifica che ci sia un'attesa di conferma e che il messaggio corrisponda
  if (ctx.session && 
      ctx.session.awaitingDbResetConfirmation && 
      ctx.message && ctx.message.text === 'CONFERMA RESET TOTALE') {
    
    try {
      // Cancella la sessione
      delete ctx.session.awaitingDbResetConfirmation;
      
      // Verifica che sia l'admin
      if (!isAdmin(ctx.from.id)) {
        logger.warn(`Tentativo non autorizzato di confermare reset database da parte di ${ctx.from.id}`);
        await ctx.reply('❌ Solo l\'amministratore può eseguire questa operazione.');
        return true;
      }
      
      await ctx.reply('🔄 Reset del database in corso...');
      
      // Esegui le operazioni di reset
      await Announcement.deleteMany({});
      await Offer.deleteMany({});
      await Transaction.deleteMany({});
      await Donation.deleteMany({});
      
      // Aggiorna gli utenti
      await User.updateMany({}, {
        $set: {
          positiveRatings: 0,
          totalRatings: 0,
          balance: 0,
          activeAnnouncements: { sell: null, buy: null },
          transactions: []
        }
      });
      
      await ctx.reply('✅ Reset del database completato con successo!\n\nTutti i dati sono stati cancellati tranne i profili utente, che sono stati reimpostati (saldo, feedback e annunci attivi azzerati).');
      
      return true; // Impedisce che altri handler gestiscano questo messaggio
    } catch (err) {
      logger.error(`Errore nel reset del database:`, err);
      await ctx.reply('❌ Si è verificato un errore durante il reset del database. Per favore, controlla i log per maggiori dettagli.');
      return true; // Impedisce che altri handler gestiscano questo messaggio
    }
  }
  
  return false; // Permette ad altri handler di gestire questo messaggio
};

/**
 * Verifica e mostra le informazioni sulla configurazione admin (solo per admin)
 * @param {Object} ctx - Contesto Telegraf
 */
const checkAdminConfigCommand = async (ctx) => {
  try {
    logger.info(`Comando /check_admin_config ricevuto da ${ctx.from.id}`, {
      userId: ctx.from.id,
      username: ctx.from.username
    });
    
    // Verifica che l'utente sia l'admin
    if (!isAdmin(ctx.from.id)) {
      logger.warn(`Tentativo non autorizzato di usare /check_admin_config da parte di ${ctx.from.id}`);
      await ctx.reply('❌ Solo l\'amministratore può usare questo comando.');
      return;
    }
    
    // Recupera l'ID admin dalle configurazioni
    const adminId = ADMIN_USER_ID;
    
    // Cerca l'admin nel database
    const admin = await User.findOne({ userId: adminId });
    
    // Prepara il messaggio di risposta
    let responseMessage = `
📊 *Configurazione Admin*

Admin ID configurato: \`${adminId}\`
Admin trovato nel DB: ${admin ? '✅' : '❌'}
`;

    if (admin) {
      responseMessage += `
*Dettagli account admin:*
Username: ${admin.username ? '@' + admin.username : 'Non impostato'}
Nome: ${admin.firstName || 'Non impostato'}
Saldo: ${admin.balance.toFixed(2)} kWh
Registrato il: ${admin.registrationDate.toLocaleDateString('it-IT')}
`;
    } else {
      responseMessage += `
⚠️ *Admin non trovato nel database*
Se vuoi creare automaticamente l'account admin, usa il comando:
/create_admin_account
`;
    }
    
    await ctx.reply(responseMessage, {
      parse_mode: 'Markdown'
    });
    
  } catch (err) {
    logger.error('Errore nel comando check_admin_config:', err);
    await ctx.reply('❌ Si è verificato un errore durante la verifica della configurazione admin.');
  }
};

/**
 * Crea automaticamente l'account admin se non esiste (solo per admin)
 * @param {Object} ctx - Contesto Telegraf
 */
const createAdminAccountCommand = async (ctx) => {
  try {
    logger.info(`Comando /create_admin_account ricevuto da ${ctx.from.id}`, {
      userId: ctx.from.id,
      username: ctx.from.username
    });
    
    // Verifica che l'utente sia l'admin
    if (!isAdmin(ctx.from.id)) {
      logger.warn(`Tentativo non autorizzato di usare /create_admin_account da parte di ${ctx.from.id}`);
      await ctx.reply('❌ Solo l\'amministratore può usare questo comando.');
      return;
    }
    
    // Recupera l'ID admin dalle configurazioni
    const adminId = ADMIN_USER_ID;
    
    // Verifica che l'ID admin sia configurato
    if (!adminId) {
      await ctx.reply('❌ ID Admin non configurato nelle variabili d\'ambiente. Contatta lo sviluppatore.');
      return;
    }
    
    // Cerca l'admin nel database
    let admin = await User.findOne({ userId: adminId });
    
    // Se l'admin esiste già, informa l'utente
    if (admin) {
      await ctx.reply(`✅ Account admin già esistente (ID: ${adminId}).
      
Username: ${admin.username ? '@' + admin.username : 'Non impostato'}
Nome: ${admin.firstName || 'Non impostato'}
Saldo: ${admin.balance.toFixed(2)} kWh`);
      return;
    }
    
    // Crea l'account admin
    admin = new User({
      userId: adminId,
      username: ctx.from.username,
      firstName: 'Administrator',
      lastName: 'Bot',
      balance: 0,
      registrationDate: new Date(),
      positiveRatings: 0,
      totalRatings: 0
    });
    
    await admin.save();
    
    await ctx.reply(`✅ Account admin creato con successo!
    
ID: ${adminId}
Username: ${admin.username ? '@' + admin.username : 'Non impostato'}
Nome: ${admin.firstName} ${admin.lastName || ''}
Saldo: ${admin.balance.toFixed(2)} kWh`);
    
  } catch (err) {
    logger.error('Errore nel comando create_admin_account:', err);
    await ctx.reply('❌ Si è verificato un errore durante la creazione dell\'account admin.');
  }
};

/**
 * Verifica e aggiusta i problemi comuni nel sistema (solo per admin)
 * @param {Object} ctx - Contesto Telegraf
 */
const systemCheckupCommand = async (ctx) => {
  try {
    logger.info(`Comando /system_checkup ricevuto da ${ctx.from.id}`, {
      userId: ctx.from.id,
      username: ctx.from.username
    });
    
    // Verifica che l'utente sia l'admin
    if (!isAdmin(ctx.from.id)) {
      logger.warn(`Tentativo non autorizzato di usare /system_checkup da parte di ${ctx.from.id}`);
      await ctx.reply('❌ Solo l\'amministratore può usare questo comando.');
      return;
    }
    
    await ctx.reply('🔄 Avvio controllo di sistema...');
    
    // Messaggio iniziale
    let reportMsg = await ctx.reply('⏳ Controllo configurazione...');
    
    // 1. Verifica configurazione
    const adminId = ADMIN_USER_ID;
    let issues = 0;
    let fixes = 0;
    
    // Lista dei problemi trovati
    let problemsList = [];
    
    if (!adminId) {
      issues++;
      problemsList.push('❌ ID Admin non configurato nelle variabili d\'ambiente');
    }
    
    // Aggiorna il messaggio
    await bot.telegram.editMessageText(
      ctx.chat.id, 
      reportMsg.message_id, 
      undefined, 
      '⏳ Controllo account admin...'
    );
    
    // 2. Verifica account admin
    const admin = await User.findOne({ userId: adminId });
    
    if (!admin && adminId) {
      issues++;
      problemsList.push('❌ Account admin non trovato nel database');
      
      // Crea automaticamente l'account admin se non esiste
      try {
        const newAdmin = new User({
          userId: adminId,
          username: 'admin',
          firstName: 'Administrator',
          balance: 0,
          registrationDate: new Date()
        });
        
        await newAdmin.save();
        fixes++;
        problemsList.push('✅ Account admin creato automaticamente');
      } catch (err) {
        problemsList.push(`❌ Errore nella creazione dell'account admin: ${err.message}`);
      }
    }
    
    // Aggiorna il messaggio
    await bot.telegram.editMessageText(
      ctx.chat.id, 
      reportMsg.message_id, 
      undefined, 
      '⏳ Controllo integrità database...'
    );
    
    // 3. Verifica donazioni
    const donationsCount = await Donation.countDocuments({ adminId });
    
    // 4. Prepara il report finale
    let reportText = `
📊 *Report controllo di sistema*

Problemi trovati: ${issues}
Problemi risolti: ${fixes}
`;

    if (problemsList.length > 0) {
      reportText += `
*Dettagli:*
${problemsList.join('\n')}
`;
    }
    
    reportText += `
*Statistiche sistema:*
- Account admin: ${admin ? '✅' : '❌'}
${admin ? `- Saldo admin: ${admin.balance.toFixed(2)} kWh` : ''}
- Donazioni ricevute: ${donationsCount}

Sistema ${issues === 0 ? '✅ in buono stato' : issues === fixes ? '⚠️ riparato' : '❌ necessita attenzione'}
`;
    
    // Invia il report finale
    await bot.telegram.editMessageText(
      ctx.chat.id, 
      reportMsg.message_id, 
      undefined, 
      reportText,
      { parse_mode: 'Markdown' }
    );
    
  } catch (err) {
    logger.error('Errore nel comando system_checkup:', err);
    await ctx.reply('❌ Si è verificato un errore durante il controllo di sistema.');
  }
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
  deleteUserDataHandler,
  dbAdminCommand,
  dbResetConfirmationHandler,
  checkAdminConfigCommand,
  createAdminAccountCommand,
  systemCheckupCommand,
  walletCommand,
  partnerWalletCommand,
  myDonationsCommand,
  vendorWalletCommand
};
