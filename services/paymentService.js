// Servizio per la gestione dei pagamenti e delle transazioni
const Transaction = require('../models/transaction');
const User = require('../models/user');
const Donation = require('../models/donation');
const Offer = require('../models/offer');
const { bot } = require('../config/bot');
const { Markup } = require('telegraf');
const logger = require('../utils/logger');
const { isAdmin, ADMIN_USER_ID } = require('../config/admin');

/**
 * Crea una nuova transazione
 * @param {Object} offer - L'offerta completata
 * @returns {Promise<Object>} La nuova transazione
 */
const createTransaction = async (offer) => {
  try {
    logger.info(`Creazione transazione per offerta ${offer._id}`, {
      offerId: offer._id,
      sellerId: offer.sellerId,
      buyerId: offer.buyerId,
      kwhAmount: offer.kwhCharged,
      totalAmount: offer.totalAmount
    });
    
    // Crea una nuova transazione
    const transaction = new Transaction({
      offerId: offer._id,
      sellerId: offer.sellerId,
      buyerId: offer.buyerId,
      kwhAmount: offer.kwhCharged,
      price: offer.totalAmount / offer.kwhCharged, // Prezzo unitario per kWh
      totalAmount: offer.totalAmount,
      paymentMethod: offer.paymentMethod,
      status: 'completed'
    });
    
    await transaction.save();
    logger.debug(`Transazione creata con ID: ${transaction._id}`);
    
    // Aggiorna i riferimenti negli utenti
    const buyer = await User.findOne({ userId: offer.buyerId });
    const seller = await User.findOne({ userId: offer.sellerId });
    
    if (buyer) {
      buyer.transactions.push(transaction._id);
      await buyer.save();
      logger.debug(`Transazione ${transaction._id} aggiunta all'acquirente ${buyer.userId}`);
    } else {
      logger.warn(`Acquirente ${offer.buyerId} non trovato durante la creazione della transazione`);
    }
    
    if (seller) {
      seller.transactions.push(transaction._id);
      await seller.save();
      logger.debug(`Transazione ${transaction._id} aggiunta al venditore ${seller.userId}`);
    } else {
      logger.warn(`Venditore ${offer.sellerId} non trovato durante la creazione della transazione`);
    }
    
    return transaction;
  } catch (err) {
    logger.error(`Errore nella creazione della transazione per offerta ${offer._id}:`, err);
    throw err;
  }
};

/**
 * Gestisce il pagamento utilizzando il saldo dell'utente o le donazioni se è l'admin
 * @param {Object} offer - L'offerta da pagare
 * @param {Object} buyer - L'acquirente
 * @returns {Promise<Object>} Oggetto con informazioni sul pagamento
 */
