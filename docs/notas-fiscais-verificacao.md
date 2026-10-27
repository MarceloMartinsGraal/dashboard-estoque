# Verificação de Notas fiscais — 27/10/2026

Base7b443e0, checkout limpo no início, sem branch/commit/push/servidor. Requisitos e escopo: [guia](notas-fiscais.md) e [plano](superpowers/plans/2026-10-27-notas-fiscais.md).

## Cenários e evidência

`tests/invoices.test.cjs` usa PostgreSQL descartável novo loopback _test, sessões reais Nest/Express, filesystem temporário privado e PDFs sintéticos. Nenhuma nota real. O PDF de prova tem catálogo, árvore de páginas, offsets, tabela xref, trailer/startxref/EOF; não é apenas texto com extensão alterada.

- Upload avulso/vinculado, autor/data e ausência de criação de movimentos.
- SHA-256 e UNIQUE: reenvio e dois uploads concorrentes não criam outra linha/cópia válida; conflito aponta documento existente.
- Busca de produtos por acento/nome/ID, incluindo zero/inativo; inativo exige confirmação.
- Consulta geral/produto, filtro avulsa, busca sem acentos, paginação estável e documentos recentes primeiro.
- Nome/vínculos editados e removidos com auditoria; arquivo permanece.
- Visualização/download autenticados, PDF real byte a byte, headers inline/attachment/nosniff; anônimo bloqueado.
- Arquivo vazio, HTML disfarçado, estrutura incompleta, extensão/caminho inválido, UUID inválido e limite20MiB rejeitados; CSRF obrigatório.
- Limite incremental exercitado sem Content-Length; temporário removido.
- Falha de gravação simulada no filesystem não deixa metadados. Falha real de trigger na transação de auditoria reverte metadados/vínculo, conserva arquivo órfão e relatório identifica sem apagar. Arquivo corrompido gera503 e relatório; não é entregue como PDF válido.
- Aplicação nativa encerrada/recriada com o mesmo banco/diretório: metadados e conteúdo continuam acessíveis após novo login. Não equivale a reiniciar Docker/host.
- Revogação de session_version entre autorização inicial e fim do recebimento:403, sem confirmação documental.
- Navegador Edge real com frontend compilado e backend/PostgreSQL locais: login, menu, upload, duplicata, revisão de vínculo, inativo/confirmar, detalhes do produto e novo envio pré-selecionado; atraso de produto seguido de troca de aba; viewport390. PDF enviado por seletor real CDP. Screenshot local work/invoices-mobile.png (ignorado).

## Revisão e correções

Revisão independente estática identificou quatro pontos: fsync do diretório após hardlink; versão da sessão no commit; resposta de produto atrasada contaminando nova aba/URL; label hidden sobreposto pelo CSS. Foram corrigidos. Vermelho observado:201 em sessão revogada onde esperado403; checkbox visível sem seleção; navegador comprovou alteração indevida da aba/URL após resposta tardia. Verde exige os mesmos testes após a correção. Sincronização de diretório é aplicada somente no Linux; execução Windows não comprova resistência a queda abrupta do host.

Uma falha de infraestrutura do teste foi corrigida sem enfraquecer contrato: o título real do resumo é “Estoque da Graal”, não o rótulo de navegação “Visão geral”; seletores do navegador passaram a usar somente diálogos abertos. Nenhuma expectativa funcional de estoque/autenticação foi relaxada. Recebimento de arquivo rejeitado foi ajustado para drenar sem armazenar o restante limitado e evitar reset prematuro antes da resposta413.

## Reproduzir

Em banco novo local descartável terminado em _test, definir TEST_DATABASE_URL e executar `npm test`; `npm run typecheck`, `npm run lint`, `npm run build`. O ambiente desta entrega reutiliza o PostgreSQL portátil previamente disponível com `node work/run-tests.cjs`; logs locais work/invoices-*.log não entram no Git.

O navegador usa EDGE_BINARY ou Edge Windows existente; sem runtime disponível esse cenário é explicitamente ignorado. O teste PHP existente mantém a mesma política para PHP/cURL. Não foi instalada dependência para executar testes. Build frontend é necessário antes do cenário de navegador. Docker test inclui o helper do navegador, mas a imagem Node atual não possui Edge; não prometer execução visual em contêiner.

CLI de integridade: teste verifica divergência, órfão, nenhum temporário e preservação do arquivo final. Lista de documentos é distinta da lista de arquivos privados: arquivo sem transação confirmada não aparece disponível.

## Limites

Não executados: Docker/Compose/Nginx/Ubuntu, permissões do volume em daemon real, fsync de diretório Linux sob falha de energia, restauração coordenada de backup, antivírus, validação completa da especificação PDF ou homologação com notas reais. Não houve acesso ao GLPI nem mudança de seu plugin/contrato. Sem alegação de PDF livre de malware.

Os PDFs são armazenados fora do diretório público e ignorados por Git/Docker. Banco e documentos precisam de backup conjunto; nenhum backup/restauração real foi realizado. Não há exclusão definitiva nesta entrega.

## Resultado final

- Suíte completa: **86/86 aprovados**, zero falhas/ignorados, em PostgreSQL descartável real. Os78 cenários anteriores foram preservados. Log: work/invoices-full.log.
- Última rodada focal da funcionalidade:8 testes em work/invoices-final.log, incluindo navegador e refinamento da asserção de rollback pelo nome realmente enviado.
- Tipos, lint e build aprovados. Testes Python de configuração:20/20 aprovados; comandos remotos são simulados nessas fixtures, não executados em servidor.
- Revisão independente concluída; os quatro achados receberam correção. Três regressões comprovadas em vermelho e verde; fsync de diretório Linux revisado no código, sem ensaio de falha de energia.
- Conferência de Git/links/arquivos ignorados e migrações anteriores realizada ao encerrar. Índice/HEAD preservados, sem commit. Nenhum PDF real, segredo ou dado operacional incluído.
- Docker/Nginx/volume Ubuntu e restauração coordenada continuam pendentes, conforme limites acima.
