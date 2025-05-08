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
${trustedBadgeEmoji ? `${trustedBadgeEmoji} ${trustedBadgeText}\n` : ''}<b>Vendita kWh sharing</b>
🆔 <b>ID annuncio:</b> ${displayId}
👤 <b>Venditore:</b> @${user.username || user.firstName}
${user.totalRatings > 0 ? `⭐ <b>Feedback:</b> ${feedbackText}\n` : feedbackText}

💲 <b>Prezzo:</b> ${announcement.price}
⚡ <b>Corrente:</b> ${announcement.connectorType === 'both' ? 'AC e DC' : announcement.connectorType}
✅ <b>Reti attivabili:</b> ${announcement.brand}
🗺️ <b>Zone:</b> ${announcement.location}
${announcement.nonActivatableBrands ? `⛔ <b>Reti non attivabili:</b> ${announcement.nonActivatableBrands}\n` : ''}
🕒 <b>Disponibilità:</b> ${announcement.additionalInfo.includes('Disponibilità:') ? announcement.additionalInfo.split('Disponibilità:')[1].split('\n')[0].trim() : 'Non specificata'}
💰 <b>Pagamento:</b> ${announcement.additionalInfo.includes('Metodi di pagamento:') ? announcement.additionalInfo.split('Metodi di pagamento:')[1].split('\n')[0].trim() : 'PayPal, bonifico, contanti (da specificare)'}
📋 <b>Condizioni:</b> Non specificate

📝 Dopo la compravendita, il venditore inviterà l'acquirente a esprimere un giudizio sulla transazione.
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
🔋 <b>Richiesta di ricarica</b> 🔋

📅 <b>Data:</b> ${offer.date}
🕙 <b>Ora:</b> ${offer.time}
🏭 <b>Colonnina:</b> ${offer.brand}
📍 <b>Posizione:</b> ${offer.coordinates}
${offer.additionalInfo ? `ℹ️ <b>Info aggiuntive:</b> ${offer.additionalInfo}\n` : ''}

💰 <b>Prezzo venditore:</b> ${seller.announcement ? seller.announcement.price : 'Non specificato'}
👤 <b>Venditore:</b> ${seller.username ? '@' + seller.username : seller.firstName}
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
    activeAnnouncementsText += '\n<b>Annuncio di vendita attivo:</b>\n';
    activeAnnouncementsText += `- Prezzo: ${sellAnnouncement.price}\n`;
    activeAnnouncementsText += `- Corrente: ${sellAnnouncement.connectorType === 'both' ? 'AC e DC' : sellAnnouncement.connectorType}\n`;
    activeAnnouncementsText += `- Località: ${sellAnnouncement.location}\n`;
  }
  
  if (buyAnnouncement && buyAnnouncement.status === 'active') {
    activeAnnouncementsText += '\n<b>Annuncio di acquisto attivo:</b>\n';
    activeAnnouncementsText += `- Prezzo massimo: ${buyAnnouncement.price}\n`;
    activeAnnouncementsText += `- Corrente: ${buyAnnouncement.connectorType === 'both' ? 'AC e DC' : buyAnnouncement.connectorType}\n`;
    activeAnnouncementsText += `- Località: ${buyAnnouncement.location}\n`;
  }
  
  // Formatta le transazioni recenti
  let transactionsText = '';
  if (transactions && transactions.length > 0) {
    transactionsText = '\n\n<b>Ultime transazioni:</b>\n';
    
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
👤 <b>Il tuo profilo</b>

<b>Nome:</b> ${user.firstName || ''}${user.lastName ? ' ' + user.lastName : ''}
<b>Username:</b> ${user.username ? '@' + user.username : 'Non impostato'}
<b>Iscritto dal:</b> ${user.registrationDate.toLocaleDateString('it-IT')}
<b>Feedback:</b> ${feedbackText}
<b>Saldo kWh:</b> ${balance}${activeAnnouncementsText}${transactionsText}
`;
};

/**
 * Formatta il messaggio di benvenuto con i comandi disponibili
 * @returns {String} Testo formattato del messaggio di benvenuto
 */
const formatWelcomeMessage = () => {
  return `
👋 <b>Benvenuto nel bot di compravendita kWh!</b>

Questo bot ti permette di vendere o comprare kWh per la ricarica di veicoli elettrici.

🔌 <b>Comandi disponibili:</b>
/vendi_kwh - Crea un annuncio per vendere kWh
/le_mie_ricariche - Visualizza le tue ricariche attive
/profilo - Visualizza il tuo profilo
/archivia_annuncio - Archivia il tuo annuncio attivo
/help - Mostra questo messaggio di aiuto

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
