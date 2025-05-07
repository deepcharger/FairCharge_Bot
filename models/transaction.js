// Schema per le transazioni
const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  offerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Offer', required: true },
  sellerId: { type: Number, required: true },
  buyerId: { type: Number, required: true },
  kwhAmount: { type: Number, required: true },
  price: { type: Number, required: true },
  totalAmount: { type: Number, required: true },
  paymentMethod: { type: String, required: true },
  status: { type: String, enum: ['completed', 'disputed'], default: 'completed' },
  createdAt: { type: Date, default: Date.now }
});

// Metodo per calcolare il prezzo per kWh
transactionSchema.methods.getPricePerKwh = function() {
  return this.kwhAmount > 0 ? this.totalAmount / this.kwhAmount : 0;
};

// Metodo per contrassegnare la transazione come contestata
transactionSchema.methods.dispute = function() {
  this.status = 'disputed';
  return this.save();
};

// Crea il modello Transaction
const Transaction = mongoose.model('Transaction', transactionSchema);

module.exports = Transaction;
