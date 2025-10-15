const { Client } = require('pg');
const fs = require('fs').promises;

// Konfigurasi PostgreSQL
const pgConfig = {
  host: 'localhost',
  port: 5432,
  database: 'Databases',
  user: 'postgres',
  password: '123'
};

// Fungsi untuk membuat table attacker jika belum ada
async function createAttackerTable(client) {
  console.log('🔧 Checking/creating attacker table...');

  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS attacker (
      id SERIAL PRIMARY KEY,
      lon DECIMAL(10, 6),
      lat DECIMAL(10, 6),
      source_ip VARCHAR(45),
      dstip VARCHAR(45),
      agent_name VARCHAR(100),
      time TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;

  const createIndexesQuery = `
    CREATE INDEX IF NOT EXISTS idx_source_ip ON attacker(source_ip);
    CREATE INDEX IF NOT EXISTS idx_agent_name ON attacker(agent_name);
    CREATE INDEX IF NOT EXISTS idx_time ON attacker(time);
    CREATE INDEX IF NOT EXISTS idx_lon_lat ON attacker(lon, lat);
  `;

  await client.query(createTableQuery);

  // Add dstip column if it doesn't exist (for backward compatibility)
  try {
    await client.query(`
      ALTER TABLE attacker ADD COLUMN IF NOT EXISTS dstip VARCHAR(45)
    `);
    console.log('✅ dstip column added/verified');
  } catch (alterError) {
    console.log('⚠️  Note: dstip column may already exist or table structure issue');
  }

  await client.query(createIndexesQuery);
  console.log('✅ Attacker table ready');
}

// Fungsi untuk filter dan insert data attacker
async function filterAndInsertAttackerData() {
  const client = new Client(pgConfig);

  try {
    console.log('🚀 Starting attacker data filtering and insertion...');
    await client.connect();
    console.log('✅ Connected to database');

    // Buat table jika belum ada
    await createAttackerTable(client);

    // Baca data.json
    console.log('📖 Reading attack data from data.json...');
    const rawData = await fs.readFile('data.json', 'utf8');
    const jsonData = JSON.parse(rawData);

    if (!jsonData.hits || !jsonData.hits.hits) {
      throw new Error('Invalid data structure in data.json');
    }

    // Filter dan ekstrak data attacker
    console.log('🔍 Filtering attacker data...');
    const attackers = [];

    for (const hit of jsonData.hits.hits) {
      const source = hit._source;

      // Pastikan semua field yang dibutuhkan ada
      if (
        source.GeoLocation &&
        source.GeoLocation.location &&
        source.GeoLocation.location.lon !== undefined &&
        source.GeoLocation.location.lat !== undefined &&
        source.data &&
        source.data.srcip &&
        source.agent &&
        source.agent.name &&
        source['@timestamp']
      ) {
        attackers.push({
          lon: parseFloat(source.GeoLocation.location.lon),
          lat: parseFloat(source.GeoLocation.location.lat),
          source_ip: source.data.srcip,
          dstip: source.data.dstip || null,
          agent_name: source.agent.name,
          time: new Date(source['@timestamp'])
        });
      }
    }

    console.log(`📊 Found ${attackers.length} valid attacker records to process`);

    // Debug: Show sample data
    if (attackers.length > 0) {
      console.log('\n📋 Sample attacker data:');
      attackers.slice(0, 3).forEach((attacker, i) => {
        console.log(`${i+1}. ${attacker.source_ip} → ${attacker.agent_name} [${attacker.lon}, ${attacker.lat}] at ${attacker.time.toISOString()}`);
      });
    }

    // Clear existing data (optional - comment out if you want to keep existing data)
    console.log('\n🗑️  Clearing existing attacker data...');
    await client.query('TRUNCATE TABLE attacker');
    console.log('✅ Existing data cleared');

    // Bulk insert attackers
    console.log('💾 Inserting attacker data into database...');
    const insertQuery = `
      INSERT INTO attacker (lon, lat, source_ip, dstip, agent_name, time)
      VALUES ($1, $2, $3, $4, $5, $6)
    `;

    let successCount = 0;
    let errorCount = 0;

    for (const attacker of attackers) {
      try {
        await client.query(insertQuery, [
          attacker.lon,
          attacker.lat,
          attacker.source_ip,
          attacker.dstip,
          attacker.agent_name,
          attacker.time
        ]);
        successCount++;
      } catch (insertError) {
        console.error(`❌ Error inserting attacker ${attacker.source_ip}:`, insertError.message);
        errorCount++;
      }
    }

    console.log(`✅ Successfully inserted ${successCount} attacker records`);
    if (errorCount > 0) {
      console.log(`⚠️  ${errorCount} records failed to insert`);
    }

    // Verifikasi data
    const countResult = await client.query('SELECT COUNT(*) as total FROM attacker');
    console.log(`📊 Total attacker records in database: ${countResult.rows[0].total}`);

    // Analisis data
    console.log('\n📈 Data Analysis:');

    // Top source IPs
    const topSourceIPs = await client.query(`
      SELECT source_ip, COUNT(*) as count
      FROM attacker
      GROUP BY source_ip
      ORDER BY count DESC
      LIMIT 5
    `);
    console.log('Top attacker source IPs:');
    topSourceIPs.rows.forEach(row => {
      console.log(`  ${row.source_ip}: ${row.count} attacks`);
    });

    // Top targeted agents
    const topAgents = await client.query(`
      SELECT agent_name, COUNT(*) as count
      FROM attacker
      GROUP BY agent_name
      ORDER BY count DESC
      LIMIT 5
    `);
    console.log('\nMost targeted agents:');
    topAgents.rows.forEach(row => {
      console.log(`  ${row.agent_name}: ${row.count} attacks`);
    });

    // Geographic distribution
    const geoStats = await client.query(`
      SELECT
        ROUND(lon::numeric, 2) as lon_rounded,
        ROUND(lat::numeric, 2) as lat_rounded,
        COUNT(*) as count
      FROM attacker
      GROUP BY ROUND(lon::numeric, 2), ROUND(lat::numeric, 2)
      ORDER BY count DESC
      LIMIT 5
    `);
    console.log('\nGeographic hotspots:');
    geoStats.rows.forEach(row => {
      console.log(`  [${row.lon_rounded}, ${row.lat_rounded}]: ${row.count} attacks`);
    });

    // Recent attacks
    const recentAttacks = await client.query(`
      SELECT source_ip, agent_name, lon, lat, time
      FROM attacker
      ORDER BY time DESC
      LIMIT 3
    `);
    console.log('\nRecent attacks:');
    recentAttacks.rows.forEach(row => {
      console.log(`  ${row.time.toISOString()} - ${row.source_ip} → ${row.agent_name} [${row.lon}, ${row.lat}]`);
    });

    console.log('\n🎉 Attacker data filtering and insertion completed successfully!');

  } catch (error) {
    console.error('❌ Process failed:', error.message);
  } finally {
    await client.end();
  }
}

// Export function untuk digunakan di file lain
module.exports = {
  filterAndInsertAttackerData,
  createAttackerTable
};

// Jalankan jika file dijalankan langsung
if (require.main === module) {
  filterAndInsertAttackerData()
    .then(() => {
      console.log('\n✅ Process completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Process failed:', error);
      process.exit(1);
    });
}
