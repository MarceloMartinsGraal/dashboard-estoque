# Notas fiscais — biblioteca documental

## Uso

Após entrar no dashboard, escolha **Notas fiscais** na navegação principal. O botão **Anexar nota fiscal** recebe um PDF de até20MiB (20.971.520bytes). O nome começa com o nome do arquivo e pode ser editado. Escolha Nota avulsa ou Vincular a um produto. Busca por descrição/UUID/ID legado trata caixa/acentos e inclui produtos sem saldo e inativos. Um inativo exige confirmação explícita; nunca é reativado ou criado automaticamente.

A listagem possui busca por nome, nome original ou ID do documento, filtro avulsa/vinculada e produto, paginação20 e ordem data/ID decrescente. Mostra funcionário/data de envio, produto e ações Visualizar, Baixar e Alterar nome ou vínculo. Desvincular conserva o PDF. Vínculos e mudanças de nome ficam na auditoria com autor e data.

Em Produtos → Armários (detalhes do produto), a seção **Notas fiscais** mostra até5 documentos e oferece a lista geral filtrada ou novo envio com produto pré-selecionado. Ambos usam os mesmos registros/arquivos. Não há entrada, saída, cadastro de produto, quantidade, financeiro, impostos, fornecedor, OCR ou envio ao GLPI.

PDF idêntico é detectado por SHA-256, inclusive reenvio e uploads simultâneos. A interface mostra o registro existente e oferece visualizar/revisar vínculo; não copia o PDF nem troca o vínculo silenciosamente. Depois de falha de conexão, confira a lista antes de reenviar. Um reenvio do mesmo conteúdo resolve para a duplicidade existente; não é criado um segundo documento.

## Arquitetura e contrato HTTP

Módulo `backend/src/invoices/`: controller com sessão/CSRF, service com validações/vínculos/auditoria e storage com stream limitado/checksum/arquivo. Migração006 adiciona `invoice_documents` e `invoice_product_links`. A chave primária do vínculo permite zero/um produto por documento; futura ampliação pode alterar essa constraint sem duplicar PDF. Nome original e dados do blob/autoria são preservados por trigger; não há endpoint de exclusão.

Todas as rotas abaixo exigem sessão individual ativa. Escritas exigem Origin e x-csrf-token existentes. Bearer do GLPI não autoriza essas rotas. Funcionário ativo **e session_version** são revalidados sob lock após o upload e antes da gravação, impedindo confirmação após revogação durante recebimento.

| Método e caminho | Entrada/resultado |
|---|---|
| GET /api/invoices | q,link=all/loose/linked,productId,page,limit → items,total,page,limit |
| GET /api/invoices/products | q,page,limit → catálogo completo pertinente, inclusive sem saldo/inativo; descrição completa,ID,legacyId,active |
| GET /api/invoices/products/:id | produto existente para filtro/pré-seleção |
| GET /api/invoices/:id | metadados públicos do documento, produto opcional,uploadedBy,uploadedAt |
| POST /api/invoices | corpo binário application/pdf; x-file-name e x-invoice-name percent-encoded; x-product-id vazio ouUUID; x-confirm-inactive=true/false →201 documento |
| POST /api/invoices/:id | JSON {name,productId:null ouUUID,confirmInactive?:boolean} →201 documento revisado |
| GET /api/invoices/:id/file | PDF inline autenticado; ?download=true entrega attachment |

Os metadados não retornam storage_key ou caminho interno. Nome servido no Content-Disposition é gerado pelo backend com ID estável, sem interpolar nome fornecido pelo usuário. Erros mantêm statusCode/message/code/requestId;409 INVOICE_DUPLICATE acrescenta documentId do registro existente. Inativo sem confirmação409; inválido/vazio400; tamanho413; sessão inválida401/403; documento inexistente404; arquivo indisponível/corrompido503; falha interna500. Nenhuma falha vira lista vazia ou sucesso fictício.

