export const getWalletAddress = async () => {
  const { accounts } = await connectWallet();
  return accounts[0];
};