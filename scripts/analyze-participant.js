// Local maintenance only. Stop the event server before running this script.
const path=require('node:path');
const {createStore}=require('../lib/store');
const {createAvatarPipeline}=require('../lib/avatarPipeline');
const {createGeminiAvatarAnalyzer,geminiConfig}=require('../lib/geminiAvatarAnalyzer');
const {createOllamaAvatarAnalyzer,ollamaConfig}=require('../lib/ollamaAvatarAnalyzer');
const {createOpenRouterAvatarAnalyzer,openRouterConfig}=require('../lib/openRouterAvatarAnalyzer');
const {selfieRemovedError,createSelfieLifecycle}=require('../lib/selfieLifecycle');
async function main(){
 try{process.loadEnvFile();}catch(error){if(error.code!=='ENOENT')throw error;}
 const uuid=process.argv[2];if(!/^[0-9a-f-]{36}$/i.test(uuid||''))throw new Error('Use: npm.cmd run avatar:analyze -- <uuid>');
 const provider=process.env.AVATAR_PROVIDER||'local';
 const analyzers={gemini:{config:geminiConfig,create:createGeminiAvatarAnalyzer,timeoutCode:'GEMINI_TIMEOUT'},
  ollama:{config:ollamaConfig,create:createOllamaAvatarAnalyzer,timeoutCode:'OLLAMA_TIMEOUT'},
  openrouter:{config:openRouterConfig,create:createOpenRouterAvatarAnalyzer,timeoutCode:'OPENROUTER_TIMEOUT'}};
 if(!['local',...Object.keys(analyzers)].includes(provider))throw new Error('Use AVATAR_PROVIDER=local, gemini, ollama ou openrouter.');
 if(provider==='local'){console.log('local: avatar padrão sem análise IA; nenhum participante foi alterado.');return;}
 const analyzer=analyzers[provider],config=analyzer.config();
 const dataDir=path.resolve(process.env.DATA_DIR||path.join(__dirname,'../data')),store=createStore(dataDir);
 let pipeline;
 const selfieLifecycle=createSelfieLifecycle({store,dataDir,isBusy:id=>!!pipeline?.has(id),logger:(event,details)=>console.log(event,JSON.stringify(details))});
 pipeline=createAvatarPipeline({store,dataDir,analyzeSelfie:analyzer.create({config}),selfieLifecycle,
  timeoutMs:config.timeoutMs,timeoutCode:analyzer.timeoutCode,concurrency:provider==='ollama'?1:2,
  logger:(event,details)=>console.log(event,JSON.stringify(details))});
 try{
  let participant=store.findByUuid(uuid);if(!participant)throw new Error('Participant not found');
  if(participant.avatarStatus==='READY'){console.log('READY: reusing persisted sprite and appearance; no API call.');return;}
  if(participant.selfieStatus==='DELETED')throw selfieRemovedError();
  if(participant.avatarStatus!=='PENDING'&&!store.retryAvatar(uuid))throw new Error('No private photo, inactive record or attempt limit reached.');
  pipeline.enqueue(uuid);await pipeline.idle();participant=store.findByUuid(uuid);
  console.log(`Avatar status: ${participant.avatarStatus}`);
  if(participant.avatarStatus==='READY')console.log(JSON.stringify(participant.appearance,null,2));
  else process.exitCode=1;
 }finally{await pipeline.close();await selfieLifecycle.sweep();await selfieLifecycle.close();store.close();}
}
main().catch(error=>{console.error(error.code==='SELFIE_REMOVED'?error.message:error.code||error.message);process.exitCode=1;});
