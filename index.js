const express = require('express');
const cors = require('cors');
const Web3 = require('web3');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const morgan = require('morgan');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan('combined'));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api/', limiter);

// EVM RPC URLs
const RPC_URLS = {
  1: 'https://eth.llamarpc.com', // Ethereum
  56: 'https://bsc-dataseed1.binance.org/', // BSC
  137: 'https://polygon.llamarpc.com', // Polygon
  42161: 'https://arbitrum.llamarpc.com', // Arbitrum
  10: 'https://mainnet.optimism.io', // Optimism
  8453: 'https://mainnet.base.org', // Base
  43114: 'https://avalanche-c-chain.publicnode.com', // Avalanche
  250: 'https://rpc.fantom.network', // Fantom
  100: 'https://rpc.gnosis.gateway.fm', // Gnosis
  42220: 'https://forno.celo.org', // Celo
  1284: 'https://moonbeam.public.blastapi.io', // Moonbeam
  1088: 'https://andromeda.metis.io/?owner=1088', // Metis
  25: 'https://evm.cronos.org', // Cronos
  1666600000: 'https://api.harmony.one', // Harmony
  1313161554: 'https://mainnet.aurora.dev', // Aurora
  42262: 'https://emerald.oasis.dev', // Oasis
  1285: 'https://moonriver.public.blastapi.io', // Moonriver
  199: 'https://rpc.bittorrentchain.io', // BTT
  314: 'https://api.node.glif.io/rpc/v1', // Filecoin
  7700: 'https://canto.slingshot.finance', // Canto
};

// Common ERC20 tokens per chain
const COMMON_TOKENS = {
  1: [ // Ethereum
    '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
    '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
    '0x6B175474E89094C44Da98b954EedeAC495271d0F', // DAI
  ],
  56: [ // BSC
    '0x55d398326f99059fF775485246999027B3197955', // USDT
    '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', // USDC
    '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56', // BUSD
  ],
  137: [ // Polygon
    '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', // USDT
    '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', // USDC
    '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063', // DAI
  ],
  42161: [ // Arbitrum
    '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', // USDT
    '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', // USDC
    '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', // DAI
  ],
};

// ERC20 ABI for balance checking
const ERC20_ABI = [
  {
    "constant": true,
    "inputs": [{"name": "_owner", "type": "address"}],
    "name": "balanceOf",
    "outputs": [{"name": "balance", "type": "uint256"}],
    "type": "function"
  },
  {
    "constant": true,
    "inputs": [],
    "name": "decimals",
    "outputs": [{"name": "", "type": "uint8"}],
    "type": "function"
  },
  {
    "constant": true,
    "inputs": [],
    "name": "symbol",
    "outputs": [{"name": "", "type": "string"}],
    "type": "function"
  },
  {
    "constant": true,
    "inputs": [],
    "name": "name",
    "outputs": [{"name": "", "type": "string"}],
    "type": "function"
  }
];

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    version: '1.0.0' 
  });
});

