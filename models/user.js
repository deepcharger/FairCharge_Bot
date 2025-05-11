// Schema per gli utenti
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  userId: { type: Number, required: true, unique: true },
  username: String,
  firstName: String,
  lastName: String,
  registrationDate: { type: Date, default: Date.now },
  positiveRatings: { type: Number, default: 0 },
  totalRatings: { type: Number, default: 0 },
  balance: { type: Number, default: 0 }, // saldo in kWh
  activeAnnouncements: {
    sell: { type: String, ref: 'Announcement', default: null },
    buy: { type: String, ref: 'Announcement', default: null }
  },
  transactions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' }],
  // Nuovo campo per il portafoglio dettagliato
  walletDetails: {
    walletLastUpdated: { type: Date },
    partners: [{ 
      partnerId: { type: Number, required: true },
      partnerName: String,
      totalTransactions: { type: Number, default: 0 },
      kwhExchanged: { type: Number, default: 0 },
      lastTransactionDate: { type: Date }
    }]
  }
});

/**
 * Calcola la percentuale di feedback positivi
 * @returns {Number|null} Percentuale di feedback positivi o null se non ci sono recensioni
 */
userSchema.methods.getPositivePercentage = function() {
  if (this.totalRatings === 0) return null;
  
  // Arrotonda a due decimali e converte in numero intero
  const percentage = Math.round((this.positiveRatings / this.totalRatings) * 100);
  return percentage;
};

/**
 * Controlla se l'utente è un venditore affidabile
 * @returns {Boolean} true se il venditore è affidabile
 */
userSchema.methods.isTrustedSeller = function() {
  const percentage = this.getPositivePercentage();
  // Venditore affidabile se ha almeno 90% di feedback positivi e almeno 5 recensioni
  return percentage !== null && percentage >= 90 && this.totalRatings >= 5;
};

/**
 * Aggiorna i dettagli del portafoglio con un partner
 * @param {Number} partnerId - ID del partner
 * @param {String} partnerName - Nome del partner
 * @param {Number} kwhAmount - Quantità di kWh scambiati
 * @returns {Promise<void>}
 */
userSchema.methods.updateWalletPartner = async function(partnerId, partnerName, kwhAmount) {
  // Inizializza il wallet se non esiste
  if (!this.walletDetails) {
    this.walletDetails = {
      walletLastUpdated: new Date(),
      partners: []
    };
  }
  
  // Cerca il partner esistente
  let partner = this.walletDetails.partners.find(p => p.partnerId === partnerId);
  
  // Se non esiste, lo crea
  if (!partner) {
    partner = {
      partnerId: partnerId,
      partnerName: partnerName,
      totalTransactions: 0,
      kwhExchanged: 0,
      lastTransactionDate: new Date()
    };
    this.walletDetails.partners.push(partner);
  } 
  // Altrimenti, aggiorna i dettagli
  else {
    partner.partnerName = partnerName;
    partner.totalTransactions += 1;
    partner.kwhExchanged += kwhAmount;
    partner.lastTransactionDate = new Date();
  }
  
  // Aggiorna il timestamp dell'ultimo aggiornamento
  this.walletDetails.walletLastUpdated = new Date();
  
  // Salva le modifiche
  return this.save();
};

// Crea il modello User
const User = mongoose.model('User', userSchema);

module.exports = User;
