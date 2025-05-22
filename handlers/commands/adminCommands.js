// handlers/commands/adminCommands.js
// Comandi amministrativi per sicurezza e whitelist

const { isAdmin, isMainAdmin } = require('../../config/admin');
const whitelistService = require('../../services/whitelistService');
const securityService = require('../../services/securityService');
const memberVerificationService = require('../../services/memberVerificationService');
const User = require('../../models/user');
const logger = require('../../utils/logger');

/**
 * Comando /admin_help - Mostra i comandi admin disponibili
 */
const adminHelpCommand = async (ctx) => {
  try {
    if (!isAdmin(ctx.from.id)) {
      await ctx.reply('❌ Solo gli admin possono usare questo comando.');
      return;
    }
    
    let helpText = `🛡️ <b>Comandi Amministratore</b>\n\n`;
    
    helpText += `<b>📋 Gestione Whitelist:</b>\n`;
    helpText += `/manage_whitelist list - Lista utenti approvati\n`;
    helpText += `/manage_whitelist add @user - Approva utente\n`;
    helpText += `/manage_whitelist remove @user - Rimuovi utente\n`;
    helpText += `/manage_whitelist check @user - Controlla status\n\n`;
    
    helpText += `<b>🔍 Sicurezza:</b>\n`;
    helpText += `/analyze_security @user - Analizza rischio utente\n`;
    helpText += `/security_stats - Statistiche sicurezza\n`;
    helpText += `/suspicious_users - Lista utenti sospetti\n\n`;
    
    helpText += `<b>👥 Membership:</b>\n`;
    helpText += `/check_membership @user - Verifica membership\n`;
    helpText += `/test_group_config - Testa configurazione gruppi\n`;
    helpText += `/membership_stats - Statistiche membership\n\n`;
    
    if (isMainAdmin(ctx.from.id)) {
      helpText += `<b>⚙️ Sistema (Solo Admin Principale):</b>\n`;
      helpText += `/system_status - Status completo del sistema\n`;
      helpText += `/force_membership_check - Forza controllo membership\n`;
      helpText += `/admin_config - Configurazione amministratori\n\n`;
    }
    
    helpText += `<b>📊 Report:</b>\n`;
    helpText += `/user_stats - Statistiche utenti\n`;
    helpText += `/daily_report - Report giornaliero\n`;
    
    await ctx.reply(helpText, { parse_mode: 'HTML' });
    
  } catch (err) {
    logger.error('Errore nel comando admin_help:', err);
    await ctx.reply('❌ Errore durante il caricamento dei comandi admin.');
  }
};

/**
 * Comando /security_stats - Statistiche di sicurezza
 */
