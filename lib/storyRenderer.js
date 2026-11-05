const fs=require('node:fs/promises');
const {storyHtml}=require('./passView');
function createStoryRenderer({channel=process.env.STORY_BROWSER_CHANNEL||'chrome'}={}){
 let browserPromise;
 return {async render(data,{portraitPath,avatarPath,cssPath,outputPath,signal}={}){
   if(signal?.aborted)throw new Error('STORY_ABORTED');
   const {chromium}=require('playwright');
   browserPromise??=chromium.launch({channel,headless:true}).catch(error=>{browserPromise=null;throw error;});
   const browser=await browserPromise,page=await browser.newPage({viewport:{width:1080,height:1920},deviceScaleFactor:1});
   const cancel=()=>{page.close().catch(()=>{});};signal?.addEventListener('abort',cancel,{once:true});
   try{
    const [css,avatar,portrait]=await Promise.all([fs.readFile(cssPath,'utf8'),fs.readFile(avatarPath),portraitPath?fs.readFile(portraitPath):null]);
    const assets={...data,lpcAvatarUrl:`data:image/png;base64,${avatar.toString('base64')}`,portraitUrl:portrait?`data:image/png;base64,${portrait.toString('base64')}`:null};
    await page.route('**/*',route=>route.abort()); // The export has no external resources or scripts.
    await page.setContent(storyHtml(assets,css),{waitUntil:'load',timeout:30000});
    await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode()));});
    if(signal?.aborted)throw new Error('STORY_ABORTED');
    await page.screenshot({path:outputPath,type:'png',animations:'disabled'});
   }finally{signal?.removeEventListener('abort',cancel);await page.close().catch(()=>{});}
  },async close(){if(browserPromise){const browser=await browserPromise.catch(()=>null);browserPromise=null;await browser?.close();}}};
}
module.exports={createStoryRenderer};
