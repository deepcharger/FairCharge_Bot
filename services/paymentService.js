// Servizio per la gestione dei pagamenti e delle transazioni
const Transaction = require('../models/transaction');
const User = require('../models/user');
const Donation = require('../models/donation');
const { bot } = require('../config/bot');
const { Markup } = require('telegraf');
const logger = require('../utils/logger');
const { ADMIN_USER_ID } = require('../config/admin');

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
      price: offer.totalAmount / offer.kwhCharged,
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
 * Gestisce il pagamento utilizzando il saldo dell'utente se disponibile
 * @param {Object} offer - L'offerta da pagare
 * @param {Object} buyer - L'acquirente
 * @returns {Promise<Object>} Oggetto con informazioni sul pagamento
 */
const handlePaymentWithBalance = async (offer, buyer) => {
  try {
    logger.info(`Gestione pagamento con saldo per offerta ${offer._id}`, {
      offerId: offer._id,
      buyerId: buyer.userId,
      totalAmount: offer.totalAmount,
      currentBalance: buyer.balance
    });
    
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
      remainingBalance: buyer.balance
    };
  } catch (err) {
    logger.error(`Errore nella gestione del pagamento con saldo per offerta ${offer._id}:`, err);
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
      balanceUsed: paymentInfo.balanceUsed,
      amountToPay: paymentInfo.amountToPay
    });
    
    // Calcola il prezzo per kWh
    const pricePerKwh = (offer.totalAmount / offer.kwhCharged).toFixed(2);
    
    // Costruisci il messaggio di richiesta pagamento
    let message = `
💰 *Pagamento richiesto* 💰

Il venditore ha confermato la ricarica di ${offer.kwhCharged} kWh.

💸 *Importo totale:* ${offer.totalAmount.toFixed(2)}€
⚡ *Prezzo per kWh:* ${pricePerKwh}€`;

    // Aggiungi informazioni sul saldo se utilizzato
    if (paymentInfo.balanceUsed > 0) {
      message += `\nHai utilizzato ${paymentInfo.balanceUsed.toFixed(2)} kWh dal tuo saldo.`;
      
      if (paymentInfo.amountToPay > 0) {
        message += `\nDopo aver utilizzato il tuo saldo, devi pagare ancora ${paymentInfo.amountToPay.toFixed(2)}€.`;
      } else {
        message += `\nIl tuo saldo è stato sufficiente per coprire l'intero importo, e ti restano ${paymentInfo.remainingBalance.toFixed(2)} kWh.`;
      }
    }

    message += `\n\nPer favore, effettua il pagamento e poi segnala di averlo fatto.`;
    
    // Invia il messaggio all'acquirente
    await bot.telegram.sendMessage(offer.buyerId, message, {
      parse_mode: 'Markdown',
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
      kwhAmount: amount
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
      logger.warn(`Admin ${donation.adminId} non trovato durante la notifica della donazione`);
      throw new Error('Admin non trovato');
    }
    
    // Costruisci il nome del donatore
    const donorName = donor.username ? 
      '@' + donor.username : 
      donor.firstName || 'Venditore';
    
    // Invia la notifica
    await bot.telegram.sendMessage(admin.userId, `
🎁 *Nuova donazione ricevuta!* 🎁

${donorName} ti ha donato ${donation.kwhAmount} kWh.

Il tuo saldo attuale è di ${admin.balance.toFixed(2)} kWh.
`, {
      parse_mode: 'Markdown'
    });
    
    logger.debug(`Notifica donazione inviata all'admin ${donation.adminId}`);
  } catch (err) {
    logger.error(`Errore nella notifica all'admin ${donation.adminId} riguardo donazione ${donation._id}:`, err);
    throw err;
  }
};

module.exports = {
  createTransaction,
  handlePaymentWithBalance,
  sendPaymentRequest,
  createDonation,
  notifyAdminAboutDonation
};
