const { Client } = require('pg');

async function main() {
  const c = new Client({
    connectionString: 'postgresql://neondb_owner:npg_6vbTOGAhk3Xr@ep-withered-snow-a5oempav-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require'
  });
  await c.connect();

  const r = await c.query(
    'SELECT bc."tenantId", t.name as tenant_name, bc."heroBannerUrl", bc."heroBackgroundUrl" FROM business_config bc JOIN tenants t ON bc."tenantId" = t.id WHERE t.active = true'
  );

  r.rows.forEach(row => {
    console.log('TenantID:', row.tenantId);
    console.log('Name:', row.tenant_name);
    console.log('Banner:', row.heroBannerUrl || 'NULL');
    console.log('Background:', row.heroBackgroundUrl || 'NULL');
    console.log('---');
  });

  // Check first active tenant (fallback)
  const ft = await c.query('SELECT id, name FROM tenants WHERE active = true ORDER BY id LIMIT 1');
  console.log('FALLBACK TENANT:', ft.rows[0]);

  await c.end();
}

main().catch(console.error);
