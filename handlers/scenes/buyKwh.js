// Scene per l'acquisto di kWh
const { Scenes, Markup } = require('telegraf');
const moment = require('moment');
const userService = require('../../services/userService');
const offerService = require('../../services/offerService');
const Announcement = require('../../models/announcement');
const User = require('../../models/user');
const { formatSellAnnouncementSafe, formatChargeRequest } = require('../../utils/formatters');
const logger = require('../../utils/logger');

// Crea la scena per il wizard
const buyKwhScene = new Scenes.WizardScene(
  'BUY_KWH_WIZARD',
  // Passo 1: Mostra l'annuncio selezionato e chiede conferma
  async (ctx) => {
    try {
      // Estrai l'ID dell'annuncio dalla sessione o dai dati del wizard
      const announcementId = ctx.session.announcementId || (ctx.wizard.state && ctx.wizard.state.announcementId);
      
      if (!announcementId) {
        await ctx.reply('❌ Nessun annuncio selezionato. Riprova dalla chat di gruppo.');
        return ctx.scene.leave();
      }
      
      // Memorizza l'ID nel wizard state
      ctx.wizard.state = ctx.wizard.state || {};
      ctx.wizard.state.announcementId = announcementId;
      
      // Pulisci l'ID dalla sessione per evitare problemi in future interazioni
      if (ctx.session.announcementId) {
        delete ctx.session.announcementId;
      }
      
      // Trova l'annuncio
      const announcement = await Announcement.findById(announcementId);
      if (!announcement || announcement.status !== 'active') {
        await ctx.reply('❌ L\'annuncio non è più disponibile.');
        return ctx.scene.leave();
      }
      
      // Trova il venditore
      const seller = await User.findOne({ userId: announcement.userId });
      if (!seller) {
        await ctx.reply('❌ Si è verificato un errore. Venditore non trovato.');
        return ctx.scene.leave();
      }
      
      // Memorizza i dati nella sessione
      ctx.wizard.state.announcement = announcement;
      ctx.wizard.state.seller = seller;
      
      // Mostra l'annuncio con formattazione sicura per evitare errori di parsing Markdown
      await ctx.reply(`*Hai selezionato il seguente annuncio:*\n\n${formatSellAnnouncementSafe(announcement, seller)}`, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Accetto le condizioni', callback_data: 'accept_conditions' },
              { text: '❌ Annulla', callback_data: 'cancel_buy' }
            ]
          ]
        }
      });
      
      return ctx.wizard.next();
    } catch (err) {
      logger.error('Errore nel caricamento dell\'annuncio:', err);
      await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
      return ctx.scene.leave();
    }
  },
  // Passo 2: Data di ricarica (gestito dalle callback)
  async (ctx) => {
    // Gestito dalle callback
  },
  // Passo 3: Ora di ricarica
  async (ctx) => {
    try {
      // Controllo se è un comando di annullamento
      if (ctx.message && ctx.message.text && ctx.message.text === '/annulla') {
        logger.info(`Comando /annulla ricevuto da ${ctx.from.id} nel wizard di acquisto`);
        await ctx.reply('❌ Procedura di acquisto annullata.');
        return ctx.scene.leave();
      }
      
      ctx.wizard.state.date = ctx.message.text;
      
      // Verifica che la data sia valida (formato DD/MM/YYYY)
      const dateRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
      if (!dateRegex.test(ctx.wizard.state.date)) {
        await ctx.reply('❌ Formato data non valido. Inserisci la data nel formato DD/MM/YYYY.', {
          reply_markup: {
            inline_keyboard: [
              [{ text: '❌ Annulla', callback_data: 'cancel_buy' }]
            ]
          }
        });
        return;
      }
      
      await ctx.reply('🕒 *A che ora vorresti ricaricare?*\n\n_Inserisci l\'ora nel formato HH:MM, ad esempio 14:30_', {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '❌ Annulla', callback_data: 'cancel_buy' }]
          ]
        }
      });
      return ctx.wizard.next();
    } catch (err) {
      logger.error('Errore nel processare la data:', err);
      await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
      return ctx.scene.leave();
    }
  },
  // Passo 4: Brand colonnina
  async (ctx) => {
    try {
      // Controllo se è un comando di annullamento
      if (ctx.message && ctx.message.text && ctx.message.text === '/annulla') {
        logger.info(`Comando /annulla ricevuto da ${ctx.from.id} nel wizard di acquisto`);
        await ctx.reply('❌ Procedura di acquisto annullata.');
        return ctx.scene.leave();
      }
      
      ctx.wizard.state.time = ctx.message.text;
      
      // Verifica che l'ora sia valida (formato HH:MM)
      const timeRegex = /^(\d{1,2}):(\d{2})$/;
      if (!timeRegex.test(ctx.wizard.state.time)) {
        await ctx.reply('❌ Formato ora non valido. Inserisci l\'ora nel formato HH:MM.', {
          reply_markup: {
            inline_keyboard: [
              [{ text: '❌ Annulla', callback_data: 'cancel_buy' }]
            ]
          }
        });
        return;
      }
      
      await ctx.reply('🏭 *Quale brand di colonnina utilizzerai?*\n\n_Ad esempio: Enel X, A2A, Be Charge..._', {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '❌ Annulla', callback_data: 'cancel_buy' }]
          ]
        }
      });
      return ctx.wizard.next();
    } catch (err) {
      logger.error('Errore nel processare l\'ora:', err);
      await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
      return ctx.scene.leave();
    }
  },
  // Passo 5: Coordinate GPS
  async (ctx) => {
    // Controllo se è un comando di annullamento
    if (ctx.message && ctx.message.text && ctx.message.text === '/annulla') {
      logger.info(`Comando /annulla ricevuto da ${ctx.from.id} nel wizard di acquisto`);
      await ctx.reply('❌ Procedura di acquisto annullata.');
      return ctx.scene.leave();
    }
    
    ctx.wizard.state.brand = ctx.message.text;
    await ctx.reply('📍 *Inserisci le coordinate GPS della colonnina*\n\n_Nel formato numerico, ad esempio 41.87290, 12.47326_', {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '❌ Annulla', callback_data: 'cancel_buy' }]
        ]
      }
    });
    return ctx.wizard.next();
  },
  // Passo 6: Informazioni aggiuntive
  async (ctx) => {
    // Controllo se è un comando di annullamento
    if (ctx.message && ctx.message.text && ctx.message.text === '/annulla') {
      logger.info(`Comando /annulla ricevuto da ${ctx.from.id} nel wizard di acquisto`);
      await ctx.reply('❌ Procedura di acquisto annullata.');
      return ctx.scene.leave();
    }
    
    ctx.wizard.state.coordinates = ctx.message.text;
    await ctx.reply('ℹ️ *Vuoi aggiungere altre informazioni per il venditore?*\n\n_Scrivi "nessuna" se non ce ne sono_', {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '❌ Annulla', callback_data: 'cancel_buy' }]
        ]
      }
    });
    return ctx.wizard.next();
  },
  // Passo 7: Mostra l'anteprima e chiede conferma
  async (ctx) => {
    // Controllo se è un comando di annullamento
    if (ctx.message && ctx.message.text && ctx.message.text === '/annulla') {
      logger.info(`Comando /annulla ricevuto da ${ctx.from.id} nel wizard di acquisto`);
      await ctx.reply('❌ Procedura di acquisto annullata.');
      return ctx.scene.leave();
    }
    
    ctx.wizard.state.additionalInfo = ctx.message.text === 'nessuna' ? '' : ctx.message.text;
    
    try {
      const buyer = await userService.registerUser(ctx.from);
      
      // Prepara l'anteprima dell'offerta con formattazione migliorata
      const previewText = `
🔋 *Richiesta di ricarica* 🔋

📅 *Data:* ${ctx.wizard.state.date}
🕙 *Ora:* ${ctx.wizard.state.time}
🏭 *Colonnina:* ${ctx.wizard.state.brand}
📍 *Posizione:* ${ctx.wizard.state.coordinates}
${ctx.wizard.state.additionalInfo ? `ℹ️ *Info aggiuntive:* ${ctx.wizard.state.additionalInfo}\n` : ''}

💰 *Prezzo venditore:* ${ctx.wizard.state.announcement.price}
👤 *Venditore:* ${ctx.wizard.state.seller.username ? '@' + ctx.wizard.state.seller.username : ctx.wizard.state.seller.firstName}
`;
      
      await ctx.reply(`*Anteprima della tua richiesta:*\n\n${previewText}`, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Conferma e invia', callback_data: 'send_request' },
              { text: '❌ Annulla', callback_data: 'cancel_buy' }
            ]
          ]
        }
      });
      
      return ctx.wizard.next();
    } catch (err) {
      logger.error('Errore nella creazione dell\'anteprima:', err);
      await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
      return ctx.scene.leave();
    }
  },
  // Passo 8: Gestito dalle callback
  async (ctx) => {
    // Controllo se è un comando di annullamento
    if (ctx.message && ctx.message.text && ctx.message.text === '/annulla') {
      logger.info(`Comando /annulla ricevuto da ${ctx.from.id} nel wizard di acquisto`);
      await ctx.reply('❌ Procedura di acquisto annullata.');
      return ctx.scene.leave();
    }
    
    // Questo passaggio è gestito dalle callback
    await ctx.reply('Usa i pulsanti per confermare o annullare la richiesta.');
  }
);

