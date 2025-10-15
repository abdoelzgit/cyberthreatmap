const fs = require('fs').promises;
const { Client } = require('pg');

// Konfigurasi PostgreSQL
const pgConfig = {
  host: 'localhost',
  port: 5432,
  database: 'Databases',
  user: 'postgres',
  password: '123'
};

// Fungsi untuk memproses dan upload data
async function processAndUploadData() {
  const client = new Client(pgConfig);

  try {
    console.log('🚀 Starting data processing and upload...');

    // 1. Baca file data.json
    console.log('📖 Reading data.json...');
    const rawData = await fs.readFile('../data.json', 'utf8');
    const jsonData = JSON.parse(rawData);

    // 2. Validasi struktur data
    if (!jsonData.hits || !jsonData.hits.hits) {
      throw new Error('Invalid data structure in data.json');
    }

    // 3. Filter dan ekstrak field yang dibutuhkan
    console.log('🔍 Filtering and extracting data...');
    const filteredData = jsonData.hits.hits.map(hit => ({
      srcip: hit._source.data.srcip,
      dstip: hit._source.data.dstip,
      level: hit._source.data.level,
      time: hit._source.data.time
    }));

    console.log(`📊 Extracted ${filteredData.length} alerts`);

    // 4. Connect ke PostgreSQL
    console.log('🔌 Connecting to PostgreSQL...');
    await client.connect();
    console.log('✅ Connected to database');

    // 5. Create table jika belum ada
    console.log('📋 Creating table if not exists...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS filtered_alerts (
        id SERIAL PRIMARY KEY,
        srcip VARCHAR(45),
        dstip VARCHAR(45),
        level VARCHAR(20),
        time VARCHAR(20),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 6. Clear existing data to prevent duplicates
    console.log('🧹 Clearing existing data to prevent duplicates...');
    await client.query('TRUNCATE TABLE filtered_alerts');
    console.log('✅ Existing data cleared');

    // 7. Bulk insert menggunakan parameterized query
    console.log('💾 Uploading data to database...');
    const insertQuery = `
      INSERT INTO filtered_alerts (srcip, dstip, level, time)
      VALUES ($1, $2, $3, $4)
    `;

    let successCount = 0;
    let errorCount = 0;

    for (const alert of filteredData) {
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

    console.log(`✅ Successfully uploaded ${successCount} alerts`);
    if (errorCount > 0) {
      console.log(`⚠️  ${errorCount} alerts failed to upload`);
    }

    // 8. Verifikasi data
    const result = await client.query('SELECT COUNT(*) as total FROM filtered_alerts');
    console.log(`📈 Total records in database: ${result.rows[0].total}`);

    // 9. Tampilkan sample data
    const sampleResult = await client.query('SELECT * FROM filtered_alerts LIMIT 3');
    console.log('\n📊 Sample data from database:');
    console.table(sampleResult.rows);

  } catch (error) {
    console.error('❌ Error in processing:', error.message);
  } finally {
    // 10. Close connection
    await client.end();
    console.log('🔌 Database connection closed');
  }
}

// Jalankan fungsi
processAndUploadData()
  .then(() => {
    console.log('🎉 Process completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Process failed:', error);
    process.exit(1);
  });
