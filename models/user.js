// models/user.js (AGGIORNATO COMPLETO)
// Schema per gli utenti con funzionalità di whitelist e sicurezza
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
  
  // Campi per la whitelist manuale
  isWhitelisted: { type: Boolean, default: false },
  whitelistReason: String,
  whitelistedBy: Number, // ID dell'admin che ha approvato
  whitelistedAt: Date,
  
  // Campi per la sicurezza e analisi rischio
  riskScore: { type: Number, default: 0 },
  riskLevel: { type: String, enum: ['low', 'medium', 'high', 'unknown'], default: 'low' },
  securityFlags: [{
    type: String,
    severity: String,
    description: String,
    detectedAt: { type: Date, default: Date.now }
  }],
  isBlocked: { type: Boolean, default: false },
  blockedReason: String,
  blockedBy: Number,
  blockedAt: Date,
  
  // Campi per verifica membership
  lastMembershipCheck: Date,
  authorizedGroups: [Number], // Lista dei gruppi di cui è membro
  isVipMember: { type: Boolean, default: false },
  
  activeAnnouncements: {
    sell: { type: String, ref: 'Announcement', default: null },
    buy: { type: String, ref: 'Announcement', default: null }
  },
  transactions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' }],
  
  // Campo per il portafoglio dettagliato
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
  // O se è in whitelist con almeno 3 recensioni positive
  const standardCriteria = percentage !== null && percentage >= 90 && this.totalRatings >= 5;
  const whitelistCriteria = this.isWhitelisted && this.positiveRatings >= 3;
  
  return standardCriteria || whitelistCriteria;
};

/**
 * Verifica se l'utente può utilizzare funzionalità avanzate
 * @returns {Boolean} true se può utilizzare funzionalità avanzate
 */
userSchema.methods.canUseAdvancedFeatures = function() {
  return this.isWhitelisted && !this.isBlocked;
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
      totalTransactions: 1,
      kwhExchanged: kwhAmount,
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

/**
 * Blocca l'utente
 * @param {String} reason - Motivo del blocco
 * @param {Number} blockedBy - ID dell'admin che blocca
 * @returns {Promise<void>}
 */
userSchema.methods.blockUser = async function(reason, blockedBy) {
  this.isBlocked = true;
  this.blockedReason = reason;
  this.blockedBy = blockedBy;
  this.blockedAt = new Date();
  
  return this.save();
};

/**
 * Sblocca l'utente
 * @returns {Promise<void>}
 */
userSchema.methods.unblockUser = async function() {
  this.isBlocked = false;
  this.blockedReason = undefined;
  this.blockedBy = undefined;
  this.blockedAt = undefined;
  
  return this.save();
};

/**
 * Aggiunge un flag di sicurezza
 * @param {String} type - Tipo di flag
 * @param {String} severity - Gravità (low, medium, high)
 * @param {String} description - Descrizione
 * @returns {Promise<void>}
 */
userSchema.methods.addSecurityFlag = async function(type, severity, description) {
  if (!this.securityFlags) {
    this.securityFlags = [];
  }
  
  this.securityFlags.push({
    type,
    severity,
    description,
    detectedAt: new Date()
  });
  
  // Aggiorna il risk score
  const severityPoints = { low: 1, medium: 2, high: 3 };
  this.riskScore += severityPoints[severity] || 1;
  
  // Aggiorna il risk level
  if (this.riskScore >= 7) {
    this.riskLevel = 'high';
  } else if (this.riskScore >= 4) {
    this.riskLevel = 'medium';
  } else {
    this.riskLevel = 'low';
  }
  
  return this.save();
};

/**
 * Aggiorna i gruppi autorizzati dell'utente
 * @param {Array} groupIds - Array degli ID dei gruppi
 * @returns {Promise<void>}
 */
userSchema.methods.updateAuthorizedGroups = async function(groupIds) {
  this.authorizedGroups = groupIds;
  this.lastMembershipCheck = new Date();
  return this.save();
};

// Crea il modello User
const User = mongoose.model('User', userSchema);

module.exports = User;
