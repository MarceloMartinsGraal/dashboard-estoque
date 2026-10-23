<?php
require_once dirname(__DIR__,3).'/inc/includes.php';
if($_SERVER['REQUEST_METHOD']!=='POST')throw new \Glpi\Exception\Http\AccessDeniedHttpException();
Session::checkRight('profile',UPDATE);$id=filter_var($_POST['profiles_id']??null,FILTER_VALIDATE_INT);if(!$id||$id<1)throw new \Glpi\Exception\Http\AccessDeniedHttpException();$profile=new Profile();$profile->check($id,UPDATE);
$rights=0;foreach(($_POST['rights']??[])as$right){if(!in_array((string)$right,[(string)READ,(string)UPDATE,(string)CREATE],true))throw new \Glpi\Exception\Http\AccessDeniedHttpException();$rights|=(int)$right;}
$profile->update(['id'=>$id,'_plugin_estoquegraal'=>[READ=>(bool)($rights&READ),UPDATE=>(bool)($rights&UPDATE),CREATE=>(bool)($rights&CREATE)]]);
Html::redirect(Profile::getFormURLWithID($id));
