// Caricatore per i comandi persistenti di Telegram
const { bot } = require('../config/bot');
const logger = require('./logger');
const { isAdmin, ADMIN_USER_ID } = require('../config/admin');

/**
 * Registra i comandi del bot con Telegram
 * @returns {Promise<void>}
 */
const registerCommands = async () => {
  try {
    logger.info('Registrazione comandi bot con Telegram');
    
    // Array dei comandi da impostare per utenti normali
    const userCommands = [
      { command: 'start', description: 'Avvia il bot' },
      { command: 'help', description: 'Mostra i comandi disponibili' },
      { command: 'vendi_kwh', description: 'Crea un annuncio per vendere kWh' },
      { command: 'le_mie_ricariche', description: 'Visualizza le tue ricariche attive' },
      { command: 'profilo', description: 'Visualizza il tuo profilo' },
      { command: 'portafoglio', description: 'Visualizza il tuo portafoglio' },
      { command: 'portafoglio_partner', description: 'Dettagli portafoglio con un partner' },
      { command: 'archivia_annuncio', description: 'Archivia il tuo annuncio attivo' },
      { command: 'annulla', description: 'Annulla la procedura in corso' }
    ];
    
    // Array dei comandi per amministratori
    const adminCommands = [
      ...userCommands,
      { command: 'avvio_ricarica', description: 'Avvia una ricarica usando il saldo (solo admin)' },
      { command: 'le_mie_donazioni', description: 'Visualizza le donazioni ricevute (solo admin)' },
      { command: 'portafoglio_venditore', description: 'Dettagli portafoglio con un venditore (solo admin)' },
      { command: 'update_commands', description: 'Aggiorna i comandi del bot (solo admin)' },
      { command: 'cancella_dati_utente', description: 'Cancella i dati di un utente (solo admin)' },
      { command: 'aggiungi_feedback', description: 'Aggiungi feedback a un utente (solo admin)' },
      { command: 'db_admin', description: 'Gestione database (solo admin)' },
      { command: 'check_admin_config', description: 'Verifica configurazione admin (solo admin)' },
      { command: 'create_admin_account', description: 'Crea account admin (solo admin)' },
      { command: 'system_checkup', description: 'Controllo di sistema (solo admin)' }
    ];
    
    // Imposta i comandi per gli utenti normali (menu globale)
    await bot.telegram.setMyCommands(userCommands);
    logger.debug('Comandi normali registrati con successo');
    
    // Imposta i comandi per l'amministratore
    if (ADMIN_USER_ID) {
      await bot.telegram.setMyCommands(adminCommands, {
        scope: { type: 'chat', chat_id: ADMIN_USER_ID }
      });
      logger.debug(`Comandi admin registrati per ID: ${ADMIN_USER_ID}`);
    } else {
      logger.warn('ADMIN_USER_ID non impostato, comandi admin non registrati');
    }
    
    logger.info('Registrazione comandi completata con successo');
    return true;
  } catch (err) {
    logger.error('Errore nella registrazione dei comandi:', err);
    return false;
  }
};

/**
 * Crea menu inline personalizzati per un utente
 * @param {Number} userId - ID dell'utente
 * @param {Boolean} isUserAdmin - Se l'utente è admin
 * @returns {Promise<void>}
 */
const createInlineMenus = async (userId, isUserAdmin = false) => {
  try {
    // Menu principale
    const mainMenu = {
      inline_keyboard: [
        [
          { text: '🔋 Vendi kWh', callback_data: 'menu_sell_kwh' },
          { text: '💰 Portafoglio', callback_data: 'menu_wallet' }
        ],
        [
          { text: '⚡ Le mie ricariche', callback_data: 'menu_my_charges' },
          { text: '👤 Profilo', callback_data: 'menu_profile' }
        ]
      ]
    };
    
    // Aggiungi riga admin se l'utente è admin
    if (isUserAdmin) {
      mainMenu.inline_keyboard.push([
        { text: '🔑 Admin Panel', callback_data: 'menu_admin' }
      ]);
    }
    
    // Invia il menu all'utente
    await bot.telegram.sendMessage(
      userId,
      '📱 *Menu principale*\n\nSeleziona una delle opzioni disponibili:',
      {
        parse_mode: 'Markdown',
        reply_markup: mainMenu
      }
    );
    
  } catch (err) {
    logger.error(`Errore nella creazione del menu per utente ${userId}:`, err);
  }
};

/**
 * Registra gli handler per i menu inline
 * @param {Object} bot - Istanza del bot
 * @returns {void}
 */
const setupMenuCallbacks = (commands) => {
  // Menu principale
  bot.action('menu_sell_kwh', async (ctx) => {
    await ctx.answerCbQuery('Avvio procedura di vendita...');
    return commands.sellKwhCommand(ctx);
  });
  
  bot.action('menu_wallet', async (ctx) => {
    await ctx.answerCbQuery('Recupero portafoglio...');
    return commands.walletCommand(ctx);
  });
  
  bot.action('menu_my_charges', async (ctx) => {
    await ctx.answerCbQuery('Recupero ricariche...');
    return commands.myChargesCommand(ctx);
  });
  
  bot.action('menu_profile', async (ctx) => {
    await ctx.answerCbQuery('Recupero profilo...');
    return commands.profileCommand(ctx);
  });
  
  bot.action('menu_admin', async (ctx) => {
    // Verifica che sia l'admin
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('Non sei autorizzato', { show_alert: true });
      return;
    }
    
    await ctx.answerCbQuery('Accesso pannello admin...');
    
    // Menu admin
    const adminMenu = {
      inline_keyboard: [
        [
          { text: '💰 Donazioni', callback_data: 'admin_donations' },
          { text: '🔄 Comandi', callback_data: 'admin_update_commands' }
        ],
        [
          { text: '🛠️ Checkup', callback_data: 'admin_system_checkup' },
          { text: '📊 DB', callback_data: 'admin_db_stats' }
        ],
        [
          { text: '📱 Menu principale', callback_data: 'back_to_main' }
        ]
      ]
    };
    
    await ctx.editMessageText('🔑 *Pannello Amministratore*\n\nSeleziona una delle opzioni disponibili:', {
      parse_mode: 'Markdown',
      reply_markup: adminMenu
    });
  });
  
  // Admin submenu
  bot.action('admin_donations', async (ctx) => {
    await ctx.answerCbQuery();
    return commands.myDonationsCommand(ctx);
  });
  
  bot.action('admin_update_commands', async (ctx) => {
    await ctx.answerCbQuery();
    return commands.updateBotCommandsCommand(ctx);
  });
  
  bot.action('admin_system_checkup', async (ctx) => {
    await ctx.answerCbQuery();
    return commands.systemCheckupCommand(ctx);
  });
  
  bot.action('admin_db_stats', async (ctx) => {
    await ctx.answerCbQuery();
    
    // Simuliamo il comando db_admin stats
    ctx.message = { text: '/db_admin stats' };
    return commands.dbAdminCommand(ctx);
  });
  
  // Torna al menu principale
  bot.action('back_to_main', async (ctx) => {
    await ctx.answerCbQuery();
    await createInlineMenus(ctx.from.id, isAdmin(ctx.from.id));
    // Eliminiamo il messaggio precedente per evitare confusione
    try {
      await ctx.deleteMessage();
    } catch (err) {
      logger.warn(`Impossibile eliminare il messaggio del menu:`, err);
    }
  });
  
  logger.info('Handler per menu inline registrati');
};

module.exports = {
  registerCommands,
  createInlineMenus,
  setupMenuCallbacks
};
