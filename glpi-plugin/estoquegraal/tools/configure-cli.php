<?php
// Somente CLI, executada pelo usuário PHP via sudo. Segredos entram por stdin.
if(PHP_SAPI!=='cli'){http_response_code(404);exit;}
ini_set('display_errors','0');
$action=$argv[1]??'';
$root=dirname(__DIR__,3);
if(($argv[2]??'')==='--root')$root=$argv[3]??'';
$root=realpath($root);
$phase='bootstrap';
try {
    if(!$root||!is_file($root.'/vendor/autoload.php')||!is_file($root.'/bin/console'))throw new RuntimeException('Instalação inválida');
    chdir($root);
    $phase='resources';
    require_once $root.'/src/Glpi/Application/ResourcesChecker.php';
    (new \Glpi\Application\ResourcesChecker($root))->checkResources();
    require_once $root.'/vendor/autoload.php';
    $phase='kernel';
    $kernel=new \Glpi\Kernel\Kernel();
    $kernel->boot();
    if(!defined('GLPI_VERSION')||GLPI_VERSION!=='11.0.5')throw new RuntimeException('Versão não suportada');
    require_once dirname(__DIR__).'/lib/bootstrap.php';
    global $PLUGIN_HOOKS,$DB;
    $PLUGIN_HOOKS['secured_configs']['estoquegraal']=['token'];
    $phase='security';
    $key=new GLPIKey();
    if(!$key->keyExists()||!$key->isConfigSecured('plugin:estoquegraal','token'))throw new RuntimeException('Chave GLPI indisponível');
    $phase='read-config';
    $old=Config::getConfigurationValues('plugin:estoquegraal');
    if($action==='status'){echo json_encode(['active'=>Plugin::isPluginActive('estoquegraal')],JSON_THROW_ON_ERROR)."\n";exit;}
    if($action==='backup'){
        if(function_exists('stream_isatty')&&stream_isatty(STDOUT))throw new RuntimeException('Redirecione backup para arquivo protegido');
        echo json_encode($old,JSON_THROW_ON_ERROR)."\n";exit;
    }
    $phase='payload-validation';
    $raw=stream_get_contents(STDIN,65537);
    if(strlen($raw)>65536)throw new RuntimeException('Entrada grande');
    $input=json_decode($raw,true,32,JSON_THROW_ON_ERROR);
    if(!is_array($input))throw new RuntimeException('Entrada inválida');
    if($action==='restore'){
        // Backup contém token cifrado pelo próprio GLPI; decifrar antes de Config cifrar uma vez.
        $allowed=['enabled','base_url','instance_id','token','timeout','connect_timeout','local_http','private_http','deployment_mode'];
        if(array_diff(array_keys($input),$allowed))throw new RuntimeException('Backup inválido');
        if(!empty($input['token'])){
            $plain=$key->decrypt($input['token']);
            if(!is_string($plain)||$plain==='')throw new RuntimeException('Backup não pertence à chave desta instalação');
            $input['token']=$plain;
        }
        $input=array_replace(['deployment_mode'=>'production','private_http'=>'0','local_http'=>'0'],$input);
        Config::setConfigurationValues('plugin:estoquegraal',$input);
        echo "{\"ok\":true,\"restored\":true}\n";exit;
    }
    if(!in_array($action,['apply','probe'],true))throw new RuntimeException('Ação inválida');
    $fields=['enabled','base_url','instance_id','token','timeout','connect_timeout','private_http','deployment_mode'];
    if(array_diff(array_keys($input),array_merge($fields,['local_http']))||array_diff($fields,array_keys($input)))throw new RuntimeException('Campos inválidos');
    if(array_key_exists('local_http',$input)&&!is_bool($input['local_http']))throw new RuntimeException('Flag local inválida');
    if(!empty($input['local_http'])&&!in_array(strtolower((string)parse_url($input['base_url'],PHP_URL_HOST)),['localhost','127.0.0.1','[::1]'],true))throw new RuntimeException('HTTP local exige loopback');
    $settings=new \EstoqueGraal\Settings($input);
    if(!empty($old['instance_id'])&&$old['instance_id']!==$input['instance_id'])throw new RuntimeException('Instância existente diferente; revisão manual necessária');
    // Valida somente leitura antes de substituir a configuração.
    $phase='api-read';
    (new \EstoqueGraal\ApiClient($settings))->get('/products',['page'=>1,'limit'=>1,'status'=>'ativo','availability'=>'positive']);
    if($action==='probe'){echo "{\"ok\":true,\"readCheck\":true}\n";exit;}
    $phase='persist';
    $values=['enabled'=>'1','base_url'=>$settings->baseUrl,'instance_id'=>$settings->instanceId,
        'token'=>$input['token'],'timeout'=>(string)$settings->timeout,'connect_timeout'=>(string)$settings->connectTimeout,
        'local_http'=>!empty($input['local_http'])?'1':'0','private_http'=>!empty($input['private_http'])?'1':'0',
        'deployment_mode'=>$input['deployment_mode']];
    $DB->beginTransaction();
    try{
        Config::setConfigurationValues('plugin:estoquegraal',$values);
        $phase='verify-persist';
        $saved=Config::getConfigurationValues('plugin:estoquegraal');
        $plain=$key->decrypt($saved['token']??'');
        if(!is_string($plain)||!hash_equals($input['token'],$plain)||($saved['base_url']??'')!==$values['base_url']||($saved['local_http']??'0')!==$values['local_http']||($saved['private_http']??'0')!==$values['private_http']||($saved['deployment_mode']??'')!==$values['deployment_mode'])throw new RuntimeException('Configuração não confirmada');
        $phase='commit';
        $DB->commit();
    }catch(\Throwable $e){$DB->rollback();throw $e;}
    echo "{\"ok\":true,\"readCheck\":true}\n";
}catch(\Throwable $e){
    // Somente metadados controlados: nenhuma mensagem remota, corpo ou credencial.
    $diagnostic=['phase'=>$phase];
    if($e instanceof \EstoqueGraal\PluginError)$diagnostic['status']=$e->status;
    fwrite(STDERR,'GRAAL_DIAGNOSTIC '.json_encode($diagnostic,JSON_THROW_ON_ERROR)."\n");
    fwrite(STDERR,"Configuração CLI recusada. Confira versão 11.0.5, chave GLPI, instância e conectividade da API; preserve o backup.\n");
    exit(1);
}
