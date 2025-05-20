// Scene per l'acquisto di kWh
const { Scenes, Markup } = require('telegraf');
const moment = require('moment');
const userService = require('../../services/userService');
const offerService = require('../../services/offerService');
const Announcement = require('../../models/announcement');
const User = require('../../models/user');
const { formatSellAnnouncement } = require('../../utils/formatters');
const logger = require('../../utils/logger');
const uiElements = require('../../utils/uiElements');

// Step totali nel wizard
const TOTAL_STEPS = 6;

// Funzione per mostrare il progresso
const showProgress = (step, title) => {
  return uiElements.formatProgressMessage(step, TOTAL_STEPS, title);
};

// Creazione dello wizard per l'acquisto di kWh
const buyKwhWizard = new Scenes.WizardScene(
  'BUY_KWH_WIZARD',
  
  // Passo 1: Mostra l'annuncio selezionato e chiede conferma
  async (ctx) => {
    try {
      // Estrai l'ID dell'annuncio dalla sessione o dai dati del wizard
      const announcementId = ctx.session.announcementId || (ctx.wizard.state && ctx.wizard.state.announcementId);
      
      if (!announcementId) {
        await ctx.reply(uiElements.formatErrorMessage('Nessun annuncio selezionato. Riprova dalla chat di gruppo.', true), {
          parse_mode: 'HTML',
          ...uiElements.mainMenuButton().reply_markup
        });
        return ctx.scene.leave();
      }
      
      // Memorizza l'ID nel wizard state
      ctx.wizard.state = ctx.wizard.state || {};
      ctx.wizard.state.announcementId = announcementId;
      
      // Inizializza lo stato della sessione
      ctx.session.buyWizardState = {
        step: 1,
        data: {
          announcementId: announcementId
        }
      };
      
      // Pulisci l'ID dalla sessione per evitare problemi in future interazioni
      if (ctx.session.announcementId) {
        delete ctx.session.announcementId;
      }
      
      // Trova l'annuncio
      const announcement = await Announcement.findById(announcementId);
      if (!announcement || announcement.status !== 'active') {
        await ctx.reply(uiElements.formatErrorMessage('L\'annuncio non è più disponibile.', true), {
          parse_mode: 'HTML',
          ...uiElements.mainMenuButton().reply_markup
        });
        return ctx.scene.leave();
      }
      
      // Trova il venditore
      const seller = await User.findOne({ userId: announcement.userId });
      if (!seller) {
        await ctx.reply(uiElements.formatErrorMessage('Si è verificato un errore. Venditore non trovato.', true), {
          parse_mode: 'HTML',
          ...uiElements.mainMenuButton().reply_markup
        });
        return ctx.scene.leave();
      }
      
      // Memorizza i dati nella sessione
      ctx.wizard.state.announcement = announcement;
      ctx.wizard.state.seller = seller;
      ctx.session.buyWizardState.data.announcement = announcement;
      ctx.session.buyWizardState.data.seller = seller;
      
      // Formatta l'annuncio da mostrare
      const announcementText = formatSellAnnouncement(announcement, seller);
      
      // Invia il messaggio con l'annuncio e i bottoni per accettare o annullare
      await ctx.reply(
        showProgress(1, "Procedura di Acquisto kWh") + 
        "Hai selezionato questo annuncio:\n\n" + announcementText +
        "\n\nPer procedere con l'acquisto, accetta le condizioni.",
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Accetto le condizioni', callback_data: 'accept_conditions' },
                { text: '❌ Annulla', callback_data: 'cancel_buy' }
              ]
            ]
          }
        }
      );
      
      return ctx.wizard.next();
    } catch (err) {
      logger.error(`Errore nel caricamento dell'annuncio per utente ${ctx.from.id}:`, err);
      await ctx.reply(uiElements.formatErrorMessage('Si è verificato un errore. Per favore, riprova più tardi.', true), {
        parse_mode: 'HTML',
        ...uiElements.mainMenuButton().reply_markup
      });
      return ctx.scene.leave();
    }
  },
  
  // Passo 2: Data di ricarica
  async (ctx) => {
    // Questo passaggio è principalmente gestito dalle callback
    try {
      // Controllo se è un comando di annullamento
      if (ctx.message && ctx.message.text && ctx.message.text === '/annulla') {
        logger.info(`Comando /annulla ricevuto da ${ctx.from.id} nel wizard di acquisto`);
        await ctx.reply(uiElements.formatErrorMessage('Procedura di acquisto annullata.', false), {
          parse_mode: 'HTML',
          ...uiElements.mainMenuButton().reply_markup
        });
        return ctx.scene.leave();
      }
      
      // Se riceviamo un messaggio ma non una callback, probabilmente è la risposta alla data
      if (ctx.message && ctx.message.text) {
        ctx.session.buyWizardState.data.date = ctx.message.text;
        ctx.session.buyWizardState.step = 2;
        
        // Verifica che la data sia valida (formato DD/MM/YYYY)
        const dateRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
        if (!dateRegex.test(ctx.session.buyWizardState.data.date)) {
          await ctx.reply(uiElements.formatErrorMessage('Formato data non valido. Inserisci la data nel formato DD/MM/YYYY.', false), {
            parse_mode: 'HTML',
            ...uiElements.wizardNavigationButtons(false, false, 'wizard_back', 'wizard_skip', 'cancel_buy').reply_markup
          });
          return;
        }
        
        // Passa al prossimo step
        await ctx.reply(
          showProgress(3, "Procedura di Acquisto kWh") + 
          "A che ora vorresti ricaricare?\n\n" +
          "Inserisci l'ora nel formato HH:MM (es. 14:30):",
          {
            parse_mode: 'HTML',
            ...uiElements.wizardNavigationButtons(true, false, 'wizard_back_time', 'wizard_skip', 'cancel_buy').reply_markup
          }
        );
        
        return ctx.wizard.next();
      }
    } catch (err) {
      logger.error(`Errore nel processare la data per utente ${ctx.from.id}:`, err);
      await ctx.reply(uiElements.formatErrorMessage('Si è verificato un errore. Per favore, riprova più tardi.', true), {
        parse_mode: 'HTML',
        ...uiElements.mainMenuButton().reply_markup
      });
      return ctx.scene.leave();
    }
  },
  
  // Passo 3: Ora di ricarica
  async (ctx) => {
    try {
      // Controllo se è un comando di annullamento
      if (ctx.message && ctx.message.text && ctx.message.text === '/annulla') {
        logger.info(`Comando /annulla ricevuto da ${ctx.from.id} nel wizard di acquisto`);
        await ctx.reply(uiElements.formatErrorMessage('Procedura di acquisto annullata.', false), {
          parse_mode: 'HTML',
          ...uiElements.mainMenuButton().reply_markup
        });
        return ctx.scene.leave();
      }
      
      // Se è una callback di navigazione indietro
      if (ctx.callbackQuery && ctx.callbackQuery.data === 'wizard_back_time') {
        await ctx.answerCbQuery();
        
        // Torna allo step precedente
        await ctx.reply(
          showProgress(2, "Procedura di Acquisto kWh") + 
          "In quale data vorresti ricaricare?\n\n" +
          "Inserisci la data nel formato DD/MM/YYYY (es. 15/05/2023):",
          {
            parse_mode: 'HTML',
            ...uiElements.wizardNavigationButtons(true, false, 'wizard_back', 'wizard_skip', 'cancel_buy').reply_markup
          }
        );
        
        return ctx.wizard.back();
      }
      
      // Se riceviamo un messaggio di testo, è l'ora
      if (ctx.message && ctx.message.text) {
        ctx.session.buyWizardState.data.time = ctx.message.text;
        ctx.session.buyWizardState.step = 3;
        
        // Verifica che l'ora sia valida (formato HH:MM)
        const timeRegex = /^(\d{1,2}):(\d{2})$/;
        if (!timeRegex.test(ctx.session.buyWizardState.data.time)) {
          await ctx.reply(uiElements.formatErrorMessage('Formato ora non valido. Inserisci l\'ora nel formato HH:MM.', false), {
            parse_mode: 'HTML',
            ...uiElements.wizardNavigationButtons(true, false, 'wizard_back_time', 'wizard_skip', 'cancel_buy').reply_markup
          });
          return;
        }
        
        // Passa al prossimo step
        await ctx.reply(
          showProgress(4, "Procedura di Acquisto kWh") + 
          "Quale brand di colonnina utilizzerai?\n\n" +
          "Inserisci il brand (es. Enel X, A2A, Be Charge...):",
          {
            parse_mode: 'HTML',
            ...uiElements.wizardNavigationButtons(true, false, 'wizard_back_brand', 'wizard_skip', 'cancel_buy').reply_markup
          }
        );
        
        return ctx.wizard.next();
      }
    } catch (err) {
      logger.error(`Errore nel processare l'ora per utente ${ctx.from.id}:`, err);
      await ctx.reply(uiElements.formatErrorMessage('Si è verificato un errore. Per favore, riprova più tardi.', true), {
        parse_mode: 'HTML',
        ...uiElements.mainMenuButton().reply_markup
      });
      return ctx.scene.leave();
    }
  },
  
  // Passo 4: Brand colonnina
  async (ctx) => {
    try {
      // Controllo se è un comando di annullamento
      if (ctx.message && ctx.message.text && ctx.message.text === '/annulla') {
        logger.info(`Comando /annulla ricevuto da ${ctx.from.id} nel wizard di acquisto`);
        await ctx.reply(uiElements.formatErrorMessage('Procedura di acquisto annullata.', false), {
          parse_mode: 'HTML',
          ...uiElements.mainMenuButton().reply_markup
        });
        return ctx.scene.leave();
      }
      
      // Se è una callback di navigazione indietro
      if (ctx.callbackQuery && ctx.callbackQuery.data === 'wizard_back_brand') {
        await ctx.answerCbQuery();
        
        // Torna allo step precedente
        await ctx.reply(
          showProgress(3, "Procedura di Acquisto kWh") + 
          "A che ora vorresti ricaricare?\n\n" +
          "Inserisci l'ora nel formato HH:MM (es. 14:30):",
          {
            parse_mode: 'HTML',
            ...uiElements.wizardNavigationButtons(true, false, 'wizard_back_time', 'wizard_skip', 'cancel_buy').reply_markup
          }
        );
        
        return ctx.wizard.back();
      }
      
      // Se riceviamo un messaggio di testo, è il brand
      if (ctx.message && ctx.message.text) {
        ctx.session.buyWizardState.data.brand = ctx.message.text;
        ctx.session.buyWizardState.step = 4;
        
        // Passa al prossimo step
        await ctx.reply(
          showProgress(5, "Procedura di Acquisto kWh") + 
          "Inserisci le coordinate GPS della colonnina\n\n" +
          "Nel formato numerico, ad esempio 41.87290, 12.47326:",
          {
            parse_mode: 'HTML',
            ...uiElements.wizardNavigationButtons(true, false, 'wizard_back_coordinates', 'wizard_skip', 'cancel_buy').reply_markup
          }
        );
        
        return ctx.wizard.next();
      }
    } catch (err) {
      logger.error(`Errore nel processare il brand per utente ${ctx.from.id}:`, err);
      await ctx.reply(uiElements.formatErrorMessage('Si è verificato un errore. Per favore, riprova più tardi.', true), {
        parse_mode: 'HTML',
        ...uiElements.mainMenuButton().reply_markup
      });
      return ctx.scene.leave();
    }
  },
  
  // Passo 5: Coordinate GPS
  async (ctx) => {
    try {
      // Controllo se è un comando di annullamento
      if (ctx.message && ctx.message.text && ctx.message.text === '/annulla') {
        logger.info(`Comando /annulla ricevuto da ${ctx.from.id} nel wizard di acquisto`);
        await ctx.reply(uiElements.formatErrorMessage('Procedura di acquisto annullata.', false), {
          parse_mode: 'HTML',
          ...uiElements.mainMenuButton().reply_markup
        });
        return ctx.scene.leave();
      }
      
      // Se è una callback di navigazione indietro
      if (ctx.callbackQuery && ctx.callbackQuery.data === 'wizard_back_coordinates') {
        await ctx.answerCbQuery();
        
        // Torna allo step precedente
        await ctx.reply(
          showProgress(4, "Procedura di Acquisto kWh") + 
          "Quale brand di colonnina utilizzerai?\n\n" +
          "Inserisci il brand (es. Enel X, A2A, Be Charge...):",
          {
            parse_mode: 'HTML',
            ...uiElements.wizardNavigationButtons(true, false, 'wizard_back_brand', 'wizard_skip', 'cancel_buy').reply_markup
          }
        );
        
        return ctx.wizard.back();
      }
      
      // Se riceviamo un messaggio di testo, sono le coordinate
      if (ctx.message && ctx.message.text) {
        ctx.session.buyWizardState.data.coordinates = ctx.message.text;
        ctx.session.buyWizardState.step = 5;
        
        // Passa al prossimo step
        await ctx.reply(
          showProgress(6, "Procedura di Acquisto kWh") + 
          "Vuoi aggiungere altre informazioni per il venditore?\n\n" +
          "Scrivi il tuo messaggio o 'nessuna' se non ce ne sono:",
          {
            parse_mode: 'HTML',
            ...uiElements.wizardNavigationButtons(true, true, 'wizard_back_info', 'wizard_skip_info', 'cancel_buy').reply_markup
          }
        );
        
        return ctx.wizard.next();
      }
    } catch (err) {
      logger.error(`Errore nel processare le coordinate per utente ${ctx.from.id}:`, err);
      await ctx.reply(uiElements.formatErrorMessage('Si è verificato un errore. Per favore, riprova più tardi.', true), {
        parse_mode: 'HTML',
        ...uiElements.mainMenuButton().reply_markup
      });
      return ctx.scene.leave();
    }
  },
  
  // Passo 6: Informazioni aggiuntive e conferma
  async (ctx) => {
    try {
      // Controllo se è un comando di annullamento
      if (ctx.message && ctx.message.text && ctx.message.text === '/annulla') {
        logger.info(`Comando /annulla ricevuto da ${ctx.from.id} nel wizard di acquisto`);
        await ctx.reply(uiElements.formatErrorMessage('Procedura di acquisto annullata.', false), {
          parse_mode: 'HTML',
          ...uiElements.mainMenuButton().reply_markup
        });
        return ctx.scene.leave();
      }
      
      // Se è una callback di navigazione indietro
      if (ctx.callbackQuery && ctx.callbackQuery.data === 'wizard_back_info') {
        await ctx.answerCbQuery();
        
        // Torna allo step precedente
        await ctx.reply(
          showProgress(5, "Procedura di Acquisto kWh") + 
          "Inserisci le coordinate GPS della colonnina\n\n" +
          "Nel formato numerico, ad esempio 41.87290, 12.47326:",
          {
            parse_mode: 'HTML',
            ...uiElements.wizardNavigationButtons(true, false, 'wizard_back_coordinates', 'wizard_skip', 'cancel_buy').reply_markup
          }
        );
        
        return ctx.wizard.back();
      }
      
      // Se è una callback di skip
      if (ctx.callbackQuery && ctx.callbackQuery.data === 'wizard_skip_info') {
        await ctx.answerCbQuery();
        ctx.session.buyWizardState.data.additionalInfo = '';
        
        // Mostra anteprima e chiede conferma
        showConfirmation(ctx);
        return;
      }
      
      // Se riceviamo un messaggio di testo, sono le info aggiuntive
      if (ctx.message && ctx.message.text) {
        ctx.session.buyWizardState.data.additionalInfo = ctx.message.text === 'nessuna' ? '' : ctx.message.text;
        ctx.session.buyWizardState.step = 6;
        
        // Mostra anteprima e chiede conferma
        showConfirmation(ctx);
      }
    } catch (err) {
      logger.error(`Errore nella finalizzazione della richiesta per utente ${ctx.from.id}:`, err);
      await ctx.reply(uiElements.formatErrorMessage('Si è verificato un errore. Per favore, riprova più tardi.', true), {
        parse_mode: 'HTML',
        ...uiElements.mainMenuButton().reply_markup
      });
      return ctx.scene.leave();
    }
  }
);

