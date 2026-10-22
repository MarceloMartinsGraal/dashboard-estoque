# Evidências da manutenção — 22/10/2026

## Materiais reaproveitados

- Commit ccd9e99 (Otimização com o claudenir): regras atuais de unidade única/abertura e testes correspondentes. Não reverter nem reinterpretar regras nesta manutenção.
- Commit809e38d: Compose tests com rede de db_test para PostgreSQL loopback e procedimento manual de credencial local em docs/integracoes/integration-v1.md (afirmação histórica de ensaio Docker em22/10).
- Sete arquivos de teste Node existentes: autenticação, quantidade, estoque, importação, histórico, apresentação e integração. São testes automatizados. Planos/README relatam resultados anteriores; procedimento de credencial Docker é validação manual documentada, não suíte automatizada. Não foi encontrado log bruto de execução ou workflow CI versionado.

## Linha de base executada nesta revisão

Checkout809e38d sem alterações locais. npm run typecheck, npm run build e57 testes aprovados em PostgreSQL18.4 temporário loopback com banco novo _test. Checagem noUnused adicional encontrou somente Database injetado não lido no StockController. Nenhuma falha funcional anterior reproduzida.

## Alterações

- backend/src/validation.ts, catalog.ts, products.ts, integration.ts e history.ts: mesma paginação 1..100000/limite1..100/defaults1/50 compartilhada.
- backend/src/api.ts: remoção da injeção Database não lida, confirmada por compilador e busca sem instanciações manuais.
- backend/src/integration.ts: Map para metadados/saldos já carregados, preservando consultas/ordem/valores. Não foi medido ganho percentual e não há alegação de latência.
- backend/src/diagnostics.ts, app.ts, main.ts, migrate.ts: diagnóstico sanitizado; respostas HTTP e audit_log preservados.
- tests/diagnostics.test.cjs: três testes novos de privacidade/correlação/sucesso/processos, sem duplicar cenários de estoque. Vermelho observado por módulo ainda ausente; verde após implementação.
- package.json/Dockerfile: lint usando TypeScript existente, test:compiled e verify; alvo Docker test reaproveita compilação existente. Nenhuma dependência/versão alterada.
- .dockerignore: arquivo de origem tests/graal_estoque.json não referenciado pelas suítes deixa o contexto Docker. Arquivo original/Git preservado, sem importação.
- README/docs: instruções atuais de instalação/migração, variáveis, automação, diagnósticos, servidor privado, backup/restore e limites. Registros antigos identificados como históricos.

## Verificação final

- npm run typecheck: aprovado.
- npm run lint: aprovado; TypeScript sem variáveis/parâmetros não usados, sem instalar ESLint.
- npm run build: aprovado; frontend gerado com o mesmo hash index-CWYcv4ju.js da linha de base (UI não alterada).
- Suíte Node compilada: **60 testes aprovados, zero falhas**, em outro PostgreSQL18.4 temporário loopback. Os57 cenários existentes foram preservados;3 novos verificam logs técnicos.
- Ensaio extra em banco temporário vazio: CLI migrate aplicada e repetida sem mudança de checksum, cinco migrações, zero clientes de integração; processo compilado main iniciado; health200 e integração503 por padrão. Processos de ensaio encerrados; nenhuma base habitual acessada.
- Links Markdown e oito operações/escopos OpenAPI conferidos contra o controller atual. Contrato OpenAPI, frontend, migrações, dependências travadas e regras não foram alterados.
- git diff --check: sem erros. Revisão independente estática sem achados relevantes.

Docker/Compose/Nginx, HTTPS e restauração não foram executados nesta máquina: Docker e pg_dump/pg_restore estão indisponíveis. PyYAML também não está instalado; não foi instalada ferramenta para forçar validação. Arquivos Docker/Compose foram revisados estaticamente; lint/testes equivalentes foram executados nativamente. O comando composto verify foi conferido por seus componentes; não é alegado ensaio em contêiner.

Não houve modificação de servidor, credencial real, carga de origem, schema novo, commit, stage, push ou deploy. Nenhuma medição ou alegação de ganho percentual. Recomendações e ensaios pendentes estão em [test-server.md](test-server.md).