O upload é binário direto, sem multipart/base64 e sem dependência adicional. O parser JSON permanece12MiB nos demais fluxos. Stream limita armazenamento incremental a20MiB, calcula checksum sem carregar o PDF inteiro na memória; descarte limitado de resto do request permite responder erro sem salvar conteúdo excedente. A conexão HTTP ainda segue os timeouts do servidor/proxy.

## Validação e entrega privada

Extensão .pdf, Content-Type application/pdf, arquivo não vazio, header PDF1.0..1.7/2.0, marcador EOF, startxref e destino de xref compatível (tabela ou objeto XRef) são conferidos. Essa validação de estrutura é parcial, não certifica todo o formato e **não é análise de malware**. PDF pode conter conteúdo ativo; o backend não o interpreta nem executa. Não foi adicionada ferramenta/serviço externo de análise. Arquivos que dependam de tolerância de leitor, com estrutura ausente/inconsistente, são rejeitados.

Visualização/download passam pelo guard e conferem tamanho/SHA-256 antes da transmissão. Cabeçalhos: application/pdf, nosniff, cache no-store, CSP sandbox/default-src none e Content-Disposition inline/attachment. Links abrem sem acesso ao opener. Não há URL pública permanente ou leitura direta de documentos pelo Nginx. Não foi introduzida política de antivírus/OCR, nem alegação de PDF livre de malware.

## Armazenamento e configuração

- Nativo: `INVOICE_STORAGE_DIR=./var/invoices` em .env, resolvido pelo processo na inicialização. Diretório fora de frontend/public, ignorado pelo Git/contexto Docker. Não usar /tmp nem uma pasta servida publicamente. Deve persistir entre execuções e permitir leitura/escrita apenas ao usuário da API.
- Docker dev/homologação/produção: volume nomeado **invoices**, montado somente na API em `/var/lib/graal/invoices`. Variável definida na imagem; manter esse caminho para corresponder à montagem. O nome físico inclui o projeto Compose existente; não trocar -p/projeto.
- Imagem prepara diretório700 pertencente a node (UID/GID1000 da imagem); arquivos600. Volume Docker novo herda a propriedade do diretório da imagem. Volumes existentes/restaurados devem ter propriedade/permissões equivalentes antes de iniciar. API continua sem privilégios, root filesystem read-only e cap_drop ALL.
- Nginx local/homologação/produção aceita21MiB somente em `location = /api/invoices`, com proxy_request_buffering off; backend limita PDF a20MiB. Limite geral12m permanece. Nenhuma porta/volume de PostgreSQL foi alterada.
- PDFs e diretório nativo foram ignorados no Git e no contexto de build. Não copiar notas reais para testes.

Arquivo temporário `.upload-UUID` é criado com exclusividade; nomes/caminhos do usuário nunca são utilizados como caminho. O arquivo é sincronizado, publicado por hardlink com UUID.pdf sem sobrescrever outro e, em Linux, o diretório é sincronizado antes de gravar/confirmar metadados. O temporário é removido no finally; falha/interrupção do processo pode deixar temporário para conferência posterior.

Não existe transação distribuída entre disco e PostgreSQL. A linha só é confirmada depois da publicação. Uma falha posterior ou COMMIT com resposta perdida **não apaga o arquivo final**, pois ele pode estar referenciado por transação confirmada. Arquivos órfãos ficam privados e são identificados pela conferência; não aparecem na lista documental sem metadados confirmados. Corrupção/remoção externa de arquivo já cadastrado gera erro503 na entrega, nunca PDF fictício.

## Migração e atualização futura autorizada

