const stringSimilarity = require('string-similarity');

const name1 = 'AMOO GRACE OLUWAFIKUNAYOMI';
const name2 = 'AMOO GRACE OLUWAFIKUNAYONI'; // typo: N instead of M

const similarity = stringSimilarity.compareTwoStrings(name1, name2);

console.log(`Comparing:\n  "${name1}"\n  "${name2}"`);
console.log('Similarity score:', similarity);
console.log('As percentage:', (similarity * 100).toFixed(1) + '%');