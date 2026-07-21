# Correção do Tutorial — V5 Estável

## Problema observado

O tutorial multi-rota podia ficar aguardando uma página, navegar por várias etapas ao tentar encontrar um alvo e manter a interface coberta. Isso também disparava carregamentos de diferentes módulos em sequência, dando a impressão de que o backend havia parado.

## Mudança estrutural

O tutorial agora funciona inteiramente no dashboard. Ele apresenta os demais módulos destacando os links da sidebar, sem trocar de rota e sem iniciar consultas adicionais ao backend.

## Proteções implementadas

- nenhuma navegação automática durante o tour;
- nenhuma busca por etapas em páginas diferentes;
- espera máxima curta e limitada;
- timeout ou alvo instável encerra o tour com segurança;
- somente alvos ocultos por responsividade podem ser pulados;
- botão de fechar nunca é desabilitado;
- a aplicação continua rolável durante o tutorial;
- posição de rolagem da página e da sidebar é restaurada ao fechar;
- fontes possuem espera máxima e nunca prendem a inicialização;
- animações não ficam congeladas pelo Driver.js;
- repetir o tutorial em Configurações usa uma solicitação pendente e começa apenas quando o dashboard estiver pronto;
- o primeiro tutorial automático não é repetido em loop quando o backend demora.

## Etapas atuais

1. Boas-vindas;
2. seletor de mês;
3. resumo financeiro;
4. saúde financeira;
5. ações rápidas;
6. receitas pela sidebar;
7. despesas pela sidebar;
8. cartões pela sidebar;
9. reserva e metas pela sidebar;
10. análises e relatórios pela sidebar;
11. configurações pela sidebar.

## Validações

- verificação estática de segurança do tutorial aprovada;
- todas as etapas usam apenas `/dashboard`;
- TutorialRunner não importa nem executa navegação;
- todos os arquivos JavaScript e JSX do frontend passaram pela validação de sintaxe do TypeScript;
- estrutura do ZIP contém somente a pasta principal `financeiro/`.

## Build

O `dist` anterior foi removido para não entregar um bundle antigo com o tutorial quebrado. A Vercel regenerará o `dist` automaticamente com `npm run build`. A instalação local não pôde ser concluída neste ambiente porque o registry npm respondeu com erro 503 durante a validação.
