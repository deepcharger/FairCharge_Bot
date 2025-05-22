// services/memberVerificationService.js
// Servizio per verificare che gli utenti siano membri dei gruppi autorizzati
const { bot } = require('../config/bot');
const User = require('../models/user');
const logger = require('../utils/logger');

// ID dei gruppi autorizzati (da configurazione)
const getAuthorizedGroups = () => {
  const groups = [];
  
  try {
    if (process.env.SELL_GROUPS_CONFIG) {
      const sellConfig = JSON.parse(process.env.SELL_GROUPS_CONFIG);
      if (sellConfig.groupId) groups.push(parseInt(sellConfig.groupId));
    }
  } catch (err) {
    logger.warn('Errore nel parsing SELL_GROUPS_CONFIG:', err);
  }
  
  try {
    if (process.env.BUY_GROUPS_CONFIG) {
      const buyConfig = JSON.parse(process.env.BUY_GROUPS_CONFIG);
      if (buyConfig.groupId) groups.push(parseInt(buyConfig.groupId));
    }
  } catch (err) {
    logger.warn('Errore nel parsing BUY_GROUPS_CONFIG:', err);
  }
  
  // Gruppo VIP per venditori verificati
  if (process.env.VIP_GROUP_ID) {
    groups.push(parseInt(process.env.VIP_GROUP_ID));
  }
  
  // Gruppo aggiuntivo per verifica membri
  if (process.env.VERIFICATION_GROUP_ID) {
    groups.push(parseInt(process.env.VERIFICATION_GROUP_ID));
  }
  
  return groups.filter(id => !isNaN(id)); // Rimuove valori non numerici
};

/**
 * Verifica se un utente è membro di almeno uno dei gruppi autorizzati
 * @param {Number} userId - ID dell'utente da verificare
 * @param {Boolean} forceCheck - Forza il controllo anche se recente
 * @returns {Promise<Object>} Risultato della verifica
 */
const verifyUserMembership = async (userId, forceCheck = false) => {
  try {
    const AUTHORIZED_GROUPS = getAuthorizedGroups();
    
    logger.info(`Verifica membership per utente ${userId}`, {
      userId,
      authorizedGroups: AUTHORIZED_GROUPS.length,
      forceCheck
    });
    
    if (AUTHORIZED_GROUPS.length === 0) {
      logger.warn('Nessun gruppo autorizzato configurato, accesso permesso a tutti');
      return {
        isAuthorized: true,
        isVipMember: false,
        memberOf: [],
        reason: 'Nessun controllo configurato',
        cached: false
      };
    }
    
    // Controlla se abbiamo un controllo recente in cache (ultimi 30 minuti)
    const user = await User.findOne({ userId });
    if (user && user.lastMembershipCheck && !forceCheck) {
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
      if (user.lastMembershipCheck > thirtyMinutesAgo) {
        logger.debug(`Usando cache membership per utente ${userId}`);
        return {
          isAuthorized: user.authorizedGroups && user.authorizedGroups.length > 0,
          isVipMember: user.isVipMember || false,
          memberOf: user.authorizedGroups || [],
          reason: 'Cached result',
          cached: true,
          lastCheck: user.lastMembershipCheck
        };
      }
    }
    
    const membershipResults = [];
    let authorizedGroups = [];
    let isVipMember = false;
    
    // Controlla membership in ogni gruppo autorizzato
    for (const groupId of AUTHORIZED_GROUPS) {
      try {
        logger.debug(`Controllo membership utente ${userId} nel gruppo ${groupId}`);
        
        const chatMember = await bot.telegram.getChatMember(groupId, userId);
        
        logger.debug(`Status utente ${userId} nel gruppo ${groupId}: ${chatMember.status}`);
        
        // Stati che considerano come "membro autorizzato"
        const authorizedStatuses = ['member', 'administrator', 'creator'];
        const isAuthorizedInThisGroup = authorizedStatuses.includes(chatMember.status);
        
        // Verifica se è nel gruppo VIP
        if (groupId === parseInt(process.env.VIP_GROUP_ID) && isAuthorizedInThisGroup) {
          isVipMember = true;
        }
        
        membershipResults.push({
          groupId,
          status: chatMember.status,
          isAuthorized: isAuthorizedInThisGroup,
          isVip: groupId === parseInt(process.env.VIP_GROUP_ID),
          user: chatMember.user
        });
        
        if (isAuthorizedInThisGroup) {
          authorizedGroups.push(groupId);
        }
        
      } catch (groupError) {
        logger.warn(`Errore nel controllo membership per gruppo ${groupId}:`, groupError.description || groupError.message);
        
        // Gestiamo diversi tipi di errore
        if (groupError.description?.includes('user not found') || 
            groupError.description?.includes('USER_NOT_PARTICIPANT')) {
          membershipResults.push({
            groupId,
            status: 'not_member',
            isAuthorized: false,
            isVip: groupId === parseInt(process.env.VIP_GROUP_ID),
            error: 'Non membro'
          });
        } else {
          membershipResults.push({
            groupId,
            status: 'error',
            isAuthorized: false,
            isVip: false,
            error: groupError.description || 'Errore sconosciuto'
          });
        }
      }
    }
    
    // Aggiorna il database con i risultati
    if (user) {
      user.authorizedGroups = authorizedGroups;
      user.isVipMember = isVipMember;
      user.lastMembershipCheck = new Date();
      await user.save();
    }
    
    const result = {
      isAuthorized: authorizedGroups.length > 0,
      isVipMember,
      memberOf: authorizedGroups,
      allResults: membershipResults,
      checkedGroups: AUTHORIZED_GROUPS.length,
      cached: false
    };
    
    logger.info(`Verifica membership completata per utente ${userId}`, {
      userId,
      isAuthorized: result.isAuthorized,
      isVipMember: result.isVipMember,
      memberOfGroups: result.memberOf.length,
      totalGroupsChecked: result.checkedGroups
    });
    
    return result;
    
  } catch (err) {
    logger.error(`Errore nella verifica membership per utente ${userId}:`, err);
    
    // In caso di errore, per sicurezza neghiamo l'accesso
    return {
      isAuthorized: false,
      isVipMember: false,
      memberOf: [],
      error: err.message,
      reason: 'Errore durante la verifica',
      cached: false
    };
  }
};

