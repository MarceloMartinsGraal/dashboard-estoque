# Manual da Marca Graal Solutions

Versão 1.0 · outubro de 2026 · Graal Informática Ltda. · Proposta para aprovação

Regras para usar o nome, a logo, as cores e as fontes da Graal Solutions de forma consistente no site, em documentos, apresentações, redes sociais e materiais impressos. Toda alteração visual no site deve seguir este manual.

## Aplicação no site (referência rápida)

| O quê | Onde no projeto |
| --- | --- |
| Logo horizontal, tema claro | `public/graal-logo-horizontal-lighttheme.svg` |
| Logo horizontal, tema escuro (e rodapé, sempre escuro) | `public/graal-logo-horizontal-darktheme.svg` |
| Logo vertical, colorida | `public/graal-logo-lighttheme.svg` (usada no structured data) |
| Símbolo branco / colorido escuro | `public/brand/simbolo-branco.svg`, `public/brand/simbolo-escuro.svg` |
| Favicon e ícones do app | `public/icon.svg`, `favicon.ico`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` |
| Componente da logo | `src/components/BrandMark.tsx` (proporção 786.3 × 181; `alwaysDark` para fundos sempre escuros) |
| Cores | `src/app/globals.css`: `--brand-gold` #DBA62D, `--brand-gold-hover` #E8B83D e `--brand-gold-light` #FDEB67 são fixas nos dois temas; `--brand-yellow` acompanha o tema (#DBA62D no escuro, #B08220 no claro) e é a cor de textos e ícones dourados |
| Fontes | `next/font` no layout: Space Grotesk (`font-display`, títulos) e Manrope (`font-sans`, textos) |

Os arquivos completos da identidade (logos em SVG e PNG, ícones e o manual em HTML) ficam em `docs/Graal Solutions - Identidade Visual/`, pasta fora do git.

## 01. A marca

Quem somos e como a marca deve soar. Tudo neste manual parte daqui.

**Graal Solutions** é o nome comercial da **Graal Informática Ltda.**, empresa de Florianópolis (SC) que opera a camada de tecnologia de outras empresas: TI gerenciada e Service Desk, infraestrutura, cibersegurança, monitoramento e governança, com sistemas de gestão certificados ISO/IEC 27001 e ISO/IEC 27701.

A promessa da marca, como aparece no site, é dar às empresas uma operação de TI em que elas possam confiar: responsabilidade clara, processos documentados e segurança incorporada à rotina.

### Atributos

- **Confiável.** Entregamos o que foi combinado, com previsibilidade.
- **Disciplinada.** Processo, documentação e método no lugar do improviso.
- **Segura.** Proteção e privacidade fazem parte de tudo que fazemos.
- **Próxima.** Trabalhamos como extensão da equipe do cliente.

### Tom de voz

- Direto e claro, sem jargão desnecessário.
- Seguro, mas sem arrogância nem promessas exageradas.
- Fala de resultados para o negócio (disponibilidade, risco, controle), não só de tecnologia.
- Sempre escrever **Graal Solutions**; em textos corridos, **Graal** sozinho é aceito depois da primeira menção.

## 02. Logo e símbolo

A logo é formada por duas partes: o **símbolo** (o escudo) e o **logotipo** (a escrita GRAAL SOLUTIONS). As duas têm desenho próprio e não devem ser redesenhadas.

1. **Moldura dourada.** O contorno superior do escudo. Representa proteção e solidez: a empresa que cuida da operação do cliente.
2. **Meia-lua dourada.** A peça curva logo abaixo da moldura. Traz o dourado para o centro da marca e remete ao "graal", algo valioso e guardado com cuidado.
3. **Corpo do escudo.** As três peças escuras: as laterais e a ponta central. Dão peso e seriedade ao símbolo e formam a ponta voltada para baixo.
4. **Logotipo.** GRAAL em letras largas e pesadas; SOLUTIONS menor e bem espaçado. É um desenho fixo: use sempre o arquivo, nunca digite o nome com uma fonte.

## 03. Assinaturas

Assinatura é a forma como símbolo e logotipo aparecem juntos. Existem quatro, cada uma para um tipo de espaço.

| Assinatura | Quando usar |
| --- | --- |
| **Horizontal · principal** | Use por padrão. Cabeçalhos, rodapés, documentos, assinaturas de e-mail e qualquer espaço mais largo que alto. |
| **Vertical** | Espaços quadrados ou altos: capas, cartazes, crachás, brindes, slides de abertura e fachada. |
| **Símbolo** | Só quando a marca já está identificada por perto ou o espaço é muito pequeno: favicon, ícone de app, foto de perfil nas redes, marca d'água. |
| **Só o nome** | Uso restrito. Quando o símbolo já aparece em outro lugar da mesma peça, ou em aplicações de uma cor só, como gravação em texto. |

## 04. Versões de cor

Cada assinatura existe em cinco versões. A escolha depende do fundo e de como a peça será produzida.

| Versão | Descrição e uso |
| --- | --- |
| **Colorida** | Versão principal, com os gradientes dourado e grafite. Fundos claros, em telas e impressão de qualidade. |
| **Colorida escura** | Mesma logo com o corpo do escudo em cinza claro e a escrita branca. Fundos escuros, como o tema escuro do site. |
| **Flat** | Dourado e preto sólidos, sem gradiente. Bordado, serigrafia, adesivos, brindes, ícones pequenos e onde gradiente não imprime bem. |
| **Preta** | Uma cor só. Impressão em preto e branco, fax, carimbo, gravação a laser, documentos oficiais e fundos claros coloridos. |
| **Branca** | Uma cor só, para fundos escuros, fotos e fundos coloridos escuros, inclusive o dourado da marca. |

**Sobre fotos:** use a branca sobre áreas escuras e calmas da imagem. Se a foto for clara, use a preta. Nunca a colorida sobre foto movimentada.

As mesmas cinco versões existem no símbolo e na vertical. Sobre fundo dourado, use a preta.

**Regra rápida:** fundo claro → colorida; fundo escuro → colorida escura; uma cor só ou fundo colorido → preta ou branca, a que tiver mais contraste; produção física sem gradiente → flat.

## 05. Área de proteção e tamanho mínimo

A logo precisa de espaço livre ao redor para ser lida, e de um tamanho mínimo para que SOLUTIONS continue legível.

- **x é a altura das letras de GRAAL.** Nenhum texto, imagem, borda ou outro elemento pode entrar nesse espaço, em nenhum dos quatro lados. A mesma regra vale para a assinatura vertical.
- No **símbolo sozinho**, a margem é de um quarto da altura do escudo.

| Assinatura | Tamanho mínimo |
| --- | --- |
| Horizontal | 120 px na tela · 30 mm impresso (largura) |
| Vertical | 100 px na tela · 25 mm impresso (largura) |
| Símbolo | 16 px na tela · 6 mm impresso (altura) |

Abaixo desses tamanhos, use só o símbolo. Para tamanhos muito pequenos (até 32 px), prefira o **símbolo flat**: os gradientes somem e as cores sólidas ficam mais nítidas.

## 06. Usos incorretos

Qualquer alteração na logo enfraquece o reconhecimento da marca. Estes são os erros mais comuns:

- **Não distorcer.** Sempre redimensione mantendo a proporção.
- **Não girar.** A logo fica sempre na horizontal.
- **Não trocar as cores.** Use só as cinco versões oficiais.
- **Não aplicar efeitos.** Sem sombra, brilho, contorno, 3D ou degradê extra.
- **Não usar a versão errada no fundo.** A colorida clara some em fundo escuro. Use a colorida escura.
- **Não usar sem contraste.** A colorida sobre dourado perde o símbolo. Use a preta.
- **Não recriar o logotipo.** Não digite o nome com outra fonte ao lado do símbolo.
- **Não invadir a área de proteção.** Textos e elementos ficam fora da margem x.

## 07. Paleta de cores

O dourado identifica a marca; o grafite e o quase-preto dão a base séria. Os neutros sustentam a maior parte das peças.

### Cores principais

| Cor | Papel | HEX | RGB | Uso |
| --- | --- | --- | --- | --- |
| **Dourado Graal** | Primária | `#DBA62D` | 219 166 45 | Cor da marca. Símbolo, botões e destaques; textos dourados sobre fundo escuro. |
| **Dourado claro** | Brilho | `#FDEB67` | 253 235 103 | Ponto de luz do gradiente. Não usar em texto. |
| **Grafite** | Primária | `#1A1A1A` | 26 26 26 | Corpo do escudo na versão flat e textos fortes. |
| **Noite** | Base | `#0B0D0F` | 11 13 15 | Fundo escuro principal, usado no site. |

