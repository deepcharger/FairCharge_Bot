// services/whitelistService.js
// Servizio per la gestione della whitelist manuale degli utenti

const User = require('../models/user');
const logger = require('../utils/logger');
const { isAdmin } = require('../config/admin');
const { bot } = require('../config/bot');

/**
 * Aggiunge un utente alla whitelist
 * @param {Number} userId - ID dell'utente da aggiungere
 * @param {String} reason - Motivo dell'approvazione
 * @param {Number} approvedBy - ID dell'admin che approva
 * @returns {Promise<Object>} Risultato dell'operazione
 */
const addToWhitelist = async (userId, reason = 'Approvazione manuale', approvedBy = null) => {
  try {
    logger.info(`Aggiunta utente ${userId} alla whitelist`, {
      userId,
      reason,
      approvedBy
    });
    
    const user = await User.findOne({ userId });
    if (!user) {
      throw new Error('Utente non trovato nel database');
    }
    
    // Aggiorna l'utente con lo status whitelist
    user.isWhitelisted = true;
    user.whitelistReason = reason;
    user.whitelistedBy = approvedBy;
    user.whitelistedAt = new Date();
    
    await user.save();
    
    logger.info(`Utente ${userId} aggiunto alla whitelist con successo`);
    
    return {
      success: true,
      user,
      message: 'Utente aggiunto alla whitelist con successo'
    };
    
  } catch (err) {
    logger.error(`Errore nell'aggiunta alla whitelist dell'utente ${userId}:`, err);
    return {
      success: false,
      error: err.message
    };
  }
};

/**
 * Rimuove un utente dalla whitelist
 * @param {Number} userId - ID dell'utente da rimuovere
 * @param {String} reason - Motivo della rimozione
 * @param {Number} removedBy - ID dell'admin che rimuove
 * @returns {Promise<Object>} Risultato dell'operazione
 */
const removeFromWhitelist = async (userId, reason = 'Rimozione manuale', removedBy = null) => {
  try {
    logger.info(`Rimozione utente ${userId} dalla whitelist`, {
      userId,
      reason,
      removedBy
    });
    
    const user = await User.findOne({ userId });
    if (!user) {
      throw new Error('Utente non trovato nel database');
    }
    
    // Rimuovi lo status whitelist
    user.isWhitelisted = false;
    user.whitelistReason = reason;
    user.whitelistedBy = removedBy;
    user.whitelistedAt = new Date();
    
    await user.save();
    
    logger.info(`Utente ${userId} rimosso dalla whitelist con successo`);
    
    return {
      success: true,
      user,
      message: 'Utente rimosso dalla whitelist con successo'
    };
    
  } catch (err) {
    logger.error(`Errore nella rimozione dalla whitelist dell'utente ${userId}:`, err);
    return {
      success: false,
      error: err.message
    };
  }
};

/**
 * Verifica se un utente è in whitelist
 * @param {Number} userId - ID dell'utente da verificare
 * @returns {Promise<Boolean>} True se è in whitelist
 */
const isWhitelisted = async (userId) => {
  try {
    const user = await User.findOne({ userId });
    return user ? user.isWhitelisted === true : false;
  } catch (err) {
    logger.error(`Errore nella verifica whitelist per utente ${userId}:`, err);
    return false;
  }
};

/**
 * Ottiene la lista degli utenti in whitelist
 * @param {Number} limit - Limite di risultati
 * @returns {Promise<Array>} Lista degli utenti in whitelist
 */
const getWhitelistedUsers = async (limit = 50) => {
  try {
    const users = await User.find({ isWhitelisted: true })
      .sort({ whitelistedAt: -1 })
      .limit(limit);
    
    return users;
  } catch (err) {
    logger.error('Errore nel recupero degli utenti in whitelist:', err);
    return [];
  }
};

/**
 * Aggiunge un utente al gruppo VIP
 * @param {Number} userId - ID dell'utente
 * @returns {Promise<Object>} Risultato dell'operazione
 */
