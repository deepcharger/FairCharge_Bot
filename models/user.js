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
    sell: { type: mongoose.Schema.Types.ObjectId, ref: 'Announcement', default: null },
    buy: { type: mongoose.Schema.Types.ObjectId, ref: 'Announcement', default: null }
  },
  transactions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' }]
});

// Calcola la percentuale di feedback positivi
userSchema.methods.getPositivePercentage = function() {
  if (this.totalRatings === 0) return null;
  return Math.round((this.positiveRatings / this.totalRatings) * 100);
};

// Controlla se l'utente è un venditore affidabile
userSchema.methods.isTrustedSeller = function() {
  const percentage = this.getPositivePercentage();
  return percentage !== null && percentage >= 90;
};

// Crea il modello User
const User = mongoose.model('User', userSchema);

module.exports = User;
