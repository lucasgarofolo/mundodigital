const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs');
const path=require('node:path');
const {randomBytes}=require('node:crypto');
const {createAdminQueries}=require('./adminQueries');

const CYCLE_MS=15*60*1000;
function simulationJson(w){
 const data={...w};for(const key of ['photoPath','selfieStatus','selfieDeletedAt','selfieAiAcknowledgedAt','selfieNoticeVersion','avatarSelfieFinishedAt','portraitSelfieFinishedAt'])delete data[key];
 return JSON.stringify(data);
}
function cycleAt(now) {
  const slot=Math.floor(now/CYCLE_MS);
  return {id:`cycle-${slot}`,startsAt:new Date(slot*CYCLE_MS).toISOString(),endsAt:new Date((slot+1)*CYCLE_MS).toISOString()};
}

function createStore(dataDir) {
  fs.mkdirSync(dataDir,{recursive:true});
  const db=new DatabaseSync(path.join(dataDir,'participants.sqlite'));
  try {
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS cycles(id TEXT PRIMARY KEY, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS participants(id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        name TEXT NOT NULL, avatar TEXT NOT NULL, avatar_kind TEXT NOT NULL, created_at TEXT NOT NULL,
        cycle_id TEXT NOT NULL REFERENCES cycles(id), simulation TEXT NOT NULL);`);
    // Additive migration: Phase 2 UUIDs, avatars and simulation are preserved.
    db.exec('BEGIN IMMEDIATE');
    const columns=new Set(db.prepare('PRAGMA table_info(participants)').all().map(c=>c.name));
    const additions={uuid:'TEXT',photo_path:'TEXT',status:"TEXT NOT NULL DEFAULT 'CHECKED_IN' CHECK(status IN ('CHECKED_IN','INACTIVE'))",
      checkin_at:'TEXT',updated_at:'TEXT',current_floor:'TEXT',current_room:'TEXT',position_x:'REAL',position_y:'REAL',
      current_block:"TEXT NOT NULL DEFAULT 'blockB_upper'",current_area:"TEXT NOT NULL DEFAULT 'area_access'",
      avatar_status:"TEXT NOT NULL DEFAULT 'FALLBACK' CHECK(avatar_status IN ('PENDING','READY','FALLBACK','FAILED'))",
      appearance_json:'TEXT',avatar_version:'TEXT',avatar_attempts:'INTEGER NOT NULL DEFAULT 0',
      experience_status:"TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(experience_status IN ('REGISTERED','AVATAR_PROCESSING','AVATAR_REVIEW','AVATAR_APPROVED','ENTERING','ACTIVE'))",
      review_token:'TEXT',avatar_versions:'INTEGER NOT NULL DEFAULT 1',approved_at:'TEXT',scheduled_entry_at:'TEXT',entered_at:'TEXT',
      portrait_status:"TEXT NOT NULL DEFAULT 'PENDING' CHECK(portrait_status IN ('PENDING','PROCESSING','READY','FAILED'))",
      portrait_path:'TEXT',portrait_generated_at:'TEXT',portrait_requested_at:'TEXT',portrait_attempts:'INTEGER NOT NULL DEFAULT 0',
      pass_number:'TEXT',pass_role:'TEXT',pass_organization:'TEXT',pass_profile_tag:'TEXT',pass_highlight:'TEXT',
      story_status:"TEXT NOT NULL DEFAULT 'PENDING'",story_hash:'TEXT',story_generated_at:'TEXT',
      selfie_status:'TEXT',selfie_deleted_at:'TEXT',selfie_ai_acknowledged_at:'TEXT',selfie_notice_version:'TEXT',
      avatar_selfie_finished_at:'TEXT',portrait_selfie_finished_at:'TEXT'};
    for(const [name,type] of Object.entries(additions)) {
      if(!columns.has(name))db.exec(`ALTER TABLE participants ADD COLUMN ${name} ${type}`);
    }
    db.exec(`UPDATE participants SET uuid=id WHERE uuid IS NULL;
      UPDATE participants SET checkin_at=created_at WHERE checkin_at IS NULL;
      UPDATE participants SET updated_at=created_at WHERE updated_at IS NULL;
      UPDATE participants SET current_floor=json_extract(simulation,'$.currentFloor'),
        current_room=json_extract(simulation,'$.currentRoom'),position_x=json_extract(simulation,'$.position.x'),
        position_y=json_extract(simulation,'$.position.y') WHERE current_floor IS NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS participants_uuid_unique ON participants(uuid);
      CREATE INDEX IF NOT EXISTS participants_status ON participants(status);
      CREATE INDEX IF NOT EXISTS participants_name ON participants(name COLLATE NOCASE);
      CREATE UNIQUE INDEX IF NOT EXISTS participants_pass_number ON participants(pass_number);
      UPDATE participants SET selfie_status='AVAILABLE' WHERE photo_path IS NOT NULL AND selfie_status IS NULL;
      UPDATE participants SET simulation=json_remove(simulation,'$.photoPath','$.selfieStatus','$.selfieDeletedAt','$.selfieAiAcknowledgedAt','$.selfieNoticeVersion','$.avatarSelfieFinishedAt','$.portraitSelfieFinishedAt');
      PRAGMA user_version=8; COMMIT;`);
    // Keep already-visible legacy participants active; new registrations use explicit review states.
    for(const row of db.prepare('SELECT id FROM participants WHERE review_token IS NULL').all())
      db.prepare('UPDATE participants SET review_token=? WHERE id=?').run(randomBytes(32).toString('base64url'),row.id);
  } catch(error) {try{db.exec('ROLLBACK');}catch{}db.close();throw error;}
  db.function('senai_fold',{deterministic:true},value=>String(value).normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('pt-BR'));
  const operational=row=>row?{uuid:row.uuid,name:row.name,status:row.status==='INACTIVE'?'INACTIVE':row.experience_status,
    currentBlock:row.current_block,currentArea:row.current_area}:null;
  const decode=row=>row?{...JSON.parse(row.simulation),id:row.id,uuid:row.uuid,name:row.name,email:row.email,
    avatar:row.avatar,avatarKind:row.avatar_kind,photoPath:row.photo_path,status:row.status,
    selfieStatus:row.selfie_status,selfieDeletedAt:row.selfie_deleted_at,selfieAiAcknowledgedAt:row.selfie_ai_acknowledged_at,selfieNoticeVersion:row.selfie_notice_version,
    avatarSelfieFinishedAt:row.avatar_selfie_finished_at,portraitSelfieFinishedAt:row.portrait_selfie_finished_at,
    avatarStatus:row.avatar_status,appearance:row.appearance_json?JSON.parse(row.appearance_json):null,
    avatarVersion:row.avatar_version,avatarAttempts:row.avatar_attempts,avatarType:row.avatar_kind==='lpc'?'lpc':'placeholder',
    experienceStatus:row.experience_status,reviewToken:row.review_token,avatarVersions:row.avatar_versions,
    approvedAt:row.approved_at,scheduledEntryAt:row.scheduled_entry_at,enteredAt:row.entered_at,
    portraitStatus:row.portrait_status,portraitPath:row.portrait_path,portraitGeneratedAt:row.portrait_generated_at,
    portraitRequestedAt:row.portrait_requested_at,portraitAttempts:row.portrait_attempts,
    passNumber:row.pass_number,role:row.pass_role,organization:row.pass_organization,profileTag:row.pass_profile_tag,highlight:row.pass_highlight,
    storyStatus:row.story_status,storyHash:row.story_hash,storyGeneratedAt:row.story_generated_at,
    createdAt:row.created_at,checkinAt:row.checkin_at,updatedAt:row.updated_at,cycleId:row.cycle_id,
    currentFloor:row.current_floor,currentRoom:row.current_room,currentBlock:row.current_block,currentArea:row.current_area,
    position:{x:row.position_x,y:row.position_y}}:null;
  return {
    db,
    ...createAdminQueries(db,decode),
    findByEmail:email=>decode(db.prepare('SELECT * FROM participants WHERE email=?').get(email)),
    findByUuid:uuid=>decode(db.prepare('SELECT * FROM participants WHERE uuid=?').get(uuid)),
    operatorParticipant:uuid=>operational(db.prepare('SELECT uuid,name,status,experience_status,current_block,current_area FROM participants WHERE uuid=?').get(uuid)),
    searchParticipants:(query,limit=20)=>db.prepare(`SELECT uuid,name,status,experience_status,current_block,current_area
      FROM participants WHERE instr(senai_fold(name),?)>0 ORDER BY name COLLATE NOCASE,uuid LIMIT ?`)
      .all(query,Math.max(1,Math.min(20,limit))).map(operational),
    list:()=>db.prepare('SELECT * FROM participants ORDER BY created_at,id').all().map(decode),
    listRegistered:()=>db.prepare("SELECT * FROM participants WHERE status='CHECKED_IN' ORDER BY created_at,id").all().map(decode),
    listActive:()=>db.prepare("SELECT * FROM participants WHERE status='CHECKED_IN' AND experience_status IN ('ENTERING','ACTIVE') ORDER BY created_at,id").all().map(decode),
    health:()=>db.prepare("SELECT COUNT(*) AS active FROM participants WHERE status='CHECKED_IN' AND experience_status IN ('ENTERING','ACTIVE')").get(),
    clearParticipants:()=>db.prepare('DELETE FROM participants').run().changes,
    cycle(now){
      const c=cycleAt(now);
      db.prepare('INSERT OR IGNORE INTO cycles VALUES(?,?,?)').run(c.id,c.startsAt,c.endsAt);
      return c;
    },
    insert(walker,email,now){
      db.exec('BEGIN IMMEDIATE');
      try {
        const cycle=this.cycle(now),timestamp=new Date(now).toISOString();
        Object.assign(walker,{uuid:walker.id,status:'CHECKED_IN',cycleId:cycle.id,createdAt:timestamp,checkinAt:timestamp,updatedAt:timestamp,
          experienceStatus:walker.experienceStatus||'ACTIVE',reviewToken:walker.reviewToken||randomBytes(32).toString('base64url')});
        db.prepare(`INSERT INTO participants(id,email,name,avatar,avatar_kind,created_at,cycle_id,simulation,
          uuid,photo_path,status,checkin_at,updated_at,current_floor,current_room,position_x,position_y,avatar_status,appearance_json,avatar_version,experience_status,review_token)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(walker.id,email,walker.name,walker.avatar,walker.avatarKind,
          timestamp,cycle.id,simulationJson(walker),walker.uuid,walker.photoPath||null,walker.status,timestamp,timestamp,
          walker.currentFloor,walker.currentRoom,walker.position.x,walker.position.y,walker.avatarStatus||'FALLBACK',
          walker.appearance?JSON.stringify(walker.appearance):null,walker.avatarVersion||null,walker.experienceStatus,walker.reviewToken);
        db.prepare('UPDATE participants SET current_block=?,current_area=? WHERE id=?')
          .run(walker.currentBlock||'blockB_upper',walker.currentArea||'area_access',walker.id);
        db.prepare('UPDATE participants SET selfie_status=?,selfie_ai_acknowledged_at=?,selfie_notice_version=? WHERE id=?')
          .run(walker.photoPath?'AVAILABLE':null,walker.selfieAiAcknowledgedAt||null,walker.selfieNoticeVersion||null,walker.id);
        db.exec('COMMIT');
      } catch(error) {db.exec('ROLLBACK');throw error;}
    },
    startAvatarAttempt(uuid){
      return db.prepare("UPDATE participants SET avatar_attempts=avatar_attempts+1,avatar_selfie_finished_at=NULL WHERE uuid=? AND status='CHECKED_IN' AND avatar_status='PENDING' AND avatar_attempts<2").run(uuid).changes===1;
    },
    updateAvatar(uuid,{avatarUrl,avatarKind,avatarStatus,appearance,avatarVersion},now=Date.now()){
      const result=db.prepare(`UPDATE participants SET avatar=COALESCE(?,avatar),avatar_kind=COALESCE(?,avatar_kind),
        avatar_status=?,appearance_json=?,avatar_version=COALESCE(?,avatar_version),updated_at=?,
        experience_status=CASE WHEN experience_status='AVATAR_PROCESSING' THEN 'AVATAR_REVIEW' ELSE experience_status END
        WHERE uuid=? AND status='CHECKED_IN'`).run(avatarUrl||null,avatarKind||null,avatarStatus,
        JSON.stringify(appearance),avatarVersion||null,new Date(now).toISOString(),uuid);
      return result.changes===1?this.findByUuid(uuid):null;
    },
    retryAvatar(uuid){return db.prepare("UPDATE participants SET avatar_status='PENDING',avatar_selfie_finished_at=NULL WHERE uuid=? AND avatar_status='FALLBACK' AND avatar_attempts<2 AND status='CHECKED_IN' AND photo_path IS NOT NULL").run(uuid).changes===1;},
    setSelfieStatus(uuid,status){return db.prepare('UPDATE participants SET selfie_status=? WHERE uuid=? AND photo_path IS NOT NULL').run(status,uuid).changes===1;},
    finishSelfieConsumer(uuid,consumer,now=Date.now()){
      const column=consumer==='avatar'?'avatar_selfie_finished_at':consumer==='portrait'?'portrait_selfie_finished_at':null;
      if(!column)throw new Error('Unknown selfie consumer');
      db.prepare(`UPDATE participants SET ${column}=? WHERE uuid=?`).run(new Date(now).toISOString(),uuid);
    },
    markSelfieDeleted(uuid,now=Date.now()){return db.prepare("UPDATE participants SET photo_path=NULL,selfie_status='DELETED',selfie_deleted_at=?,simulation=json_remove(simulation,'$.photoPath') WHERE uuid=?")
      .run(new Date(now).toISOString(),uuid).changes===1;},
    approveAvatar(uuid,now,delayMs,spacingMs){
      const p=this.findByUuid(uuid);if(!p||p.status==='INACTIVE')return null;
      if(['AVATAR_APPROVED','ENTERING','ACTIVE'].includes(p.experienceStatus))return p;
      if(p.experienceStatus!=='AVATAR_REVIEW'||!['READY','FALLBACK'].includes(p.avatarStatus))return null;
      const last=db.prepare("SELECT MAX(scheduled_entry_at) AS scheduled FROM participants WHERE status='CHECKED_IN'").get().scheduled;
      const entry=Math.max(now+delayMs,last?Date.parse(last)+spacingMs:0);
      db.prepare("UPDATE participants SET experience_status='AVATAR_APPROVED',approved_at=?,scheduled_entry_at=? WHERE uuid=? AND experience_status='AVATAR_REVIEW'")
        .run(new Date(now).toISOString(),new Date(entry).toISOString(),uuid);
      return this.findByUuid(uuid);
    },
    beginEntry(walker,now){
      const result=db.prepare(`UPDATE participants SET experience_status='ENTERING',simulation=?,position_x=?,position_y=?,updated_at=?
        WHERE uuid=? AND status='CHECKED_IN' AND experience_status='AVATAR_APPROVED'`).run(simulationJson(walker),walker.x,walker.y,new Date(now).toISOString(),walker.uuid);
      return result.changes===1;
    },
    startRegeneration(uuid,maxVersions){return db.prepare(`UPDATE participants SET experience_status='AVATAR_PROCESSING',avatar_status='PENDING',avatar_versions=avatar_versions+1
      WHERE uuid=? AND status='CHECKED_IN' AND experience_status='AVATAR_REVIEW' AND avatar_versions<?`).run(uuid,maxVersions).changes===1;},
    requestPortrait(uuid,now=Date.now()){
      const p=this.findByUuid(uuid);if(!p||p.status==='INACTIVE')return false;
      return db.prepare(`UPDATE participants SET portrait_requested_at=?,pass_number=COALESCE(pass_number,?)
        WHERE uuid=? AND portrait_requested_at IS NULL`).run(new Date(now).toISOString(),`MS${new Date(now).getFullYear().toString().slice(-2)}-${randomBytes(6).toString('hex').toUpperCase()}`,uuid).changes===1;
    },
    startPortrait(uuid){return db.prepare(`UPDATE participants SET portrait_status='PROCESSING',portrait_attempts=portrait_attempts+1,portrait_selfie_finished_at=NULL
      WHERE uuid=? AND portrait_status='PENDING' AND portrait_requested_at IS NOT NULL AND portrait_attempts<2 AND status='CHECKED_IN'`).run(uuid).changes===1;},
    retryPortrait(uuid){return db.prepare(`UPDATE participants SET portrait_status='PENDING',portrait_selfie_finished_at=NULL
      WHERE uuid=? AND portrait_status='FAILED' AND portrait_attempts<2 AND portrait_requested_at IS NOT NULL AND status='CHECKED_IN' AND photo_path IS NOT NULL`).run(uuid).changes===1;},
    recoverPortraits(){db.prepare(`UPDATE participants SET portrait_status=CASE WHEN portrait_attempts<2 THEN 'PENDING' ELSE 'FAILED' END,portrait_selfie_finished_at=NULL WHERE portrait_status='PROCESSING'`).run();},
    finishPortrait(uuid,{ready=false,generatedAt=null}={}){return db.prepare(`UPDATE participants SET portrait_status=?,portrait_path=?,portrait_generated_at=?
      WHERE uuid=? AND portrait_requested_at IS NOT NULL`).run(ready?'READY':'FAILED',ready?`generated/participants/${uuid}/portrait.png`:null,generatedAt,uuid).changes===1;},
    updatePassProfile(uuid,profile){db.prepare(`UPDATE participants SET pass_role=?,pass_organization=?,pass_profile_tag=?,pass_highlight=? WHERE uuid=?`)
      .run(profile.role||null,profile.organization||null,profile.profileTag||null,profile.highlight||null,uuid);return this.findByUuid(uuid);},
    updateStory(uuid,status,hash=null,now=Date.now()){return db.prepare(`UPDATE participants SET story_status=?,story_hash=?,story_generated_at=? WHERE uuid=?`)
      .run(status,hash,status==='READY'?new Date(now).toISOString():null,uuid).changes===1;},
    save(walkers,now=Date.now()){
      if(!walkers.length)return;
      const timestamp=new Date(now).toISOString();
      const statement=db.prepare(`UPDATE participants SET simulation=?,current_floor=?,current_room=?,current_block=?,current_area=?,
        position_x=?,position_y=?,updated_at=?,experience_status=?,entered_at=COALESCE(?,entered_at) WHERE uuid=? AND status='CHECKED_IN'`);
      db.exec('BEGIN IMMEDIATE');
      try {
        for(const w of walkers)statement.run(simulationJson(w),w.currentFloor,w.currentRoom,w.currentBlock||'blockB_upper',w.currentArea||'area_access',w.position.x,w.position.y,timestamp,w.experienceStatus||'ACTIVE',w.enteredAt||null,w.uuid||w.id);
        db.exec('COMMIT');for(const w of walkers)w.updatedAt=timestamp;
      } catch(error){db.exec('ROLLBACK');throw error;}
    },
    close(){db.close();},
  };
}
module.exports={createStore,cycleAt,CYCLE_MS};
