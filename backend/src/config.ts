export class ConfigurationError extends Error {}
export function integrationEnabled(value:string|undefined=process.env.INTEGRATION_ENABLED):boolean {
 if(value===undefined||value==='true')return true;
 if(value==='false')return false;
 throw new ConfigurationError('INTEGRATION_ENABLED deve ser true ou false; remova a variável para usar o padrão habilitado.');
}
