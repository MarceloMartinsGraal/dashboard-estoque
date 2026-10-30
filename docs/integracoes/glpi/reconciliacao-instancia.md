# Reconciliação0.1.13 — preservar instância histórica do GLPI

O erro instance-in-use comprova que não é uma configuração inicial vazia. A identidade do GLPI não será alterada: suas intenções, resultados e chaves são preservados. Não apagar tabelas nem editar instance_id manualmente no banco/plugin.

Atualize os arquivos do repositório no Ubuntu ou aplique o patch fornecido (git apply --check primeiro). Na raiz:

```bash
sudo bash scripts/assistente-graal.sh --reconciliar-instancia
```

O comando reconstrói a imagem api com a CLI administrativa atualizada e reutiliza .env, projeto/volumes, responsável e vínculos salvos. Não modifica rotas/contratos HTTP, autenticação do dashboard ou regras de estoque. Sem migração nova. Atualizar só o ZIP do plugin não atualiza a CLI embarcada na imagem.

## Sequência

1. Usa a CLI oficial para desativar somente Estoque Graal, se estiver ativo. Inspeciona sua identidade e credencial por canal privado, sem imprimi-la. O plugin permanece desativado até a configuração final estar salva.
2. Verifica intenções abertas e resultados incertos. Um envio já iniciado possui intenção não concluída e impede alinhar um backend novo sem essa idempotência. Requisições novas não passam pelo Gate com plugin inativo. Intenções concluídas continuam terminais e nunca são reenviadas.
3. Na CLI administrativa do dashboard, verifica administrador ativo com primeiro acesso concluído, hash/validade/escopos das credenciais e vínculos individuais. Usa transação e locks com tempo limite, que aguardam operações concorrentes antes da decisão.
4. Se a credencial já salva no GLPI autentica um cliente da identidade histórica neste backend, reutiliza essa credencial. Não renomeia clientes ou cria segredo; a credencial nova de origem permanece preservada no banco/backup, sem revogação automática.
5. Se a identidade histórica ainda não possui cliente neste backend, só alinha o cliente criado pelo assistente quando ele é o único cliente da origem, não tem qualquer operação e não há intenção aberta/incerta no GLPI. Preserva UUID, segredo/hash, validade e escopos. Copia vínculos compatíveis e conserva os originais. Não funde instâncias com operações e não altera o livro de idempotência.
6. Faz backups protegidos do .env e token em `.local-setup/reconcile-*/`, antes da transação. Grava primeiro a credencial recuperada e depois GLPI_INSTANCE_ID no .env. Reexecução reconhece cliente já alinhado; interrupção entre as gravações pode ser retomada pelo mesmo comando.
7. O fluxo normal valida o provisionamento/vínculos com a identidade preservada, faz backup do plugin/configuração anterior, consulta a API autenticada e só então aplica a configuração, ativa o plugin e limpa o cache. Não grava movimentos.

## Bloqueios que exigem tratamento próprio

- target-credential-required: já existe cliente da identidade histórica, mas a credencial salva no GLPI não o autentica. Recuperar ou autorizar rotação dessa credencial; não autoriza criar outra por suposição.
- uncertain-history: há intenção aberta/incerta e o backend não conhece a identidade histórica. Recuperar idempotência do backend anterior; não reenviar operações para tentar resolver.
- source-in-use/source-shared: origem já operou ou tem outros clientes. Não será renomeada/fundida.
- link-conflict: vínculo existente aponta a outra conta ou está inativo. Não é remapeado automaticamente. A validação considera os vínculos que seriam copiados antes do commit.

Nesses casos, nenhuma operação/identidade é alterada pela transação recusada e o plugin fica desativado. Backups permanecem para revisão. Falha de conexão posterior também não autoriza repetir movimentos; o alinhamento já confirmado pode ser retomado, sem reverter identidades à força.

## Verificações e limites

62 testes Python; testes PHP reais/cURL com GLPI simulado para inspeção privada, estado aberto/incerto, probe e aplicação. Testes PostgreSQL locais verificam recuperação de credencial existente, cliente novo sem operações, preservação de token/UUID/vínculos, rollback em conflito, recusa de origem utilizada, intenções preparadas, credencial de origem expirada com histórico válido, retomada e operação concorrente. Revisão independente motivou proteção contra envios durante a troca e validação dos vínculos copiados.

A suíte final executou105 testes:104 passaram e o cenário visual de notas fiscais teve timeout. Oito testes de notas fiscais, incluindo esse navegador real, passaram na execução isolada seguinte; nenhum arquivo de frontend/nota fiscal foi alterado nesta tarefa. Os10 testes de reconciliação passaram na suíte e isoladamente.

O servidor Oracle/GLPI não foi acessado. Não foram executados deploy, migração, alteração de banco real, commit ou push. Docker/GLPI/CLI oficiais no Ubuntu ainda exigem homologação. Testes não provam que a credencial antiga do ambiente esteja válida ou que a origem esteja sem operações: o comando verifica esses fatos antes de aplicar.
