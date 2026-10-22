# Manutenção sem mudança funcional — 22/10/2026

Escopo: preservar UI, contratos, regras, migrações e dados. Nenhum GLPI, commit, push ou deploy. Execução nativa; usar planejamento, TDD para diagnóstico, revisão e verificação pertinentes.

## Diagnóstico e plano

1. Baseline limpa: 57 testes atuais, tipos e build aprovados em PostgreSQL18.4 temporário. Histórico do Claude: ccd9e99 e 809e38d, incluindo correção de loopback no Compose e validação Docker documentada. Não há arquivo de log de execução dedicado nem CI versionada; documentos são registros, não evidência de execução atual.
2. Remover só dependência Database injetada e não lida no StockController (compilador noUnused + busca de referências). Centralizar pageFields idêntico em quatro caminhos; preservar limites/defaults. Trocar buscas lineares repetidas por Map na montagem da distribuição, sem alterar SQL/ordem/paginação e sem alegação de percentual.
3. Logs: falhas têm apenas status/família da operação/categoria/UUID interno/SQLSTATE seguro, sem URL, corpo, headers, IDs externos, mensagem SQL ou stack. Manter envelope/respostas e trilha audit_log. Testes focados em privacidade antes do código.
4. Aproveitar Compose de testes como automação já existente: lint via TypeScript existente, build e testes compilados, sem instalar dependência. Excluir arquivo JSON de origem não referenciado do contexto Docker, sem removê-lo do Git/disco.
5. Corrigir docs atuais versus históricos e fornecer roteiro privado de servidor vazio, configuração, migrações, logs, backups e pendências. Sem instalar Docker ou executar comandos remotos.
6. Verificar alterações com suítes atuais e novas de diagnóstico, tipos/lint/build, contrato estático e revisão independente. Docker/Nginx/restore pendentes nesta máquina sem Docker.

## Resultado

Etapas locais concluídas com60 testes, tipos/lint/build e inicialização nativa em banco vazio. Revisão independente sem achados relevantes. A validação Docker/proxy/TLS/restore depende do futuro servidor/ambiente com ferramentas; não foi apresentada como concluída. Evidências em maintenance-validation.md.
