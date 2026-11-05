// Read the HTTP response before the UI's immediate navigation discards its browser response body.
module.exports=async function captureCheckin(page){
 let resolve,reject;const result=new Promise((yes,no)=>{resolve=yes;reject=no;});
 await page.route('**/api/check-in',async route=>{
  try{const response=await route.fetch();const body=await response.json();resolve({status:response.status(),body});await route.fulfill({response});}
  catch(error){reject(error);await route.abort().catch(()=>{});}
 },{times:1});
 return {result};
};
