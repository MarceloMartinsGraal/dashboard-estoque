<?php
require dirname(__DIR__).'/lib/bootstrap.php';
use EstoqueGraal\ApiClient;use EstoqueGraal\Settings;use EstoqueGraal\PluginError;
$c=new ApiClient(new Settings(['enabled'=>true,'local_http'=>true,'base_url'=>$argv[1], 'instance_id'=>'synthetic','token'=>'11111111-1111-4111-8111-111111111111.'.str_repeat('a',64),'timeout'=>1,'connect_timeout'=>1]));
function check($v){if(!$v)throw new RuntimeException('Contrato HTTP divergente');}
$r=$c->get('/products',['q'=>'memória','page'=>2,'limit'=>20]);check($r['page']===2&&$r['total']===21);
foreach([400,401,403,409,503,302]as$status){try{$c->get('/products',['status'=>$status]);throw new RuntimeException('Esperava erro');}catch(PluginError$e){check($e->status===($status===302?502:$status));check(!str_contains($e->getMessage(),'<script>'));}}
foreach(['entrada','saida']as$kind){$r=$c->post('/movements',['kind'=>$kind,'quantity'=>'2.000'],'http.'.$kind);check($r['kind']===$kind);}
$r=$c->post('/products',['description'=>'Produto sintético'],'http.product');check(isset($r['id']));
try{$c->post('/movements',['kind'=>'entrada','test'=>'opening'],'http.opening');throw new RuntimeException('Esperava abertura pendente');}catch(PluginError$e){check($e->status===409);}
try{$c->post('/movements',['kind'=>'saida','test'=>'timeout'],'http.timeout');throw new RuntimeException('Esperava timeout');}catch(PluginError$e){check($e->uncertain);}
$r=$c->get('/operations/http.timeout');check($r['result']['id']==='synthetic-recorded');
echo "OK HTTP real loopback: paginação, entrada/saída, cadastro, abertura pendente, 400/401/403/409/503, redirect bloqueado e timeout pós-gravação recuperado\n";
