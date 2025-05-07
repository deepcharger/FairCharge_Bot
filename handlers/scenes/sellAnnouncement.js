// Scene per la creazione di un annuncio di vendita
const { Scenes, Markup } = require('telegraf');
const userService = require('../../services/userService');
const announcementService = require('../../services/announcementService');
const { formatSellAnnouncement } = require('../../utils/formatters');
const logger = require('../../utils/logger');

// Crea la scena per il wizard
const sellAnnouncementScene = new Scenes.WizardScene(
  'SELL_ANNOUNCEMENT_WIZARD',
  // Passo 1: Prezzo
  async (ctx) => {
    logger.info(`Avvio wizard vendita kWh per utente ${ctx.from.id}`);
    await ctx.reply('🔋 *Vendi kWh* 🔋\n\nQual è il prezzo che vuoi offrire?\n\nEsempi:\n- `0.35€ per kWh`\n- `0.28€ per ricariche > 40kW, 0.35€ per ricariche < 40kW`', {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('❌ Annulla', 'cancel_sell')]
      ])
    });
    return ctx.wizard.next();
  },
  // Passo 2: Tipo corrente
  async (ctx) => {
    try {
      // Log completo all'inizio del passo 2
      logger.info(`Inizio passo 2 per utente ${ctx.from.id}`);
      
      // Verifica se il messaggio è una callback
      if (ctx.callbackQuery && ctx.callbackQuery.data === 'cancel_sell') {
        logger.info(`Wizard annullato dall'utente ${ctx.from.id} al passo 2 (via callback)`);
        await ctx.answerCbQuery('Annuncio cancellato');
        await ctx.reply('❌ Creazione dell\'annuncio annullata.');
        return ctx.scene.leave();
      }
      
      // Verifica se è un comando
      if (ctx.message && ctx.message.text && ctx.message.text.startsWith('/')) {
        logger.info(`Comando ${ctx.message.text} ricevuto nel passo 2 per utente ${ctx.from.id}`);
        if (ctx.message.text === '/annulla') {
          logger.info(`Annullamento via comando per utente ${ctx.from.id}`);
          await ctx.reply('❌ Creazione dell\'annuncio annullata.');
          return ctx.scene.leave();
        }
      }
      
      ctx.wizard.state.price = ctx.message.text;
      logger.debug(`Prezzo impostato: ${ctx.wizard.state.price}`);
      
      // Log prima di inviare i bottoni
      logger.info(`Tentativo di inviare bottoni per la selezione della corrente all'utente ${ctx.from.id}`);
      
      try {
        // Utilizziamo un approccio diverso per i bottoni
        const keyboard = {
          inline_keyboard: [
            [
              { text: 'AC', callback_data: 'current_AC' },
              { text: 'DC', callback_data: 'current_DC' }
            ],
            [{ text: 'Entrambe (AC e DC)', callback_data: 'current_both' }],
            [{ text: '❌ Annulla', callback_data: 'cancel_sell' }]
          ]
        };
        
        // Invia i bottoni e cattura la risposta
        const sentMsg = await ctx.telegram.sendMessage(
          ctx.chat.id,
          'Che tipo di corrente offri?',
          { reply_markup: keyboard }
        );
        
        logger.info(`Bottoni inviati con successo, message_id: ${sentMsg.message_id}`);
      } catch (btnErr) {
        logger.error(`Errore nell'invio dei bottoni per utente ${ctx.from.id}:`, btnErr);
        // Fallback: invia solo il messaggio senza bottoni
        await ctx.reply('Che tipo di corrente offri? (Scrivi AC, DC, o "entrambi")');
      }
      
      logger.info(`Fine passo 2 per utente ${ctx.from.id}`);
      return ctx.wizard.next();
    } catch (err) {
      logger.error(`Errore generale nel passo 2 per utente ${ctx.from.id}:`, err);
      await ctx.reply('Si è verificato un errore. Per favore, riprova più tardi o scrivi /annulla per ricominciare.');
    }
  },
  // Passo 3: Brand colonnina
  async (ctx) => {
    try {
      logger.info(`Inizio passo 3 per utente ${ctx.from.id}`);
      
      // Gestione dell'annullamento tramite callback
      if (ctx.callbackQuery) {
        logger.info(`Callback ricevuta nel passo 3: ${ctx.callbackQuery.data}`);
        
        if (ctx.callbackQuery.data === 'cancel_sell') {
          logger.info(`Wizard annullato dall'utente ${ctx.from.id} al passo 3`);
          await ctx.answerCbQuery('Annuncio cancellato');
          await ctx.reply('❌ Creazione dell\'annuncio annullata.');
          return ctx.scene.leave();
        }
        
        // Gestione delle callback per il tipo di corrente
        if (ctx.callbackQuery.data.startsWith('current_')) {
          const currentType = ctx.callbackQuery.data.replace('current_', '');
          ctx.wizard.state.currentType = currentType;
          
          logger.info(`Tipo di corrente selezionato via callback: ${currentType} per utente ${ctx.from.id}`);
          await ctx.answerCbQuery(`Hai selezionato: ${currentType}`);
          
          let currentText;
          if (currentType === 'AC') {
            currentText = 'AC';
          } else if (currentType === 'DC') {
            currentText = 'DC';
          } else if (currentType === 'both') {
            currentText = 'Entrambe (AC e DC)';
          }
          
          await ctx.reply(`Tipo di corrente selezionato: ${currentText}`);
        }
      }
      
      // Se è un messaggio di testo, potrebbe essere una risposta diretta o un comando
      if (ctx.message) {
        logger.info(`Messaggio ricevuto nel passo 3: ${ctx.message.text}`);
        
        // Gestione del comando annulla
        if (ctx.message.text && ctx.message.text === '/annulla') {
          logger.info(`Comando /annulla ricevuto nel passo 3 per utente ${ctx.from.id}`);
          await ctx.reply('❌ Creazione dell\'annuncio annullata.');
          return ctx.scene.leave();
        }
        
        // Se l'utente ha digitato il tipo di corrente invece di usare i bottoni
        if (['AC', 'DC', 'ENTRAMBI', 'ENTRAMBE', 'BOTH'].includes(ctx.message.text.toUpperCase())) {
          let currentType;
          if (['AC'].includes(ctx.message.text.toUpperCase())) {
            currentType = 'AC';
          } else if (['DC'].includes(ctx.message.text.toUpperCase())) {
            currentType = 'DC';
          } else {
            currentType = 'both';
          }
          
          ctx.wizard.state.currentType = currentType;
          logger.info(`Tipo di corrente inserito manualmente: ${currentType} per utente ${ctx.from.id}`);
          
          await ctx.reply(`Tipo di corrente selezionato: ${currentType === 'both' ? 'Entrambe (AC e DC)' : currentType}`);
        }
      }
    
      // Verifica se il tipo di corrente è stato selezionato
      if (!ctx.wizard.state.currentType) {
        logger.warn(`Utente ${ctx.from.id} non ha selezionato un tipo di corrente`);
        await ctx.reply('Per favore, seleziona un tipo di corrente (scrivi AC, DC o "entrambi")', {
          reply_markup: Markup.inlineKeyboard([
            [
              Markup.button.callback('AC', 'current_AC'),
              Markup.button.callback('DC', 'current_DC')
            ],
            [Markup.button.callback('Entrambe (AC e DC)', 'current_both')],
            [Markup.button.callback('❌ Annulla', 'cancel_sell')]
          ])
        });
        return;
      }
      
      logger.info(`Procedendo al passo successivo per utente ${ctx.from.id} con currentType=${ctx.wizard.state.currentType}`);
      
      try {
        const sentMsg = await ctx.reply('Qual è il brand della colonnina di ricarica?\n\nEsempi: Enel X, Free To X, A2A, tutte', {
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('❌ Annulla', 'cancel_sell')]
          ])
        });
        logger.debug(`Messaggio per brand colonnina inviato, message_id: ${sentMsg.message_id}`);
      } catch (btnErr) {
        logger.error(`Errore nell'invio del messaggio per brand colonnina:`, btnErr);
        await ctx.reply('Qual è il brand della colonnina di ricarica?\n\nEsempi: Enel X, Free To X, A2A, tutte');
      }
      
      logger.info(`Fine passo 3 per utente ${ctx.from.id}`);
      return ctx.wizard.next();
    } catch (err) {
      logger.error(`Errore generale nel passo 3 per utente ${ctx.from.id}:`, err);
      await ctx.reply('Si è verificato un errore. Per favore, riprova più tardi o scrivi /annulla per ricominciare.');
    }
  },
  // Passo 4: Posizione
  async (ctx) => {
    try {
      logger.info(`Inizio passo 4 per utente ${ctx.from.id}`);
      
      // Gestione dell'annullamento tramite callback
      if (ctx.callbackQuery && ctx.callbackQuery.data === 'cancel_sell') {
        logger.info(`Wizard annullato dall'utente ${ctx.from.id} al passo 4`);
        await ctx.answerCbQuery('Annuncio cancellato');
        await ctx.reply('❌ Creazione dell\'annuncio annullata.');
        return ctx.scene.leave();
      }
      
      // Verifica se è un comando
      if (ctx.message && ctx.message.text && ctx.message.text.startsWith('/')) {
        logger.info(`Comando ${ctx.message.text} ricevuto nel passo 4 per utente ${ctx.from.id}`);
        if (ctx.message.text === '/annulla') {
          logger.info(`Annullamento via comando per utente ${ctx.from.id}`);
          await ctx.reply('❌ Creazione dell\'annuncio annullata.');
          return ctx.scene.leave();
        }
      }
      
      ctx.wizard.state.brand = ctx.message.text;
      logger.debug(`Brand impostato: ${ctx.wizard.state.brand}`);
      
      try {
        const sentMsg = await ctx.reply('Dove si trova la colonnina?\n\nEsempi: Italia, Francia, Provincia di Milano, Roma', {
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('❌ Annulla', 'cancel_sell')]
          ])
        });
        logger.debug(`Messaggio per location inviato, message_id: ${sentMsg.message_id}`);
      } catch (btnErr) {
        logger.error(`Errore nell'invio del messaggio per location:`, btnErr);
        await ctx.reply('Dove si trova la colonnina?\n\nEsempi: Italia, Francia, Provincia di Milano, Roma');
      }
      
      logger.info(`Fine passo 4 per utente ${ctx.from.id}`);
      return ctx.wizard.next();
    } catch (err) {
      logger.error(`Errore generale nel passo 4 per utente ${ctx.from.id}:`, err);
      await ctx.reply('Si è verificato un errore. Per favore, riprova più tardi o scrivi /annulla per ricominciare.');
    }
  },
  // Passo 5: Brand non attivabili
  async (ctx) => {
    try {
      logger.info(`Inizio passo 5 per utente ${ctx.from.id}`);
      
      // Gestione dell'annullamento tramite callback
      if (ctx.callbackQuery && ctx.callbackQuery.data === 'cancel_sell') {
        logger.info(`Wizard annullato dall'utente ${ctx.from.id} al passo 5`);
        await ctx.answerCbQuery('Annuncio cancellato');
        await ctx.reply('❌ Creazione dell\'annuncio annullata.');
        return ctx.scene.leave();
      }
      
      // Verifica se è un comando
      if (ctx.message && ctx.message.text && ctx.message.text.startsWith('/')) {
        logger.info(`Comando ${ctx.message.text} ricevuto nel passo 5 per utente ${ctx.from.id}`);
        if (ctx.message.text === '/annulla') {
          logger.info(`Annullamento via comando per utente ${ctx.from.id}`);
          await ctx.reply('❌ Creazione dell\'annuncio annullata.');
          return ctx.scene.leave();
        }
      }
      
      ctx.wizard.state.location = ctx.message.text;
      logger.debug(`Località impostata: ${ctx.wizard.state.location}`);
      
      try {
        const sentMsg = await ctx.reply('Ci sono brand di colonnine non attivabili? (scrivi "nessuno" se non ci sono)', {
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('❌ Annulla', 'cancel_sell')]
          ])
        });
        logger.debug(`Messaggio per brand non attivabili inviato, message_id: ${sentMsg.message_id}`);
      } catch (btnErr) {
        logger.error(`Errore nell'invio del messaggio per brand non attivabili:`, btnErr);
        await ctx.reply('Ci sono brand di colonnine non attivabili? (scrivi "nessuno" se non ci sono)');
      }
      
      logger.info(`Fine passo 5 per utente ${ctx.from.id}`);
      return ctx.wizard.next();
    } catch (err) {
      logger.error(`Errore generale nel passo 5 per utente ${ctx.from.id}:`, err);
      await ctx.reply('Si è verificato un errore. Per favore, riprova più tardi o scrivi /annulla per ricominciare.');
    }
  },
  // Passo 6: Informazioni aggiuntive
  async (ctx) => {
    try {
      logger.info(`Inizio passo 6 per utente ${ctx.from.id}`);
      
      // Gestione dell'annullamento tramite callback
      if (ctx.callbackQuery && ctx.callbackQuery.data === 'cancel_sell') {
        logger.info(`Wizard annullato dall'utente ${ctx.from.id} al passo 6`);
        await ctx.answerCbQuery('Annuncio cancellato');
        await ctx.reply('❌ Creazione dell\'annuncio annullata.');
        return ctx.scene.leave();
      }
      
      // Verifica se è un comando
      if (ctx.message && ctx.message.text && ctx.message.text.startsWith('/')) {
        logger.info(`Comando ${ctx.message.text} ricevuto nel passo 6 per utente ${ctx.from.id}`);
        if (ctx.message.text === '/annulla') {
          logger.info(`Annullamento via comando per utente ${ctx.from.id}`);
          await ctx.reply('❌ Creazione dell\'annuncio annullata.');
          return ctx.scene.leave();
        }
      }
      
      ctx.wizard.state.nonActivatableBrands = ctx.message.text;
      logger.debug(`Brand non attivabili: ${ctx.wizard.state.nonActivatableBrands}`);
      
      try {
        const sentMsg = await ctx.reply('Altre informazioni da aggiungere? (scrivi "nessuna" se non ce ne sono)', {
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('❌ Annulla', 'cancel_sell')]
          ])
        });
        logger.debug(`Messaggio per info aggiuntive inviato, message_id: ${sentMsg.message_id}`);
      } catch (btnErr) {
        logger.error(`Errore nell'invio del messaggio per info aggiuntive:`, btnErr);
        await ctx.reply('Altre informazioni da aggiungere? (scrivi "nessuna" se non ce ne sono)');
      }
      
      logger.info(`Fine passo 6 per utente ${ctx.from.id}`);
      return ctx.wizard.next();
    } catch (err) {
      logger.error(`Errore generale nel passo 6 per utente ${ctx.from.id}:`, err);
      await ctx.reply('Si è verificato un errore. Per favore, riprova più tardi o scrivi /annulla per ricominciare.');
    }
  },
  // Passo 7: Conferma annuncio
  async (ctx) => {
    try {
      logger.info(`Inizio passo 7 per utente ${ctx.from.id}`);
      
      // Gestione dell'annullamento tramite callback
      if (ctx.callbackQuery && ctx.callbackQuery.data === 'cancel_sell') {
        logger.info(`Wizard annullato dall'utente ${ctx.from.id} al passo 7`);
        await ctx.answerCbQuery('Annuncio cancellato');
        await ctx.reply('❌ Creazione dell\'annuncio annullata.');
        return ctx.scene.leave();
      }
      
      // Verifica se è un comando
      if (ctx.message && ctx.message.text && ctx.message.text.startsWith('/')) {
        logger.info(`Comando ${ctx.message.text} ricevuto nel passo 7 per utente ${ctx.from.id}`);
        if (ctx.message.text === '/annulla') {
          logger.info(`Annullamento via comando per utente ${ctx.from.id}`);
          await ctx.reply('❌ Creazione dell\'annuncio annullata.');
          return ctx.scene.leave();
        }
      }
      
      ctx.wizard.state.additionalInfo = ctx.message.text;
      logger.debug(`Info aggiuntive: ${ctx.wizard.state.additionalInfo}`);
      
      try {
        logger.info(`Recupero informazioni utente per ${ctx.from.id}`);
        const user = await userService.registerUser(ctx.from);
        
        // Verifica che tutti i dati necessari siano presenti
        if (!ctx.wizard.state.price || !ctx.wizard.state.currentType || !ctx.wizard.state.brand || !ctx.wizard.state.location) {
          logger.error(`Dati incompleti per l'annuncio dell'utente ${ctx.from.id}`);
          logger.debug(`Stato wizard: ${JSON.stringify(ctx.wizard.state)}`);
          await ctx.reply("❌ Dati incompleti per l'annuncio. Riprova dal principio con /vendi_kwh");
          return ctx.scene.leave();
        }
        
        // Creare l'oggetto annuncio per l'anteprima
        const announcement = {
          price: ctx.wizard.state.price,
          connectorType: ctx.wizard.state.currentType, 
          brand: ctx.wizard.state.brand,
          location: ctx.wizard.state.location,
          nonActivatableBrands: ctx.wizard.state.nonActivatableBrands === 'nessuno' ? '' : ctx.wizard.state.nonActivatableBrands,
          additionalInfo: ctx.wizard.state.additionalInfo === 'nessuna' ? '' : ctx.wizard.state.additionalInfo
        };
        
        logger.info(`Generazione anteprima annuncio per utente ${ctx.from.id}`);
        logger.debug(`Dati annuncio: ${JSON.stringify(announcement)}`);
        
        // Formatta l'anteprima dell'annuncio
        const announcementPreview = formatSellAnnouncement(announcement, user);
        
        try {
          // Mostra l'anteprima con bottoni
          const sentMsg = await ctx.reply(`*Anteprima del tuo annuncio:*\n\n${announcementPreview}`, {
            parse_mode: 'Markdown',
            reply_markup: Markup.inlineKeyboard([
              [
                Markup.button.callback('✅ Conferma e pubblica', 'publish_sell'),
                Markup.button.callback('❌ Annulla', 'cancel_sell')
              ]
            ])
          });
          logger.debug(`Anteprima annuncio inviata, message_id: ${sentMsg.message_id}`);
        } catch (previewErr) {
          logger.error(`Errore nell'invio dell'anteprima dell'annuncio:`, previewErr);
          // Fallback: invia solo l'anteprima senza bottoni
          await ctx.reply(`*Anteprima del tuo annuncio:*\n\n${announcementPreview}\n\nScrivi "conferma" per pubblicare o "annulla" per cancellare.`, {
            parse_mode: 'Markdown'
          });
        }
        
        logger.info(`Fine passo 7 per utente ${ctx.from.id}`);
        return ctx.wizard.next();
      } catch (err) {
        logger.error(`Errore nella creazione dell'anteprima per utente ${ctx.from.id}:`, err);
        await ctx.reply('Si è verificato un errore. Per favore, riprova più tardi o scrivi /annulla per ricominciare.');
        return ctx.scene.leave();
      }
    } catch (err) {
      logger.error(`Errore generale nel passo 7 per utente ${ctx.from.id}:`, err);
      await ctx.reply('Si è verificato un errore. Per favore, riprova più tardi o scrivi /annulla per ricominciare.');
      return ctx.scene.leave();
    }
  },
  // Passo 8: Gestito dalle callback 'publish_sell' e 'cancel_sell'
  async (ctx) => {
    try {
      logger.info(`Inizio passo 8 per utente ${ctx.from.id}`);
      
      // Gestione tramite callback
      if (ctx.callbackQuery) {
        logger.info(`Callback ricevuta nel passo 8: ${ctx.callbackQuery.data}`);
        // Le callback sono gestite separatamente
        return;
      }
      
      // Gestione tramite messaggio di testo (fallback)
      if (ctx.message && ctx.message.text) {
        const text = ctx.message.text.toLowerCase();
        
        if (text === '/annulla' || text === 'annulla') {
          logger.info(`Annullamento via testo per utente ${ctx.from.id}`);
          await ctx.reply('❌ Creazione dell\'annuncio annullata.');
          return ctx.scene.leave();
        }
        
        if (text === 'conferma' || text === 'confermo' || text === 'pubblica') {
          logger.info(`Conferma via testo per utente ${ctx.from.id}`);
          
          try {
            logger.info(`Pubblicazione annuncio per utente ${ctx.from.id}`);
            
            const user = await userService.registerUser(ctx.from);
            
            // Controlla se l'utente ha già un annuncio attivo
            const existingAnnouncement = await announcementService.getActiveAnnouncement(user.userId, 'sell');
            
            // Se esiste già un annuncio attivo, archivialo
            if (existingAnnouncement) {
              logger.info(`Archiviazione annuncio esistente ${existingAnnouncement._id} per utente ${ctx.from.id}`);
              await announcementService.archiveAnnouncement(existingAnnouncement._id);
              await announcementService.updateUserActiveAnnouncement(user.userId, 'sell', null);
            }
            
            // Crea un nuovo annuncio
            const announcementData = {
              price: ctx.wizard.state.price,
              connectorType: ctx.wizard.state.currentType,
              brand: ctx.wizard.state.brand,
              location: ctx.wizard.state.location,
              nonActivatableBrands: ctx.wizard.state.nonActivatableBrands === 'nessuno' ? '' : ctx.wizard.state.nonActivatableBrands,
              additionalInfo: ctx.wizard.state.additionalInfo === 'nessuna' ? '' : ctx.wizard.state.additionalInfo
            };
            
            const newAnnouncement = await announcementService.createSellAnnouncement(announcementData, user.userId);
            
            // Pubblica l'annuncio nel topic
            await announcementService.publishAnnouncement(newAnnouncement, user);
            
            // Aggiorna l'utente con il riferimento al nuovo annuncio
            await announcementService.updateUserActiveAnnouncement(user.userId, 'sell', newAnnouncement._id);
            
            logger.info(`Annuncio ${newAnnouncement._id} pubblicato con successo per utente ${ctx.from.id}`);
            await ctx.reply('✅ Il tuo annuncio è stato pubblicato con successo nel topic "Vendo kWh"!');
            
            return ctx.scene.leave();
          } catch (err) {
            logger.error(`Errore nella pubblicazione dell'annuncio per utente ${ctx.from.id}:`, err);
            await ctx.reply('❌ Si è verificato un errore durante la pubblicazione. Per favore, riprova più tardi.');
            return ctx.scene.leave();
          }
        }
        
        // Messaggio non riconosciuto
        await ctx.reply('Per favore, conferma o annulla la pubblicazione dell\'annuncio.');
      }
    } catch (err) {
      logger.error(`Errore generale nel passo 8 per utente ${ctx.from.id}:`, err);
      await ctx.reply('Si è verificato un errore. Per favore, riprova più tardi o scrivi /annulla per ricominciare.');
      return ctx.scene.leave();
    }
  }
);

