<?php
namespace EstoqueGraal;
final class Settings {
    public readonly string $baseUrl;
    public readonly string $instanceId;
    public readonly int $timeout;
    public readonly int $connectTimeout;
    private string $token;
    public static function privateIPv4(string $host):bool {
        if(filter_var($host,FILTER_VALIDATE_IP,FILTER_FLAG_IPV4)===false)return false;
        $p=array_map('intval',explode('.',$host));
        return $p[0]===10||($p[0]===172&&$p[1]>=16&&$p[1]<=31)||($p[0]===192&&$p[1]===168);
    }
    public function __construct(array $values) {
        if(empty($values['enabled']))throw new PluginError('Integração inativa. Solicite configuração ao administrador.',503);
        $url=rtrim((string)($values['base_url']??''),'/');$parts=parse_url($url);
        $host=strtolower($parts['host']??'');
        $mode=$values['deployment_mode']??'production';
        if(!in_array($mode,['production','homologacao'],true))throw new PluginError('Modo de implantação inválido.');
        if(!empty($values['private_http'])&&$mode!=='homologacao')throw new PluginError('HTTP privado exige modo homologação. Produção requer HTTPS.');
        $local=!empty($values['local_http'])&&in_array($host,['localhost','127.0.0.1','[::1]'],true);
        $private=!empty($values['private_http'])&&$mode==='homologacao'&&self::privateIPv4($host);
        if(!$parts||!in_array($parts['scheme']??'',($local||$private)?['https','http']:['https'],true)||empty($host)||isset($parts['user'])||isset($parts['pass'])||isset($parts['query'])||isset($parts['fragment'])||($parts['path']??'')!=='/api/integration/v1')throw new PluginError('URL inválida. Use HTTPS; HTTP privado exige homologação explícita e IPv4 RFC1918.');
        $instance=(string)($values['instance_id']??'');
        if(!preg_match('/^[A-Za-z0-9._:-]{1,120}$/D',$instance))throw new PluginError('Identificador da instância inválido.');
        $token=(string)($values['token']??'');
        if(!preg_match('/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.[a-f0-9]{64}$/D',$token))throw new PluginError('Credencial de integração não configurada ou inválida.');
        $timeout=filter_var($values['timeout']??10,FILTER_VALIDATE_INT);$connect=filter_var($values['connect_timeout']??3,FILTER_VALIDATE_INT);
        if(!$timeout||!$connect||$timeout<1||$timeout>30||$connect<1||$connect>$timeout)throw new PluginError('Timeout inválido (total de 1 a 30 segundos).');
        $this->baseUrl=$url;$this->instanceId=$instance;$this->timeout=$timeout;$this->connectTimeout=$connect;$this->token=$token;
    }
    public function authorization():string{return 'Authorization: Bearer '.$this->token;}
    public function redact(mixed $value):mixed {
        if(is_string($value))return str_replace([$this->token,substr($this->token,37)],'[segredo removido]',$value);
        if(is_array($value))return array_map(fn($v)=>$this->redact($v),$value);
        return $value;
    }
}
