const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Ler o .env para pegar a porta
const envPath = path.join(__dirname, '..', '.env');
let port = 3001; // porta padrão

if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  const match = envContent.match(/PORT=(\d+)/);
  if (match) {
    port = match[1];
  }
}

console.log(`🔍 Verificando porta ${port}...`);

try {
  // Windows
  if (process.platform === 'win32') {
    // Buscar processos na porta
    const result = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf-8' }).trim();
    
    if (result) {
      const lines = result.split('\n');
      const pids = new Set();
      
      lines.forEach(line => {
        const match = line.match(/LISTENING\s+(\d+)/);
        if (match) {
          pids.add(match[1]);
        }
      });
      
      if (pids.size > 0) {
        console.log(`⚠️  Porta ${port} em uso pelos processos: ${[...pids].join(', ')}`);
        
        pids.forEach(pid => {
          try {
            execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
            console.log(`✅ Processo ${pid} finalizado`);
          } catch (error) {
            console.log(`⚠️  Não foi possível finalizar processo ${pid} (pode precisar de permissão de admin)`);
          }
        });
      }
    } else {
      console.log(`✅ Porta ${port} está livre`);
    }
  } else {
    // Linux/Mac
    const result = execSync(`lsof -ti:${port}`, { encoding: 'utf-8' }).trim();
    
    if (result) {
      const pids = result.split('\n');
      console.log(`⚠️  Porta ${port} em uso pelos processos: ${pids.join(', ')}`);
      
      pids.forEach(pid => {
        try {
          execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
          console.log(`✅ Processo ${pid} finalizado`);
        } catch (error) {
          console.log(`⚠️  Não foi possível finalizar processo ${pid}`);
        }
      });
    } else {
      console.log(`✅ Porta ${port} está livre`);
    }
  }
} catch (error) {
  // Se não houver processos, o comando falha - isso é ok
  console.log(`✅ Porta ${port} está livre`);
}

console.log('');


