<?php
namespace EstoqueGraal;
final class Settings {
    public readonly string $baseUrl;
    public readonly string $instanceId;
    public readonly int $timeout;
    public readonly int $connectTimeout;
    private string $token;
    public function __construct(array $values) {
        if(empty($values['enabled'])) throw new PluginError('Integração inativa. Solicite configuração ao administrador.',503);
        $url=rtrim((string)($values['base_url']??''),'/');$parts=parse_url($url);
        $local=!empty($values['local_http']) && in_array(strtolower($parts['host']??''),['localhost','127.0.0.1','[::1]'],true);
        if(!$parts || !in_array($parts['scheme']??'', $local?['https','http']:['https'],true) || empty($parts['host']) || isset($parts['user'],$parts['pass']) || isset($parts['user']) || isset($parts['query']) || isset($parts['fragment']) || ($parts['path']??'')!=='/api/integration/v1') throw new PluginError('URL inválida. Use HTTPS e o caminho /api/integration/v1; HTTP apenas em loopback de desenvolvimento.');
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