// Gestori delle callback per il wizard
sellAnnouncementScene.action(/current_(.+)/, async (ctx) => {
  try {
    const currentType = ctx.match[1];
    ctx.wizard.state.currentType = currentType;
    
    logger.debug(`Tipo di corrente selezionato: ${currentType} per utente ${ctx.from.id}`);
    await ctx.answerCbQuery(`Hai selezionato: ${currentType}`);
    
    let currentText;
    if (currentType === 'AC') {
      currentText = 'AC';
    } else if (currentType === 'DC') {
      currentText = 'DC';
    } else if (currentType === 'both') {
      currentText = 'Entrambe (AC e DC)';
    }
    
    await ctx.reply(`Tipo di corrente selezionato: ${currentText}`);
    await ctx.wizard.steps[2](ctx);
  } catch (err) {
    logger.error(`Errore nella callback current_ per utente ${ctx.from.id}:`, err);
    await ctx.reply('Si è verificato un errore. Per favore, riprova più tardi o scrivi /annulla per ricominciare.');
  }
});

sellAnnouncementScene.action('publish_sell', async (ctx) => {
  try {
    logger.info(`Pubblicazione annuncio per utente ${ctx.from.id}`);
    await ctx.answerCbQuery('Pubblicazione in corso...');
    
    const user = await userService.registerUser(ctx.from);
    
    // Controlla se l'utente ha già un annuncio attivo
    const existingAnnouncement = await announcementService.getActiveAnnouncement(user.userId, 'sell');
    
    // Se esiste già un annuncio attivo, archivialo
    if (existingAnnouncement) {
      logger.info(`Archiviazione annuncio esistente ${existingAnnouncement._id} per utente ${ctx.from.id}`);
      await announcementService.archiveAnnouncement(existingAnnouncement._id);
      await announcementService.updateUserActiveAnnouncement(user.userId, 'sell', null);
    }
    
    // Crea un nuovo annuncio
    const announcementData = {
      price: ctx.wizard.state.price,
      connectorType: ctx.wizard.state.currentType, // Usa currentType invece di connectorType
      brand: ctx.wizard.state.brand,
      location: ctx.wizard.state.location,
      nonActivatableBrands: ctx.wizard.state.nonActivatableBrands === 'nessuno' ? '' : ctx.wizard.state.nonActivatableBrands,
      additionalInfo: ctx.wizard.state.additionalInfo === 'nessuna' ? '' : ctx.wizard.state.additionalInfo
    };
    
    const newAnnouncement = await announcementService.createSellAnnouncement(announcementData, user.userId);
    
    // Pubblica l'annuncio nel topic
    await announcementService.publishAnnouncement(newAnnouncement, user);
    
    // Aggiorna l'utente con il riferimento al nuovo annuncio
    await announcementService.updateUserActiveAnnouncement(user.userId, 'sell', newAnnouncement._id);
    
    logger.info(`Annuncio ${newAnnouncement._id} pubblicato con successo per utente ${ctx.from.id}`);
    await ctx.reply('✅ Il tuo annuncio è stato pubblicato con successo nel topic "Vendo kWh"!');
    
    return ctx.scene.leave();
  } catch (err) {
    logger.error(`Errore nella pubblicazione dell'annuncio per utente ${ctx.from.id}:`, err);
    await ctx.reply('❌ Si è verificato un errore durante la pubblicazione. Per favore, riprova più tardi.');
    return ctx.scene.leave();
  }
});

