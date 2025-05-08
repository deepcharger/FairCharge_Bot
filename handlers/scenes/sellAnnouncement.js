// Scene per la creazione di un annuncio di vendita
const { Scenes, Markup } = require('telegraf');
const userService = require('../../services/userService');
const announcementService = require('../../services/announcementService');
const { formatSellAnnouncement } = require('../../utils/formatters');
const logger = require('../../utils/logger');

// Funzione helper per creare una "tastiera" con un bottone di annullamento
const getCancelKeyboard = () => {
  return Markup.inlineKeyboard([
    [Markup.button.callback('❌ Annulla', 'cancel_sell')]
  ]);
};

// Crea la scena per il wizard
const sellAnnouncementScene = new Scenes.WizardScene(
  'SELL_ANNOUNCEMENT_WIZARD',
  // Passo 1: Prezzo - VERSIONE CORRETTA SENZA HTML
  async (ctx) => {
    try {
      logger.info(`Avvio wizard vendita kWh per utente ${ctx.from.id}`);
      
      // Primo messaggio - completamente senza formattazione HTML
      await ctx.reply('🔋 Creazione nuovo annuncio di vendita 🔋');
      
      // Secondo messaggio - istruzioni generali
      await ctx.reply('Ti guiderò nella creazione dell\'annuncio. Puoi scrivere /annulla in qualsiasi momento per interrompere.');
      
      // Terzo messaggio - richiesta prezzo (nessun HTML)
      await ctx.reply('Per iniziare, indicami il prezzo dei kWh che vuoi vendere.\n\nEsempi:\n- 0.35€ per kWh\n- 0.28€ per ricariche > 40kW, 0.35€ per ricariche < 40kW', {
        reply_markup: getCancelKeyboard()
      });
      
      return ctx.wizard.next();
    } catch (error) {
      logger.error(`Errore nell'inizializzazione del wizard:`, error);
      await ctx.reply('Si è verificato un errore. Per favore, riprova più tardi.');
      return ctx.scene.leave();
    }
  },
  // Passo 2: Tipo corrente
  async (ctx) => {
    try {
      logger.info(`Inizio passo 2 per utente ${ctx.from.id}`);
      
      // Gestione annullamento via callback
      if (ctx.callbackQuery && ctx.callbackQuery.data === 'cancel_sell') {
        logger.info(`Wizard annullato dall'utente ${ctx.from.id} al passo 2`);
        await ctx.answerCbQuery('Annuncio cancellato');
        await ctx.reply('❌ Creazione dell\'annuncio annullata.');
        return ctx.scene.leave();
      }
      
      // Gestione annullamento via comando
      if (ctx.message && ctx.message.text && ctx.message.text === '/annulla') {
        logger.info(`Annullamento via comando per utente ${ctx.from.id}`);
        await ctx.reply('❌ Creazione dell\'annuncio annullata.');
        return ctx.scene.leave();
      }
      
      ctx.wizard.state.price = ctx.message.text;
      logger.debug(`Prezzo impostato: ${ctx.wizard.state.price}`);
      
      // Invio opzioni per il tipo di corrente
      const keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback('DC (corrente continua)', 'current_DC'),
          Markup.button.callback('AC (corrente alternata)', 'current_AC')
        ],
        [Markup.button.callback('Entrambe (DC e AC)', 'current_both')],
        [Markup.button.callback('❌ Annulla', 'cancel_sell')]
      ]);
      
      // Messaggio senza HTML
      await ctx.reply('⚡ Tipo di corrente disponibile\n\nSpecifica quali tipi di corrente offri:', {
        reply_markup: keyboard
      });
      
      logger.info(`Fine passo 2 per utente ${ctx.from.id}`);
      return ctx.wizard.next();
    } catch (err) {
      logger.error(`Errore nel passo 2 per utente ${ctx.from.id}:`, err);
      await ctx.reply('Si è verificato un errore. Per favore, riprova più tardi o scrivi /annulla per ricominciare.');
      return ctx.scene.leave();
    }
  },
  // Passo 3: Reti attivabili
  async (ctx) => {
    try {
      logger.info(`Inizio passo 3 per utente ${ctx.from.id}`);
      
      // Gestione callback
      if (ctx.callbackQuery) {
        logger.info(`Callback ricevuta nel passo 3: ${ctx.callbackQuery.data}`);
        
        if (ctx.callbackQuery.data === 'cancel_sell') {
          await ctx.answerCbQuery('Annuncio cancellato');
          await ctx.reply('❌ Creazione dell\'annuncio annullata.');
          return ctx.scene.leave();
        }
        
        if (ctx.callbackQuery.data.startsWith('current_')) {
          const currentType = ctx.callbackQuery.data.replace('current_', '');
          ctx.wizard.state.currentType = currentType;
          
          await ctx.answerCbQuery(`Hai selezionato: ${currentType}`);
          
          let currentText;
          if (currentType === 'AC') {
            currentText = 'AC (corrente alternata)';
          } else if (currentType === 'DC') {
            currentText = 'DC (corrente continua)';
          } else if (currentType === 'both') {
            currentText = 'Entrambe (DC e AC)';
          }
          
          await ctx.reply(`✅ Tipo di corrente selezionato: ${currentText}`);
        }
      } else if (ctx.message) {
        // Gestione via messaggio testuale
        if (ctx.message.text === '/annulla') {
          await ctx.reply('❌ Creazione dell\'annuncio annullata.');
          return ctx.scene.leave();
        }
        
        // Se l'utente ha inserito manualmente il tipo di corrente
        const text = ctx.message.text.toUpperCase();
        if (text === 'AC' || text === 'DC' || text === 'ENTRAMBE' || text === 'ENTRAMBI') {
          let currentType;
          if (text === 'AC') {
            currentType = 'AC';
          } else if (text === 'DC') {
            currentType = 'DC';
          } else {
            currentType = 'both';
          }
          
          ctx.wizard.state.currentType = currentType;
          await ctx.reply(`✅ Tipo di corrente selezionato: ${currentType === 'both' ? 'Entrambe (DC e AC)' : currentType}`);
        }
      }
      
      // Verifica se abbiamo il tipo di corrente prima di procedere
      if (!ctx.wizard.state.currentType) {
        await ctx.reply('Per favore, seleziona un tipo di corrente usando i bottoni sopra o scrivi AC, DC o ENTRAMBE.');
        return;
      }
      
      // Procedi alla domanda sulle reti attivabili - SENZA HTML
      await ctx.reply('🔌 Reti attivabili\n\nElenca tutte le reti/operatori che puoi attivare.\n\nEsempi:\n- Tutte le colonnine\n- Enel X, BeCharge, Ionity, Ewiva, Neogy, etc.\n\nSe vuoi, puoi copiare e incollare direttamente l\'elenco completo delle reti che attivi.', {
        reply_markup: getCancelKeyboard()
      });
      
      logger.info(`Fine passo 3 per utente ${ctx.from.id}`);
      return ctx.wizard.next();
    } catch (err) {
      logger.error(`Errore nel passo 3 per utente ${ctx.from.id}:`, err);
      await ctx.reply('Si è verificato un errore. Per favore, riprova più tardi o scrivi /annulla per ricominciare.');
      return ctx.scene.leave();
    }
  },

  // Passo 4: Reti NON attivabili
  async (ctx) => {
    try {
      logger.info(`Inizio passo 4 per utente ${ctx.from.id}`);
      
      // Gestione annullamento via callback
      if (ctx.callbackQuery && ctx.callbackQuery.data === 'cancel_sell') {
        await ctx.answerCbQuery('Annuncio cancellato');
        await ctx.reply('❌ Creazione dell\'annuncio annullata.');
        return ctx.scene.leave();
      }
      
      // Gestione annullamento via comando
      if (ctx.message && ctx.message.text && ctx.message.text === '/annulla') {
        await ctx.reply('❌ Creazione dell\'annuncio annullata.');
        return ctx.scene.leave();
      }
      
      // Se arriviamo da una callback (selezione tipo corrente)
      // non abbiamo ctx.message, quindi saltiamo l'impostazione del brand
      // che verrà fatta nel prossimo step
      if (!ctx.message) {
        // Chiedi le reti attivabili
        await ctx.reply('🔌 Reti attivabili\n\nElenca tutte le reti/operatori che puoi attivare.\n\nEsempi:\n- Tutte le colonnine\n- Enel X, BeCharge, Ionity, Ewiva, Neogy, etc.\n\nSe vuoi, puoi copiare e incollare direttamente l\'elenco completo delle reti che attivi.', {
          reply_markup: getCancelKeyboard()
        });
      } else {
        // Se abbiamo un messaggio di testo, procediamo normalmente
        ctx.wizard.state.brand = ctx.message.text;
        logger.debug(`Reti attivabili impostate: ${ctx.wizard.state.brand}`);
        
        // Chiedi le reti NON attivabili (opzionale) - SENZA HTML
        await ctx.reply('🚫 Reti NON attivabili (opzionale)\n\nSe ci sono reti/operatori che NON puoi attivare, elencale qui.\nSe puoi attivare tutto, scrivi semplicemente "Nessuna limitazione".\n\nEsempi:\n- Ionity, Tesla Supercharger\n- Tutte le colonnine oltre 50kW', {
          reply_markup: getCancelKeyboard()
        });
      }
      
      logger.info(`Fine passo 4 per utente ${ctx.from.id}`);
      return ctx.wizard.next();
    } catch (err) {
      logger.error(`Errore nel passo 4 per utente ${ctx.from.id}:`, err);
      await ctx.reply('Si è verificato un errore. Per favore, riprova più tardi o scrivi /annulla per ricominciare.');
      return ctx.scene.leave();
    }
  },
  
  // Passo 5: Disponibilità oraria - modificato per gestire il caso in cui arriviamo da una callback
  async (ctx) => {
    try {
      logger.info(`Inizio passo 5 per utente ${ctx.from.id}`);
      
      // Gestione annullamento via callback
      if (ctx.callbackQuery && ctx.callbackQuery.data === 'cancel_sell') {
        await ctx.answerCbQuery('Annuncio cancellato');
        await ctx.reply('❌ Creazione dell\'annuncio annullata.');
        return ctx.scene.leave();
      }
      
      // Gestione annullamento via comando
      if (ctx.message && ctx.message.text && ctx.message.text === '/annulla') {
        await ctx.reply('❌ Creazione dell\'annuncio annullata.');
        return ctx.scene.leave();
      }
      
      // Salva le reti non attivabili o il brand, a seconda di cosa abbiamo ricevuto
      if (ctx.message) {
        // Se nel passo precedente avevamo saltato l'impostazione del brand
        // (perché venivamo da una callback), lo impostiamo ora
        if (!ctx.wizard.state.brand) {
          ctx.wizard.state.brand = ctx.message.text;
          logger.debug(`Reti attivabili impostate: ${ctx.wizard.state.brand}`);
          
          // Chiedi le reti NON attivabili - SENZA HTML
          await ctx.reply('🚫 Reti NON attivabili (opzionale)\n\nSe ci sono reti/operatori che NON puoi attivare, elencale qui.\nSe puoi attivare tutto, scrivi semplicemente "Nessuna limitazione".\n\nEsempi:\n- Ionity, Tesla Supercharger\n- Tutte le colonnine oltre 50kW', {
            reply_markup: getCancelKeyboard()
          });
          
          // Non avanziamo allo step successivo, aspettiamo l'input dell'utente
          return;
        } else {
          // Altrimenti siamo nella sequenza normale, salviamo le reti non attivabili
          ctx.wizard.state.nonActivatableBrands = ctx.message.text;
          logger.debug(`Reti NON attivabili impostate: ${ctx.wizard.state.nonActivatableBrands}`);
        }
      }
      
      // Chiedi la disponibilità oraria - SENZA HTML
      await ctx.reply('🕒 Disponibilità oraria\n\nIndica quando sei disponibile ad attivare la ricarica:\n\nEsempi:\n- Sempre disponibile (24/7)\n- Dalle 8 alle 22 tutti i giorni\n- Lun-Ven 9-19, Sab-Dom 10-18', {
        reply_markup: getCancelKeyboard()
      });
      
      logger.info(`Fine passo 5 per utente ${ctx.from.id}`);
      return ctx.wizard.next();
    } catch (err) {
      logger.error(`Errore nel passo 5 per utente ${ctx.from.id}:`, err);
      await ctx.reply('Si è verificato un errore. Per favore, riprova più tardi o scrivi /annulla per ricominciare.');
      return ctx.scene.leave();
    }
  },
  
  // Passo 6: Zone di copertura
  async (ctx) => {
    try {
      logger.info(`Inizio passo 6 per utente ${ctx.from.id}`);
      
      // Gestione annullamento via callback
      if (ctx.callbackQuery && ctx.callbackQuery.data === 'cancel_sell') {
        await ctx.answerCbQuery('Annuncio cancellato');
        await ctx.reply('❌ Creazione dell\'annuncio annullata.');
        return ctx.scene.leave();
      }
      
      // Gestione annullamento via comando
      if (ctx.message && ctx.message.text && ctx.message.text === '/annulla') {
        await ctx.reply('❌ Creazione dell\'annuncio annullata.');
        return ctx.scene.leave();
      }
      
      // Salva la disponibilità oraria
      ctx.wizard.state.availability = ctx.message.text;
      logger.debug(`Disponibilità oraria impostata: ${ctx.wizard.state.availability}`);
      
      // Chiedi le zone di copertura - SENZA HTML
      await ctx.reply('🗺️ Zone di copertura\n\nIndica le zone geografiche coperte dal tuo servizio:\n\nEsempi:\n- Tutta Italia\n- Solo Lombardia e Piemonte\n- Provincia di Roma', {
        reply_markup: getCancelKeyboard()
      });
      
      logger.info(`Fine passo 6 per utente ${ctx.from.id}`);
      return ctx.wizard.next();
    } catch (err) {
      logger.error(`Errore nel passo 6 per utente ${ctx.from.id}:`, err);
      await ctx.reply('Si è verificato un errore. Per favore, riprova più tardi o scrivi /annulla per ricominciare.');
      return ctx.scene.leave();
    }
  },
  // Passo 7: Metodi di pagamento
  async (ctx) => {
    try {
      logger.info(`Inizio passo 7 per utente ${ctx.from.id}`);
      
      // Gestione annullamento via callback
      if (ctx.callbackQuery && ctx.callbackQuery.data === 'cancel_sell') {
        await ctx.answerCbQuery('Annuncio cancellato');
        await ctx.reply('❌ Creazione dell\'annuncio annullata.');
        return ctx.scene.leave();
      }
      
      // Gestione annullamento via comando
      if (ctx.message && ctx.message.text && ctx.message.text === '/annulla') {
        await ctx.reply('❌ Creazione dell\'annuncio annullata.');
        return ctx.scene.leave();
      }
      
      // Salva le zone di copertura
      ctx.wizard.state.location = ctx.message.text;
      logger.debug(`Zone di copertura impostate: ${ctx.wizard.state.location}`);
      
      // Chiedi i metodi di pagamento - SENZA HTML
      await ctx.reply('💰 Metodi di pagamento accettati\n\nIndica come preferisci ricevere i pagamenti:\n\nEsempi:\n- PayPal, Revolut\n- Solo PayPal\n- PayPal, bonifico istantaneo', {
        reply_markup: getCancelKeyboard()
      });
      
      logger.info(`Fine passo 7 per utente ${ctx.from.id}`);
      return ctx.wizard.next();
    } catch (err) {
      logger.error(`Errore nel passo 7 per utente ${ctx.from.id}:`, err);
      await ctx.reply('Si è verificato un errore. Per favore, riprova più tardi o scrivi /annulla per ricominciare.');
      return ctx.scene.leave();
    }
  },
  // Passo 8: Condizioni aggiuntive
  async (ctx) => {
    try {
      logger.info(`Inizio passo 8 per utente ${ctx.from.id}`);
      
      // Gestione annullamento via callback
      if (ctx.callbackQuery && ctx.callbackQuery.data === 'cancel_sell') {
        await ctx.answerCbQuery('Annuncio cancellato');
        await ctx.reply('❌ Creazione dell\'annuncio annullata.');
        return ctx.scene.leave();
      }
      
      // Gestione annullamento via comando
      if (ctx.message && ctx.message.text && ctx.message.text === '/annulla') {
        await ctx.reply('❌ Creazione dell\'annuncio annullata.');
        return ctx.scene.leave();
      }
      
      // Salva i metodi di pagamento
      ctx.wizard.state.paymentMethods = ctx.message.text;
      logger.debug(`Metodi di pagamento impostati: ${ctx.wizard.state.paymentMethods}`);
      
      // Chiedi condizioni aggiuntive - SENZA HTML
      await ctx.reply('📋 Condizioni aggiuntive (opzionale)\n\nSpecifica eventuali altre condizioni o informazioni che vuoi aggiungere al tuo annuncio:\n\nEsempi:\n- Pacchetto minimo di 100kWh\n- Pagamento anticipato\n- Possibilità di ricarica autonoma\n\nSe non hai altre condizioni, scrivi "Nessuna condizione aggiuntiva".', {
        reply_markup: getCancelKeyboard()
      });
      
      logger.info(`Fine passo 8 per utente ${ctx.from.id}`);
      return ctx.wizard.next();
    } catch (err) {
      logger.error(`Errore nel passo 8 per utente ${ctx.from.id}:`, err);
      await ctx.reply('Si è verificato un errore. Per favore, riprova più tardi o scrivi /annulla per ricominciare.');
      return ctx.scene.leave();
    }
  },
  // Passo 9: Conferma annuncio
  async (ctx) => {
    try {
      logger.info(`Inizio passo 9 per utente ${ctx.from.id}`);
      
      // Gestione annullamento via callback
      if (ctx.callbackQuery && ctx.callbackQuery.data === 'cancel_sell') {
        await ctx.answerCbQuery('Annuncio cancellato');
        await ctx.reply('❌ Creazione dell\'annuncio annullata.');
        return ctx.scene.leave();
      }
      
      // Gestione annullamento via comando
      if (ctx.message && ctx.message.text && ctx.message.text === '/annulla') {
        await ctx.reply('❌ Creazione dell\'annuncio annullata.');
        return ctx.scene.leave();
      }
      
      // Salva le condizioni aggiuntive
      ctx.wizard.state.additionalInfo = ctx.message.text;
      logger.debug(`Condizioni aggiuntive impostate: ${ctx.wizard.state.additionalInfo}`);
      
      try {
        logger.info(`Recupero informazioni utente per ${ctx.from.id}`);
        const user = await userService.registerUser(ctx.from);
        
        // Creare l'oggetto annuncio per l'anteprima
        const announcement = {
          price: ctx.wizard.state.price,
          connectorType: ctx.wizard.state.currentType,
          brand: ctx.wizard.state.brand,
          location: ctx.wizard.state.location,
          nonActivatableBrands: ctx.wizard.state.nonActivatableBrands === 'Nessuna limitazione' ? '' : ctx.wizard.state.nonActivatableBrands,
          additionalInfo: ctx.wizard.state.additionalInfo === 'Nessuna condizione aggiuntiva' ? '' : ctx.wizard.state.additionalInfo,
          availability: ctx.wizard.state.availability,
          paymentMethods: ctx.wizard.state.paymentMethods
        };
        
        // Crea un'anteprima dell'annuncio - SENZA HTML
        const anteprima = `
📢 Anteprima del tuo annuncio di vendita

👤 Venditore: ${user.username ? '@' + user.username : user.firstName}

💰 Prezzo: ${announcement.price}
⚡ Tipo di corrente: ${announcement.connectorType === 'both' ? 'AC e DC' : announcement.connectorType}
✅ Reti attivabili: ${announcement.brand}
${announcement.nonActivatableBrands ? `🚫 Reti NON attivabili: ${announcement.nonActivatableBrands}\n` : ''}
🕒 Disponibilità: ${announcement.availability}
🗺️ Zone di copertura: ${announcement.location}
💳 Metodi di pagamento: ${announcement.paymentMethods}
${announcement.additionalInfo ? `📋 Condizioni aggiuntive: ${announcement.additionalInfo}\n` : ''}

✅ Conferma per pubblicare l'annuncio nel topic "Vendo kWh".
`;
        
        // Pulsanti di conferma
        const keyboard = Markup.inlineKeyboard([
          [
            Markup.button.callback('✅ Conferma e pubblica', 'publish_sell'),
            Markup.button.callback('❌ Annulla', 'cancel_sell')
          ]
        ]);
        
        // Mostra l'anteprima con bottoni
        await ctx.reply(anteprima, { reply_markup: keyboard });
        
        logger.info(`Fine passo 9 per utente ${ctx.from.id}`);
        return ctx.wizard.next();
      } catch (err) {
        logger.error(`Errore nella creazione dell'anteprima per utente ${ctx.from.id}:`, err);
        await ctx.reply('Si è verificato un errore. Per favore, riprova più tardi o scrivi /annulla per ricominciare.');
        return ctx.scene.leave();
      }
    } catch (err) {
      logger.error(`Errore generale nel passo 9 per utente ${ctx.from.id}:`, err);
      await ctx.reply('Si è verificato un errore. Per favore, riprova più tardi o scrivi /annulla per ricominciare.');
      return ctx.scene.leave();
    }
  },
  // Passo 10: Gestito dalle callback 'publish_sell' e 'cancel_sell'
  async (ctx) => {
    try {
      logger.info(`Inizio passo 10 per utente ${ctx.from.id}`);
      
      // Gestione tramite callback
      if (ctx.callbackQuery) {
        logger.info(`Callback ricevuta nel passo 10: ${ctx.callbackQuery.data}`);
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
            await publishAnnouncement(ctx);
            return ctx.scene.leave();
          } catch (err) {
            logger.error(`Errore nella pubblicazione dell'annuncio per utente ${ctx.from.id}:`, err);
            await ctx.reply('❌ Si è verificato un errore durante la pubblicazione. Per favore, riprova più tardi.');
            return ctx.scene.leave();
          }
        }
        
        // Messaggio non riconosciuto
        await ctx.reply('Per favore, conferma o annulla la pubblicazione dell\'annuncio usando i bottoni visualizzati.');
      }
    } catch (err) {
      logger.error(`Errore generale nel passo 10 per utente ${ctx.from.id}:`, err);
      await ctx.reply('Si è verificato un errore. Per favore, riprova più tardi o scrivi /annulla per ricominciare.');
      return ctx.scene.leave();
    }
  }
);

