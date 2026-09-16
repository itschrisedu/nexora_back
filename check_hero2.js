require('dotenv').config();
const { Client } = require('pg');

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const r = await c.query(`
    SELECT bc."tenantId", t.name, bc."heroBannerUrl", bc."heroBackgroundUrl"
    FROM business_config bc
    JOIN tenants t ON bc."tenantId" = t.id
    WHERE t.active = true
  `);

  r.rows.forEach(row => {
    console.log('TenantID:', row.tenantId);
    console.log('Name:', row.name);
    console.log('Banner:', row.heroBannerUrl || 'NULL');
    console.log('Background:', row.heroBackgroundUrl || 'NULL');
    console.log('---');
  });

  const ft = await c.query('SELECT id, name FROM tenants WHERE active = true ORDER BY id LIMIT 1');
  console.log('FALLBACK TENANT:', ft.rows[0]);

  await c.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
