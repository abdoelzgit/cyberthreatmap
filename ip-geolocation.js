const { Client } = require('pg');
const https = require('https');

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

// Fungsi untuk mendapatkan geolocation IP public menggunakan API
async function getPublicIPLocation(ip) {
  return new Promise((resolve, reject) => {
    // Menggunakan ipapi.co (gratis, tanpa API key)
    const url = `https://ipapi.co/${ip}/json/`;

    https.get(url, { timeout: 10000 }, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const response = JSON.parse(data);

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
    }).on('error', (error) => {
      console.warn(`❌ Failed to get geolocation for ${ip}:`, error.message);

      // Fallback location
      const fallbackLocation = {
        ip: ip,
        country: 'Unknown',
        city: 'Unknown',
        lat: 0,
        lng: 0,
        isp: 'Unknown'
      };
      resolve(fallbackLocation);
    });
  });
}

// Fungsi utama untuk mendapatkan geolocation (private atau public)
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

// Fungsi untuk menambahkan kolom geolocation ke tabel
async function addGeolocationColumns() {
  const client = new Client(pgConfig);

  try {
    console.log('🔧 Adding geolocation columns to database...');
    await client.connect();

    // Tambahkan kolom geolocation jika belum ada
    await client.query(`
      ALTER TABLE filtered_alerts
      ADD COLUMN IF NOT EXISTS src_country VARCHAR(100),
      ADD COLUMN IF NOT EXISTS src_city VARCHAR(100),
      ADD COLUMN IF NOT EXISTS src_lat DECIMAL(10,6),
      ADD COLUMN IF NOT EXISTS src_lng DECIMAL(10,6),
      ADD COLUMN IF NOT EXISTS dst_country VARCHAR(100),
      ADD COLUMN IF NOT EXISTS dst_city VARCHAR(100),
      ADD COLUMN IF NOT EXISTS dst_lat DECIMAL(10,6),
      ADD COLUMN IF NOT EXISTS dst_lng DECIMAL(10,6)
    `);

    console.log('✅ Geolocation columns added successfully');
  } catch (error) {
    console.error('❌ Failed to add geolocation columns:', error.message);
  } finally {
    await client.end();
  }
}

// Fungsi untuk mengupdate geolocation data satu per satu
async function updateGeolocationsManually() {
  const client = new Client(pgConfig);

  try {
    console.log('🌍 Updating geolocation data manually...');
    await client.connect();

    // Ambil semua unique IPs yang belum memiliki geolocation
    const result = await client.query(`
      SELECT DISTINCT srcip, dstip
      FROM filtered_alerts
      WHERE src_lat IS NULL OR dst_lat IS NULL
    `);

    if (result.rows.length === 0) {
      console.log('✅ All alerts already have geolocation data');
      return;
    }

    console.log(`📍 Found ${result.rows.length} IP pairs to process:`);
    result.rows.forEach((row, i) => {
      console.log(`${i+1}. ${row.srcip} → ${row.dstip}`);
    });

    console.log('\n🚀 Starting geolocation conversion...\n');

    let processed = 0;
    for (const row of result.rows) {
      try {
        console.log(`\n🔄 Processing: ${row.srcip} → ${row.dstip}`);

        // Get geolocation untuk source IP
        const srcGeo = await getGeolocation(row.srcip);

        // Delay 2 detik sebelum destination IP
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Get geolocation untuk destination IP
        const dstGeo = await getGeolocation(row.dstip);

        // Update database
        await client.query(`
          UPDATE filtered_alerts
          SET
            src_country = $1,
            src_city = $2,
            src_lat = $3,
            src_lng = $4,
            dst_country = $5,
            dst_city = $6,
            dst_lat = $7,
            dst_lng = $8
          WHERE srcip = $9 AND dstip = $10
        `, [
          srcGeo.country, srcGeo.city, srcGeo.lat, srcGeo.lng,
          dstGeo.country, dstGeo.city, dstGeo.lat, dstGeo.lng,
          row.srcip, row.dstip
        ]);

        processed++;
        console.log(`✅ Updated pair ${processed}/${result.rows.length}`);

        // Delay 3 detik antar pair untuk menghindari rate limiting
        if (processed < result.rows.length) {
          console.log('⏳ Waiting 3 seconds before next pair...');
          await new Promise(resolve => setTimeout(resolve, 3000));
        }

      } catch (updateError) {
        console.error(`❌ Failed to update geolocation for ${row.srcip} → ${row.dstip}:`, updateError.message);
      }
    }

    console.log(`\n✅ Successfully updated geolocation for ${processed} alert pairs`);

  } catch (error) {
    console.error('❌ Failed to update geolocations:', error.message);
  } finally {
    await client.end();
  }
}

