// Configurazione della connessione a MongoDB
const mongoose = require('mongoose');

// Variabili di ambiente per la connessione al database
const MONGO_URI = process.env.MONGO_URI;
const MONGO_DB_NAME = process.env.MONGO_DB_NAME;

/**
 * Stabilisce la connessione al database MongoDB
 * @returns {Promise} Promise che si risolve quando la connessione è stabilita
 */
const connectToDatabase = async () => {
  try {
    await mongoose.connect(MONGO_URI, {
      dbName: MONGO_DB_NAME,
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    return mongoose.connection;
  } catch (error) {
    console.error('Errore nella connessione al database:', error);
    throw error;
  }
};

module.exports = {
  connectToDatabase
};