const securityStatsCommand = async (ctx) => {
  try {
    if (!isAdmin(ctx.from.id)) {
      await ctx.reply('❌ Solo gli admin possono usare questo comando.');
      return;
    }
    
    // Conteggi vari
    const totalUsers = await User.countDocuments();
    const whitelistedUsers = await User.countDocuments({ isWhitelisted: true });
    const blockedUsers = await User.countDocuments({ isBlocked: true });
    const vipUsers = await User.countDocuments({ isVipMember: true });
    
    // Utenti con flag di sicurezza
    const usersWithFlags = await User.countDocuments({ 
      'securityFlags.0': { $exists: true } 
    });
    
    // Utenti ad alto rischio
    const highRiskUsers = await User.countDocuments({ riskLevel: 'high' });
    const mediumRiskUsers = await User.countDocuments({ riskLevel: 'medium' });
    
    // Registrazioni ultime 24 ore
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const newUsersToday = await User.countDocuments({ 
      registrationDate: { $gte: yesterday } 
    });
    
    let report = `📊 <b>Statistiche Sicurezza</b>\n\n`;
    
    report += `<b>👥 Utenti Totali:</b> ${totalUsers}\n`;
    report += `<b>✅ Whitelist:</b> ${whitelistedUsers} (${((whitelistedUsers/totalUsers)*100).toFixed(1)}%)\n`;
    report += `<b>🚫 Bloccati:</b> ${blockedUsers} (${((blockedUsers/totalUsers)*100).toFixed(1)}%)\n`;
    report += `<b>👑 VIP:</b> ${vipUsers}\n\n`;
    
    report += `<b>⚠️ Sicurezza:</b>\n`;
    report += `<b>🔴 Alto Rischio:</b> ${highRiskUsers}\n`;
    report += `<b>🟡 Medio Rischio:</b> ${mediumRiskUsers}\n`;
    report += `<b>🚨 Con Flag:</b> ${usersWithFlags}\n\n`;
    
    report += `<b>📈 Attività:</b>\n`;
    report += `<b>Nuovi oggi:</b> ${newUsersToday}\n`;
    
    // Ultimi utenti ad alto rischio
    const recentHighRisk = await User.find({ riskLevel: 'high' })
      .sort({ registrationDate: -1 })
      .limit(3)
      .select('userId firstName username registrationDate');
    
    if (recentHighRisk.length > 0) {
      report += `\n<b>🔴 Ultimi Alto Rischio:</b>\n`;
      recentHighRisk.forEach(user => {
        report += `• ${user.firstName} (${user.userId}) - ${user.registrationDate.toLocaleDateString('it-IT')}\n`;
      });
    }
    
    await ctx.reply(report, { parse_mode: 'HTML' });
    
  } catch (err) {
    logger.error('Errore nel comando security_stats:', err);
    await ctx.reply('❌ Errore durante il caricamento delle statistiche.');
  }
};

/**
 * Comando /suspicious_users - Lista utenti sospetti
 */
const suspiciousUsersCommand = async (ctx) => {
  try {
    if (!isAdmin(ctx.from.id)) {
      await ctx.reply('❌ Solo gli admin possono usare questo comando.');
      return;
    }
    
    // Trova utenti sospetti (alto rischio + non in whitelist)
    const suspiciousUsers = await User.find({
      $and: [
        { riskLevel: { $in: ['high', 'medium'] } },
        { isWhitelisted: false },
        { isBlocked: false }
      ]
    })
    .sort({ riskScore: -1 })
    .limit(10)
    .select('userId firstName lastName username riskScore riskLevel registrationDate securityFlags');
    
    if (suspiciousUsers.length === 0) {
      await ctx.reply('✅ <b>Nessun utente sospetto trovato</b>\n\nTutti gli utenti ad alto rischio sono stati gestiti.', { parse_mode: 'HTML' });
      return;
    }
    
    let report = `🚨 <b>Utenti Sospetti (${suspiciousUsers.length})</b>\n\n`;
    
    suspiciousUsers.forEach((user, index) => {
      const riskIcon = user.riskLevel === 'high' ? '🔴' : '🟡';
      const name = user.firstName + (user.lastName ? ` ${user.lastName}` : '');
      const username = user.username ? `@${user.username}` : 'N/A';
      
      report += `${riskIcon} <b>${index + 1}. ${name}</b>\n`;
      report += `   ID: ${user.userId}\n`;
      report += `   Username: ${username}\n`;
      report += `   Rischio: ${user.riskScore}/10 (${user.riskLevel})\n`;
      report += `   Registrato: ${user.registrationDate.toLocaleDateString('it-IT')}\n`;
      
      if (user.securityFlags && user.securityFlags.length > 0) {
        report += `   Flags: ${user.securityFlags.length}\n`;
      }
      
      report += '\n';
    });
    
    report += `🔍 <b>Azioni disponibili:</b>\n`;
    report += `• /analyze_security [ID] - Analisi dettagliata\n`;
    report += `• /manage_whitelist add [ID] - Approva utente\n`;
    
    await ctx.reply(report, { parse_mode: 'HTML' });
    
  } catch (err) {
    logger.error('Errore nel comando suspicious_users:', err);
    await ctx.reply('❌ Errore durante il caricamento degli utenti sospetti.');
  }
};

/**
 * Comando /membership_stats - Statistiche membership
 */
