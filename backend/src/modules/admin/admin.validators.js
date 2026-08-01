const { z } = require('zod');

const paginationFields = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(25),
};

const listUsersSchema = z.object({
  query: z.object({
    ...paginationFields,
    search: z.string().trim().max(120).optional(),
    plan: z.enum(['basic', 'pro']).optional(),
    role: z.enum(['user', 'admin']).optional(),
  }),
});

const userIdSchema = z.object({
  params: z.object({ id: z.coerce.bigint().positive() }),
});

const updatePlanSchema = z.object({
  params: z.object({ id: z.coerce.bigint().positive() }),
  body: z.object({ plan: z.enum(['basic', 'pro']) }),
});

const updateRoleSchema = z.object({
  params: z.object({ id: z.coerce.bigint().positive() }),
  body: z.object({ role: z.enum(['user', 'admin']) }),
});

const listBillingSchema = z.object({
  query: z.object({
    ...paginationFields,
    search: z.string().trim().max(120).optional(),
    status: z.enum(['pending', 'paid', 'failed', 'expired', 'refunded']).optional(),
  }),
});

const listAuditSchema = z.object({
  query: z.object({
    ...paginationFields,
    search: z.string().trim().max(120).optional(),
    entity: z.string().trim().max(60).optional(),
    action: z.string().trim().max(40).optional(),
  }),
});

module.exports = {
  listUsersSchema,
  userIdSchema,
  updatePlanSchema,
  updateRoleSchema,
  listBillingSchema,
  listAuditSchema,
};
