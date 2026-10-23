import { api } from './api';
import { quantity } from './format';
type Candidate=Record<string,any>;
export function productMatchReview(dialog:HTMLDialogElement,use:(p:Candidate)=>Promise<unknown>) {
  const description=dialog.querySelector<HTMLInputElement>('[name=description]')!;
  const area=document.createElement('section');area.setAttribute('aria-live','polite');
  const distinct=document.createElement('input');distinct.type='checkbox';
  const label=document.createElement('label');label.append(distinct,document.createTextNode(' É um produto diferente dos candidatos revisados'));
  const reason=document.createElement('textarea');reason.maxLength=500;reason.placeholder='Justificativa (5 a 500 caracteres)';
  const reasonLabel=document.createElement('label');reasonLabel.append('Justificativa de produto distinto',reason);
  dialog.querySelector('form')!.append(area,label,reasonLabel);
  let timer:ReturnType<typeof setTimeout>,generation=0,lastDescription='',lastIds:string[]=[];
  const line=(text:string)=>{const p=document.createElement('p');p.textContent=text;return p;};
  async function load(page=1):Promise<any>{
    const seq=++generation,value=description.value.trim();area.replaceChildren(line('Consultando possíveis duplicatas…'));
    try {
      const r=await api('product-matches?'+new URLSearchParams({description:value,page:String(page),limit:'20'}));
      if(seq!==generation||description.value.trim()!==value)return null;
      if(lastDescription!==value||JSON.stringify(lastIds)!==JSON.stringify(r.candidateIds)){distinct.checked=false;reason.value='';}
      lastIds=r.candidateIds;lastDescription=value;area.replaceChildren(line(r.total?`${r.total} possíveis correspondências, incluindo inativos e sem saldo.`:'Nenhuma correspondência encontrada nesta consulta.'));
      for(const p of r.items){const row=document.createElement('article');const b=document.createElement('button');b.type='button';b.textContent='Usar produto existente';b.onclick=async()=>{b.disabled=true;try{await use(p);dialog.close();}catch(e){area.prepend(line('Não foi possível abrir o produto: '+(e as Error).message));}finally{b.disabled=false;}};row.append(line(p.description),line(`ID: ${p.id} · ${p.unit} · ${p.active?'Ativo':'Inativo: solicite revisão, sem reativação automática'} · saldo ${quantity(p.quantity)} · ${p.category??'Sem categoria'} / ${p.subcategory??'Sem subcategoria'}${p.technicalDifferences?' · Especificações diferentes no texto':''}`),b);area.append(row);}
      for(const [text,target,disabled] of [['Anterior',page-1,page<=1],['Próxima',page+1,page*r.limit>=r.total]] as const){const b=document.createElement('button');b.type='button';b.textContent=text;b.disabled=disabled;b.onclick=()=>{void load(target).catch(()=>{});};area.append(b);}
      return r;
    }catch(e){if(seq===generation){lastIds=[];lastDescription='';area.replaceChildren(line('Falha na consulta: '+(e as Error).message));}throw e;}
  }
  description.addEventListener('input',()=>{clearTimeout(timer);generation++;distinct.checked=false;if(description.value.trim())timer=setTimeout(()=>{void load().catch(()=>{});},300);});
  return async()=>{
    clearTimeout(timer);const r=await load();if(!r)throw new Error('Descrição alterada; consulte novamente.');
    if(!r.total)return undefined;
    if(!distinct.checked||reason.value.trim().length<5)throw new Error('Revise os candidatos. Se for produto diferente, confirme e justifique antes de salvar.');
    return {candidateIds:r.candidateIds,justification:reason.value.trim()};
  };
}
