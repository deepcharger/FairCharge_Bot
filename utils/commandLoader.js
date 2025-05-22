// utils/commandLoader.js - Fix per i comandi persistenti

const { bot } = require('../config/bot');
const logger = require('./logger');
const { isAdmin, ADMIN_USER_ID } = require('../config/admin');

/**
 * Registra i comandi del bot con Telegram con retry logic
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
      { command: 'annulla', description: 'Annulla la procedura in corso' },
      { command: 'menu', description: 'Mostra il menu principale' }
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
      { command: 'system_checkup', description: 'Controllo di sistema (solo admin)' },
      { command: 'admin_help', description: 'Comandi amministrativi (solo admin)' },
      { command: 'security_stats', description: 'Statistiche sicurezza (solo admin)' },
      { command: 'suspicious_users', description: 'Lista utenti sospetti (solo admin)' },
      { command: 'membership_stats', description: 'Statistiche membership (solo admin)' },
      { command: 'user_stats', description: 'Statistiche utenti (solo admin)' },
      { command: 'system_status', description: 'Status sistema (solo admin)' },
      { command: 'manage_whitelist', description: 'Gestione whitelist (solo admin)' },
      { command: 'analyze_security', description: 'Analisi sicurezza utente (solo admin)' },
      { command: 'check_membership', description: 'Verifica membership utente (solo admin)' },
      { command: 'test_group_config', description: 'Test configurazione gruppi (solo admin)' }
    ];
    
    // Prova a rimuovere i comandi esistenti prima di impostare i nuovi
    try {
      await bot.telegram.deleteMyCommands();
      logger.debug('Comandi esistenti rimossi');
      await new Promise(resolve => setTimeout(resolve, 1000)); // Attendi 1 secondo
    } catch (deleteErr) {
      logger.warn('Non è stato possibile rimuovere i comandi esistenti:', deleteErr);
    }
    
    // Imposta i comandi per gli utenti normali (menu globale)
    try {
      await bot.telegram.setMyCommands(userCommands);
      logger.debug('Comandi normali registrati con successo');
    } catch (userCmdErr) {
      logger.error('Errore nella registrazione comandi utenti:', userCmdErr);
      throw userCmdErr;
    }
    
    // Attendi prima di impostare i comandi admin
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Imposta i comandi per l'amministratore
    if (ADMIN_USER_ID) {
      try {
        await bot.telegram.setMyCommands(adminCommands, {
          scope: { type: 'chat', chat_id: ADMIN_USER_ID }
        });
        logger.debug(`Comandi admin registrati per ID: ${ADMIN_USER_ID}`);
      } catch (adminCmdErr) {
        logger.error('Errore nella registrazione comandi admin:', adminCmdErr);
        // Non lanciare errore per i comandi admin, continua comunque
      }
    } else {
      logger.warn('ADMIN_USER_ID non impostato, comandi admin non registrati');
    }
    
    // IMPORTANTE: Verifica che i comandi siano stati registrati
    try {
      const currentCommands = await bot.telegram.getMyCommands();
      logger.info(`Comandi attualmente registrati: ${currentCommands.length}`, {
        commands: currentCommands.map(cmd => cmd.command)
      });
      
      // Se nessun comando è registrato, qualcosa è andato storto
      if (currentCommands.length === 0) {
        logger.warn('⚠️ Nessun comando registrato, provo un secondo tentativo...');
        // Riprova dopo una pausa più lunga
        await new Promise(resolve => setTimeout(resolve, 3000));
        await bot.telegram.setMyCommands(userCommands);
        
        // Verifica di nuovo
        const retryCommands = await bot.telegram.getMyCommands();
        if (retryCommands.length > 0) {
          logger.info('✅ Comandi registrati al secondo tentativo');
        } else {
          logger.error('❌ Impossibile registrare i comandi anche al secondo tentativo');
          return false;
        }
      }
    } catch (verifyErr) {
      logger.warn('Non è stato possibile verificare i comandi registrati:', verifyErr);
    }
    
    logger.info('Registrazione comandi completata con successo');
    return true;
  } catch (err) {
    logger.error('Errore nella registrazione dei comandi:', err);
    return false;
  }
};

// Funzione helper per forzare l'aggiornamento dei comandi
const forceCommandUpdate = async () => {
  try {
    // Cancella tutti i comandi esistenti
    await bot.telegram.deleteMyCommands();
    
    // Attendi un po'
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Re-registra i comandi
    return await registerCommands();
  } catch (err) {
    logger.error('Errore nel forzare l\'aggiornamento dei comandi:', err);
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
 * @param {Object} commands - Oggetto con i comandi
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
          { text: '🔒 Sicurezza', callback_data: 'admin_security' },
          { text: '👥 Utenti', callback_data: 'admin_users' }
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
  
  bot.action('admin_security', async (ctx) => {
    await ctx.answerCbQuery('Accesso pannello sicurezza...');
    
    const securityMenu = {
      inline_keyboard: [
        [
          { text: '📊 Statistiche', callback_data: 'security_stats' },
          { text: '⚠️ Utenti sospetti', callback_data: 'suspicious_users' }
        ],
        [
          { text: '📋 Whitelist', callback_data: 'manage_whitelist_menu' },
          { text: '👥 Membership', callback_data: 'membership_stats' }
        ],
        [
          { text: '🔙 Torna indietro', callback_data: 'menu_admin' }
        ]
      ]
    };
    
    await ctx.editMessageText('🔒 *Pannello Sicurezza*\n\nSeleziona una delle opzioni:', {
      parse_mode: 'Markdown',
      reply_markup: securityMenu
    });
  });
  
  bot.action('admin_users', async (ctx) => {
    await ctx.answerCbQuery('Accesso gestione utenti...');
    
    const usersMenu = {
      inline_keyboard: [
        [
          { text: '📊 Statistiche utenti', callback_data: 'user_stats' },
          { text: '🔍 Analizza utente', callback_data: 'analyze_user_prompt' }
        ],
        [
          { text: '👑 Gestione VIP', callback_data: 'vip_management' },
          { text: '🗑️ Cancella dati', callback_data: 'delete_user_prompt' }
        ],
        [
          { text: '🔙 Torna indietro', callback_data: 'menu_admin' }
        ]
      ]
    };
    
    await ctx.editMessageText('👥 *Gestione Utenti*\n\nSeleziona una delle opzioni:', {
      parse_mode: 'Markdown',
      reply_markup: usersMenu
    });
  });
  
  // Callback per sottomenu sicurezza
  bot.action('security_stats', async (ctx) => {
    await ctx.answerCbQuery();
    // Simuliamo il comando security_stats
    ctx.message = { text: '/security_stats' };
    const adminCommands = require('../handlers/commands/adminCommands');
    return adminCommands.securityStatsCommand(ctx);
  });
  
  bot.action('suspicious_users', async (ctx) => {
    await ctx.answerCbQuery();
    // Simuliamo il comando suspicious_users
    ctx.message = { text: '/suspicious_users' };
    const adminCommands = require('../handlers/commands/adminCommands');
    return adminCommands.suspiciousUsersCommand(ctx);
  });
  
  bot.action('membership_stats', async (ctx) => {
    await ctx.answerCbQuery();
    // Simuliamo il comando membership_stats
    ctx.message = { text: '/membership_stats' };
    const adminCommands = require('../handlers/commands/adminCommands');
    return adminCommands.membershipStatsCommand(ctx);
  });
  
  bot.action('user_stats', async (ctx) => {
    await ctx.answerCbQuery();
    // Simuliamo il comando user_stats
    ctx.message = { text: '/user_stats' };
    const adminCommands = require('../handlers/commands/adminCommands');
    return adminCommands.userStatsCommand(ctx);
  });
  
  bot.action('manage_whitelist_menu', async (ctx) => {
    await ctx.answerCbQuery();
    // Simuliamo il comando manage_whitelist
    ctx.message = { text: '/manage_whitelist' };
    const whitelistService = require('../services/whitelistService');
    return whitelistService.manageWhitelistCommand(ctx);
  });
  
  // Callback per prompt di input
  bot.action('analyze_user_prompt', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      '🔍 *Analisi Sicurezza Utente*\n\n' +
      'Invia il comando nel formato:\n' +
      '`/analyze_security @username` o `/analyze_security ID`\n\n' +
      'Esempio: `/analyze_security @mario123`',
      { 
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔙 Torna indietro', callback_data: 'admin_users' }]
          ]
        }
      }
    );
  });
  
  bot.action('delete_user_prompt', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      '🗑️ *Cancellazione Dati Utente*\n\n' +
      '⚠️ **ATTENZIONE**: Questa operazione è irreversibile!\n\n' +
      'Invia il comando nel formato:\n' +
      '`/cancella_dati_utente @username` o `/cancella_dati_utente ID`\n\n' +
      'Esempio: `/cancella_dati_utente @mario123`',
      { 
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔙 Torna indietro', callback_data: 'admin_users' }]
          ]
        }
      }
    );
  });
  
  bot.action('vip_management', async (ctx) => {
    await ctx.answerCbQuery('Accesso gestione VIP...');
    
    const vipMenu = {
      inline_keyboard: [
        [
          { text: '👑 Aggiungi VIP', callback_data: 'add_vip_prompt' },
          { text: '📤 Invia link VIP', callback_data: 'send_vip_link_prompt' }
        ],
        [
          { text: '📋 Lista VIP', callback_data: 'list_vip_users' }
        ],
        [
          { text: '🔙 Torna indietro', callback_data: 'admin_users' }
        ]
      ]
    };
    
    await ctx.editMessageText('👑 *Gestione Utenti VIP*\n\nSeleziona una delle opzioni:', {
      parse_mode: 'Markdown',
      reply_markup: vipMenu
    });
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
  
  // Callback per ricaricare menu admin
  bot.action('reload_admin_menu', async (ctx) => {
    await ctx.answerCbQuery('Ricaricamento menu...');
    
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
          { text: '🔒 Sicurezza', callback_data: 'admin_security' },
          { text: '👥 Utenti', callback_data: 'admin_users' }
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
  
  logger.info('Handler per menu inline registrati');
};

module.exports = {
  registerCommands,
  forceCommandUpdate,
  createInlineMenus,
  setupMenuCallbacks
};
