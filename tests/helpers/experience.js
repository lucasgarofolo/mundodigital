const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function approve(r,p,token){
 const response=await fetch(r.base+'/api/participants/'+p.uuid+'/approve-avatar',{method:'POST',headers:{Authorization:'Bearer '+(token||p.reviewToken)}});
 if(!response.ok)throw new Error('Approval failed: '+response.status);
 for(let i=0;i<100;i++){if(r.walkers.has(p.uuid))return;await wait(20);}
 throw new Error('Entry not dispatched');
}
module.exports={approve,wait};
