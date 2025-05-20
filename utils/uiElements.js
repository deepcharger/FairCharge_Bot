// utils/uiElements.js
// Libreria centralizzata per elementi UI consistenti nell'app
const { Markup } = require('telegraf');

/**
 * Formatta un messaggio di progresso per i wizard
 * @param {Number} step - Passo attuale
 * @param {Number} totalSteps - Numero totale di passi
 * @param {String} title - Titolo del wizard
 * @returns {String} Messaggio formattato con indicatore di progresso
 */
const formatProgressMessage = (step, totalSteps, title) => {
  // Calcola percentuale di completamento
  const percentage = Math.floor((step / totalSteps) * 100);
  
  // Crea barra di progresso testuale
  const barLength = 10;
  const filledLength = Math.floor((step / totalSteps) * barLength);
  
  let progressBar = '';
  for (let i = 0; i < barLength; i++) {
    progressBar += i < filledLength ? '●' : '○';
  }
  
  return `<b>${title}</b>\n\n<code>${progressBar}</code> ${percentage}%\n<i>Passo ${step} di ${totalSteps}</i>\n\n`;
};

/**
 * Crea una tastiera di navigazione per wizard
 * @param {Boolean} canGoBack - Se è possibile tornare indietro
 * @param {Boolean} canSkip - Se è possibile saltare il passaggio
 * @param {String} backData - Callback data per tornare indietro
 * @param {String} skipData - Callback data per saltare
 * @param {String} cancelData - Callback data per annullare
 * @returns {Object} Keyboard con pulsanti di navigazione
 */
const wizardNavigationButtons = (
  canGoBack = true,
  canSkip = false,
  backData = 'wizard_back',
  skipData = 'wizard_skip',
  cancelData = 'wizard_cancel'
) => {
  const buttons = [];
  
  // Pulsanti che cambiano in base ai parametri
  const navButtons = [];
  
  if (canGoBack) {
    navButtons.push(Markup.button.callback('◀️ Indietro', backData));
  }
  
  if (canSkip) {
    navButtons.push(Markup.button.callback('⏩ Salta', skipData));
  }
  
  navButtons.push(Markup.button.callback('❌ Annulla', cancelData));
  
  buttons.push(navButtons);
  
  return Markup.inlineKeyboard(buttons);
};

/**
 * Crea una tastiera numerica inline
 * @param {String} prefix - Prefisso per i dati di callback
 * @returns {Object} Keyboard con tastiera numerica
 */
const numericKeyboard = (prefix = 'num_') => {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('1', `${prefix}1`),
      Markup.button.callback('2', `${prefix}2`),
      Markup.button.callback('3', `${prefix}3`)
    ],
    [
      Markup.button.callback('4', `${prefix}4`),
      Markup.button.callback('5', `${prefix}5`),
      Markup.button.callback('6', `${prefix}6`)
    ],
    [
      Markup.button.callback('7', `${prefix}7`),
      Markup.button.callback('8', `${prefix}8`),
      Markup.button.callback('9', `${prefix}9`)
    ],
    [
      Markup.button.callback('⬅️', `${prefix}back`),
      Markup.button.callback('0', `${prefix}0`),
      Markup.button.callback('✅', `${prefix}confirm`)
    ]
  ]);
};

/**
 * Crea un messaggio di conferma formattato
 * @param {String} title - Titolo del messaggio
 * @param {Array} items - Array di {label, value} per gli elementi da confermare
 * @returns {String} Messaggio formattato con i dati da confermare
 */
const formatConfirmationMessage = (title, items) => {
  let message = `<b>${title}</b>\n\n`;
  
  for (const item of items) {
    message += `<b>${item.label}:</b> ${item.value}\n`;
  }
  
  message += '\nVerifica che i dati siano corretti prima di confermare.';
  
  return message;
};

/**
 * Crea un avviso di timeout formattato
 * @param {Number} minutes - Minuti prima del timeout
 * @returns {String} Messaggio di avviso timeout
 */
const formatTimeoutWarning = (minutes) => {
  return `⚠️ <i>Questa procedura scadrà automaticamente tra ${minutes} minuti se non completata.</i>`;
};

/**
 * Crea bottoni per azioni rapide di portafoglio
 * @returns {Object} Keyboard con azioni rapide
 */
