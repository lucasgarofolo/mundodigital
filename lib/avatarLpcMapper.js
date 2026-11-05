const {BODY_DEFAULT,validateAppearance}=require('./avatarCatalog');
// Closed aliases into the imported, credited manifest. No model-controlled paths.
const WORLD_TO_LPC=Object.freeze({
 hairStyle:{bald:[],buzzcut:['buzzcut'],short:['hair'],spiked:['spiked'],curly_short:['curly_short'],
  curly_medium:['curly_medium'],bob:['bob'],shoulder:['shoulder_bg','shoulder'],long:['long'],ponytail:['ponytail_bg','ponytail']},
 facialHair:{none:[],moustache:['moustache'],goatee:['beard'],short_beard:['beard'],full_beard:['full_beard']},
 glasses:{none:[],rectangular:['glasses'],round:['round'],thin:['thin']},
 top:{tshirt:['top'],polo:['polo'],shirt:['shirt'],hoodie:['hoodie'],jacket:['top','jacket']},
 bottom:{pants:['pants'],jeans:['jeans'],shorts:['shorts'],skirt:['skirt']},
 hairColor:{black:'black',dark_brown:'dark_brown',brown:'chestnut',light_brown:'light_brown',blonde:'blonde',red:'redhead',gray:'gray',white:'white'},
 clothColor:{black:'black',white:'white',gray:'gray',dark_gray:'charcoal',blue:'blue',dark_blue:'navy',red:'red',green:'green',
  yellow:'yellow',orange:'orange',brown:'brown',purple:'purple',beige:'tan'},
});
function mapAppearance(input){
 const {appearance}=validateAppearance(input,{strict:true});
 const layers=[{id:'body',palette:'body',color:BODY_DEFAULT.skin},{id:'head',palette:'body',color:BODY_DEFAULT.skin},
  {id:'face',palette:'body',color:BODY_DEFAULT.skin},{id:'shoes',palette:'cloth',color:WORLD_TO_LPC.clothColor[appearance.shoes]}];
 for(const [field,colorField,palette] of [['hairStyle','hairColor','hair'],['facialHair','facialHairColor','hair'],
  ['glasses',null,null],['top','topColor','cloth'],['bottom','bottomColor','cloth']]){
  for(const id of WORLD_TO_LPC[field][appearance[field]])layers.push({id,palette,
   color:colorField?(palette==='hair'?WORLD_TO_LPC.hairColor:WORLD_TO_LPC.clothColor)[appearance[colorField]]:null});
 }
 return {bodyType:BODY_DEFAULT.body,appearance,layers};
}
module.exports={WORLD_TO_LPC,mapAppearance};