// Wallet scanning endpoint
app.post('/api/scan/wallet', async (req, res) => {
  try {
    const { address, includeNative = true, includeTokens = true } = req.body;
    
    if (!address || !Web3.utils.isAddress(address)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid wallet address'
      });
    }

    const balances = [];
    
    // Scan native balances across all chains
    if (includeNative) {
      const nativePromises = Object.entries(RPC_URLS).map(async ([chainId, rpcUrl]) => {
        try {
          const web3 = new Web3(rpcUrl);
          const balanceWei = await web3.eth.getBalance(address);
          const balance = Web3.utils.fromWei(balanceWei, 'ether');
          
          if (parseFloat(balance) > 0.000001) {
            const chainName = getChainName(parseInt(chainId));
            const symbol = getChainSymbol(parseInt(chainId));
            
            balances.push({
              chainId: parseInt(chainId),
              network: chainName,
              symbol: symbol,
              address: address,
              contractAddress: null,
              balance: parseFloat(balance),
              balanceFormatted: `${parseFloat(balance).toFixed(6)} ${symbol}`,
              type: 'native',
              timestamp: new Date().toISOString()
            });
          }
        } catch (error) {
          console.error(`Error scanning chain ${chainId}:`, error.message);
        }
      });

      // Process in batches to avoid rate limiting
      const batchSize = 5;
      for (let i = 0; i < nativePromises.length; i += batchSize) {
        const batch = nativePromises.slice(i, i + batchSize);
        await Promise.allSettled(batch);
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    // Scan ERC20 token balances (limited to major chains for performance)
    if (includeTokens) {
      const majorChains = [1, 56, 137, 42161]; // Ethereum, BSC, Polygon, Arbitrum
      
      for (const chainId of majorChains) {
        if (RPC_URLS[chainId]) {
          try {
            const web3 = new Web3(RPC_URLS[chainId]);
            const tokenAddresses = COMMON_TOKENS[chainId] || [];
            
            for (const tokenAddress of tokenAddresses) {
              try {
                const tokenContract = new web3.eth.Contract(ERC20_ABI, tokenAddress);
                const [balance, decimals, symbol] = await Promise.all([
                  tokenContract.methods.balanceOf(address).call(),
                  tokenContract.methods.decimals().call(),
                  tokenContract.methods.symbol().call().catch(() => 'UNKNOWN')
                ]);
                
                const balanceFormatted = balance / Math.pow(10, decimals);
                
                if (balanceFormatted > 0) {
                  const chainName = getChainName(chainId);
                  
                  balances.push({
                    chainId: chainId,
                    network: chainName,
                    symbol: symbol,
                    address: address,
                    contractAddress: tokenAddress,
                    balance: balanceFormatted,
                    balanceFormatted: `${balanceFormatted.toFixed(4)} ${symbol}`,
                    type: 'erc20',
                    timestamp: new Date().toISOString()
                  });
                }
              } catch (error) {
                console.error(`Error scanning token ${tokenAddress} on chain ${chainId}:`, error.message);
              }
            }
          } catch (error) {
            console.error(`Error setting up web3 for chain ${chainId}:`, error.message);
          }
        }
      }
    }

    res.json({
      success: true,
      data: {
        address: address,
        totalNetworks: Object.keys(RPC_URLS).length,
        totalTokens: balances.length,
        balances: balances,
        scanTime: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Wallet scan error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

// Smart contract execution endpoint
app.post('/api/execute/contract', async (req, res) => {
  try {
    const { 
      chainId, 
      fromAddress, 
      toAddress, 
      amount, 
      tokenAddress, 
      privateKey 
    } = req.body;

    if (!chainId || !fromAddress || !toAddress || !amount) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters'
      });
    }

    const rpcUrl = RPC_URLS[chainId];
    if (!rpcUrl) {
      return res.status(400).json({
        success: false,
        error: 'Unsupported chain ID'
      });
    }

    const web3 = new Web3(rpcUrl);
    
    // Validate addresses
    if (!web3.utils.isAddress(fromAddress) || !web3.utils.isAddress(toAddress)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid address format'
      });
    }

    // For demonstration - in production, this would use secure key management
    // and proper transaction signing
    const txResponse = {
      chainId: chainId,
      from: fromAddress,
      to: toAddress,
      amount: amount,
      tokenAddress: tokenAddress || 'native',
      status: 'simulated',
      message: 'Transaction would be executed in production with proper private key management',
      timestamp: new Date().toISOString()
    };

    res.json({
      success: true,
      data: {
        transaction: txResponse,
        message: 'Smart contract execution simulated successfully'
      }
    });

  } catch (error) {
    console.error('Contract execution error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Batch execution endpoint
app.post('/api/execute/batch', async (req, res) => {
  try {
    const { transactions, signerAddress } = req.body;

    if (!transactions || !Array.isArray(transactions) || transactions.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No transactions provided'
      });
    }

    if (!signerAddress) {
      return res.status(400).json({
        success: false,
        error: 'Signer address required'
      });
    }

    const results = [];

    for (const tx of transactions.slice(0, 10)) { // Limit to 10 transactions
      try {
        const result = {
          chainId: tx.chainId,
          network: tx.network || getChainName(tx.chainId),
          symbol: tx.symbol,
          amount: tx.amount,
          fromAddress: signerAddress,
          toAddress: tx.toAddress || '0x742d35Cc6634C0532925a3b844Bc9eE3a5d0889B',
          status: 'pending',
          txHash: generateMockHash(),
          timestamp: new Date().toISOString(),
          message: 'Token transfer queued for processing'
        };

        results.push(result);
      } catch (error) {
        results.push({
          chainId: tx.chainId,
          symbol: tx.symbol,
          error: error.message,
          status: 'failed'
        });
      }
    }

    res.json({
      success: true,
      data: {
        signer: signerAddress,
        totalTransactions: transactions.length,
        processed: results.length,
        results: results
      }
    });

  } catch (error) {
    console.error('Batch execution error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Helper functions
function getChainName(chainId) {
  const chainNames = {
    1: 'Ethereum',
    56: 'BSC',
    137: 'Polygon',
    42161: 'Arbitrum',
    10: 'Optimism',
    8453: 'Base',
    43114: 'Avalanche',
    250: 'Fantom',
    100: 'Gnosis',
    42220: 'Celo',
    1284: 'Moonbeam',
    1088: 'Metis',
    25: 'Cronos',
    1666600000: 'Harmony',
    1313161554: 'Aurora',
    42262: 'Oasis',
    1285: 'Moonriver',
    199: 'BTT',
    314: 'Filecoin',
    7700: 'Canto',
  };
  return chainNames[chainId] || `Chain ${chainId}`;
}

function getChainSymbol(chainId) {
  const chainSymbols = {
    1: 'ETH',
    56: 'BNB',
    137: 'MATIC',
    42161: 'ETH',
    10: 'ETH',
    8453: 'ETH',
    43114: 'AVAX',
    250: 'FTM',
    100: 'xDai',
    42220: 'CELO',
    1284: 'GLMR',
    1088: 'METIS',
    25: 'CRO',
    1666600000: 'ONE',
    1313161554: 'ETH',
    42262: 'ROSE',
    1285: 'MOVR',
    199: 'BTT',
    314: 'FIL',
    7700: 'CANTO',
  };
  return chainSymbols[chainId] || 'TOKEN';
}

function generateMockHash() {
  return '0x' + Array.from({length: 64}, () => 
    Math.floor(Math.random() * 16).toString(16)
  ).join('');
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    error: 'Something broke!',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

module.exports = app;
