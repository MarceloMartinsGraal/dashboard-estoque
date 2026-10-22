<?php
require_once __DIR__.'/lib/bootstrap.php';
function plugin_estoquegraal_install():bool {
    global $DB;
    $table=\EstoqueGraal\GlpiIntentStore::TABLE;
    if(!$DB->tableExists($table)){
        $DB->doQuery("CREATE TABLE `$table` (`id` int unsigned NOT NULL AUTO_INCREMENT,`intent_key` varchar(64) NOT NULL,`users_id` int unsigned NOT NULL,`tickets_id` int unsigned NOT NULL,`entities_id` int unsigned NOT NULL,`instance_id` varchar(120) NOT NULL,`operation` varchar(20) NOT NULL,`payload` longtext NOT NULL,`state` varchar(20) NOT NULL,`result` longtext DEFAULT NULL,`date_creation` timestamp NULL DEFAULT NULL,PRIMARY KEY (`id`),UNIQUE KEY `intent_key` (`intent_key`),KEY `owner_ticket` (`users_id`,`tickets_id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        ProfileRight::addProfileRights(['plugin_estoquegraal']);
        Config::setConfigurationValues('plugin:estoquegraal',['enabled'=>'0','base_url'=>'','instance_id'=>'','token'=>'','timeout'=>'10','connect_timeout'=>'3','local_http'=>'0']);
    }
    return true;
}
function plugin_estoquegraal_uninstall():bool {
    global $DB;
    // Não há chamada remota: movimentos e auditoria do dashboard nunca são apagados.
    $DB->doQuery('DROP TABLE IF EXISTS `glpi_plugin_estoquegraal_intents`');
    Config::deleteConfigurationValues('plugin:estoquegraal',['enabled','base_url','instance_id','token','timeout','connect_timeout','local_http']);
    ProfileRight::deleteProfileRights(['plugin_estoquegraal']);
    return true;
}
