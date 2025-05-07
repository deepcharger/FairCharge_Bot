// Scene per l'acquisto di kWh
const { Scenes, Markup } = require('telegraf');
const moment = require('moment');
const userService = require('../../services/userService');
const offerService = require('../../services/offerService');
const Announcement = require('../../models/announcement');
const User = require('../../models/user');
const { formatChargeRequest } = require('../../utils/formatters');

// Crea la scena per il wizard
const buyKwhScene = new Scenes.WizardScene(
  'BUY_KWH_WIZARD',
  // Passo 1: Mostra l'annuncio selezionato e chiede conferma
  async (ctx) => {
    try {
      // Estrai l'ID dell'annuncio dai dati della callback
      const announcementId = ctx.wizard.state.announcementId;
      
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
      
      // Mostra l'annuncio
      await ctx.reply(`*Hai selezionato il seguente annuncio:*\n\n${formatSellAnnouncement(announcement, seller)}`, {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard([
          [
            Markup.button.callback('✅ Accetto le condizioni', 'accept_conditions'),
            Markup.button.callback('❌ Annulla', 'cancel_buy')
          ]
        ])
      });
      
      return ctx.wizard.next();
    } catch (err) {
      console.error('Errore nel caricamento dell\'annuncio:', err);
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
      ctx.wizard.state.date = ctx.message.text;
      
      // Verifica che la data sia valida (formato DD/MM/YYYY)
      const dateRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
      if (!dateRegex.test(ctx.wizard.state.date)) {
        await ctx.reply('❌ Formato data non valido. Inserisci la data nel formato DD/MM/YYYY.');
        return;
      }
      
      await ctx.reply('A che ora vorresti ricaricare? (Inserisci l\'ora nel formato HH:MM, ad esempio 14:30)');
      return ctx.wizard.next();
    } catch (err) {
      console.error('Errore nel processare la data:', err);
      await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
      return ctx.scene.leave();
    }
  },
  // Passo 4: Brand colonnina
  async (ctx) => {
    try {
      ctx.wizard.state.time = ctx.message.text;
      
      // Verifica che l'ora sia valida (formato HH:MM)
      const timeRegex = /^(\d{1,2}):(\d{2})$/;
      if (!timeRegex.test(ctx.wizard.state.time)) {
        await ctx.reply('❌ Formato ora non valido. Inserisci l\'ora nel formato HH:MM.');
        return;
      }
      
      await ctx.reply('Quale brand di colonnina utilizzerai? (ad esempio Enel X, A2A, Be Charge...)');
      return ctx.wizard.next();
    } catch (err) {
      console.error('Errore nel processare l\'ora:', err);
      await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
      return ctx.scene.leave();
    }
  },
  // Passo 5: Coordinate GPS
  async (ctx) => {
    ctx.wizard.state.brand = ctx.message.text;
    await ctx.reply('Inserisci le coordinate GPS della colonnina (nel formato numerico, ad esempio 41.87290, 12.47326)');
    return ctx.wizard.next();
  },
  // Passo 6: Informazioni aggiuntive
  async (ctx) => {
    ctx.wizard.state.coordinates = ctx.message.text;
    await ctx.reply('Vuoi aggiungere altre informazioni per il venditore? (Scrivi "nessuna" se non ce ne sono)');
    return ctx.wizard.next();
  },
  // Passo 7: Mostra l'anteprima e chiede conferma
  async (ctx) => {
    ctx.wizard.state.additionalInfo = ctx.message.text === 'nessuna' ? '' : ctx.message.text;
    
    try {
      const buyer = await userService.registerUser(ctx.from);
      
      // Prepara l'anteprima dell'offerta
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
        reply_markup: Markup.inlineKeyboard([
          [
            Markup.button.callback('✅ Conferma e invia', 'send_request'),
            Markup.button.callback('❌ Annulla', 'cancel_buy')
          ]
        ])
      });
      
      return ctx.wizard.next();
    } catch (err) {
      console.error('Errore nella creazione dell\'anteprima:', err);
      await ctx.reply('❌ Si è verificato un errore. Per favore, riprova più tardi.');
      return ctx.scene.leave();
    }
  },
  // Passo 8: Gestito dalle callback
  async (ctx) => {
    // Questo passaggio è gestito dalle callback
  }
);

// Gestori delle callback per il wizard di acquisto
buyKwhScene.action('accept_conditions', async (ctx) => {
  await ctx.answerCbQuery('Condizioni accettate');
  await ctx.reply('📅 In quale data vorresti ricaricare? (Inserisci la data nel formato DD/MM/YYYY, ad esempio 15/05/2023)');
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
    
    await ctx.reply('✅ La tua richiesta è stata inviata al venditore! Riceverai una notifica quando risponderà.');
    
    return ctx.scene.leave();
  } catch (err) {
    console.error('Errore nell\'invio della richiesta:', err);
    await ctx.reply('❌ Si è verificato un errore durante l\'invio della richiesta. Per favore, riprova più tardi.');
    return ctx.scene.leave();
  }
});

module.exports = buyKwhScene;
