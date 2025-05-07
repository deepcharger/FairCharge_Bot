// Utility per la gestione del logging
const { createLogger, format, transports } = require('winston');
const path = require('path');
const fs = require('fs');

// Assicurati che la directory dei log esista
const logDir = 'logs';
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

// Configurazione dal file .env
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const LOG_TO_FILE = process.env.LOG_TO_FILE === 'true';

// Crea il formattatore personalizzato
const customFormat = format.combine(
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  format.errors({ stack: true }),
  format.splat(),
  format.json(),
  format.printf(info => {
    const { timestamp, level, message, ...rest } = info;
    let logMessage = `${timestamp} [${level.toUpperCase()}]: ${message}`;
    
    // Aggiungi metadata se presente
    if (Object.keys(rest).length > 0) {
      logMessage += ` | ${JSON.stringify(rest)}`;
    }
    
    return logMessage;
  })
);

// Array dei trasporti (dove inviare i log)
const logTransports = [
  // Sempre log sulla console
  new transports.Console({
    format: format.combine(
      format.colorize(),
      customFormat
    )
  })
];

// Aggiungi il trasporto file se richiesto
if (LOG_TO_FILE) {
  logTransports.push(
    // Tutti i log
    new transports.File({
      filename: path.join(logDir, 'combined.log'),
      format: customFormat
    }),
    // Solo log di errore
    new transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      format: customFormat
    })
  );
}

// Crea il logger
const logger = createLogger({
  level: LOG_LEVEL,
  format: customFormat,
  transports: logTransports,
  exitOnError: false, // Il processo non termina in caso di errore di scrittura
});

/**
 * Log un messaggio di debug
 * @param {String} message - Il messaggio da loggare
 * @param {Object} metadata - Dati aggiuntivi opzionali
 */
const debug = (message, metadata = {}) => {
  logger.debug(message, metadata);
};

/**
 * Log un messaggio informativo
 * @param {String} message - Il messaggio da loggare
 * @param {Object} metadata - Dati aggiuntivi opzionali
 */
const info = (message, metadata = {}) => {
  logger.info(message, metadata);
};

/**
 * Log un messaggio di avviso
 * @param {String} message - Il messaggio da loggare
 * @param {Object} metadata - Dati aggiuntivi opzionali
 */
const warn = (message, metadata = {}) => {
  logger.warn(message, metadata);
};

/**
 * Log un messaggio di errore
 * @param {String} message - Il messaggio da loggare
 * @param {Error|Object} error - L'errore o dati aggiuntivi
 */
const error = (message, error = {}) => {
  if (error instanceof Error) {
    logger.error(message, { error: error.message, stack: error.stack });
  } else {
    logger.error(message, error);
  }
};

/**
 * Log un messaggio per richieste HTTP
 * @param {Object} ctx - Contesto Telegraf
 * @param {Number} responseTime - Tempo di risposta in ms
 */
const request = (ctx, responseTime) => {
  const updateType = ctx.updateType || 'unknown';
  const userId = ctx.from ? ctx.from.id : 'unknown';
  const username = ctx.from ? (ctx.from.username || ctx.from.first_name) : 'unknown';
  const chatId = ctx.chat ? ctx.chat.id : 'unknown';
  const chatType = ctx.chat ? ctx.chat.type : 'unknown';
  
  logger.info(`${updateType} from ${username} (${userId}) in ${chatType} (${chatId})`, {
    updateType,
    userId,
    username,
    chatId,
    chatType,
    responseTime
  });
};

module.exports = {
  debug,
  info,
  warn,
  error,
  request
};
