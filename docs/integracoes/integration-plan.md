# Dashboard integration v1 Implementation Plan

> Execução nativa nesta sessão, conforme pedido de apresentar plano e implementar; usar superpowers:executing-plans. Sem commits automáticos.

**Goal:** dashboard preparado para integração futura, sem GLPI real.
**Architecture:** controller versionado com Bearer revogável por instância; serviços de catálogo e estoque compartilhados. Vínculos e resultados idempotentes no PostgreSQL, na transação da operação.
**Tech Stack:** NestJS/TypeScript/pg/Zod existentes; nenhuma dependência nova.
**Spec:** requisitos do usuário de 22/10/2026, reproduzidos no contrato docs/integracoes/integration-v1.md.

## Global Constraints
- Desabilitado por padrão; sem credenciais reais, chamadas externas, plugin, webhook, commit, deploy ou migração em produção.
- Quantidade/unidade vigentes do repositório: somente unidades inteiras; legado fora do ledger.
- Identificadores externos textuais, instância limitada pela credencial, funcionário ativo vinculado explicitamente.

## Review Focus
- Revogação/inativação durante espera de lock: validar e bloquear na transação.
- Credenciais diferentes da mesma instância compartilham idempotência; instâncias distintas não acessam resultados alheios.
- Alteração de usuário/chamado/conteúdo sob mesma chave provoca conflito, sem mutação.
- Erro de saldo não reserva chave nem deixa ledger/operação parcial.
- Cookies não autenticam integração; Bearer não substitui sessão/CSRF das rotas atuais.

## Etapas
- [x] Testes HTTP sintéticos: autenticação/desabilitação, busca com acentos, armários, autoria, concorrência, revogação, cadastro e estornos. Executar antes da implementação e confirmar falha.
- [x] Migração 005: clientes revogáveis com hash/permissões/validade, vínculos externos, operações imutáveis e chave única por instância.
- [x] Extrair ProductService sem duplicar cadastro; permitir StockService.move receber transação existente, preservando o caminho atual.
- [x] Implementar guard e endpoints /api/integration/v1; idempotência transacional e resultados recuperáveis; histórico reaproveitado com filtro externo seguro.
- [x] Contrato estático OpenAPI 3.1 (sem Swagger no projeto), procedimento administrativo local e cliente simulado executável somente em banco _test loopback.
- [x] Testes completos, build/tipos, revisão independente e documentação de evidências/limites.

## Registro de execução — 22/10/2026

- Checkout inicialmente limpo. Trabalho na pasta autorizada; sem worktree/commit/stage/push.
- Requisitos já completos e pedido explícito de plano seguido de implementação: execução nativa sem repetir decisões de produto.
- Decisão: contrato versionado próprio, reutilizando serviços existentes; não expor sessão/CSRF pessoal como autenticação de serviço.
- Decisão: credencial limitada a instância, validade obrigatória, hash de segredo de alta entropia e escopos por metadata da rota. Chaves compartilhadas por instância permitem rotação sem duplicar.
- Testes novos executados antes do código falharam pela ausência das tabelas/funcionalidade nova; após implementação, 57 testes passaram. Teste de sentinela corrigido para respeitar paginação real, sem alterar dados para fazê-lo passar.
- Verificações finais: 57 testes em PostgreSQL 18.4 temporário loopback, npm run typecheck, npm run build, git diff --check, JSON OpenAPI/referências e 8 operações documentadas. Sem instalar dependências.
- Demonstração executada em outro banco temporário _test: cadastro explícito, busca, entrada2, replay sem duplicação, saída1, consulta de resultado e histórico2; saldo1. Credencial sintética revogada ao finalizar.
- Revisão independente estática sem achados relevantes; não substitui homologação no GLPI. Sem UI/plugin, rede externa, credenciais reais ou aplicação de migração na base operacional.
