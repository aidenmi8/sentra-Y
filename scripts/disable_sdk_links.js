const fs = require('fs');
let c = fs.readFileSync('src/components/SentraMap.tsx', 'utf8');

c = c.replace(/setGeo\('sdk-links', links\);/g, "// setGeo('sdk-links', links);");

fs.writeFileSync('src/components/SentraMap.tsx', c);
console.log('Disabled sdk-links rendering in SentraMap.tsx');
