# Configuracao Dashboard e GLPI Implementation Plan

Goal: dois scripts Ubuntu para homologacao HTTP privada e configuracao remota via SSH.
Architecture: entradas Bash, orquestracao Python3 sem dependencias externas, Compose separado, helpers Node/PHP para APIs dos sistemas.
Spec: ../specs/2026-10-27-configuracao-dashboard-glpi-design.md
Execucao: inline pelo agente, autorizada pelo usuario. Sem commit, push ou servidor real.

## Restricoes
Base 9f2a374. Preservar senhas, dados, projeto Compose e configuracao GLPI. HTTP privado opt-in somente homologacao. Producao HTTPS intacta. Nao transmitir .env inteiro.

## Foco de revisao
IP ambiguo; env malicioso sem execucao; falha SSH apos inicializacao local; segredo em argumentos/logs; reexecucao que nao pode duplicar cliente ou trocar configuracao.

## Tarefas
- [x] Testes Python para configuracao, validacao, reexecucao, fluxo Compose e SSH simulado; executar e confirmar falha antes do codigo.
- [x] Implementar scripts/configurar-dashboard.sh, scripts/configurar-glpi.sh e scripts/setup_graal.py; Compose homologacao e env de exemplo. Executar testes.
- [x] Implementar provision-integration.cjs com transacao, auditoria, credencial reutilizavel e vinculos explicitos. Testar com cliente pg simulado.
- [x] Implementar helper CLI GLPI, instalacao protegida e HTTP privado opt-in em Settings/configuracao; testes PHP.
- [x] Documentar uso, sudo, retomada, rede, limitacoes, producao. Gerar pacote e revisar todas as alteracoes.
- [x] Verificar sintaxe, testes afetados, pacote e diff; relatar ensaios reais indisponiveis.

Ruling: cópia isolada por git archive, em vez de modificar worktree original; não há commit. Verificação real de Docker/GLPI pendente por ausência de ambiente, explicitada no relatório.
