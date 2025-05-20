// services/donationService.js
// Servizio per la gestione delle donazioni
const Donation = require('../models/donation');
const User = require('../models/user');
const logger = require('../utils/logger');
const { bot } = require('../config/bot');

/**
 * Crea una nuova donazione
 * @param {Number} userId - ID dell'utente donatore
 * @param {Number} adminId - ID dell'amministratore ricevente
 * @param {Number} kwhAmount - Quantità di kWh donata
 * @param {String} offerId - ID dell'offerta collegata (opzionale)
 * @returns {Promise<Object>} La donazione creata
 */
const createDonation = async (userId, adminId, kwhAmount, offerId = null) => {
  try {
    logger.info(`Creazione donazione: ${userId} → ${adminId}, ${kwhAmount} kWh`, {
      userId,
      adminId,
      kwhAmount,
      offerId
    });
    
    // Crea la donazione
    const donation = new Donation({
      userId,
      adminId,
      kwhAmount,
      isUsed: false,
      usedInOfferId: null
    });
    
    await donation.save();
    
    // Aggiorna il saldo dell'admin
    const admin = await User.findOne({ userId: adminId });
    if (admin) {
      const oldBalance = admin.balance;
      admin.balance += kwhAmount;
      await admin.save();
      
      logger.debug(`Saldo admin ${adminId} aggiornato: ${oldBalance} → ${admin.balance}`);
    } else {
      logger.warn(`Admin ${adminId} non trovato durante la creazione della donazione`);
    }
    
    logger.info(`Donazione creata con successo: ${donation._id}`);
    return donation;
  } catch (err) {
    logger.error(`Errore nella creazione della donazione ${userId} → ${adminId}:`, err);
    throw err;
  }
};

/**
 * Utilizza le donazioni disponibili per un'offerta
 * @param {Object} offer - L'offerta per cui utilizzare le donazioni
 * @returns {Promise<{usedAmount: Number, donationsUsed: Array}>} Risultato dell'operazione
 */
const useAvailableDonations = async (offer) => {
  try {
    logger.info(`Utilizzo donazioni per offerta ${offer._id}`, {
      offerId: offer._id,
      buyerId: offer.buyerId,
      sellerId: offer.sellerId
    });
    
    // Trova le donazioni disponibili per questa coppia admin-venditore
    const availableDonations = await Donation.find({
      adminId: offer.buyerId,
      userId: offer.sellerId,
      isUsed: false
    }).sort({ createdAt: 1 }); // Usa prima le donazioni più vecchie
    
    if (availableDonations.length === 0) {
      logger.debug(`Nessuna donazione disponibile per offerta ${offer._id}`);
      return { usedAmount: 0, donationsUsed: [] };
    }
    
    // Calcola quanti kWh sono necessari
    const kwhNeeded = offer.kwhCharged || 0;
    if (kwhNeeded <= 0) {
      logger.debug(`Nessun kWh da utilizzare per offerta ${offer._id}`);
      return { usedAmount: 0, donationsUsed: [] };
    }
    
    // Utilizza le donazioni finché non copriamo i kWh necessari
    let remainingKwh = kwhNeeded;
    const donationsUsed = [];
    
    for (const donation of availableDonations) {
      if (remainingKwh <= 0) break;
      
      const kwhToUse = Math.min(donation.kwhAmount, remainingKwh);
      remainingKwh -= kwhToUse;
      
      if (kwhToUse === donation.kwhAmount) {
        // Usa l'intera donazione
        donation.isUsed = true;
        donation.usedInOfferId = offer._id;
        await donation.save();
        donationsUsed.push(donation);
      } else {
        // Usa solo una parte della donazione
        // Crea una nuova donazione "utilizzata" per la parte usata
        const usedDonation = new Donation({
          userId: donation.userId,
          adminId: donation.adminId,
          kwhAmount: kwhToUse,
          isUsed: true,
          usedInOfferId: offer._id,
          createdAt: donation.createdAt // Mantieni la data originale
        });
        await usedDonation.save();
        donationsUsed.push(usedDonation);
        
        // Aggiorna la donazione originale
        donation.kwhAmount -= kwhToUse;
        await donation.save();
      }
    }
    
    const usedAmount = kwhNeeded - remainingKwh;
    logger.info(`Utilizzati ${usedAmount} kWh da donazioni per offerta ${offer._id}`);
    
    return { usedAmount, donationsUsed };
  } catch (err) {
    logger.error(`Errore nell'utilizzo delle donazioni per offerta ${offer._id}:`, err);
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
    
    // Costruisci il nome del donatore
    const donorName = donor.username ? 
      '@' + donor.username : 
      donor.firstName || 'Venditore';
    
    // Recupera il totale disponibile da questo venditore
    const totalFromVendor = await Donation.aggregate([
      { 
        $match: { 
          adminId: donation.adminId,
          userId: donor.userId,
          isUsed: false
        }
      },
      { 
        $group: { 
          _id: null, 
          total: { $sum: "$kwhAmount" } 
        }
      }
    ]);
    
    const totalAvailable = totalFromVendor.length > 0 ? totalFromVendor[0].total : 0;
    
    // Recupera l'admin
    const admin = await User.findOne({ userId: donation.adminId });
    if (!admin) {
      logger.warn(`Admin ${donation.adminId} non trovato durante la notifica della donazione`);
      return;
    }
    
    // Invia la notifica
    await bot.telegram.sendMessage(donation.adminId, `
🎁 <b>Nuova donazione ricevuta!</b> 🎁

${donorName} ti ha donato ${donation.kwhAmount} kWh.

<b>Totale disponibile da questo venditore:</b> ${totalAvailable.toFixed(2)} kWh
<b>Saldo attuale totale:</b> ${admin.balance.toFixed(2)} kWh

Usa /le_mie_donazioni per vedere tutte le donazioni ricevute.
`, {
      parse_mode: 'HTML'
    });
    
    logger.debug(`Notifica donazione inviata all'admin ${donation.adminId}`);
  } catch (err) {
    logger.error(`Errore nella notifica all'admin ${donation.adminId}:`, err);
    // Non rilanciare l'errore per non bloccare l'operazione principale
  }
};

