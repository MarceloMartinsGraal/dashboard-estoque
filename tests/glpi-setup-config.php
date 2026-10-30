<?php
require __DIR__.'/../glpi-plugin/estoquegraal/lib/bootstrap.php';
define('UPDATE',2);class CommonGLPI{}
class Session {static function checkRight(...$a){}static function getNewCSRFToken(){return 'fixture';}}
class GLPIKey {function decrypt($s){return $s;}function keyExists(){return true;}function encrypt($s){return $s;}}
class Config {
 static array $values=['enabled'=>'1','base_url'=>'http://192.168.1.5:8080/api/integration/v1','instance_id'=>'teste','timeout'=>'10','connect_timeout'=>'3','private_http'=>'1','deployment_mode'=>'homologacao','token'=>'11111111-1111-4111-8111-111111111111.'.'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'];
 function checkGlobal(...$a){}
 static function getConfigurationValues(...$a){return self::$values;}
 static function setConfigurationValues($context,$values){self::$values=array_replace(self::$values,$values);}
}
$DB=new class {public array $rows=[];function request($q){return $this->rows;}};
require __DIR__.'/../glpi-plugin/estoquegraal/inc/config.class.php';
ob_start();PluginEstoquegraalConfig::show();$html=ob_get_clean();
if(!str_contains($html,'name="deployment_mode"')||!preg_match('/value="homologacao"[^>]*selected/',$html))throw new RuntimeException('Modo homologacao nao representado no formulario');
if(str_contains($html,Config::$values['token']))throw new RuntimeException('Token exposto');
PluginEstoquegraalConfig::save(['enabled'=>'1','base_url'=>Config::$values['base_url'],'instance_id'=>'teste','timeout'=>'10','connect_timeout'=>'3','private_http'=>'1','deployment_mode'=>'homologacao']);
if(Config::$values['deployment_mode']!=='homologacao')throw new RuntimeException('Modo nao preservado');
$post=['enabled'=>'1','base_url'=>Config::$values['base_url'],'instance_id'=>'nova-instancia','timeout'=>'10','connect_timeout'=>'3','private_http'=>'1','deployment_mode'=>'homologacao'];
PluginEstoquegraalConfig::save($post);
if(Config::$values['instance_id']!=='nova-instancia')throw new RuntimeException('Primeira configuração vazia foi bloqueada');
$before=Config::$values;
foreach(['prepared','sending','unknown','rejected','done'] as $state){
    $DB->rows=[['state'=>$state]];
    try{PluginEstoquegraalConfig::save([...$post,'instance_id'=>'outra']);throw new RuntimeException('Troca com histórico permitida');}
    catch(\EstoqueGraal\PluginError $e){if($e->status!==409)throw $e;}
    if(Config::$values!==$before)throw new RuntimeException('Histórico/configuração alterados');
}
echo "OK: formulario explicita homologacao, preserva configuracao e nao exibe token.\n";
