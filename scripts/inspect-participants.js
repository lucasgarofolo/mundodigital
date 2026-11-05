const {DatabaseSync}=require('node:sqlite');
const path=require('node:path');
try{process.loadEnvFile();}catch(error){if(error.code!=='ENOENT')throw error;}
const directory=path.resolve(process.argv[2]||process.env.DATA_DIR||path.join(__dirname,'../data'));
const db=new DatabaseSync(path.join(directory,'participants.sqlite'),{readOnly:true});
try {
  console.log(JSON.stringify(db.prepare(`SELECT uuid,name,status,avatar AS avatar_path,
    current_floor,current_room,position_x,position_y,checkin_at,created_at,updated_at,cycle_id
    FROM participants ORDER BY created_at,id`).all(),null,2));
} finally {db.close();}
