const { Client } = require('pg');

// Konfigurasi PostgreSQL - connect ke default database dulu
const pgConfig = {
  host: 'localhost',
  port: 5432,
  database: 'postgres', // default database
  user: 'postgres',
  password: '123'
};

async function setupDatabase() {
  const client = new Client(pgConfig);

  try {
    console.log('🔌 Connecting to PostgreSQL...');
    await client.connect();
    console.log('✅ Connected successfully!');

    // List existing databases
    console.log('\n📋 Checking existing databases...');
    const dbResult = await client.query(`
      SELECT datname FROM pg_database
      WHERE datistemplate = false
      ORDER BY datname;
    `);

    console.log('Available databases:');
    dbResult.rows.forEach(row => console.log(`  - ${row.datname}`));

    const targetDb = 'Databases';
    const dbExists = dbResult.rows.some(row => row.datname === targetDb);

    if (!dbExists) {
      console.log(`\n🔧 Creating database "${targetDb}"...`);
      await client.query(`CREATE DATABASE "${targetDb}"`);
      console.log(`✅ Database "${targetDb}" created successfully!`);
    } else {
      console.log(`\n✅ Database "${targetDb}" already exists`);
    }

    // Connect to target database
    await client.end();
    const targetClient = new Client({
      ...pgConfig,
      database: targetDb
    });

    await targetClient.connect();
    console.log(`✅ Connected to "${targetDb}" database`);

    // Check if table exists
    const tableResult = await targetClient.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'filtered_alerts'
      );
    `);

    if (!tableResult.rows[0].exists) {
      console.log('\n🔧 Creating table "filtered_alerts"...');
      await targetClient.query(`
        CREATE TABLE filtered_alerts (
          id SERIAL PRIMARY KEY,
          srcip VARCHAR(45),
          dstip VARCHAR(45),
          level VARCHAR(20),
          time VARCHAR(20),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create indexes for better performance
      await targetClient.query(`
        CREATE INDEX IF NOT EXISTS idx_srcip ON filtered_alerts(srcip);
        CREATE INDEX IF NOT EXISTS idx_level ON filtered_alerts(level);
        CREATE INDEX IF NOT EXISTS idx_created_at ON filtered_alerts(created_at);
      `);

      console.log('✅ Table "filtered_alerts" created with indexes!');
    } else {
      console.log('\n✅ Table "filtered_alerts" already exists');

      // Count existing records
      const countResult = await targetClient.query('SELECT COUNT(*) as total FROM filtered_alerts');
      console.log(`📊 Current records: ${countResult.rows[0].total}`);
    }

    await targetClient.end();
    console.log('\n🎉 Database setup completed successfully!');

  } catch (error) {
    console.error('❌ Setup failed:', error.message);
    console.log('\n🔧 Troubleshooting:');
    console.log('1. Pastikan PostgreSQL service running');
    console.log('2. Check username/password');
    console.log('3. Verify pg_hba.conf allows local connections');
  } finally {
    await client.end();
  }
}

setupDatabase();
