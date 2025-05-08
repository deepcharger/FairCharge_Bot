// cleanup.js
// Script per pulire il database e resettare i dati

require('dotenv').config();
const mongoose = require('mongoose');
const readline = require('readline');

// Modelli
const User = require('./models/user');
const Announcement = require('./models/announcement');
const Offer = require('./models/offer');
const Transaction = require('./models/transaction');
const Donation = require('./models/donation');

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
const cleanup = async () => {
  try {
    // Connetti al database
    await connectToDatabase();
    
    console.log('\n========== PULIZIA DATABASE ==========\n');
    console.log('Questo script pulirà il database e resetterà tutti i dati.');
    console.log('ATTENZIONE: Questa operazione è irreversibile!\n');
    
    // Ottieni i conteggi attuali
    const userCount = await User.countDocuments();
    const announcementCount = await Announcement.countDocuments();
    const offerCount = await Offer.countDocuments();
    const transactionCount = await Transaction.countDocuments();
    const donationCount = await Donation.countDocuments();
    
    console.log('Statistiche attuali del database:');
    console.log(`- Utenti: ${userCount}`);
    console.log(`- Annunci: ${announcementCount}`);
    console.log(`- Offerte: ${offerCount}`);
    console.log(`- Transazioni: ${transactionCount}`);
    console.log(`- Donazioni: ${donationCount}\n`);
    
    // Chiedi conferma
    const confirmation = await askForConfirmation('Sei sicuro di voler cancellare tutti i dati? (y/n): ');
    
    if (!confirmation) {
      console.log('Operazione annullata.');
      process.exit(0);
    }
    
    // Operazioni di pulizia
    console.log('\nCancellazione in corso...');
    
    // Opzione 1: Cancellazione completa di tutte le collezioni
    const fullReset = await askForConfirmation('Vuoi cancellare completamente tutte le collezioni? (y/n): ');
    
    if (fullReset) {
      // Cancella tutte le collezioni
      await Announcement.deleteMany({});
      await Offer.deleteMany({});
      await Transaction.deleteMany({});
      await Donation.deleteMany({});
      
      // Per gli utenti, chiedi se vuole preservare i dati utente base
      const preserveUsers = await askForConfirmation('Vuoi preservare i dati utente base (ID, username, nome)? (y/n): ');
      
      if (preserveUsers) {
        // Reimposta solo i campi specifici degli utenti
        await User.updateMany({}, {
          $set: {
            positiveRatings: 0,
            totalRatings: 0,
            balance: 0,
            activeAnnouncements: { sell: null, buy: null },
            transactions: []
          }
        });
        console.log('Dati utente reimpostati ma informazioni base preservate');
      } else {
        // Cancella tutti gli utenti
        await User.deleteMany({});
        console.log('Tutti gli utenti cancellati');
      }
    } else {
      // Opzione 2: Pulizia selettiva
      console.log('\nPulizia selettiva:');
      
      // Annunci
      if (await askForConfirmation('Cancellare tutti gli annunci? (y/n): ')) {
        await Announcement.deleteMany({});
        console.log('Annunci cancellati');
      }
      
      // Offerte
      if (await askForConfirmation('Cancellare tutte le offerte? (y/n): ')) {
        await Offer.deleteMany({});
        console.log('Offerte cancellate');
      }
      
      // Transazioni
      if (await askForConfirmation('Cancellare tutte le transazioni? (y/n): ')) {
        await Transaction.deleteMany({});
        console.log('Transazioni cancellate');
      }
      
      // Donazioni
      if (await askForConfirmation('Cancellare tutte le donazioni? (y/n): ')) {
        await Donation.deleteMany({});
        console.log('Donazioni cancellate');
      }
      
      // Ripulire i riferimenti negli utenti
      if (await askForConfirmation('Ripulire i riferimenti agli annunci negli utenti? (y/n): ')) {
        await User.updateMany({}, {
          $set: {
            activeAnnouncements: { sell: null, buy: null }
          }
        });
        console.log('Riferimenti agli annunci ripuliti');
      }
      
      // Reset saldo e feedback
      if (await askForConfirmation('Reimpostare saldo e feedback degli utenti? (y/n): ')) {
        await User.updateMany({}, {
          $set: {
            positiveRatings: 0,
            totalRatings: 0,
            balance: 0
          }
        });
        console.log('Saldo e feedback reimpostati');
      }
      
      // Rimuovere transazioni dagli utenti
      if (await askForConfirmation('Rimuovere i riferimenti alle transazioni dagli utenti? (y/n): ')) {
        await User.updateMany({}, {
          $set: {
            transactions: []
          }
        });
        console.log('Riferimenti alle transazioni rimossi');
      }
    }
    
    console.log('\nPulizia completata con successo!');
    
    // Nuovi conteggi
    const newUserCount = await User.countDocuments();
    const newAnnouncementCount = await Announcement.countDocuments();
    const newOfferCount = await Offer.countDocuments();
    const newTransactionCount = await Transaction.countDocuments();
    const newDonationCount = await Donation.countDocuments();
    
    console.log('\nNuove statistiche del database:');
    console.log(`- Utenti: ${newUserCount}`);
    console.log(`- Annunci: ${newAnnouncementCount}`);
    console.log(`- Offerte: ${newOfferCount}`);
    console.log(`- Transazioni: ${newTransactionCount}`);
    console.log(`- Donazioni: ${newDonationCount}`);
    
    // Chiudi la connessione
    await mongoose.connection.close();
    console.log('\nConnessione al database chiusa');
    
  } catch (error) {
    console.error('Errore durante la pulizia del database:', error);
    process.exit(1);
  }
};

// Esegui lo script
cleanup();