/**
 * Mostra la conferma finale con i dati inseriti
 * @param {Object} ctx - Contesto Telegraf
 */
const showConfirmation = async (ctx) => {
  try {
    const data = ctx.session.buyWizardState.data;
    const seller = data.seller;
    
    // Formatta le informazioni di riepilogo
    const items = [
      { label: 'Data', value: data.date },
      { label: 'Ora', value: data.time },
      { label: 'Brand colonnina', value: data.brand },
      { label: 'Coordinate', value: data.coordinates }
    ];
    
    if (data.additionalInfo) {
      items.push({ label: 'Informazioni aggiuntive', value: data.additionalInfo });
    }
    
    items.push({ label: 'Venditore', value: seller.username ? '@' + seller.username : seller.firstName });
    
    // Mostra il riepilogo
    await ctx.reply(
      showProgress(6, "Procedura di Acquisto kWh") + 
      uiElements.formatConfirmationMessage('Riepilogo della richiesta', items),
      { 
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              Markup.button.callback('✅ Conferma e invia', 'send_request'),
              Markup.button.callback('❌ Annulla', 'cancel_buy')
            ]
          ]
        }
      }
    );
  } catch (err) {
    logger.error(`Errore nella generazione del riepilogo per utente ${ctx.from.id}:`, err);
    await ctx.reply(uiElements.formatErrorMessage('Si è verificato un errore nel generare il riepilogo. Per favore, riprova più tardi.', true), {
      parse_mode: 'HTML',
      ...uiElements.mainMenuButton().reply_markup
    });
  }
};

