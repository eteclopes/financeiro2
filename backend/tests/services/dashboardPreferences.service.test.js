jest.mock('../../src/config/prisma', () => require('../helpers/prismaMock').createPrismaMock());

const prismaMock = require('../../src/config/prisma');
const { installDefaults } = require('../helpers/prismaMock');
const {
  DEFAULT_DASHBOARD_PREFERENCES,
  getPreferences,
  updatePreferences,
} = require('../../src/modules/dashboard/dashboardPreferences.service');

beforeEach(() => installDefaults(prismaMock));

describe('Preferências persistentes do Dashboard Pro', () => {
  test('retorna padrão seguro quando a conta ainda não personalizou', async () => {
    prismaMock.dashboardPreference.findUnique.mockResolvedValue(null);
    await expect(getPreferences(1n)).resolves.toEqual(DEFAULT_DASHBOARD_PREFERENCES);
  });

  test('atualiza somente os campos enviados sem perder os padrões', async () => {
    prismaMock.dashboardPreference.upsert.mockResolvedValue({
      userId: 1n,
      ...DEFAULT_DASHBOARD_PREFERENCES,
      showAlerts: false,
      projectionView: 'line',
    });

    const result = await updatePreferences(1n, { showAlerts: false, projectionView: 'line' });

    expect(prismaMock.dashboardPreference.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 1n },
      update: { showAlerts: false, projectionView: 'line' },
    }));
    expect(result.showAlerts).toBe(false);
    expect(result.projectionView).toBe('line');
    expect(result.showCards).toBe(true);
  });
});
