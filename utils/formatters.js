// Funzioni di formattazione messaggi
const User = require('../models/user');
const logger = require('./logger');

/**
 * Sanitizza caratteri speciali in una stringa per Markdown
 * @param {String} text - Testo da sanitizzare
 * @returns {String} Testo sanitizzato
 */
const sanitizeMarkdown = (text) => {
  if (!text) return '';
  
  // Rimuovi TUTTI i caratteri speciali Markdown per essere sicuri
  return text
    .replace(/\*/g, '') // Rimuovi asterischi
    .replace(/_/g, '') // Rimuovi underscore
    .replace(/`/g, '') // Rimuovi backtick
    .replace(/\[/g, '(')
    .replace(/\]/g, ')')
    .replace(/\(/g, '(')
    .replace(/\)/g, ')')
    .replace(/~/g, '')
    .replace(/>/g, '')
    .replace(/#/g, '')
    .replace(/\+/g, '')
    .replace(/-/g, '')
    .replace(/=/g, '')
    .replace(/\|/g, '')
    .replace(/\{/g, '')
    .replace(/\}/g, '')
    .replace(/\./g, ' ')
    .replace(/!/g, ' ')
    .trim();
};

/**
 * Formatta un annuncio di vendita in Markdown
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
        availabilityInfo = availabilityLine;
      }
    }
    
    // Estrai i metodi di pagamento
    if (additionalInfo.includes('Metodi di pagamento:')) {
      const paymentLine = additionalInfo
        .split('Metodi di pagamento:')[1]
        .split('\n')[0]
        .trim();
      if (paymentLine) {
        paymentInfo = paymentLine;
      }
    }
    
    // Altre info (escludi disponibilità e pagamento)
    const lines = additionalInfo.split('\n');
    const otherLines = lines.filter(line => 
      !line.includes('Disponibilità:') && 
      !line.includes('Metodi di pagamento:')
    );
    
    if (otherLines.length > 0) {
      otherInfo = otherLines.join('\n');
    }
  }

  // Costruisci il testo del messaggio con Markdown normale (non V2)
  const message = `${trustedBadgeEmoji ? `${trustedBadgeEmoji} ${trustedBadgeText}\n\n` : ''}*Vendita kWh sharing*

🆔 *ID annuncio:* ${displayId}
👤 *Venditore:* @${user.username || user.firstName}
${user.totalRatings > 0 ? `⭐ *Feedback:* ${feedbackText}` : `⭐ ${feedbackText}`}

💲 *Prezzo:* ${announcement.price}
⚡ *Corrente:* ${announcement.connectorType === 'both' ? 'AC e DC' : announcement.connectorType}
✅ *Reti attivabili:* ${announcement.brand}
🗺️ *Zone:* ${announcement.location}
${announcement.nonActivatableBrands ? `⛔ *Reti non attivabili:* ${announcement.nonActivatableBrands}\n` : ''}🕒 *Disponibilità:* ${availabilityInfo}
💰 *Pagamento:* ${paymentInfo}
${otherInfo ? `📋 *Condizioni:* ${otherInfo}\n` : '📋 *Condizioni:* Non specificate\n'}
📝 _Dopo la compravendita, il venditore inviterà l'acquirente a esprimere un giudizio sulla transazione._`;

  return message;
};

/**
 * Versione sicura della funzione formatSellAnnouncement
 * che sanitizza tutti i dati prima di formattarli
 * @param {Object} announcement - L'annuncio da formattare
 * @param {Object} user - L'utente proprietario dell'annuncio
 * @returns {String} Testo formattato dell'annuncio
 */
const formatSellAnnouncementSafe = (announcement, user) => {
  try {
    // IMPORTANTE: sanitizza TUTTI i campi provenienti dall'utente
    const sanitizedAnnouncement = {
      ...announcement,
      _id: announcement._id,
      price: sanitizeMarkdown(announcement.price || ''),
      connectorType: announcement.connectorType, // Questo è un enum, non va sanitizzato
      brand: sanitizeMarkdown(announcement.brand || ''),
      location: sanitizeMarkdown(announcement.location || ''),
      nonActivatableBrands: announcement.nonActivatableBrands ? sanitizeMarkdown(announcement.nonActivatableBrands) : '',
      additionalInfo: announcement.additionalInfo ? sanitizeMarkdown(announcement.additionalInfo) : ''
    };
    
    const sanitizedUser = {
      ...user,
      username: user.username ? sanitizeMarkdown(user.username) : '',
      firstName: user.firstName ? sanitizeMarkdown(user.firstName) : '',
      positiveRatings: user.positiveRatings,
      totalRatings: user.totalRatings
    };

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
    let displayId = sanitizedAnnouncement._id;
    // Se l'ID è nel formato personalizzato userId_yyyy-MM-dd_HH-mm
    if (typeof sanitizedAnnouncement._id === 'string' && sanitizedAnnouncement._id.includes('_')) {
      // Estrai solo la parte della data/ora
      const idParts = sanitizedAnnouncement._id.split('_');
      if (idParts.length >= 2) {
        displayId = idParts.slice(1).join('_');
      }
    }

    // Estrazione info di disponibilità e pagamento dall'additionalInfo
    let availabilityInfo = 'Non specificata';
    let paymentInfo = 'PayPal, bonifico, contanti (da specificare)';
    let otherInfo = '';
    
    if (sanitizedAnnouncement.additionalInfo) {
      const additionalInfo = sanitizedAnnouncement.additionalInfo;
      
      // Estrai la disponibilità
      if (additionalInfo.includes('Disponibilità:')) {
        const availabilityLine = additionalInfo
          .split('Disponibilità:')[1]
          .split('\n')[0]
          .trim();
        if (availabilityLine) {
          availabilityInfo = availabilityLine;
        }
      }
      
      // Estrai i metodi di pagamento
      if (additionalInfo.includes('Metodi di pagamento:')) {
        const paymentLine = additionalInfo
          .split('Metodi di pagamento:')[1]
          .split('\n')[0]
          .trim();
        if (paymentLine) {
          paymentInfo = paymentLine;
        }
      }
      
      // Altre info (escludi disponibilità e pagamento)
      const lines = additionalInfo.split('\n');
      const otherLines = lines.filter(line => 
        !line.includes('Disponibilità:') && 
        !line.includes('Metodi di pagamento:')
      );
      
      if (otherLines.length > 0) {
        otherInfo = otherLines.join('\n');
      }
    }

    // SEMPLIFICA LA FORMATTAZIONE MARKDOWN
    // Usa una versione con formattazione minima per ridurre i problemi
    const message = `${trustedBadgeEmoji ? `${trustedBadgeEmoji} ${trustedBadgeText}\n\n` : ''}Vendita kWh sharing

🆔 ID annuncio: ${displayId}
👤 Venditore: @${sanitizedUser.username || sanitizedUser.firstName}
⭐ Feedback: ${feedbackText}

💲 Prezzo: ${sanitizedAnnouncement.price}
⚡ Corrente: ${sanitizedAnnouncement.connectorType === 'both' ? 'AC e DC' : sanitizedAnnouncement.connectorType}
✅ Reti attivabili: ${sanitizedAnnouncement.brand}
🗺️ Zone: ${sanitizedAnnouncement.location}
${sanitizedAnnouncement.nonActivatableBrands ? `⛔ Reti non attivabili: ${sanitizedAnnouncement.nonActivatableBrands}\n` : ''}🕒 Disponibilità: ${availabilityInfo}
💰 Pagamento: ${paymentInfo}
${otherInfo ? `📋 Condizioni: ${otherInfo}\n` : '📋 Condizioni: Non specificate\n'}
📝 Dopo la compravendita, il venditore inviterà l'acquirente a esprimere un giudizio sulla transazione.`;

    return message;
  } catch (error) {
    logger.error(`Errore nella formattazione sicura dell'annuncio: ${error.message}`);
    
    // In caso di errore, fornisci una versione ultra-semplificata senza formattazione Markdown
    return `Vendita kWh sharing

ID annuncio: ${announcement._id}
Venditore: @${user.username || user.firstName}

Prezzo: ${announcement.price}
Corrente: ${announcement.connectorType}
Reti attivabili: ${announcement.brand}
Zone: ${announcement.location}`;
  }
};

/**
 * Formatta un annuncio di acquisto
 * @param {Object} announcement - L'annuncio da formattare
 * @param {Object} user - L'utente proprietario dell'annuncio
 * @returns {String} Testo formattato dell'annuncio
 */
const formatBuyAnnouncement = (announcement, user) => {
  // Sanitizza tutti i campi che potrebbero contenere caratteri Markdown
  const sanitizedAnnouncement = {
    ...announcement,
    price: sanitizeMarkdown(announcement.price),
    location: sanitizeMarkdown(announcement.location),
    additionalInfo: announcement.additionalInfo ? sanitizeMarkdown(announcement.additionalInfo) : ''
  };
  
  const sanitizedUser = {
    ...user,
    username: user.username ? sanitizeMarkdown(user.username) : '',
    firstName: user.firstName ? sanitizeMarkdown(user.firstName) : ''
  };
  
  // Calcola la percentuale di feedback positivi dell'utente
  let positivePercentage = user.getPositivePercentage();
  
  // Testo per il feedback
  let feedbackText;
  if (positivePercentage === null) {
    feedbackText = '(Nuovo acquirente)';
  } else if (user.totalRatings <= 0) {
    feedbackText = '(Nuovo acquirente)';
  } else {
    feedbackText = `(${positivePercentage}% positivi, ${user.totalRatings} recensioni)`;
  }

  // Formattazione ID annuncio più leggibile
  let displayId = announcement._id;
  if (typeof announcement._id === 'string' && announcement._id.includes('_')) {
    const idParts = announcement._id.split('_');
    if (idParts.length >= 2) {
      displayId = idParts.slice(1).join('_');
    }
  }

  // Costruisci il testo del messaggio semplificato - SENZA MARKDOWN
  const message = `Cerco kWh sharing

🆔 ID annuncio: ${displayId}
👤 Acquirente: @${sanitizedUser.username || sanitizedUser.firstName}
⭐ Feedback: ${feedbackText}

💲 Prezzo massimo: ${sanitizedAnnouncement.price}
⚡ Corrente: ${announcement.connectorType === 'both' ? 'AC e DC' : announcement.connectorType}
🗺️ Zone: ${sanitizedAnnouncement.location}
${sanitizedAnnouncement.additionalInfo ? `📋 Note: ${sanitizedAnnouncement.additionalInfo}\n` : ''}
📝 Dopo la compravendita, l'acquirente inviterà il venditore a esprimere un giudizio sulla transazione.`;

  return message;
};

/**
 * Formatta l'anteprima di una richiesta di ricarica
 * @param {Object} offer - L'offerta da formattare
 * @param {Object} seller - Il venditore
 * @returns {String} Testo formattato della richiesta
 */
const formatChargeRequest = (offer, seller) => {
  // Sanitizza i dati
  const sanitizedBrand = sanitizeMarkdown(offer.brand || '');
  const sanitizedCoordinates = sanitizeMarkdown(offer.coordinates || '');
  const sanitizedInfo = offer.additionalInfo ? sanitizeMarkdown(offer.additionalInfo) : '';
  const sanitizedUsername = seller.username ? sanitizeMarkdown(seller.username) : sanitizeMarkdown(seller.firstName);

  return `
🔋 Richiesta di ricarica 🔋

📅 Data: ${offer.date}
🕙 Ora: ${offer.time}
🏭 Colonnina: ${sanitizedBrand}
📍 Posizione: ${sanitizedCoordinates}
${sanitizedInfo ? `ℹ️ Info aggiuntive: ${sanitizedInfo}\n` : ''}

💰 Prezzo venditore: ${seller.announcement ? sanitizeMarkdown(seller.announcement.price) : 'Non specificato'}
👤 Venditore: ${seller.username ? '@' + sanitizedUsername : sanitizedUsername}
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
const formatOfferListItem = async (offer, index, otherUser, role) => {
  const otherUserName = otherUser ? 
    (otherUser.username ? '@' + sanitizeMarkdown(otherUser.username) : sanitizeMarkdown(otherUser.firstName)) : 
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
  
  // Sanitizza i dati
  const sanitizedFirstName = sanitizeMarkdown(user.firstName || '');
  const sanitizedLastName = user.lastName ? sanitizeMarkdown(user.lastName) : '';
  const sanitizedUsername = user.username ? sanitizeMarkdown(user.username) : 'Non impostato';
  
  // Formatta gli annunci attivi
  let activeAnnouncementsText = '';
  
  if (sellAnnouncement && sellAnnouncement.status === 'active') {
    activeAnnouncementsText += '\n\n<b>Annuncio di vendita attivo:</b>\n';
    activeAnnouncementsText += `• <b>Prezzo:</b> ${sanitizeMarkdown(sellAnnouncement.price)}\n`;
    activeAnnouncementsText += `• <b>Corrente:</b> ${sellAnnouncement.connectorType === 'both' ? 'AC e DC' : sellAnnouncement.connectorType}\n`;
    activeAnnouncementsText += `• <b>Località:</b> ${sanitizeMarkdown(sellAnnouncement.location)}\n`;
  }
  
  if (buyAnnouncement && buyAnnouncement.status === 'active') {
    activeAnnouncementsText += '\n\n<b>Annuncio di acquisto attivo:</b>\n';
    activeAnnouncementsText += `• <b>Prezzo massimo:</b> ${sanitizeMarkdown(buyAnnouncement.price)}\n`;
    activeAnnouncementsText += `• <b>Corrente:</b> ${buyAnnouncement.connectorType === 'both' ? 'AC e DC' : buyAnnouncement.connectorType}\n`;
    activeAnnouncementsText += `• <b>Località:</b> ${sanitizeMarkdown(buyAnnouncement.location)}\n`;
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
      
      transactionsText += `• ${date}: ${role} di ${amount} kWh a ${total}€\n`;
    }
  }
  
  // Costruisci il profilo completo usando HTML invece di Markdown
  return `
👤 <b>Il tuo profilo</b>

<b>Nome:</b> ${sanitizedFirstName}${sanitizedLastName ? ' ' + sanitizedLastName : ''}
<b>Username:</b> ${user.username ? '@' + sanitizedUsername : sanitizedUsername}
<b>Iscritto dal:</b> ${user.registrationDate.toLocaleDateString('it-IT')}
<b>Feedback:</b> ${feedbackText}
<b>Saldo kWh:</b> ${balance}${activeAnnouncementsText}${transactionsText}
`;
};

/**
 * Formatta il messaggio di benvenuto con i comandi disponibili per utenti normali
 * @returns {String} Testo formattato del messaggio di benvenuto
 */
const formatWelcomeMessage = () => {
  return `
👋 <b>Benvenuto nel bot di compravendita kWh!</b>

Questo bot ti permette di vendere o comprare kWh per la ricarica di veicoli elettrici.

🔌 <b>Comandi principali:</b>
• /start - Avvia il bot
• /help - Mostra questo messaggio di aiuto
• /vendi_kwh - Crea un annuncio per vendere kWh
• /le_mie_ricariche - Visualizza le tue ricariche attive
• /profilo - Visualizza il tuo profilo
• /portafoglio - Visualizza il tuo portafoglio
• /portafoglio_partner - Visualizza il portafoglio con un partner specifico
• /archivia_annuncio - Archivia il tuo annuncio attivo
• /annulla - Annulla la procedura in corso

Per qualsiasi problema o domanda, contatta gli amministratori.
`;
};

/**
 * Formatta il messaggio di help per gli admin
 * @returns {String} Testo formattato con i comandi per gli admin
 */
const formatAdminHelpMessage = () => {
  return `
🔑 <b>Pannello Admin - Comandi disponibili</b>

<b>Comandi principali:</b>
• /start - Avvia il bot
• /help - Mostra questo pannello di aiuto admin
• /vendi_kwh - Crea un annuncio per vendere kWh
• /le_mie_ricariche - Visualizza le tue ricariche attive
• /profilo - Visualizza il tuo profilo
• /portafoglio - Visualizza il tuo portafoglio
• /archivia_annuncio - Archivia il tuo annuncio attivo
• /annulla - Annulla la procedura in corso

<b>Comandi di amministrazione:</b>
• /update_commands - Aggiorna i comandi del bot
• /avvio_ricarica - Avvia una ricarica utilizzando il saldo donato
• /le_mie_donazioni - Visualizza le donazioni ricevute
• /portafoglio_venditore - Dettagli portafoglio con un venditore specifico
• /portafoglio_partner - Dettagli portafoglio generico con un partner

<b>Gestione utenti:</b>
• /cancella_dati_utente - Cancella i dati di un utente
• /aggiungi_feedback - Aggiungi feedback a un utente

<b>Gestione database:</b>
• /db_admin - Comandi di gestione del database
• /check_admin_config - Verifica configurazione admin
• /create_admin_account - Crea o ripristina l'account admin
• /system_checkup - Esegue un controllo diagnostico del sistema

<b>Sintassi comandi:</b>
• /avvio_ricarica [username o ID] - Avvia ricarica con un venditore
• /portafoglio_venditore [ID] - Mostra portafoglio con un venditore
• /cancella_dati_utente [username o ID] - Cancella dati utente
• /aggiungi_feedback [username o ID] positivi:X negativi:Y - Modifica feedback
• /db_admin [operazione] - Esegue operazioni sul database
`;
};

module.exports = {
  formatSellAnnouncement,
  formatSellAnnouncementSafe,
  formatBuyAnnouncement,
  formatChargeRequest,
  formatOfferListItem,
  formatUserProfile,
  formatWelcomeMessage,
  formatAdminHelpMessage,
  sanitizeMarkdown
};
