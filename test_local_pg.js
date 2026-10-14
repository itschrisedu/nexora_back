const { Client } = require('pg');

async function testLocalDb() {
  const connectionStrings = [
    'postgresql://postgres:postgres@localhost:5432/nexora_db',
    'postgresql://postgres:postgres@localhost:5432/nexora',
    'postgresql://postgres:postgres@localhost:5432/postgres',
    'postgresql://postgres:admin@localhost:5432/nexora_db',
    'postgresql://postgres:admin@localhost:5432/nexora',
    'postgresql://postgres:admin@localhost:5432/postgres',
    'postgresql://postgres:1234@localhost:5432/nexora_db',
    'postgresql://postgres:1234@localhost:5432/nexora',
    'postgresql://postgres:1234@localhost:5432/postgres',
    'postgresql://postgres:123456@localhost:5432/nexora_db',
    'postgresql://postgres:123456@localhost:5432/nexora',
    'postgresql://postgres:123456@localhost:5432/postgres',
  ];

  for (const conn of connectionStrings) {
    const client = new Client({ connectionString: conn });
    try {
      await client.connect();
      console.log('Connected successfully to:', conn);
      const res = await client.query('SELECT table_name FROM information_schema.tables WHERE table_schema = \'public\'');
      console.log('Tables:', res.rows.map(r => r.table_name));
      await client.end();
      return;
    } catch (e) {
      // ignore
    }
  }
  console.log('Could not connect with common default passwords');
}

testLocalDb().catch(console.error);
