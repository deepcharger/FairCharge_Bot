// consistency-check.js
// Script per verificare la coerenza del database e correggere eventuali problemi

require('dotenv').config();
const mongoose = require('mongoose');
const readline = require('readline');

// Modelli
const User = require('./models/user');
const Announcement = require('./models/announcement');
const Offer = require('./models/offer');
const Transaction = require('./models/transaction');

// Funzione per chiedere conferma all'utente
const askForConfirmation = (question) => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
};

// Connessione al database
const connectToDatabase = async () => {
  try {
    const MONGO_URI = process.env.MONGO_URI;
    const MONGO_DB_NAME = process.env.MONGO_DB_NAME;
    
    if (!MONGO_URI) {
      console.error('MONGO_URI non impostato nelle variabili d\'ambiente');
      process.exit(1);
    }
    
    await mongoose.connect(MONGO_URI, {
      dbName: MONGO_DB_NAME,
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    
    console.log('Connesso al database MongoDB');
    return mongoose.connection;
  } catch (error) {
    console.error('Errore nella connessione al database:', error);
    process.exit(1);
  }
};

// Funzione principale
const checkConsistency = async () => {
  try {
    // Connetti al database
    await connectToDatabase();
    
    console.log('\n========== VERIFICA COERENZA DATABASE ==========\n');
    
    // Ottieni tutti gli utenti
    const users = await User.find();
    console.log(`Trovati ${users.length} utenti nel database`);
    
    let inconsistencies = 0;
    let fixedIssues = 0;
    
    // Verifica annunci attivi
    console.log('\n--- Verifica annunci attivi ---');
    
    for (const user of users) {
      // Verifica annunci di vendita attivi
      if (user.activeAnnouncements.sell) {
        const sellAnnouncement = await Announcement.findById(user.activeAnnouncements.sell);
        if (!sellAnnouncement) {
          inconsistencies++;
          console.log(`- L'utente ${user.username || user.firstName} (ID: ${user.userId}) ha un riferimento a un annuncio di vendita non esistente (ID: ${user.activeAnnouncements.sell})`);
          
          // Chiedi se correggere
          const shouldFix = await askForConfirmation('Correggere questo problema? (y/n): ');
          if (shouldFix) {
            user.activeAnnouncements.sell = null;
            await user.save();
            console.log(`  ✓ Riferimento rimosso`);
            fixedIssues++;
          }
        } else if (sellAnnouncement.status !== 'active') {
          inconsistencies++;
          console.log(`- L'utente ${user.username || user.firstName} (ID: ${user.userId}) ha un riferimento a un annuncio di vendita con stato non attivo (ID: ${user.activeAnnouncements.sell}, Stato: ${sellAnnouncement.status})`);
          
          // Chiedi se correggere
          const shouldFix = await askForConfirmation('Correggere questo problema? (y/n): ');
          if (shouldFix) {
            user.activeAnnouncements.sell = null;
            await user.save();
            console.log(`  ✓ Riferimento rimosso`);
            fixedIssues++;
          }
        }
      }
      
      // Verifica annunci di acquisto attivi
      if (user.activeAnnouncements.buy) {
        const buyAnnouncement = await Announcement.findById(user.activeAnnouncements.buy);
        if (!buyAnnouncement) {
          inconsistencies++;
          console.log(`- L'utente ${user.username || user.firstName} (ID: ${user.userId}) ha un riferimento a un annuncio di acquisto non esistente (ID: ${user.activeAnnouncements.buy})`);
          
          // Chiedi se correggere
          const shouldFix = await askForConfirmation('Correggere questo problema? (y/n): ');
          if (shouldFix) {
            user.activeAnnouncements.buy = null;
            await user.save();
            console.log(`  ✓ Riferimento rimosso`);
            fixedIssues++;
          }
        } else if (buyAnnouncement.status !== 'active') {
          inconsistencies++;
          console.log(`- L'utente ${user.username || user.firstName} (ID: ${user.userId}) ha un riferimento a un annuncio di acquisto con stato non attivo (ID: ${user.activeAnnouncements.buy}, Stato: ${buyAnnouncement.status})`);
          
          // Chiedi se correggere
          const shouldFix = await askForConfirmation('Correggere questo problema? (y/n): ');
          if (shouldFix) {
            user.activeAnnouncements.buy = null;
            await user.save();
            console.log(`  ✓ Riferimento rimosso`);
            fixedIssues++;
          }
        }
      }
    }
    
    // Verifica transazioni
    console.log('\n--- Verifica transazioni ---');
    
    for (const user of users) {
      // Controlla se tutte le transazioni riferite nell'utente esistono
      for (const transactionId of user.transactions) {
        const transaction = await Transaction.findById(transactionId);
        if (!transaction) {
          inconsistencies++;
          console.log(`- L'utente ${user.username || user.firstName} (ID: ${user.userId}) ha un riferimento a una transazione non esistente (ID: ${transactionId})`);
          
          // Chiedi se correggere
          const shouldFix = await askForConfirmation('Correggere questo problema? (y/n): ');
          if (shouldFix) {
            // Rimuovi il riferimento alla transazione
            user.transactions = user.transactions.filter(id => !id.equals(transactionId));
            await user.save();
            console.log(`  ✓ Riferimento rimosso`);
            fixedIssues++;
          }
        }
      }
    }
    
    // Verifica offerte
    console.log('\n--- Verifica offerte ---');
    
    // Ottieni tutte le offerte
    const offers = await Offer.find();
    console.log(`Trovate ${offers.length} offerte nel database`);
    
    for (const offer of offers) {
      // Verifica che l'annuncio collegato esista (se presente)
      if (offer.announcementId) {
        const announcement = await Announcement.findById(offer.announcementId);
        if (!announcement) {
          inconsistencies++;
          console.log(`- L'offerta ${offer._id} ha un riferimento a un annuncio non esistente (ID: ${offer.announcementId})`);
          
          // Chiedi se correggere
          const shouldFix = await askForConfirmation('Correggere questo problema? (y/n): ');
          if (shouldFix) {
            offer.announcementId = null;
            await offer.save();
            console.log(`  ✓ Riferimento rimosso`);
            fixedIssues++;
          }
        }
      }
      
      // Verifica che l'acquirente esista
      const buyer = await User.findOne({ userId: offer.buyerId });
      if (!buyer) {
        inconsistencies++;
        console.log(`- L'offerta ${offer._id} ha un riferimento a un acquirente non esistente (ID: ${offer.buyerId})`);
      }
      
      // Verifica che il venditore esista
      const seller = await User.findOne({ userId: offer.sellerId });
      if (!seller) {
        inconsistencies++;
        console.log(`- L'offerta ${offer._id} ha un riferimento a un venditore non esistente (ID: ${offer.sellerId})`);
      }
    }
    
    // Verifica annunci
    console.log('\n--- Verifica annunci ---');
    
    // Ottieni tutti gli annunci
    const announcements = await Announcement.find();
    console.log(`Trovati ${announcements.length} annunci nel database`);
    
    for (const announcement of announcements) {
      // Verifica che l'utente proprietario esista
      const owner = await User.findOne({ userId: announcement.userId });
      if (!owner) {
        inconsistencies++;
        console.log(`- L'annuncio ${announcement._id} ha un riferimento a un utente proprietario non esistente (ID: ${announcement.userId})`);
      }
      
      // Verifica offerte collegate
      for (const offerId of announcement.offers) {
        const offer = await Offer.findById(offerId);
        if (!offer) {
          inconsistencies++;
          console.log(`- L'annuncio ${announcement._id} ha un riferimento a un'offerta non esistente (ID: ${offerId})`);
          
          // Chiedi se correggere
          const shouldFix = await askForConfirmation('Correggere questo problema? (y/n): ');
          if (shouldFix) {
            // Rimuovi il riferimento all'offerta
            announcement.offers = announcement.offers.filter(id => !id.equals(offerId));
            await announcement.save();
            console.log(`  ✓ Riferimento rimosso`);
            fixedIssues++;
          }
        }
      }
    }
    
    // Sommario
    console.log('\n--- Sommario ---');
    if (inconsistencies === 0) {
      console.log('Nessuna incoerenza trovata nel database!');
    } else {
      console.log(`Trovate ${inconsistencies} incoerenze nel database.`);
      console.log(`Corrette ${fixedIssues} incoerenze.`);
      console.log(`Rimaste ${inconsistencies - fixedIssues} incoerenze non corrette.`);
    }
    
    // Chiudi la connessione
    await mongoose.connection.close();
    console.log('\nConnessione al database chiusa');
    
  } catch (error) {
    console.error('Errore durante la verifica della coerenza del database:', error);
    process.exit(1);
  }
};

// Esegui lo script
checkConsistency();
