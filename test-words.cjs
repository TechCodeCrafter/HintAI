const fs = require('fs');
const content = fs.readFileSync('src/sample_x_profiles.csv', 'utf8');
console.log('File content loaded, length:', content.length);

// Test toWords function (copied from retrieve.ts)
function toWords(source) {
  const lowered = source.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  const split = lowered.split(/[^a-z0-9]+/).filter(Boolean);
  const out = [...split];
  for (const match of lowered.match(/[a-z0-9]+(?:_[a-z0-9]+)+/g) ?? []) {
    if (match.length > 2) out.push(match);
  }
  return out;
}

// Test with a line from the CSV
const lines = content.split('\n');
const line = lines[1]; // Second line (first data row)
console.log('\nLine 1:', line);
console.log('toWords:', toWords(line));

// Test with interests field extracted
const interestsMatch = line.match(/"([^"]+)"/);
if (interestsMatch) {
  console.log('\nQuoted interests:', interestsMatch[1]);
  console.log('toWords of quoted:', toWords(interestsMatch[1]));
}

// Test each data row
console.log('\n--- All rows ---');
for (let i = 1; i < lines.length; i++) {
  console.log(`\nRow ${i}:`, lines[i].substring(0, 50) + '...');
  console.log('  toWords:', toWords(lines[i]).slice(0, 10));
}