/**
 * Middleware per verificare l'autorizzazione dell'utente
 * @param {Boolean} enforceCheck - Se rendere obbligatorio il controllo
 * @param {Boolean} requireVip - Se richiedere membership VIP
 * @returns {Function} Middleware di verifica
 */
const membershipMiddleware = (enforceCheck = true, requireVip = false) => {
  return async (ctx, next) => {
    // Salta la verifica per alcuni comandi base
    const skipCommands = ['/start', '/help'];
    const command = ctx.message?.text?.split(' ')[0];
    
    if (skipCommands.includes(command)) {
      return next();
    }
    
    try {
      const verification = await verifyUserMembership(ctx.from.id);
      
      // Aggiungi il risultato della verifica al contesto
      ctx.membershipVerification = verification;
      
      // Controlla se richiede VIP e l'utente non è VIP
      if (requireVip && !verification.isVipMember && enforceCheck) {
        logger.warn(`Accesso VIP negato a utente ${ctx.from.id}`, {
          userId: ctx.from.id,
          username: ctx.from.username,
          reason: 'Non membro VIP'
        });
        
        await ctx.reply(
          '👑 <b>Accesso VIP Richiesto</b>\n\n' +
          'Questa funzionalità è riservata ai membri del gruppo VIP.\n\n' +
          'Per diventare membro VIP, contatta un amministratore dopo aver dimostrato di essere un venditore affidabile.',
          { 
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '📞 Richiedi Accesso VIP', url: 'https://t.me/your_support_username' }]
              ]
            }
          }
        );
        
        return; // Blocca l'esecuzione
      }
      
      if (!verification.isAuthorized && enforceCheck) {
        logger.warn(`Accesso negato a utente ${ctx.from.id}`, {
          userId: ctx.from.id,
          username: ctx.from.username,
          reason: verification.reason || 'Non membro di gruppi autorizzati'
        });
        
        await ctx.reply(
          '🚫 <b>Accesso Limitato</b>\n\n' +
          'Questo bot è riservato ai membri dei nostri gruppi ufficiali.\n\n' +
          'Per utilizzare FairCharge Pro devi essere membro di almeno uno dei nostri gruppi autorizzati.\n\n' +
          'Se pensi che questo sia un errore, contatta un amministratore.',
          { 
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '📞 Contatta Support', url: 'https://t.me/your_support_username' }]
              ]
            }
          }
        );
        
        return; // Blocca l'esecuzione
      }
      
      // Se autorizzato o controllo non obbligatorio, continua
      return next();
      
    } catch (err) {
      logger.error(`Errore nel middleware di verifica membership:`, err);
      
      if (enforceCheck) {
        await ctx.reply('❌ Si è verificato un errore durante la verifica. Riprova più tardi.');
        return;
      }
      
      return next();
    }
  };
};

/**
 * Comando admin per verificare lo status di un utente
 * @param {Object} ctx - Contesto Telegraf
 */
