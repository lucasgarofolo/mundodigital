const fs=require('node:fs/promises');
const {storyHtml}=require('./passView');
const STORY_CODES=new Set(['STORY_RENDER_FAILED','STORY_BROWSER_MISSING','STORY_BROWSER_DEPENDENCIES','STORY_BROWSER_LAUNCH_FAILED','STORY_BROWSER_CLOSED','STORY_RENDER_TIMEOUT','STORY_ASSET_MISSING','STORY_STORAGE_ERROR','STORY_ABORTED']);
const STAGES=new Set(['browser_launch','page_create','asset_read','html_render','image_decode','screenshot','asset_write']);
function storyFailure(error,stage){
 // Inspect errors locally but never forward raw Playwright messages: they can contain
 // HTML, participant data, data URIs, executable paths or host details.
 const message=typeof error?.message==='string'?error.message:'';stage=STAGES.has(error?.stage)?error.stage:STAGES.has(stage)?stage:'html_render';
 const code=STORY_CODES.has(error?.code)?error.code:
  /Executable doesn't exist|executable.*(?:does not exist|not found)|distribution.*not found/i.test(message)?'STORY_BROWSER_MISSING':
  /missing dependencies|error while loading shared libraries|cannot open shared object file/i.test(message)?'STORY_BROWSER_DEPENDENCIES':
  /Target.*(?:closed|crashed)|browser has been closed/i.test(message)?'STORY_BROWSER_CLOSED':
  error?.name==='TimeoutError'?'STORY_RENDER_TIMEOUT':
  error?.code==='ENOENT'?(stage==='asset_read'?'STORY_ASSET_MISSING':'STORY_STORAGE_ERROR'):
  ['EACCES','EPERM','ENOSPC','EROFS','EIO'].includes(error?.code)?'STORY_STORAGE_ERROR':
  stage==='browser_launch'?'STORY_BROWSER_LAUNCH_FAILED':'STORY_RENDER_FAILED';
 return Object.assign(new Error(code),{code,stage});
}
function storyBrowserChannel(env=process.env){return env.STORY_BROWSER_CHANNEL||(env.NODE_ENV==='production'?'chromium':'chrome');}
function createStoryRenderer({channel=storyBrowserChannel(),browserType}={}){
 let browserPromise;
 return {async render(data,{portraitPath,avatarPath,cssPath,outputPath,signal}={}){
   if(signal?.aborted)throw storyFailure({code:'STORY_ABORTED'},'browser_launch');
   const chromium=browserType||require('playwright').chromium;let browser,page,stage='browser_launch';
   const cancel=()=>{page?.close().catch(()=>{});};
   try{
    if(browserPromise&&!(await browserPromise).isConnected())browserPromise=null;
    browserPromise??=chromium.launch({channel,headless:true}).catch(error=>{browserPromise=null;throw error;});
    browser=await browserPromise;if(signal?.aborted)throw storyFailure({code:'STORY_ABORTED'},stage);
    stage='page_create';page=await browser.newPage({viewport:{width:1080,height:1920},deviceScaleFactor:1});
    signal?.addEventListener('abort',cancel,{once:true});
    if(signal?.aborted)throw storyFailure({code:'STORY_ABORTED'},stage);
    stage='asset_read';
    const [css,avatar,portrait]=await Promise.all([fs.readFile(cssPath,'utf8'),fs.readFile(avatarPath),portraitPath?fs.readFile(portraitPath):null]);
    const assets={...data,lpcAvatarUrl:`data:image/png;base64,${avatar.toString('base64')}`,portraitUrl:portrait?`data:image/png;base64,${portrait.toString('base64')}`:null};
    await page.route('**/*',route=>route.abort()); // The export has no external resources or scripts.
    stage='html_render';
    await page.setContent(storyHtml(assets,css),{waitUntil:'load',timeout:30000});
    stage='image_decode';
    await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode()));});
    if(signal?.aborted)throw storyFailure({code:'STORY_ABORTED'},stage);
    stage='screenshot';
    await page.screenshot({path:outputPath,type:'png',animations:'disabled'});
   }catch(error){if(browser&&!browser.isConnected())browserPromise=null;throw storyFailure(error,stage);}
   finally{signal?.removeEventListener('abort',cancel);await page?.close().catch(()=>{});}
  },async close(){if(browserPromise){const browser=await browserPromise.catch(()=>null);browserPromise=null;await browser?.close();}}};
}
module.exports={createStoryRenderer,storyBrowserChannel,storyFailure};