const membershipStatsCommand = async (ctx) => {
  try {
    if (!isAdmin(ctx.from.id)) {
      await ctx.reply('❌ Solo gli admin possono usare questo comando.');
      return;
    }
    
    const authorizedGroups = memberVerificationService.getAuthorizedGroups();
    
    let report = `👥 <b>Statistiche Membership</b>\n\n`;
    
    report += `<b>Gruppi Configurati:</b> ${authorizedGroups.length}\n`;
    
    if (authorizedGroups.length === 0) {
      report += `\n⚠️ <b>Nessun gruppo configurato!</b>\n`;
      report += `Il controllo membership è disabilitato.\n\n`;
      report += `Configura le variabili d'ambiente per abilitare i controlli.`;
    } else {
      report += `\n<b>Gruppi Autorizzati:</b>\n`;
      
      for (const groupId of authorizedGroups) {
        const isVip = groupId === parseInt(process.env.VIP_GROUP_ID);
        const label = isVip ? '👑 VIP' : '📋 Standard';
        
        try {
          const { bot } = require('../../config/bot');
          const chat = await bot.telegram.getChat(groupId);
          report += `• ${label} ${groupId}: ${chat.title || 'N/A'}\n`;
        } catch {
          report += `• ${label} ${groupId}: ❌ Non accessibile\n`;
        }
      }
      
      // Statistiche utenti autorizzati
      const usersWithMembership = await User.countDocuments({
        authorizedGroups: { $exists: true, $ne: [] }
      });
      
      const vipMembers = await User.countDocuments({ isVipMember: true });
      
      report += `\n<b>📊 Statistiche:</b>\n`;
      report += `• Utenti autorizzati: ${usersWithMembership}\n`;
      report += `• Membri VIP: ${vipMembers}\n`;
      
      // Controlli recenti
      const recentChecks = await User.countDocuments({
        lastMembershipCheck: { 
          $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) 
        }
      });
      
      report += `• Controlli 24h: ${recentChecks}\n`;
    }
    
    await ctx.reply(report, { parse_mode: 'HTML' });
    
  } catch (err) {
    logger.error('Errore nel comando membership_stats:', err);
    await ctx.reply('❌ Errore durante il caricamento delle statistiche membership.');
  }
};

/**
 * Comando /user_stats - Statistiche generali utenti
 */
const userStatsCommand = async (ctx) => {
  try {
    if (!isAdmin(ctx.from.id)) {
      await ctx.reply('❌ Solo gli admin possono usare questo comando.');
      return;
    }
    
    const totalUsers = await User.countDocuments();
    const activeUsers = await User.countDocuments({
      $or: [
        { 'activeAnnouncements.sell': { $ne: null } },
        { 'activeAnnouncements.buy': { $ne: null } }
      ]
    });
    
    // Utenti con transazioni
    const usersWithTransactions = await User.countDocuments({
      'transactions.0': { $exists: true }
    });
    
    // Utenti per periodo di registrazione
    const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const lastMonth = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    
    const newUsersWeek = await User.countDocuments({
      registrationDate: { $gte: lastWeek }
    });
    
    const newUsersMonth = await User.countDocuments({
      registrationDate: { $gte: lastMonth }
    });
    
    let report = `📊 <b>Statistiche Utenti</b>\n\n`;
    
    report += `<b>👥 Totale Utenti:</b> ${totalUsers}\n`;
    report += `<b>🟢 Attivi:</b> ${activeUsers} (${((activeUsers/totalUsers)*100).toFixed(1)}%)\n`;
    report += `<b>💱 Con Transazioni:</b> ${usersWithTransactions} (${((usersWithTransactions/totalUsers)*100).toFixed(1)}%)\n\n`;
    
    report += `<b>📈 Crescita:</b>\n`;
    report += `• Ultima settimana: ${newUsersWeek}\n`;
    report += `• Ultimo mese: ${newUsersMonth}\n\n`;
    
    // Top utenti per transazioni
    const topUsers = await User.find({
      totalRatings: { $gt: 0 }
    })
    .sort({ totalRatings: -1 })
    .limit(5)
    .select('firstName username totalRatings positiveRatings');
    
    if (topUsers.length > 0) {
      report += `<b>🏆 Top Utenti (per feedback):</b>\n`;
      topUsers.forEach((user, index) => {
        const name = user.firstName;
        const username = user.username ? `@${user.username}` : '';
        const percentage = user.totalRatings > 0 ? Math.round((user.positiveRatings / user.totalRatings) * 100) : 0;
        
        report += `${index + 1}. ${name} ${username}\n`;
        report += `   📊 ${user.positiveRatings}/${user.totalRatings} (${percentage}%)\n`;
      });
    }
    
    await ctx.reply(report, { parse_mode: 'HTML' });
    
  } catch (err) {
    logger.error('Errore nel comando user_stats:', err);
    await ctx.reply('❌ Errore durante il caricamento delle statistiche utenti.');
  }
};