// Gestori delle callback per il wizard di acquisto
buyKwhWizard.action('accept_conditions', async (ctx) => {
  try {
    await ctx.answerCbQuery('Condizioni accettate');
    
    // Aggiorna lo stato della sessione
    ctx.session.buyWizardState.step = 2;
    
    // Mostra il secondo step
    await ctx.reply(
      showProgress(2, "Procedura di Acquisto kWh") + 
      "In quale data vorresti ricaricare?\n\n" +
      "Inserisci la data nel formato DD/MM/YYYY (es. 15/05/2023):" +
      "\n\n" + uiElements.formatTimeoutWarning(30),
      {
        parse_mode: 'HTML',
        ...uiElements.wizardNavigationButtons(false, false, 'wizard_back', 'wizard_skip', 'cancel_buy').reply_markup
      }
    );
    
    ctx.wizard.next();
  } catch (err) {
    logger.error(`Errore nella callback accept_conditions per utente ${ctx.from.id}:`, err);
    await ctx.reply(uiElements.formatErrorMessage('Si è verificato un errore. Per favore, riprova più tardi.', true), {
      parse_mode: 'HTML',
      ...uiElements.mainMenuButton().reply_markup
    });
    return ctx.scene.leave();
  }
});

buyKwhWizard.action('cancel_buy', async (ctx) => {
  try {
    await ctx.answerCbQuery('Procedura annullata');
    await ctx.reply(uiElements.formatErrorMessage('Procedura di acquisto annullata.', false), {
      parse_mode: 'HTML',
      ...uiElements.mainMenuButton().reply_markup
    });
    return ctx.scene.leave();
  } catch (err) {
    logger.error(`Errore nella callback cancel_buy per utente ${ctx.from.id}:`, err);
    return ctx.scene.leave();
  }
});

