const prisma = require('../../config/prisma');

const DEFAULT_DASHBOARD_PREFERENCES = Object.freeze({
  showSummaryChart: true,
  showAlerts: true,
  showRecommendations: true,
  showCards: true,
  showProjections: true,
  showCategoryChart: true,
  showGoals: true,
  summaryChart: 'bars',
  projectionView: 'area',
});

function publicPreferences(row) {
  if (!row) return { ...DEFAULT_DASHBOARD_PREFERENCES };
  return Object.fromEntries(
    Object.keys(DEFAULT_DASHBOARD_PREFERENCES).map((key) => [
      key,
      row[key] ?? DEFAULT_DASHBOARD_PREFERENCES[key],
    ])
  );
}

async function getPreferences(userId, client = prisma) {
  const row = await client.dashboardPreference.findUnique({ where: { userId } });
  return publicPreferences(row);
}

async function updatePreferences(userId, input, client = prisma) {
  const row = await client.dashboardPreference.upsert({
    where: { userId },
    create: { userId, ...DEFAULT_DASHBOARD_PREFERENCES, ...input },
    update: input,
  });
  return publicPreferences(row);
}

module.exports = {
  DEFAULT_DASHBOARD_PREFERENCES,
  publicPreferences,
  getPreferences,
  updatePreferences,
};
