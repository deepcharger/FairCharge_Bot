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
      parse_mode: 'Markdown'
    });
    return ctx.wizard.next();
  },
  // Passo 2: Tipo corrente
  async (ctx) => {
    ctx.wizard.state.price = ctx.message.text;
    logger.debug(`Prezzo impostato: ${ctx.wizard.state.price}`);
    
    // Utilizzo Markup.inlineKeyboard per i bottoni
    await ctx.reply('Che tipo di corrente offri?', {
      reply_markup: Markup.inlineKeyboard([
        [
          Markup.button.callback('AC', 'current_AC'),
          Markup.button.callback('DC', 'current_DC')
        ],
        [Markup.button.callback('Entrambe (AC e DC)', 'current_both')]
      ])
    });
    
    return ctx.wizard.next();
  },
  // Passo 3: Brand colonnina
  async (ctx) => {
    // Questo verrà gestito nel gestore delle callback
    if (!ctx.wizard.state.currentType) {
      logger.warn(`Utente ${ctx.from.id} non ha selezionato un tipo di corrente`);
      await ctx.reply('Per favore, seleziona un tipo di corrente dalle opzioni sopra.');
      return;
    }
    
    await ctx.reply('Qual è il brand della colonnina di ricarica?\n\nEsempi: Enel X, Free To X, A2A, tutte');
    return ctx.wizard.next();
  },
  // Passo 4: Posizione
  async (ctx) => {
    ctx.wizard.state.brand = ctx.message.text;
    logger.debug(`Brand impostato: ${ctx.wizard.state.brand}`);
    
    await ctx.reply('Dove si trova la colonnina?\n\nEsempi: Italia, Francia, Provincia di Milano, Roma');
    return ctx.wizard.next();
  },
  // Passo 5: Brand non attivabili
  async (ctx) => {
    ctx.wizard.state.location = ctx.message.text;
    logger.debug(`Località impostata: ${ctx.wizard.state.location}`);
    
    await ctx.reply('Ci sono brand di colonnine non attivabili? (scrivi "nessuno" se non ci sono)');
    return ctx.wizard.next();
  },
  // Passo 6: Informazioni aggiuntive
  async (ctx) => {
    ctx.wizard.state.nonActivatableBrands = ctx.message.text;
    logger.debug(`Brand non attivabili: ${ctx.wizard.state.nonActivatableBrands}`);
    
    await ctx.reply('Altre informazioni da aggiungere? (scrivi "nessuna" se non ce ne sono)');
    return ctx.wizard.next();
  },
  // Passo 7: Conferma annuncio
  async (ctx) => {
    ctx.wizard.state.additionalInfo = ctx.message.text;
    logger.debug(`Info aggiuntive: ${ctx.wizard.state.additionalInfo}`);
    
    try {
      const user = await userService.registerUser(ctx.from);
      
      // Creare l'oggetto annuncio per l'anteprima
      const announcement = {
        price: ctx.wizard.state.price,
        connectorType: ctx.wizard.state.currentType, // Usa currentType invece di connectorType
        brand: ctx.wizard.state.brand,
        location: ctx.wizard.state.location,
        nonActivatableBrands: ctx.wizard.state.nonActivatableBrands === 'nessuno' ? '' : ctx.wizard.state.nonActivatableBrands,
        additionalInfo: ctx.wizard.state.additionalInfo === 'nessuna' ? '' : ctx.wizard.state.additionalInfo
      };
      
      logger.info(`Generazione anteprima annuncio per utente ${ctx.from.id}`);
      
      // Mostra l'anteprima
      await ctx.reply(`*Anteprima del tuo annuncio:*\n\n${formatSellAnnouncement(announcement, user)}`, {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard([
          [
            Markup.button.callback('✅ Conferma e pubblica', 'publish_sell'),
            Markup.button.callback('❌ Annulla', 'cancel_sell')
          ]
        ])
      });
      
      return ctx.wizard.next();
    } catch (err) {
      logger.error(`Errore nella creazione dell'anteprima per utente ${ctx.from.id}:`, err);
      await ctx.reply('Si è verificato un errore. Per favore, riprova più tardi.');
      return ctx.scene.leave();
    }
  },
  // Passo 8: Gestito dalle callback 'publish_sell' e 'cancel_sell'
  async (ctx) => {
    // Questo passaggio rimane vuoto, in quanto gestito dalle callback
  }
);

// Gestori delle callback per il wizard - Cambiato connector_ con current_
sellAnnouncementScene.action(/current_(.+)/, async (ctx) => {
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

module.exports = sellAnnouncementScene;
