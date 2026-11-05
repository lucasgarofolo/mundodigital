const hairColors=['black','dark_brown','brown','light_brown','blonde','red','gray','white'];
const AVATAR_CATALOG=Object.freeze(Object.fromEntries(Object.entries({
 hairStyle:['bald','buzzcut','short','spiked','curly_short','curly_medium','bob','shoulder','long','ponytail'],
 hairColor:hairColors,facialHair:['none','moustache','goatee','short_beard','full_beard'],facialHairColor:hairColors,
 glasses:['none','rectangular','round','thin'],top:['tshirt','polo','shirt','hoodie','jacket'],
 topColor:['black','white','gray','dark_gray','blue','dark_blue','red','green','yellow','orange','brown','purple'],
 bottom:['pants','jeans','shorts','skirt'],bottomColor:['black','gray','dark_gray','blue','dark_blue','brown','beige','white'],
 shoes:['black','white','gray','brown','blue'],
}).map(([key,values])=>[key,Object.freeze([...values,'unknown'])])));
const DEFAULT_AVATAR=Object.freeze({hairStyle:'short',hairColor:'dark_brown',facialHair:'none',facialHairColor:'dark_brown',
 glasses:'none',top:'tshirt',topColor:'blue',bottom:'pants',bottomColor:'dark_blue',shoes:'black'});
const BODY_DEFAULT=Object.freeze({body:'male',skin:'light',head:'human_male',face:'neutral'});
function validateAppearance(input,{strict=false}={}){
 const object=input&&typeof input==='object'&&!Array.isArray(input)?input:{};
 const appearance={},invalid=[];
 for(const [field,values] of Object.entries(AVATAR_CATALOG)){
  const value=object[field];
  if(!values.includes(value))invalid.push(field);
  appearance[field]=values.includes(value)&&value!=='unknown'?value:DEFAULT_AVATAR[field];
 }
 for(const field of Object.keys(object))if(!Object.hasOwn(AVATAR_CATALOG,field))invalid.push(field);
 if(strict&&invalid.length)throw Object.assign(new Error('Invalid avatar description'),{code:'INVALID_APPEARANCE'});
 return {appearance,invalid};
}
function avatarSchema(){return {type:'object',properties:Object.fromEntries(Object.entries(AVATAR_CATALOG)
 .map(([field,values])=>[field,{type:'string',enum:[...values]}])),required:Object.keys(AVATAR_CATALOG),additionalProperties:false};}
module.exports={AVATAR_CATALOG,DEFAULT_AVATAR,BODY_DEFAULT,validateAppearance,avatarSchema};