const addToVipGroup = async (userId) => {
  try {
    const vipGroupId = process.env.VIP_GROUP_ID;
    if (!vipGroupId) {
      throw new Error('VIP_GROUP_ID non configurato');
    }
    
    // Crea un link di invito per il gruppo VIP
    const inviteLink = await bot.telegram.createChatInviteLink(vipGroupId, {
      member_limit: 1,
      expire_date: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 ore
    });
    
    return {
      success: true,
      inviteLink: inviteLink.invite_link,
      message: 'Link di invito VIP creato con successo'
    };
    
  } catch (err) {
    logger.error(`Errore nella creazione del link VIP per utente ${userId}:`, err);
    return {
      success: false,
      error: err.message
    };
  }
};

/**
 * Middleware per verificare la whitelist
 * @param {Boolean} requireWhitelist - Se richiedere whitelist
 * @returns {Function} Middleware di verifica
 */
const whitelistMiddleware = (requireWhitelist = false) => {
  return async (ctx, next) => {
    if (!requireWhitelist) {
      return next();
    }
    
    try {
      const userWhitelisted = await isWhitelisted(ctx.from.id);
      
      if (!userWhitelisted) {
        await ctx.reply(
          '🔒 <b>Accesso Limitato</b>\n\n' +
          'Questa funzionalità è riservata agli utenti approvati manualmente.\n\n' +
          'Per richiedere l\'approvazione, contatta un amministratore.',
          { 
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '📞 Richiedi Approvazione', url: 'https://t.me/your_support_username' }]
              ]
            }
          }
        );
        return;
      }
      
      return next();
      
    } catch (err) {
      logger.error('Errore nel middleware whitelist:', err);
      return next();
    }
  };
};

/**
 * Comando admin per gestire la whitelist
 */
