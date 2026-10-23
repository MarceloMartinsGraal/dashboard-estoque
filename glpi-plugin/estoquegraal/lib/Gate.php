<?php
namespace EstoqueGraal;
final class Gate {
    public static function requireRight(int $right):void {
        if(!\Session::haveRight('plugin_estoquegraal',READ)||!\Session::haveRight('plugin_estoquegraal',$right))throw new PluginError('Perfil sem permissão para esta operação no Estoque Graal.',403);
    }
    public static function context(mixed $ticketId,int $right=READ):array {
        $user=\Session::getLoginUserID();if(!$user)throw new PluginError('Sessão GLPI necessária.',401);
        if(!\Plugin::isPluginActive('estoquegraal'))throw new PluginError('Plugin inativo.',503);
        self::requireRight($right);
        if(!is_string($ticketId)||!preg_match('/^[1-9][0-9]{0,9}$/D',$ticketId))throw new PluginError('Chamado inválido.');
        $ticket=new \Ticket();
        if(!$ticket->getFromDB((int)$ticketId)||!$ticket->can((int)$ticketId,READ)||!\Session::haveAccessToEntity((int)$ticket->fields['entities_id']))throw new PluginError('Sem acesso ao chamado ou à entidade.',403);
        return ['user'=>(string)$user,'ticket'=>(string)$ticket->getID(),'entity'=>(int)$ticket->fields['entities_id']];
    }
}