// Funzione ausiliaria per pubblicare l'annuncio
async function publishAnnouncement(ctx) {
  logger.info(`Pubblicazione annuncio per utente ${ctx.from.id}`);
  
  if (ctx.callbackQuery) {
    await ctx.answerCbQuery('Pubblicazione in corso...');
  }
  
  const user = await userService.registerUser(ctx.from);
  
  // Controlla se l'utente ha già un annuncio attivo
  const existingAnnouncement = await announcementService.getActiveAnnouncement(user.userId, 'sell');
  
  // Se esiste già un annuncio attivo, archivialo
  if (existingAnnouncement) {
    logger.info(`Archiviazione annuncio esistente ${existingAnnouncement._id} per utente ${ctx.from.id}`);
    await announcementService.archiveAnnouncement(existingAnnouncement._id);
    await announcementService.updateUserActiveAnnouncement(user.userId, 'sell', null);
  }
  
  // Crea un nuovo annuncio con tutti i campi
  const announcementData = {
    price: ctx.wizard.state.price,
    connectorType: ctx.wizard.state.currentType,
    brand: ctx.wizard.state.brand,
    location: ctx.wizard.state.location,
    nonActivatableBrands: ctx.wizard.state.nonActivatableBrands === 'Nessuna limitazione' ? '' : ctx.wizard.state.nonActivatableBrands,
    additionalInfo: ctx.wizard.state.additionalInfo === 'Nessuna condizione aggiuntiva' ? '' : ctx.wizard.state.additionalInfo
  };
  
  // Aggiungiamo al campo additionalInfo le informazioni su disponibilità e metodi di pagamento
  const additionalDetails = [];
  
  if (ctx.wizard.state.availability) {
    additionalDetails.push(`Disponibilità: ${ctx.wizard.state.availability}`);
  }
  
  if (ctx.wizard.state.paymentMethods) {
    additionalDetails.push(`Metodi di pagamento: ${ctx.wizard.state.paymentMethods}`);
  }
  
  if (ctx.wizard.state.additionalInfo && ctx.wizard.state.additionalInfo !== 'Nessuna condizione aggiuntiva') {
    additionalDetails.push(ctx.wizard.state.additionalInfo);
  }
  
  // Aggiorna il campo additionalInfo con tutte le informazioni
  if (additionalDetails.length > 0) {
    announcementData.additionalInfo = additionalDetails.join('\n');
  }
  
  // Crea e pubblica l'annuncio
  const newAnnouncement = await announcementService.createSellAnnouncement(announcementData, user.userId);
  await announcementService.publishAnnouncement(newAnnouncement, user);
  
  // Aggiorna l'utente con il riferimento al nuovo annuncio
  await announcementService.updateUserActiveAnnouncement(user.userId, 'sell', newAnnouncement._id);
  
  logger.info(`Annuncio ${newAnnouncement._id} pubblicato con successo per utente ${ctx.from.id}`);
  await ctx.reply('✅ Il tuo annuncio è stato pubblicato con successo nel topic "Vendo kWh"!');
  
  return newAnnouncement;
}

