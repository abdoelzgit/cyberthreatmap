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

// Fungsi untuk mengintegrasikan data serangan dengan database
async function integrateAttacksWithDB() {
  const client = new Client(pgConfig);

  try {
    console.log('🚀 Starting integration of attack data with database...');
    await client.connect();
    console.log('✅ Connected to database');

    // 1. Baca data.json
    console.log('📖 Reading attack data from data.json...');
    const rawData = await fs.readFile('../data.json', 'utf8');
    const jsonData = JSON.parse(rawData);

    if (!jsonData.hits || !jsonData.hits.hits) {
      throw new Error('Invalid data structure in data.json');
    }

    // 2. Filter dan ekstrak alerts
    console.log('🔍 Filtering and extracting alerts...');
    const alerts = jsonData.hits.hits.map(hit => ({
      srcip: hit._source.data.srcip,
      dstip: hit._source.data.dstip,
      level: hit._source.data.level,
      time: hit._source.data.time
    }));

    console.log(`📊 Found ${alerts.length} alerts to process`);

    // 3. Clear existing data (optional)
    console.log('🗑️  Clearing existing data...');
    await client.query('TRUNCATE TABLE filtered_alerts');
    console.log('✅ Existing data cleared');

    // 4. Bulk insert alerts
    console.log('💾 Inserting alerts into database...');
    const insertQuery = `
      INSERT INTO filtered_alerts (srcip, dstip, level, time)
      VALUES ($1, $2, $3, $4)
    `;

    let successCount = 0;
    let errorCount = 0;

    for (const alert of alerts) {
      try {
        await client.query(insertQuery, [
          alert.srcip,
          alert.dstip,
          alert.level,
          alert.time
        ]);
        successCount++;
      } catch (insertError) {
        console.error(`❌ Error inserting alert ${alert.srcip}:`, insertError.message);
        errorCount++;
      }
    }

    console.log(`✅ Successfully inserted ${successCount} alerts`);
    if (errorCount > 0) {
      console.log(`⚠️  ${errorCount} alerts failed to insert`);
    }

    // 5. Verifikasi data
    const countResult = await client.query('SELECT COUNT(*) as total FROM filtered_alerts');
    console.log(`📊 Total alerts in database: ${countResult.rows[0].total}`);

    // 6. Analisis data
    console.log('\n📈 Data Analysis:');

    // Group by level
    const levelStats = await client.query(`
      SELECT level, COUNT(*) as count
      FROM filtered_alerts
      GROUP BY level
      ORDER BY count DESC
    `);
    console.log('Alert levels:');
    levelStats.rows.forEach(row => {
      console.log(`  ${row.level}: ${row.count}`);
    });

    // Top source IPs
    const topSrcIPs = await client.query(`
      SELECT srcip, COUNT(*) as count
      FROM filtered_alerts
      GROUP BY srcip
      ORDER BY count DESC
      LIMIT 5
    `);
    console.log('\nTop source IPs:');
    topSrcIPs.rows.forEach(row => {
      console.log(`  ${row.srcip}: ${row.count} alerts`);
    });

    // Recent alerts
    const recentAlerts = await client.query(`
      SELECT srcip, dstip, level, time, created_at
      FROM filtered_alerts
      ORDER BY created_at DESC
      LIMIT 3
    `);
    console.log('\nRecent alerts:');
    recentAlerts.rows.forEach(row => {
      console.log(`  ${row.time} - ${row.srcip} → ${row.dstip} (${row.level})`);
    });

    console.log('\n🎉 Integration completed successfully!');

  } catch (error) {
    console.error('❌ Integration failed:', error.message);
  } finally {
    await client.end();
  }
}

// Fungsi untuk mendapatkan attack locations dari database
async function getAttackLocations() {
  const client = new Client(pgConfig);

  try {
    console.log('📍 Fetching attack locations from database...');
    await client.connect();

    // Query untuk mendapatkan unique source IPs dengan koordinat
    const result = await client.query(`
      SELECT DISTINCT srcip, COUNT(*) as alert_count
      FROM filtered_alerts
      GROUP BY srcip
      ORDER BY alert_count DESC
      LIMIT 10
    `);

    console.log('Top attack sources:');
    result.rows.forEach(row => {
      console.log(`  ${row.srcip}: ${row.alert_count} alerts`);
    });

    return result.rows;

  } catch (error) {
    console.error('❌ Failed to fetch attack locations:', error.message);
    return [];
  } finally {
    await client.end();
  }
}

// Export functions untuk digunakan di socket-server.js
module.exports = {
  integrateAttacksWithDB,
  getAttackLocations
};

// Jalankan integrasi jika file dijalankan langsung
if (require.main === module) {
  integrateAttacksWithDB()
    .then(() => {
      console.log('\n🔄 Fetching attack locations for simulation...');
      return getAttackLocations();
    })
    .then((locations) => {
      console.log('📍 Attack locations ready for simulation');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Process failed:', error);
      process.exit(1);
    });
}