sellAnnouncementScene.action('cancel_sell', async (ctx) => {
  logger.info(`Annuncio cancellato da utente ${ctx.from.id}`);
  await ctx.answerCbQuery('Annuncio cancellato');
  await ctx.reply('❌ Creazione dell\'annuncio annullata.');
  return ctx.scene.leave();
});

// Comando per annullamento generale
sellAnnouncementScene.command('annulla', async (ctx) => {
  logger.info(`Comando /annulla ricevuto da ${ctx.from.id} durante il wizard di vendita`);
  await ctx.reply('❌ Creazione dell\'annuncio annullata.');
  return ctx.scene.leave();
});

// Aggiungiamo il comando di aiuto
sellAnnouncementScene.command('help', async (ctx) => {
  logger.info(`Comando /help ricevuto da ${ctx.from.id} durante il wizard di vendita`);
  await ctx.reply(`
*Guida alla creazione di un annuncio*

Stai creando un annuncio per vendere kWh. I passaggi sono:
1. Prezzo: indica quanto fai pagare per kWh
2. Tipo corrente: seleziona AC, DC o entrambe
3. Brand colonnina: indica quali colonnine puoi attivare
4. Posizione: indica dove sei disponibile
5. Brand non attivabili: indica se ci sono reti che non puoi attivare
6. Info aggiuntive: aggiungi altre informazioni utili

Per annullare in qualsiasi momento, usa il comando /annulla o premi il pulsante "❌ Annulla".
`, {
    parse_mode: 'Markdown'
  });
});

module.exports = sellAnnouncementScene;
