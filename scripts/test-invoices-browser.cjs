const {spawn}=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
module.exports=async function runInvoiceBrowser({url,file,productId,edgeBinary}){
 let edge,ws;try{
 const port=await new Promise(r=>{const s=require('node:net').createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
 edge=spawn(edgeBinary,['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port='+port,'--user-data-dir='+path.resolve('work/edge-invoices-'+Date.now()),'about:blank'],{windowsHide:true,stdio:'ignore'});
 let target;for(let i=0;i<100;i++){try{target=await(await fetch('http://127.0.0.1:'+port+'/json/new?'+url,{method:'PUT'})).json();break;}catch{await pause(100);}}assert.ok(target,'Navegador deve iniciar');
 ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));let seq=0;const pending=new Map(),errors=[];
 ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);});
 const cmd=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const r=await cmd('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 const wait=async expression=>{for(let i=0;i<120;i++){if(await evaluate(expression))return;await pause(50);}throw Error('Timeout: '+expression);};
 const click=text=>evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(text)}).click()`);
 await cmd('Runtime.enable');await cmd('Page.enable');await wait("document.querySelector('[name=username]')");
 await evaluate("document.querySelector('[name=username]').value='invoices-test';document.querySelector('[name=password]').value='synthetic-password-123';document.querySelector('form').requestSubmit()");
 await wait("document.querySelector('nav')");await click('Notas fiscais');await wait("document.querySelector('main h1')?.textContent==='Notas fiscais'&&document.querySelector('main section[aria-busy]')?.getAttribute('aria-busy')==='false'");
 // Regressão: style de label não pode fazer checkbox escondido reaparecer.
 assert.equal(await evaluate("[...document.querySelectorAll('.invoice-picker label')].filter(x=>x.textContent.includes('Confirmo')).every(x=>getComputedStyle(x).display==='none')"),true,'Confirmação inativa deve ficar oculta sem produto');
 // Regressão: consulta lenta de filtro não deve reabrir página após outra navegação.
 await evaluate(`window.originalFetch=window.fetch;window.fetch=async(...args)=>{if(String(args[0]).includes('invoices/products/'))await new Promise(r=>setTimeout(r,600));return window.originalFetch(...args);};history.pushState(null,'','?view=invoices&productId=${productId}');dispatchEvent(new PopStateEvent('popstate'))`);
 await pause(150);await click('Visão geral');await wait("document.querySelector('main h1')?.textContent==='Estoque da Graal'");await pause(900);
 assert.equal(await evaluate("document.querySelector('main .invoice-filters')===null&&new URLSearchParams(location.search).get('view')==='overview'"),true,'Resposta tardia não pode mudar aba/URL');
 await evaluate('window.fetch=window.originalFetch');await click('Notas fiscais');await wait("document.querySelector('.invoice-filters')");
 await click('Anexar nota fiscal');await wait("document.querySelector('dialog[open] [name=invoiceFile]')");
 async function choose(){const dom=await cmd('DOM.getDocument');const field=await cmd('DOM.querySelector',{nodeId:dom.root.nodeId,selector:'dialog[open] [name=invoiceFile]'});await cmd('DOM.setFileInputFiles',{nodeId:field.nodeId,files:[file]});await evaluate("document.querySelector('[name=invoiceFile]').dispatchEvent(new Event('change'));document.querySelector('[name=invoiceName]').value='Nota Browser Sintética'");}
 await choose();await evaluate("document.querySelector('dialog[open] form').requestSubmit()");await wait("!document.querySelector('dialog[open]')&&document.querySelector('main table')?.textContent.includes('Nota Browser Sintética')");
 await click('Anexar nota fiscal');await choose();await evaluate("document.querySelector('dialog[open] form').requestSubmit()");await wait("document.querySelector('dialog[open]')?.textContent.includes('PDF já cadastrado')");
 await click('Revisar vínculo existente');await wait("document.querySelector('dialog[open]')&&!document.querySelector('dialog[open] [name=invoiceFile]')");await evaluate("document.querySelector('[name=invoiceLink]').value='linked';document.querySelector('[name=invoiceLink]').dispatchEvent(new Event('change'));const s=document.querySelector('dialog[open] input[type=search]');s.value='memoria audio nf inativa';s.dispatchEvent(new Event('input'))");await wait("document.querySelector('dialog[open]')?.textContent.includes('Selecionar produto')");await click('Selecionar produto');await evaluate("document.querySelector('dialog[open] form').requestSubmit()");await wait("document.querySelector('dialog[open] .error')?.textContent.includes('Confirme')");
 await evaluate("document.querySelector('dialog[open] input[type=checkbox]').checked=true;document.querySelector('dialog[open] form').requestSubmit()");await wait("!document.querySelector('dialog[open]')&&document.querySelector('main table')?.textContent.includes('Memória ÁUDIO NF inativa')");
 await click('Produtos');await wait("document.querySelector('main [name=q]')");await evaluate("document.querySelector('main [name=q]').value='Memória ÁUDIO NF';document.querySelector('main form').requestSubmit()");await wait("document.querySelector('main table')?.textContent.includes('Memória ÁUDIO NF')");await evaluate("[...document.querySelectorAll('main table button')].find(b=>b.textContent==='Armários').click()");await wait("document.querySelector('dialog[open] h3')?.textContent==='Notas fiscais'");await click('Anexar nota a este produto');await wait("document.querySelector('dialog:last-of-type [name=invoiceLink]')?.value==='linked'");await evaluate("[...document.querySelectorAll('dialog')].forEach(d=>d.close())");
 await click('Notas fiscais');await wait("document.querySelector('main h1')?.textContent==='Notas fiscais'&&document.querySelector('main section[aria-busy]')?.getAttribute('aria-busy')==='false'");
 await cmd('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 assert.equal(await evaluate("document.documentElement.scrollWidth<=window.innerWidth+1"),true,'Layout móvel não deve exceder largura');
 const shot=await cmd('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync('work/invoices-mobile.png',Buffer.from(shot.data,'base64'));
 assert.deepEqual(errors,[]);await cmd('Browser.close');return 'OK navegador: envio/duplicidade/inativo/produto, navegação concorrente e móvel390';
 }finally{ws?.close();if(edge&&!edge.killed)edge.kill();}
};
