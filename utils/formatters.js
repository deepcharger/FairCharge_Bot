// utils/formatters.js
// Funzioni di formattazione per i messaggi del bot
const moment = require('moment');

/**
 * Formatta il profilo di un utente
 * @param {Object} user - Dati dell'utente
 * @param {Array} transactions - Transazioni dell'utente
 * @param {Object} sellAnnouncement - Annuncio di vendita attivo
 * @param {Object} buyAnnouncement - Annuncio di acquisto attivo
 * @returns {String} Profilo formattato
 */
const formatUserProfile = (user, transactions = [], sellAnnouncement = null, buyAnnouncement = null) => {
  let profileText = `👤 <b>Profilo Utente</b>\n\n`;
  
  // Info base
  profileText += `<b>ID:</b> ${user.userId}\n`;
  if (user.username) {
    profileText += `<b>Username:</b> @${user.username}\n`;
  }
  profileText += `<b>Nome:</b> ${user.firstName || 'Non impostato'}`;
  if (user.lastName) {
    profileText += ` ${user.lastName}`;
  }
  profileText += `\n`;
  
  // Statistiche
  profileText += `<b>Saldo kWh:</b> ${user.balance.toFixed(2)} kWh\n`;
  profileText += `<b>Data di registrazione:</b> ${moment(user.registrationDate).format('DD/MM/YYYY')}\n`;
  
  // Feedback
  if (user.totalRatings > 0) {
    const percentage = Math.round((user.positiveRatings / user.totalRatings) * 100);
    profileText += `<b>Feedback:</b> ${percentage}% positivi (${user.positiveRatings}/${user.totalRatings})\n`;
  } else {
    profileText += `<b>Feedback:</b> Nessuna valutazione ricevuta\n`;
  }
  
  // Annunci attivi
  profileText += `\n<b>Annunci Attivi:</b>\n`;
  
  if (sellAnnouncement) {
    profileText += `✅ <b>Vendi kWh:</b> ${sellAnnouncement.pricePerKwh.toFixed(2)}€/kWh`;
    if (sellAnnouncement.location && sellAnnouncement.location.address) {
      profileText += ` a ${sellAnnouncement.location.address}`;
    }
    profileText += `\n`;
  } else {
    profileText += `❌ <i>Nessun annuncio di vendita attivo</i>\n`;
  }
  
  if (buyAnnouncement) {
    profileText += `✅ <b>Compri kWh:</b> ${buyAnnouncement.pricePerKwh.toFixed(2)}€/kWh`;
    if (buyAnnouncement.location && buyAnnouncement.location.address) {
      profileText += ` a ${buyAnnouncement.location.address}`;
    }
    profileText += `\n`;
  } else {
    profileText += `❌ <i>Nessun annuncio di acquisto attivo</i>\n`;
  }
  
  // Ultime transazioni
  const recentTransactions = transactions
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 3);
  
  if (recentTransactions.length > 0) {
    profileText += `\n<b>Ultime Transazioni:</b>\n`;
    
    for (const tx of recentTransactions) {
      const date = moment(tx.createdAt).format('DD/MM/YYYY');
      const isBuyer = tx.buyerId === user.userId;
      const role = isBuyer ? "Acquisto" : "Vendita";
      
      profileText += `- ${date}: ${role} di ${tx.kwhAmount.toFixed(2)} kWh (${tx.totalAmount.toFixed(2)}€)\n`;
    }
    
    if (transactions.length > 3) {
      profileText += `<i>...e altre ${transactions.length - 3} transazioni</i>\n`;
    }
  } else {
    profileText += `\n<i>Nessuna transazione registrata</i>\n`;
  }
  
  return profileText;
};

/**
 * Formatta un elemento della lista delle offerte
 * @param {Object} offer - Offerta da formattare
 * @param {Number} index - Indice nella lista
 * @param {Object} otherUser - Utente controparte
 * @param {String} role - Ruolo dell'utente (Acquirente/Venditore)
 * @returns {String} Elemento formattato
 */
