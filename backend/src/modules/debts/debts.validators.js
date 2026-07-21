const { z } = require('zod');

const createDebtSchema = z.object({
  monthId: z.coerce.bigint(),
  description: z.string().trim().min(1, 'Descrição é obrigatória.').max(160),
  categoryId: z.coerce.bigint(),
  totalValue: z.coerce.number().positive('Valor total deve ser maior que zero.'),
  installmentsCount: z.coerce.number().int().min(1, 'Mínimo de 1 parcela.').max(360),
  flexiblePayment: z.boolean().default(false),
  dueDay: z.coerce.number().int().min(1).max(31),
  // Para registrar uma compra parcelada que já está em andamento (feita
  // antes de começar a usar o app) — ex.: "já estou na parcela 4 de 12".
  // O restante do sistema passa a tratar como uma dívida nova de
  // (installmentsCount - startingInstallment + 1) parcelas a partir daqui;
  // não recria historicamente as parcelas 1 a (startingInstallment - 1).
  startingInstallment: z.coerce.number().int().min(1).max(360).default(1),
}).refine((data) => data.startingInstallment <= data.installmentsCount, {
  message: 'A parcela atual não pode ser maior que o total de parcelas.',
  path: ['startingInstallment'],
});

// Não inclui totalValue/installmentsCount: mudar esses dois depois que a
// dívida já existe exigiria recalcular installmentValue/remainingBalance e
// potencialmente reescrever parcelas já geradas — para isso, quite/exclua a
// dívida atual e crie uma nova.
const updateDebtSchema = z.object({
  description: z.string().trim().min(1, 'Descrição é obrigatória.').max(160).optional(),
  categoryId: z.coerce.bigint().optional(),
  flexiblePayment: z.boolean().optional(),
  dueDay: z.coerce.number().int().min(1).max(31).optional(),
});

module.exports = { createDebtSchema, updateDebtSchema };