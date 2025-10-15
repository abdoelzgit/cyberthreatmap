const { Client } = require('pg');
const fs = require('fs').promises;
const https = require('https');
const { exec } = require('child_process');

// Konfigurasi PostgreSQL
const pgConfig = {
  host: 'localhost',
  port: 5432,
  database: 'Databases',
  user: 'postgres',
  password: '123'
};

// Cache untuk geolocation (mengurangi API calls)
const geoCache = new Map();

// Fungsi untuk cek apakah IP adalah private IP
function isPrivateIP(ip) {
  const parts = ip.split('.').map(Number);
  return (
    (parts[0] === 10) ||  // 10.0.0.0/8
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||  // 172.16.0.0/12
    (parts[0] === 192 && parts[1] === 168)  // 192.168.0.0/16
  );
}

// Fungsi untuk mendapatkan lokasi IP private berdasarkan subnet
function getPrivateIPLocation(ip) {
  // Mapping berdasarkan subnet yang diketahui dari data Anda
  if (ip.startsWith('10.90.24.')) {
    return {
      ip: ip,
      country: 'Indonesia',
      city: 'Jakarta',
      lat: -6.2088,
      lng: 106.8456,
      isp: 'Internal Network'
    };
  }

  if (ip.startsWith('10.90.66.')) {
    return {
      ip: ip,
      country: 'Indonesia',
      city: 'Surabaya',
      lat: -7.2575,
      lng: 112.7521,
      isp: 'Internal Network'
    };
  }

  // Default untuk IP private lainnya di Indonesia
  return {
    ip: ip,
    country: 'Indonesia',
    city: 'Jakarta',
    lat: -6.2088,
    lng: 106.8456,
    isp: 'Internal Network'
  };
}

// Fungsi untuk mendapatkan geolocation IP public menggunakan curl
async function getPublicIPLocation(ip) {
  return new Promise((resolve, reject) => {
    // Menggunakan curl untuk mendapatkan geolocation dari ipapi.co
    const curlCommand = `curl -s --max-time 15 "https://ipapi.co/${ip}/json/"`;

    exec(curlCommand, (error, stdout, stderr) => {
      if (error) {
        console.warn(`❌ Failed to get geolocation for ${ip}:`, error.message);
        const fallbackLocation = {
          ip: ip,
          country: 'Unknown',
          city: 'Unknown',
          lat: 0,
          lng: 0,
          isp: 'Unknown'
        };
        resolve(fallbackLocation);
        return;
      }

      try {
        const response = JSON.parse(stdout);

        if (response && !response.error) {
          const location = {
            ip: ip,
            country: response.country_name || 'Unknown',
            city: response.city || 'Unknown',
            lat: parseFloat(response.latitude) || 0,
            lng: parseFloat(response.longitude) || 0,
            isp: response.org || 'Unknown'
          };

          console.log(`🌍 ${ip} → ${location.city}, ${location.country} [${location.lat}, ${location.lng}]`);
          resolve(location);
        } else {
          // Fallback untuk IP yang gagal
          const fallbackLocation = {
            ip: ip,
            country: 'Unknown',
            city: 'Unknown',
            lat: 0,
            lng: 0,
            isp: 'Unknown'
          };
          console.log(`⚠️ ${ip} → Unknown location (API error)`);
          resolve(fallbackLocation);
        }
      } catch (parseError) {
        console.warn(`❌ Failed to parse response for ${ip}:`, parseError.message);
        const fallbackLocation = {
          ip: ip,
          country: 'Unknown',
          city: 'Unknown',
          lat: 0,
          lng: 0,
          isp: 'Unknown'
        };
        resolve(fallbackLocation);
      }
    });
  });
}

