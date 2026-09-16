require('dotenv').config();
const { Client } = require('pg');

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  // Get the heroBackgroundUrl from the tenant that has it
  const source = await c.query(
    'SELECT "heroBackgroundUrl", "heroBannerUrl", "cardTitulo", "cardSubtitulo", "cardEtiqueta", "cardGarantia", "heroTitulo", "heroSubtitulo" FROM business_config WHERE "heroBackgroundUrl" IS NOT NULL LIMIT 1'
  );

  if (source.rows.length === 0) {
    console.log('No tenant has heroBackgroundUrl configured');
    await c.end();
    return;
  }

  const bgUrl = source.rows[0].heroBackgroundUrl;
  console.log('Source heroBackgroundUrl:', bgUrl);

  // Update all business_config that don't have it
  const result = await c.query(
    'UPDATE business_config SET "heroBackgroundUrl" = $1 WHERE "heroBackgroundUrl" IS NULL',
    [bgUrl]
  );

  console.log('Updated', result.rowCount, 'tenant configs with the background URL');

  // Verify
  const verify = await c.query(
    'SELECT bc."tenantId", t.name, bc."heroBackgroundUrl" FROM business_config bc JOIN tenants t ON bc."tenantId" = t.id WHERE t.active = true'
  );
  verify.rows.forEach(r => {
    console.log(`  ${r.name}: ${r.heroBackgroundUrl ? 'SET' : 'NULL'}`);
  });

  await c.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
