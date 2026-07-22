# Internacionalização e detecção automática — V12

## Escopo entregue

A V12 internacionaliza o sistema completo por uma camada central, sem duplicar páginas e sem alterar as regras financeiras existentes.

Idiomas de interface habilitados:

- Português
- Inglês
- Espanhol
- Russo

Regiões e moedas de apresentação incluem Brasil, Portugal, Estados Unidos, Reino Unido, Canadá, Austrália, Nova Zelândia, Índia, Espanha, México, Argentina, Chile, Colômbia, Peru, Uruguai, Rússia, França, Bélgica, Alemanha, Áustria, Suíça e Japão.

## Ordem da detecção

No primeiro acesso:

1. O endpoint `/api/locale` lê o código de país fornecido pela infraestrutura da Vercel.
2. O idioma do navegador é usado quando o país não possui um idioma de interface habilitado ou em países multilíngues.
3. O fuso horário vem do dispositivo por `Intl.DateTimeFormat`.
4. A moeda e a região são sugeridas conforme o país.
5. O resultado fica salvo no navegador.

A detecção não é repetida em toda recarga. Isso impede que uma viagem ou VPN altere silenciosamente as preferências. O usuário pode executar “Detectar automaticamente” novamente ou escolher idioma, região, moeda e fuso manualmente em Configurações.

Nenhum endereço IP é armazenado pelo aplicativo. O endpoint recebe apenas cabeçalhos já fornecidos pela plataforma e devolve o código do país.

## Datas e fusos

- Inputs de data continuam enviando `YYYY-MM-DD` para a API.
- Datas de calendário são formatadas na ordem da região escolhida sem mudar o dia armazenado.
- Timestamps usam o fuso horário selecionado.
- O valor inicial de “hoje” nos formulários considera o fuso escolhido.
- O frontend envia `X-Time-Zone`, `Accept-Language` e `X-Currency` em cada requisição.
- O backend usa `AsyncLocalStorage` para manter as preferências isoladas por requisição.
- Validações como “data futura” passam a considerar o fuso do usuário.

O seletor nativo de data continua sendo controlado pelo navegador/sistema operacional. O componente fornece o atributo `lang` da região escolhida e mantém o valor canônico ISO para evitar ambiguidades como `12/31` versus `31/12`.

## Moeda e números

A moeda selecionada altera apenas a apresentação:

- símbolo;
- separador decimal;
- separador de milhar;
- exemplos e placeholders monetários.

Não existe conversão cambial automática. Um valor 100 permanece numericamente 100 ao trocar BRL por USD, evitando mudanças silenciosas nos dados financeiros.

## Tradução

A camada `I18nBridge` observa textos estáticos renderizados em páginas, modais, formulários, menus, tutorial, mensagens, estados vazios e toasts. Somente frases conhecidas do código são traduzidas, reduzindo o risco de alterar descrições digitadas pelo usuário.

As categorias padrão do seed também possuem tradução. Categorias personalizadas permanecem como foram cadastradas, salvo quando o nome coincide exatamente com uma categoria padrão.

## Fallbacks

- Português é o fallback original do produto.
- Quando o idioma do país ainda não está habilitado, a interface utiliza inglês, mas mantém região, moeda e formato de data locais quando conhecidos.
- Se `/api/locale` estiver indisponível, o sistema usa idioma do navegador e fuso do dispositivo sem impedir o carregamento.
- Se um locale, fuso ou moeda for inválido, o sistema usa valores seguros padrão.

## Arquivos principais

- `frontend/api/locale.js`
- `frontend/src/store/localeStore.js`
- `frontend/src/i18n/I18nBridge.jsx`
- `frontend/src/i18n/translations.js`
- `frontend/src/i18n/extendedExact.js`
- `frontend/src/i18n/uiPhrases.js`
- `frontend/src/components/LocaleSwitcher.jsx`
- `frontend/src/lib/format.js`
- `frontend/src/lib/date.js`
- `backend/src/utils/requestContext.js`
- `backend/src/utils/dateTime.js`

## Validações executadas

- Análise sintática de 156 arquivos JS/JSX do frontend e backend com o parser TypeScript.
- `node --check` nos 91 arquivos JavaScript de `backend/src`.
- Verificação de 585 imports relativos, sem caminhos ausentes.
- Validação dos 5 arquivos JSON do projeto.
- Verificação de chaves duplicadas nos objetos de tradução.
- Testes isolados de detecção por país, persistência e preferência manual.
- Testes de tradução das áreas críticas em inglês, espanhol e russo.
- Testes de datas atravessando a virada do dia entre Los Angeles e Moscou.
- Teste do endpoint serverless de país sem exposição do endereço IP.
- Verificação de segurança do tutorial: 11 etapas, uma única rota e timeout limitado.
- Verificação de ausência de `node_modules`, `dist` e `build` no pacote.

## Limitação de validação

O build completo do Vite e a suíte completa do backend não foram executados neste ambiente porque as dependências do projeto não estão instaladas e não havia cache offline disponível. A validação realizada cobre sintaxe, imports e os módulos de internacionalização de forma isolada. Antes do deploy, execute em um ambiente com dependências:

```bash
cd frontend
npm ci
npm run build

cd ../backend
npm ci
npm test
npx prisma validate
```