// Fungsi utama untuk mendapatkan geolocation
async function getGeolocation(ip) {
  if (geoCache.has(ip)) {
    return geoCache.get(ip);
  }

  let location;

  if (isPrivateIP(ip)) {
    // Untuk IP private, gunakan mapping statis
    location = getPrivateIPLocation(ip);
    console.log(`🏢 ${ip} → ${location.city}, ${location.country} (Private IP)`);
  } else {
    // Untuk IP public, gunakan API
    location = await getPublicIPLocation(ip);
  }

  geoCache.set(ip, location);
  return location;
}

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
      agent_ip VARCHAR(45),
      agent_lat DECIMAL(10, 6),
      agent_lng DECIMAL(10, 6),
      time TIMESTAMP,
      level INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;

  const createIndexesQuery = `
    CREATE INDEX IF NOT EXISTS idx_source_ip ON attacker(source_ip);
    CREATE INDEX IF NOT EXISTS idx_agent_name ON attacker(agent_name);
    CREATE INDEX IF NOT EXISTS idx_agent_ip ON attacker(agent_ip);
    CREATE INDEX IF NOT EXISTS idx_time ON attacker(time);
    CREATE INDEX IF NOT EXISTS idx_lon_lat ON attacker(lon, lat);
    CREATE INDEX IF NOT EXISTS idx_agent_lon_lat ON attacker(agent_lat, agent_lng);
  `;

  await client.query(createTableQuery);

  // Add new columns if they don't exist
  try {
    await client.query(`
      ALTER TABLE attacker ADD COLUMN IF NOT EXISTS agent_lat DECIMAL(10, 6)
    `);
    console.log('✅ agent_lat column added/verified');
  } catch (alterError) {
    console.log('⚠️  Note: agent_lat column may already exist or table structure issue');
  }

  try {
    await client.query(`
      ALTER TABLE attacker ADD COLUMN IF NOT EXISTS agent_lng DECIMAL(10, 6)
    `);
    console.log('✅ agent_lng column added/verified');
  } catch (alterError) {
    console.log('⚠️  Note: agent_lng column may already exist or table structure issue');
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
        source['@timestamp'] &&
        source.rule &&
        source.rule.level !== undefined
      ) {
        attackers.push({
          lon: parseFloat(source.GeoLocation.location.lon),
          lat: parseFloat(source.GeoLocation.location.lat),
          source_ip: source.data.srcip,
          dstip: source.data.dstip || null,
          agent_name: source.agent.name,
          agent_ip: source.agent.ip || null,
          time: new Date(source['@timestamp']),
          level: parseInt(source.rule.level)
        });
      }
    }

    // Get unique agent IPs for geolocation
    console.log('🌍 Getting unique agent IPs for geolocation...');
    const uniqueAgentIPs = [...new Set(attackers.map(a => a.agent_ip).filter(ip => ip !== null))];
    console.log(`📍 Found ${uniqueAgentIPs.length} unique agent IPs to geolocate`);

    // Get geolocation for each unique agent IP
    const agentGeoMap = new Map();
    for (const ip of uniqueAgentIPs) {
      try {
        console.log(`🔄 Geolocating agent IP: ${ip}`);
        const geo = await getGeolocation(ip);
        agentGeoMap.set(ip, geo);

        // Delay to respect API rate limits
        if (uniqueAgentIPs.indexOf(ip) < uniqueAgentIPs.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (geoError) {
        console.warn(`⚠️ Failed to geolocate ${ip}:`, geoError.message);
        agentGeoMap.set(ip, {
          lat: 0,
          lng: 0,
          country: 'Unknown',
          city: 'Unknown'
        });
      }
    }

    // Add geolocation data to attackers
    console.log('📍 Adding geolocation data to attacker records...');
    const attackersWithGeo = attackers.map(attacker => {
      const agentGeo = attacker.agent_ip ? agentGeoMap.get(attacker.agent_ip) : null;
      return {
        ...attacker,
        agent_lat: agentGeo ? agentGeo.lat : null,
        agent_lng: agentGeo ? agentGeo.lng : null,
        agent_country: agentGeo ? agentGeo.country : null,
        agent_city: agentGeo ? agentGeo.city : null
      };
    });

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
    try {
      await client.query('TRUNCATE TABLE attacker');
      console.log('✅ Existing data cleared with TRUNCATE');
    } catch (truncateError) {
      console.log('⚠️  TRUNCATE failed, trying DELETE instead:', truncateError.message);
      try {
        await client.query('DELETE FROM attacker');
        console.log('✅ Existing data cleared with DELETE');
      } catch (deleteError) {
        console.error('❌ Failed to clear data:', deleteError.message);
        throw deleteError;
      }
    }

    // Add level column if it doesn't exist
    try {
      await client.query(`
        ALTER TABLE attacker ADD COLUMN IF NOT EXISTS level INTEGER
      `);
      console.log('✅ level column added/verified');
    } catch (alterError) {
      console.log('⚠️  Note: level column may already exist or table structure issue');
    }

    // Add agent_ip column if it doesn't exist
    try {
      await client.query(`
        ALTER TABLE attacker ADD COLUMN IF NOT EXISTS agent_ip VARCHAR(45)
      `);
      console.log('✅ agent_ip column added/verified');
    } catch (alterError) {
      console.log('⚠️  Note: agent_ip column may already exist or table structure issue');
    }

    // Bulk insert attackers
    console.log('💾 Inserting attacker data into database...');
    const insertQuery = `
      INSERT INTO attacker (lon, lat, source_ip, dstip, agent_name, agent_ip, agent_lat, agent_lng, time, level)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `;

    let successCount = 0;
    let errorCount = 0;

    for (const attacker of attackersWithGeo) {
      try {
        await client.query(insertQuery, [
          attacker.lon,  // Attacker longitude from Geolocation
          attacker.lat,  // Attacker latitude from Geolocation
          attacker.source_ip,
          attacker.dstip,
          attacker.agent_name,
          attacker.agent_ip,
          attacker.agent_lat,  // Target latitude from agent IP geolocation
          attacker.agent_lng,  // Target longitude from agent IP geolocation
          attacker.time,
          attacker.level
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

    // Agent geolocation analysis
    console.log('\n🌍 Agent Geolocation Analysis:');
    const agentGeoStats = await client.query(`
      SELECT agent_lat, agent_lng, COUNT(*) as attack_count
      FROM attacker
      WHERE agent_lat IS NOT NULL AND agent_lng IS NOT NULL
      GROUP BY agent_lat, agent_lng
      ORDER BY attack_count DESC
      LIMIT 5
    `);
    console.log('Top agent locations by attack count:');
    agentGeoStats.rows.forEach(row => {
      console.log(`  [${row.agent_lat}, ${row.agent_lng}]: ${row.attack_count} attacks`);
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
