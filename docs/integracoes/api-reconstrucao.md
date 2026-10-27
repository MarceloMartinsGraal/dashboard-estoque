# API — diagnóstico, reconstrução e atualização

Data: 27/10/2026. Base: `3f9f41b645bdbfa42d72c47abef19085cdb0e5ac`, presente no checkout; Git limpo no início. Trabalho executado no checkout existente, sem nova branch ou worktree, sem commit/push/deploy. Nenhum servidor acessado.

## Decisão e alcance

Reconstrução incremental da **camada de integração**, com correção do filtro HTTP compartilhado. Não foi proporcional substituir serviços transacionais de estoque/cadastro que já atendem dashboard e plugin e têm cobertura real de concorrência. O contrato v1 e os consumidores foram mapeados no [inventário](api-inventario.md). Não foram removidos endpoints nem reimplementadas regras de escrita. Os serviços compartilhados aceitam cliente de leitura opcional; consumidores antigos continuam usando o pool como antes.

Reescrever a API inteira ampliaria o risco de divergência de saldo, estorno, legado e idempotência sem defeito comprovado nessas regras. Apenas separar arquivos também seria insuficiente: foram corrigidos defeitos observáveis, com testes que falharam antes da mudança.

## Diagnóstico comprovado localmente

| Achado | Evidência | Correção |
|---|---|---|
| Metadados do conflito de duplicidade desapareciam | ProductService emitia PRODUCT_CANDIDATES/candidateIds, mas resposta409 preservava somente message | SafeErrors preserva somente esse código/candidatos conhecidos; demais detalhes internos continuam privados |
| Correlação inacessível ao cliente | requestId existia só em res.locals/log | X-Request-Id gerado internamente; mesmo requestId no corpo de erro e no log |
| Busca misturava saldo e armários | Escrita real intercalada: quantity2.000 e soma dos armários3.000 na mesma resposta | Mesmo snapshot PostgreSQL para página, contagem e distribuição |
| Consulta de saldo misturava metadados | Nome do armário alterado em outra conexão entre duas consultas aparecia só em parte da resposta | Mesmo snapshot para produto, saldo e metadados/armários elegíveis |
| Indisponibilidade reconhecível virava500 genérico | Falha de conexão controlada ECONNREFUSED observada como500 |503 DEPENDENCY_UNAVAILABLE; desconhecidos permanecem500; falha nunca vira vazio |

As intercalações usam PostgreSQL real, serviços reais e outra conexão. A injeção controla o instante do commit; não simula resultado de SQL. Falhas específicas de conexão são injetadas para verificar o mapeamento HTTP, não constituem ensaio de queda de rede real.

A contagem/página foi verificada também com inativação concorrente entre SELECT e COUNT. A alteração posterior aparece na próxima consulta, não no snapshot em andamento. Nenhuma garantia de snapshot entre **requisições diferentes** é prometida.

## Separação entre API, plugin e infraestrutura

- Assets JS/CSS/logo são servidos pelo GLPI e permanecem responsabilidade do plugin/instalação/cache. Nenhuma falha404 instalada foi atribuída ao backend nesta revisão.
- `intents` chama `GlpiIntentStore::recent` em tabelas locais do GLPI; não chama a API. Nenhum schema GLPI foi alterado.
- Sem acesso autorizado ao GLPI, não houve correlação de logs instalados com requestIds antigos; esses incidentes não foram novamente diagnosticados como problemas de API.
- Rede, Nginx, TLS, Docker e ambiente Ubuntu não foram executados aqui. Configuração SSH recente foi preservada e testada com simuladores, sem SSH real.
- A confirmação de operação e as leituras posteriores continuam separadas no plugin. Atualização de tela não reenvia movimento. Resultado desconhecido mantém recuperação pela mesma intenção/chave.

## Arquitetura resultante

- `backend/src/integration.ts`: exports estáveis para app/testes/scripts.
- `integration/controller.ts`: rotas HTTP, delegação e metadados de escopo.
- `integration/contracts.ts`: schemas Zod estritos e tipo do cliente, reaproveitando schemas dos serviços compartilhados; consultas validadas na fronteira da camada de consultas.
- `integration/auth.ts`: habilitação, credencial/escopo; não usa cookie pessoal. Autor humano é revalidado pelo executor.
- `integration/service.ts`: fachada compatível e composição das operações/consultas.
- `integration/operations.ts`: executor idempotente extraído, locks/autorização/vínculo/auditoria/resultado na mesma transação. Usa StockService.move e ProductService.save.
- `integration/queries.ts`: validação de consultas e serialização dos formatos v1.
- `integration/repository.ts`: SQL específico de leitura, snapshot READ ONLY REPEATABLE READ e recuperação do resultado.
- `backend/src/http-errors.ts`: resposta segura; `diagnostics.ts`: correlação/log sanitizado.
- `stock.ts`, `products.ts`, `history.ts`, `imports.ts`: regras de domínio e legado reaproveitadas. A implementação de estoque continua única.

