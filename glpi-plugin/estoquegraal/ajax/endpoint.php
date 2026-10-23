<?php
require_once dirname(__DIR__,3).'/inc/includes.php';
require_once dirname(__DIR__).'/lib/bootstrap.php';
// GLPI 11 inclui scripts legados dentro de um método: globais precisam ser declaradas.
global $DB;
header('Content-Type: application/json; charset=utf-8');header('Cache-Control: no-store');
$requestId=bin2hex(random_bytes(16));header('X-EstoqueGraal-Request-Id: '.$requestId);$csrf='';$action='invalid';$phase='validation';
try {
    if($_SERVER['REQUEST_METHOD']!=='POST')throw new \EstoqueGraal\PluginError('Método não permitido.',405);
    // O listener oficial11.0.5 valida esse header em AJAX e preserva o token. Validar novamente antes de qualquer acesso externo.
    if(($_SERVER['HTTP_X_REQUESTED_WITH']??'')!=='XMLHttpRequest'||!Session::validateCSRF(['_glpi_csrf_token'=>$_SERVER['HTTP_X_GLPI_CSRF_TOKEN']??''],true))throw new \EstoqueGraal\PluginError('Sessão ou proteção CSRF expirou. Recarregue a aba.',403);
    $action=$_POST['action']??'';
    if(!is_string($action)||!in_array($action,['search','matches','balances','locations','history','prepare','execute','recover','intent','intents'],true))throw new \EstoqueGraal\PluginError('Ação inválida.');
    if(!is_string($_POST['data']??null)||strlen($_POST['data'])>($action==='prepare'?512000:16000))throw new \EstoqueGraal\PluginError('Dados inválidos.');
    $data=json_decode($_POST['data'],true,64,JSON_THROW_ON_ERROR);if(!is_array($data))throw new \EstoqueGraal\PluginError('Dados inválidos.');
    if($action==='search'&&(!is_string($data['q']??'')||mb_strlen($data['q']??'', 'UTF-8')>200))throw new \EstoqueGraal\PluginError('Busca inválida (máximo 200 caracteres).');
    if($action==='matches'&&(!is_string($data['description']??null)||trim($data['description'])===''||mb_strlen($data['description'],'UTF-8')>2000))throw new \EstoqueGraal\PluginError('Descrição inválida.');
    $phase='access';
    $ctx=\EstoqueGraal\Gate::context($_POST['ticketId']??null);
    $phase='configuration';
    $settings=PluginEstoquegraalConfig::settings();$client=new \EstoqueGraal\ApiClient($settings);$store=new \EstoqueGraal\GlpiIntentStore($DB);$operations=new \EstoqueGraal\Operations($client,$settings,$store);
    $page=filter_var($data['page']??1,FILTER_VALIDATE_INT);if(!$page||$page<1||$page>100000)throw new \EstoqueGraal\PluginError('Página inválida.');
    if(in_array($action,['balances','locations'],true)&&(!is_string($data['productId']??null)||!preg_match('/^[a-f0-9-]{36}$/D',$data['productId'])))throw new \EstoqueGraal\PluginError('Produto inválido.');
    if($action==='prepare'){
        $op=$data['operation']??'';if(!in_array($op,['movement','product'],true)||!is_array($data['payload']??null))throw new \EstoqueGraal\PluginError('Operação inválida.');
        \EstoqueGraal\Gate::requireRight($op==='movement'?UPDATE:CREATE);
    }
    if(in_array($action,['execute','recover','intent'],true)){
        if(!is_string($data['key']??null))throw new \EstoqueGraal\PluginError('Intenção inválida.');
        $row=$operations->intention($ctx,$data['key']);\EstoqueGraal\Gate::requireRight($row['operation']==='movement'?UPDATE:CREATE);
    }
    $csrf=Session::getNewCSRFToken();
    // Persistir CSRF/sessão e liberar lock de sessão antes da rede. Nenhuma transação GLPI é aberta.
    if(session_status()===PHP_SESSION_ACTIVE)session_write_close();
    $phase='action:'.$action;
    $out=match($action){
        'matches'=>$client->get('/product-matches',['description'=>$data['description'],'page'=>$page,'limit'=>20]),
        'search'=>$client->get('/products',['q'=>($data['q']??''),'page'=>$page,'limit'=>20]),
        'balances'=>$client->get('/products/'.$data['productId'].'/balances'),
        'locations'=>$client->get('/products/'.$data['productId'].'/locations',['purpose'=>($data['purpose']??'saida')==='entrada'?'entrada':'saida','page'=>$page,'limit'=>50]),
        'history'=>$client->get('/tickets/'.rawurlencode($ctx['ticket']).'/movements',['page'=>$page,'limit'=>20]),
        'prepare'=>$operations->prepare($ctx,$data['operation'],$data['payload']),
        'execute'=>$operations->execute($ctx,$data['key'],($data['retry']??false)===true),
        'recover'=>$operations->recover($ctx,$data['key']),
        'intent'=>['key'=>$row['key'],'operation'=>$row['operation'],'state'=>$row['state'],'summary'=>$row['payload'],'result'=>$row['result']],
        'intents'=>$store->recent($ctx,$settings->instanceId),
    };
    if(in_array($out['state']??'', ['unknown','rejected'],true))Toolbox::logInFile('estoquegraal',json_encode(['requestId'=>$requestId,'action'=>$action,'state'=>$out['state']])."\n");
    $phase='serialize';
    echo json_encode(['ok'=>true,'data'=>$out,'csrf'=>$csrf,'requestId'=>$requestId],JSON_THROW_ON_ERROR|JSON_UNESCAPED_UNICODE);
}catch(Throwable$e){
    $status=$e instanceof \EstoqueGraal\PluginError?$e->status:500;http_response_code($status);
    $safeAction=is_string($action)&&in_array($action,['search','matches','balances','locations','history','prepare','execute','recover','intent','intents'],true)?$action:'invalid';
    $type=(new ReflectionClass($e))->getShortName();if(!preg_match('/^[A-Za-z][A-Za-z0-9_]{0,79}$/D',$type))$type='Throwable';
    $file=str_replace('\\','/',$e->getFile());$pluginRoot=str_replace('\\','/',dirname(__DIR__)).'/';
    $site=str_starts_with($file,$pluginRoot)?substr($file,strlen($pluginRoot)):'core-or-extension';
    // Sem mensagem bruta, SQL, stack, corpo, credencial ou caminhos absolutos.
    Toolbox::logInFile('estoquegraal',json_encode(['requestId'=>$requestId,'action'=>$safeAction,'status'=>$status,'phase'=>$phase,'exceptionType'=>$type,'site'=>$site,'line'=>$e->getLine()])."\n");
    echo json_encode(['ok'=>false,'status'=>$status,'action'=>$safeAction,'message'=>$e instanceof \EstoqueGraal\PluginError?$e->getMessage():'Falha interna do plugin. Consulte o administrador.','requestId'=>$requestId,'csrf'=>$csrf],JSON_UNESCAPED_UNICODE);
}
