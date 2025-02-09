const sharp = require('sharp');
const fs = require('fs').promises;
const path = require('path');

async function generateFavicons() {
    const sizes = {
        'favicon-16x16.png': 16,
        'favicon-32x32.png': 32,
        'apple-touch-icon.png': 180,
        'android-chrome-192x192.png': 192,
        'android-chrome-512x512.png': 512
    };

    // Read the SVG file
    const svgBuffer = await fs.readFile('public/favicon.svg');

    // Generate PNGs for each size
    for (const [filename, size] of Object.entries(sizes)) {
        await sharp(svgBuffer)
            .resize(size, size)
            .png()
            .toFile(path.join('public', filename));
        
        console.log(`Generated ${filename}`);
    }

    // Generate ICO file (16x16 and 32x32 combined)
    const ico16 = await sharp(svgBuffer)
        .resize(16, 16)
        .png()
        .toBuffer();
    
    const ico32 = await sharp(svgBuffer)
        .resize(32, 32)
        .png()
        .toBuffer();

    await fs.writeFile(path.join('public', 'favicon.ico'), Buffer.concat([ico16, ico32]));
    console.log('Generated favicon.ico');
}

generateFavicons().catch(console.error); 