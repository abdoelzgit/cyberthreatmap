const path = require("path");
const fs = require("fs").promises;


async function extractData(){
    try{
        const filePath = path.join(__dirname, 'data.json');
        const data = await fs.readFile(filePath, 'utf-8');
        const jsonData = JSON.parse(data);

        if (!jsonData.hits || !jsonData.hits.hits) { 
            throw new Error("Invalid JSON structure: 'hits.hits' not found");
        }

        const extractedData = jsonData.hits.hits.map(hit => {
            const source = hit._source.data;

            return {
                srcip: source.srcip,
                dstip: source.dstip,
                level: source.level,
                time: source.time,

            }
        });

        const outputPath = path.join(__dirname, 'extracted_alerts.json');
        await fs.writeFile(outputPath, JSON.stringify(extractedData, null, 2));
        console.log(`Extracted data saved to ${outputPath}`);


     } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

extractData();