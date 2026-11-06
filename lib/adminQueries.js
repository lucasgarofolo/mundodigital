// Read models only: no additional participant state or pipeline lives here.
function createAdminQueries(db,decode){
 const view=`WITH operational AS (SELECT uuid,name,created_at,selfie_status,
  CASE WHEN status='INACTIVE' THEN 'INACTIVE'
   WHEN experience_status='AVATAR_APPROVED' THEN 'ENTRY_SCHEDULED'
   WHEN experience_status IN ('ENTERING','ACTIVE') THEN experience_status
   WHEN experience_status='AVATAR_REVIEW' AND avatar_status IN ('READY','FALLBACK') AND
    (portrait_status IN ('READY','FAILED') OR julianday(COALESCE(portrait_requested_at,checkin_at))<=julianday(?)) THEN 'PASS_READY'
   ELSE 'ASSETS_PROCESSING' END AS credential_state,
  (status='CHECKED_IN' AND (avatar_status='PENDING' OR portrait_status='PROCESSING' OR (portrait_status='PENDING' AND portrait_requested_at IS NOT NULL) OR story_status='PROCESSING' OR (story_status='PENDING' AND pass_number IS NOT NULL AND experience_status IN ('AVATAR_APPROVED','ENTERING','ACTIVE')))) AS processing,
  (status='CHECKED_IN' AND (avatar_status='FAILED' OR (? AND avatar_status='FALLBACK'))) AS lpc_failed,
  (status='CHECKED_IN' AND portrait_status='FAILED') AS portrait_failed,
  (status='CHECKED_IN' AND story_status='FAILED') AS story_failed
  FROM participants)`;
 const filters={ALL:'1',ACTIVE:"credential_state='ACTIVE'",PROCESSING:'processing',FAILED:'(lpc_failed OR portrait_failed OR story_failed)',
  PASS_READY:"credential_state='PASS_READY'",PORTRAIT_FAILED:'portrait_failed',LPC_FAILED:'lpc_failed'};
 const args=options=>[new Date(options.now-options.portraitWaitMs).toISOString(),options.personalization?1:0];
 return {
  adminSummary(options){return db.prepare(`${view} SELECT COUNT(*) AS total,
   COALESCE(SUM(credential_state='ACTIVE'),0) AS active,COALESCE(SUM(credential_state='PASS_READY'),0) AS passReady,
   COALESCE(SUM(credential_state='ENTRY_SCHEDULED'),0) AS entryScheduled,COALESCE(SUM(credential_state='ENTERING'),0) AS entering,
   COALESCE(SUM(processing),0) AS processing,COALESCE(SUM(lpc_failed OR portrait_failed OR story_failed),0) AS failed,
   COALESCE(SUM(selfie_status='DELETE_FAILED'),0) AS selfieDeleteFailed FROM operational`).get(...args(options));},
  adminParticipants(options){
   const condition=filters[options.filter];if(!condition)throw Object.assign(new Error('Filtro inválido.'),{status:400});
   const search=`(?='' OR instr(senai_fold(o.name),?)>0 OR instr(lower(o.uuid),?)>0)`;
   const parameters=[...args(options),options.query,options.query,options.query];
   const total=db.prepare(`${view} SELECT COUNT(*) AS n FROM operational o WHERE ${condition} AND ${search}`).get(...parameters).n;
   const rows=db.prepare(`${view} SELECT p.* FROM operational o JOIN participants p ON p.uuid=o.uuid
    WHERE ${condition} AND ${search} ORDER BY p.created_at DESC,p.uuid LIMIT ? OFFSET ?`).all(...parameters,options.limit,(options.page-1)*options.limit);
   return {total,participants:rows.map(decode)};
  },
  adminResolveRef(ref){const rows=db.prepare(`SELECT uuid,name FROM participants WHERE ${ref.length===36?'uuid':'substr(uuid,1,8)'}=? LIMIT 2`).all(ref);return rows.length===1?rows[0]:null;},
  cancelEntry(uuid,now){return db.prepare("UPDATE participants SET experience_status='AVATAR_REVIEW',scheduled_entry_at=NULL,updated_at=? WHERE uuid=? AND status='CHECKED_IN' AND experience_status='AVATAR_APPROVED'").run(new Date(now).toISOString(),uuid).changes===1;},
  retireBeforeEntry(uuid,now){return db.prepare(`UPDATE participants SET status='INACTIVE',updated_at=?,scheduled_entry_at=NULL,
   experience_status=CASE WHEN experience_status='AVATAR_APPROVED' THEN 'AVATAR_REVIEW' ELSE experience_status END,
   avatar_status=CASE WHEN avatar_status='PENDING' THEN 'FALLBACK' ELSE avatar_status END,
   avatar_selfie_finished_at=COALESCE(avatar_selfie_finished_at,?),
   portrait_status=CASE WHEN portrait_status IN ('PENDING','PROCESSING') THEN 'FAILED' ELSE portrait_status END,
   portrait_selfie_finished_at=COALESCE(portrait_selfie_finished_at,?),
   story_status=CASE WHEN story_status='PROCESSING' THEN 'FAILED' ELSE story_status END
   WHERE uuid=? AND entered_at IS NULL AND experience_status IN ('REGISTERED','AVATAR_PROCESSING','AVATAR_REVIEW','AVATAR_APPROVED')`)
   .run(...Array(3).fill(new Date(now).toISOString()),uuid).changes===1;},
  deleteBeforeEntry(uuid){return db.prepare(`DELETE FROM participants WHERE uuid=? AND status='INACTIVE' AND entered_at IS NULL
   AND experience_status IN ('REGISTERED','AVATAR_PROCESSING','AVATAR_REVIEW')`).run(uuid).changes===1;},
  removeFromWorld(uuid,now){return db.prepare(`UPDATE participants SET status='INACTIVE',updated_at=?,
   avatar_status=CASE WHEN avatar_status='PENDING' THEN 'FALLBACK' ELSE avatar_status END,
   avatar_selfie_finished_at=CASE WHEN avatar_status='PENDING' THEN ? ELSE avatar_selfie_finished_at END,
   portrait_status=CASE WHEN portrait_status='PENDING' THEN 'FAILED' ELSE portrait_status END,
   portrait_selfie_finished_at=CASE WHEN portrait_status='PENDING' THEN ? ELSE portrait_selfie_finished_at END
   WHERE uuid=? AND status='CHECKED_IN' AND experience_status IN ('ACTIVE','ENTERING')`).run(...Array(3).fill(new Date(now).toISOString()),uuid).changes===1;}
 };
}
module.exports={createAdminQueries};