const checkUserMembershipCommand = async (ctx) => {
  try {
    const { isAdmin } = require('../config/admin');
    
    if (!isAdmin(ctx.from.id)) {
      await ctx.reply('❌ Solo gli admin possono usare questo comando.');
      return;
    }
    
    const text = ctx.message.text.split(' ');
    if (text.length < 2) {
      await ctx.reply('⚠️ Formato: /check_membership @username o ID');
      return;
    }
    
    let targetUserId;
    const target = text[1].replace('@', '');
    
    if (/^\d+$/.test(target)) {
      targetUserId = parseInt(target);
    } else {
      // Cerca l'utente per username
      const user = await User.findOne({ username: target });
      if (!user) {
        await ctx.reply(`❌ Utente @${target} non trovato nel database.`);
        return;
      }
      targetUserId = user.userId;
    }
    
    const verification = await verifyUserMembership(targetUserId, true); // Forza il controllo
    
    let report = `👤 <b>Report Membership</b>\n\n`;
    report += `<b>Utente:</b> ${targetUserId}\n`;
    report += `<b>Autorizzato:</b> ${verification.isAuthorized ? '✅ Sì' : '❌ No'}\n`;
    report += `<b>Membro VIP:</b> ${verification.isVipMember ? '👑 Sì' : '❌ No'}\n`;
    report += `<b>Cache:</b> ${verification.cached ? 'Sì' : 'Controllo live'}\n`;
    report += `<b>Gruppi controllati:</b> ${verification.checkedGroups}\n\n`;
    
    if (verification.memberOf && verification.memberOf.length > 0) {
      report += `<b>Membro di gruppi:</b>\n`;
      verification.memberOf.forEach(groupId => {
        const isVip = groupId === parseInt(process.env.VIP_GROUP_ID);
        const vipIcon = isVip ? '👑 ' : '';
        report += `• ${vipIcon}Gruppo ${groupId}\n`;
      });
    }
    
    if (verification.allResults && verification.allResults.length > 0) {
      report += `\n<b>Dettaglio completo:</b>\n`;
      verification.allResults.forEach(result => {
        const statusIcon = result.isAuthorized ? '✅' : '❌';
        const vipIcon = result.isVip ? '👑 ' : '';
        report += `${statusIcon} ${vipIcon}Gruppo ${result.groupId}: ${result.status}\n`;
        if (result.error) {
          report += `   └ Errore: ${result.error}\n`;
        }
      });
    }
    
    if (verification.error) {
      report += `\n⚠️ <b>Errore:</b> ${verification.error}`;
    }
    
    await ctx.reply(report, { parse_mode: 'HTML' });
    
  } catch (err) {
    logger.error('Errore nel comando check_membership:', err);
    await ctx.reply('❌ Errore durante la verifica.');
  }
};

/**
 * Comando admin per testare la configurazione dei gruppi
 * @param {Object} ctx - Contesto Telegraf  
 */
const testGroupConfigCommand = async (ctx) => {
  try {
    const { isAdmin } = require('../config/admin');
    
    if (!isAdmin(ctx.from.id)) {
      await ctx.reply('❌ Solo gli admin possono usare questo comando.');
      return;
    }
    
    const AUTHORIZED_GROUPS = getAuthorizedGroups();
    
    let report = `🔧 <b>Configurazione Gruppi</b>\n\n`;
    report += `<b>Gruppi autorizzati configurati:</b> ${AUTHORIZED_GROUPS.length}\n\n`;
    
    if (AUTHORIZED_GROUPS.length === 0) {
      report += '⚠️ <b>Nessun gruppo configurato!</b>\n';
      report += 'Il sistema permetterà l\'accesso a tutti gli utenti.\n\n';
      report += 'Configura le variabili d\'ambiente:\n';
      report += '• SELL_GROUPS_CONFIG\n';
      report += '• BUY_GROUPS_CONFIG\n';
      report += '• VIP_GROUP_ID\n';
      report += '• VERIFICATION_GROUP_ID (opzionale)';
    } else {
      for (let i = 0; i < AUTHORIZED_GROUPS.length; i++) {
        const groupId = AUTHORIZED_GROUPS[i];
        const isVipGroup = groupId === parseInt(process.env.VIP_GROUP_ID);
        const vipLabel = isVipGroup ? ' 👑 VIP' : '';
        
        report += `<b>${i + 1}. Gruppo ${groupId}${vipLabel}</b>\n`;
        
        try {
          // Testa l'accesso al gruppo
          const chat = await bot.telegram.getChat(groupId);
          report += `✅ Accessibile: ${chat.title || 'Nome non disponibile'}\n`;
          report += `   Tipo: ${chat.type}\n`;
          
          if (chat.username) {
            report += `   Username: @${chat.username}\n`;
          }
          
          // Verifica se il bot è admin nel gruppo
          const botInfo = await bot.telegram.getMe();
          const botMember = await bot.telegram.getChatMember(groupId, botInfo.id);
          report += `   Bot status: ${botMember.status}\n`;
          
          if (isVipGroup) {
            report += `   🎯 <b>Funzione:</b> Gruppo VIP per venditori verificati\n`;
          }
          
        } catch (groupErr) {
          report += `❌ Errore: ${groupErr.description || groupErr.message}\n`;
        }
        
        report += '\n';
      }
    }
    
    await ctx.reply(report, { parse_mode: 'HTML' });
    
  } catch (err) {
    logger.error('Errore nel comando test_group_config:', err);
    await ctx.reply('❌ Errore durante il test della configurazione.');
  }
};

module.exports = {
  verifyUserMembership,
  membershipMiddleware,
  checkUserMembershipCommand,
  testGroupConfigCommand,
  getAuthorizedGroups
};
