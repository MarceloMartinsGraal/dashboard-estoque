<?php
class PluginEstoquegraalTicket extends CommonGLPI {
    public function getTabNameForItem(CommonGLPI $item,$withtemplate=0) {
        if(!$item instanceof Ticket||!$item->getID())return '';
        try {\EstoqueGraal\Gate::context((string)$item->getID());return 'Estoque Graal';}catch(\EstoqueGraal\PluginError){return '';}
    }
    public static function displayTabContentForItem(CommonGLPI $item,$tabnum=1,$withtemplate=0) {
        if(!$item instanceof Ticket)return false;
        try {$ctx=\EstoqueGraal\Gate::context((string)$item->getID());echo \EstoqueGraal\View::ticket(Html::getPrefixedUrl('/plugins/estoquegraal'),$ctx,Session::getNewCSRFToken(),Session::haveRight('plugin_estoquegraal',UPDATE),Session::haveRight('plugin_estoquegraal',CREATE));}
        catch(\EstoqueGraal\PluginError$e){echo '<p role="alert">'.\EstoqueGraal\View::h($e->getMessage()).'</p>';}
        return true;
    }
}
