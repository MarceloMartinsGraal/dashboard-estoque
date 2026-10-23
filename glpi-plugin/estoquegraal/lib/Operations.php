<?php
namespace EstoqueGraal;
final class Operations {
    public function __construct(private ApiClient $api,private Settings $settings,private IntentStore $store){}
    public function prepare(array $ctx,string $operation,array $input):array {
        $allowed=$operation==='movement'?['productId','kind','quantity','locationId','eventDate','reason','observation']:($operation==='product'?['description','duplicateConfirmation']:[]);
        if(!$allowed || array_diff(array_keys($input),$allowed))throw new PluginError('Campos inesperados na operação.');
        if($operation==='movement'){
            foreach(['productId','locationId']as$f)if(!is_string($input[$f]??null)||!preg_match('/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/D',$input[$f]))throw new PluginError('Produto ou localização inválidos.');
            if(!in_array($input['kind']??'', ['entrada','saida'],true)||!in_array($input['reason']??'',['chamado','recebimento','uso_interno','rma','outro','correcao_estoque'],true))throw new PluginError('Tipo ou motivo inválido.');
            if(!is_string($input['quantity']??null)||!preg_match('/^[1-9][0-9]{0,12}(\.0{1,3})?$/D',$input['quantity'])||(int)$input['quantity']>9000000000000)throw new PluginError('Informe quantidade inteira positiva, conforme a unidade vigente.');
            $day=$input['eventDate']??'';$date=is_string($day)?\DateTimeImmutable::createFromFormat('!Y-m-d',$day):false;
            if(!$date||$date->format('Y-m-d')!==$day)throw new PluginError('Data inválida.');
            if(isset($input['observation'])&&(!is_string($input['observation'])||strlen($input['observation'])>8000))throw new PluginError('Observação inválida.');
            if(in_array($input['reason'],['outro','correcao_estoque'],true)&&trim($input['observation']??'')==='')throw new PluginError('Este motivo exige observação.');
            $payload=[...$input,'ticketId'=>(string)$ctx['ticket'],'externalUserId'=>(string)$ctx['user']];
        }else{
            if(!is_string($input['description']??null)||trim($input['description'])===''||strlen($input['description'])>8000)throw new PluginError('Descrição inválida.');
            if(isset($input['duplicateConfirmation'])&&(!is_array($input['duplicateConfirmation'])||!is_array($input['duplicateConfirmation']['candidateIds']??null)||!is_string($input['duplicateConfirmation']['justification']??null)))throw new PluginError('Confirmação de produto distinto inválida.');
            if(isset($input['duplicateConfirmation'])){ $dc=$input['duplicateConfirmation'];if(count($dc['candidateIds'])>10000||strlen($dc['justification'])>2000||!preg_match('/^.{5,500}$/usD',trim($dc['justification'])))throw new PluginError('Confirmação de produto distinto inválida.');foreach($dc['candidateIds'] as $id)if(!is_string($id)||!preg_match('/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/D',$id))throw new PluginError('Candidato inválido.');}
            $payload=['description'=>trim($input['description']),'unit'=>'unidade','active'=>true,'externalUserId'=>(string)$ctx['user']];
        }
        if($operation==='product'&&isset($input['duplicateConfirmation']))$payload['duplicateConfirmation']=$input['duplicateConfirmation'];
        $row=['key'=>'eg.'.bin2hex(random_bytes(16)),'user'=>(string)$ctx['user'],'ticket'=>(string)$ctx['ticket'],'entity'=>(int)$ctx['entity'],'instance'=>$this->settings->instanceId,'operation'=>$operation,'payload'=>$payload,'state'=>'prepared','result'=>null];
        $this->store->add($row);
        return $this->publicResult($row);
    }
    public function intention(array $ctx,string $key):array {
        if(!preg_match('/^eg\.[a-f0-9]{32}$/D',$key))throw new PluginError('Intenção inválida.');
        $row=$this->store->get($key);
        if(!$row)throw new PluginError('Intenção não encontrada.',404);
        if($row['user']!==(string)$ctx['user']||$row['ticket']!==(string)$ctx['ticket']||(int)$row['entity']!==(int)$ctx['entity'])throw new PluginError('Intenção não pertence a este usuário e chamado.',403);
        if($row['instance']!==$this->settings->instanceId)throw new PluginError('Instância alterada. Solicite conciliação administrativa desta intenção.',409);
        return $row;
    }
    public function execute(array $ctx,string $key,bool $retry=false):array {
        $row=$this->intention($ctx,$key);
        if($row['state']==='done')return $this->publicResult($row);
        if($row['state']!=='prepared'){
            $recovered=$this->recover($ctx,$key);
            if($recovered['state']==='done'||!$retry)return $recovered;
            // Reenvio somente por gesto explícito; nunca trocar a chave/payload.
            if(!$this->store->claim($key,['unknown','rejected']))return $this->recover($ctx,$key);
        }elseif(!$this->store->claim($key,['prepared']))return $this->recover($ctx,$key);
        try{
            $result=$this->api->post($row['operation']==='movement'?'/movements':'/products',$row['payload'],$key);
            $this->validateResult($row,$result);$this->store->save($key,'done',$result);
        }catch(PluginError$e){
            if($e->uncertain){return $this->recover($ctx,$key);}
            $this->store->save($key,'rejected',['message'=>$e->getMessage()]);
        }
        return $this->publicResult($this->intention($ctx,$key));
    }
    public function recover(array $ctx,string $key):array {
        $row=$this->intention($ctx,$key);if($row['state']==='done')return $this->publicResult($row);
        try {
            $operation=$this->api->get('/operations/'.$key);
            if(($operation['instanceId']??'')!==$this->settings->instanceId||($operation['operation']??'')!==$row['operation']||!is_array($operation['result']??null))throw new PluginError('Resultado inconsistente; solicite conciliação.',502,true);
            $this->validateResult($row,$operation['result']);$this->store->save($key,'done',$operation['result']);
        }catch(PluginError){$this->store->save($key,'unknown',['message'=>'Resultado ainda não confirmado. Consulte novamente ou reenvie explicitamente a mesma intenção. Não crie outra operação para substituir esta.']);}
        return $this->publicResult($this->intention($ctx,$key));
    }
    private function validateResult(array$row,array$result):void {
        if(!is_string($result['id']??null)||!preg_match('/^[a-f0-9-]{36}$/D',$result['id']))throw new PluginError('Resposta inconsistente do dashboard. Consulte o resultado.',502,true);
        if($row['operation']==='movement'){
            $ref=$result['externalReference']??[];
            if(($ref['instanceId']??'')!==$row['instance']||($ref['ticketId']??'')!==$row['ticket']||($ref['externalUserId']??'')!==$row['user']||($result['productId']??'')!==$row['payload']['productId']||($result['kind']??'')!==$row['payload']['kind'])throw new PluginError('Referência inconsistente. Solicite conciliação; não repita com outra chave.',502,true);
        }
    }
    private function publicResult(array$row):array {
        return ['key'=>$row['key'],'operation'=>$row['operation'],'state'=>$row['state'],'summary'=>$row['payload'],'result'=>$row['result']];
    }
}