const handlePaymentWithBalance = async (offer, buyer) => {
  try {
    // Verifica che l'offerta abbia totalAmount definito
    if (typeof offer.totalAmount === 'undefined' || offer.totalAmount === null) {
      logger.debug(`Nessun totalAmount definito per offerta ${offer._id}, pagamento completo richiesto`);
      return {
        originalAmount: 0,
        balanceUsed: 0,
        amountToPay: 0,
        remainingBalance: buyer.balance,
        donationsUsed: []
      };
    }
    
    // Verifica se l'acquirente è l'admin
    const { isAdmin } = require('../config/admin');
    const isAdminBuyer = isAdmin(buyer.userId);
    
    logger.info(`Gestione pagamento per offerta ${offer._id}`, {
      offerId: offer._id,
      buyerId: buyer.userId,
      isAdmin: isAdminBuyer,
      totalAmount: offer.totalAmount,
      kwhAmount: offer.kwhCharged
    });
    
    // Se è l'admin, usiamo le donazioni da questo venditore specifico
    if (isAdminBuyer) {
      // Trova le donazioni non utilizzate provenienti dal venditore specifico
      const availableDonations = await Donation.findAvailableFromVendor(buyer.userId, offer.sellerId);
      
      // Calcola i kWh totali disponibili per questo venditore
      let availableKwh = 0;
      for (const donation of availableDonations) {
        availableKwh += donation.kwhAmount;
      }
      
      logger.debug(`Amministratore ha ${availableKwh} kWh disponibili donati dal venditore ${offer.sellerId}`);
      
      // Utilizza i kWh donati fino a esaurimento
      let kwhRemaining = offer.kwhCharged;
      let donationsUsed = [];
      
      for (const donation of availableDonations) {
        if (kwhRemaining <= 0) break;
        
        // Quanto possiamo usare da questa donazione
        const kwhToUse = Math.min(donation.kwhAmount, kwhRemaining);
        
        if (kwhToUse > 0) {
          // Aggiorna kwhRemaining
          kwhRemaining -= kwhToUse;
          
          // Se usiamo tutta la donazione
          if (kwhToUse === donation.kwhAmount) {
            donation.isUsed = true;
            donation.usedInOfferId = offer._id;
            await donation.save();
            donationsUsed.push(donation);
          } 
          // Se usiamo solo parte della donazione
          else if (kwhToUse < donation.kwhAmount) {
            // Marca questa donazione come parzialmente usata
            donation.kwhAmount -= kwhToUse;
            await donation.save();
            
            // Crea una nuova donazione "usata" per la parte consumata
            const usedDonation = new Donation({
              userId: donation.userId,
              adminId: donation.adminId,
              kwhAmount: kwhToUse,
              isUsed: true,
              usedInOfferId: offer._id,
              createdAt: donation.createdAt
            });
            await usedDonation.save();
            donationsUsed.push(usedDonation);
          }
        }
      }
      
      // Calcola quanto abbiamo coperto con le donazioni
      const kwhCovered = offer.kwhCharged - kwhRemaining;
      const pricePerKwh = offer.totalAmount / offer.kwhCharged;
      const amountCovered = kwhCovered * pricePerKwh;
      const amountToPay = Math.max(0, offer.totalAmount - amountCovered);
      
      logger.info(`Admin ha utilizzato ${kwhCovered} kWh di donazioni dal venditore ${offer.sellerId}`, {
        kwhCovered,
        amountCovered,
        amountToPay,
        donationsUsed: donationsUsed.length
      });
      
      return {
        originalAmount: offer.totalAmount,
        kwhCovered,
        amountCovered,
        amountToPay,
        donationsUsed,
        isAdmin: true
      };
    }
    // Se è un utente normale, utilizziamo il saldo
    else {
      let balance = buyer.balance;
      let amountToPay = offer.totalAmount;
      let balanceUsed = 0;
      
      // Se l'utente ha un saldo positivo, utilizzalo
      if (balance > 0) {
        balanceUsed = Math.min(balance, offer.totalAmount);
        amountToPay = Math.max(0, offer.totalAmount - balanceUsed);
        
        logger.debug(`Utilizzo saldo per offerta ${offer._id}`, {
          balanceBefore: balance,
          balanceUsed,
          amountToPay,
          balanceAfter: balance - balanceUsed
        });
        
        // Aggiorna il saldo dell'utente
        buyer.balance -= balanceUsed;
        await buyer.save();
      } else {
        logger.debug(`Nessun saldo disponibile per offerta ${offer._id}, pagamento completo richiesto`);
      }
      
      return {
        originalAmount: offer.totalAmount,
        balanceUsed,
        amountToPay,
        remainingBalance: buyer.balance,
        donationsUsed: []
      };
    }
  } catch (err) {
    logger.error(`Errore nella gestione del pagamento per offerta ${offer._id}:`, err);
    throw err;
  }
};

/**
 * Chiede al venditore di inserire il costo unitario per kWh
 * @param {Object} offer - L'offerta da pagare
 * @returns {Promise<void>}
 */
const requestUnitPriceFromSeller = async (offer) => {
  try {
    logger.info(`Richiesta di inserimento costo unitario per offerta ${offer._id}`);
    
    // Verifica che l'offerta abbia i kWh dichiarati
    if (!offer.kwhCharged || offer.kwhCharged <= 0) {
      logger.error(`Errore: kwhCharged non definito o non valido nell'offerta ${offer._id}`);
      throw new Error("I kWh caricati non sono stati dichiarati");
    }
    
    // Invia il messaggio al venditore
    await bot.telegram.sendMessage(offer.sellerId, `
💰 *Inserisci il costo per ogni kWh*

L'acquirente ha dichiarato di aver caricato *${offer.kwhCharged} kWh*.

Per favore, inserisci il costo unitario per kWh (esempio: 0.22 per 22 centesimi di € per kWh).
Il sistema calcolerà automaticamente l'importo totale da pagare.
`, {
      parse_mode: 'Markdown'
    });
    
    logger.debug(`Richiesta costo unitario inviata al venditore ${offer.sellerId}`);
  } catch (err) {
    logger.error(`Errore nella richiesta del costo unitario per offerta ${offer._id}:`, err);
    throw err;
  }
};

