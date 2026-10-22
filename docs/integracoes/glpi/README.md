# Plugin Estoque Graal — documentação

- [Código-fonte e versão atual](../../../glpi-plugin/estoquegraal/README.md)
- [Instalação, atualização, remoção e diagnóstico](operacao.md)
- [Contrato, evidências e homologação pendente](verificacao.md)
- [Fontes oficiais consultadas](fontes.json)
- [Contrato da API do dashboard](../integration-v1.md)

Na raiz do repositório: `python scripts/package-glpi-plugin.py`. O ZIP e checksum ficam em `dist/`, ignorada pelo Git. O empacotador usa o código atual e inclui cópias destes guias dentro do pacote; esta pasta é a referência única da documentação no repositório. Os originais externos da entrega foram preservados; não são fonte para sobrescrever versões atuais.

O plugin depende do backend compatível do dashboard e ainda exige instalação e homologação em GLPI 11.0.5 isolado. Nenhuma instalação, banco ou servidor GLPI é acessado pelo empacotador.
