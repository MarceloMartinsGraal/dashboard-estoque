# Plano de implementação

Execução direta nesta sessão; sem commits automáticos. O pedido já define arquitetura e autoriza avançar. Referência: docs/design.md.

- [x] 1. Núcleo: migração, quantidades exatas, abertura, saídas concorrentes, transferências, estornos e ajustes. Testes contra PostgreSQL real isolado, incluindo saldo insuficiente e retroatividade.
- [x] 2. Autenticação: sessões PostgreSQL, Argon2id, CSRF, limitação persistida, inativação e primeiro responsável. Testar HTTP sem sessão, rotação/logout e entradas inválidas.
- [x] 3. Catálogo e importação: validar JSON estrito/IDs/referências/datas, prévia, confirmação idempotente, financeiro fora da persistência e legado fora do saldo. Testes sintéticos.
- [x] 4. Interface: login, visão geral, catálogo, movimentação, histórico, abertura e importação; estados acessíveis e formulários com confirmação.
- [x] 5. Operação: Docker, Nginx, HTTPS, migração, backup e restauração. Build/typecheck e revisão direcionada antes da entrega.

Interfaces compartilhadas: Database.transaction entrega PoolClient; StockService recebe actorId e comandos validados; catálogo/importação usam o mesmo esquema e trilha de auditoria; frontend usa API /api na mesma origem. Nenhum saldo legado alimenta StockService.

Foco da revisão: concorrência entre abertura/saída/estorno; sessão de inativados; datas retroativas; payloads inesperados/financeiros; reimportação com checksum diferente mas IDs existentes. Resultados e limitações reais serão registrados no README.


## Resultado da execução

- Tipos e build aprovados.
- 31 testes sintéticos aprovados em PostgreSQL real 18.4 temporário.
- Revisão independente direcionada concluída; quatro achados importantes reproduzidos e corrigidos com testes: revogação de gestão enquanto aguarda lock, sessão tardia após troca de senha, estorno para armário inativo e metadado financeiro na prévia.
- Correções adicionais verificadas: precisão lexical do JSON, BOM UTF-8 e concorrência de abertura/estorno.
- Edge headless: login, consulta, saída pelo formulário com saldo conferido no banco, histórico, viewport de 390 px e logout aprovados. Revisadas capturas desktop/móvel. Corrigidos valor inicial de selects e respostas atrasadas entre páginas.
- Parser conferido somente por leitura contra o JSON organizado: 608/27/3058, 25 zeros, 30 fechamentos negativos e três saldos finais negativos. Nenhuma carga real executada.
- Infraestrutura preparada e revisada, mas Docker/Compose, Nginx/HTTPS e restauração no Ubuntu não foram executados: Docker não está disponível neste ambiente. Preparação não significa homologação de produção.
- HEAD original mantido; sem stage, commit, push ou deploy. AGENTS.md recebeu o conteúdo fornecido pelo usuário.