/**
 * Calcola l'importo totale in base ai kWh e al costo unitario
 * @param {Object} offer - L'offerta da pagare
 * @param {Number} unitPrice - Costo unitario per kWh
 * @returns {Promise<Number>} Importo totale calcolato
 */
const calculateTotalAmount = async (offer, unitPrice) => {
  try {
    const kwhAmount = offer.kwhCharged;
    const totalAmount = kwhAmount * unitPrice;
    
    logger.info(`Calcolo importo totale per offerta ${offer._id}`, {
      kwhAmount,
      unitPrice,
      totalAmount
    });
    
    return totalAmount;
  } catch (err) {
    logger.error(`Errore nel calcolo dell'importo totale per offerta ${offer._id}:`, err);
    throw err;
  }
};

/**
 * Mostra il calcolo al venditore per conferma
 * @param {Object} offer - L'offerta da pagare
 * @param {Number} unitPrice - Costo unitario per kWh
 * @param {Number} totalAmount - Importo totale calcolato
 * @returns {Promise<void>}
 */
const showCalculationToSeller = async (offer, unitPrice, totalAmount) => {
  try {
    logger.info(`Mostra calcolo al venditore per offerta ${offer._id}`, {
      offerId: offer._id,
      sellerId: offer.sellerId,
      unitPrice,
      totalAmount
    });
    
    // Invia il messaggio al venditore
    await bot.telegram.sendMessage(offer.sellerId, `
📊 *Verifica il calcolo*

L'acquirente ha caricato: *${offer.kwhCharged} kWh*
Costo unitario: *${unitPrice.toFixed(2)}€ per kWh*
Importo totale: *${totalAmount.toFixed(2)}€*

Confermi questa richiesta di pagamento?
`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Conferma e invia richiesta', callback_data: `confirm_payment_${offer._id}_${totalAmount.toFixed(2)}` },
            { text: '❌ Annulla', callback_data: `cancel_payment_${offer._id}` }
          ]
        ]
      }
    });
    
    logger.debug(`Calcolo mostrato al venditore ${offer.sellerId}`);
  } catch (err) {
    logger.error(`Errore nella visualizzazione del calcolo per offerta ${offer._id}:`, err);
    throw err;
  }
};

/**
 * Invia una richiesta di pagamento all'acquirente
 * @param {Object} offer - L'offerta da pagare
 * @param {Object} paymentInfo - Informazioni sul pagamento
 * @returns {Promise<void>}
 */