// Gestori delle callback per il wizard di acquisto
buyKwhScene.action('accept_conditions', async (ctx) => {
  await ctx.answerCbQuery('Condizioni accettate');
  await ctx.reply('📅 *In quale data vorresti ricaricare?*\n\n_Inserisci la data nel formato DD/MM/YYYY, ad esempio 15/05/2023_', {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '❌ Annulla', callback_data: 'cancel_buy' }]
      ]
    }
  });
  ctx.wizard.next();
});

buyKwhScene.action('cancel_buy', async (ctx) => {
  await ctx.answerCbQuery('Procedura annullata');
  await ctx.reply('❌ Procedura di acquisto annullata.');
  return ctx.scene.leave();
});

buyKwhScene.action('send_request', async (ctx) => {
  try {
    await ctx.answerCbQuery('Invio richiesta in corso...');
    
    const buyer = await userService.registerUser(ctx.from);
    
    // Prepara i dati dell'offerta
    const offerData = {
      buyerId: buyer.userId,
      sellerId: ctx.wizard.state.seller.userId,
      date: ctx.wizard.state.date,
      time: ctx.wizard.state.time,
      brand: ctx.wizard.state.brand,
      coordinates: ctx.wizard.state.coordinates,
      additionalInfo: ctx.wizard.state.additionalInfo
    };
    
    // Crea la nuova offerta
    const newOffer = await offerService.createOffer(offerData, ctx.wizard.state.announcement._id);
    
    // Notifica il venditore
    await offerService.notifySellerAboutOffer(newOffer, buyer, ctx.wizard.state.announcement);
    
    await ctx.reply('✅ *La tua richiesta è stata inviata al venditore!*\n\nRiceverai una notifica quando risponderà.', {
      parse_mode: 'Markdown'
    });
    
    return ctx.scene.leave();
  } catch (err) {
    logger.error('Errore nell\'invio della richiesta:', err);
    await ctx.reply('❌ Si è verificato un errore durante l\'invio della richiesta. Per favore, riprova più tardi.');
    return ctx.scene.leave();
  }
});

