// Funzioni di formattazione messaggi
const User = require('../models/user');
const logger = require('./logger');

/**
 * Escapa correttamente i caratteri speciali per Telegram Markdown V2
 * @param {String} text - Testo da escapare
 * @returns {String} Testo escapato
 */
const escapeMarkdownV2 = (text) => {
  if (!text) return '';
  // Escape dei caratteri speciali di Markdown V2
  return text
    .replace(/_/g, '\\_')
    .replace(/\*/g, '\\*')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/~/g, '\\~')
    .replace(/`/g, '\\`')
    .replace(/>/g, '\\>')
    .replace(/#/g, '\\#')
    .replace(/\+/g, '\\+')
    .replace(/-/g, '\\-')
    .replace(/=/g, '\\=')
    .replace(/\|/g, '\\|')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\./g, '\\.')
    .replace(/!/g, '\\!');
};

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

  // Escape di tutte le stringhe di input
  const escapedBrand = escapeMarkdownV2(announcement.brand || '');
  const escapedLocation = escapeMarkdownV2(announcement.location || '');
  const escapedNonActivatableBrands = escapeMarkdownV2(announcement.nonActivatableBrands || '');
  
  // Estrazione info di disponibilità e pagamento dall'additionalInfo
  let availabilityInfo = 'Non specificata';
  let paymentInfo = 'PayPal, bonifico, contanti (da specificare)';
  let otherInfo = '';
  
  if (announcement.additionalInfo) {
    const additionalInfo = announcement.additionalInfo;
    
    // Estrai la disponibilità
    if (additionalInfo.includes('Disponibilità:')) {
      const availabilityLine = additionalInfo
        .split('Disponibilità:')[1]
        .split('\n')[0]
        .trim();
      if (availabilityLine) {
        availabilityInfo = escapeMarkdownV2(availabilityLine);
      }
    }
    
    // Estrai i metodi di pagamento
    if (additionalInfo.includes('Metodi di pagamento:')) {
      const paymentLine = additionalInfo
        .split('Metodi di pagamento:')[1]
        .split('\n')[0]
        .trim();
      if (paymentLine) {
        paymentInfo = escapeMarkdownV2(paymentLine);
      }
    }
    
    // Altre info (escludi disponibilità e pagamento)
    const lines = additionalInfo.split('\n');
    const otherLines = lines.filter(line => 
      !line.includes('Disponibilità:') && 
      !line.includes('Metodi di pagamento:')
    );
    
    if (otherLines.length > 0) {
      otherInfo = escapeMarkdownV2(otherLines.join('\n'));
    }
  }

  // Escape dei nomi utente
  const escapedUsername = escapeMarkdownV2(user.username || user.firstName);

  // Costruisci il testo del messaggio con Markdown V2
  const message = `${trustedBadgeEmoji ? `${trustedBadgeEmoji} ${trustedBadgeText}\n\n` : ''}*Vendita kWh sharing*

🆔 *ID annuncio:* ${displayId}
👤 *Venditore:* @${escapedUsername}
${user.totalRatings > 0 ? `⭐ *Feedback:* ${feedbackText}` : `⭐ ${feedbackText}`}

💲 *Prezzo:* ${announcement.price}
⚡ *Corrente:* ${announcement.connectorType === 'both' ? 'AC e DC' : announcement.connectorType}
✅ *Reti attivabili:* ${escapedBrand}
🗺️ *Zone:* ${escapedLocation}
${announcement.nonActivatableBrands ? `⛔ *Reti non attivabili:* ${escapedNonActivatableBrands}\n` : ''}🕒 *Disponibilità:* ${availabilityInfo}
💰 *Pagamento:* ${paymentInfo}
${otherInfo ? `📋 *Condizioni:* ${otherInfo}\n` : '📋 *Condizioni:* Non specificate\n'}
📝 _Dopo la compravendita, il venditore inviterà l'acquirente a esprimere un giudizio sulla transazione\\._`;

  return message;
};

/**
 * Formatta l'anteprima di una richiesta di ricarica
 * @param {Object} offer - L'offerta da formattare
 * @param {Object} seller - Il venditore
 * @returns {String} Testo formattato della richiesta
 */