const sendPaymentRequest = async (offer, paymentInfo) => {
  try {
    logger.info(`Invio richiesta di pagamento per offerta ${offer._id}`, {
      offerId: offer._id,
      buyerId: offer.buyerId,
      totalAmount: offer.totalAmount,
      isAdmin: paymentInfo?.isAdmin || false,
      donationsUsed: paymentInfo?.donationsUsed?.length || 0
    });
    
    // Verifica che offer.totalAmount sia definito
    if (typeof offer.totalAmount === 'undefined' || offer.totalAmount === null) {
      logger.error(`Errore: totalAmount non definito nell'offerta ${offer._id}`);
      throw new Error("L'importo totale dell'offerta non è definito");
    }
    
    // Verifica che paymentInfo sia definito
    if (!paymentInfo) {
      paymentInfo = {
        originalAmount: offer.totalAmount,
        balanceUsed: 0,
        amountToPay: offer.totalAmount,
        remainingBalance: 0,
        donationsUsed: []
      };
    }
    
    // Calcola il prezzo per kWh
    const pricePerKwh = (offer.totalAmount / offer.kwhCharged).toFixed(2);
    
    // Se l'acquirente è l'admin che sta utilizzando donazioni
    if (paymentInfo.isAdmin && paymentInfo.donationsUsed && paymentInfo.donationsUsed.length > 0) {
      // Messaggio per l'admin
      let adminMessage = `
💰 <b>Utilizzo donazioni del venditore</b> 💰

Hai utilizzato ${paymentInfo.kwhCovered.toFixed(2)} kWh donati dal venditore per questa ricarica.

⚡ <b>kWh ricaricati:</b> ${offer.kwhCharged} kWh
💸 <b>Importo coperto dalle donazioni:</b> ${paymentInfo.amountCovered.toFixed(2)}€
`;

      // Se c'è ancora un importo da pagare (donazioni insufficienti)
      if (paymentInfo.amountToPay > 0) {
        adminMessage += `\n💳 <b>Importo da pagare:</b> ${paymentInfo.amountToPay.toFixed(2)}€\n\nDevi effettuare un pagamento aggiuntivo per coprire l'importo rimanente.`;
        
        // Invia il messaggio all'admin con il bottone di conferma pagamento
        await bot.telegram.sendMessage(offer.buyerId, adminMessage, {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '💸 Ho effettuato il pagamento', callback_data: `payment_sent_${offer._id}` }]
            ]
          }
        });
      } else {
        adminMessage += `\n✅ <b>Pagamento completato</b> automaticamente utilizzando le donazioni del venditore.\n\nNon è necessario effettuare alcun pagamento aggiuntivo.`;
        
        // Aggiorna lo stato dell'offerta a pagamento inviato
        const offerService = require('../services/offerService');
        await offerService.updateOfferStatus(offer._id, 'payment_sent', { 
          paymentMethod: 'Crediti donati dal venditore' 
        });
        
        // Invia il messaggio all'admin senza bottoni
        await bot.telegram.sendMessage(offer.buyerId, adminMessage, {
          parse_mode: 'HTML'
        });
      }
      
      // Messaggio per il venditore
      let sellerMessage = `
💰 <b>Pagamento con crediti da te donati</b> 💰

L'amministratore ha utilizzato ${paymentInfo.kwhCovered.toFixed(2)} kWh dai crediti che hai donato in precedenza.

⚡ <b>kWh ricaricati:</b> ${offer.kwhCharged} kWh
💸 <b>Importo coperto dai tuoi crediti:</b> ${paymentInfo.amountCovered.toFixed(2)}€
`;
      
      // Se c'è ancora un importo da pagare
      if (paymentInfo.amountToPay > 0) {
        sellerMessage += `\n💳 <b>Importo da pagare:</b> ${paymentInfo.amountToPay.toFixed(2)}€\n\nL'amministratore deve effettuare un pagamento aggiuntivo per coprire l'importo rimanente.`;
      } else {
        sellerMessage += `\n✅ <b>Pagamento completato</b> automaticamente utilizzando i crediti che hai donato in precedenza.\n\nL'amministratore non deve effettuare alcun pagamento aggiuntivo.`;
        
        // Se il pagamento è già completato, invia il messaggio al venditore con i bottoni di conferma
        await bot.telegram.sendMessage(offer.sellerId, sellerMessage, {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Confermo pagamento ricevuto', callback_data: `payment_confirmed_${offer._id}` },
                { text: '❌ Non ho ricevuto', callback_data: `payment_not_received_${offer._id}` }
              ]
            ]
          }
        });
      }
      
      // Se il pagamento non è completato automaticamente, invia solo il messaggio informativo
      if (paymentInfo.amountToPay > 0) {
        await bot.telegram.sendMessage(offer.sellerId, sellerMessage, {
          parse_mode: 'HTML'
        });
      }
      
      return;
    }
    
    // Per gli utenti normali o quando non ci sono donazioni, costruisci il messaggio standard
    let message = `
💰 <b>Pagamento richiesto</b> 💰

Il venditore ha confermato la ricarica di ${offer.kwhCharged} kWh.

💸 <b>Importo totale:</b> ${offer.totalAmount.toFixed(2)}€
⚡ <b>Prezzo per kWh:</b> ${pricePerKwh}€`;

    // Aggiungi informazioni sul saldo se utilizzato
    if (paymentInfo.balanceUsed > 0) {
      const kwhUsed = offer.kwhCharged * (paymentInfo.balanceUsed / offer.totalAmount);
      
      message += `\n\n<b>Hai utilizzato ${kwhUsed.toFixed(2)} kWh (${paymentInfo.balanceUsed.toFixed(2)}€) dal tuo saldo.</b>`;
      
      if (paymentInfo.amountToPay > 0) {
        message += `\nDopo aver utilizzato il tuo saldo, devi pagare ancora <b>${paymentInfo.amountToPay.toFixed(2)}€</b>.`;
      } else {
        message += `\nIl tuo saldo è stato sufficiente per coprire l'intero importo, e ti restano <b>${paymentInfo.remainingBalance.toFixed(2)} kWh</b>.`;
      }
    }

    message += `\n\nPer favore, effettua il pagamento e poi segnala di averlo fatto.`;
    
    // Invia il messaggio all'acquirente
    await bot.telegram.sendMessage(offer.buyerId, message, {
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('💸 Ho effettuato il pagamento', `payment_sent_${offer._id}`)]
      ])
    });
    
    logger.debug(`Richiesta di pagamento inviata all'acquirente ${offer.buyerId}`);
  } catch (err) {
    logger.error(`Errore nell'invio della richiesta di pagamento per offerta ${offer._id}:`, err);
    throw err;
  }
};