A separação não pretende converter todo controller antigo em uma arquitetura nova. CatalogController e administração/importação fora da integração continuam nos padrões existentes; sem refatoração incidental, dependências novas ou framework de repositórios genérico.

## Contratos e regras preservados

Nenhuma rota, campo de sucesso, tipo ou paginação mudou. Quantidades públicas da integração seguem strings decimais com três casas: "2.000" significa duas unidades inteiras. Ledger usa bigint em milésimos; delta de movimento, saldo operacional, legado e distribuição não se confundem. History locations[].delta é a variação do movimento. O legado permanece fora do ledger e não é somado novamente.

Busca do plugin continua automaticamente ativo/positivo, opção sem saldo continua explícita; o default v1 all/todos e a busca do dashboard foram preservados. Duplicidade consulta todo catálogo; sem fusão ou reativação. Cadastro rápido continua exatamente Descrição, Categoria, Subcategoria, Situação, nessa ordem. Novo produto da integração recebe base zero sem ledger; primeira entrada é uma operação separada. Não foi adicionado campo financeiro.

Idempotência continua isolada por instância/chave. Mesma chave/conteúdo retorna resultado original; conteúdo diferente409; chaves distintas são intenções distintas. Sem resultado visível enquanto a transação está em andamento: GET operations pode retornar404, que **não autoriza nova chave** após timeout. Aguardar/consultar mesma intenção; repetição explícita usa mesma chave. Revogação é revalidada após espera do lock, conforme política existente. Clientes da mesma instância com read podem recuperar resultados dessa instância; não foi inventada validação de acesso interno ao chamado na API.

Mudanças aditivas documentadas no [OpenAPI1.0.1](integration-v1.openapi.json): erros mantêm statusCode/message e incluem code/requestId, candidato conhecido mantém candidateIds; novo header X-Request-Id. Indisponibilidade conhecida de conexão agora503 (antes500). Consumidores existentes tratam ambas como falha, não como operação rejeitada definitiva. Plugin mantém seu requestId local independente; para localizar log de backend use X-Request-Id da chamada à API, não presuma igualdade com o ID PHP.

CSRF e health mantêm seus corpos específicos; a adição de header também se aplica a eles. Rate limiting pessoal existente preservado; nenhum limitador novo de integração.

## Banco e trabalhos anteriores

Cinco migrações001..005 preservadas byte a byte, incluindo constraints/FKs/índices/triggers imutáveis de movimentos, ledger, legado, auditoria e operações. Nenhuma migração nova e nenhum comando em banco operacional. Locks de produto, contagem, estorno único e idempotência não foram substituídos.

Materiais anteriores localizados: commits ccd9e99 (trabalho Claude nas regras), 809e38d (Compose/testes), 4dea2d0 (patch do servidor), testes Node em tests/, docs/maintenance-validation.md e docs/maintenance-plan.md; relatórios e contrato antigos em outputs/ deste chat. Não foi encontrado relatório bruto separado identificando autoria de cada teste; não atribuir provas atuais ao Claude. Documentos externos foram preservados e não substituíram o contrato canônico.

## Atualização e recuperação — procedimento para execução autorizada futura

**Só backend precisa atualizar. Plugin atual0.1.8 não foi modificado, não exige reinstalação, limpeza de cache GLPI nem ZIP novo. Sem migração nova.** O plugin0.1.8 continua dependendo do backend com busca availability/product-options (entrega0.1.7) e configuração de homologação existente.

1. Antes de qualquer atualização real, registrar versão/imagem anterior; conferir backup recuperável segundo [operações](../operations.md), sem alterar volumes. Manter .env, segredo, credenciais e vínculos. Conferir projeto Compose/arquivos usados na instalação atual.
2. Compilar/testar checkout revisado localmente. Para Docker, manter exatamente projeto, arquivo Compose e env existentes; o Dockerfile já compila e copia os subdiretórios novos, sem ajuste de imagem-base. O estágio Docker de testes recebe somente o OpenAPI canônico e o helper de provisionamento necessários aos testes; estágio runtime permanece igual.
3. Em janela autorizada, reconstruir e recriar **somente API**, preservando banco/volumes. Os comandos abaixo são modelos Bash; preencher variáveis com os caminhos/projeto existentes. Não executar setup SSH novamente para esta revisão.

```bash
# Definir GRAAL_ENV, GRAAL_PROJECT e GRAAL_COMPOSE conforme a instalação já existente.
docker compose --env-file "$GRAAL_ENV" -p "$GRAAL_PROJECT" -f "$GRAAL_COMPOSE" build api
docker compose --env-file "$GRAAL_ENV" -p "$GRAAL_PROJECT" -f "$GRAAL_COMPOSE" up -d --no-deps api
```