const manageWhitelistCommand = async (ctx) => {
  try {
    if (!isAdmin(ctx.from.id)) {
      await ctx.reply('❌ Solo gli admin possono usare questo comando.');
      return;
    }
    
    const text = ctx.message.text.split(' ');
    if (text.length < 2) {
      await ctx.reply(
        '⚠️ <b>Formato:</b>\n\n' +
        '/manage_whitelist add @username [motivo]\n' +
        '/manage_whitelist remove @username [motivo]\n' +
        '/manage_whitelist list\n' +
        '/manage_whitelist check @username',
        { parse_mode: 'HTML' }
      );
      return;
    }
    
    const action = text[1].toLowerCase();
    
    if (action === 'list') {
      const whitelistedUsers = await getWhitelistedUsers(20);
      
      if (whitelistedUsers.length === 0) {
        await ctx.reply('📋 <b>Whitelist vuota</b>\n\nNessun utente attualmente in whitelist.', { parse_mode: 'HTML' });
        return;
      }
      
      let message = `📋 <b>Utenti in Whitelist (${whitelistedUsers.length})</b>\n\n`;
      
      whitelistedUsers.forEach((user, index) => {
        message += `${index + 1}. <b>${user.firstName || 'N/A'}`;
        if (user.lastName) message += ` ${user.lastName}`;
        message += `</b>\n`;
        message += `   ID: ${user.userId}\n`;
        message += `   Username: ${user.username ? '@' + user.username : 'N/A'}\n`;
        message += `   Approvato: ${user.whitelistedAt ? user.whitelistedAt.toLocaleDateString('it-IT') : 'N/A'}\n`;
        if (user.whitelistReason) {
          message += `   Motivo: ${user.whitelistReason}\n`;
        }
        message += '\n';
      });
      
      await ctx.reply(message, { parse_mode: 'HTML' });
      return;
    }
    
    if (text.length < 3) {
      await ctx.reply('⚠️ Specifica @username o ID utente');
      return;
    }
    
    const target = text[2].replace('@', '');
    const reason = text.slice(3).join(' ') || 'Gestione admin';
    
    let targetUserId;
    if (/^\d+$/.test(target)) {
      targetUserId = parseInt(target);
    } else {
      const user = await User.findOne({ username: target });
      if (!user) {
        await ctx.reply(`❌ Utente @${target} non trovato nel database.`);
        return;
      }
      targetUserId = user.userId;
    }
    
    if (action === 'add') {
      const result = await addToWhitelist(targetUserId, reason, ctx.from.id);
      
      if (result.success) {
        await ctx.reply(
          `✅ <b>Utente Approvato</b>\n\n` +
          `<b>Utente:</b> ${result.user.firstName} (${targetUserId})\n` +
          `<b>Motivo:</b> ${reason}\n\n` +
          `L'utente è stato aggiunto alla whitelist e può ora utilizzare tutte le funzionalità del bot.`,
          { 
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '👑 Aggiungi a VIP', callback_data: `add_to_vip_${targetUserId}` }]
              ]
            }
          }
        );
        
        // Notifica l'utente dell'approvazione
        try {
          await bot.telegram.sendMessage(
            targetUserId,
            '🎉 <b>Account Approvato!</b>\n\n' +
            'Il tuo account è stato approvato da un amministratore.\n' +
            'Ora puoi utilizzare tutte le funzionalità di FairCharge Pro!\n\n' +
            'Benvenuto nella community!',
            { parse_mode: 'HTML' }
          );
        } catch (notifyErr) {
          logger.warn(`Impossibile notificare l'utente ${targetUserId}:`, notifyErr);
        }
        
      } else {
        await ctx.reply(`❌ Errore: ${result.error}`);
      }
      
    } else if (action === 'remove') {
      const result = await removeFromWhitelist(targetUserId, reason, ctx.from.id);
      
      if (result.success) {
        await ctx.reply(
          `🚫 <b>Utente Rimosso</b>\n\n` +
          `<b>Utente:</b> ${result.user.firstName} (${targetUserId})\n` +
          `<b>Motivo:</b> ${reason}\n\n` +
          `L'utente è stato rimosso dalla whitelist.`,
          { parse_mode: 'HTML' }
        );
        
        // Notifica l'utente della rimozione
        try {
          await bot.telegram.sendMessage(
            targetUserId,
            '⚠️ <b>Accesso Modificato</b>\n\n' +
            'Il tuo stato di approvazione è stato modificato da un amministratore.\n' +
            'Alcune funzionalità potrebbero non essere più disponibili.\n\n' +
            'Per maggiori informazioni, contatta il supporto.',
            { parse_mode: 'HTML' }
          );
        } catch (notifyErr) {
          logger.warn(`Impossibile notificare l'utente ${targetUserId}:`, notifyErr);
        }
        
      } else {
        await ctx.reply(`❌ Errore: ${result.error}`);
      }
      
    } else if (action === 'check') {
      const user = await User.findOne({ userId: targetUserId });
      if (!user) {
        await ctx.reply('❌ Utente non trovato nel database.');
        return;
      }
      
      let status = `👤 <b>Status Utente</b>\n\n`;
      status += `<b>Nome:</b> ${user.firstName}`;
      if (user.lastName) status += ` ${user.lastName}`;
      status += `\n<b>ID:</b> ${user.userId}`;
      status += `\n<b>Username:</b> ${user.username ? '@' + user.username : 'N/A'}`;
      status += `\n<b>Registrato:</b> ${user.registrationDate.toLocaleDateString('it-IT')}`;
      status += `\n\n<b>Whitelist:</b> ${user.isWhitelisted ? '✅ Approvato' : '❌ Standard'}`;
      
      if (user.isWhitelisted && user.whitelistedAt) {
        status += `\n<b>Approvato il:</b> ${user.whitelistedAt.toLocaleDateString('it-IT')}`;
        if (user.whitelistReason) {
          status += `\n<b>Motivo:</b> ${user.whitelistReason}`;
        }
        if (user.whitelistedBy) {
          status += `\n<b>Approvato da:</b> ${user.whitelistedBy}`;
        }
      }
      
      await ctx.reply(status, { parse_mode: 'HTML' });
      
    } else {
      await ctx.reply('❌ Azione non riconosciuta. Usa: add, remove, list, check');
    }
    
  } catch (err) {
    logger.error('Errore nel comando manage_whitelist:', err);
    await ctx.reply('❌ Errore durante la gestione della whitelist.');
  }
};

module.exports = {
  addToWhitelist,
  removeFromWhitelist,
  isWhitelisted,
  getWhitelistedUsers,
  addToVipGroup,
  whitelistMiddleware,
  manageWhitelistCommand
};
