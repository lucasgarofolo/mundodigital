function experienceConfig(env=process.env){
 const integer=(value,fallback,min,max)=>{const n=Number(value);return value!==undefined&&Number.isInteger(n)&&n>=min&&n<=max?n:fallback;};
 return {entryDelayMs:integer(env.WORLD_ENTRY_DELAY_MS,8000,0,60000),
  entrySpacingMs:integer(env.WORLD_ENTRY_SPACING_MS,1000,0,5000),maxAvatarVersions:integer(env.AVATAR_MAX_ATTEMPTS,2,1,5)};
}
module.exports={experienceConfig};
