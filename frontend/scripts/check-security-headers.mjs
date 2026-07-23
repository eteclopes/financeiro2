import fs from 'node:fs';

const vercel = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const failures = [];

const globalRule = vercel.headers?.find((rule) => rule.source === '/(.*)');
const globalHeaders = new Map((globalRule?.headers || []).map((header) => [header.key.toLowerCase(), header.value]));
const csp = globalHeaders.get('content-security-policy') || '';

if (!csp.includes("script-src 'self'")) failures.push('CSP não limita scripts ao próprio domínio.');
if (/script-src[^;]*'unsafe-inline'/.test(csp)) failures.push('CSP permite JavaScript inline.');
if (!csp.includes("frame-ancestors 'none'")) failures.push('CSP não bloqueia incorporação em frames.');
if (!globalHeaders.get('strict-transport-security')) failures.push('HSTS ausente.');
if (globalHeaders.get('referrer-policy') !== 'no-referrer') failures.push('Referrer-Policy não está em no-referrer.');
if (!globalHeaders.get('cache-control')?.includes('no-store')) failures.push('HTML não está marcado como no-store.');

const inlineScripts = [...index.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
  .filter((match) => match[1].trim());
if (inlineScripts.length) failures.push('index.html ainda contém JavaScript inline.');
if (!index.includes('src="/theme-init.js"')) failures.push('Inicialização segura de tema não encontrada.');

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Cabeçalhos do frontend e CSP verificados sem JavaScript inline.');
