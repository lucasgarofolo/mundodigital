export function createAvatarPreview(canvas){
  const context=canvas.getContext('2d');let image,url,ticket=0,raf;
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  function stop(){ticket++;cancelAnimationFrame(raf);image=null;url=null;canvas.hidden=true;}
  async function show(participant){
    const next=participant.avatarUrl||participant.avatar;
    if(url===next&&image){canvas.hidden=false;return;}
    stop();const current=ticket;const loaded=new Image();
    await new Promise((resolve,reject)=>{loaded.onload=resolve;loaded.onerror=()=>reject(new Error('Não foi possível carregar a prévia.'));loaded.src=next;});
    if(current!==ticket)return;
    image=loaded;url=next;canvas.hidden=false;context.imageSmoothingEnabled=false;
    const start=performance.now();
    function draw(time){
      if(current!==ticket)return;
      context.clearRect(0,0,128,128);
      if(participant.avatarType==='lpc'){
        const col=reduced.matches?0:1+Math.floor((time-start)/100)%8;
        // LPC rows: up, left, down, right. Use the side view without distorting pixel art.
        context.drawImage(image,col*64,3*64,64,64,0,0,128,128);
      }else context.drawImage(image,21,0,85,128);
      raf=requestAnimationFrame(draw);
    }
    draw(start);
  }
  window.addEventListener('pagehide',stop);
  return {show,stop};
}
