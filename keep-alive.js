const https = require('https');
const url = 'https://tokenbackend-5xab.onrender.com';

function ping() {
  console.log(`Pinging ${url} at ${new Date().toISOString()}`);
  
  https.get(url, (res) => {
    console.log(`Status: ${res.statusCode}`);
  }).on('error', (err) => {
    console.error(`Error: ${err.message}`);
  });
}

// Ping every 5 minutes (300000 ms)
setInterval(ping, 300000);

// Initial ping
ping();

console.log('Keep-alive service started. Pinging every 5 minutes.');
