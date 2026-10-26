/* SPDX-License-Identifier: GPL-3.0-or-later */
(() => {
  'use strict';
  const C = window.EstoqueGraalCore;
  if (!C) return;
  const labels = {entrada:'↓ Entrada',saida:'↑ Saída',estorno:'Estorno',realocacao:'Realocação',prepared:'Aguardando confirmação',sending:'Enviando',done:'Concluído',rejected:'Rejeitado',unknown:'Resultado ainda não confirmado'};
  function el(tag, text = '') { const n = document.createElement(tag); n.textContent = text; return n; }
  function start(root) {
    if (root.dataset.egReady) return;
    root.dataset.egReady = '1';
    const q = s => root.querySelector(s);
    const feedback=q('[data-eg-feedback]'), movement=q('[data-eg-movement]'), create=q('[data-eg-create]');
    const searchVersion=new C.Latest(), selectionVersion=new C.Latest(), locationVersion=new C.Latest(), historyVersion=new C.Latest(), intentVersion=new C.Latest();
    const matchVersion=new C.Latest();let matchTimer,matchData=null,matchDescription='';
    let optionsReady=false,productOptions={categories:[],subcategories:[]};
    let balanceReady=false,locationsReady=false;const readVersions=new Map();
    let timer, page=1, historyPage=1, locationPage=1, product=null, intent=null, preparing=false, writing=false;
    const canMove=root.dataset.move==='1', canCreate=root.dataset.create==='1';
    function say(text,error=false) { feedback.textContent=text; feedback.setAttribute('role',error?'alert':'status'); }
    function diagnostic(error) {
      return `${error.message} [ação: ${error.action||'interface'}; status: ${error.status??'local'}; requestId: ${error.requestId||'indisponível'}]`;
    }
    function sectionError(selector,error,retry) {
      const node=q(selector);node.setAttribute('role','alert');node.replaceChildren(el('span',diagnostic(error)));
      if(retry){const button=el('button','Tentar consulta novamente');button.type='button';button.addEventListener('click',()=>{void retry();});node.append(button);}
    }
    async function call(action,data={}) {
      let response;
      try {response=await fetch(root.dataset.endpoint,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8','X-Requested-With':'XMLHttpRequest','X-Glpi-Csrf-Token':root.dataset.csrf},body:new URLSearchParams({action,ticketId:root.dataset.ticket,data:JSON.stringify(data),_glpi_csrf_token:root.dataset.csrf})});}
      catch {throw Object.assign(new Error('Falha de comunicação com o GLPI.'),{action,status:0});}
      let result;try {result=await response.json();}catch {throw Object.assign(new Error('Resposta inválida ou sessão/CSRF indisponível. Recarregue a aba.'),{action,status:response.status,requestId:/^[a-f0-9]{32}$/i.test(response.headers.get('X-EstoqueGraal-Request-Id')||'')?response.headers.get('X-EstoqueGraal-Request-Id'):undefined});}
      if(result.csrf)root.dataset.csrf=result.csrf;
      if(!response.ok||!result.ok)throw Object.assign(new Error(result.message||'Não foi possível concluir a solicitação.'),{action,status:response.status,requestId:/^[a-f0-9]{32}$/i.test(result.requestId||'')?result.requestId:undefined});
      return result.data;
    }
    const safe=(fn,section)=>(...args)=>{if(args[0]?.type==='submit')args[0].preventDefault();return Promise.resolve().then(()=>fn(...args)).catch(e=>section?sectionError(section,e):say(diagnostic(e),true));};
    async function read(action,statusSelector,containerSelector,data,render,retry) {
      const version=(readVersions.get(action)||0)+1;readVersions.set(action,version);
      const container=q(containerSelector),status=q(statusSelector);container.setAttribute('aria-busy','true');status.setAttribute('role','status');status.textContent='Carregando…';
      try {
        const result=await call(action,data);if(readVersions.get(action)!==version||!root.isConnected)return null;
        const message=render(result);status.textContent=typeof message==='string'?message:'';return result;
      }catch(error){if(!error.action){error.action=action;error.status='renderização local';}if(readVersions.get(action)===version)sectionError(statusSelector,error,retry);return null;}
      finally {if(readVersions.get(action)===version)container.setAttribute('aria-busy','false');}
    }
    function paging(prev,next,current,total,limit) {prev.disabled=current<=1;next.disabled=current*limit>=total;}
    async function search() {
      const generation=searchVersion.invalidate();
      return read('search','[data-eg-search-status]','[data-eg-products]',{q:q('[data-eg-search]').value,page,includeWithoutStock:q('[data-eg-include-zero]').checked},r=>{
        if(!searchVersion.current(generation))return;
        const rows=el('div');
        for(const p of r.items){
          const card=el('article');card.className='eg-product';card.append(el('strong',p.description||'Descrição pendente'),el('p',`Código/ID: ${p.legacyId||p.id} · ${C.quantity(p.quantity)} ${p.unit} · ${p.active?'Ativo':'Inativo'}`));
          card.append(el('p','Armários: '+(Array.isArray(p.locations)&&p.locations.length?p.locations.map(l=>`${l.code==='NAO_INFORMADA'?'Localização não informada':l.code+' · '+l.name}${l.active?'':' (inativo)'}: ${C.quantity(l.quantity)}`).join('; '):'Sem quantidade atribuída a armários.')));
          if(!C.positive(p.quantity))card.append(el('p','Sem saldo disponível para saída. Pode receber entrada se a base operacional estiver inicializada.'));
          const select=el('button','Selecionar e ver armários');select.type='button';select.addEventListener('click',safe(()=>selectProduct(p)));card.append(select);rows.append(card);
        }
        if(!r.items.length){
          rows.append(el('p',q('[data-eg-include-zero]').checked?'Nenhum produto ativo encontrado, incluindo a pesquisa sem saldo. Revise antes de cadastrar.':'Nenhum produto com saldo encontrado. Pesquisar também produtos sem saldo.'));
          if(!q('[data-eg-include-zero]').checked){const include=el('button','Pesquisar também produtos sem saldo');include.type='button';include.addEventListener('click',safe(()=>{q('[data-eg-include-zero]').checked=true;page=1;return search();}));rows.append(include);}
        }
        q('[data-eg-products]').replaceChildren(rows);q('[data-eg-page]').textContent=`Página ${page} · ${r.total} produtos`;
        paging(q('[data-eg-prev]'),q('[data-eg-next]'),page,r.total,r.limit);
      },search);
    }
    function displayBalances(b) {
      const list=el('ul');for(const l of b.locations)list.append(el('li',`${l.code==='NAO_INFORMADA'?'Localização não informada':l.code+' · '+l.name}${l.active?'':' (inativo)'}: ${C.quantity(l.quantity)} ${b.unit}`));
      if(!b.locations.length)list.append(el('li','Sem quantidade atribuída a armários.'));
      q('[data-eg-distribution]').replaceChildren(list);
    }
    function movementEnabled() {
      q('[data-eg-review]').disabled=!balanceReady||!locationsReady||!canMove||!product?.active||!product?.openingDate||(movement.elements.kind.value==='saida'&&!C.positive(product.quantity));
    }
    async function balances(p) {
      balanceReady=false;movementEnabled();
      const result=await read('balances','[data-eg-balance-status]','[data-eg-distribution]',{productId:p.id},b=>{
        if(product?.id!==p.id)return;
        product={...p,quantity:b.total,openingDate:b.openingDate,active:b.active};balanceReady=true;displayBalances(b);
        q('[data-eg-product-info]').textContent=`Saldo: ${C.quantity(b.total)} ${b.unit}. ${!b.active?'Produto inativo: não pode ser movimentado. ':''}${b.openingDate?'Base operacional inicializada.':'Abertura pendente: concilie no dashboard antes de movimentar. Nenhuma abertura legada será criada aqui.'}`;
      },()=>balances(p));movementEnabled();return result;
    }
    async function selectProduct(p) {
      const version=selectionVersion.invalidate();locationVersion.invalidate();readVersions.set('locations',(readVersions.get('locations')||0)+1);
      product=p;balanceReady=false;locationsReady=false;movement.elements.kind.value=C.positive(p.quantity)?'saida':'entrada';movementEnabled();q('[data-eg-movement]').setAttribute('aria-busy','false');
      movement.elements.locationId.replaceChildren(new Option('Selecione explicitamente um armário',''));
      const selected=q('[data-eg-selected]');selected.hidden=false;selected.setAttribute('aria-busy','true');
      const heading=q('[data-eg-product-name]');heading.textContent=p.description||'Descrição pendente';heading.tabIndex=-1;heading.focus();selected.scrollIntoView({block:'start',behavior:'smooth'});
      q('[data-eg-product-info]').textContent='Consulte o saldo atualizado abaixo.';q('[data-eg-distribution]').replaceChildren();q('[data-eg-location-status]').textContent='';
      try {const result=await balances(p);if(!selectionVersion.current(version))return;if(result)movement.elements.kind.value=C.positive(result.total)?'saida':'entrada';await locations(true);}
      finally {if(selectionVersion.current(version))selected.setAttribute('aria-busy','false');}
    }
    async function locations(reset) {
      if(!product)return;const generation=locationVersion.invalidate(), id=product.id, purpose=movement.elements.kind.value;
      locationsReady=false;movementEnabled();q('[data-eg-more-locations]').disabled=true;
      if(reset){locationPage=1;movement.elements.locationId.replaceChildren(new Option('Selecione explicitamente um armário',''));}
      const r=await read('locations','[data-eg-location-status]','[data-eg-movement]',{productId:id,purpose,page:locationPage},r=>{
        if(!locationVersion.current(generation)||product?.id!==id||movement.elements.kind.value!==purpose)return;
        for(const l of r.items)movement.elements.locationId.append(new Option(`${l.code==='NAO_INFORMADA'?'Localização não informada':l.code+' · '+l.name} — ${C.quantity(l.quantity)} unidade`,l.id));
        q('[data-eg-more-locations]').hidden=locationPage*r.limit>=r.total;locationsReady=true;
        return !r.total?(purpose==='saida'?'Sem localização ativa com disponibilidade para saída.':'Nenhum armário ativo elegível para entrada.'):'Armários carregados. Selecione um explicitamente.';
      },()=>locations(true));if(locationVersion.current(generation))q('[data-eg-more-locations]').disabled=false;movementEnabled();return r;
    }
    async function refreshReads() {
      const selected=product;
      await Promise.allSettled([...(selected?[balances(selected),locations(true)]:[]),history(),search(),intents()]);
    }
    function summary(i) {
      if(i.operation==='product'){const category=productOptions.categories.find(c=>c.id===i.summary.categoryId)?.name||i.summary.categoryId||'Não classificada';const sub=productOptions.subcategories.find(c=>c.id===i.summary.subcategoryId)?.name||i.summary.subcategoryId||'Não informada';return `Cadastrar produto “${i.summary.description}” · Categoria: ${category} · Subcategoria: ${sub} · ${i.summary.active===false?'Inativo':'Ativo'}, em unidades. Sem quantidade inicial. Contexto: chamado ${root.dataset.ticket}.`;}
      const location=[...movement.elements.locationId.options].find(o=>o.value===i.summary.locationId)?.textContent||i.summary.locationId;
      return `${labels[i.summary.kind]} · ${product?.id===i.summary.productId?product.description:i.summary.productId} · ${C.quantity(i.summary.quantity)} unidade · ${location} · data ${i.summary.eventDate} · motivo ${i.summary.reason} · chamado ${root.dataset.ticket}. ${i.summary.observation||''}`;
    }
    function showIntent(i) {
      intentVersion.invalidate();intent=i;q('[data-eg-confirm]').hidden=false;q('[data-eg-summary]').textContent=summary(i);q('[data-eg-state]').textContent=labels[i.state]||i.state;
      q('[data-eg-ack]').checked=false;updateIntentButtons();q('[data-eg-confirm] h4').focus();
      if(i.state==='rejected')say(i.result?.message||'Operação rejeitada.',true);
      if(i.state==='unknown')say(i.result?.message||'Resultado ainda não confirmado. Consulte a intenção antes de uma nova operação.',true);
    }
    function updateIntentButtons() {
      const pending=intent&&['sending','unknown'].includes(intent.state);
      q('[data-eg-confirm-button]').disabled=writing||!intent||intent.state!=='prepared'||!q('[data-eg-ack]').checked;
      q('[data-eg-confirm-button]').hidden=!!intent&&intent.state!=='prepared';
      q('[data-eg-recover]').hidden=!pending;q('[data-eg-recover]').disabled=writing;
      q('[data-eg-retry]').hidden=!intent||!['unknown','rejected'].includes(intent.state);q('[data-eg-retry]').disabled=writing||!q('[data-eg-ack]').checked;
      q('[data-eg-cancel]').disabled=writing||pending;
    }
    async function prepare(operation,payload) {
      if(preparing||writing)return;
      if(intent&&['sending','unknown'].includes(intent.state))throw new Error('Resolva a intenção com resultado desconhecido antes de iniciar outra operação.');
      const generation=intentVersion.invalidate();preparing=true;try{const result=await call('prepare',{operation,payload});if(intentVersion.current(generation))showIntent(result);}finally{preparing=false;}
    }
    async function finish(i) {
      showIntent(i);if(i.state!=='done')return;
      say(i.operation==='product'?(i.summary.active===false?'Produto cadastrado inativo, sem quantidade. Solicite revisão da situação no dashboard antes de movimentar.':'Produto cadastrado sem quantidade. A primeira entrada deve ser confirmada separadamente.'):'Movimentação confirmada. Consulte os resultados de atualização em cada seção; não repita a operação.');
      if(i.operation==='product'){
        create.hidden=true;const p={id:i.result.id,description:i.summary.description,unit:'unidade',active:i.summary.active!==false,quantity:'0.000',openingDate:null};
        await selectProduct(p);movement.elements.kind.value='entrada';await Promise.allSettled([history(),search(),intents()]);return;
      }
      await refreshReads();
    }
    async function send(retry=false) {
      if(writing||!intent||!q('[data-eg-ack]').checked)return;
      if(retry&&!window.confirm('Consultar e, se necessário, reenviar exatamente a mesma intenção e chave?'))return;
      const sent=intent;intentVersion.invalidate();writing=true;q('[data-eg-state]').textContent='Enviando…';updateIntentButtons();
      try {await finish(await call('execute',{key:sent.key,retry}));}
      catch(e){if(intent?.key!==sent.key)return;if(intent?.state==='done'){say('Operação confirmada, mas a atualização da tela falhou. Consulte o histórico; não repita a operação. '+diagnostic(e),true);}else{intent.state='unknown';showIntent(intent);say('Resultado ainda não confirmado. Use Consultar resultado. '+diagnostic(e),true);}}
      finally{writing=false;updateIntentButtons();}
    }
    async function recover(){if(writing||preparing||!intent)return;intentVersion.invalidate();writing=true;updateIntentButtons();try{await finish(await call('recover',{key:intent.key}));}finally{writing=false;updateIntentButtons();}}
    async function resumeIntent(i) {
      if(preparing||writing)return;const generation=intentVersion.invalidate(),node=q('[data-eg-intent-status]');node.textContent='Consultando intenção…';
      try {const result=await call('intent',{key:i.key});if(intentVersion.current(generation)&&!preparing&&!writing){node.textContent='';showIntent(result);}}
      catch(error){if(intentVersion.current(generation)&&!preparing&&!writing)sectionError('[data-eg-intent-status]',error,()=>resumeIntent(i));}
    }
    async function intents() {
      return read('intents','[data-eg-intents-status]','[data-eg-intents]',{},r=>{
      const list=el('ul');
      for(const i of r){const li=el('li',`${i.operation==='product'?'Cadastro':'Movimentação'} · ${labels[i.state]||i.state} `),b=el('button','Retomar intenção');b.type='button';b.addEventListener('click',safe(()=>resumeIntent(i),'[data-eg-intent-status]'));li.append(b);list.append(li);}
      q('[data-eg-intents]').replaceChildren(r.length?list:el('p','Nenhuma operação pendente.'));
      },intents);
    }
    async function history() {
      const generation=historyVersion.invalidate();
      return read('history','[data-eg-history-status]','[data-eg-history]',{page:historyPage},r=>{
      if(!historyVersion.current(generation))return;
      const table=el('table'),head=el('thead'),tr=el('tr');
      for(const name of ['Operação','Produto','Quantidade','Armário','Data','Responsável','Situação'])tr.append(el('th',name));head.append(tr);table.append(head);
      const body=el('tbody');
      for(const m of r.items){const row=el('tr');const locations=m.locations.map(l=>(l.code==='NAO_INFORMADA'?'Localização não informada':l.code+' · '+l.name)+(l.delta!==null?' (variação: '+C.quantity(l.delta)+')':'')).join(', ');
        const status=m.reversal_of?'Estorno do movimento '+m.reversal_of:m.reversed_by?'Estornado pelo movimento '+m.reversed_by:'Confirmado';
        for(const text of [labels[m.kind]||m.kind,m.description,`${C.quantity(m.quantity)} ${m.unit}`,locations,m.event_date,m.author,status])row.append(el('td',text??'—'));body.append(row);}
      table.append(body);q('[data-eg-history]').replaceChildren(r.items.length?table:el('p','Nenhuma movimentação vinculada a este chamado.'));q('[data-eg-history-page]').textContent=`Página ${historyPage} · ${r.total} movimentos`;
      paging(q('[data-eg-history-prev]'),q('[data-eg-history-next]'),historyPage,r.total,r.limit);
      },history);
    }
    q('[data-eg-search]').addEventListener('input',()=>{clearTimeout(timer);searchVersion.invalidate();readVersions.set('search',(readVersions.get('search')||0)+1);page=1;timer=setTimeout(safe(search),300);});
    q('[data-eg-include-zero]').addEventListener('change',safe(()=>{clearTimeout(timer);page=1;return search();}));
    q('[data-eg-search-button]').addEventListener('click',safe(()=>{clearTimeout(timer);page=1;return search();}));
    q('[data-eg-prev]').addEventListener('click',safe(()=>{page--;return search();}));q('[data-eg-next]').addEventListener('click',safe(()=>{page++;return search();}));
    movement.elements.kind.addEventListener('change',safe(()=>locations(true)));q('[data-eg-more-locations]').addEventListener('click',safe(()=>{if(q('[data-eg-more-locations]').disabled)return;locationPage++;return locations(false);}));
    movement.addEventListener('submit',safe(e=>{e.preventDefault();if(!product||!canMove||!movement.reportValidity())return;const data=Object.fromEntries(new FormData(movement));data.quantity=C.inputQuantity(data.quantity);return prepare('movement',{...data,productId:product.id});}));
    function subcategoryChoices() {
      const selected=create.elements.subcategoryId.value;
      // As opções e valores são os mesmos do catálogo real; a UI não oferece pares inválidos.
      create.elements.subcategoryId.replaceChildren(new Option('Não informada',''));
      for(const sub of productOptions.subcategories.filter(s=>s.category_id===create.elements.categoryId.value))create.elements.subcategoryId.append(new Option((productOptions.categories.find(c=>c.id===sub.category_id)?.name||'')+' / '+sub.name,sub.id));
      if([...create.elements.subcategoryId.options].some(o=>o.value===selected))create.elements.subcategoryId.value=selected;
    }
    async function loadProductOptions() {
      optionsReady=false;
      return read('product_options','[data-eg-options-status]','[data-eg-create]',{},r=>{
        if(!Array.isArray(r.categories)||!Array.isArray(r.subcategories))throw new Error('Opções de cadastro indisponíveis. Confira a atualização do backend.');
        const selected=create.elements.categoryId.value;productOptions=r;
        create.elements.categoryId.replaceChildren(new Option('Não classificada',''));
        for(const c of r.categories)create.elements.categoryId.append(new Option(c.name,c.id));
        if([...create.elements.categoryId.options].some(o=>o.value===selected))create.elements.categoryId.value=selected;
        subcategoryChoices();optionsReady=true;
      },loadProductOptions);
    }
    q('[data-eg-create-toggle]').addEventListener('click',safe(()=>{create.hidden=false;create.elements.description.focus();return loadProductOptions();},'[data-eg-options-status]'));
    q('[data-eg-create-cancel]').addEventListener('click',()=>{create.hidden=true;});
    create.elements.categoryId.addEventListener('change',subcategoryChoices);
    q('[data-eg-distinct]').addEventListener('change',()=>{q('[data-eg-reason-label]').hidden=!q('[data-eg-distinct]').checked;q('[data-eg-distinct-reason]').required=q('[data-eg-distinct]').checked;});
    async function matches(page=1) {
      const generation=matchVersion.invalidate(), description=create.elements.description.value.trim();
      const area=q('[data-eg-matches]');area.textContent='Consultando possíveis duplicatas em todo o catálogo…';
      try {
        const r=await call('matches',{description,page});if(!matchVersion.current(generation)||description!==create.elements.description.value.trim())return null;
        if(!Array.isArray(r.items)||!Array.isArray(r.candidateIds))throw new Error('Resposta de candidatos indisponível. Atualize o backend compatível.');
        if(matchDescription!==description||JSON.stringify(matchData?.candidateIds)!==JSON.stringify(r.candidateIds)){q('[data-eg-distinct]').checked=false;q('[data-eg-distinct-reason]').value='';}
        q('[data-eg-distinct-label]').hidden=!r.total;q('[data-eg-reason-label]').hidden=!r.total||!q('[data-eg-distinct]').checked;q('[data-eg-distinct-reason]').required=!!r.total&&q('[data-eg-distinct]').checked;
        matchData=r;matchDescription=description;area.replaceChildren(el('p',r.total?`${r.total} possíveis correspondências (inclui inativos e sem saldo).`:'Nenhuma correspondência encontrada nesta consulta.'));
        for(const p of r.items){const row=el('article');row.append(el('strong',p.description),el('p',`ID: ${p.id} · ${p.unit} · ${p.active?'Ativo':'Inativo — solicite revisão no dashboard; não será reativado'} · saldo ${C.quantity(p.quantity)} · ${p.category||'Sem categoria'} / ${p.subcategory||'Sem subcategoria'}${p.technicalDifferences?' · Atenção: especificações diferentes no texto':''}`));const use=el('button','Usar produto existente');use.type='button';use.addEventListener('click',safe(()=>{create.hidden=true;return selectProduct(p);}));row.append(use);area.append(row);}
        for(const [label,target,disabled] of [['Anterior',page-1,page<=1],['Próxima',page+1,page*r.limit>=r.total]]){const b=el('button',label);b.type='button';b.disabled=disabled;b.addEventListener('click',safe(()=>matches(target),'[data-eg-matches]'));area.append(b);}
        return r;
      }catch(e){if(matchVersion.current(generation)){matchData=null;area.textContent='Falha ao consultar possíveis duplicatas. '+e.message;}throw e;}
    }
    create.elements.description.addEventListener('input',()=>{clearTimeout(matchTimer);matchVersion.invalidate();matchData=null;matchDescription='';q('[data-eg-distinct]').checked=false;q('[data-eg-distinct-label]').hidden=true;q('[data-eg-reason-label]').hidden=true;q('[data-eg-distinct-reason]').required=false;q('[data-eg-distinct-reason]').value='';if(create.elements.description.value.trim())matchTimer=setTimeout(safe(()=>matches(),'[data-eg-matches]'),300);});
    create.addEventListener('submit',safe(async e=>{
      e.preventDefault();q('[data-eg-create-status]').textContent='';if(!canCreate||!create.reportValidity())return;if(!optionsReady)throw new Error('Aguarde ou tente novamente a consulta de categorias e subcategorias.');
      clearTimeout(matchTimer);const r=await matches();if(!r)throw new Error('Descrição alterada. Revise os candidatos novamente.');const payload={description:create.elements.description.value.trim(),categoryId:create.elements.categoryId.value||null,subcategoryId:create.elements.subcategoryId.value||null,active:create.elements.active.value==='true'};
      if(r.total){const justification=q('[data-eg-distinct-reason]').value.trim();if(!q('[data-eg-distinct]').checked||justification.length<5)throw new Error('Revise os candidatos. Para cadastrar outro produto, confirme É um produto diferente e justifique (5 a 500 caracteres).');payload.duplicateConfirmation={candidateIds:r.candidateIds,justification};}
      return prepare('product',payload);
    },'[data-eg-create-status]'));
    q('[data-eg-ack]').addEventListener('change',updateIntentButtons);q('[data-eg-confirm-button]').addEventListener('click',safe(()=>send()));q('[data-eg-retry]').addEventListener('click',safe(()=>send(true)));q('[data-eg-recover]').addEventListener('click',safe(recover));
    q('[data-eg-cancel]').addEventListener('click',()=>{if(!writing&&(!intent||!['unknown','sending'].includes(intent.state))){intentVersion.invalidate();intent=null;q('[data-eg-confirm]').hidden=true;}});
    q('[data-eg-refresh-reads]').addEventListener('click',safe(refreshReads));
    q('[data-eg-load-intents]').addEventListener('click',safe(intents));q('[data-eg-history-refresh]').addEventListener('click',safe(history));
    q('[data-eg-history-prev]').addEventListener('click',safe(()=>{historyPage--;return history();}));q('[data-eg-history-next]').addEventListener('click',safe(()=>{historyPage++;return history();}));
    safe(search)();safe(history)();safe(intents)();
  }
  const scan=()=>document.querySelectorAll('[data-eg-root]').forEach(start);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',scan);else scan();
  new MutationObserver(scan).observe(document.documentElement,{childList:true,subtree:true});
})();