/**
 * Comando /system_status - Status completo del sistema (solo main admin)
 */
const systemStatusCommand = async (ctx) => {
  try {
    if (!isMainAdmin(ctx.from.id)) {
      await ctx.reply('❌ Solo l\'amministratore principale può usare questo comando.');
      return;
    }
    
    let report = `⚙️ <b>Status Sistema FairCharge Pro</b>\n\n`;
    
    // Status database
    try {
      const totalUsers = await User.countDocuments();
      report += `✅ <b>Database:</b> Connesso (${totalUsers} utenti)\n`;
    } catch {
      report += `❌ <b>Database:</b> Errore connessione\n`;
    }
    
    // Status gruppi
    const authorizedGroups = memberVerificationService.getAuthorizedGroups();
    if (authorizedGroups.length > 0) {
      report += `✅ <b>Gruppi:</b> ${authorizedGroups.length} configurati\n`;
    } else {
      report += `⚠️ <b>Gruppi:</b> Nessuno configurato\n`;
    }
    
    // Status VIP
    if (process.env.VIP_GROUP_ID) {
      report += `✅ <b>Gruppo VIP:</b> Configurato\n`;
    } else {
      report += `⚠️ <b>Gruppo VIP:</b> Non configurato\n`;
    }
    
    // Configurazione admin
    const { checkAdminConfig } = require('../../config/admin');
    const adminConfig = checkAdminConfig();
    
    if (adminConfig.isConfigured) {
      report += `✅ <b>Admin:</b> ${adminConfig.totalAdmins} configurati\n`;
    } else {
      report += `❌ <b>Admin:</b> Non configurato\n`;
    }
    
    // Statistiche rapide
    const blockedUsers = await User.countDocuments({ isBlocked: true });
    const highRiskUsers = await User.countDocuments({ riskLevel: 'high' });
    
    report += `\n<b>🔒 Sicurezza:</b>\n`;
    report += `• Utenti bloccati: ${blockedUsers}\n`;
    report += `• Alto rischio: ${highRiskUsers}\n`;
    
    // Avvertimenti
    if (adminConfig.warnings.length > 0) {
      report += `\n⚠️ <b>Avvertimenti:</b>\n`;
      adminConfig.warnings.forEach(warning => {
        report += `• ${warning}\n`;
      });
    }
    
    // Uptime (approssimativo)
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    
    report += `\n<b>🕒 Uptime:</b> ${hours}h ${minutes}m\n`;
    report += `<b>📅 Ultimo restart:</b> ${new Date(Date.now() - uptime * 1000).toLocaleString('it-IT')}`;
    
    await ctx.reply(report, { parse_mode: 'HTML' });
    
  } catch (err) {
    logger.error('Errore nel comando system_status:', err);
    await ctx.reply('❌ Errore durante il caricamento dello status sistema.');
  }
};

module.exports = {
  adminHelpCommand,
  securityStatsCommand,
  suspiciousUsersCommand,
  membershipStatsCommand,
  userStatsCommand,
  systemStatusCommand
};
