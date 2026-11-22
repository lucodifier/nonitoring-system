import * as bcrypt from 'bcryptjs';

async function generateAdminUser() {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    console.error('Defina ADMIN_PASSWORD no ambiente. Ex.: ADMIN_PASSWORD="uma-senha-forte" pnpm ts-node scripts/create-admin-user.ts');
    process.exit(1);
  }
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  console.log('=== Criar Usuário Administrador ===\n');
  console.log('Execute o seguinte SQL no seu banco de dados PostgreSQL:\n');
  console.log(`INSERT INTO users (username, password_hash, email, full_name, is_active) 
VALUES (
    'admin', 
    '${hashedPassword}', 
    'admin@example.com', 
    'Administrator', 
    true
)
ON CONFLICT (username) DO UPDATE SET
    password_hash = EXCLUDED.password_hash,
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    is_active = EXCLUDED.is_active;`);

  console.log('\n=== Credenciais ===');
  console.log('Username: admin');
  console.log('Password: (valor de ADMIN_PASSWORD)');
  console.log('\nNOTA: Altere a senha após o primeiro login!');
}

generateAdminUser().catch(console.error);



