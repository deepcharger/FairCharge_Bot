// services/transactionService.js
// Servizio per la gestione delle transazioni
const Transaction = require('../models/transaction');
const User = require('../models/user');
const Offer = require('../models/offer');
const logger = require('../utils/logger');

/**
 * Crea una nuova transazione
 * @param {Number} buyerId - ID dell'acquirente
 * @param {Number} sellerId - ID del venditore
 * @param {Number} kwhAmount - Quantità di kWh scambiati
 * @param {Number} pricePerKwh - Prezzo per kWh
 * @param {Number} totalAmount - Importo totale
 * @param {String} offerId - ID dell'offerta collegata (opzionale)
 * @param {String} paymentMethod - Metodo di pagamento (opzionale)
 * @returns {Promise<Object>} La transazione creata
 */
const createTransaction = async (buyerId, sellerId, kwhAmount, pricePerKwh, totalAmount, offerId = null, paymentMethod = 'Pagamento manuale') => {
  try {
    logger.info(`Creazione transazione: ${buyerId} → ${sellerId}, ${kwhAmount} kWh, ${totalAmount}€`, {
      buyerId,
      sellerId,
      kwhAmount,
      pricePerKwh,
      totalAmount,
      offerId
    });
    
    // Crea la transazione
    const transaction = new Transaction({
      offerId,
      buyerId,
      sellerId,
      kwhAmount,
      price: pricePerKwh,
      totalAmount,
      paymentMethod,
      status: 'completed',
      createdAt: new Date()
    });
    
    await transaction.save();
    
    // Aggiorna le referenze negli utenti
    await updateUserTransactionReferences(buyerId, transaction._id);
    await updateUserTransactionReferences(sellerId, transaction._id);
    
    // Aggiorna i portafogli degli utenti con questi partner se necessario
    await updateUserWalletPartners(buyerId, sellerId, kwhAmount);
    await updateUserWalletPartners(sellerId, buyerId, kwhAmount);
    
    logger.info(`Transazione creata con successo: ${transaction._id}`);
    
    return transaction;
  } catch (err) {
    logger.error(`Errore nella creazione della transazione:`, err);
    throw err;
  }
};

/**
 * Aggiorna le referenze alle transazioni dell'utente
 * @param {Number} userId - ID dell'utente
 * @param {String} transactionId - ID della transazione
 * @returns {Promise<void>}
 */
const updateUserTransactionReferences = async (userId, transactionId) => {
  try {
    const user = await User.findOne({ userId });
    if (!user) {
      logger.warn(`Utente ${userId} non trovato per l'aggiornamento delle referenze di transazione`);
      return;
    }
    
    // Aggiungi la transazione all'elenco dell'utente
    user.transactions.push(transactionId);
    await user.save();
    
    logger.debug(`Referenze transazione aggiornate per utente ${userId}`);
  } catch (err) {
    logger.error(`Errore nell'aggiornamento delle referenze di transazione per utente ${userId}:`, err);
    throw err;
  }
};

/**
 * Aggiorna i dettagli del portafoglio degli utenti per il partner
 * @param {Number} userId - ID dell'utente
 * @param {Number} partnerId - ID del partner
 * @param {Number} kwhAmount - Quantità di kWh scambiati
 * @returns {Promise<void>}
 */
const updateUserWalletPartners = async (userId, partnerId, kwhAmount) => {
  try {
    const user = await User.findOne({ userId });
    if (!user) {
      logger.warn(`Utente ${userId} non trovato per l'aggiornamento del portafoglio partner`);
      return;
    }
    
    // Ottieni il partner
    const partner = await User.findOne({ userId: partnerId });
    const partnerName = partner ? (partner.username || partner.firstName) : `Partner ${partnerId}`;
    
    // Se il metodo esiste nell'oggetto user, usalo
    if (typeof user.updateWalletPartner === 'function') {
      await user.updateWalletPartner(partnerId, partnerName, kwhAmount);
      logger.debug(`Portafoglio partner aggiornato per utente ${userId} con partner ${partnerId}`);
    } else {
      logger.warn(`Metodo updateWalletPartner non disponibile per l'utente ${userId}`);
    }
  } catch (err) {
    logger.error(`Errore nell'aggiornamento del portafoglio partner per utente ${userId}:`, err);
    // Non lanciare l'eccezione per non compromettere l'operazione principale
  }
};