/**
 * Ottiene le statistiche delle donazioni per un utente
 * @param {Number} userId - ID dell'utente
 * @returns {Promise<Object>} Statistiche delle donazioni
 */
const getDonationStats = async (userId) => {
  try {
    // Verifica se l'utente è l'admin
    const { isAdmin } = require('../config/admin');
    const isAdminUser = isAdmin(userId);
    
    if (isAdminUser) {
      // Statistiche per l'admin (donazioni ricevute)
      const receivedDonations = await Donation.find({ adminId: userId });
      
      // Raggruppa per venditore
      const vendorMap = {};
      
      for (const donation of receivedDonations) {
        if (!vendorMap[donation.userId]) {
          vendorMap[donation.userId] = {
            vendorId: donation.userId,
            totalDonated: 0,
            available: 0,
            used: 0,
            donations: []
          };
        }
        
        vendorMap[donation.userId].totalDonated += donation.kwhAmount;
        
        if (donation.isUsed) {
          vendorMap[donation.userId].used += donation.kwhAmount;
        } else {
          vendorMap[donation.userId].available += donation.kwhAmount;
        }
        
        vendorMap[donation.userId].donations.push(donation);
      }
      
      // Calcola i totali
      let totalDonated = 0;
      let totalAvailable = 0;
      let totalUsed = 0;
      
      for (const vendorId in vendorMap) {
        totalDonated += vendorMap[vendorId].totalDonated;
        totalAvailable += vendorMap[vendorId].available;
        totalUsed += vendorMap[vendorId].used;
      }
      
      // Ottieni le informazioni dei venditori
      const vendorIds = Object.keys(vendorMap);
      const vendors = await User.find({ userId: { $in: vendorIds.map(id => parseInt(id)) } });
      
      // Aggiungi le informazioni dei venditori
      for (const vendor of vendors) {
        if (vendorMap[vendor.userId]) {
          vendorMap[vendor.userId].vendorInfo = {
            userId: vendor.userId,
            username: vendor.username,
            firstName: vendor.firstName,
            lastName: vendor.lastName
          };
        }
      }
      
      return {
        isAdmin: true,
        totalDonated,
        totalAvailable,
        totalUsed,
        vendors: Object.values(vendorMap)
      };
    } else {
      // Statistiche per un venditore (donazioni effettuate)
      const madeDonations = await Donation.find({ userId });
      
      // Calcola i totali
      let totalDonated = 0;
      let totalUsed = 0;
      
      for (const donation of madeDonations) {
        totalDonated += donation.kwhAmount;
        if (donation.isUsed) {
          totalUsed += donation.kwhAmount;
        }
      }
      
      return {
        isAdmin: false,
        totalDonated,
        totalUsed,
        available: totalDonated - totalUsed,
        donations: madeDonations
      };
    }
  } catch (err) {
    logger.error(`Errore nel recupero delle statistiche delle donazioni per utente ${userId}:`, err);
    throw err;
  }
};

module.exports = {
  createDonation,
  useAvailableDonations,
  notifyAdminAboutDonation,
  getDonationStats
};
