const axios = require('axios');

class PriceService {
  constructor() {
    this.cache = new Map();
    this.CACHE_DURATION = 60 * 1000; // 1 minute
  }
  
  async getLivePrices() {
    try {
      // Check cache first
      const cached = this.cache.get('prices');
      if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
        return cached.data;
      }
      
      // Get prices from multiple sources
      let prices = {};
      
      try {
        // Try CoinGecko first
        prices = await this.getCoinGeckoPrices();
      } catch (error) {
        console.log('CoinGecko failed:', error.message);
        
        try {
          // Try DefiLlama as backup
          prices = await this.getDefiLlamaPrices();
        } catch (error2) {
          console.log('DefiLlama failed:', error2.message);
          
          // Use fallback prices
          prices = this.getFallbackPrices();
        }
      }
      
      // Cache the results
      this.cache.set('prices', {
        timestamp: Date.now(),
        data: prices
      });
      
      return prices;
      
    } catch (error) {
      console.error('Price service error:', error);
      return this.getFallbackPrices();
    }
  }
  
  async getCoinGeckoPrices() {
    const coinIds = [
      'bitcoin', 'ethereum', 'binancecoin', 'solana', 'ripple',
      'cardano', 'dogecoin', 'polkadot', 'matic-network', 'tron',
      'litecoin', 'chainlink', 'stellar', 'cosmos', 'monero',
      'ethereum-classic', 'bitcoin-cash', 'filecoin', 'avalanche-2',
      'algorand', 'tezos', 'zcash', 'dash', 'neo', 'eos',
      'maker', 'compound-governance-token', 'aave', 'synthetix-network-token'
    ];
    
    const response = await axios.get(
      'https://api.coingecko.com/api/v3/simple/price',
      {
        params: {
          ids: coinIds.join(','),
          vs_currencies: 'usd'
        },
        timeout: 5000
      }
    );
    
    const prices = {};
    
    // Map CoinGecko IDs to symbols
    const symbolMap = {
      'bitcoin': 'BTC',
      'ethereum': 'ETH',
      'binancecoin': 'BNB',
      'solana': 'SOL',
      'ripple': 'XRP',
      'cardano': 'ADA',
      'dogecoin': 'DOGE',
      'polkadot': 'DOT',
      'matic-network': 'MATIC',
      'tron': 'TRX',
      'litecoin': 'LTC',
      'chainlink': 'LINK',
      'stellar': 'XLM',
      'cosmos': 'ATOM',
      'monero': 'XMR',
      'ethereum-classic': 'ETC',
      'bitcoin-cash': 'BCH',
      'filecoin': 'FIL',
      'avalanche-2': 'AVAX',
      'algorand': 'ALGO',
      'tezos': 'XTZ',
      'zcash': 'ZEC',
      'dash': 'DASH',
      'neo': 'NEO',
      'eos': 'EOS'
    };
    
    Object.entries(response.data).forEach(([coinId, data]) => {
      const symbol = symbolMap[coinId];
      if (symbol && data.usd) {
        prices[symbol] = data.usd;
      }
    });
    
    // Add stablecoins
    prices['USDT'] = 1;
    prices['USDC'] = 1;
    prices['DAI'] = 1;
    prices['BUSD'] = 1;
    
    return prices;
  }
  
  async getDefiLlamaPrices() {
    const response = await axios.get(
      'https://coins.llama.fi/prices/current/coingecko:ethereum,coingecko:bitcoin,coingecko:solana',
      { timeout: 5000 }
    );
    
    const prices = {};
    
    Object.entries(response.data.coins || {}).forEach(([key, data]) => {
      const symbol = key.split(':')[1]?.toUpperCase();
      if (symbol && data.price) {
        prices[symbol] = data.price;
      }
    });
    
    return prices;
  }
  
  getFallbackPrices() {
    // Fallback prices (update as needed)
    return {
      'ETH': 3200,
      'BTC': 45000,
      'BNB': 600,
      'SOL': 100,
      'XRP': 0.6,
      'ADA': 0.5,
      'DOGE': 0.15,
      'DOT': 7,
      'MATIC': 1.2,
      'TRX': 0.12,
      'LTC': 80,
      'LINK': 14,
      'XLM': 0.13,
      'ATOM': 10,
      'XMR': 160,
      'ETC': 25,
      'BCH': 250,
      'FIL': 5,
      'AVAX': 35,
      'ALGO': 0.2,
      'XTZ': 1,
      'ZEC': 25,
      'DASH': 30,
      'NEO': 12,
      'EOS': 0.8,
      'USDT': 1,
      'USDC': 1,
      'DAI': 1,
      'BUSD': 1
    };
  }
  
  async getTokenPrice(symbol) {
    const prices = await this.getLivePrices();
    return prices[symbol.toUpperCase()] || 1;
  }
}

module.exports = new PriceService();