### Gradiente dourado

É o gradiente metálico da moldura do escudo. **Fica reservado à logo**; em outras peças, use o Dourado Graal sólido.

```css
linear-gradient(90deg, #dcac36 3.6%, #e6b53b 10.7%, #dba62d 17.9%, #dba82e 25%, #e7bd3f 32.1%, #f6d34f 39.3%, #fdeb67 46.4%, #feea67 53.6%, #f7d350 60.7%, #e7be40 67.9%, #dcaa2f 75%, #dba62d 82.1%, #e8b83d 89.3%, #dcac36 96.4%)
```

### Cores de apoio (site e interfaces)

| Cor | Papel | HEX | RGB | Uso |
| --- | --- | --- | --- | --- |
| **Dourado hover** | Digital | `#E8B83D` | 232 184 61 | Botões dourados ao passar o mouse, nos dois temas. |
| **Dourado texto** | Digital | `#B08220` | 176 130 32 | Textos, ícones e links dourados sobre fundo claro. Mantém o contraste mínimo de leitura. |
| **Superfície escura** | Neutro | `#111417` | 17 20 23 | Cartões e blocos sobre o fundo Noite. |
| **Texto** | Neutro | `#151618` | 21 22 24 | Texto principal sobre fundos claros. |
| **Cinza texto** | Neutro | `#686A6E` | 104 106 110 | Textos de apoio e legendas. |
| **Papel** | Neutro | `#F6F5F1` | 246 245 241 | Fundo claro principal. |
| **Branco** | Neutro | `#FFFFFF` | 255 255 255 | Superfícies claras e logo sobre fundo escuro. |

