jest.mock('../../src/config/prisma', () => require('../helpers/prismaMock').createPrismaMock());
jest.mock('../../src/modules/months/months.service');

const prismaMock = require('../../src/config/prisma');
const { installDefaults } = require('../helpers/prismaMock');
const monthsService = require('../../src/modules/months/months.service');
const { createGoal, updateGoal, cancelGoal } = require('../../src/modules/goals/goals.service');

beforeEach(() => installDefaults(prismaMock));

describe('goals.service — AuditLog', () => {
  test('createGoal grava audit log de create', async () => {
    prismaMock.goal.create.mockResolvedValue({ id: 4n, userId: 10n, name: 'Viagem' });

    await createGoal(10n, { name: 'Viagem', targetValue: 5000 });

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ entity: 'goal', entityId: 4n, action: 'create' }) })
    );
  });

  test('updateGoal grava audit log de update', async () => {
    prismaMock.goal.findFirst.mockResolvedValue({ id: 4n, userId: 10n, name: 'Viagem' });
    prismaMock.goal.update.mockResolvedValue({ id: 4n, name: 'Viagem Europa' });

    await updateGoal(10n, 4n, { name: 'Viagem Europa' });

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ entity: 'goal', entityId: 4n, action: 'update' }) })
    );
  });

  test('cancelGoal sem devolução grava audit log de cancel', async () => {
    prismaMock.goal.findFirst.mockResolvedValue({ id: 4n, userId: 10n, status: 'active' });
    prismaMock.goal.update.mockResolvedValue({ id: 4n, status: 'cancelled' });

    const result = await cancelGoal(10n, 4n, { refundContributions: false });

    expect(result.refund).toBeNull();
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ entity: 'goal', entityId: 4n, action: 'cancel' }) })
    );
  });

  test('cancelGoal com devolução cria a transação de refund e ainda assim grava só 1 audit log (de cancel)', async () => {
    prismaMock.goal.findFirst.mockResolvedValue({ id: 4n, userId: 10n, status: 'active' });
    prismaMock.goal.update.mockResolvedValue({ id: 4n, status: 'cancelled' });
    prismaMock.goalContribution.findMany.mockResolvedValue([{ type: 'contribution', value: 200 }]);
    monthsService.getCurrentMonth.mockResolvedValue({ id: 9n });
    prismaMock.goalContribution.create.mockResolvedValue({ id: 99n, value: 200, type: 'refund' });

    const result = await cancelGoal(10n, 4n, { refundContributions: true });

    expect(result.refund).toMatchObject({ value: 200, type: 'refund' });
    expect(prismaMock.auditLog.create).toHaveBeenCalledTimes(1);
  });

  test('cancelar meta já cancelada é rejeitado (409) e não grava audit log', async () => {
    prismaMock.goal.findFirst.mockResolvedValue({ id: 4n, userId: 10n, status: 'cancelled' });

    await expect(cancelGoal(10n, 4n, { refundContributions: false })).rejects.toMatchObject({ statusCode: 409 });
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });
});
