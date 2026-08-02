const { z } = require('zod');

const workspaceId = z.string().regex(/^[1-9]\d*$/, 'Identificador inválido.');

const createWorkspaceSchema = z.object({
  name: z.string().trim().min(3).max(100),
  startMonth: z.coerce.number().int().min(1).max(12),
  startYear: z.coerce.number().int().min(2000).max(2200),
  copySetup: z.boolean().default(true),
  initialBalance: z.coerce.number().min(-999999999).max(999999999).default(0),
});

const renameWorkspaceSchema = z.object({
  name: z.string().trim().min(3).max(100),
});

module.exports = { workspaceId, createWorkspaceSchema, renameWorkspaceSchema };
