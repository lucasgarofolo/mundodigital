const {createApplication}=require('../helpers/authenticatedApplication');
createApplication({dataDir:process.argv[2],entryDelayMs:0,entrySpacingMs:0,logger:()=>{}}).then(runtime=>{
  runtime.server.listen(Number(process.argv[3]||0),'127.0.0.1',()=>process.send({port:runtime.server.address().port}));
  process.on('message',async message=>{
    if(message==='shutdown'){await runtime.close();process.exit(0);}
  });
}).catch(error=>{console.error(error);process.exit(1);});
