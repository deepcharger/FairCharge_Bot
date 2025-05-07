// Funzioni di formattazione messaggi
const User = require('../models/user');

/**
 * Formatta un annuncio di vendita
 * @param {Object} announcement - L'annuncio da formattare
 * @param {Object} user - L'utente proprietario dell'annuncio
 * @returns {String} Testo formattato dell'annuncio
 */
const formatSellAnnouncement = (announcement, user) => {
  let positivePercentage = user.getPositivePercentage();
  let feedbackText = positivePercentage ? 
    `\n👍 Feedback positivo: ${positivePercentage}%` :
    '\n👤 Nuovo venditore';
  
  let trustedBadge = '';
  if (user.isTrustedSeller()) {
    trustedBadge = ' ✅ Venditore affidabile';
  }

  return `
🔋 *VENDO kWh* 🔋

💰 *Prezzo:* ${announcement.price}
🔌 *Tipo connettore:* ${announcement.connectorType === 'both' ? 'AC e DC' : announcement.connectorType}
🏭 *Colonnina:* ${announcement.brand}
📍 *Dove:* ${announcement.location}
${announcement.nonActivatableBrands ? `⛔ *Non attivabile:* ${announcement.nonActivatableBrands}\n` : ''}
${announcement.additionalInfo ? `ℹ️ *Info aggiuntive:* ${announcement.additionalInfo}\n` : ''}
${feedbackText}${trustedBadge}

👤 Venditore: ${user.username ? '@' + user.username : user.firstName}
`;
};

/**
 * Formatta l'anteprima di una richiesta di ricarica
 * @param {Object} offer - L'offerta da formattare
 * @param {Object} seller - Il venditore
 * @returns {String} Testo formattato della richiesta
 */
const formatChargeRequest = (offer, seller) => {
  return `
🔋 *Richiesta di ricarica* 🔋

📅 *Data:* ${offer.date}
🕙 *Ora:* ${offer.time}
🏭 *Colonnina:* ${offer.brand}
📍 *Posizione:* ${offer.coordinates}
${offer.additionalInfo ? `ℹ️ *Info aggiuntive:* ${offer.additionalInfo}\n` : ''}

💰 *Prezzo venditore:* ${seller.announcement ? seller.announcement.price : 'Non specificato'}
👤 *Venditore:* ${seller.username ? '@' + seller.username : seller.firstName}
`;
};

/**
 * Formatta un elemento della lista delle ricariche
 * @param {Object} offer - L'offerta da formattare
 * @param {Number} index - L'indice dell'offerta nella lista
 * @param {Object} otherUser - L'altro utente coinvolto
 * @param {String} role - Il ruolo dell'utente (Acquirente o Venditore)
 * @returns {String} Testo formattato dell'elemento
 */
const formatOfferListItem = (offer, index, otherUser, role) => {
  const otherUserName = otherUser ? 
    (otherUser.username ? '@' + otherUser.username : otherUser.firstName) : 
    'Utente sconosciuto';
  
  const formattedDate = offer.date instanceof Date ? 
    offer.date.toLocaleDateString('it-IT') : 
    offer.date;
  
  return `${index + 1}. ${formattedDate} ${offer.time} - ${otherUserName} (${role})`;
};

/**
 * Formatta il profilo di un utente
 * @param {Object} user - L'utente di cui formattare il profilo
 * @param {Array} transactions - Le transazioni dell'utente
 * @param {Object} sellAnnouncement - L'annuncio di vendita attivo dell'utente
 * @param {Object} buyAnnouncement - L'annuncio di acquisto attivo dell'utente
 * @returns {String} Testo formattato del profilo
 */
const formatUserProfile = (user, transactions, sellAnnouncement, buyAnnouncement) => {
  // Calcola percentuale feedback
  const positivePercentage = user.getPositivePercentage();
  const feedbackText = positivePercentage !== null ? 
    `${positivePercentage}% positivo (${user.positiveRatings}/${user.totalRatings})` :
    'Nessun feedback ricevuto';
  
  // Formatta il saldo
  const balance = user.balance.toFixed(2);
  
  // Formatta gli annunci attivi
  let activeAnnouncementsText = '';
  
  if (sellAnnouncement && sellAnnouncement.status === 'active') {
    activeAnnouncementsText += '\n*Annuncio di vendita attivo:*\n';
    activeAnnouncementsText += `- Prezzo: ${sellAnnouncement.price}\n`;
    activeAnnouncementsText += `- Tipo: ${sellAnnouncement.connectorType === 'both' ? 'AC e DC' : sellAnnouncement.connectorType}\n`;
    activeAnnouncementsText += `- Località: ${sellAnnouncement.location}\n`;
  }
  
  if (buyAnnouncement && buyAnnouncement.status === 'active') {
    activeAnnouncementsText += '\n*Annuncio di acquisto attivo:*\n';
    activeAnnouncementsText += `- Prezzo massimo: ${buyAnnouncement.price}\n`;
    activeAnnouncementsText += `- Tipo: ${buyAnnouncement.connectorType === 'both' ? 'AC e DC' : buyAnnouncement.connectorType}\n`;
    activeAnnouncementsText += `- Località: ${buyAnnouncement.location}\n`;
  }
  
  // Formatta le transazioni recenti
  let transactionsText = '';
  if (transactions && transactions.length > 0) {
    transactionsText = '\n\n*Ultime transazioni:*\n';
    
    for (const transaction of transactions) {
      const date = transaction.createdAt.toLocaleDateString('it-IT');
      const role = transaction.sellerId === user.userId ? 'Vendita' : 'Acquisto';
      const amount = transaction.kwhAmount.toFixed(2);
      const total = transaction.totalAmount.toFixed(2);
      
      transactionsText += `- ${date}: ${role} di ${amount} kWh a ${total}€\n`;
    }
  }
  
  // Costruisci il profilo completo
  return `
👤 *Il tuo profilo*

*Nome:* ${user.firstName || ''}${user.lastName ? ' ' + user.lastName : ''}
*Username:* ${user.username ? '@' + user.username : 'Non impostato'}
*Iscritto dal:* ${user.registrationDate.toLocaleDateString('it-IT')}
*Feedback:* ${feedbackText}
*Saldo kWh:* ${balance}${activeAnnouncementsText}${transactionsText}
`;
};

module.exports = {
  formatSellAnnouncement,
  formatChargeRequest,
  formatOfferListItem,
  formatUserProfile
};