const formatOfferListItem = async (offer, index, otherUser, role) => {
  let statusText = '';
  let statusEmoji = '⏳';
  
  switch (offer.status) {
    case 'pending':
      statusText = 'In attesa di conferma';
      statusEmoji = '⏳';
      break;
    case 'accepted':
      statusText = 'Accettata';
      statusEmoji = '✅';
      break;
    case 'ready_to_charge':
      statusText = 'Pronta per la ricarica';
      statusEmoji = '🔌';
      break;
    case 'charging_started':
      statusText = 'Ricarica avviata';
      statusEmoji = '🔌';
      break;
    case 'charging':
      statusText = 'In carica';
      statusEmoji = '⚡';
      break;
    case 'kwh_confirmed':
      statusText = 'kWh confermati';
      statusEmoji = '✓';
      break;
    case 'payment_pending':
      statusText = 'In attesa di pagamento';
      statusEmoji = '💰';
      break;
    case 'payment_sent':
      statusText = 'Pagamento inviato';
      statusEmoji = '💸';
      break;
    case 'completed':
      statusText = 'Completata';
      statusEmoji = '✅';
      break;
    case 'cancelled':
      statusText = 'Annullata';
      statusEmoji = '❌';
      break;
    case 'disputed':
      statusText = 'Contestata';
      statusEmoji = '⚠️';
      break;
    case 'rejected':
      statusText = 'Rifiutata';
      statusEmoji = '🚫';
      break;
    default:
      statusText = offer.status;
  }
  
  // Formato data
  const date = moment(offer.createdAt).format('DD/MM/YYYY');
  const otherUserName = otherUser?.username 
    ? '@' + otherUser.username 
    : (otherUser?.firstName || `Utente #${offer.buyerId === role ? offer.sellerId : offer.buyerId}`);
  
  let text = `<b>#${index + 1}. Ricarica con ${otherUserName}</b> [${statusEmoji} ${statusText}]\n`;
  text += `<b>Data:</b> ${date}\n`;
  text += `<b>Tuo ruolo:</b> ${role}\n`;
  
  if (offer.kwhAmount) {
    text += `<b>kWh:</b> ${offer.kwhAmount.toFixed(2)}\n`;
  }
  
  if (offer.pricePerKwh) {
    text += `<b>Prezzo:</b> ${offer.pricePerKwh.toFixed(2)}€/kWh\n`;
  }
  
  if (offer.totalAmount && offer.status !== 'pending' && offer.status !== 'accepted') {
    text += `<b>Importo totale:</b> ${offer.totalAmount.toFixed(2)}€\n`;
  }
  
  if (offer.connectorType) {
    text += `<b>Tipo connettore:</b> ${offer.connectorType}\n`;
  }
  
  if (offer.additionalInfo) {
    text += `<b>Note:</b> ${offer.additionalInfo}\n`;
  }
  
  return text;
};

/**
 * Formatta il messaggio di benvenuto
 * @returns {String} Messaggio di benvenuto formattato
 */
const formatWelcomeMessage = () => {
  return `
🔋 <b>Benvenuto in FairCharge Pro!</b>

FairCharge Pro è una piattaforma che connette chi ha bisogno di ricaricare il proprio veicolo elettrico con privati che mettono a disposizione le loro wallbox domestiche.

<b>Ecco cosa puoi fare:</b>

🔌 <b>Vendi kWh</b> - Metti a disposizione la tua wallbox e guadagna
⚡ <b>Acquista kWh</b> - Trova ricariche disponibili nella tua zona
👤 <b>Profilo</b> - Visualizza e gestisci il tuo profilo
💰 <b>Portafoglio</b> - Controlla il tuo saldo e le transazioni
🔍 <b>Le mie ricariche</b> - Monitora le tue ricariche attive

<b>Per iniziare, usa il menu qui sotto o digita un comando:</b>
- /vendi_kwh - Crea un annuncio per vendere kWh
- /profilo - Visualizza il tuo profilo
- /le_mie_ricariche - Controlla le tue ricariche
- /portafoglio - Gestisci il tuo portafoglio
- /help - Visualizza questo messaggio di aiuto
- /menu - Mostra il menu principale

<i>Buona ricarica!</i>
`;
};

