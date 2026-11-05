const {DEFAULT_AVATAR,validateAppearance}=require('./avatarCatalog');
function avatarVariation(input){
 const {appearance}=validateAppearance(input||DEFAULT_AVATAR);
 const hair={short:'spiked',spiked:'short',curly_short:'curly_medium',curly_medium:'curly_short',long:'shoulder',shoulder:'long',ponytail:'long',bob:'shoulder',buzzcut:'short',bald:'bald'};
 const shades={black:'dark_gray',dark_gray:'black',blue:'dark_blue',dark_blue:'blue',white:'gray',gray:'dark_gray',red:'orange',orange:'red',green:'blue',yellow:'orange',brown:'black',purple:'dark_blue'};
 return {...appearance,hairStyle:hair[appearance.hairStyle],
  topColor:hair[appearance.hairStyle]===appearance.hairStyle?shades[appearance.topColor]:appearance.topColor};
}
module.exports={avatarVariation};
