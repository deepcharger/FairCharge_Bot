// Schema per le donazioni
const mongoose = require('mongoose');

const donationSchema = new mongoose.Schema({
  userId: { type: Number, required: true },
  adminId: { type: Number, required: true },
  kwhAmount: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now }
});

// Metodo statico per trovare le donazioni di un utente
donationSchema.statics.findByUserId = function(userId) {
  return this.find({ userId: userId }).sort({ createdAt: -1 });
};

// Metodo statico per calcolare il totale delle donazioni di un utente
donationSchema.statics.getTotalDonationsByUser = async function(userId) {
  const result = await this.aggregate([
    { $match: { userId: userId } },
    { $group: { _id: null, total: { $sum: "$kwhAmount" } } }
  ]);
  
  return result.length > 0 ? result[0].total : 0;
};

// Crea il modello Donation
const Donation = mongoose.model('Donation', donationSchema);

module.exports = Donation;