// Comando per annullamento all'interno della scena
buyKwhScene.command('annulla', async (ctx) => {
  logger.info(`Comando /annulla ricevuto da ${ctx.from.id} nel wizard di acquisto`);
  await ctx.reply('❌ Procedura di acquisto annullata.');
  return ctx.scene.leave();
});

// Comando di aiuto all'interno della scena
buyKwhScene.command('help', async (ctx) => {
  logger.info(`Comando /help ricevuto da ${ctx.from.id} nel wizard di acquisto`);
  await ctx.reply(`
📚 *Guida all'acquisto di kWh*

Stai acquistando kWh da un venditore. I passaggi sono:

1️⃣ *Conferma dell'annuncio:* accetta le condizioni dell'annuncio
2️⃣ *Data:* inserisci quando vuoi ricaricare (DD/MM/YYYY)
3️⃣ *Ora:* inserisci a che ora vuoi ricaricare (HH:MM)
4️⃣ *Colonnina:* indica quale brand di colonnina userai
5️⃣ *Posizione:* inserisci le coordinate GPS della colonnina
6️⃣ *Info aggiuntive:* aggiungi altre informazioni per il venditore
7️⃣ *Conferma:* verifica i dati e conferma la richiesta

Per annullare in qualsiasi momento, usa il comando /annulla o premi il pulsante "❌ Annulla".
`, {
    parse_mode: 'Markdown'
  });
});

module.exports = buyKwhScene;