/**
 * Crea una nuova donazione
 * @param {Number} userId - ID dell'utente donatore
 * @param {Number} adminId - ID dell'amministratore (valore predefinito da config/admin.js)
 * @param {Number} amount - Quantità di kWh donata
 * @returns {Promise<Object>} La nuova donazione
 */
const createDonation = async (userId, adminId = ADMIN_USER_ID, amount) => {
  try {
    logger.info(`Creazione donazione da ${userId} a ${adminId}`, {
      userId,
      adminId,
      amount
    });
    
    // Crea la donazione
    const donation = new Donation({
      userId,
      adminId,
      kwhAmount: amount,
      isUsed: false
    });
    
    await donation.save();
    logger.debug(`Donazione creata con ID: ${donation._id}`);
    
    // Aggiorna il saldo dell'admin
    const admin = await User.findOne({ userId: adminId });
    if (admin) {
      const oldBalance = admin.balance;
      admin.balance += amount;
      await admin.save();
      
      logger.debug(`Saldo admin ${adminId} aggiornato: ${oldBalance} → ${admin.balance}`);
    } else {
      logger.warn(`Admin ${adminId} non trovato durante la creazione della donazione`);
    }
    
    return donation;
  } catch (err) {
    logger.error(`Errore nella creazione della donazione da ${userId} a ${adminId}:`, err);
    throw err;
  }
};

/**
 * Notifica l'admin riguardo una nuova donazione
 * @param {Object} donation - La donazione effettuata
 * @param {Object} donor - L'utente donatore
 * @returns {Promise<void>}
 */