4. Conferir health e busca/saldo/opções de leitura. Confirmar X-Request-Id em uma chamada autenticada. Não testar por reenvio de movimentos reais. Homologar operações somente em base de testes e GLPI isolado autorizados.
5. Se a atualização falhar, manter imagem anterior com tag salva e restaurar **só API** por override Compose local `services: {api: {image: TAG_ANTERIOR}}`, usando o mesmo projeto/env/Compose e `up -d --no-deps --no-build api` com esse override. Restaurar a revisão de código conhecida pelo responsável, sem reset destrutivo. Não remover volumes, não refazer provisionamento, não mudar chaves ou vínculos.
6. Esta revisão não altera schema: voltar a imagem anterior não exige desfazer migração. Isso não é garantia para futuras migrações; nunca assumir que rollback de imagem reverte schema. O replay idempotente conserva compatibilidade com os resultados persistidos existentes.

Produção mantém HTTPS; homologação privada HTTP exige opt-in atual0.1.8. Rotação de segredo, mudança de host/projeto/env ou aplicação de migrações existentes ausentes exigem o procedimento específico já documentado, não fazem parte desta atualização.

## Verificação e limitações

Resultados finais registrados ao concluir abaixo. Logs brutos de teste ficam localmente em work/ (ignorados), sem credenciais reais. Não foi executada auditoria completa de segurança, nem GLPI real, nem Nginx/TLS/Compose/SSH contra servidor. Essa entrega confirma código e contratos locais; homologação no GLPI11.0.5 e Ubuntu permanece necessária.


### Resultados registrados

- Linha de base:70 testes Node aprovados, lint e build aprovados. Saída local: work/api-rebuild-baseline.log.
- Vermelho:70 aprovados/3 falhas novas previstas (metadados409, distribuição2/3 e nome concorrente). Saída: work/api-rebuild-red.log. Falha reconhecida de conexão também observada como500 antes da correção.
- Verde final:78 testes Node aprovados, zero falhas e zero ignorados neste Windows com PHP/cURL já disponível. Os70 anteriores foram preservados. Saída: work/api-rebuild-final.log.
- `npm run typecheck`, `npm run lint`, `npm run build`: aprovados. Frontend compilado com os mesmos arquivos/hashes da linha de base; UI não modificada.
- Respostas HTTP dos testes v1 comparadas com schemas do OpenAPI: required/types/formatos/patterns/enums/refs/allOf/oneOf e paginação. Validador de teste limitado ao documento existente, sem alegar certificação OpenAPI geral.
- PHP ApiClient real com cURL contra backend e PostgreSQL reais locais: produto vazio, opções reais, base zero, entrada separada, replay, recuperação, histórico vazio e erros400/404/409/503. Credencial efêmera somente por stdin; nenhuma identidade real.
- Testes adicionais PHP de HTTP privado opt-in, formulário de configuração e quatro campos passaram; proxy PHP contra API sintética passou.
- 20 testes Python de setup e4 testes Node de provisionamento (incluídos nos78) passaram. Comandos de Docker/SSH são simulados nesses testes; mensagens de configuração/backup impressas por fixtures não comprovam nem causam instalação real.
- Revisão independente estática sem achados críticos/importantes/menores. Confirmou extração sem mudança semântica de auth/executor e snapshots com mesmo cliente. Limites que não julgou (GLPI/assets/cache/transporte real/SSH/produção) permanecem pendências, sem alegação de correção nesses ambientes.

Durante construção do teste PHP, uma asserção exigia a ordem das propriedades JSON original e do replay JSONB. A localização comprovada foi a comparação após replay da entrada; corrigiu-se somente a asserção, ordenando recursivamente chaves de objetos e mantendo comparação estrita de valores/tipos. Nenhuma resposta da API foi alterada para acomodar o teste.

Em ambientes sem PHP/cURL (incluindo imagem Docker de teste Node), apenas esse cenário PHP é explicitamente ignorado; os testes Node/PostgreSQL e contrato HTTP continuam. Este ambiente executou o cenário PHP, sem ignorá-lo. Nenhuma dependência foi instalada para forçar disponibilidade.

Leituras compostas usam uma conexão do pool por requisição e transações curtas; não há benchmark de latência/carga nem alegação de ganho percentual. O limite do pool permanece12. Testes de migração criaram schema em banco novo descartável e conferiram repetição pelos hooks existentes; não é teste de restauração de backup.

Sem diferenças em migrações, plugin, scripts SSH/provisionamento, Compose, Nginx, dependências ou arquivos de ambiente. Não houve movimentação real nem credencial operacional criada.


Conferência de arquivos da imagem de testes: reproduzida resolução de módulos em cópia local dos arquivos de teste. Antes: ausentes docs/integracoes/integration-v1.openapi.json (nova dependência dos testes) e scripts/provision-integration.cjs (dependência já existente da suíte de setup). Após incluir os dois no estágio `test` do Dockerfile: referências resolvidas. Estágio de produção/runtime preservado. Essa reprodução verifica disponibilidade de arquivos, não equivale a construir/executar Docker; Docker permanece indisponível neste ambiente.

Conferência final: links relativos dos documentos tocados válidos, referências internas do OpenAPI resolvidas, whitespace do diff verificado, checagem focada de padrões de segredo nos arquivos alterados sem achados. Índice Git sem mudanças, commit base mantido; migrações/plugin/Compose/Nginx/scripts SSH/provisionamento/dependências sem diferenças. Arquivos externos preservados.
