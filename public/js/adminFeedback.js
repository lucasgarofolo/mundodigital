let clearToast;
export function notice(message){const target=document.getElementById('auth-status');target.textContent=message;clearTimeout(clearToast);clearToast=setTimeout(()=>{if(target.textContent===message)target.textContent='';},8000);}
export function confirmAction(message){const dialog=document.getElementById('confirm-action');if(dialog.open)return Promise.resolve(false);
 document.getElementById('confirm-message').textContent=message;dialog.returnValue='cancel';dialog.showModal();
 return new Promise(resolve=>dialog.addEventListener('close',()=>resolve(dialog.returnValue==='confirm'),{once:true}));}