const notifyAdminAboutDonation = async (donation, donor) => {
  try {
    logger.info(`Notifica admin ${donation.adminId} riguardo donazione ${donation._id}`, {
      donationId: donation._id,
      donorId: donor.userId,
      donorName: donor.username || donor.firstName,
      amount: donation.kwhAmount
    });
    
    // Recupera l'admin
    const admin = await User.findOne({ userId: donation.adminId });
    if (!admin) {
      logger.error(`Admin ${donation.adminId} non trovato durante la notifica della donazione`);
      
      // Crea automaticamente l'account admin se non esiste
      logger.info(`Tentativo di creazione automatica dell'account admin con ID ${donation.adminId}`);
      const newAdmin = new User({
        userId: donation.adminId,
        username: 'admin',
        firstName: 'Administrator',
        balance: donation.kwhAmount // Assegna subito la donazione
      });
      
      try {
        await newAdmin.save();
        logger.info(`Account admin creato automaticamente con ID ${donation.adminId} e saldo iniziale ${donation.kwhAmount} kWh`);
        
        // Invia la notifica all'admin appena creato
        try {
          // Costruisci il nome del donatore
          const donorName = donor.username ? 
            '@' + donor.username : 
            donor.firstName || 'Venditore';
            
          // Recupera il totale donato da questo venditore
          const totalFromVendor = await Donation.getTotalAvailableFromVendor(newAdmin.userId, donor.userId);
          
          await bot.telegram.sendMessage(newAdmin.userId, `
🎁 <b>Nuova donazione ricevuta!</b> 🎁

${donorName} ti ha donato ${donation.kwhAmount} kWh.

<b>Totale disponibile da questo venditore:</b> ${totalFromVendor.toFixed(2)} kWh
<b>Saldo attuale totale:</b> ${newAdmin.balance.toFixed(2)} kWh

<b>Nota:</b> Il tuo account admin è stato creato automaticamente.
Usa /le_mie_donazioni per vedere tutte le donazioni ricevute.
`, {
            parse_mode: 'HTML'
          });
          
          logger.info(`Notifica donazione inviata all'admin ${donation.adminId} (account creato automaticamente)`);
          return;
        } catch (notifyErr) {
          logger.warn(`Impossibile inviare notifica all'admin ${donation.adminId} (account creato automaticamente):`, notifyErr);
          return;
        }
      } catch (createErr) {
        logger.error(`Errore nella creazione automatica dell'account admin ${donation.adminId}:`, createErr);
        throw new Error('Errore nella creazione automatica dell\'account admin');
      }
    }
    
    // Costruisci il nome del donatore
    const donorName = donor.username ? 
      '@' + donor.username : 
      donor.firstName || 'Venditore';
    
    // Recupera il totale donato da questo venditore
    const totalFromVendor = await Donation.getTotalAvailableFromVendor(admin.userId, donor.userId);
    
    // Invia la notifica
    try {
      await bot.telegram.sendMessage(admin.userId, `
🎁 <b>Nuova donazione ricevuta!</b> 🎁

${donorName} ti ha donato ${donation.kwhAmount} kWh.

<b>Totale disponibile da questo venditore:</b> ${totalFromVendor.toFixed(2)} kWh
<b>Saldo attuale totale:</b> ${admin.balance.toFixed(2)} kWh

Usa /le_mie_donazioni per vedere tutte le donazioni ricevute.
`, {
        parse_mode: 'HTML'
      });
      
      logger.debug(`Notifica donazione inviata all'admin ${donation.adminId}`);
    } catch (sendErr) {
      logger.error(`Errore nell'invio della notifica all'admin ${donation.adminId}:`, sendErr);
      throw new Error(`Errore nell'invio della notifica all'admin: ${sendErr.message}`);
    }
  } catch (err) {
    logger.error(`Errore nella notifica all'admin ${donation.adminId} riguardo donazione ${donation._id}:`, err);
    // Non rilanciare l'errore per evitare che fallisca l'intera transazione
    // La donazione è stata già registrata nel database, solo la notifica è fallita
  }
};

/**
 * Ottiene le statistiche delle donazioni per un utente
 * @param {Number} userId - ID dell'utente
 * @returns {Promise<Object>} Statistiche delle donazioni
 */
const getDonationStats = async (userId) => {
  try {
    // Ottiene le statistiche per l'admin (donazioni ricevute)
    if (isAdmin(userId)) {
      const vendorSummary = await Donation.getVendorSummary(userId);
      
      // Calcola i totali
      let totalDonated = 0;
      let totalAvailable = 0;
      let totalUsed = 0;
      
      for (const vendor of vendorSummary) {
        totalDonated += vendor.totalDonated;
        totalAvailable += vendor.availableAmount;
        totalUsed += vendor.usedAmount;
      }
      
      return {
        isAdmin: true,
        totalDonated,
        totalAvailable,
        totalUsed,
        vendorSummary
      };
    } 
    // Ottiene le statistiche per un utente normale (donazioni effettuate)
    else {
      const donationsMade = await Donation.find({ userId });
      
      // Calcola i totali
      let totalDonated = 0;
      let totalUsed = 0;
      
      for (const donation of donationsMade) {
        totalDonated += donation.kwhAmount;
        if (donation.isUsed) {
          totalUsed += donation.kwhAmount;
        }
      }
      
      return {
        isAdmin: false,
        totalDonated,
        totalUsed,
        donationsMade
      };
    }
  } catch (err) {
    logger.error(`Errore nel recupero delle statistiche delle donazioni per utente ${userId}:`, err);
    throw err;
  }
};

module.exports = {
  createTransaction,
  handlePaymentWithBalance,
  requestUnitPriceFromSeller,
  calculateTotalAmount,
  showCalculationToSeller,
  sendPaymentRequest,
  createDonation,
  notifyAdminAboutDonation,
  getDonationStats
};
