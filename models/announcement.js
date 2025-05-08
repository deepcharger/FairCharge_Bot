// Schema per gli annunci
const mongoose = require('mongoose');

const announcementSchema = new mongoose.Schema({
  _id: { type: String }, // Consentiamo ID personalizzati
  type: { type: String, enum: ['sell', 'buy'], required: true },
  userId: { type: Number, required: true },
  messageId: { type: Number },
  price: { type: String, required: true },
  connectorType: { type: String, enum: ['AC', 'DC', 'both'], required: true },
  brand: { type: String, required: true },
  location: { type: String, required: true },
  nonActivatableBrands: { type: String, default: '' },
  additionalInfo: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  status: { type: String, enum: ['active', 'archived', 'completed'], default: 'active' },
  offers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Offer' }]
}, { _id: false }); // Disabilitiamo la generazione automatica dell'ID

// Metodo per archiviare l'annuncio
announcementSchema.methods.archive = async function() {
  this.status = 'archived';
  return this.save();
};

// Metodo per aggiungere un'offerta all'annuncio
announcementSchema.methods.addOffer = async function(offerId) {
  this.offers.push(offerId);
  return this.save();
};

// Crea il modello Announcement
const Announcement = mongoose.model('Announcement', announcementSchema);

module.exports = Announcement;
