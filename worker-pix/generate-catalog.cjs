const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/produto-data.js'), 'utf8'), context);
const prices = {};
function add(name, value) {
  if (Object.hasOwn(prices, name)) throw Error('Nome duplicado no catálogo: ' + name);
  const cents = Math.round(value * 100);
  if (!Number.isSafeInteger(cents) || cents <= 0) throw Error('Preço inválido: ' + name);
  prices[name] = cents;
}
for (const product of Object.values(context.window.PRODUCT_CATALOG)) add(product.name, product.price);
for (const item of Object.values(context.window.PRODUCT_TEMPLATE.addons)) {
  if (item.variants.length) for (const variant of item.variants) add(item.name + ' ' + variant, item.price);
  else add(item.name, item.price);
}
add('Mini Pudim', 5);
const workerPath = path.join(__dirname, 'worker.mjs');
const worker = fs.readFileSync(workerPath, 'utf8');
const pattern = /\/\/ BEGIN GENERATED PRICES[^\n]*\r?\n[\s\S]*?\/\/ END GENERATED PRICES/;
if (!pattern.test(worker)) throw Error('Bloco de preços do Worker não encontrado.');
const block = '// BEGIN GENERATED PRICES - updated from js/produto-data.js by generate-catalog.cjs\nexport const PRICES = Object.freeze(' + JSON.stringify(prices, null, 2) + ');\n// END GENERATED PRICES';
fs.writeFileSync(workerPath, worker.replace(pattern, () => block));
