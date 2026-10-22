<?php
namespace EstoqueGraal;
final class PluginError extends \RuntimeException {
    public function __construct(string $message,public readonly int $status=400,public readonly bool $uncertain=false) {parent::__construct($message);}
}
