// Configurazione del bot Telegram
const { Telegraf, Scenes, session } = require('telegraf');
const sellAnnouncementScene = require('../handlers/scenes/sellAnnouncement');
const buyKwhScene = require('../handlers/scenes/buyKwh');

// Configurazione delle variabili d'ambiente
const BOT_TOKEN = process.env.BOT_TOKEN;
const BUY_GROUPS_CONFIG = JSON.parse(process.env.BUY_GROUPS_CONFIG || '{}');
const SELL_GROUPS_CONFIG = JSON.parse(process.env.SELL_GROUPS_CONFIG || '{}');
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const LOG_TO_FILE = process.env.LOG_TO_FILE === 'true';

// Inizializza il bot Telegram
const bot = new Telegraf(BOT_TOKEN);

// Configura le scene per i wizard
const stage = new Scenes.Stage([
  sellAnnouncementScene,
  buyKwhScene
]);

// Esporta le configurazioni
module.exports = {
  bot,
  stage,
  BUY_GROUPS_CONFIG,
  SELL_GROUPS_CONFIG,
  LOG_LEVEL,
  LOG_TO_FILE
};
