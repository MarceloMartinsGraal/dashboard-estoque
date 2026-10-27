let csrf = '';
export async function api(path: string, body?: unknown): Promise<any> {
  const response = await fetch('/api/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers:
      body === undefined
        ? {}
        : { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return readResponse(response,path);
}
export class ApiError extends Error {constructor(message:string,public status:number,public data:Record<string,any>){super(message);}}
async function readResponse(response:Response,path:string){
  const result = await response
    .json()
    .catch(() => ({ message: 'Resposta indisponível' }));
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('auth/'))
      window.dispatchEvent(new CustomEvent('session-expired'));
    throw new ApiError(result.message ?? 'Não foi possível concluir a operação',response.status,result);
  }
  if (result.csrf) csrf = result.csrf;
  return result;
}

export async function uploadInvoice(file:File,data:{name:string;productId:string|null;confirmInactive:boolean}) {
 const response=await fetch('/api/invoices',{method:'POST',credentials:'same-origin',headers:{
  'Content-Type':'application/pdf','x-csrf-token':csrf,'x-file-name':encodeURIComponent(file.name),
  'x-invoice-name':encodeURIComponent(data.name),'x-product-id':data.productId??'','x-confirm-inactive':String(data.confirmInactive),
 },body:file});
 return readResponse(response,'invoices');
}
