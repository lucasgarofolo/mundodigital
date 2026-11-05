const base=require('@playwright/test');
const {sessionFor}=require('./authenticatedApplication');
const wrapped=new WeakSet();
function wrapPage(page,baseURL){if(wrapped.has(page))return page;wrapped.add(page);const goto=page.goto.bind(page);
 page.goto=async(url,...args)=>{const target=new URL(url,baseURL);if(target.protocol.startsWith('http')){const auth=await sessionFor(target.origin);if(auth){const [name,...rest]=auth.cookie.split('=');await page.context().addCookies([{name,value:rest.join('='),url:target.origin,httpOnly:true,sameSite:'Lax'}]);}}return goto(url,...args);};return page;}
const test=base.test.extend({
 browser:async({browser},use)=>{const proxy=new Proxy(browser,{get(target,key){if(key==='newPage')return async(...args)=>wrapPage(await target.newPage(...args),'http://localhost:3010');if(key==='newContext')return async(...args)=>{const context=await target.newContext(...args),newPage=context.newPage.bind(context);context.newPage=async()=>wrapPage(await newPage(),'http://localhost:3010');return context;};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});await use(proxy);},
 page:async({page,baseURL},use)=>{await use(wrapPage(page,baseURL));},
 request:async({request,baseURL},use)=>{const auth=await sessionFor(baseURL);if(auth){const proxy=new Proxy(request,{get(target,key){if(['get','post','put','delete','patch','fetch','head'].includes(key))return (url,options={})=>target[key](url,{...options,headers:{Cookie:auth.cookie,'X-CSRF-Token':auth.csrfToken,...options.headers}});const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});await use(proxy);}else await use(request);}
});
module.exports={test,expect:base.expect};
