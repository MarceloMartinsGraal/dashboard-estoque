<?php
class PluginEstoquegraalConfig extends CommonGLPI {
    public static function values(bool $secret=false):array {
        $v=Config::getConfigurationValues('plugin:estoquegraal');
        if($secret)$v['token']=(new GLPIKey())->decrypt($v['token']??'')??'';
        else {$v['token_set']=!empty($v['token']);unset($v['token']);}
        return $v;
    }
    public static function settings():\EstoqueGraal\Settings {return new \EstoqueGraal\Settings(self::values(true));}
    public static function save(array $post):void {
        global $DB;
        Session::checkRight('config',UPDATE);(new Config())->checkGlobal(UPDATE);
        $old=self::values(true);
        $v=['enabled'=>isset($post['enabled'])?'1':'0','base_url'=>trim((string)($post['base_url']??'')),'instance_id'=>trim((string)($post['instance_id']??'')),'timeout'=>(string)($post['timeout']??'10'),'connect_timeout'=>(string)($post['connect_timeout']??'3'),'local_http'=>isset($post['local_http'])?'1':'0','private_http'=>isset($post['private_http'])?'1':'0','deployment_mode'=>(string)($post['deployment_mode']??'production')];
        if(!empty($old['instance_id'])&&$old['instance_id']!==$v['instance_id']&&count($DB->request(['FROM'=>\EstoqueGraal\GlpiIntentStore::TABLE,'LIMIT'=>1]))>0)throw new \EstoqueGraal\PluginError('Há intenções gravadas. Não altere a instância; concilie com o administrador.',409);
        $token=trim((string)($post['token']??''));$clear=isset($post['clear_token']);
        if($clear){$v['enabled']='0';$token='';}
        if($v['enabled']==='1')new \EstoqueGraal\Settings([...$v,'token'=>$token!==''?$token:($old['token']??'')]);
        if($token!==''&&!preg_match('/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.[a-f0-9]{64}$/D',$token))throw new \EstoqueGraal\PluginError('Credencial inválida.');
        if($token!==''&&(!(new GLPIKey())->keyExists()||(new GLPIKey())->encrypt($token)===''))throw new \EstoqueGraal\PluginError('Chave criptográfica do GLPI indisponível; configuração não salva.',503);
        if($token!==''||$clear)$v['token']=$token;
        // Config aplica a criptografia oficial via hook secured_configs; não criptografar duas vezes.
        Config::setConfigurationValues('plugin:estoquegraal',$v);
    }
    public static function show():void {
        Session::checkRight('config',UPDATE);$v=self::values();$h=[\EstoqueGraal\View::class,'h'];
        echo '<div class="eg-plugin"><h2>Configuração Estoque Graal</h2><p>Inativo até configuração. A instância deve ser exatamente a cadastrada na credencial do dashboard.</p><form method="post">';
        foreach(['base_url'=>'URL-base da API (HTTPS; HTTP privado só em homologação)','instance_id'=>'Identificador estável da instância','timeout'=>'Timeout total (1–30 segundos)','connect_timeout'=>'Timeout de conexão']as$name=>$label)echo '<label>'.$h($label).'<input name="'.$name.'" value="'.$h($v[$name]??'').'" required></label>';
        echo '<label>Nova credencial (vazio preserva a salva)<input type="password" name="token" autocomplete="new-password" value=""></label><p>'.(!empty($v['token_set'])?'Credencial armazenada; o valor não é exibido.':'Nenhuma credencial armazenada.').'</p>';
        echo '<label>Ambiente<select name="deployment_mode"><option value="production" '.(($v['deployment_mode']??'production')==='production'?'selected':'').'>Produção — HTTPS</option><option value="homologacao" '.(($v['deployment_mode']??'')==='homologacao'?'selected':'').'>Homologação — rede privada</option></select></label>';
        foreach(['enabled'=>'Habilitar integração','local_http'=>'Permitir HTTP somente para localhost/127.0.0.1/::1 em desenvolvimento','private_http'=>'Permitir HTTP em IPv4 privado somente na homologação','clear_token'=>'Remover credencial e desabilitar']as$name=>$label)echo '<label><input type="checkbox" name="'.$name.'" '.(!empty($v[$name])?'checked':'').'> '.$h($label).'</label>';
        echo '<input type="hidden" name="_glpi_csrf_token" value="'.$h(Session::getNewCSRFToken()).'"><button type="submit" name="save" value="1" class="btn btn-primary">Salvar configuração</button></form></div>';
    }
}