1. Fazer backup coordenado conforme seção seguinte; preservar .env, projeto Compose, pgdata e dados atuais.
2. Revisar/aplicar **006_invoice_documents.sql** pelo migrador versionado habitual. Não editar001..005, não resetar banco. O migrador confere checksums e é repetível. Migração006 não cria nota, produto ou movimento.
3. Reconstruir imagem e atualizar serviços da instalação escolhida, mantendo projeto/env/volumes. Em homologação/dev o serviço migrate existente aplica a migração; em produção usar a CLI migrate do procedimento de operações. Documentos precisam da migração antes de atender requisições da UI nova.
4. Criar/montar volume invoices com permissões indicadas. Atualizar imagem web/Nginx para UI e limite de upload. API antiga pode continuar operando estoque, mas não atende a aba nova.
5. Homologar com PDF sintético: avulso, vínculo, duplicidade, abrir/baixar e reiniciar API. Não usar notas reais para ensaio.

Recuar imagem não desfaz006 nem apaga arquivos. Preservar tabelas e volume mesmo ao retornar a revisão anterior. Não usar down -v, não trocar projeto e não apagar notas para contornar falhas. Nenhuma dessas etapas foi executada em servidor nesta entrega.

## Integridade, temporários e órfãos

CLI somente leitura, no mesmo ambiente/banco/diretório da API:

```bash
# Docker de homologação, na raiz do checkout e com a pilha existente:
sudo docker compose --env-file .env -f compose.homologacao.yaml exec api node dist/backend/invoice-check.js
# Execução nativa:
node --env-file=.env dist/backend/invoice-check.js
```

Retorna contagem, issues (IDs cujo arquivo está indisponível ou corrompido), orphans (arquivos finais sem metadados), temporaries e readOnly=true. Exit0 sem divergências,2 com divergência e1 se não conseguir conferir. Não imprime PDF/nome original nem credenciais e não remove nada. Conferir em janela sem uploads para evitar classificar como órfão um arquivo entre publicação e commit.

Para temporários de processo interrompido: parar apenas API, confirmar que nenhum upload está ativo e fazer backup antes de remover manualmente **somente** os .upload-UUID reportados e revisados. A aplicação remove apenas seu próprio temporário durante a requisição. Não remover UUID.pdf automaticamente: correlacionar checksum/backup/transação e pedir validação do responsável. Arquivo válido com metadados nunca é alvo de limpeza automática.

## Backup e restauração coordenados

**Backup apenas do PostgreSQL NÃO inclui os PDFs.** O conjunto recuperável precisa de dump consistente do PostgreSQL, cópia integral do volume/diretório de documentos, checksums/relatório da conferência, identificação do projeto/versão e configuração protegida.

Procedimento: programar janela, concluir uploads, parar a API para impedir novas alterações (manter PostgreSQL ativo), gerar pg_dump com usuário autorizado e copiar o volume invoices inteiro para destino de backup protegido fora da instalação pública. Guardar .env/segredos separadamente com acesso restrito; não anexar ao Git/chat. Registrar instante/versão e conferir checksum dos arquivos. Só então retomar API. Cópias independentes feitas durante escrita não comprovam consistência entre banco e arquivos.

Restauração: somente ambiente isolado primeiro. Restaurar o dump e a cópia **do mesmo conjunto** em banco/volume de destino, ajustar node UID/GID/permissões e INVOICE_STORAGE_DIR, aplicar somente migrações compatíveis necessárias, executar invoice-check e comparar o relatório/checksums. Abrir/baixar PDFs sintéticos de prova, conferir autoria/vínculos e depois testar reinício. Não prometer que restaurar só um volume ou voltar imagem recupera todo o conjunto. Nunca sobrepor produção sem autorização e plano revisado.

## Verificações desta entrega

Resultados finais estão em [notas-fiscais-verificacao.md](notas-fiscais-verificacao.md). Docker/Nginx/Ubuntu, queda abrupta do host e restauração coordenada não foram executados nesta máquina; continuam pendentes de homologação autorizada. Nenhuma nota real, servidor, estoque operacional, plugin GLPI, commit ou push foi utilizado/alterado pelo agente.