const walletQuickActions = () => {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('💰 Vendi kWh', 'wallet_sell'),
      Markup.button.callback('🔋 Compra kWh', 'wallet_buy')
    ],
    [
      Markup.button.callback('📊 Statistiche', 'wallet_stats'),
      Markup.button.callback('🔍 Transazioni', 'wallet_transactions')
    ],
    [
      Markup.button.callback('📱 Menu principale', 'back_to_main')
    ]
  ]);
};

/**
 * Formatta un elenco di elementi con paginazione
 * @param {Array} items - Array di elementi da visualizzare
 * @param {Number} page - Pagina corrente
 * @param {Number} itemsPerPage - Elementi per pagina
 * @param {Function} formatItem - Funzione per formattare ogni elemento
 * @param {String} title - Titolo dell'elenco
 * @returns {Object} {text: messaggio formattato, hasMore: se ci sono altre pagine}
 */
const formatPaginatedList = (items, page = 1, itemsPerPage = 5, formatItem, title) => {
  if (!items || items.length === 0) {
    return { text: `<b>${title}</b>\n\nNessun elemento da visualizzare.`, hasMore: false };
  }
  
  const startIndex = (page - 1) * itemsPerPage;
  const endIndex = Math.min(startIndex + itemsPerPage, items.length);
  const visibleItems = items.slice(startIndex, endIndex);
  
  let text = `<b>${title}</b>\n\n`;
  
  for (let i = 0; i < visibleItems.length; i++) {
    text += formatItem(visibleItems[i], startIndex + i + 1) + '\n\n';
  }
  
  text += `Pagina ${page}/${Math.ceil(items.length / itemsPerPage)} · Elementi ${startIndex + 1}-${endIndex} di ${items.length}`;
  
  return {
    text: text,
    hasMore: endIndex < items.length,
    hasPrevious: page > 1
  };
};

/**
 * Crea bottoni di paginazione
 * @param {String} baseData - Base per i dati di callback
 * @param {Number} currentPage - Pagina corrente
 * @param {Boolean} hasMore - Se ci sono più pagine
 * @param {Boolean} hasPrevious - Se c'è una pagina precedente
 * @returns {Object} Keyboard con pulsanti di paginazione
 */
const paginationButtons = (baseData, currentPage, hasMore, hasPrevious) => {
  const buttons = [];
  const navRow = [];
  
  if (hasPrevious) {
    navRow.push(Markup.button.callback('◀️ Precedente', `${baseData}_prev_${currentPage}`));
  }
  
  if (hasMore) {
    navRow.push(Markup.button.callback('▶️ Successiva', `${baseData}_next_${currentPage}`));
  }
  
  if (navRow.length > 0) {
    buttons.push(navRow);
  }
  
  buttons.push([Markup.button.callback('📱 Menu principale', 'back_to_main')]);
  
  return Markup.inlineKeyboard(buttons);
};

/**
 * Formatta un messaggio di errore
 * @param {String} message - Messaggio di errore
 * @param {Boolean} isCritical - Se l'errore è critico
 * @returns {String} Messaggio di errore formattato
 */
const formatErrorMessage = (message, isCritical = false) => {
  const icon = isCritical ? '🚫' : '⚠️';
  return `${icon} <b>${isCritical ? 'Errore critico' : 'Attenzione'}</b>\n\n${message}`;
};

/**
 * Crea un messaggio di successo formattato
 * @param {String} title - Titolo del messaggio
 * @param {String} message - Corpo del messaggio
 * @returns {String} Messaggio di successo formattato
 */
const formatSuccessMessage = (title, message) => {
  return `✅ <b>${title}</b>\n\n${message}`;
};

// Importa ed estendi le funzioni da inlineButtons
const inlineButtons = require('./inlineButtons');

// Esporta tutte le funzioni
module.exports = {
  formatProgressMessage,
  wizardNavigationButtons,
  numericKeyboard,
  formatConfirmationMessage,
  formatTimeoutWarning,
  walletQuickActions,
  formatPaginatedList,
  paginationButtons,
  formatErrorMessage,
  formatSuccessMessage,
  // Riesporta le funzioni da inlineButtons
  ...inlineButtons
};
