// Wizard per la creazione di un annuncio di vendita kWh
const { Scenes, Markup } = require('telegraf');
const logger = require('../../utils/logger');
const User = require('../../models/user');
const Announcement = require('../../models/announcement');
const { isAdmin } = require('../../config/admin');
const uiElements = require('../../utils/uiElements');

// Step totali nel wizard
const TOTAL_STEPS = 5;

// Funzione per mostrare il progresso
const showProgress = (step, title) => {
  return uiElements.formatProgressMessage(step, TOTAL_STEPS, title);
};

// Creazione dello wizard per l'annuncio di vendita
const sellAnnouncementWizard = new Scenes.WizardScene(
  'SELL_ANNOUNCEMENT_WIZARD',
  
  // Step 1: chiedi prezzo per kWh
  async (ctx) => {
    try {
      // Registra l'utente se non esiste
      const User = require('../../models/user');
      let user = await User.findOne({ userId: ctx.from.id });
      
      if (!user) {
        user = new User({
          userId: ctx.from.id,
          username: ctx.from.username,
          firstName: ctx.from.first_name,
          lastName: ctx.from.last_name,
          registrationDate: new Date()
        });
        await user.save();
      }
      
      // Verifica se l'utente ha già un annuncio attivo
      const Announcement = require('../../models/announcement');
      const activeAnnouncement = await Announcement.findOne({
        userId: ctx.from.id,
        status: 'active',
        type: 'sell'
      });
      
      if (activeAnnouncement) {
        await ctx.reply(uiElements.formatErrorMessage(
          'Hai già un annuncio di vendita attivo. Per creare un nuovo annuncio, prima archivia quello esistente con /archivia_annuncio', 
          true
        ), {
          parse_mode: 'HTML',
          ...uiElements.mainMenuButton().reply_markup
        });
        return ctx.scene.leave();
      }
      
      // Inizializza lo stato della sessione
      ctx.session.sellWizardState = {
        step: 1,
        data: {}
      };
      
      // Mostra il primo step
      await ctx.reply(
        showProgress(1, "Creazione Annuncio Vendita kWh") + 
        "Qual è il prezzo al kWh che vuoi offrire?\n\n" +
        "Inserisci il prezzo in € per kWh (es. 0.35):" +
        "\n\n" + uiElements.formatTimeoutWarning(30),
        {
          parse_mode: 'HTML',
          ...uiElements.wizardNavigationButtons(false, false, 'wizard_back', 'wizard_skip', 'cancel_sell').reply_markup
        }
      );
      
      return ctx.wizard.next();
    } catch (err) {
      logger.error(`Errore nello step 1 del wizard sell per utente ${ctx.from.id}:`, err);
      await ctx.reply(uiElements.formatErrorMessage('Si è verificato un errore. Per favore, riprova più tardi.', true), {
        parse_mode: 'HTML',
        ...uiElements.mainMenuButton().reply_markup
      });
      return ctx.scene.leave();
    }
  },
  
  // Step 2: gestisci il prezzo e chiedi il tipo di corrente
  async (ctx) => {
    try {
      // Se l'utente ha cliccato su annulla, esci
      if (ctx.callbackQuery && ctx.callbackQuery.data === 'cancel_sell') {
        await ctx.answerCbQuery('Procedura annullata');
        await ctx.reply(uiElements.formatErrorMessage('Procedura di creazione annuncio annullata.', false), {
          parse_mode: 'HTML',
          ...uiElements.mainMenuButton().reply_markup
        });
        return ctx.scene.leave();
      }
      
      // Se è un messaggio di testo, elabora il prezzo
      if (ctx.message && ctx.message.text) {
        // Rimuovi simboli di valuta e sostituisci virgole con punti
        let priceText = ctx.message.text.replace(/[€$£¥]/g, '').replace(',', '.');
        let price = parseFloat(priceText);
        
        // Valida il prezzo
        if (isNaN(price) || price <= 0 || price > 10) {
          await ctx.reply(uiElements.formatErrorMessage(
            'Prezzo non valido. Inserisci un numero positivo fino a 10€ (es. 0.35):',
            false
          ), {
            parse_mode: 'HTML',
            ...uiElements.wizardNavigationButtons(false, false, 'wizard_back', 'wizard_skip', 'cancel_sell').reply_markup
          });
          return;
        }
        
        // Salva il prezzo nella sessione
        ctx.session.sellWizardState.data.pricePerKwh = price;
        ctx.session.sellWizardState.step = 2;
        
        // Mostra il secondo step con bottoni per il tipo di corrente
        await ctx.reply(
          showProgress(2, "Creazione Annuncio Vendita kWh") + 
          `Prezzo impostato a ${price.toFixed(2)}€/kWh\n\n` +
          'Che tipo di corrente offri con la tua wallbox?',
          { 
            parse_mode: 'HTML',
            reply_markup: uiElements.currentTypeButtons().reply_markup
          }
        );
        
        return ctx.wizard.next();
      } else {
        await ctx.reply('Per favore, inserisci il prezzo in formato numerico (es. 0.35)');
      }
    } catch (err) {
      logger.error(`Errore nello step 2 del wizard sell per utente ${ctx.from.id}:`, err);
      await ctx.reply(uiElements.formatErrorMessage('Si è verificato un errore. Per favore, riprova più tardi.', true), {
        parse_mode: 'HTML',
        ...uiElements.mainMenuButton().reply_markup
      });
      return ctx.scene.leave();
    }
  },
  
  // Step 3: gestisci il tipo di corrente e chiedi la posizione
  async (ctx) => {
    try {
      // Se l'utente ha cliccato su annulla, esci
      if (ctx.callbackQuery && ctx.callbackQuery.data === 'cancel_sell') {
        await ctx.answerCbQuery('Procedura annullata');
        await ctx.reply(uiElements.formatErrorMessage('Procedura di creazione annuncio annullata.', false), {
          parse_mode: 'HTML',
          ...uiElements.mainMenuButton().reply_markup
        });
        return ctx.scene.leave();
      }
      
      // Gestisci la callback del tipo di corrente
      if (ctx.callbackQuery && ctx.callbackQuery.data.startsWith('current_')) {
        // Estrai il tipo di corrente
        const currentType = ctx.callbackQuery.data.split('_')[1];
        
        // Valida il tipo di corrente
        if (currentType !== 'AC' && currentType !== 'DC' && currentType !== 'both') {
          await ctx.answerCbQuery('Tipo di corrente non valido', { show_alert: true });
          return;
        }
        
        // Conferma la callback
        await ctx.answerCbQuery();
        
        // Salva il tipo di corrente nella sessione
        ctx.session.sellWizardState.data.currentType = currentType;
        ctx.session.sellWizardState.step = 3;
        
        // Mappa per i nomi leggibili dei tipi di corrente
        const currentTypeNames = {
          'AC': 'Corrente alternata (AC)',
          'DC': 'Corrente continua (DC)',
          'both': 'Entrambe (AC e DC)'
        };
        
        // Mostra il terzo step
        await ctx.reply(
          showProgress(3, "Creazione Annuncio Vendita kWh") + 
          `Tipo di corrente: ${currentTypeNames[currentType]}\n\n` +
          'Dove si trova la tua wallbox?\n\n' +
          'Invia la posizione o inserisci l\'indirizzo come testo:',
          { 
            parse_mode: 'HTML',
            ...uiElements.wizardNavigationButtons(true, false, 'wizard_back_location', 'wizard_skip', 'cancel_sell').reply_markup
          }
        );
        
        return ctx.wizard.next();
      } else if (ctx.callbackQuery && ctx.callbackQuery.data === 'wizard_back_location') {
        // Torna allo step precedente
        await ctx.answerCbQuery();
        
        // Mostra nuovamente lo step 1
        await ctx.reply(
          showProgress(1, "Creazione Annuncio Vendita kWh") + 
          "Qual è il prezzo al kWh che vuoi offrire?\n\n" +
          "Inserisci il prezzo in € per kWh (es. 0.35):",
          {
            parse_mode: 'HTML',
            ...uiElements.wizardNavigationButtons(false, false, 'wizard_back', 'wizard_skip', 'cancel_sell').reply_markup
          }
        );
        
        return ctx.wizard.back();
      } else {
        await ctx.reply('Per favore, seleziona il tipo di corrente dai bottoni qui sopra.');
      }
    } catch (err) {
      logger.error(`Errore nello step 3 del wizard sell per utente ${ctx.from.id}:`, err);
      await ctx.reply(uiElements.formatErrorMessage('Si è verificato un errore. Per favore, riprova più tardi.', true), {
        parse_mode: 'HTML',
        ...uiElements.mainMenuButton().reply_markup
      });
      return ctx.scene.leave();
    }
  },
  
  // Step 4: gestisci la posizione e chiedi le informazioni aggiuntive
  async (ctx) => {
    try {
      // Se l'utente ha cliccato su annulla, esci
      if (ctx.callbackQuery && ctx.callbackQuery.data === 'cancel_sell') {
        await ctx.answerCbQuery('Procedura annullata');
        await ctx.reply(uiElements.formatErrorMessage('Procedura di creazione annuncio annullata.', false), {
          parse_mode: 'HTML',
          ...uiElements.mainMenuButton().reply_markup
        });
        return ctx.scene.leave();
      }
      
      // Gestisci la callback di navigazione
      if (ctx.callbackQuery && ctx.callbackQuery.data === 'wizard_back_location') {
        // Torna allo step precedente
        await ctx.answerCbQuery();
        
        // Mostra nuovamente lo step 2
        await ctx.reply(
          showProgress(2, "Creazione Annuncio Vendita kWh") + 
          `Prezzo impostato a ${ctx.session.sellWizardState.data.pricePerKwh.toFixed(2)}€/kWh\n\n` +
          'Che tipo di corrente offri con la tua wallbox?',
          { 
            parse_mode: 'HTML',
            reply_markup: uiElements.currentTypeButtons().reply_markup
          }
        );
        
        return ctx.wizard.back();
      }
      
      // Gestisci la posizione
      let location = null;
      let address = '';
      
      if (ctx.message && ctx.message.location) {
        // Posizione inviata come location Telegram
        location = {
          latitude: ctx.message.location.latitude,
          longitude: ctx.message.location.longitude,
          address: 'Coordinate GPS'
        };
        address = 'Coordinate GPS';
      } else if (ctx.message && ctx.message.text) {
        // Posizione inviata come testo
        address = ctx.message.text;
        location = {
          address: address
        };
      } else {
        await ctx.reply('Per favore, invia la posizione o inserisci l\'indirizzo come testo.');
        return;
      }
      
      // Salva la posizione nella sessione
      ctx.session.sellWizardState.data.location = location;
      ctx.session.sellWizardState.step = 4;
      
      // Mostra il quarto step
      await ctx.reply(
        showProgress(4, "Creazione Annuncio Vendita kWh") + 
        `Posizione: ${address}\n\n` +
        'Quali sono i tuoi orari di disponibilità e altre informazioni utili?\n\n' +
        'Inserisci queste informazioni (o digita "skip" per saltare):',
        { 
          parse_mode: 'HTML',
          ...uiElements.wizardNavigationButtons(true, true, 'wizard_back_info', 'wizard_skip_info', 'cancel_sell').reply_markup
        }
      );
      
      return ctx.wizard.next();
    } catch (err) {
      logger.error(`Errore nello step 4 del wizard sell per utente ${ctx.from.id}:`, err);
      await ctx.reply(uiElements.formatErrorMessage('Si è verificato un errore. Per favore, riprova più tardi.', true), {
        parse_mode: 'HTML',
        ...uiElements.mainMenuButton().reply_markup
      });
      return ctx.scene.leave();
    }
  },
  
  // Step 5: gestisci le informazioni aggiuntive e mostra il riepilogo
  async (ctx) => {
    try {
      // Se l'utente ha cliccato su annulla, esci
      if (ctx.callbackQuery && ctx.callbackQuery.data === 'cancel_sell') {
        await ctx.answerCbQuery('Procedura annullata');
        await ctx.reply(uiElements.formatErrorMessage('Procedura di creazione annuncio annullata.', false), {
          parse_mode: 'HTML',
          ...uiElements.mainMenuButton().reply_markup
        });
        return ctx.scene.leave();
      }
      
      // Gestisci la callback di navigazione
      if (ctx.callbackQuery && ctx.callbackQuery.data === 'wizard_back_info') {
        // Torna allo step precedente
        await ctx.answerCbQuery();
        
        // Mostra nuovamente lo step 3
        await ctx.reply(
          showProgress(3, "Creazione Annuncio Vendita kWh") + 
          `Tipo di corrente: ${ctx.session.sellWizardState.data.currentType}\n\n` +
          'Dove si trova la tua wallbox?\n\n' +
          'Invia la posizione o inserisci l\'indirizzo come testo:',
          { 
            parse_mode: 'HTML',
            ...uiElements.wizardNavigationButtons(true, false, 'wizard_back_location', 'wizard_skip', 'cancel_sell').reply_markup
          }
        );
        
        return ctx.wizard.back();
      }
      
      // Gestisci il salto delle informazioni aggiuntive
      let additionalInfo = '';
      
      if (ctx.callbackQuery && ctx.callbackQuery.data === 'wizard_skip_info') {
        await ctx.answerCbQuery();
        additionalInfo = 'Nessuna informazione aggiuntiva fornita.';
      } else if (ctx.message && ctx.message.text) {
        if (ctx.message.text.toLowerCase() === 'skip') {
          additionalInfo = 'Nessuna informazione aggiuntiva fornita.';
        } else {
          additionalInfo = ctx.message.text;
        }
      } else {
        await ctx.reply('Per favore, inserisci le informazioni aggiuntive o premi "Salta".');
        return;
      }
      
      // Salva le informazioni aggiuntive nella sessione
      ctx.session.sellWizardState.data.additionalInfo = additionalInfo;
      ctx.session.sellWizardState.step = 5;
      
      // Prepara il riepilogo
      const { pricePerKwh, currentType, location, additionalInfo: info } = ctx.session.sellWizardState.data;
      
      // Mappa per i nomi leggibili dei tipi di corrente
      const currentTypeNames = {
        'AC': 'Corrente alternata (AC)',
        'DC': 'Corrente continua (DC)',
        'both': 'Entrambe (AC e DC)'
      };
      
      // Formatta le informazioni di riepilogo
      const items = [
        { label: 'Prezzo per kWh', value: `${pricePerKwh.toFixed(2)}€` },
        { label: 'Tipo di corrente', value: currentTypeNames[currentType] },
        { label: 'Posizione', value: location.address },
        { label: 'Informazioni aggiuntive', value: info }
      ];
      
      // Mostra il riepilogo
      await ctx.reply(
        showProgress(5, "Creazione Annuncio Vendita kWh") + 
        uiElements.formatConfirmationMessage('Riepilogo dell\'annuncio', items),
        { 
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                Markup.button.callback('✅ Pubblica annuncio', 'publish_sell'),
                Markup.button.callback('❌ Annulla', 'cancel_sell')
              ]
            ]
          }
        }
      );
      
      return ctx.wizard.next();
    } catch (err) {
      logger.error(`Errore nello step 5 del wizard sell per utente ${ctx.from.id}:`, err);
      await ctx.reply(uiElements.formatErrorMessage('Si è verificato un errore. Per favore, riprova più tardi.', true), {
        parse_mode: 'HTML',
        ...uiElements.mainMenuButton().reply_markup
      });
      return ctx.scene.leave();
    }
  },
  
  // Step 6: gestisci la pubblicazione dell'annuncio
  async (ctx) => {
    try {
      // Se l'utente ha cliccato su annulla, esci
      if (ctx.callbackQuery && ctx.callbackQuery.data === 'cancel_sell') {
        await ctx.answerCbQuery('Procedura annullata');
        await ctx.reply(uiElements.formatErrorMessage('Procedura di creazione annuncio annullata.', false), {
          parse_mode: 'HTML',
          ...uiElements.mainMenuButton().reply_markup
        });
        return ctx.scene.leave();
      }
      
      // Gestisci la callback di pubblicazione
      if (ctx.callbackQuery && ctx.callbackQuery.data === 'publish_sell') {
        await ctx.answerCbQuery();
        
        // Crea l'annuncio nel database
        const { pricePerKwh, currentType, location, additionalInfo } = ctx.session.sellWizardState.data;
        
        // Crea l'annuncio
        const newAnnouncement = new Announcement({
          userId: ctx.from.id,
          type: 'sell',
          status: 'active',
          pricePerKwh: pricePerKwh,
          currentType: currentType,
          location: location,
          additionalInfo: additionalInfo,
          createdAt: new Date(),
          updatedAt: new Date()
        });
        
        await newAnnouncement.save();
        
        // Aggiorna il riferimento nell'utente
        await User.updateOne(
          { userId: ctx.from.id },
          { $set: { 'activeAnnouncements.sell': newAnnouncement._id } }
        );
        
        // Invia il messaggio di conferma
        await ctx.reply(uiElements.formatSuccessMessage(
          'Annuncio Pubblicato con Successo',
          `Il tuo annuncio di vendita kWh a ${pricePerKwh.toFixed(2)}€ è stato pubblicato.\n\nPer vedere o archiviare l'annuncio, usa /profilo.\n\nOra gli acquirenti potranno prenotare ricariche alla tua wallbox!`
        ), {
          parse_mode: 'HTML',
          ...uiElements.mainMenuButton().reply_markup
        });
        
        // Pulisci la sessione
        delete ctx.session.sellWizardState;
        
        // Esci dalla scena
        return ctx.scene.leave();
      } else {
        await ctx.reply('Per favore, utilizza i bottoni per pubblicare o annullare l\'annuncio.');
      }
    } catch (err) {
      logger.error(`Errore nella pubblicazione dell'annuncio per utente ${ctx.from.id}:`, err);
      await ctx.reply(uiElements.formatErrorMessage('Si è verificato un errore. Per favore, riprova più tardi.', true), {
        parse_mode: 'HTML',
        ...uiElements.mainMenuButton().reply_markup
      });
      return ctx.scene.leave();
    }
  }
);

// Gestione del timeout della scena
sellAnnouncementWizard.action('cancel_sell', async (ctx) => {
  try {
    await ctx.answerCbQuery('Procedura annullata');
    await ctx.reply(uiElements.formatErrorMessage('Procedura di creazione annuncio annullata.', false), {
      parse_mode: 'HTML',
      ...uiElements.mainMenuButton().reply_markup
    });
    return ctx.scene.leave();
  } catch (err) {
    logger.error(`Errore nella callback cancel_sell per utente ${ctx.from.id}:`, err);
    return ctx.scene.leave();
  }
});

// Gestione del comando /annulla durante lo wizard
sellAnnouncementWizard.command('annulla', async (ctx) => {
  try {
    await ctx.reply(uiElements.formatErrorMessage('Procedura di creazione annuncio annullata.', false), {
      parse_mode: 'HTML',
      ...uiElements.mainMenuButton().reply_markup
    });
    return ctx.scene.leave();
  } catch (err) {
    logger.error(`Errore nel comando annulla per utente ${ctx.from.id}:`, err);
    return ctx.scene.leave();
  }
});

// Esportazione della scena
module.exports = sellAnnouncementWizard;
