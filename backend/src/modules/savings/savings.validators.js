const { z } = require('zod');

const bucketKinds = ['general', 'emergency', 'travel', 'home', 'education', 'vehicle', 'custom'];
const creatableBucketKinds = bucketKinds.filter((kind) => kind !== 'general');

const savingsMovementSchema = z.object({
  value: z.coerce.number().positive('Valor deve ser maior que zero.').max(1_000_000_000),
  date: z.coerce.date(),
  observation: z.string().trim().max(255).optional(),
  origin: z.enum(['balance', 'external']).default('balance'),
  // Opcional para manter compatibilidade com versões antigas do frontend.
  // Sem bucketId, a API usa a caixinha padrão do usuário.
  bucketId: z.coerce.bigint().optional(),
});

const savingsBucketSchema = z.object({
  kind: z.enum(creatableBucketKinds).default('custom'),
  name: z.string().trim().max(120).optional().nullable(),
  targetValue: z.coerce.number().positive().max(1_000_000_000).optional().nullable(),
}).superRefine((data, ctx) => {
  if (data.kind === 'custom' && !data.name?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['name'], message: 'Informe um nome para a caixinha personalizada.' });
  }
});

const savingsBucketUpdateSchema = z.object({
  kind: z.enum(bucketKinds).optional(),
  name: z.string().trim().max(120).optional().nullable(),
  targetValue: z.coerce.number().positive().max(1_000_000_000).optional().nullable(),
}).refine((data) => Object.keys(data).length > 0, { message: 'Nenhuma alteração informada.' });

const savingsTransferSchema = z.object({
  fromBucketId: z.coerce.bigint(),
  toBucketId: z.coerce.bigint(),
  value: z.coerce.number().positive('Valor deve ser maior que zero.').max(1_000_000_000),
  date: z.coerce.date(),
  observation: z.string().trim().max(255).optional(),
});

module.exports = {
  savingsMovementSchema,
  savingsBucketSchema,
  savingsBucketUpdateSchema,
  savingsTransferSchema,
};
