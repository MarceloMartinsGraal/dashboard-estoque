<?php
namespace EstoqueGraal;
interface IntentStore {
    public function add(array $row):void;
    public function get(string $key):?array;
    public function claim(string $key,array $states):bool;
    public function save(string $key,string $state,?array $result):void;
}
