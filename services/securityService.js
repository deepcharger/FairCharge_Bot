// services/securityService.js
// Servizio avanzato per prevenire abusi e account multipli

const User = require('../models/user');
const logger = require('../utils/logger');
const { isAdmin } = require('../config/admin');

/**
 * Rileva potenziali account duplicati o sospetti
 * @param {Object} userInfo - Informazioni utente da Telegram
 * @returns {Promise<Object>} Risultato dell'analisi di sicurezza
 */
const detectSuspiciousActivity = async (userInfo) => {
  try {
    const suspiciousFlags = [];
    let finalRiskScore = 0;
    
    // 1. Verifica account molto recenti (meno di 30 giorni)
    // L'ID Telegram contiene timestamp, possiamo stimare l'età dell'account
    const currentTime = Math.floor(Date.now() / 1000);
    const estimatedAccountAge = currentTime - (userInfo.id * 4); // Stima approssimativa
    const thirtyDaysAgo = currentTime - (30 * 24 * 60 * 60);
    
    if (estimatedAccountAge > thirtyDaysAgo) {
      suspiciousFlags.push({
        type: 'new_account',
        severity: 'medium',
        description: 'Account Telegram potenzialmente recente',
        points: 3
      });
      finalRiskScore += 3;
    }
    
    // 2. Verifica pattern nei nomi sospetti
    const firstName = userInfo.first_name || '';
    const lastName = userInfo.last_name || '';
    const username = userInfo.username || '';
    
    // Pattern comuni di bot/fake accounts
    const suspiciousPatterns = [
      /^[A-Z][a-z]+\d{3,}$/, // Nome + numeri (es: Mario123456)
      /^User\d+/i,           // User123456
      /^\w{1,3}\d{5,}$/,     // Lettere corte + molti numeri
      /^[A-Za-z]+_[A-Za-z]+_\d+$/, // Name_Surname_123
      /^[A-Za-z]+\d{4,}$/,   // Nome seguito da 4+ numeri
    ];
    
    const fullName = `${firstName} ${lastName} ${username}`.toLowerCase();
    const hasPattern = suspiciousPatterns.some(pattern => 
      pattern.test(firstName) || pattern.test(lastName) || pattern.test(username)
    );
    
    if (hasPattern) {
      suspiciousFlags.push({
        type: 'suspicious_name_pattern',
        severity: 'medium',
        description: 'Pattern nel nome tipico di account automatici',
        points: 2
      });
      finalRiskScore += 2;
    }
    
    // 3. Verifica account senza username
    if (!username) {
      suspiciousFlags.push({
        type: 'no_username',
        severity: 'low',
        description: 'Account senza username (più difficile da tracciare)',
        points: 1
      });
      finalRiskScore += 1;
    }
    
    // 4. Verifica account con nomi molto simili a utenti esistenti
    const existingUsers = await User.find({
      $or: [
        { firstName: new RegExp(firstName, 'i') },
        { username: new RegExp(username, 'i') }
      ]
    }).limit(10);
    
    const similarUsers = existingUsers.filter(u => {
      if (u.userId === userInfo.id) return false; // Stesso utente
      
      const similarity = calculateSimilarity(
        `${u.firstName} ${u.lastName} ${u.username}`.toLowerCase(),
        fullName
      );
      
      return similarity > 0.8; // 80% di similarità
    });
    
    if (similarUsers.length > 0) {
      suspiciousFlags.push({
        type: 'similar_existing_users',
        severity: 'high',
        description: `Nome molto simile a ${similarUsers.length} utenti esistenti`,
        points: 5,
        relatedUsers: similarUsers.map(u => u.userId)
      });
      finalRiskScore += 5;
    }
    
    // 5. Verifica per blacklist di parole/pattern
    const blacklistedWords = [
      'bot', 'fake', 'test', 'spam', 'prova', 'temp', 'temporary',
      'delete', 'banned', 'block', 'removed', 'clone', 'copy'
    ];
    
    const hasBlacklistedWord = blacklistedWords.some(word => 
      fullName.includes(word.toLowerCase())
    );
    
    if (hasBlacklistedWord) {
      suspiciousFlags.push({
        type: 'blacklisted_words',
        severity: 'high',
        description: 'Nome contiene parole in blacklist',
        points: 4
      });
      finalRiskScore += 4;
    }
    
    // 6. Verifica nomi troppo corti o generici
    if (firstName.length <= 2 || (firstName.length <= 4 && /^\w+\d+$/.test(firstName))) {
      suspiciousFlags.push({
        type: 'generic_name',
        severity: 'medium',
        description: 'Nome troppo corto o generico',
        points: 2
      });
      finalRiskScore += 2;
    }
    
    // Determina livello di rischio
    let riskLevel = 'low';
    if (finalRiskScore >= 7) {
      riskLevel = 'high';
    } else if (finalRiskScore >= 4) {
      riskLevel = 'medium';
    }
    
    return {
      userId: userInfo.id,
      riskScore: finalRiskScore,
      riskLevel,
      flags: suspiciousFlags,
      requiresReview: riskLevel === 'high',
      allowAccess: riskLevel !== 'high' // Blocca solo rischio alto
    };
    
  } catch (err) {
    logger.error('Errore nell\'analisi di sicurezza:', err);
    return {
      userId: userInfo.id,
      riskScore: 0,
      riskLevel: 'unknown',
      flags: [],
      requiresReview: false,
      allowAccess: true, // In caso di errore, permetti l'accesso
      error: err.message
    };
  }
};

