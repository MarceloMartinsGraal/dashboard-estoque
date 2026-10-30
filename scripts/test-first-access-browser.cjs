const {spawn}=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
module.exports=async function runFirstAccess({url,edgeBinary}){
 let edge,ws;try{
 const port=await new Promise(r=>{const s=require('node:net').createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
 edge=spawn(edgeBinary,['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port='+port,'--user-data-dir='+path.resolve('work/edge-first-access-'+Date.now()),'about:blank'],{windowsHide:true,stdio:'ignore'});
 let target;for(let i=0;i<100;i++){try{target=await(await fetch('http://127.0.0.1:'+port+'/json/new?'+url,{method:'PUT'})).json();break;}catch{await pause(100);}}assert.ok(target);
 ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));let seq=0;const pending=new Map(),errors=[],paths=[];
 ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);else if(m.method==='Network.requestWillBeSent')paths.push(new URL(m.params.request.url).pathname);});
 const cmd=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const r=await cmd('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error('Falha de avaliação no navegador sintético');return r.result.value;};
 const wait=async expression=>{for(let i=0;i<120;i++){if(await evaluate(expression))return;await pause(50);}throw Error('Timeout: '+expression);};
 await cmd('Runtime.enable');await cmd('Page.enable');await cmd('Network.enable');await wait("document.querySelector('[name=username]')");
 await evaluate("document.querySelector('[name=username]').value='admin';document.querySelector('[name=password]').value='admin';document.querySelector('form').requestSubmit()");
 await wait("document.querySelector('h1')?.textContent==='Primeiro acesso'");assert.equal(await evaluate("document.querySelector('nav')===null"),true);
 await cmd('Page.navigate',{url:url+'?view=products'});await wait("document.querySelector('h1')?.textContent==='Primeiro acesso'");assert.equal(await evaluate("document.querySelector('nav')===null"),true);
 assert.equal(paths.some(p=>['/api/catalog','/api/products','/api/employees','/api/invoices'].includes(p)),false);
 const image=await cmd('Page.captureScreenshot',{format:'png'});fs.writeFileSync('work/first-access-screen.png',Buffer.from(image.data,'base64'));
 await evaluate("document.querySelector('[name=newPassword]').value='senha-nova-browser-321';document.querySelector('[name=confirmPassword]').value='senha-divergente-456';document.querySelector('form').requestSubmit()");await wait("document.querySelector('.error')?.textContent.includes('confirmação')");
 await evaluate("document.querySelector('[name=confirmPassword]').value='senha-nova-browser-321';document.querySelector('form').requestSubmit()");await wait("document.querySelector('[name=username]')");assert.equal(await evaluate("document.querySelector('nav')===null"),true);
 await evaluate("document.querySelector('[name=username]').value='admin';document.querySelector('[name=password]').value='senha-nova-browser-321';document.querySelector('form').requestSubmit()");await wait("document.querySelector('nav')");
 await evaluate("[...document.querySelectorAll('nav button')].find(b=>b.textContent==='Produtos').click()");await wait("document.querySelector('main h1')?.textContent==='Produtos'");assert.ok(paths.includes('/api/products'));
 assert.deepEqual(errors,[]);await cmd('Browser.close');return 'OK primeiro acesso restrito, recarga/rota bloqueada, confirmação, troca e novo login';
 }finally{ws?.close();if(edge&&!edge.killed)edge.kill();}
};
