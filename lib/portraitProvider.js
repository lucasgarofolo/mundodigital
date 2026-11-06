const {createCloudflarePortrait,portraitConfig}=require('./cloudflarePortrait');
const {createOpenRouterPortrait,openRouterPortraitConfig}=require('./openRouterPortrait');
const {eligible,failure}=require('./portraitImage');
function portraitProviderConfig(env=process.env){
 const provider=env.PORTRAIT_PROVIDER??'cloudflare',enabled=env.PORTRAIT_FALLBACK_ENABLED??'false';
 if(!['cloudflare','openrouter'].includes(provider))throw Error('PORTRAIT_PROVIDER deve ser cloudflare ou openrouter.');
 if(!['true','false'].includes(enabled))throw Error('PORTRAIT_FALLBACK_ENABLED deve ser true ou false.');
 const fallbackProvider=enabled==='true'?(env.PORTRAIT_FALLBACK_PROVIDER??'openrouter'):null;
 if(fallbackProvider!==null&&!['cloudflare','openrouter'].includes(fallbackProvider))throw Error('PORTRAIT_FALLBACK_PROVIDER deve ser cloudflare ou openrouter.');
 if(provider===fallbackProvider)throw Error('PORTRAIT_PROVIDER e PORTRAIT_FALLBACK_PROVIDER devem ser diferentes.');
 return {provider,fallbackProvider};
}
function createPortraitProvider({env=process.env,logger=()=>{},fetchImpl=fetch}={}){
 const config=portraitProviderConfig(env),providers={};
 for(const name of [config.provider,config.fallbackProvider].filter(Boolean)){
  const settings=name==='cloudflare'?portraitConfig(env):openRouterPortraitConfig(env);
  providers[name]={model:settings.model,generate:(name==='cloudflare'?createCloudflarePortrait:createOpenRouterPortrait)({config:settings,fetchImpl})};
 }
 const generate=async(photoPath,{signal}={})=>{
  for(const [index,name] of [config.provider,config.fallbackProvider].filter(Boolean).entries()){
   const {model,generate:run}=providers[name],started=performance.now(),details={provider:name,model};
   logger('portrait:provider-started',details);
   try{signal?.throwIfAborted();const png=await run(photoPath,{signal,onUsage:usage=>Object.assign(details,usage)});
    signal?.throwIfAborted();logger('portrait:provider-ready',{...details,duration_ms:Math.round(performance.now()-started)});return png;
   }catch(error){
    const safe=failure(/^PORTRAIT_[A-Z_]+$/.test(error.code)?error.code:'PORTRAIT_REQUEST_FAILED',error.status);
    // The queue must not restart this sequence and bill the same provider twice.
    safe.retryable=false;safe.provider=name;
    logger('portrait:provider-failed',{...details,code:safe.code,...(safe.status?{status:safe.status}:{}),duration_ms:Math.round(performance.now()-started)});
    if(signal?.aborted||index!==0||!config.fallbackProvider||!eligible(safe))throw safe;
    logger('portrait:fallback',{provider:name,fallback_provider:config.fallbackProvider,code:safe.code,...(safe.status?{status:safe.status}:{})});
   }
  }
 };
 generate.managesProviderEvents=true;
 return generate;
}
module.exports={portraitProviderConfig,createPortraitProvider};
