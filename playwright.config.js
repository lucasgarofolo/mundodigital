const { defineConfig } = require('@playwright/test');
const path=require('node:path');
module.exports = defineConfig({
  testDir:'./tests/browser',timeout:180000,workers:1,reporter:'list',
  use:{channel:'chrome',headless:true,viewport:{width:1920,height:1080},baseURL:'http://localhost:3010'},
  webServer:{command:'node tests/helpers/browserServer.js',url:'http://localhost:3010/health',reuseExistingServer:false,
    env:{PORT:'3010',AVATAR_PROVIDER:'local',CLOUDFLARE_ACCOUNT_ID:'',CLOUDFLARE_API_TOKEN:'',DATA_DIR:path.resolve('.test-data',`browser-${process.pid}`)}},
});
