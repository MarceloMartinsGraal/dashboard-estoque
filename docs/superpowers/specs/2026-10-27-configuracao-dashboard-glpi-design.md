# Configuracao do Dashboard Graal e GLPI por SSH

Data: 27/10/2026
Base verificada: MarceloMartinsGraal/dashboard-estoque, main, commit 9f2a374c95baffa6287c4ae7deca1fb2ed6bfb6f.
Estado: desenho para revisao; scripts ainda nao implementados.

## Objetivo
Executar no Ubuntu do dashboard um script que prepara o ambiente e sobe Docker Compose; em seguida usar SSH para executar o segundo script no servidor GLPI com os dados necessarios a integracao. Nesta fase o acesso e HTTP por IPv4 privado; producao continuara HTTPS.

## Abordagem escolhida e alternativas
O usuario escolheu HTTP por IP para testes, com HTTPS na producao. A implementacao recomendada e uma pilha de homologacao separada, sem alterar o compose de producao. Certificados locais e tunel SSH permanente nao fazem parte desta etapa. SSH sera transporte de instalacao/configuracao; o plugin chamara diretamente a API pelo IP privado.

## Script do dashboard
- Executar no Ubuntu 24.04 com Docker Engine, Compose v2, SSH e dependencias verificadas. Nao instalar ou atualizar pacotes do host silenciosamente.
- Descobrir IPv4 privado por rota e interfaces locais, ignorando loopback e redes de containers; permitir substituicao explicita e escolha quando houver ambiguidade. Usar o IP do dashboard, nao o IP do GLPI.
- Criar .env a partir do exemplo, com permissao 600 e segredos independentes. Nao usar source/eval para interpretar conteudo do arquivo.
- Preservar valores existentes; backup protegido e escrita atomica. Nunca regenerar senhas de banco de volume existente, trocar segredos de sessao ou escolher outro projeto Compose silenciosamente.
- Registrar modo homologacao, IP/porta/origem, projeto Compose, host/porta/usuario SSH, caminho da chave, caminho do GLPI, usuario do processo PHP, instancia e referencia protegida da credencial. Valores ausentes podem ser perguntados em terminal.
- Gerar arquivos locais de homologacao sem reescrever templates versionados de producao. Banco e API sem portas publicadas; apenas proxy na interface privada selecionada. Identificar explicitamente que HTTP nao e modo de producao.
- Validar configuracao sem imprimir sua versao interpolada com segredos. Construir imagens, iniciar banco, aplicar migracoes existentes e iniciar API/proxy. Nao apagar volumes, importar estoque ou criar contas padrao.
- Primeiro responsavel por bootstrap interativo somente em banco vazio. Vinculos GLPI/funcionario exigem identificadores fornecidos e validacao, nunca associacao por nome.
- INTEGRATION_ENABLED deve chegar ao container, pois o compose atual de producao nao encaminha essa variavel. Habilitar apenas na pilha solicitada para integracao.
- Credenciais de integracao nao sao senhas do banco e hoje nao vem do .env: reutilizar uma credencial valida fornecida por arquivo protegido ou provisionar cliente no banco com hash, escopos, validade e auditoria, via comando administrativo local e ator valido. Guardar o segredo somente em arquivo protegido fora do Git, referenciado por configuracao. Nao gerar outra credencial em cada execucao e nao alterar credenciais existentes sem pedido.
- Empacotar o plugin atual e transferir via SSH somente pacote, segundo script e payload permitido: URL da API, instancia, token e timeouts. Nunca enviar .env inteiro, senha PostgreSQL ou SESSION_SECRET.
- Verificar host SSH, usar chave/agente ou autenticacao interativa existente, sem senha no .env e sem desativar verificacao da chave do host. Nao tentar senhas ou executar destinos nao informados.

## Script do GLPI
- Receber parametros validados e dados sensiveis em stdin ou arquivo temporario com permissao restrita, nunca em argumentos ou logs.
- Validar caminho e versao do GLPI, PHP e extensoes. Identificar plugins/marketplace e abortar se houver copia conflitante. Nao instalar outro GLPI.
- Backup de plugin/configuracao fora da raiz publica; validar pacote e caminhos antes de extrair. Atualizar sem desinstalar, preservando permissoes e intencoes.
- Usar CLI/APIs oficiais do GLPI para instalacao/ativacao e configuracao. A configuracao do token deve passar pela criptografia oficial do GLPI; nada de SQL direto para gravar segredo.
- Quando nao houver comando oficial apropriado, fornecer helper CLI restrito, validado contra GLPI 11.0.5 e recusando execucao web.
- Configurar URL, instancia, timeouts e credencial recebidos. Nao conceder direitos amplos a todos os perfis. Permissoes e vinculos pendentes devem ser informados, nao inventados.
- Validar conectividade por consulta de leitura. Nao criar produtos, chamados, intencoes ou movimentos para testar a instalacao.
- Nao reiniciar todos os servicos PHP/HTTP do host. Recarregamento somente do servico identificado e quando necessario.

## HTTP por IP: adaptacao estritamente de homologacao
Settings.php atualmente permite HTTP apenas para loopback. Criar opcao separada e explicita de homologacao para IPv4 privado literal, limitada ao endereco configurado e as faixas RFC1918. Padrao desabilitado. Nao habilitar HTTP para qualquer destino, nao seguir redirecionamentos que escapem da origem permitida e nao desabilitar verificacao TLS.
Manter os modos atuais de HTTPS e HTTP loopback. No modo producao exigir HTTPS e recusar a excecao de homologacao. Avisar no resumo que o ambiente usa HTTP e deve permanecer em rede privada confiavel. SSH nao protege o trafego HTTP posterior entre os servidores.

## Reexecucao, falhas e limites
Reexecutar nao apaga dados, nao recria contas e nao duplica vinculos/clientes. Uma falha remota nao deve apagar a pilha local ja funcional; mostrar etapa e como retomar. Preparar rollback dos arquivos sem prometer desfazer migracoes ou dados automaticamente.
Criar os scripts e testar com respostas simuladas e ambientes descartaveis. Nesta tarefa nao acessar servidores reais, subir a pilha habitual, emitir certificados, abrir firewall, alterar DNS, fazer commit, push ou deploy. A execucao dos scripts nos servidores sera posterior pelo responsavel.

## Verificacao e entrega
Testar configuracao nova/existente, ausencia de dependencia, ambiguidade de IP, preservacao de segredos, erro SSH, chave de host, argumentos/caminhos, geracao dos arquivos, fluxo Compose e erros remotos com executaveis simulados. Testar Settings para HTTP privado opt-in, recusa sem opt-in, recusa de IP publico e HTTPS preservado. Validar sintaxe Bash/PHP, pacote, documentacao e testes afetados. Ensaiar Docker/GLPI reais somente se houver ambiente local isolado disponivel; distinguir verificacao estatica/simulada de homologacao real.
Entregar dois scripts de entrada, helpers estritamente necessarios, documentacao, exemplo de configuracao sem segredos, testes e pacote atualizado se o plugin mudar. Relatar alteracoes, verificacoes, pendencias e commit sugerido; nao executar commit.