/**
 * Formatta il messaggio di aiuto per gli admin
 * @returns {String} Messaggio di aiuto admin formattato
 */
const formatAdminHelpMessage = () => {
  return `
🔑 <b>Pannello Amministratore</b>

Oltre ai comandi standard, hai accesso a funzionalità avanzate:

<b>Gestione ricariche:</b>
- /avvio_ricarica [username] - Avvia una ricarica usando il saldo
- /le_mie_donazioni - Visualizza le donazioni ricevute
- /portafoglio_venditore [ID] - Dettagli portafoglio con un venditore

<b>Gestione sistema:</b>
- /update_commands - Aggiorna i comandi del bot
- /check_admin_config - Verifica configurazione admin
- /create_admin_account - Crea account admin
- /system_checkup - Controllo di sistema

<b>Gestione utenti:</b>
- /cancella_dati_utente [ID/username] - Cancella i dati di un utente
- /aggiungi_feedback [ID/username] positivi:X negativi:Y - Aggiunge feedback

<b>Gestione database:</b>
- /db_admin [operazione] - Gestione avanzata del database

Usa /menu per visualizzare il menu principale con tutte le opzioni.
`;
};

/**
 * Formatta un annuncio di vendita
 * @param {Object} announcement - Annuncio da formattare
 * @param {Object} seller - Venditore
 * @param {Boolean} isShort - Se formattare in versione ridotta
 * @returns {String} Annuncio formattato
 */
const formatSellAnnouncement = (announcement, seller, isShort = false) => {
  if (!announcement) return "<i>Annuncio non disponibile</i>";
  
  let text = '';
  
  if (!isShort) {
    text = `🔋 <b>Annuncio di Vendita kWh</b>\n\n`;
  }
  
  text += `<b>Prezzo:</b> ${announcement.pricePerKwh.toFixed(2)}€/kWh\n`;
  
  if (announcement.location && announcement.location.address) {
    text += `<b>Posizione:</b> ${announcement.location.address}\n`;
  }
  
  if (announcement.availableTimes) {
    text += `<b>Disponibilità:</b> ${announcement.availableTimes}\n`;
  }
  
  if (announcement.connectorTypes && announcement.connectorTypes.length > 0) {
    text += `<b>Tipi di connettore:</b> ${announcement.connectorTypes.join(', ')}\n`;
  }
  
  if (announcement.currentType) {
    const currentTypeMap = {
      'AC': 'Corrente alternata',
      'DC': 'Corrente continua',
      'both': 'AC e DC'
    };
    text += `<b>Tipo di corrente:</b> ${currentTypeMap[announcement.currentType] || announcement.currentType}\n`;
  }
  
  if (announcement.maxPower) {
    text += `<b>Potenza massima:</b> ${announcement.maxPower} kW\n`;
  }
  
  if (seller) {
    text += `<b>Venditore:</b> ${seller.username ? '@' + seller.username : seller.firstName}\n`;
    
    if (seller.totalRatings > 0) {
      const percentage = Math.round((seller.positiveRatings / seller.totalRatings) * 100);
      text += `<b>Feedback:</b> ${percentage}% positivi (${seller.positiveRatings}/${seller.totalRatings})\n`;
    }
  }
  
  if (!isShort && announcement.additionalInfo) {
    text += `\n<b>Informazioni aggiuntive:</b>\n${announcement.additionalInfo}\n`;
  }
  
  return text;
};

module.exports = {
  formatUserProfile,
  formatOfferListItem,
  formatWelcomeMessage,
  formatAdminHelpMessage,
  formatSellAnnouncement
};