/**
 * Ottiene le transazioni di un utente
 * @param {Number} userId - ID dell'utente
 * @param {Object} filters - Filtri opzionali
 * @returns {Promise<Array>} Lista di transazioni
 */
const getUserTransactions = async (userId, filters = {}) => {
  try {
    const query = {
      $or: [
        { buyerId: userId },
        { sellerId: userId }
      ]
    };
    
    // Aggiungi eventuali filtri aggiuntivi
    if (filters.status) {
      query.status = filters.status;
    }
    
    if (filters.partnerId) {
      query.$or = [
        { buyerId: userId, sellerId: filters.partnerId },
        { sellerId: userId, buyerId: filters.partnerId }
      ];
    }
    
    // Aggiungi filtro per data
    if (filters.startDate || filters.endDate) {
      query.createdAt = {};
      
      if (filters.startDate) {
        query.createdAt.$gte = new Date(filters.startDate);
      }
      
      if (filters.endDate) {
        query.createdAt.$lte = new Date(filters.endDate);
      }
    }
    
    // Esegui la query con ordinamento
    const transactions = await Transaction.find(query)
      .sort({ createdAt: filters.sortOrder || -1 }) // Default: più recenti prima
      .limit(filters.limit || 0)
      .skip(filters.skip || 0);
    
    logger.debug(`Recuperate ${transactions.length} transazioni per utente ${userId}`);
    
    return transactions;
  } catch (err) {
    logger.error(`Errore nel recupero delle transazioni per utente ${userId}:`, err);
    throw err;
  }
};

/**
 * Disputa una transazione
 * @param {String} transactionId - ID della transazione
 * @param {String} reason - Motivo della disputa
 * @returns {Promise<Object>} La transazione aggiornata
 */
const disputeTransaction = async (transactionId, reason = '') => {
  try {
    const transaction = await Transaction.findById(transactionId);
    if (!transaction) {
      logger.warn(`Transazione ${transactionId} non trovata per la disputa`);
      throw new Error('Transazione non trovata');
    }
    
    // Aggiorna lo stato e aggiungi il motivo della disputa (se supportato dal modello)
    transaction.status = 'disputed';
    if (reason && transaction.schema.paths.disputeReason) {
      transaction.disputeReason = reason;
    }
    
    await transaction.save();
    
    logger.info(`Transazione ${transactionId} disputata con successo`);
    return transaction;
  } catch (err) {
    logger.error(`Errore nella disputa della transazione ${transactionId}:`, err);
    throw err;
  }
};

/**
 * Calcola le statistiche delle transazioni per un utente
 * @param {Number} userId - ID dell'utente
 * @returns {Promise<Object>} Statistiche delle transazioni
 */
const calculateUserTransactionStats = async (userId) => {
  try {
    // Transazioni come acquirente
    const buyTransactions = await Transaction.find({ buyerId: userId });
    
    // Transazioni come venditore
    const sellTransactions = await Transaction.find({ sellerId: userId });
    
    // Calcola i totali
    let totalKwhBought = 0;
    let totalKwhSold = 0;
    let totalAmountSpent = 0;
    let totalAmountEarned = 0;
    let totalTransactions = buyTransactions.length + sellTransactions.length;
    let successfulTransactions = 0;
    let disputedTransactions = 0;
    
    // Calcola le statistiche per le transazioni di acquisto
    for (const tx of buyTransactions) {
      totalKwhBought += tx.kwhAmount;
      totalAmountSpent += tx.totalAmount;
      
      if (tx.status === 'completed') {
        successfulTransactions++;
      } else if (tx.status === 'disputed') {
        disputedTransactions++;
      }
    }
    
    // Calcola le statistiche per le transazioni di vendita
    for (const tx of sellTransactions) {
      totalKwhSold += tx.kwhAmount;
      totalAmountEarned += tx.totalAmount;
      
      if (tx.status === 'completed') {
        successfulTransactions++;
      } else if (tx.status === 'disputed') {
        disputedTransactions++;
      }
    }
    
    return {
      totalTransactions,
      successfulTransactions,
      disputedTransactions,
      totalKwhBought,
      totalKwhSold,
      totalAmountSpent,
      totalAmountEarned,
      buyTransactions,
      sellTransactions
    };
  } catch (err) {
    logger.error(`Errore nel calcolo delle statistiche delle transazioni per utente ${userId}:`, err);
    throw err;
  }
};

module.exports = {
  createTransaction,
  getUserTransactions,
  disputeTransaction,
  calculateUserTransactionStats
};