// Fungsi untuk mendapatkan attack locations dengan geolocation
async function getAttackLocationsWithGeo() {
  const client = new Client(pgConfig);

  try {
    console.log('📍 Fetching attack locations with geolocation...');
    await client.connect();

    const result = await client.query(`
      SELECT
        srcip,
        dstip,
        src_country,
        src_city,
        src_lat,
        src_lng,
        dst_country,
        dst_city,
        dst_lat,
        dst_lng,
        COUNT(*) as alert_count,
        level
      FROM filtered_alerts
      WHERE src_lat IS NOT NULL AND dst_lat IS NOT NULL
      GROUP BY srcip, dstip, src_country, src_city, src_lat, src_lng,
               dst_country, dst_city, dst_lat, dst_lng, level
      ORDER BY alert_count DESC
      LIMIT 20
    `);

    console.log(`📊 Found ${result.rows.length} attack routes with geolocation`);

    // Format untuk digunakan dalam simulasi
    const attackRoutes = result.rows.map(row => ({
      source: {
        ip: row.srcip,
        country: row.src_country,
        city: row.src_city,
        lat: row.src_lat,
        lng: row.src_lng
      },
      target: {
        ip: row.dstip,
        country: row.dst_country,
        city: row.dst_city,
        lat: row.dst_lat,
        lng: row.dst_lng
      },
      alertCount: row.alert_count,
      level: row.level
    }));

    return attackRoutes;

  } catch (error) {
    console.error('❌ Failed to fetch attack locations:', error.message);
    return [];
  } finally {
    await client.end();
  }
}

// Fungsi untuk menampilkan data geolocation yang sudah ada
async function showCurrentGeolocations() {
  const client = new Client(pgConfig);

  try {
    console.log('📊 Current geolocation data in database:');
    await client.connect();

    const result = await client.query(`
      SELECT srcip, dstip, src_country, src_city, src_lat, src_lng,
             dst_country, dst_city, dst_lat, dst_lng
      FROM filtered_alerts
      WHERE src_lat IS NOT NULL AND dst_lat IS NOT NULL
      LIMIT 10
    `);

    console.log('\n📍 Attack Routes:');
    result.rows.forEach((row, index) => {
      console.log(`${index + 1}. ${row.srcip} (${row.src_city}, ${row.src_country}) [${row.src_lat}, ${row.src_lng}]`);
      console.log(`   → ${row.dstip} (${row.dst_city}, ${row.dst_country}) [${row.dst_lat}, ${row.dst_lng}]\n`);
    });

  } catch (error) {
    console.error('❌ Failed to fetch geolocations:', error.message);
  } finally {
    await client.end();
  }
}

// Export functions
module.exports = {
  addGeolocationColumns,
  updateGeolocationsManually,
  getAttackLocationsWithGeo,
  getGeolocation,
  showCurrentGeolocations
};

// Jalankan jika file dijalankan langsung
if (require.main === module) {
  console.log('🚀 Starting manual geolocation integration...');

  addGeolocationColumns()
    .then(() => updateGeolocationsManually())
    .then(() => showCurrentGeolocations())
    .then(() => getAttackLocationsWithGeo())
    .then((routes) => {
      console.log('\n📍 Attack routes ready for simulation:');
      routes.forEach((route, index) => {
        console.log(`${index + 1}. ${route.source.city} (${route.source.country}) → ${route.target.city} (${route.target.country}) - ${route.alertCount} alerts`);
      });
      console.log('\n🎉 Manual geolocation integration completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Process failed:', error);
      process.exit(1);
    });
}