buyKwhWizard.action('wizard_skip_info', async (ctx) => {
  try {
    await ctx.answerCbQuery('Informazioni aggiuntive saltate');
    
    ctx.session.buyWizardState.data.additionalInfo = '';
    
    // Mostra anteprima e chiede conferma
    showConfirmation(ctx);
  } catch (err) {
    logger.error(`Errore nella callback wizard_skip_info per utente ${ctx.from.id}:`, err);
    await ctx.reply(uiElements.formatErrorMessage('Si è verificato un errore. Per favore, riprova più tardi.', true), {
      parse_mode: 'HTML',
      ...uiElements.mainMenuButton().reply_markup
    });
    return ctx.scene.leave();
  }
});

buyKwhWizard.action('send_request', async (ctx) => {
  try {
    await ctx.answerCbQuery('Invio richiesta in corso...');
    
    const buyer = await userService.registerUser(ctx.from);
    const data = ctx.session.buyWizardState.data;
    
    // Prepara i dati dell'offerta
    const offerData = {
      buyerId: buyer.userId,
      sellerId: data.seller.userId,
      announcementId: data.announcementId,
      date: data.date,
      time: data.time,
      brand: data.brand,
      coordinates: data.coordinates,
      additionalInfo: data.additionalInfo || ''
    };
    
    // Crea la nuova offerta
    const newOffer = await offerService.createOffer(offerData, data.announcementId);
    
    // Notifica il venditore
    await offerService.notifySellerAboutOffer(newOffer, buyer, data.announcement);
    
    await ctx.reply(uiElements.formatSuccessMessage(
      'Richiesta Inviata',
      'La tua richiesta è stata inviata al venditore! Riceverai una notifica quando risponderà.\n\nPuoi vedere lo stato della tua richiesta usando /le_mie_ricariche.'
    ), {
      parse_mode: 'HTML',
      ...uiElements.mainMenuButton().reply_markup
    });
    
    return ctx.scene.leave();
  } catch (err) {
    logger.error(`Errore nell'invio della richiesta per utente ${ctx.from.id}:`, err);
    await ctx.reply(uiElements.formatErrorMessage('Si è verificato un errore durante l\'invio della richiesta. Per favore, riprova più tardi.', true), {
      parse_mode: 'HTML',
      ...uiElements.mainMenuButton().reply_markup
    });
    return ctx.scene.leave();
  }
});

