// Helper CLI real com cURL; Kernel/Config/DB GLPI são fixtures locais, não homologação GLPI.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'eg-cli-local-'));
for(const dir of ['vendor','bin','src/Glpi/Application'])fs.mkdirSync(path.join(root,dir),{recursive:true});
fs.writeFileSync(path.join(root,'bin/console'),'fixture');
fs.writeFileSync(path.join(root,'src/Glpi/Application/ResourcesChecker.php'),'<?php namespace Glpi\\Application; class ResourcesChecker {function __construct($root){}function checkResources(){}}');
fs.writeFileSync(path.join(root,'vendor/autoload.php'),`<?php
namespace Glpi\\Kernel {class Kernel {function boot(){define('GLPI_VERSION','11.0.5');}}}
namespace {class GLPIKey {function keyExists(){return true;}function isConfigSecured(...$a){return true;}function decrypt($s){return str_starts_with($s,'fixture:')?base64_decode(substr($s,8)):'';}}
class Config {static array $v=[];static function getConfigurationValues(...$a){if(!self::$v&&is_file(getcwd().'/config.json'))self::$v=json_decode(file_get_contents(getcwd().'/config.json'),true);return self::$v;}static function setConfigurationValues($c,$v){$v['token']='fixture:'.base64_encode($v['token']);self::$v=$v;file_put_contents(getcwd().'/config.json',json_encode($v));}}
$DB=new class {function beginTransaction(){}function commit(){}function rollback(){}};}
`);
let reads=0;let apiStatus=200;const token='11111111-1111-4111-8111-111111111111.'+'a'.repeat(64);
const server=http.createServer((req,res)=>{try{assert.equal(req.headers.authorization,'Bearer '+token);assert.ok(req.url.startsWith('/api/integration/v1/products?'));reads++;res.statusCode=apiStatus;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({items:[],total:0,page:1,limit:1}));}catch{res.statusCode=500;res.end('{}');}});
async function invoke(payload,action="apply"){return new Promise((resolve,reject)=>{const args=[];if(process.env.PHP_EXTENSION_DIR)args.push('-d','extension_dir='+process.env.PHP_EXTENSION_DIR,'-d','extension=curl');args.push(path.resolve('glpi-plugin/estoquegraal/tools/configure-cli.php'),action,'--root',root);const child=spawn(process.env.PHP_BINARY||'php',args,{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject);child.on('exit',status=>resolve({status,out,err}));child.stdin.end(JSON.stringify(payload));});}
(async()=>{try{await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port+'/api/integration/v1';
const payload={enabled:true,base_url:url,instance_id:'same-host',token,timeout:10,connect_timeout:3,private_http:false,deployment_mode:'production',local_http:true};
const result=await invoke(payload);assert.equal(result.status,0);assert.equal(JSON.parse(result.out).readCheck,true);const saved=JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8'));assert.equal(saved.base_url,url);assert.equal(saved.local_http,'1');assert.equal(saved.private_http,'0');assert.equal(saved.deployment_mode,'production');assert.notEqual(saved.token,token);
assert.equal((await invoke({...payload,local_http:false})).status,1);assert.equal((await invoke({...payload,base_url:'http://8.8.8.8/api/integration/v1'})).status,1);assert.equal((await invoke({...payload,local_http:'true'})).status,1);assert.equal(reads,1);
const before=fs.readFileSync(path.join(root,'config.json'),'utf8');
const probe=await invoke(payload,'probe');assert.equal(probe.status,0);assert.equal(JSON.parse(probe.out).readCheck,true);assert.equal(fs.readFileSync(path.join(root,'config.json'),'utf8'),before);
const mismatch=await invoke({...payload,instance_id:'another-instance'},'probe');assert.equal(mismatch.status,1);assert.match(mismatch.err,/"reason":"instance-mismatch"/);assert.equal(fs.readFileSync(path.join(root,'config.json'),'utf8'),before);
apiStatus=403;const denied=await invoke(payload,'probe');assert.equal(denied.status,1);assert.match(denied.err,/GRAAL_DIAGNOSTIC /);assert.match(denied.err,/"phase":"api-read"/);assert.match(denied.err,/"status":403/);assert.ok(!denied.err.includes(token));
console.log('OK CLI PHP real: loopback explícito persistido, leitura cURL, recusa público HTTP/flag inválida; Kernel GLPI simulado.');
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep+'eg-cli-local-'));fs.rmSync(root,{recursive:true,force:true});}})().catch(()=>{console.error('Falha no contrato CLI local sintético.');process.exitCode=1;});
