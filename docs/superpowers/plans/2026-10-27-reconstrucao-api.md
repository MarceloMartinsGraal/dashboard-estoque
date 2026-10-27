# Reconstrução incremental da API — plano

**Objetivo:** consistência verificável da integração, preservando contratos v1, dados, estoque e configuração SSH do commit 3f9f41b.
**Execução:** local, neste checkout limpo, sem branch nova ou commit. Pedido autoriza implementar após diagnóstico/plano; dispensa rodadas adicionais de aprovação para mudanças compatíveis.
**Stack:** Node/TypeScript/NestJS/PostgreSQL existentes, nenhuma dependência nova.

## Diagnóstico e decisão
- Base 3f9f41b presente; lint/build e 70 testes Node passaram em PostgreSQL descartável.
- StockService/ProductService já são compartilhados. Locks, ledger, estorno, legado, base zero e idempotência transacional serão reaproveitados.
- SafeErrors descarta code/candidateIds de PRODUCT_CANDIDATES; requestId existe somente no log. Corrigir com campos aditivos, mantendo statusCode/message.
- Leituras de busca/saldo/distribuição usam várias consultas sem snapshot comum: testar com escrita concorrente real antes de corrigir.
- Assets são locais ao plugin e intents usa GlpiIntentStore. Sem evidência de falha de rede/instalação atual: não modificar esses fluxos.
- Alternativas: reescrita total duplicaria riscos sem evidência; somente pastas não corrige consistência; escolhida reconstrução incremental da integração e borda de erros.
- Escopo: integração, tratamento HTTP compartilhado e pontos opcionais de leitura dos serviços compartilhados. Sem mudanças nos contratos de sucesso do dashboard ou nas regras de escrita. Sem schema/migração, infraestrutura ou plugin novo.

## Etapas verificáveis
- [x] 1. Inventariar endpoints e consumidores; acrescentar regressões HTTP para correlação, conflito de duplicidade, vazio/falha e consultas com commits intercalados. Ver vermelho na implementação original.
- [x] 2. Extrair integração em contratos, autenticação, executor idempotente, repositório de leitura e controller/fachada. Manter exports de integration.ts e assinatura IntegrationService(db,stock,products). Preservar executor e regras; leituras compostas em REPEATABLE READ READ ONLY. ProductService.search e StockService.balances aceitam cliente opcional sem mudar uso do dashboard.
- [x] 3. Extrair SafeErrors e preservar statusCode/message; acrescentar code/requestId e X-Request-Id gerado internamente. Somente code/candidateIds conhecidos expostos. Diferenciar indisponibilidade conhecida sem expor SQL/stack. CSRF e health mantêm contratos específicos.
- [x] 4. Conferir OpenAPI, documentar inventário, arquitetura, atualização/recuperação e evidências. Testar contrato PHP contra backend real local, incluindo respostas vazias e erros, sem GLPI instalado.
- [x] 5. Executar tipos/lint/build, suíte PostgreSQL, testes locais pertinentes do plugin/configuração, revisar diff e compatibilidade SSH. Revisão independente e correções de achados relevantes. Sem acesso a servidores.

## Foco de revisão
- Commit entre leitura de quantidade, distribuição e contagem não pode misturar estados.
- Timeout durante lock não autoriza chave nova; ausência de resultado não equivale a operação rejeitada.
- Erro de dependência não vira lista vazia, saldo zero ou ausência de duplicata.
- Metadados do erro não expõem segredo, SQL ou identificador fornecido pelo cliente como requestId.
- Novos imports compilados, dependências Nest e consumidores CLI permanecem compatíveis.

## Verificação
`npm run typecheck`, `npm run lint`, `npm run build`; `node work/run-tests.cjs` em banco novo loopback _test. Testes PHP/proxy local existentes. Nenhuma migração em banco habitual; relatórios anteriores são evidência histórica, não homologação atual.


## Registro de execução

Etapas1..5 concluídas localmente. Baseline70/70, regressões em vermelho, verde78/78 (PHP real incluído), tipos/lint/build, PHP adicional e20 testes Python. Revisão independente sem achados. Detalhes e limites em docs/integracoes/api-reconstrucao.md. Sem commit/branch/deploy/schema novo. A execução foi feita diretamente, conforme pedido; nenhum script de skill que cria commits ou branches foi executado.

Ajuste de execução: estágio Docker `test` precisa do OpenAPI canônico novo e do helper administrativo exigido pela suíte já existente. Faltas reproduzidas em cópia de arquivos; os dois COPY corrigem a estrutura. Sem mudança no runtime ou versões de imagem. Docker real não executado.
