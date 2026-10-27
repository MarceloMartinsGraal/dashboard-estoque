<?php
require __DIR__.'/../glpi-plugin/estoquegraal/lib/bootstrap.php';
function settings(array $extra): \EstoqueGraal\Settings {
 return new \EstoqueGraal\Settings(array_replace(['enabled'=>'1','base_url'=>'http://192.168.1.10:8080/api/integration/v1','instance_id'=>'teste','token'=>'11111111-1111-4111-8111-111111111111.'.str_repeat('a',64),'timeout'=>10,'connect_timeout'=>3],$extra));
}
function denied(array $extra):void {try{settings($extra);}catch(\EstoqueGraal\PluginError){return;}throw new \RuntimeException('Configuração insegura aceita');}
denied([]);
settings(['private_http'=>'1','deployment_mode'=>'homologacao']);
denied(['private_http'=>'1','deployment_mode'=>'production']);
foreach(['8.8.8.8','169.254.169.254','172.32.0.1','192.168.1.10.exemplo.com','127.0.0.1','010.0.0.1'] as $ip)denied(['private_http'=>'1','deployment_mode'=>'homologacao','base_url'=>'http://'.$ip.'/api/integration/v1']);
settings(['base_url'=>'https://estoque.exemplo.com/api/integration/v1']);
settings(['local_http'=>'1','base_url'=>'http://127.0.0.1/api/integration/v1']);
denied(['private_http'=>'1','deployment_mode'=>'homologacao','base_url'=>'http://192.168.1.10/api/integration/v1?x=1']);
echo "OK: HTTP privado exige homologacao opt-in; producao/HTTPS e loopback preservados.\n";
