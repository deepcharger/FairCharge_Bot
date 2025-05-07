// File di ingresso principale del bot
require('dotenv').config();
const { bot, stage } = require('./config/bot');
const { connectToDatabase } = require('./config/database');
const commands = require('./handlers/commands');
const callbacks = require('./handlers/callbacks');
const middleware = require('./handlers/middleware');

// Connessione al database
connectToDatabase()
  .then(() => console.log('Connesso al database MongoDB'))
  .catch(err => {
    console.error('Errore nella connessione al database:', err);
    process.exit(1);
  });

// Registra i middleware
bot.use(middleware.session());
bot.use(stage.middleware());

// Registra i gestori dei comandi
bot.start(commands.startCommand);
bot.command('vendi_kwh', commands.sellKwhCommand);
bot.command('le_mie_ricariche', commands.myChargesCommand);
bot.command('profilo', commands.profileCommand);
bot.command('avvio_ricarica', commands.startChargeCommand);

// Registra i gestori delle callback
bot.action(/buy_kwh_(.+)/, callbacks.buyKwhCallback);
bot.action(/connector_(.+)/, callbacks.connectorTypeCallback);
bot.action('publish_sell', callbacks.publishSellCallback);
bot.action('cancel_sell', callbacks.cancelSellCallback);
bot.action('accept_conditions', callbacks.acceptConditionsCallback);
bot.action('cancel_buy', callbacks.cancelBuyCallback);
bot.action('send_request', callbacks.sendRequestCallback);
bot.action(/accept_offer_(.+)/, callbacks.acceptOfferCallback);
bot.action(/reject_offer_(.+)/, callbacks.rejectOfferCallback);
bot.action(/ready_to_charge_(.+)/, callbacks.readyToChargeCallback);
bot.action(/charging_started_(.+)/, callbacks.chargingStartedCallback);
bot.action(/charging_ok_(.+)/, callbacks.chargingOkCallback);
bot.action(/charging_issues_(.+)/, callbacks.chargingIssuesCallback);
bot.action(/charging_completed_(.+)/, callbacks.chargingCompletedCallback);
bot.action(/confirm_kwh_(.+)/, callbacks.confirmKwhCallback);
bot.action(/dispute_kwh_(.+)/, callbacks.disputeKwhCallback);
bot.action(/set_payment_(.+)/, callbacks.setPaymentCallback);
bot.action(/payment_sent_(.+)/, callbacks.paymentSentCallback);
bot.action(/payment_confirmed_(.+)/, callbacks.paymentConfirmedCallback);
bot.action(/payment_not_received_(.+)/, callbacks.paymentNotReceivedCallback);
bot.action(/donate_2_(.+)/, callbacks.donateFixedCallback);
bot.action(/donate_custom_(.+)/, callbacks.donateCustomCallback);
bot.action(/donate_skip_(.+)/, callbacks.donateSkipCallback);
bot.action(/feedback_positive_(.+)/, callbacks.feedbackPositiveCallback);
bot.action(/feedback_negative_(.+)/, callbacks.feedbackNegativeCallback);
bot.action(/cancel_charge_(.+)/, callbacks.cancelChargeCallback);
bot.action('send_manual_request', callbacks.sendManualRequestCallback);
bot.action('cancel_manual_request', callbacks.cancelManualRequestCallback);

// Gestione dei messaggi nei topic
bot.on(['message', 'channel_post'], middleware.topicMessageHandler);

// Gestione dei messaggi di testo (per handler specifici)
bot.on('text', middleware.textMessageHandler);

// Gestione dei messaggi con foto
bot.on('photo', middleware.photoMessageHandler);

// Gestione degli errori
bot.catch((err, ctx) => {
  console.error(`Errore per ${ctx.updateType}:`, err);
});

// Avvia il bot
bot.launch().then(() => {
  console.log('Bot avviato correttamente!');
}).catch(err => {
  console.error('Errore nell\'avvio del bot:', err);
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
