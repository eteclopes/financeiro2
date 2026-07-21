const { z } = require('zod');

const createCategorySchema = z.object({
  name: z.string().trim().min(1, 'Nome é obrigatório.').max(80),
  type: z.enum(['income', 'expense']),
});

// Limite mensal: aceita número positivo ou null (para remover o limite).
const updateCategorySchema = z.object({
  monthlyLimit: z.number().positive('O limite deve ser maior que zero.').nullable(),
});

const renameCategorySchema = z.object({
  name: z.string().trim().min(1, 'Nome é obrigatório.').max(80),
});

module.exports = { createCategorySchema, updateCategorySchema, renameCategorySchema };
