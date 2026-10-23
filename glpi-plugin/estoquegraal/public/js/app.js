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
    let timer, page=1, historyPage=1, locationPage=1, product=null, intent=null, preparing=false, writing=false;
    const canMove=root.dataset.move==='1', canCreate=root.dataset.create==='1';
    function say(text,error=false) { feedback.textContent=text; feedback.setAttribute('role',error?'alert':'status'); }
    async function call(action,data={}) {
      const response=await fetch(root.dataset.endpoint,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8','X-Requested-With':'XMLHttpRequest','X-Glpi-Csrf-Token':root.dataset.csrf},body:new URLSearchParams({action,ticketId:root.dataset.ticket,data:JSON.stringify(data),_glpi_csrf_token:root.dataset.csrf})});
      let result;try { result=await response.json(); }catch { throw new Error('Sessão ou proteção CSRF indisponível. Recarregue a aba antes de continuar.'); }
      if(result.csrf)root.dataset.csrf=result.csrf;
      if(!response.ok||!result.ok)throw new Error(result.message||'Não foi possível concluir a solicitação.');
      return result.data;
    }
    const safe=fn=>(...args)=>{if(args[0]?.type==='submit')args[0].preventDefault();return Promise.resolve().then(()=>fn(...args)).catch(e=>say(e.message,true));};
    function paging(prev,next,current,total,limit) {prev.disabled=current<=1;next.disabled=current*limit>=total;}
    async function search() {
      const generation=searchVersion.invalidate();q('[data-eg-products]').replaceChildren(el('p','Carregando produtos…'));
      try {
        const r=await call('search',{q:q('[data-eg-search]').value,page});if(!searchVersion.current(generation)||!root.isConnected)return;
        const rows=el('div');
        for(const p of r.items){
          const card=el('article');card.className='eg-product';card.append(el('strong',p.description||'Descrição pendente'),el('p',`Código/ID: ${p.legacyId||p.id} · ${C.quantity(p.quantity)} ${p.unit} · ${p.active?'Ativo':'Inativo'}`));
          if(!C.positive(p.quantity))card.append(el('p','Sem saldo disponível para saída. Pode receber entrada se a base operacional estiver inicializada.'));
          const select=el('button','Selecionar e ver armários');select.type='button';select.addEventListener('click',safe(()=>selectProduct(p)));card.append(select);rows.append(card);
        }
        if(!r.items.length)rows.append(el('p','Nenhum produto encontrado. Revise a busca antes de cadastrar.'));
        q('[data-eg-products]').replaceChildren(rows);q('[data-eg-page]').textContent=`Página ${page} · ${r.total} produtos`;
        paging(q('[data-eg-prev]'),q('[data-eg-next]'),page,r.total,r.limit);
      }catch(e){if(searchVersion.current(generation)){q('[data-eg-products]').replaceChildren(el('p',e.message));say(e.message,true);}}
    }
    function displayBalances(b) {
      const list=el('ul');for(const l of b.locations)list.append(el('li',`${l.code==='NAO_INFORMADA'?'Localização não informada':l.code+' · '+l.name}${l.active?'':' (inativo)'}: ${C.quantity(l.quantity)} ${b.unit}`));
      if(!b.locations.length)list.append(el('li','Sem quantidade atribuída a armários.'));
      q('[data-eg-distribution]').replaceChildren(list);
    }
    function movementEnabled() {
      q('[data-eg-review]').disabled=!canMove||!product?.active||!product?.openingDate||(movement.elements.kind.value==='saida'&&!C.positive(product.quantity));
    }
    async function selectProduct(p) {
      const version=selectionVersion.invalidate();locationVersion.invalidate();
      product=null;q('[data-eg-review]').disabled=true;
      movement.elements.locationId.replaceChildren(new Option('Carregando armários…',''));
      const selected=q('[data-eg-selected]');selected.hidden=false;selected.setAttribute('aria-busy','true');
      const heading=q('[data-eg-product-name]');heading.textContent=p.description||'Descrição pendente';heading.tabIndex=-1;heading.focus();selected.scrollIntoView({block:'start',behavior:'smooth'});
      q('[data-eg-product-info]').textContent='Carregando saldo e armários…';q('[data-eg-distribution]').replaceChildren();q('[data-eg-location-status]').textContent='';
      try {
        const b=await call('balances',{productId:p.id});if(!selectionVersion.current(version))return;
        product={...p,quantity:b.total,openingDate:b.openingDate,active:b.active};displayBalances(b);
        movement.elements.kind.value=C.positive(b.total)?'saida':'entrada';
        q('[data-eg-product-info]').textContent=`Saldo: ${C.quantity(b.total)} ${b.unit}. ${!b.active?'Produto inativo: não pode ser movimentado. ':''}${b.openingDate?'Base operacional inicializada.':'Abertura pendente: concilie no dashboard antes de movimentar. Nenhuma abertura legada será criada aqui.'}`;
        await locations(true);
      }catch(e){if(selectionVersion.current(version)){q('[data-eg-product-info]').textContent='Não foi possível carregar os detalhes. '+e.message;movement.elements.locationId.replaceChildren(new Option('Consulta indisponível',''));say(e.message,true);}}
      finally {if(selectionVersion.current(version)){selected.setAttribute('aria-busy','false');}}
    }
    async function locations(reset) {
      if(!product)return;const generation=locationVersion.invalidate(), id=product.id, purpose=movement.elements.kind.value;
      q('[data-eg-review]').disabled=true;const status=q('[data-eg-location-status]');status.textContent='Carregando armários…';
      if(reset){locationPage=1;movement.elements.locationId.replaceChildren(new Option('Selecione explicitamente um armário',''));}
      try {
        const r=await call('locations',{productId:id,purpose,page:locationPage});if(!locationVersion.current(generation)||product?.id!==id||movement.elements.kind.value!==purpose)return;
        for(const l of r.items)movement.elements.locationId.append(new Option(`${l.code==='NAO_INFORMADA'?'Localização não informada':l.code+' · '+l.name} — ${C.quantity(l.quantity)} unidade`,l.id));
        q('[data-eg-more-locations]').hidden=locationPage*r.limit>=r.total;
        status.textContent=!r.total?(purpose==='saida'?'Sem localização ativa com disponibilidade para saída.':'Nenhum armário ativo elegível para entrada.'):'Armários carregados. Selecione um explicitamente.';
        movementEnabled();
      }catch(e){if(locationVersion.current(generation)){status.textContent='Falha ao consultar armários. '+e.message;say(e.message,true);}throw e;}
    }
    function summary(i) {
      if(i.operation==='product')return `Cadastrar produto “${i.summary.description}”, ativo, em unidades. Sem quantidade inicial. Contexto: chamado ${root.dataset.ticket}.`;
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
      if(i.operation==='product'){
        create.hidden=true;const p={id:i.result.id,description:i.summary.description,unit:'unidade',active:true,quantity:'0.000',openingDate:null};await selectProduct(p);movement.elements.kind.value='entrada';await locations(true);
        say('Produto cadastrado sem quantidade. Selecione entrada, armário e quantidade; revise e confirme a operação separada. O cadastro não será repetido se a entrada falhar.');
      }else{
        say('Movimentação confirmada.');if(product)await selectProduct(product);
        await history();await search();
      }
      await intents();
    }
    async function send(retry=false) {
      if(writing||!intent||!q('[data-eg-ack]').checked)return;
      if(retry&&!window.confirm('Consultar e, se necessário, reenviar exatamente a mesma intenção e chave?'))return;
      const sent=intent;intentVersion.invalidate();writing=true;q('[data-eg-state]').textContent='Enviando…';updateIntentButtons();
      try {await finish(await call('execute',{key:sent.key,retry}));}
      catch(e){if(intent?.key!==sent.key)return;if(intent?.state==='done'){say('Operação confirmada, mas a atualização da tela falhou. Consulte o histórico; não repita a operação. '+e.message,true);}else{intent.state='unknown';showIntent(intent);say('Resultado ainda não confirmado. Use Consultar resultado. '+e.message,true);}}
      finally{writing=false;updateIntentButtons();}
    }
    async function recover(){if(writing||preparing||!intent)return;intentVersion.invalidate();writing=true;updateIntentButtons();try{await finish(await call('recover',{key:intent.key}));}finally{writing=false;updateIntentButtons();}}
    async function intents() {
      const r=await call('intents');const list=el('ul');
      for(const i of r){const li=el('li',`${i.operation==='product'?'Cadastro':'Movimentação'} · ${labels[i.state]||i.state} `),b=el('button','Retomar intenção');b.type='button';b.addEventListener('click',safe(async()=>{if(preparing||writing)return;const generation=intentVersion.invalidate();const result=await call('intent',{key:i.key});if(intentVersion.current(generation)&&!preparing&&!writing)showIntent(result);}));li.append(b);list.append(li);}
      q('[data-eg-intents]').replaceChildren(r.length?list:el('p','Nenhuma intenção pendente nas últimas 20 deste contexto.'));
    }
    async function history() {
      const generation=historyVersion.invalidate();q('[data-eg-history]').replaceChildren(el('p','Carregando histórico…'));
      const r=await call('history',{page:historyPage});if(!historyVersion.current(generation))return;
      const table=el('table'),head=el('thead'),tr=el('tr');
      for(const name of ['Operação','Produto','Quantidade','Armário','Data','Responsável','Situação'])tr.append(el('th',name));head.append(tr);table.append(head);
      const body=el('tbody');
      for(const m of r.items){const row=el('tr');const locations=m.locations.map(l=>(l.code==='NAO_INFORMADA'?'Localização não informada':l.code+' · '+l.name)+(l.delta!==null?' ('+C.quantity(l.delta)+')':'')).join(', ');
        const status=m.reversal_of?'Estorno do movimento '+m.reversal_of:m.reversed_by?'Estornado pelo movimento '+m.reversed_by:'Confirmado';
        for(const text of [labels[m.kind]||m.kind,m.description,`${C.quantity(m.quantity)} ${m.unit}`,locations,m.event_date,m.author,status])row.append(el('td',text??'—'));body.append(row);}
      table.append(body);q('[data-eg-history]').replaceChildren(r.items.length?table:el('p','Nenhuma movimentação vinculada a este chamado.'));q('[data-eg-history-page]').textContent=`Página ${historyPage} · ${r.total} movimentos`;
      paging(q('[data-eg-history-prev]'),q('[data-eg-history-next]'),historyPage,r.total,r.limit);
    }
    q('[data-eg-search]').addEventListener('input',()=>{clearTimeout(timer);searchVersion.invalidate();page=1;timer=setTimeout(safe(search),300);});
    q('[data-eg-search-button]').addEventListener('click',safe(()=>{clearTimeout(timer);page=1;return search();}));
    q('[data-eg-prev]').addEventListener('click',safe(()=>{page--;return search();}));q('[data-eg-next]').addEventListener('click',safe(()=>{page++;return search();}));
    movement.elements.kind.addEventListener('change',safe(()=>locations(true)));q('[data-eg-more-locations]').addEventListener('click',safe(()=>{locationPage++;return locations(false);}));
    movement.addEventListener('submit',safe(e=>{e.preventDefault();if(!product||!canMove||!movement.reportValidity())return;const data=Object.fromEntries(new FormData(movement));data.quantity=C.inputQuantity(data.quantity);return prepare('movement',{...data,productId:product.id});}));
    q('[data-eg-create-toggle]').addEventListener('click',()=>{create.hidden=false;create.elements.description.focus();});q('[data-eg-create-cancel]').addEventListener('click',()=>{create.hidden=true;});
    async function matches(page=1) {
      const generation=matchVersion.invalidate(), description=create.elements.description.value.trim();
      const area=q('[data-eg-matches]');area.textContent='Consultando possíveis duplicatas em todo o catálogo…';
      try {
        const r=await call('matches',{description,page});if(!matchVersion.current(generation)||description!==create.elements.description.value.trim())return null;
        if(!Array.isArray(r.items)||!Array.isArray(r.candidateIds))throw new Error('Resposta de candidatos indisponível. Atualize o backend compatível.');
        if(matchDescription!==description||JSON.stringify(matchData?.candidateIds)!==JSON.stringify(r.candidateIds)){q('[data-eg-distinct]').checked=false;q('[data-eg-distinct-reason]').value='';}
        matchData=r;matchDescription=description;area.replaceChildren(el('p',r.total?`${r.total} possíveis correspondências (inclui inativos e sem saldo).`:'Nenhuma correspondência encontrada nesta consulta.'));
        for(const p of r.items){const row=el('article');row.append(el('strong',p.description),el('p',`ID: ${p.id} · ${p.unit} · ${p.active?'Ativo':'Inativo — solicite revisão no dashboard; não será reativado'} · saldo ${C.quantity(p.quantity)} · ${p.category||'Sem categoria'} / ${p.subcategory||'Sem subcategoria'}${p.technicalDifferences?' · Atenção: especificações diferentes no texto':''}`));const use=el('button','Usar produto existente');use.type='button';use.addEventListener('click',safe(()=>{create.hidden=true;return selectProduct(p);}));row.append(use);area.append(row);}
        for(const [label,target,disabled] of [['Anterior',page-1,page<=1],['Próxima',page+1,page*r.limit>=r.total]]){const b=el('button',label);b.type='button';b.disabled=disabled;b.addEventListener('click',safe(()=>matches(target)));area.append(b);}
        return r;
      }catch(e){if(matchVersion.current(generation)){matchData=null;area.textContent='Falha ao consultar possíveis duplicatas. '+e.message;}throw e;}
    }
    create.elements.description.addEventListener('input',()=>{clearTimeout(matchTimer);matchVersion.invalidate();matchData=null;matchDescription='';q('[data-eg-distinct]').checked=false;if(create.elements.description.value.trim())matchTimer=setTimeout(safe(()=>matches()),300);});
    create.addEventListener('submit',safe(async e=>{
      e.preventDefault();if(!canCreate||!create.reportValidity())return;
      clearTimeout(matchTimer);const r=await matches();if(!r)throw new Error('Descrição alterada. Revise os candidatos novamente.');const payload={description:create.elements.description.value.trim()};
      if(r.total){const justification=q('[data-eg-distinct-reason]').value.trim();if(!q('[data-eg-distinct]').checked||justification.length<5)throw new Error('Revise os candidatos. Para cadastrar outro produto, confirme É um produto diferente e justifique (5 a 500 caracteres).');payload.duplicateConfirmation={candidateIds:r.candidateIds,justification};}
      return prepare('product',payload);
    }));
    q('[data-eg-ack]').addEventListener('change',updateIntentButtons);q('[data-eg-confirm-button]').addEventListener('click',safe(()=>send()));q('[data-eg-retry]').addEventListener('click',safe(()=>send(true)));q('[data-eg-recover]').addEventListener('click',safe(recover));
    q('[data-eg-cancel]').addEventListener('click',()=>{if(!writing&&(!intent||!['unknown','sending'].includes(intent.state))){intentVersion.invalidate();intent=null;q('[data-eg-confirm]').hidden=true;}});
    q('[data-eg-load-intents]').addEventListener('click',safe(intents));q('[data-eg-history-refresh]').addEventListener('click',safe(history));
    q('[data-eg-history-prev]').addEventListener('click',safe(()=>{historyPage--;return history();}));q('[data-eg-history-next]').addEventListener('click',safe(()=>{historyPage++;return history();}));
    safe(history)();safe(intents)();
  }
  const scan=()=>document.querySelectorAll('[data-eg-root]').forEach(start);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',scan);else scan();
  new MutationObserver(scan).observe(document.documentElement,{childList:true,subtree:true});
})();
