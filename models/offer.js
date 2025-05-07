// Schema per le offerte/prenotazioni
const mongoose = require('mongoose');
const moment = require('moment');

const offerSchema = new mongoose.Schema({
  announcementId: { type: mongoose.Schema.Types.ObjectId, ref: 'Announcement' },
  buyerId: { type: Number, required: true },
  sellerId: { type: Number, required: true },
  date: { type: Date, required: true },
  time: { type: String, required: true },
  brand: { type: String, required: true },
  coordinates: { type: String, required: true },
  additionalInfo: { type: String, default: '' },
  status: { 
    type: String, 
    enum: [
      'pending', 
      'accepted', 
      'rejected', 
      'ready_to_charge',
      'charging_started',
      'charging',
      'charging_completed',
      'kwh_confirmed',
      'payment_pending',
      'payment_sent',
      'completed',
      'disputed',
      'cancelled'
    ], 
    default: 'pending' 
  },
  kwhCharged: { type: Number },
  totalAmount: { type: Number },
  paymentMethod: { type: String },
  paymentDetails: { type: String },
  rejectionReason: { type: String },
  chargerConnector: { type: String },
  chargerPhoto: { type: String },
  sellerFeedback: {
    rating: { type: Boolean },
    comment: { type: String }
  },
  buyerFeedback: {
    rating: { type: Boolean },
    comment: { type: String }
  },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date },
  completedAt: { type: Date }
});

// Metodo per aggiornare lo stato dell'offerta
offerSchema.methods.updateStatus = function(newStatus) {
  this.status = newStatus;
  return this.save();
};

// Metodo per calcolare la data di scadenza
offerSchema.methods.calculateExpiryDate = function() {
  return moment(this.date)
    .hour(parseInt(this.time.split(':')[0]))
    .minute(parseInt(this.time.split(':')[1]))
    .add(24, 'hours')
    .toDate();
};

// Metodo per verificare se l'offerta è scaduta
offerSchema.methods.isExpired = function() {
  return this.expiresAt && moment().isAfter(this.expiresAt);
};

// Metodo per completare l'offerta
offerSchema.methods.complete = function() {
  this.status = 'completed';
  this.completedAt = new Date();
  return this.save();
};

// Crea il modello Offer
const Offer = mongoose.model('Offer', offerSchema);

module.exports = Offer;
