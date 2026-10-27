<?php
// Somente servidor loopback efêmero fornecido pelo teste Node. Segredo entra por stdin, nunca por argumento/log.
require __DIR__.'/../glpi-plugin/estoquegraal/lib/bootstrap.php';
use EstoqueGraal\ApiClient;
use EstoqueGraal\Settings;
use EstoqueGraal\PluginError;
function check($ok){if(!$ok)throw new RuntimeException('Contrato divergente em chamada '.debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS,1)[0]['line']);}
// JSONB pode ordenar propriedades: comparar os mesmos tipos/valores sem exigir ordem de chaves de objeto.
function canonical($v){if(!is_array($v))return $v;if(!array_is_list($v))ksort($v);return array_map('canonical',$v);}
function failure(callable $work,int $status){try{$work();}catch(PluginError $e){check($e->status===$status);return;}throw new RuntimeException('Expected failure missing: '.$status);}
try {
 $d=json_decode(stream_get_contents(STDIN),true,512,JSON_THROW_ON_ERROR);
 check(parse_url($d['url'],PHP_URL_HOST)==='127.0.0.1');
 $settings=new Settings(['enabled'=>true,'local_http'=>true,'base_url'=>$d['url'],'instance_id'=>'glpi-synthetic','token'=>$d['token'],'timeout'=>5]);
 $api=new ApiClient($settings);
 if($d['mode']==='disabled'){failure(fn()=>$api->get('/products'),503);echo "OK disabled\n";exit;}
 $description='ÓRION-PHP-'.bin2hex(random_bytes(12));
 $empty=$api->get('/products',['q'=>$description,'status'=>'ativo','availability'=>'positive']);check($empty['total']===0&&$empty['items']===[]);
 $options=$api->get('/product-options');check(is_array($options['categories'])&&is_array($options['subcategories']));
 $body=['description'=>$description,'categoryId'=>null,'subcategoryId'=>null,'active'=>true,'externalUserId'=>'0007'];
 $key='php-product-'.bin2hex(random_bytes(8));$p=$api->post('/products',$body,$key);check($api->post('/products',$body,$key)===$p);
 $balances=$api->get('/products/'.$p['id'].'/balances');check($balances['total']==='0.000'&&$balances['locations']===[]);
 $locations=$api->get('/products/'.$p['id'].'/locations',['purpose'=>'entrada']);check($locations['total']>0);
 check($api->get('/products',['q'=>$p['id'],'availability'=>'positive','status'=>'ativo'])['total']===0);
 check($api->get('/products',['q'=>$p['id'],'availability'=>'all','status'=>'ativo'])['items'][0]['id']===$p['id']);
 $candidates=$api->get('/product-matches',['description'=>$description]);check(in_array($p['id'],$candidates['candidateIds'],true));
 failure(fn()=>$api->post('/products',$body,$key.'-distinct'),409);
 $m=['productId'=>$p['id'],'externalUserId'=>'0007','ticketId'=>'90000009','kind'=>'entrada','quantity'=>'1','eventDate'=>$balances['openingDate'],'reason'=>'chamado','locationId'=>$d['locationId']];
 $mk='php-entry-'.bin2hex(random_bytes(8));$r=$api->post('/movements',$m,$mk);check(canonical($api->post('/movements',$m,$mk))===canonical($r));
 check(canonical($api->get('/operations/'.$mk)['result'])===canonical($r));check($api->get('/products/'.$p['id'].'/balances')['total']==='1.000');
 check($api->get('/tickets/90000009/movements')['total']===1);check($api->get('/tickets/90000008/movements')['items']===[]);
 failure(fn()=>$api->get('/operations/php-not-found'),404);failure(fn()=>$api->get('/products',['limit'=>101]),400);
 echo "OK real PHP/backend contract\n";
} catch(Throwable $e){fwrite(STDERR,'Teste PHP falhou: '.get_class($e).' em linha '.$e->getLine().(($e instanceof RuntimeException && (str_starts_with($e->getMessage(),'Expected failure missing: ')||str_starts_with($e->getMessage(),'Contrato divergente em chamada ')))?' '.$e->getMessage():'')."\n");exit(1);}
