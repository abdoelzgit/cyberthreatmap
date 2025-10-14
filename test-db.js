const { Client } = require('pg');

// Konfigurasi PostgreSQL langsung (tanpa dotenv untuk test)
const pgConfig = {
  host: 'localhost',
  port: 5432,
  database: 'Databases',
  user: 'postgres',
  password: '123'
};

async function testConnection() {
  const client = new Client(pgConfig);

  try {
    console.log('🔌 Testing database connection...');
    console.log('📍 Config:', {
      host: pgConfig.host,
      port: pgConfig.port,
      database: pgConfig.database,
      user: pgConfig.user
    });

    await client.connect();
    console.log('✅ Successfully connected to PostgreSQL!');

    // Test query
    const result = await client.query('SELECT NOW() as current_time, version()');
    console.log('🕐 Database time:', result.rows[0].current_time);
    console.log('📋 PostgreSQL version:', result.rows[0].version.split(' ')[1]);

    // Check if table exists
    const tableResult = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'filtered_alerts'
      );
    `);

    if (tableResult.rows[0].exists) {
      console.log('✅ Table "filtered_alerts" exists');

      // Count records
      const countResult = await client.query('SELECT COUNT(*) as total FROM filtered_alerts');
      console.log(`📊 Total records in table: ${countResult.rows[0].total}`);

      // Show sample data
      if (countResult.rows[0].total > 0) {
        const sampleResult = await client.query('SELECT * FROM filtered_alerts LIMIT 3');
        console.log('📋 Sample data:');
        console.table(sampleResult.rows);
      }
    } else {
      console.log('⚠️  Table "filtered_alerts" does not exist');
      console.log('🔧 Creating table...');

      await client.query(`
        CREATE TABLE filtered_alerts (
          id SERIAL PRIMARY KEY,
          srcip VARCHAR(45),
          dstip VARCHAR(45),
          level VARCHAR(20),
          time VARCHAR(20),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      console.log('✅ Table created successfully');
    }

  } catch (error) {
    console.error('❌ Connection failed:', error.message);
    console.log('\n🔧 Troubleshooting tips:');
    console.log('1. Pastikan PostgreSQL service sedang berjalan');
    console.log('2. Periksa konfigurasi database');
    console.log('3. Pastikan user dan password benar');
    console.log('4. Periksa pg_hba.conf untuk allow connections');
    console.log('5. Pastikan database "Databases" ada di pgAdmin');
  } finally {
    await client.end();
  }
}

testConnection();
