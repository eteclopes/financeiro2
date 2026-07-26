const { z } = require('zod');

const idSchema = z.union([z.string().regex(/^\d+$/), z.number().int().positive()]);

const updateSettingsSchema = z.object({
  payDuesOnClose: z.boolean().optional(),
  payDuesMethod: z.enum(['debit', 'cash']).optional(),
  saveLeftoverOnClose: z.boolean().optional(),
  saveLeftoverType: z.enum(['percent', 'fixed']).optional(),
  saveLeftoverValue: z.coerce.number().min(0).max(1000000).optional(),
  saveLeftoverBucketId: idSchema.nullable().optional(),
}).superRefine((data, ctx) => {
  // Se vai guardar por porcentagem, exige 0-100.
  if (data.saveLeftoverType === 'percent' && data.saveLeftoverValue !== undefined && data.saveLeftoverValue > 100) {
    ctx.addIssue({ code: 'custom', path: ['saveLeftoverValue'], message: 'A porcentagem deve ser entre 0 e 100.' });
  }
});

const runNowSchema = z.object({
  monthId: z.coerce.number().int().positive(),
});

module.exports = { updateSettingsSchema, runNowSchema };
