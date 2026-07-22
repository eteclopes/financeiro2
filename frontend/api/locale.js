function firstHeader(req, names) {
  for (const name of names) {
    const value = req.headers?.[name];
    if (Array.isArray(value) && value[0]) return value[0];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

export default function handler(req, res) {
  const rawCountry = firstHeader(req, [
    'x-vercel-ip-country',
    'cf-ipcountry',
    'x-country-code',
  ]);
  const countryCode = /^[A-Za-z]{2}$/.test(rawCountry || '') ? rawCountry.toUpperCase() : null;

  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Vary', 'Accept-Language');
  res.status(200).json({
    countryCode,
    regionCode: firstHeader(req, ['x-vercel-ip-country-region']) || null,
    acceptLanguage: firstHeader(req, ['accept-language']) || null,
  });
}