// Comando per annullamento all'interno della scena
buyKwhWizard.command('annulla', async (ctx) => {
  logger.info(`Comando /annulla ricevuto da ${ctx.from.id} nel wizard di acquisto`);
  await ctx.reply(uiElements.formatErrorMessage('Procedura di acquisto annullata.', false), {
    parse_mode: 'HTML',
    ...uiElements.mainMenuButton().reply_markup
  });
  return ctx.scene.leave();
});

// Comando di aiuto all'interno della scena
buyKwhWizard.command('help', async (ctx) => {
  logger.info(`Comando /help ricevuto da ${ctx.from.id} nel wizard di acquisto`);
  await ctx.reply(uiElements.formatSuccessMessage(
    'Guida all\'acquisto di kWh',
    `Stai acquistando kWh da un venditore. I passaggi sono:

1️⃣ Conferma dell'annuncio: accetta le condizioni dell'annuncio
2️⃣ Data: inserisci quando vuoi ricaricare (DD/MM/YYYY)
3️⃣ Ora: inserisci a che ora vuoi ricaricare (HH:MM)
4️⃣ Brand: indica quale brand di colonnina userai
5️⃣ Posizione: inserisci le coordinate GPS della colonnina
6️⃣ Info aggiuntive: aggiungi altre informazioni per il venditore

Per annullare in qualsiasi momento, usa il comando /annulla o premi il pulsante "❌ Annulla".`
  ), {
    parse_mode: 'HTML'
  });
});

module.exports = buyKwhWizard;