/**
 * Calcola la similarità tra due stringhe
 * @param {String} str1 
 * @param {String} str2 
 * @returns {Number} Valore da 0 a 1
 */
const calculateSimilarity = (str1, str2) => {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  
  if (longer.length === 0) return 1.0;
  
  const editDistance = levenshteinDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
};

/**
 * Calcola la distanza di Levenshtein tra due stringhe
 */
const levenshteinDistance = (str1, str2) => {
  const matrix = [];
  
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[str2.length][str1.length];
};

/**
 * Middleware di sicurezza per nuovi utenti
 */
const securityMiddleware = () => {
  return async (ctx, next) => {
    try {
      // Controlla se l'utente esiste già
      const existingUser = await User.findOne({ userId: ctx.from.id });
      
      if (!existingUser) {
        // Nuovo utente - esegui controlli di sicurezza
        const securityCheck = await detectSuspiciousActivity(ctx.from);
        
        // Log dell'analisi di sicurezza
        logger.info(`Analisi sicurezza per nuovo utente ${ctx.from.id}`, {
          userId: ctx.from.id,
          username: ctx.from.username,
          riskScore: securityCheck.riskScore,
          riskLevel: securityCheck.riskLevel,
          flags: securityCheck.flags.length
        });
        
        // Se richiede revisione, notifica admin
        if (securityCheck.requiresReview) {
          await notifyAdminSuspiciousUser(ctx.from, securityCheck);
        }
        
        // Se il rischio è alto, blocca l'accesso
        if (!securityCheck.allowAccess) {
          await ctx.reply(
            '🚫 <b>Registrazione temporaneamente bloccata</b>\n\n' +
            'Il tuo account richiede una verifica manuale.\n' +
            'Un amministratore esaminerà la tua richiesta entro 24 ore.\n\n' +
            'Se pensi che questo sia un errore, contatta il supporto.',
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
        
        // Salva l'analisi di sicurezza nel database
        ctx.securityAnalysis = securityCheck;
      }
      
      return next();
      
    } catch (err) {
      logger.error('Errore nel middleware di sicurezza:', err);
      return next(); // In caso di errore, permetti l'accesso
    }
  };
};

/**
 * Notifica agli admin di un utente sospetto
 */
const notifyAdminSuspiciousUser = async (userInfo, securityCheck) => {
  try {
    const { bot } = require('../config/bot');
    const { ADMIN_USER_ID, getAllAdmins } = require('../config/admin');
    
    const adminIds = getAllAdmins();
    if (adminIds.length === 0) return;
    
    let message = `⚠️ <b>Utente sospetto rilevato</b>\n\n`;
    message += `<b>Utente:</b> ${userInfo.first_name || 'N/A'}`;
    if (userInfo.last_name) message += ` ${userInfo.last_name}`;
    message += `\n<b>Username:</b> ${userInfo.username ? '@' + userInfo.username : 'N/A'}`;
    message += `\n<b>ID:</b> ${userInfo.id}`;
    message += `\n<b>Rischio:</b> ${securityCheck.riskScore}/10 (${securityCheck.riskLevel})`;
    
    if (securityCheck.flags.length > 0) {
      message += `\n\n<b>Segnalazioni:</b>`;
      securityCheck.flags.forEach(flag => {
        const icon = flag.severity === 'high' ? '🔴' : flag.severity === 'medium' ? '🟡' : '🟢';
        message += `\n${icon} ${flag.description}`;
      });
    }
    
    const keyboard = {
      inline_keyboard: [
        [
          { text: '✅ Approva', callback_data: `approve_user_${userInfo.id}` },
          { text: '❌ Blocca', callback_data: `block_user_${userInfo.id}` }
        ],
        [
          { text: '👑 Approva + VIP', callback_data: `approve_vip_user_${userInfo.id}` }
        ],
        [
          { text: '🔍 Dettagli', callback_data: `user_details_${userInfo.id}` }
        ]
      ]
    };
    
    // Invia notifica a tutti gli admin
    for (const adminId of adminIds) {
      try {
        await bot.telegram.sendMessage(adminId, message, {
          parse_mode: 'HTML',
          reply_markup: keyboard
        });
      } catch (sendErr) {
        logger.warn(`Impossibile notificare admin ${adminId}:`, sendErr);
      }
    }
    
  } catch (err) {
    logger.error('Errore nella notifica admin per utente sospetto:', err);
  }
};

/**
 * Comando admin per analizzare la sicurezza di un utente
 */
const analyzeUserSecurityCommand = async (ctx) => {
  try {
    if (!isAdmin(ctx.from.id)) {
      await ctx.reply('❌ Solo gli admin possono usare questo comando.');
      return;
    }
    
    const text = ctx.message.text.split(' ');
    if (text.length < 2) {
      await ctx.reply('⚠️ Formato: /analyze_security @username o ID');
      return;
    }
    
    let targetUserId;
    const target = text[1].replace('@', '');
    
    if (/^\d+$/.test(target)) {
      targetUserId = parseInt(target);
    } else {
      const user = await User.findOne({ username: target });
      if (!user) {
        await ctx.reply(`❌ Utente @${target} non trovato.`);
        return;
      }
      targetUserId = user.userId;
    }
    
    // Trova l'utente nel database
    const user = await User.findOne({ userId: targetUserId });
    if (!user) {
      await ctx.reply('❌ Utente non trovato nel database.');
      return;
    }
    
    // Simula i dati Telegram per l'analisi
    const telegramUserInfo = {
      id: user.userId,
      first_name: user.firstName,
      last_name: user.lastName,
      username: user.username
    };
    
    const analysis = await detectSuspiciousActivity(telegramUserInfo);
    
    let report = `🔍 <b>Analisi Sicurezza Utente</b>\n\n`;
    report += `<b>Utente:</b> ${user.firstName}`;
    if (user.lastName) report += ` ${user.lastName}`;
    report += `\n<b>ID:</b> ${user.userId}`;
    report += `\n<b>Username:</b> ${user.username ? '@' + user.username : 'N/A'}`;
    report += `\n<b>Registrato il:</b> ${user.registrationDate.toLocaleDateString('it-IT')}`;
    report += `\n<b>Status Whitelist:</b> ${user.isWhitelisted ? '✅ Approvato' : '❌ Standard'}`;
    
    report += `\n\n<b>🔒 Analisi Rischio:</b>`;
    report += `\n<b>Punteggio:</b> ${analysis.riskScore}/10`;
    report += `\n<b>Livello:</b> ${analysis.riskLevel.toUpperCase()}`;
    report += `\n<b>Accesso:</b> ${analysis.allowAccess ? '✅ Permesso' : '❌ Bloccato'}`;
    
    if (analysis.flags.length > 0) {
      report += `\n\n<b>⚠️ Segnalazioni (${analysis.flags.length}):</b>`;
      analysis.flags.forEach(flag => {
        const icon = flag.severity === 'high' ? '🔴' : flag.severity === 'medium' ? '🟡' : '🟢';
        report += `\n${icon} ${flag.description} (+${flag.points} pts)`;
        
        if (flag.relatedUsers) {
          report += `\n   └ Utenti simili: ${flag.relatedUsers.length}`;
        }
      });
    } else {
      report += `\n\n✅ <b>Nessuna segnalazione trovata</b>`;
    }
    
    await ctx.reply(report, { parse_mode: 'HTML' });
    
  } catch (err) {
    logger.error('Errore nel comando analyze_security:', err);
    await ctx.reply('❌ Errore durante l\'analisi.');
  }
};

module.exports = {
  detectSuspiciousActivity,
  securityMiddleware,
  analyzeUserSecurityCommand,
  notifyAdminSuspiciousUser
};
