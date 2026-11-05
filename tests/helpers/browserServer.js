const path=require('node:path');
const {createApplication}=require('./authenticatedApplication');
createApplication({dataDir:path.resolve(process.env.DATA_DIR),avatarProvider:'local'}).then(runtime=>{
 runtime.server.listen(Number(process.env.PORT||3010));
 const close=async()=>{await runtime.close();process.exit(0);};process.once('SIGTERM',close);process.once('SIGINT',close);
}).catch(()=>{console.error('Browser fixture failed to start.');process.exit(1);});
