# Invariantes financeiras

Estas regras são contrato do produto e devem ser preservadas por serviços, migrations e testes.

1. **Receita instantânea:** toda receita cadastrada aumenta o saldo disponível imediatamente, mesmo com competência futura. `incomeDate` é competência; `effectiveDate` é quando passou a afetar o caixa.
2. **Real imutável:** após a virada do calendário, meses reais anteriores são encerrados no servidor. Fatos estruturais não são editados ou apagados; pagamentos tardios e estornos são eventos novos.
3. **Simulação isolada:** cada cenário possui perfil, dados e relógio próprios. Nenhuma operação simulada alcança a conta real.
4. **Simulação recalculável:** reabrir um mês invalida e reconstrói os derivados posteriores. Lançamentos editáveis precisam recompor suas cadeias cronológicas.
5. **Cartão por ciclo:** data da compra/cobrança + fechamento escolhem a fatura; vencimento define a data de pagamento. Antecipar uma fatura não encerra seu ciclo.
6. **Fonte da fatura:** saldo pendente é a soma líquida dos lançamentos vinculados. O status persistido nunca substitui esse cálculo.
7. **Pagamento não reescreve competência:** `paidAt` registra o evento de caixa e não muda ao editar vencimento.
8. **Sem exclusão de dinheiro realizado:** despesa paga é estornada; apenas rascunho sem efeito financeiro pode ser apagado.
9. **Leituras puras:** GET não cria, corrige ou sincroniza registros. Reparos e sincronizações são comandos POST explícitos.
10. **Sessões separadas:** app do usuário e painel administrativo usam audiência, cookie e refresh token distintos.
11. **Auditoria atômica:** mutações do núcleo do ledger geram evidência na mesma transação do banco.
12. **Dados históricos:** telas de mês fechado usam somente snapshot congelado, sem misturar cartões, metas ou dívidas atuais.
