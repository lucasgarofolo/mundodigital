const path=require('node:path');
const readline=require('node:readline/promises');
const {Writable}=require('node:stream');
const {createAuthStore}=require('../lib/authStore');

async function main(){
 try{process.loadEnvFile();}catch(e){if(e.code!=='ENOENT')throw e;}
 if(process.env.NODE_ENV==='production'&&!process.env.DATA_DIR)throw Object.assign(new Error('Configure DATA_DIR no mesmo volume persistente do servidor.'),{status:400});
 if(!process.stdin.isTTY)throw new Error('Execute em um terminal interativo. A senha não é aceita por argumentos nem por arquivos.');
 let hidden=false;const output=new Writable({write(chunk,_encoding,done){if(!hidden)process.stdout.write(chunk);done();}});
 const rl=readline.createInterface({input:process.stdin,output,terminal:true});let store;
 const password=async label=>{process.stdout.write(label);hidden=true;try{return await rl.question('');}finally{hidden=false;process.stdout.write('\n');}};
 try{const username=(await rl.question('Usuário: ')).trim();const value=await password('Senha (mínimo 12 caracteres): '),confirmation=await password('Confirme a senha: ');
  if(value!==confirmation)throw new Error('As senhas não coincidem.');
  store=createAuthStore(path.resolve(process.env.DATA_DIR||path.join(__dirname,'../data')));
  const user=await store.create(username,value);console.log(JSON.stringify({event:'admin-created',timestamp:new Date().toISOString(),id:user.id,username:user.username,source:'cli'}));console.log(`Administrador criado: ${user.username}. Entre em /login.`);
 }finally{rl.close();store?.close();}
}
if(require.main===module)main().catch(error=>{console.error(error.status?error.message:'Não foi possível criar o administrador. Verifique o terminal e a configuração local.');process.exitCode=1;});
module.exports={main};
