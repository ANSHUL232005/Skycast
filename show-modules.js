// Node Modules Overview for Weather App
console.log('🌤️  WEATHER APP - Node Modules Overview');
console.log('=' .repeat(50));
console.log('');

const fs = require('fs');
const path = require('path');

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const nodeModulesPath = path.join(__dirname, 'node_modules');

console.log('📦 Package.json Dependencies:');
Object.entries(packageJson.dependencies || {}).forEach(([name, version]) => {
    console.log(`   ${name}: ${version}`);
});

console.log('');
console.log('📂 Installed Node Modules:');
try {
    const modules = fs.readdirSync(nodeModulesPath)
        .filter(item => !item.startsWith('.') && item !== '.package-lock.json')
        .sort();

    modules.forEach(module => {
        try {
            const packagePath = path.join(nodeModulesPath, module, 'package.json');
            if (fs.existsSync(packagePath)) {
                const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
                console.log(`   📁 ${module} v${pkg.version}`);
            } else {
                console.log(`   📁 ${module}`);
            }
        } catch (e) {
            console.log(`   📁 ${module}`);
        }
    });

    console.log('');
    console.log(`Total modules: ${modules.length}`);
} catch (e) {
    console.log('   No node_modules found or error reading directory');
}

console.log('');
console.log('🚀 To run the app: npm start');
console.log('🌐 App will be available at: http://localhost:3007');