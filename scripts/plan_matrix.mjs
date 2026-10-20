// Prints the GitHub Actions chunk matrix for the chosen formats.
const which = process.argv[2] || 'all';
const plans = {
  '1080p': { chunk: 40, total: 480 },   // 12 jobs
  '4k': { chunk: 20, total: 480 },      // 24 jobs
  shorts: { chunk: 29, total: 58 }      // 2 jobs
};
const include = [];
for (const [format, p] of Object.entries(plans)) {
  if (which !== 'all' && which !== format) continue;
  for (let s = 0, i = 0; s < p.total; s += p.chunk, i++) include.push({ format, idx: String(i).padStart(2, '0'), start: s, end: Math.min(p.total, s + p.chunk) });
}
const formats = [...new Set(include.map((x) => x.format))];
console.log(JSON.stringify({ include, formats }));
