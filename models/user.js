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
  transactions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' }]
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

// Crea il modello User
const User = mongoose.model('User', userSchema);

module.exports = User;
