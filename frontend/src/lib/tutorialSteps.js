// Cada passo aponta pra um elemento (via atributo data-tutorial, mais
// estável que depender de classes CSS que podem mudar de estilo sem
// avisar) numa rota específica. Como o tour passa por VÁRIAS páginas, e o
// Driver.js sozinho só sabe destacar elementos que já existem no DOM
// (ou seja, só da página atual), TutorialRunner.jsx é quem navega para a
// rota do próximo passo antes de pedir pro Driver.js destacar o elemento
// — ver o comentário lá para o porquê disso ser necessário.
export const TUTORIAL_STEPS = [
  {
    route: '/dashboard',
    element: null, // primeiro passo: popup central, sem destacar nada
    title: 'Bem-vindo ao FinanceHub! 👋',
    description: 'Um tour rápido pelas principais áreas do app — leva menos de 2 minutos. Você pode pular a qualquer momento e rever depois em Configurações.',
  },
  {
    route: '/dashboard',
    element: '[data-tutorial="month-selector"]',
    title: 'Mês selecionado',
    description: 'Tudo que você vê no app é sempre referente a UM mês. Use as setas ou o seletor para navegar entre meses passados e futuros — o app lembra onde você parou da próxima vez que entrar.',
    side: 'bottom',
  },
  {
    route: '/dashboard',
    element: '[data-tutorial="dashboard-summary"]',
    title: 'Resumo do mês',
    description: 'Receita, despesas e saldo do mês selecionado, sempre atualizados conforme você lança coisas novas.',
    side: 'bottom',
  },
  {
    route: '/dashboard',
    element: '[data-tutorial="financial-health"]',
    title: 'Saúde financeira',
    description: 'Uma pontuação de 0 a 100 que combina renda vs. despesa, reserva de emergência e nível de endividamento — acompanhe se está melhorando mês a mês.',
    side: 'top',
  },
  {
    route: '/dashboard',
    element: '[data-tutorial="quick-actions"]',
    title: 'Ações rápidas e fechamento do mês',
    description: 'Registre lançamentos rápidos sem sair do dashboard. Quando o mês terminar, use "Encerrar Mês" aqui — o app gera automaticamente as contas fixas, assinaturas e parcelas do mês seguinte.',
    side: 'top',
  },
  {
    route: '/incomes',
    element: '[data-tutorial="new-income"]',
    title: 'Receitas',
    description: 'Cadastre entradas pontuais (um bico, um presente) ou recorrentes (salário) — as recorrentes se repetem sozinhas todo mês.',
    side: 'left',
  },
  {
    route: '/expenses',
    element: '[data-tutorial="expense-tabs"]',
    title: 'Três tipos de despesa',
    description: '"Prioridade" são suas dívidas parceladas (financiamentos, compras grandes). "Fixas" se repetem todo mês com o mesmo valor (aluguel, plano de corte). "Variáveis" são gastos do dia a dia (mercado, lazer).',
    side: 'bottom',
  },
  {
    route: '/expenses',
    element: '[data-tutorial="new-expense-button"]',
    title: 'Nova despesa',
    description: 'Ao cadastrar uma despesa fixa ou uma dívida, você escolhe a forma de pagamento — se for no cartão de crédito, ela entra direto na fatura e só desconta o saldo quando a fatura for paga.',
    side: 'left',
  },
  {
    route: '/subscriptions',
    element: '[data-tutorial="new-subscription-button"]',
    title: 'Assinaturas',
    description: 'Netflix, academia, qualquer cobrança recorrente que não seja mensal fixa comum — inclusive anual ou em periodicidade personalizada. Pause quando quiser sem perder o histórico.',
    side: 'left',
  },
  {
    route: '/cards',
    element: '[data-tutorial="cards-list"]',
    title: 'Cartões e faturas',
    description: 'Cada cartão tem seu limite e sua fatura mensal. Compras parceladas geram todas as parcelas futuras de uma vez, cada uma na fatura certa.',
    side: 'right',
  },
  {
    route: '/savings',
    element: '[data-tutorial="savings-actions"]',
    title: 'Reserva financeira',
    description: 'Ao depositar, você escolhe se o dinheiro está saindo do seu saldo agora ou se já estava guardado fora do app — isso muda se o depósito desconta seu saldo disponível ou não.',
    side: 'bottom',
  },
  {
    route: '/goals',
    element: '[data-tutorial="new-goal-button"]',
    title: 'Metas',
    description: 'Defina um valor e um prazo (viagem, reserva de emergência, entrada de um imóvel) e acompanhe o progresso com aportes.',
    side: 'left',
  },
  {
    route: '/reports',
    element: '#report-content',
    title: 'Relatórios',
    description: 'Uma visão consolidada e imprimível do mês — receitas, despesas, saúde financeira e alertas, tudo em um lugar só.',
    side: 'top',
  },
  {
    route: '/settings',
    element: '[data-tutorial="tutorial-replay-button"]',
    title: 'Configurações e perfil',
    description: 'Edite seu nome, mude o tema claro/escuro e, se precisar, reveja este tour a qualquer momento clicando aqui.',
    side: 'top',
  },
];
