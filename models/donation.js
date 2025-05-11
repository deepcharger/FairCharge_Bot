// Schema per le donazioni
const mongoose = require('mongoose');

const donationSchema = new mongoose.Schema({
  userId: { type: Number, required: true }, // ID del venditore donatore
  adminId: { type: Number, required: true }, // ID dell'admin che riceve
  kwhAmount: { type: Number, required: true }, // Quantità donata
  isUsed: { type: Boolean, default: false }, // Se è stata utilizzata
  usedInOfferId: { type: mongoose.Schema.Types.ObjectId, ref: 'Offer' }, // Offerta in cui è stata utilizzata
  createdAt: { type: Date, default: Date.now }
});

/**
 * Metodo statico per trovare le donazioni di un utente
 * @param {Number} userId - ID dell'utente donatore
 * @returns {Promise<Array>} Lista di donazioni
 */
donationSchema.statics.findByUserId = function(userId) {
  return this.find({ userId: userId }).sort({ createdAt: -1 });
};

/**
 * Metodo statico per trovare le donazioni ricevute da un admin
 * @param {Number} adminId - ID dell'admin
 * @returns {Promise<Array>} Lista di donazioni
 */
donationSchema.statics.findByAdminId = function(adminId) {
  return this.find({ adminId: adminId }).sort({ createdAt: -1 });
};

/**
 * Metodo statico per trovare le donazioni non utilizzate da un venditore specifico a un admin
 * @param {Number} adminId - ID dell'admin
 * @param {Number} vendorId - ID del venditore
 * @returns {Promise<Array>} Lista di donazioni non utilizzate
 */
donationSchema.statics.findAvailableFromVendor = function(adminId, vendorId) {
  return this.find({ 
    adminId: adminId,
    userId: vendorId,
    isUsed: false
  }).sort({ createdAt: 1 }); // Ordina per data (le più vecchie prima)
};

/**
 * Metodo statico per calcolare il totale delle donazioni disponibili da un venditore
 * @param {Number} adminId - ID dell'admin
 * @param {Number} vendorId - ID del venditore
 * @returns {Promise<Number>} Totale kWh disponibili
 */
donationSchema.statics.getTotalAvailableFromVendor = async function(adminId, vendorId) {
  const result = await this.aggregate([
    { 
      $match: { 
        adminId: adminId,
        userId: vendorId,
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
  
  return result.length > 0 ? result[0].total : 0;
};

/**
 * Metodo statico per calcolare il totale delle donazioni utilizzate con un venditore
 * @param {Number} adminId - ID dell'admin
 * @param {Number} vendorId - ID del venditore
 * @returns {Promise<Number>} Totale kWh utilizzati
 */
donationSchema.statics.getTotalUsedWithVendor = async function(adminId, vendorId) {
  const result = await this.aggregate([
    { 
      $match: { 
        adminId: adminId,
        userId: vendorId,
        isUsed: true
      } 
    },
    { 
      $group: { 
        _id: null, 
        total: { $sum: "$kwhAmount" } 
      } 
    }
  ]);
  
  return result.length > 0 ? result[0].total : 0;
};

/**
 * Metodo statico per ottenere un riepilogo delle donazioni per venditore
 * @param {Number} adminId - ID dell'admin
 * @returns {Promise<Array>} Riepilogo per venditore
 */
donationSchema.statics.getVendorSummary = async function(adminId) {
  return this.aggregate([
    { 
      $match: { 
        adminId: adminId
      } 
    },
    { 
      $group: { 
        _id: "$userId", 
        totalDonated: { $sum: "$kwhAmount" },
        availableAmount: { 
          $sum: { 
            $cond: [
              { $eq: ["$isUsed", false] },
              "$kwhAmount",
              0
            ]
          }
        },
        usedAmount: { 
          $sum: { 
            $cond: [
              { $eq: ["$isUsed", true] },
              "$kwhAmount",
              0
            ]
          }
        },
        count: { $sum: 1 },
        lastDonation: { $max: "$createdAt" }
      } 
    },
    {
      $sort: { availableAmount: -1 } // Ordina per quantità disponibile (dal più alto al più basso)
    }
  ]);
};

// Crea il modello Donation
const Donation = mongoose.model('Donation', donationSchema);

module.exports = Donation;
