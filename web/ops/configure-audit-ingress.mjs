import { execFileSync } from "node:child_process";

const program = `
const fs = require('fs');
const cp = require('child_process');
const Database = require('better-sqlite3');
const db = new Database('/data/database.sqlite');
const host = db.prepare('SELECT domain_names, advanced_config FROM proxy_host WHERE id=13').get();
if (!host || host.domain_names !== '["perfectutilitares.duckdns.org"]') throw new Error('Unexpected proxy host');
if (host.advanced_config.includes('PERFECT_AUDIT_INGRESS')) throw new Error('Ingress already configured');
const sitePath = '/data/nginx/proxy_host/13.conf';
const httpPath = '/data/nginx/custom/http_top.conf';
const site = fs.readFileSync(sitePath, 'utf8');
const httpExists = fs.existsSync(httpPath);
const http = httpExists ? fs.readFileSync(httpPath, 'utf8') : '';
const block = [
  '# PERFECT_AUDIT_INGRESS',
  'client_max_body_size 101m;',
  'client_body_timeout 30s;',
  'limit_conn perfectutilitares_conn 20;',
  'limit_conn_status 429;',
  'limit_req_status 429;',
  'location = /api/fotos/processar {',
  '  client_max_body_size 9m;',
  '  include conf.d/include/proxy.conf;',
  '}',
  'location = /api/fotos/lote {',
  '  client_max_body_size 41m;',
  '  include conf.d/include/proxy.conf;',
  '}',
  'location = /api/auth/callback/credentials {',
  '  client_max_body_size 16k;',
  '  limit_req zone=perfectutilitares_auth burst=8 nodelay;',
  '  include conf.d/include/proxy.conf;',
  '}',
  '# END_PERFECT_AUDIT_INGRESS',
].join('\\n');
const zones = '\\n# PERFECT_AUDIT_INGRESS\\nlimit_conn_zone $binary_remote_addr zone=perfectutilitares_conn:1m;\\nlimit_req_zone $binary_remote_addr zone=perfectutilitares_auth:1m rate=30r/m;\\n';
const marker = '  # Custom';
if (!site.includes(marker)) throw new Error('Expected proxy template not found');
const backup = '/data/nginx/custom/perfectutilitares-ingress-backup-' + Date.now() + '.json';
fs.writeFileSync(backup, JSON.stringify({ site, http, httpExists, advancedConfig: host.advanced_config }), { mode: 0o600, flag: 'wx' });
try {
  cp.execFileSync('nginx', ['-t'], { stdio: 'pipe' });
  db.exec('BEGIN IMMEDIATE');
  fs.writeFileSync(httpPath, http + zones);
  fs.writeFileSync(sitePath, site.replace(marker, block + '\\n\\n' + marker));
  cp.execFileSync('nginx', ['-t'], { stdio: 'pipe' });
  db.prepare('UPDATE proxy_host SET advanced_config=? WHERE id=13').run(host.advanced_config + '\\n' + block);
  cp.execFileSync('nginx', ['-s', 'reload'], { stdio: 'pipe' });
  db.exec('COMMIT');
  console.log('Site limits persisted in NPM; nginx validated and reloaded. Backup: ' + backup);
} catch (error) {
  if (db.inTransaction) db.exec('ROLLBACK');
  fs.writeFileSync(sitePath, site);
  if (httpExists) fs.writeFileSync(httpPath, http); else if (fs.existsSync(httpPath)) fs.unlinkSync(httpPath);
  cp.execFileSync('nginx', ['-t'], { stdio: 'pipe' });
  cp.execFileSync('nginx', ['-s', 'reload'], { stdio: 'pipe' });
  throw new Error('Ingress update failed; prior configuration restored');
} finally { db.close(); }
`;
try {
  console.log(execFileSync("docker", ["exec", "nginx-proxy-manager-app-1", "node", "-e", program], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim());
} catch (error) {
  console.error("Ingress configuration failed; inspect the protected proxy backup before retrying.");
  if (error.stderr) console.error(String(error.stderr).split("\n").filter((line) => line.startsWith("Error:")).join("\n"));
  process.exitCode = 1;
}
