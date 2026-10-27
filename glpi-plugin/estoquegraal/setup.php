<?php
// SPDX-License-Identifier: GPL-3.0-or-later
require_once __DIR__.'/lib/bootstrap.php';
define('PLUGIN_ESTOQUEGRAAL_VERSION','0.1.8');
function plugin_init_estoquegraal():void {
    global $PLUGIN_HOOKS;
    $PLUGIN_HOOKS['csrf_compliant']['estoquegraal']=true;
    $PLUGIN_HOOKS['secured_configs']['estoquegraal']=['token'];
    Plugin::registerClass('PluginEstoquegraalTicket',['addtabon'=>'Ticket']);
    Plugin::registerClass('PluginEstoquegraalProfile',['addtabon'=>'Profile']);
    Plugin::registerClass('PluginEstoquegraalConfig');
    $PLUGIN_HOOKS['add_javascript']['estoquegraal']=['js/core.js','js/app.js'];
    $PLUGIN_HOOKS['add_css']['estoquegraal']='css/plugin.css';
    if(Session::haveRight('config',UPDATE))$PLUGIN_HOOKS['config_page']['estoquegraal']='front/config.form.php';
    \Glpi\Http\Firewall::addPluginStrategyForLegacyScripts('estoquegraal','#^/ajax/endpoint\.php$#',\Glpi\Http\Firewall::STRATEGY_AUTHENTICATED);
    \Glpi\Http\Firewall::addPluginStrategyForLegacyScripts('estoquegraal','#^/front/(config|profile)\.form\.php$#',\Glpi\Http\Firewall::STRATEGY_CENTRAL_ACCESS);
}
function plugin_version_estoquegraal():array {return ['name'=>'Estoque Graal','version'=>PLUGIN_ESTOQUEGRAAL_VERSION,'author'=>'Graal Solutions','license'=>'GPLv3+','requirements'=>['glpi'=>['min'=>'11.0.5','max'=>'11.0.6'],'php'=>['min'=>'8.2','exts'=>['curl'=>['required'=>true],'json'=>['required'=>true],'sodium'=>['required'=>true]]]]];}
function plugin_estoquegraal_check_prerequisites():bool {
    return PHP_INT_SIZE>=8 && version_compare(PHP_VERSION,'8.2','>=') && defined('GLPI_VERSION') && version_compare(GLPI_VERSION,'11.0.5','>=') && version_compare(GLPI_VERSION,'11.0.6','<') && extension_loaded('curl') && extension_loaded('sodium');
}
function plugin_estoquegraal_check_config($verbose=false):bool {return true;}