const formatChargeRequest = (offer, seller) => {
  const escapedBrand = escapeMarkdownV2(offer.brand || '');
  const escapedCoordinates = escapeMarkdownV2(offer.coordinates || '');
  const escapedAdditionalInfo = offer.additionalInfo ? escapeMarkdownV2(offer.additionalInfo) : '';

  // Escape dei nomi utente
  const escapedUsername = escapeMarkdownV2(seller.username || seller.firstName);

  return `
🔋 *Richiesta di ricarica* 🔋

📅 *Data:* ${offer.date}
🕙 *Ora:* ${offer.time}
🏭 *Colonnina:* ${escapedBrand}
📍 *Posizione:* ${escapedCoordinates}
${escapedAdditionalInfo ? `ℹ️ *Info aggiuntive:* ${escapedAdditionalInfo}\n` : ''}

💰 *Prezzo venditore:* ${seller.announcement ? seller.announcement.price : 'Non specificato'}
👤 *Venditore:* ${seller.username ? '@' + escapedUsername : escapedUsername}
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
    (otherUser.username ? '@' + escapeMarkdownV2(otherUser.username) : escapeMarkdownV2(otherUser.firstName)) : 
    'Utente sconosciuto';
  
  const formattedDate = offer.date instanceof Date ? 
    offer.date.toLocaleDateString('it-IT') : 
    offer.date;
  
  return `${index + 1}\\. ${formattedDate} ${offer.time} \\- ${otherUserName} \\(${role}\\)`;
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
  
  // Escape dei nomi
  const escapedFirstName = escapeMarkdownV2(user.firstName || '');
  const escapedLastName = user.lastName ? escapeMarkdownV2(user.lastName) : '';
  const escapedUsername = user.username ? escapeMarkdownV2(user.username) : 'Non impostato';
  
  // Formatta gli annunci attivi
  let activeAnnouncementsText = '';
  
  if (sellAnnouncement && sellAnnouncement.status === 'active') {
    activeAnnouncementsText += '\n\n*Annuncio di vendita attivo:*\n';
    activeAnnouncementsText += `• *Prezzo:* ${sellAnnouncement.price}\n`;
    activeAnnouncementsText += `• *Corrente:* ${sellAnnouncement.connectorType === 'both' ? 'AC e DC' : sellAnnouncement.connectorType}\n`;
    activeAnnouncementsText += `• *Località:* ${escapeMarkdownV2(sellAnnouncement.location)}\n`;
  }
  
  if (buyAnnouncement && buyAnnouncement.status === 'active') {
    activeAnnouncementsText += '\n\n*Annuncio di acquisto attivo:*\n';
    activeAnnouncementsText += `• *Prezzo massimo:* ${buyAnnouncement.price}\n`;
    activeAnnouncementsText += `• *Corrente:* ${buyAnnouncement.connectorType === 'both' ? 'AC e DC' : buyAnnouncement.connectorType}\n`;
    activeAnnouncementsText += `• *Località:* ${escapeMarkdownV2(buyAnnouncement.location)}\n`;
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

*Nome:* ${escapedFirstName}${escapedLastName ? ' ' + escapedLastName : ''}
*Username:* ${user.username ? '@' + escapedUsername : escapedUsername}
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
👋 *Benvenuto nel bot di compravendita kWh\\!*

Questo bot ti permette di vendere o comprare kWh per la ricarica di veicoli elettrici\\.

🔌 *Comandi disponibili:*
• /vendi\\_kwh \\- Crea un annuncio per vendere kWh
• /le\\_mie\\_ricariche \\- Visualizza le tue ricariche attive
• /profilo \\- Visualizza il tuo profilo
• /archivia\\_annuncio \\- Archivia il tuo annuncio attivo
• /help \\- Mostra questo messaggio di aiuto

Se hai domande, contatta @admin\\_username\\.
`;
};

module.exports = {
  formatSellAnnouncement,
  formatChargeRequest,
  formatOfferListItem,
  formatUserProfile,
  formatWelcomeMessage,
  escapeMarkdownV2
};
