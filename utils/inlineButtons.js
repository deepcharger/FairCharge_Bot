// Utility per la gestione di bottoni inline consistenti
const { Markup } = require('telegraf');

/**
 * Crea un bottone per la visualizzazione del menu principale
 * @returns {Object} Keyboard con bottone menu
 */
const mainMenuButton = () => {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📱 Menu principale', 'back_to_main')]
  ]);
};

/**
 * Crea bottoni di conferma/annullamento
 * @param {String} confirmText - Testo del bottone di conferma
 * @param {String} confirmData - Callback data per la conferma
 * @param {String} cancelText - Testo del bottone di annullamento
 * @param {String} cancelData - Callback data per l'annullamento
 * @returns {Object} Keyboard con bottoni conferma/annulla
 */
const confirmButtons = (
  confirmText = '✅ Conferma',
  confirmData = 'confirm_action',
  cancelText = '❌ Annulla',
  cancelData = 'cancel_action'
) => {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(confirmText, confirmData),
      Markup.button.callback(cancelText, cancelData)
    ]
  ]);
};

/**
 * Crea bottoni per la gestione delle offerte
 * @param {String} offerId - ID dell'offerta
 * @param {String} status - Stato dell'offerta
 * @param {Boolean} isbuyer - Se l'utente è l'acquirente
 * @returns {Object} Keyboard con bottoni appropriati
 */
const offerButtons = (offerId, status, isbuyer) => {
  let buttons = [];
  
  switch (status) {
    case 'accepted':
      if (isbuyer) {
        buttons = [
          [
            Markup.button.callback('🔋 Sono pronto per caricare', `ready_to_charge_${offerId}`),
            Markup.button.callback('❌ Annulla', `cancel_charge_${offerId}`)
          ]
        ];
      }
      break;
    
    case 'ready_to_charge':
      if (!isbuyer) {
        buttons = [
          [Markup.button.callback('▶️ Ho avviato la ricarica', `charging_started_${offerId}`)]
        ];
      }
      break;
    
    case 'charging_started':
      if (isbuyer) {
        buttons = [
          [
            Markup.button.callback('✅ Ricarica partita', `charging_ok_${offerId}`),
            Markup.button.callback('❌ Problemi', `charging_issues_${offerId}`)
          ]
        ];
      }
      break;
    
    case 'charging':
      if (isbuyer) {
        buttons = [
          [Markup.button.callback('🔋 Ho terminato la ricarica', `charging_completed_${offerId}`)]
        ];
      }
      break;
    
    case 'kwh_confirmed':
      if (!isbuyer) {
        buttons = [
          [Markup.button.callback('💶 Inserisci importo da pagare', `set_payment_${offerId}`)]
        ];
      }
      break;
    
    case 'payment_pending':
      if (isbuyer) {
        buttons = [
          [Markup.button.callback('💸 Ho effettuato il pagamento', `payment_sent_${offerId}`)]
        ];
      } else {
        buttons = [
          [Markup.button.callback('💸 Verifica pagamento', `verify_payment_${offerId}`)]
        ];
      }
      break;
    
    case 'payment_sent':
      if (!isbuyer) {
        buttons = [
          [
            Markup.button.callback('✅ Confermo pagamento ricevuto', `payment_confirmed_${offerId}`),
            Markup.button.callback('❌ Non ho ricevuto', `payment_not_received_${offerId}`)
          ]
        ];
      }
      break;
    
    case 'completed':
      buttons = [
        [
          Markup.button.callback('👍 Positivo', `feedback_positive_${offerId}`),
          Markup.button.callback('👎 Negativo', `feedback_negative_${offerId}`)
        ]
      ];
      break;
  }
  
  return Markup.inlineKeyboard(buttons);
};

/**
 * Crea bottoni per le azioni di donazione
 * @param {String} offerId - ID dell'offerta
 * @returns {Object} Keyboard con bottoni di donazione
 */
const donationButtons = (offerId) => {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🎁 Dona 2 kWh', `donate_2_${offerId}`),
      Markup.button.callback('🎁 Altra quantità', `donate_custom_${offerId}`)
    ],
    [Markup.button.callback('👍 No, grazie', `donate_skip_${offerId}`)]
  ]);
};

/**
 * Crea bottoni per la gestione del tipo di corrente
 * @returns {Object} Keyboard con bottoni per il tipo di corrente
 */
const currentTypeButtons = () => {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('DC (corrente continua)', 'current_DC'),
      Markup.button.callback('AC (corrente alternata)', 'current_AC')
    ],
    [Markup.button.callback('Entrambe (DC e AC)', 'current_both')],
    [Markup.button.callback('❌ Annulla', 'cancel_sell')]
  ]);
};

/**
 * Crea un bottone di annullamento per procedure wizard
 * @param {String} cancelData - Callback data per l'annullamento
 * @returns {Object} Keyboard con bottone di annullamento
 */
const cancelButton = (cancelData = 'cancel_action') => {
  return Markup.inlineKeyboard([
    [Markup.button.callback('❌ Annulla', cancelData)]
  ]);
};

/**
 * Crea bottoni per interagire con un annuncio
 * @param {String} announcementId - ID dell'annuncio
 * @param {String} type - Tipo di annuncio (sell o buy)
 * @returns {Object} Keyboard con bottoni per l'annuncio
 */
const announcementButtons = (announcementId, type = 'sell') => {
  const buttonText = type === 'sell' ? 
    '🔋 Prenota ricarica a questo prezzo' : 
    '🔌 Offri ricarica a questo acquirente';
  
  const callbackData = type === 'sell' ? 
    `buy_kwh_${announcementId}` : 
    `sell_kwh_${announcementId}`;
  
  return Markup.inlineKeyboard([
    [Markup.button.callback(buttonText, callbackData)]
  ]);
};

module.exports = {
  mainMenuButton,
  confirmButtons,
  offerButtons,
  donationButtons,
  currentTypeButtons,
  cancelButton,
  announcementButtons
};