// Gestori delle callback per il wizard
sellAnnouncementScene.action(/current_(.+)/, async (ctx) => {
  try {
    const currentType = ctx.match[1];
    ctx.wizard.state.currentType = currentType;
    
    logger.debug(`Tipo di corrente selezionato: ${currentType} per utente ${ctx.from.id}`);
    await ctx.answerCbQuery(`Hai selezionato: ${currentType}`);
    
    let currentText;
    if (currentType === 'AC') {
      currentText = 'AC (corrente alternata)';
    } else if (currentType === 'DC') {
      currentText = 'DC (corrente continua)';
    } else if (currentType === 'both') {
      currentText = 'Entrambe (DC e AC)';
    }
    
    await ctx.reply(`✅ Tipo di corrente selezionato: ${currentText}`);
    
    // Procediamo con il passo successivo
    await ctx.wizard.steps[3](ctx);
  } catch (err) {
    logger.error(`Errore nella callback current_ per utente ${ctx.from.id}:`, err);
    await ctx.reply('Si è verificato un errore. Per favore, riprova più tardi o scrivi /annulla per ricominciare.');
  }
});

sellAnnouncementScene.action('publish_sell', async (ctx) => {
  try {
    await publishAnnouncement(ctx);
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
Guida alla creazione di un annuncio

Stai creando un annuncio per vendere kWh. I passaggi sono:
1. Prezzo: indica quanto fai pagare per kWh
2. Tipo corrente: seleziona AC, DC o entrambe
3. Reti attivabili: indica quali colonnine puoi attivare
4. Reti NON attivabili: indica eventuali limitazioni
5. Disponibilità oraria: quando sei disponibile ad attivare
6. Zone di copertura: dove operi
7. Metodi di pagamento: come preferisci essere pagato
8. Condizioni aggiuntive: altre informazioni utili

Per annullare in qualsiasi momento, usa il comando /annulla o premi il pulsante "❌ Annulla".
`);
});

module.exports = sellAnnouncementScene;
