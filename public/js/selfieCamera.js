// A real camera stream, separate from the photo file picker.
export function createSelfieCamera({onPhoto,onError,isBusy}) {
  const video=document.getElementById('camera-preview'),controls=document.getElementById('camera-controls');
  const open=document.getElementById('camera'),capture=document.getElementById('take-photo');
  const cancel=document.getElementById('cancel-camera'),preview=document.getElementById('preview');
  const placeholder=document.getElementById('photo-placeholder');
  let stream=null,generation=0,opening=false;
  const frameReady=()=>!!stream&&video.readyState>=2&&video.videoWidth>=32&&video.videoHeight>=32;
  function stop() {
    generation++;opening=false;
    stream?.getTracks().forEach(track=>track.stop());stream=null;
    video.pause();video.srcObject=null;video.hidden=true;controls.hidden=true;
    capture.disabled=true;open.disabled=false;
    preview.hidden=!preview.getAttribute('src');placeholder.hidden=!preview.hidden;
  }
  async function start() {
    if(isBusy()||opening)return;
    stop();const ticket=generation;opening=true;open.disabled=true;controls.hidden=false;
    onError('');
    if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia) {
      stop();onError('A câmera precisa de HTTPS ou localhost. Abra o site em uma conexão segura ou use Escolher foto.');return;
    }
    try {
      const constraints={audio:false,video:{facingMode:{ideal:'user'},width:{ideal:1024},height:{ideal:768}}};
      let acquired;
      try{acquired=await navigator.mediaDevices.getUserMedia(constraints);}catch(error){
        // Some camera drivers need a moment to release a previous stream.
        if(error.name!=='NotReadableError')throw error;
        await new Promise(resolve=>setTimeout(resolve,250));
        if(ticket!==generation)return;
        acquired=await navigator.mediaDevices.getUserMedia(constraints);
      }
      if(ticket!==generation||isBusy()){acquired.getTracks().forEach(track=>track.stop());return;}
      stream=acquired;video.srcObject=stream;video.hidden=false;preview.hidden=true;placeholder.hidden=true;
      await video.play();
      if(ticket!==generation)return;
      opening=false;capture.disabled=!frameReady();
    } catch(error) {
      if(ticket!==generation)return;
      stop();
      const messages={NotAllowedError:'Permita o acesso à câmera no navegador e tente novamente.',
        NotFoundError:'Nenhuma câmera foi encontrada. Conecte uma câmera ou use Escolher foto.',
        NotReadableError:'A câmera está ocupada ou indisponível. Feche outros aplicativos que a estejam usando.'};
      onError(messages[error.name]||'Não foi possível abrir a câmera. Tente novamente ou use Escolher foto.');
    }
  }
  async function takePhoto() {
    if(isBusy()||capture.disabled||!frameReady())return;
    capture.disabled=true;const ticket=generation;
    let canvas;
    try {
      canvas=document.createElement('canvas');const scale=Math.min(1,1024/Math.max(video.videoWidth,video.videoHeight));
      canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);
      // Preview is mirrored by CSS; the saved photo retains its original orientation.
      canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.85));
      if(ticket!==generation)return;
      if(!blob)throw new Error('Capture failed');
      stop();onPhoto(new File([blob],'selfie.jpg',{type:'image/jpeg'}));
    } catch {
      if(ticket!==generation)return;
      stop();onError('Não foi possível fotografar. Abra a câmera e tente novamente.');
    }finally{if(canvas){canvas.width=0;canvas.height=0;}}
  }
  for(const event of ['loadeddata','resize','playing'])video.addEventListener(event,()=>{capture.disabled=!frameReady();});
  open.addEventListener('click',start);capture.addEventListener('click',takePhoto);
  cancel.addEventListener('click',stop);
  window.addEventListener('pagehide',stop);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
  return {stop};
}
