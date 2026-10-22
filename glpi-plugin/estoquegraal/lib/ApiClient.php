<?php
namespace EstoqueGraal;
final class ApiClient {
    private $transport;
    public function __construct(private Settings $settings,?callable $transport=null) {$this->transport=$transport??[$this,'curl'];}
    public function get(string $path,array $query=[]):array {return $this->request('GET',$path,$query);}
    public function post(string $path,array $body,string $key):array {
        if(!in_array($path,['/products','/movements'],true)||!preg_match('/^[A-Za-z0-9._:-]{1,120}$/D',$key))throw new PluginError('Operação ou chave inválida.');
        return $this->request('POST',$path,[],$body,$key);
    }
    private function request(string $method,string $path,array $query=[],?array $body=null,?string $key=null):array {
        if(!preg_match('~^/(products(?:/[a-f0-9-]{36}/(?:balances|locations))?|locations|movements|operations/[A-Za-z0-9._:-]{1,120}|tickets/[0-9]+/movements)$~D',$path))throw new PluginError('Endpoint não permitido.');
        $url=$this->settings->baseUrl.$path.($query?'?'.http_build_query($query,'','&',PHP_QUERY_RFC3986):'');
        $headers=['Accept: application/json',$this->settings->authorization()];
        if($key!==null)$headers[]='Idempotency-Key: '.$key;
        if($body!==null)$headers[]='Content-Type: application/json';
        try {[$status,$raw]=($this->transport)($method,$url,$headers,$body===null?null:json_encode($body,JSON_THROW_ON_ERROR|JSON_UNESCAPED_UNICODE));}
        catch(PluginError $e){throw $e;}
        catch(\Throwable){throw new PluginError('Dashboard indisponível. Consulte o resultado antes de repetir.',504,$method==='POST');}
        if($status<200||$status>=300) {
            $messages=[400=>'Dados rejeitados. Confira quantidade, motivo e abertura do produto.',401=>'Credencial inválida ou expirada. Solicite revisão ao administrador.',403=>'Sem permissão ou vínculo ativo com funcionário no dashboard. Solicite regularização ao administrador.',404=>'Registro não encontrado.',409=>'Saldo insuficiente, abertura pendente, produto inativo ou conflito de idempotência. Confira no dashboard.',503=>'Integração desabilitada ou dashboard indisponível.'];
            throw new PluginError($messages[$status]??'Falha ao consultar o dashboard.',in_array($status,[400,401,403,404,409,503],true)?$status:502,$method==='POST'&&$status>=500);
        }
        try{$decoded=json_decode($raw,true,512,JSON_THROW_ON_ERROR);}catch(\Throwable){throw new PluginError('Resposta inválida do dashboard.',502,$method==='POST');}
        if(!is_array($decoded))throw new PluginError('Resposta inválida do dashboard.',502,$method==='POST');
        return $this->settings->redact($decoded);
    }
    private function curl(string $method,string $url,array $headers,?string $body):array {
        if(!extension_loaded('curl'))throw new PluginError('Extensão PHP cURL indisponível.',503);
        $ch=curl_init($url);$raw='';
        curl_setopt_array($ch,[CURLOPT_CUSTOMREQUEST=>$method,CURLOPT_HTTPHEADER=>$headers,CURLOPT_CONNECTTIMEOUT=>$this->settings->connectTimeout,CURLOPT_TIMEOUT=>$this->settings->timeout,CURLOPT_FOLLOWLOCATION=>false,CURLOPT_SSL_VERIFYPEER=>true,CURLOPT_SSL_VERIFYHOST=>2,CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS|CURLPROTO_HTTP,CURLOPT_WRITEFUNCTION=>static function($ch,$data)use(&$raw){if(strlen($raw)+strlen($data)>2097152)return 0;$raw.=$data;return strlen($data);}]);
        if($body!==null)curl_setopt($ch,CURLOPT_POSTFIELDS,$body);
        $ok=curl_exec($ch);$status=(int)curl_getinfo($ch,CURLINFO_RESPONSE_CODE);curl_close($ch);
        if($ok===false)throw new PluginError('Tempo excedido ou falha de comunicação. Consulte o resultado antes de repetir.',504,$method==='POST');
        return [$status,$raw];
    }
}
