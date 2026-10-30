# Reconciliar preservando a identidade histórica do GLPI

Causa confirmada: GLPI possui intenções e não pode trocar a instância. Preservar sua identidade e reconciliar o configurador/backend. Sem apagar, reenviar ou remapear intenções/operações.

- [x] Testar com PostgreSQL sintético: recuperação de credencial GLPI já válida, alinhamento de cliente novo sem operações preservando token/UUID, rollback em conflito/atividade prévia, incerteza e reexecução.
- [x] CLI administrativa transacional com locks, admin apto e credenciais verificadas. Nunca renomear cliente com operações nem fundir instâncias. Se já houver cliente no destino, exigir credencial válida desse destino. Cliente recém-criado só pode mudar se for único na origem e não tiver operações; incerteza GLPI bloqueia esse caminho.
- [x] Exportação privada de identidade/token e indicador de incerteza pelo helper; assistente --reconciliar-instancia preserva GLPI e faz backup .env/token antes de persistir. Ordem de gravação permite retomada após interrupção.
- [x] Versão1.13, documentação, testes, revisão e pacote/patch. Backend HTTP/contrato/estoque permanecem; atualiza somente a CLI administrativa embarcada (imagem api deve ser reconstruída pelo comando normal).

Nenhum acesso/modificação real no servidor, commit, push ou deploy. Gerar correção local revisável. Não alegar homologação remota.

Revisão: corrigidos preflight dos vínculos copiados e congelamento do plugin antes de snapshot. Plugin só ativa após aplicação; qualquer intenção não concluída impede alinhar backend novo. Recuperação de credencial histórica válida não depende de origem ainda válida. PostgreSQL10casos passaram; suíte final105:104 passaram, um timeout visual de notas fiscais passou na execução isolada de8 testes. 62 Python e PHP/cURL passaram.
