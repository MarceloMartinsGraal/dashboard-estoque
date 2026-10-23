<?php
// SPDX-License-Identifier: GPL-3.0-or-later
spl_autoload_register(static function(string $class):void {
    $prefix='EstoqueGraal\\';
    if(str_starts_with($class,$prefix)) {
        $name=substr($class,strlen($prefix));
        if(preg_match('/^[A-Za-z]+$/D',$name)) { $file=__DIR__.'/'.$name.'.php'; if(is_file($file)) require_once $file; }
    }
});
