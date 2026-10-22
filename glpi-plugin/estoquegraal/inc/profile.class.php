<?php
class PluginEstoquegraalProfile extends CommonGLPI {
    public function getTabNameForItem(CommonGLPI $item,$withtemplate=0) {return $item instanceof Profile && Session::haveRight('profile',READ)?'Estoque Graal':'';}
    public static function displayTabContentForItem(CommonGLPI $item,$tabnum=1,$withtemplate=0) {
        global $DB;
        if(!$item instanceof Profile)return false;
        $item->check($item->getID(),READ);$can=Session::haveRight('profile',UPDATE);$rights=0;
        foreach($DB->request(['FROM'=>'glpi_profilerights','WHERE'=>['profiles_id'=>$item->getID(),'name'=>'plugin_estoquegraal']])as$r)$rights=(int)$r['rights'];
        $h=[\EstoqueGraal\View::class,'h'];echo '<div class="eg-plugin"><h3>Permissões Estoque Graal</h3><p>Acesso ao chamado e entidade continua obrigatório. Nenhuma permissão é concedida automaticamente.</p><form method="post" action="'.$h(Plugin::getWebDir('estoquegraal').'/front/profile.form.php').'">';
        foreach([READ=>'Consultar estoque e histórico',UPDATE=>'Registrar entradas e saídas (exige consulta)',CREATE=>'Cadastrar produtos (exige consulta)']as$bit=>$label)echo '<label><input type="checkbox" name="rights[]" value="'.$bit.'" '.(($rights&$bit)?'checked':'').' '.(!$can?'disabled':'').'> '.$h($label).'</label>';
        echo '<input type="hidden" name="profiles_id" value="'.(int)$item->getID().'"><input type="hidden" name="_glpi_csrf_token" value="'.$h(Session::getNewCSRFToken()).'">';
        if($can)echo '<button type="submit" class="btn btn-primary">Salvar permissões</button>';
        echo '</form></div>';return true;
    }
}
