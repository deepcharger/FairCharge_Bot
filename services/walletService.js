// Servizio per la gestione dei portafogli degli utenti
const User = require('../models/user');
const Transaction = require('../models/transaction');
const Offer = require('../models/offer');
const Donation = require('../models/donation');
const logger = require('../utils/logger');
const { isAdmin } = require('../config/admin');

/**
 * Ottiene un riepilogo del portafoglio di un utente suddiviso per partner di transazione
 * @param {Number} userId - ID dell'utente
 * @returns {Promise<Object>} Riepilogo del portafoglio
 */
const getUserWalletSummary = async (userId) => {
  try {
    logger.info(`Recupero riepilogo portafoglio per utente ${userId}`);
    
    const user = await User.findOne({ userId });
    if (!user) {
      logger.warn(`Utente ${userId} non trovato`);
      throw new Error('Utente non trovato');
    }
    
    // Recupera tutte le transazioni dell'utente
    const transactions = await Transaction.find({
      $or: [
        { buyerId: userId },
        { sellerId: userId }
      ]
    }).sort({ createdAt: -1 });
    
    // Recupera tutte le offerte dell'utente
    const offers = await Offer.find({
      $or: [
        { buyerId: userId },
        { sellerId: userId }
      ]
    }).sort({ createdAt: -1 });
    
    // Se l'utente è l'admin, recupera anche le donazioni
    let donations = [];
    if (isAdmin(userId)) {
      donations = await Donation.find({ adminId: userId });
    } else {
      donations = await Donation.find({ userId });
    }
    
    // Crea un riepilogo per ogni partner di transazione
    const partnerSummary = {};
    
    // Funzione helper per aggiungere o aggiornare un partner
    const updatePartnerSummary = (partnerId, isUserBuyer, data) => {
      if (!partnerSummary[partnerId]) {
        partnerSummary[partnerId] = {
          partnerId,
          partnerInfo: null, // Verrà popolato in seguito
          totalTransactions: 0,
          totalKwhBought: 0,
          totalKwhSold: 0,
          amountSpent: 0,
          amountEarned: 0,
          successfulTransactions: 0,
          pendingTransactions: 0,
          canceledTransactions: 0,
          lastTransaction: null,
          transactions: [],
          offers: [],
          donations: [] // Solo per admin
        };
      }
      
      // Aggiorna con i dati forniti
      Object.keys(data).forEach(key => {
        if (key === 'kwhAmount') {
          if (isUserBuyer) {
            partnerSummary[partnerId].totalKwhBought += data[key];
          } else {
            partnerSummary[partnerId].totalKwhSold += data[key];
          }
        } else if (key === 'totalAmount') {
          if (isUserBuyer) {
            partnerSummary[partnerId].amountSpent += data[key];
          } else {
            partnerSummary[partnerId].amountEarned += data[key];
          }
        } else if (key === 'transaction') {
          partnerSummary[partnerId].transactions.push(data[key]);
          partnerSummary[partnerId].totalTransactions++;
          
          // Aggiorna l'ultima transazione se è più recente
          if (!partnerSummary[partnerId].lastTransaction || 
              data[key].createdAt > partnerSummary[partnerId].lastTransaction.createdAt) {
            partnerSummary[partnerId].lastTransaction = data[key];
          }
        } else if (key === 'offer') {
          partnerSummary[partnerId].offers.push(data[key]);
          
          if (data[key].status === 'completed') {
            partnerSummary[partnerId].successfulTransactions++;
          } else if (data[key].status === 'cancelled' || data[key].status === 'rejected') {
            partnerSummary[partnerId].canceledTransactions++;
          } else {
            partnerSummary[partnerId].pendingTransactions++;
          }
        } else if (key === 'donation') {
          partnerSummary[partnerId].donations.push(data[key]);
        } else {
          partnerSummary[partnerId][key] = data[key];
        }
      });
    };
    
    // Processa le transazioni
    for (const transaction of transactions) {
      const isUserBuyer = transaction.buyerId === userId;
      const partnerId = isUserBuyer ? transaction.sellerId : transaction.buyerId;
      
      updatePartnerSummary(partnerId, isUserBuyer, {
        kwhAmount: transaction.kwhAmount,
        totalAmount: transaction.totalAmount,
        transaction: transaction
      });
    }
    
    // Processa le offerte
    for (const offer of offers) {
      const isUserBuyer = offer.buyerId === userId;
      const partnerId = isUserBuyer ? offer.sellerId : offer.buyerId;
      
      updatePartnerSummary(partnerId, isUserBuyer, {
        offer: offer
      });
    }
    
    // Processa le donazioni per l'admin
    if (isAdmin(userId)) {
      for (const donation of donations) {
        updatePartnerSummary(donation.userId, false, {
          donation: donation
        });
      }
    } 
    // Processa le donazioni per i venditori
    else {
      for (const donation of donations) {
        updatePartnerSummary(donation.adminId, false, {
          donation: donation
        });
      }
    }
    
    // Recupera le informazioni sui partner
    const partnerIds = Object.keys(partnerSummary).map(id => parseInt(id));
    const partners = await User.find({ userId: { $in: partnerIds } });
    
    // Aggiungi le informazioni sui partner
    for (const partner of partners) {
      if (partnerSummary[partner.userId]) {
        partnerSummary[partner.userId].partnerInfo = {
          userId: partner.userId,
          username: partner.username,
          firstName: partner.firstName,
          lastName: partner.lastName
        };
      }
    }
    
    // Calcola i totali
    const totals = {
      totalKwhBought: 0,
      totalKwhSold: 0,
      amountSpent: 0,
      amountEarned: 0,
      successfulTransactions: 0,
      pendingTransactions: 0,
      canceledTransactions: 0,
      totalDonatedKwh: 0,
      totalReceivedKwh: 0
    };
    
    Object.values(partnerSummary).forEach(partner => {
      totals.totalKwhBought += partner.totalKwhBought;
      totals.totalKwhSold += partner.totalKwhSold;
      totals.amountSpent += partner.amountSpent;
      totals.amountEarned += partner.amountEarned;
      totals.successfulTransactions += partner.successfulTransactions;
      totals.pendingTransactions += partner.pendingTransactions;
      totals.canceledTransactions += partner.canceledTransactions;
      
      // Calcola le donazioni
      if (isAdmin(userId)) {
        partner.donations.forEach(donation => {
          if (!donation.isUsed) {
            totals.totalReceivedKwh += donation.kwhAmount;
          }
        });
      } else {
        partner.donations.forEach(donation => {
          totals.totalDonatedKwh += donation.kwhAmount;
        });
      }
    });
    
    // Aggiungi il saldo corrente
    totals.currentBalance = user.balance;
    
    // Prepara l'oggetto risultato
    const result = {
      userId: user.userId,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      registrationDate: user.registrationDate,
      totals: totals,
      partners: partnerSummary
    };
    
    return result;
  } catch (err) {
    logger.error(`Errore nel recupero del riepilogo del portafoglio per utente ${userId}:`, err);
    throw err;
  }
};

