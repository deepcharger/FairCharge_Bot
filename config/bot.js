// Configurazione del bot Telegram
const { Telegraf, Scenes, session } = require('telegraf');
const logger = require('../utils/logger');

// Configurazione delle variabili d'ambiente
const BOT_TOKEN = process.env.BOT_TOKEN;
const BUY_GROUPS_CONFIG = JSON.parse(process.env.BUY_GROUPS_CONFIG || '{}');
const SELL_GROUPS_CONFIG = JSON.parse(process.env.SELL_GROUPS_CONFIG || '{}');
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const LOG_TO_FILE = process.env.LOG_TO_FILE === 'true';

// Inizializza il bot Telegram
const bot = new Telegraf(BOT_TOKEN);

// Per evitare le dipendenze circolari, spostiamo l'importazione delle scene
// dopo l'esportazione del modulo
let stage = null;

// Funzione per inizializzare le scene
const initScenes = () => {
  if (stage === null) {
    // Importa le scene qui, dopo l'esportazione del modulo
    const sellAnnouncementScene = require('../handlers/scenes/sellAnnouncement');
    const buyKwhScene = require('../handlers/scenes/buyKwh');
    
    // Configura le scene per i wizard
    stage = new Scenes.Stage([
      sellAnnouncementScene,
      buyKwhScene
    ]);
    
    logger.debug('Scene inizializzate');
  }
  
  return stage;
};

// Esporta le configurazioni
module.exports = {
  bot,
  get stage() {
    return initScenes();
  },
  BUY_GROUPS_CONFIG,
  SELL_GROUPS_CONFIG,
  LOG_LEVEL,
  LOG_TO_FILE
};
