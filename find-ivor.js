require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function run() {
  const result = await prisma.$queryRaw`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND data_type IN ('text', 'character varying');
  `;
  
  console.log('Searching', result.length, 'text columns across all tables...');
  for (const row of result) {
    try {
      const query = `SELECT count(*) as count FROM "${row.table_name}" WHERE "${row.column_name}"::text ILIKE '%Ivor%' OR "${row.column_name}"::text ILIKE '%Chrisviann%'`;
      const res = await prisma.$queryRawUnsafe(query);
      if (res[0] && Number(res[0].count) > 0) {
        console.log(`FOUND in table "${row.table_name}", column "${row.column_name}": ${res[0].count} matches`);
        const sample = await prisma.$queryRawUnsafe(`SELECT * FROM "${row.table_name}" WHERE "${row.column_name}"::text ILIKE '%Ivor%' OR "${row.column_name}"::text ILIKE '%Chrisviann%' LIMIT 3`);
        console.log('SAMPLE:', JSON.stringify(sample, null, 2));
      }
    } catch(e) {}
  }
}
run().finally(() => prisma.$disconnect());
