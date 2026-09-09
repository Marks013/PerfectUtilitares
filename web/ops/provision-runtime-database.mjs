import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

// Run once on the server before the release. Credentials never leave this process.
const target = "/home/ubuntu/perfectutilitares-config/runtime-database.env";
const verify = process.argv.includes("--verify");
try {
  if (verify && !process.env.DATABASE_URL?.includes("/perfect_audit")) throw new Error("Disposable database required for verification");
  if (!verify && existsSync(target)) throw new Error("Runtime credentials already exist; refusing automatic rotation.");
  const password = randomBytes(32).toString("hex");
  const program = `
    const { Client } = require('pg');
    const fs = require('fs');
    const password = fs.readFileSync(0, 'utf8').trim();
    const role = 'perfect_runtime';
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    (async () => {
      await client.connect();
      await client.query('BEGIN');
      const exists = await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role]);
      if (exists.rowCount) throw new Error('Role already exists');
      if (!/^[a-f0-9]{64}$/.test(password)) throw new Error('Invalid generated credential');
      await client.query("CREATE ROLE perfect_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '" + password + "'");
      const db = await client.query('SELECT current_database() AS name, current_user AS owner');
      const quote = value => '"' + value.replaceAll('"', '""') + '"';
      await client.query('GRANT CONNECT ON DATABASE ' + quote(db.rows[0].name) + ' TO perfect_runtime');
      await client.query('GRANT USAGE ON SCHEMA public TO perfect_runtime');
      await client.query('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO perfect_runtime');
      await client.query('REVOKE ALL ON TABLE public."_prisma_migrations" FROM perfect_runtime');
      await client.query('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO perfect_runtime');
      await client.query('ALTER DEFAULT PRIVILEGES FOR ROLE ' + quote(db.rows[0].owner) + ' IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO perfect_runtime');
      await client.query('ALTER DEFAULT PRIVILEGES FOR ROLE ' + quote(db.rows[0].owner) + ' IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO perfect_runtime');
      // pg-boss manages partition tables and functions; ownership stays inside its dedicated schema.
      const schema = await client.query("SELECT 1 FROM pg_namespace WHERE nspname='pgboss'");
      if (schema.rowCount) {
        await client.query('ALTER SCHEMA pgboss OWNER TO perfect_runtime');
        const relations = await client.query("SELECT c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='pgboss' AND c.relkind IN ('r','p','S','v','m') ORDER BY c.relkind='S'");
        for (const r of relations.rows) {
          const kind = r.relkind === 'S' ? 'SEQUENCE' : r.relkind === 'v' ? 'VIEW' : r.relkind === 'm' ? 'MATERIALIZED VIEW' : 'TABLE';
          await client.query('ALTER ' + kind + ' pgboss.' + quote(r.relname) + ' OWNER TO perfect_runtime');
        }
        const routines = await client.query("SELECT p.oid::regprocedure::text AS signature, p.prokind FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='pgboss'");
        for (const r of routines.rows) await client.query('ALTER ' + (r.prokind === 'p' ? 'PROCEDURE' : 'FUNCTION') + ' ' + r.signature + ' OWNER TO perfect_runtime');
      } else await client.query('CREATE SCHEMA pgboss AUTHORIZATION perfect_runtime');
      await client.query('COMMIT');
      const url = new URL(process.env.DATABASE_URL);
      url.username = role;
      url.password = password;
      if (process.env.RUNTIME_AUDIT_VERIFY === 'true') {
        const runtime = new Client({ connectionString: url.toString() });
        await runtime.connect();
        const flags = (await runtime.query('SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication FROM pg_roles WHERE rolname=current_user')).rows[0];
        if (Object.values(flags).some(Boolean)) throw new Error('Excess runtime privileges');
        await runtime.query('SELECT count(*) FROM public."User"');
        let denied = false;
        try { await runtime.query('CREATE TABLE public.audit_forbidden (id int)'); } catch (error) { denied = error.code === '42501'; }
        if (!denied) throw new Error('Public DDL must be denied');
        await runtime.end();
        const { PgBoss } = require('pg-boss');
        const boss = new PgBoss({ connectionString: url.toString(), createSchema: false });
        await boss.start();
        await boss.createQueue('audit-role-check');
        const id = await boss.send('audit-role-check', { audit: true });
        if (!id) throw new Error('Queue send failed');
        const jobs = await boss.fetch('audit-role-check');
        if (jobs.length !== 1) throw new Error('Queue fetch failed');
        await boss.complete('audit-role-check', id);
        await boss.stop({ graceful: true });
        process.stdout.write('Runtime privileges and pg-boss create/send/fetch/complete verified');
      } else process.stdout.write(url.toString());
    })().catch((error) => { process.stderr.write(JSON.stringify({ code: error.code, message: String(error.message).replaceAll(password, '[redacted]').replace(/postgres(?:ql)?:\\/\\/\\S+/g, '[database]').slice(0, 300) })); process.exitCode=1; }).finally(() => client.end());
  `;
  const url = execFileSync("docker", ["exec", "-i", ...(verify ? ["-e", "DATABASE_URL", "-e", "RUNTIME_AUDIT_VERIFY=true"] : []), "web-app-1", "node", "-e", program], { input: password, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 60000 });
  if (verify) console.log(url);
  else {
    mkdirSync("/home/ubuntu/perfectutilitares-config", { recursive: true, mode: 0o700 });
    writeFileSync(target, `DATABASE_URL=${url.trim()}\n`, { mode: 0o600, flag: "wx" });
    console.log("Dedicated runtime role provisioned; protected env file created. Active containers unchanged.");
  }
} catch (error) {
  if (verify && error.stderr) console.error(String(error.stderr).slice(0, 600));
  console.error(error.message?.startsWith("Command failed") ? "Provisioning failed; credentials suppressed. Inspect role transaction before retrying." : error.message);
  process.exitCode = 1;
}