/**
 * Ottiene un riepilogo dettagliato del portafoglio con un partner specifico
 * @param {Number} userId - ID dell'utente
 * @param {Number} partnerId - ID del partner
 * @returns {Promise<Object>} Riepilogo dettagliato
 */
const getPartnerWalletDetail = async (userId, partnerId) => {
  try {
    logger.info(`Recupero dettaglio portafoglio per utente ${userId} con partner ${partnerId}`);
    
    // Ottieni il riepilogo completo del portafoglio
    const walletSummary = await getUserWalletSummary(userId);
    
    // Estrai i dettagli del partner specifico
    const partnerDetail = walletSummary.partners[partnerId];
    
    if (!partnerDetail) {
      logger.warn(`Partner ${partnerId} non trovato nel portafoglio dell'utente ${userId}`);
      throw new Error('Partner non trovato nel portafoglio');
    }
    
    // Aggiungi dettagli extra per questo partner
    
    // Se l'utente è l'admin, aggiungi dettagli sulle donazioni
    if (isAdmin(userId)) {
      const availableDonations = await Donation.findAvailableFromVendor(userId, partnerId);
      const totalAvailable = await Donation.getTotalAvailableFromVendor(userId, partnerId);
      const totalUsed = await Donation.getTotalUsedWithVendor(userId, partnerId);
      
      partnerDetail.donationsDetail = {
        totalDonations: totalAvailable + totalUsed,
        availableDonations: totalAvailable,
        usedDonations: totalUsed,
        donationsList: availableDonations
      };
    }
    
    return {
      userId,
      partnerId,
      partnerDetail
    };
  } catch (err) {
    logger.error(`Errore nel recupero del dettaglio del portafoglio per utente ${userId} con partner ${partnerId}:`, err);
    throw err;
  }
};

/**
 * Ottiene le statistiche delle donazioni per un admin
 * @param {Number} adminId - ID dell'admin
 * @returns {Promise<Object>} Statistiche delle donazioni
 */
const getAdminDonationStats = async (adminId) => {
  try {
    logger.info(`Recupero statistiche donazioni per admin ${adminId}`);
    
    if (!isAdmin(adminId)) {
      logger.warn(`Utente ${adminId} non è admin, impossibile recuperare statistiche donazioni`);
      throw new Error('Solo gli admin possono visualizzare queste statistiche');
    }
    
    // Recupera il riepilogo delle donazioni per venditore
    const vendorSummary = await Donation.getVendorSummary(adminId);
    
    // Recupera le informazioni sui venditori
    const vendorIds = vendorSummary.map(v => v._id);
    const vendors = await User.find({ userId: { $in: vendorIds } });
    
    // Mappa delle informazioni sui venditori
    const vendorMap = {};
    vendors.forEach(v => {
      vendorMap[v.userId] = {
        userId: v.userId,
        username: v.username,
        firstName: v.firstName,
        lastName: v.lastName
      };
    });
    
    // Arricchisci il riepilogo con le informazioni sui venditori
    const enrichedSummary = vendorSummary.map(vendor => ({
      ...vendor,
      vendorInfo: vendorMap[vendor._id] || { userId: vendor._id, username: null, firstName: `Venditore ${vendor._id}`, lastName: null }
    }));
    
    // Calcola i totali
    let totalDonated = 0;
    let totalAvailable = 0;
    let totalUsed = 0;
    let totalVendors = enrichedSummary.length;
    
    enrichedSummary.forEach(v => {
      totalDonated += v.totalDonated;
      totalAvailable += v.availableAmount;
      totalUsed += v.usedAmount;
    });
    
    return {
      adminId,
      totalDonated,
      totalAvailable,
      totalUsed,
      totalVendors,
      vendorSummary: enrichedSummary
    };
  } catch (err) {
    logger.error(`Errore nel recupero delle statistiche delle donazioni per admin ${adminId}:`, err);
    throw err;
  }
};

module.exports = {
  getUserWalletSummary,
  getPartnerWalletDetail,
  getAdminDonationStats
};
