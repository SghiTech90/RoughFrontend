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
const apiUrl = `http://${localIp}:${port}/api`;
const mobileConfigPath = path.join(__dirname, '..', 'mobile', 'src', 'config', 'api.js');
const webEnvPath = path.join(__dirname, '..', 'web', '.env');

const mobileContent = `const API_BASE_URL = '${apiUrl}';
// Automatically updated by scripts/update-ip.js

export default API_BASE_URL;
`;

const webEnvContent = `VITE_API_URL=${apiUrl}
`;

try {
  fs.writeFileSync(mobileConfigPath, mobileContent);
  if (fs.existsSync(path.join(__dirname, '..', 'web'))) {
    fs.writeFileSync(webEnvPath, webEnvContent);
    console.log(`Updated web/.env VITE_API_URL to: ${apiUrl}`);
  }
  console.log(`Successfully updated API_BASE_URL to: ${apiUrl}`);
} catch (error) {
  console.error('Error updating config file:', error);
  process.exit(1);
}

