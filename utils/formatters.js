// Funzioni di formattazione messaggi
const User = require('../models/user');
const logger = require('./logger');

/**
 * Formatta un annuncio di vendita
 * @param {Object} announcement - L'annuncio da formattare
 * @param {Object} user - L'utente proprietario dell'annuncio
 * @returns {String} Testo formattato dell'annuncio
 */
const formatSellAnnouncement = (announcement, user) => {
  // Calcola la percentuale di feedback positivi dell'utente
  let positivePercentage = user.getPositivePercentage();
  
  // Testo per il feedback
  let feedbackText;
  if (positivePercentage === null) {
    feedbackText = '(Nuovo venditore)';
  } else if (user.totalRatings <= 0) {
    feedbackText = '(Nuovo venditore)';
  } else {
    feedbackText = `(${positivePercentage}% positivi, ${user.totalRatings} recensioni)`;
  }
  
  // Badge venditore affidabile
  let trustedBadgeEmoji = '';
  let trustedBadgeText = '';
  if (positivePercentage !== null && positivePercentage >= 90 && user.totalRatings >= 5) {
    trustedBadgeEmoji = '🏆 🛡️';
    trustedBadgeText = 'VENDITORE AFFIDABILE';
  }

  // Formattazione ID annuncio più leggibile
  let displayId = announcement._id;
  // Se l'ID è nel formato personalizzato userId_yyyy-MM-dd_HH-mm
  if (typeof announcement._id === 'string' && announcement._id.includes('_')) {
    // Estrai solo la parte della data/ora
    const idParts = announcement._id.split('_');
    if (idParts.length >= 2) {
      displayId = idParts.slice(1).join('_');
    }
  }

  return `
${trustedBadgeEmoji ? `${trustedBadgeEmoji} ${trustedBadgeText}\n` : ''}*Vendita kWh sharing*
🆔 *ID annuncio:* ${displayId}
👤 *Venditore:* @${user.username || user.firstName}
${user.totalRatings > 0 ? `⭐ *Feedback:* ${feedbackText}\n` : `⭐ ${feedbackText}\n`}

💲 *Prezzo:* ${announcement.price}
⚡ *Corrente:* ${announcement.connectorType === 'both' ? 'AC e DC' : announcement.connectorType}
✅ *Reti attivabili:* ${announcement.brand}
🗺️ *Zone:* ${announcement.location}
${announcement.nonActivatableBrands ? `⛔ *Reti non attivabili:* ${announcement.nonActivatableBrands}\n` : ''}
🕒 *Disponibilità:* ${announcement.additionalInfo.includes('Disponibilità:') ? announcement.additionalInfo.split('Disponibilità:')[1].split('\n')[0].trim() : 'Non specificata'}
💰 *Pagamento:* ${announcement.additionalInfo.includes('Metodi di pagamento:') ? announcement.additionalInfo.split('Metodi di pagamento:')[1].split('\n')[0].trim() : 'PayPal, bonifico, contanti (da specificare)'}
${announcement.additionalInfo && !announcement.additionalInfo.includes('Disponibilità:') && !announcement.additionalInfo.includes('Metodi di pagamento:') ? `📋 *Condizioni:* ${announcement.additionalInfo}` : '📋 *Condizioni:* Non specificate'}

📝 _Dopo la compravendita, il venditore inviterà l'acquirente a esprimere un giudizio sulla transazione._
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
    activeAnnouncementsText += '\n\n*Annuncio di vendita attivo:*\n';
    activeAnnouncementsText += `• *Prezzo:* ${sellAnnouncement.price}\n`;
    activeAnnouncementsText += `• *Corrente:* ${sellAnnouncement.connectorType === 'both' ? 'AC e DC' : sellAnnouncement.connectorType}\n`;
    activeAnnouncementsText += `• *Località:* ${sellAnnouncement.location}\n`;
  }
  
  if (buyAnnouncement && buyAnnouncement.status === 'active') {
    activeAnnouncementsText += '\n\n*Annuncio di acquisto attivo:*\n';
    activeAnnouncementsText += `• *Prezzo massimo:* ${buyAnnouncement.price}\n`;
    activeAnnouncementsText += `• *Corrente:* ${buyAnnouncement.connectorType === 'both' ? 'AC e DC' : buyAnnouncement.connectorType}\n`;
    activeAnnouncementsText += `• *Località:* ${buyAnnouncement.location}\n`;
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
      
      transactionsText += `• ${date}: ${role} di ${amount} kWh a ${total}€\n`;
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

/**
 * Formatta il messaggio di benvenuto con i comandi disponibili
 * @returns {String} Testo formattato del messaggio di benvenuto
 */
const formatWelcomeMessage = () => {
  return `
👋 *Benvenuto nel bot di compravendita kWh!*

Questo bot ti permette di vendere o comprare kWh per la ricarica di veicoli elettrici.

🔌 *Comandi disponibili:*
• /vendi_kwh - Crea un annuncio per vendere kWh
• /le_mie_ricariche - Visualizza le tue ricariche attive
• /profilo - Visualizza il tuo profilo
• /archivia_annuncio - Archivia il tuo annuncio attivo
• /help - Mostra questo messaggio di aiuto

Se hai domande, contatta @admin_username.
`;
};

module.exports = {
  formatSellAnnouncement,
  formatChargeRequest,
  formatOfferListItem,
  formatUserProfile,
  formatWelcomeMessage
};
