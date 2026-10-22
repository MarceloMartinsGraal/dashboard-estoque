<?php
require_once dirname(__DIR__,3).'/inc/includes.php';
Session::checkRight('config',UPDATE);
Html::header('Estoque Graal',$_SERVER['PHP_SELF'],'config','plugins');
try {if($_SERVER['REQUEST_METHOD']==='POST'){PluginEstoquegraalConfig::save($_POST);echo '<p role="status">Configuração salva.</p>';}}catch(\EstoqueGraal\PluginError$e){echo '<p role="alert">'.\EstoqueGraal\View::h($e->getMessage()).'</p>';}
PluginEstoquegraalConfig::show();Html::footer();
