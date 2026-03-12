const fs = require('fs');
const os = require('os');
const path = require('path');

// Helper to get local IP
function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const interfaceName in interfaces) {
    for (const iface of interfaces[interfaceName]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// Helper to get port from .env
function getPort() {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const portMatch = envContent.match(/^PORT=(\d+)/m);
    if (portMatch) return portMatch[1];
  }
  return '5000'; // Default
}

const localIp = getLocalIp();
const port = getPort();
const configPath = path.join(__dirname, '..', 'mobile', 'src', 'config', 'api.js');

const content = `const API_BASE_URL = 'http://${localIp}:${port}/api';
// Automatically updated by scripts/update-ip.js

export default API_BASE_URL;
`;

try {
  fs.writeFileSync(configPath, content);
  console.log(`Successfully updated API_BASE_URL to: http://${localIp}:${port}/api`);
} catch (error) {
  console.error('Error updating config file:', error);
  process.exit(1);
}

