# Empacota o plugin, envia ao servidor GLPI e executa scripts/update-glpi-plugin.sh lá.
# Uso: .\scripts\deploy-glpi-plugin.ps1 -Servidor glpi@IP_DO_GLPI [-GlpiDir /var/www/glpi]
param(
    [Parameter(Mandatory = $true)][string]$Servidor,
    [string]$GlpiDir = '/var/www/glpi'
)
$ErrorActionPreference = 'Stop'
$raiz = Split-Path $PSScriptRoot -Parent

$saida = python (Join-Path $raiz 'scripts\package-glpi-plugin.py')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao empacotar o plugin.' }
$zip = ($saida | Select-Object -First 1).Trim()
$nome = Split-Path $zip -Leaf
Write-Host "Pacote: $nome"
$saida | Select-Object -Last 1 | Write-Host

scp $zip "$zip.sha256" (Join-Path $raiz 'scripts\update-glpi-plugin.sh') "${Servidor}:/tmp/"
if ($LASTEXITCODE -ne 0) { throw 'Falha ao enviar arquivos com scp.' }

ssh -t $Servidor "sudo bash /tmp/update-glpi-plugin.sh /tmp/$nome $GlpiDir"
if ($LASTEXITCODE -ne 0) { throw 'A atualização no servidor terminou com erro; veja as mensagens acima.' }
