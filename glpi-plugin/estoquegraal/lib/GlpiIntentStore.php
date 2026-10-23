<?php
namespace EstoqueGraal;
final class GlpiIntentStore implements IntentStore {
    public const TABLE='glpi_plugin_estoquegraal_intents';
    public function __construct(private object $db){}
    public function add(array$row):void {
        $ok=$this->db->insert(self::TABLE,['intent_key'=>$row['key'],'users_id'=>(int)$row['user'],'tickets_id'=>(int)$row['ticket'],'entities_id'=>$row['entity'],'instance_id'=>$row['instance'],'operation'=>$row['operation'],'payload'=>json_encode($row['payload'],JSON_THROW_ON_ERROR|JSON_UNESCAPED_UNICODE),'state'=>'prepared','result'=>null,'date_creation'=>date('Y-m-d H:i:s')]);
        if(!$ok)throw new PluginError('Não foi possível registrar a intenção local.',500);
    }
    public function get(string$key):?array {
        $rows=$this->db->request(['FROM'=>self::TABLE,'WHERE'=>['intent_key'=>$key],'LIMIT'=>1]);
        foreach($rows as$r)return ['key'=>$r['intent_key'],'user'=>(string)$r['users_id'],'ticket'=>(string)$r['tickets_id'],'entity'=>(int)$r['entities_id'],'instance'=>$r['instance_id'],'operation'=>$r['operation'],'payload'=>json_decode($r['payload'],true,512,JSON_THROW_ON_ERROR),'state'=>$r['state'],'result'=>$r['result']===null?null:json_decode($r['result'],true,512,JSON_THROW_ON_ERROR)];
        return null;
    }
    public function recent(array $ctx,string $instance):array {
        $out=[];
        foreach($this->db->request(['FROM'=>self::TABLE,'WHERE'=>['users_id'=>(int)$ctx['user'],'tickets_id'=>(int)$ctx['ticket'],'entities_id'=>(int)$ctx['entity'],'instance_id'=>$instance,'state'=>['prepared','sending','unknown','rejected']],'ORDERBY'=>['id DESC'],'LIMIT'=>20])as$r)$out[]=['key'=>$r['intent_key'],'state'=>$r['state'],'operation'=>$r['operation']];
        return $out;
    }
    public function claim(string$key,array$states):bool {
        if(!$this->db->update(self::TABLE,['state'=>'sending'],['intent_key'=>$key,'state'=>$states]))throw new PluginError('Falha ao reservar intenção local.',500);
        return $this->db->affectedRows()===1;
    }
    public function save(string$key,string$state,?array$result):void {
        // Resultado confirmado é terminal: requisição concorrente tardia não o sobrescreve.
        if(!$this->db->update(self::TABLE,['state'=>$state,'result'=>$result===null?null:json_encode($result,JSON_THROW_ON_ERROR|JSON_UNESCAPED_UNICODE)],['intent_key'=>$key,'state'=>['<>','done']]))throw new PluginError('Falha ao registrar resultado local. Consulte pela mesma intenção.',500,true);
    }
}