### Proporção de uso

**Neutros 70% · Escuros 20% · Dourado 10%.**

O dourado é o destaque: funciona porque aparece pouco. Ele nunca deve dominar a peça nem ser usado em textos longos.

Para impressão: os valores CMYK e Pantone devem ser definidos com a gráfica a partir do HEX, com prova de cor, porque a conversão automática deixa o dourado opaco.

## 08. Tipografia

Duas famílias, as mesmas do site. Ambas são gratuitas (Google Fonts) e podem ser instaladas em qualquer computador.

| Uso | Fonte | Pesos | Características |
| --- | --- | --- | --- |
| **Títulos** | [Space Grotesk](https://fonts.google.com/specimen/Space+Grotesk) | Regular 400, Medium 500, Bold 700 | Técnica e geométrica. Títulos, subtítulos, números de destaque e chamadas curtas. |
| **Textos** | [Manrope](https://fonts.google.com/specimen/Manrope) | Regular 400, Medium 500, SemiBold 600, Bold 700 | Legível em qualquer tamanho. Textos corridos, botões, menus, tabelas, legendas e documentos. |

### Hierarquia sugerida

| Nível | Fonte | Peso | Tela | Documento | Exemplo |
| --- | --- | --- | --- | --- | --- |
| Título 1 | Space Grotesk | Bold 700 | 48–60 px | 28–32 pt | Segurança operacional |
| Título 2 | Space Grotesk | Bold 700 | 32–38 px | 20–22 pt | Serviços gerenciados |
| Título 3 | Space Grotesk | Medium 500 | 20–24 px | 14–16 pt | Monitoramento proativo |
| Sobretítulo | Manrope | SemiBold 600, caixa alta | 12–13 px | 8–9 pt | TI GERENCIADA |
| Texto | Manrope | Regular 400 | 16–18 px | 10–11 pt | Suporte estruturado aos usuários. |
| Legenda | Manrope | Medium 500 | 13–14 px | 8 pt | Atualizado em outubro de 2026 |

Sem as fontes instaladas (por exemplo, em e-mails e no Word de outra pessoa), use **Arial** ou **Segoe UI**. O logotipo GRAAL SOLUTIONS não é escrito com nenhuma dessas fontes: é um desenho próprio e deve ser usado sempre a partir dos arquivos.

## 09. Onde usar cada uma

Guia prático por tipo de peça. Na dúvida, siga a regra rápida do capítulo 04.

| Aplicação | Assinatura | Versão | Formato |
| --- | --- | --- | --- |
| Site: cabeçalho | Horizontal (38 px de altura; 28 a 32 px no celular) | Colorida no tema claro, colorida escura no tema escuro | SVG |
| Site: rodapé | Horizontal (44 px de altura) | Colorida escura, porque o rodapé é sempre escuro | SVG |
| Favicon e ícone do app | Símbolo | Colorido; flat abaixo de 32 px | SVG, ICO, PNG |
| Foto de perfil (LinkedIn, Instagram, YouTube) | Símbolo | Colorido escuro sobre fundo Noite | PNG |
| Posts e capas de redes sociais | Horizontal ou vertical | Colorida ou branca sobre foto | PNG |
| Assinatura de e-mail | Horizontal | Colorida | PNG (largura de 160 a 200 px) |
| Propostas, contratos e relatórios | Horizontal | Colorida; preta se for impresso em P&B | SVG ou PNG |
| Apresentações | Vertical na capa, horizontal nos slides | Colorida ou colorida escura, conforme o fundo | SVG ou PNG |
| Papelaria (cartão, papel timbrado, envelope) | Horizontal; vertical no verso do cartão | Colorida ou flat | SVG / PDF para gráfica |
| Uniformes e bordados | Vertical ou símbolo | Flat; branca em tecido escuro | SVG |
| Brindes (canecas, cadernos, canetas) | Símbolo ou vertical | Flat, preta ou branca | SVG |
| Gravação a laser, carimbo, adesivo de patrimônio | Horizontal ou símbolo | Preta | SVG |
| Fachada, placa e sinalização | Vertical ou horizontal | Colorida escura sobre fundo escuro, ou flat | SVG |
| Vídeos (abertura e marca d'água) | Vertical na abertura, símbolo na marca d'água | Branca, com 60–80% de opacidade na marca d'água | PNG |
| Materiais de parceiros e eventos | Horizontal | A que der mais contraste com o fundo | SVG ou PNG |

### Fazer

- Usar sempre os arquivos oficiais.
- Preferir SVG; PNG só onde vetor não é aceito.
- Respeitar a área de proteção e o tamanho mínimo.
- Escolher a versão pelo fundo, buscando o maior contraste.

### Evitar

- Copiar a logo de prints, sites ou PDFs.
- Ampliar PNG pequeno (fica serrilhado).
- Colocar a logo sobre fundos poluídos ou com pouco contraste.
- Criar versões novas sem aprovação.

## 10. Arquivos

Todos os arquivos estão em SVG (vetor, qualquer tamanho) e em PNG com fundo transparente (2000 px no lado maior).

| Assinatura | Colorida | Colorida escura | Flat | Preta | Branca |
| --- | --- | --- | --- | --- | --- |
| Horizontal | `logo-horizontal` | `logo-horizontal-escuro` | `logo-horizontal-flat` | `logo-horizontal-preto` | `logo-horizontal-branco` |
| Vertical | `logo-vertical` | `logo-vertical-escuro` | `logo-vertical-flat` | `logo-vertical-preto` | `logo-vertical-branco` |
| Símbolo | `simbolo` | `simbolo-escuro` | `simbolo-flat` | `simbolo-preto` | `simbolo-branco` |
| Só o nome | — | — | — | `nome-preto` | `nome-branco` |

Cada nome existe como `.svg` e `.png`. No pacote de identidade visual, os arquivos ficam nas pastas `Logos/SVG` e `Logos/PNG`; os ícones do site ficam em `Ícones do site`.

---

Graal Solutions · Manual da Marca · versão 1.0 · Graal Informática Ltda. · CNPJ 08.386.299/0001-76 · Florianópolis, SC
