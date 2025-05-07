// Scene per la creazione di un annuncio di vendita
const { Scenes, Markup } = require('telegraf');
const userService = require('../../services/userService');
const announcementService = require('../../services/announcementService');
const { formatSellAnnouncement } = require('../../utils/formatters');

// Crea la scena per il wizard
const sellAnnouncementScene = new Scenes.WizardScene(
  'SELL_ANNOUNCEMENT_WIZARD',
  // Passo 1: Prezzo
  async (ctx) => {
    await ctx.reply('🔋 *Vendi kWh* 🔋\n\nQual è il prezzo che vuoi offrire?\n\nEsempi:\n- `0.35€ per kWh`\n- `0.28€ per ricariche > 40kW, 0.35€ per ricariche < 40kW`', {
      parse_mode: 'Markdown'
    });
    return ctx.wizard.next();
  },
  // Passo 2: Tipo connettore
  async (ctx) => {
    ctx.wizard.state.price = ctx.message.text;
    await ctx.reply('Che tipo di connettore offri?', {
      reply_markup: Markup.inlineKeyboard([
        [
          Markup.button.callback('AC', 'connector_AC'),
          Markup.button.callback('DC', 'connector_DC'),
          Markup.button.callback('Entrambi (AC e DC)', 'connector_both')
        ]
      ])
    });
    return ctx.wizard.next();
  },
  // Passo 3: Brand colonnina
  async (ctx) => {
    // Questo verrà gestito nel gestore delle callback
    if (!ctx.wizard.state.connectorType) {
      await ctx.reply('Per favore, seleziona un tipo di connettore dalle opzioni.');
      return;
    }
    
    await ctx.reply('Qual è il brand della colonnina di ricarica?\n\nEsempi: Enel X, Free To X, A2A, tutte');
    return ctx.wizard.next();
  },
  // Passo 4: Posizione
  async (ctx) => {
    ctx.wizard.state.brand = ctx.message.text;
    await ctx.reply('Dove si trova la colonnina?\n\nEsempi: Italia, Francia, Provincia di Milano, Roma');
    return ctx.wizard.next();
  },
  // Passo 5: Brand non attivabili
  async (ctx) => {
    ctx.wizard.state.location = ctx.message.text;
    await ctx.reply('Ci sono brand di colonnine non attivabili? (scrivi "nessuno" se non ci sono)');
    return ctx.wizard.next();
  },
  // Passo 6: Informazioni aggiuntive
  async (ctx) => {
    ctx.wizard.state.nonActivatableBrands = ctx.message.text;
    await ctx.reply('Altre informazioni da aggiungere? (scrivi "nessuna" se non ce ne sono)');
    return ctx.wizard.next();
  },
  // Passo 7: Conferma annuncio
  async (ctx) => {
    ctx.wizard.state.additionalInfo = ctx.message.text;
    
    try {
      const user = await userService.registerUser(ctx.from);
      
      // Creare l'oggetto annuncio per l'anteprima
      const announcement = {
        price: ctx.wizard.state.price,
        connectorType: ctx.wizard.state.connectorType,
        brand: ctx.wizard.state.brand,
        location: ctx.wizard.state.location,
        nonActivatableBrands: ctx.wizard.state.nonActivatableBrands === 'nessuno' ? '' : ctx.wizard.state.nonActivatableBrands,
        additionalInfo: ctx.wizard.state.additionalInfo === 'nessuna' ? '' : ctx.wizard.state.additionalInfo
      };
      
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
      console.error('Errore nella creazione dell\'anteprima:', err);
      await ctx.reply('Si è verificato un errore. Per favore, riprova più tardi.');
      return ctx.scene.leave();
    }
  },
  // Passo 8: Gestito dalle callback 'publish_sell' e 'cancel_sell'
  async (ctx) => {
    // Questo passaggio rimane vuoto, in quanto gestito dalle callback
  }
