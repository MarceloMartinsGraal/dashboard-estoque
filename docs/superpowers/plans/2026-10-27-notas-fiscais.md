# Notas fiscais — implementação

Objetivo: biblioteca documental PDF avulsa ou vinculada a um produto, sem financeiro, OCR, estoque ou GLPI.
Base:7b443e0, Git limpo. Execução autorizada no checkout atual; sem commit/branch/deploy/servidor.

Arquitetura: invoices/controller.ts (sessão e transporte), service.ts (vínculos/duplicidade/auditoria), storage.ts (stream limitado, validação PDF, checksum/arquivo privado). Upload raw application/pdf evita dependência multipart e mantém limite JSON atual. Metadados pequenos em headers percent-encoded; visualização/download por rota autenticada. Uma migração006 cria documentos e tabela de vínculo com no máximo um produto/documento; UNIQUE checksum serializa duplicatas, inclusive concorrentes. Arquivo final publicado antes do commit; falha ambígua de banco nunca apaga arquivo final. Temporários limpos no finally; relatório de integridade identifica órfãos/faltantes/corrompidos sem excluir documentos automaticamente.

- [x] Testes HTTP/PG e PDF sintético: upload avulso/vinculado, seleção ampla/inativos, filtros/paginação, vínculo/nome auditados, conteúdo autenticado, CSRF, inválido/vazio/20MiB, replay/concorrência, falhas filesystem/metadados, reinicialização local.
- [x] Migração006 e módulo backend. Revalidar funcionário ativo dentro de transação após upload. Produtos existentes apenas, confirmação explícita de inativo.
- [x] Aba principal e seção detalhes produto, busca e seleção acessíveis, upload pré-selecionado, filtros em URL, estados/duplicata/erros separados, sem cópia PDF.
- [x] Volume privado invoices em dev/homologação/produção, proprietário node, variável INVOICE_STORAGE_DIR, Nginx21m somente rota exata de upload; JSON12mb preservado. Ignorar PDFs/diretório local.
- [x] CLI de integridade somente leitura, documentação backup coordenado/migração/permissões/limites e recuperação. Testes, navegador sintético local, revisão independente e verificações finais.

Validação PDF verifica extensão/MIME, header, EOF/startxref e destino xref compatível (tabela ou stream), com leituras limitadas. Não é antivírus nem certificação completa PDF; não executa conteúdo. Sem ferramenta de análise pré-existente identificada e sem envio externo.

Verificação: tipos/lint/build e suíte PostgreSQL descartável loopback. Teste de reinício da aplicação nativa com mesmo banco/diretório; não alegar Docker/backup restore sem execução.


Resultado:86 testes da suíte completa e20 Python passaram; rodada focal8 cenários e navegador real para a entrega. Revisão independente teve quatro achados corrigidos (versão sessão, snapshot de navegação, hidden CSS e fsync diretório Linux). Evidências e limitações em docs/notas-fiscais-verificacao.md. Execução nativa confirmou persistência após reinício da aplicação; Docker/restauração/queda abrupta não executados. Sem commit/deploy.
