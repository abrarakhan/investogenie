import pg from 'pg';
import { encryptCredential } from './lib/crypto/credentials.ts';

const client = new pg.Client({
  connectionString: 'postgresql://localhost:5432/investogenie'
});

await client.connect();

try {
  // 1. Get or create user
  const userRes = await client.query(
    `INSERT INTO public.users (email, password_hash, created_at)
     VALUES ($1, 'test-hash-testing', now())
     ON CONFLICT (email) DO NOTHING
     RETURNING id, email`,
    ['abrar.akhan@gmail.com']
  );
  
  const user = userRes.rows[0] || (await client.query(
    `SELECT id, email FROM public.users WHERE email = $1`,
    ['abrar.akhan@gmail.com']
  )).rows[0];
  
  console.log('✅ User ready:', user.email, '(ID:', user.id, ')');
  
  // 2. Enable email preferences
  await client.query(
    `INSERT INTO public.email_preferences 
     (user_id, email, enabled, send_time, include_swing_candidates, include_probability)
     VALUES ($1, $2, true, '07:00', true, true)
     ON CONFLICT (user_id) DO UPDATE 
     SET enabled = true, send_time = '07:00', include_swing_candidates = true, 
         include_probability = true, updated_at = now()`,
    [user.id, user.email]
  );
  console.log('✅ Email digest enabled');
  
  // 3. Encrypt and store SMTP credentials
  const smtpPassword = 'test-app-password-123';
  const encryptedPassword = encryptCredential(smtpPassword);
  
  await client.query(
    `INSERT INTO public.user_credentials 
     (user_id, smtp_host, smtp_port, smtp_user, smtp_password_encrypted)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id) DO UPDATE 
     SET smtp_host = $2, smtp_port = $3, smtp_user = $4, 
         smtp_password_encrypted = $5, updated_at = now()`,
    [
      user.id,
      'smtp.gmail.com',
      587,
      'abrar.akhan@gmail.com',
      encryptedPassword
    ]
  );
  console.log('✅ SMTP credentials stored (encrypted)');
  
  // 4. Verify setup
  const prefs = await client.query(
    `SELECT enabled, send_time FROM public.email_preferences WHERE user_id = $1`,
    [user.id]
  );
  console.log('✅ Email preferences:', prefs.rows[0]);
  
  const creds = await client.query(
    `SELECT smtp_host, smtp_port, smtp_user FROM public.user_credentials WHERE user_id = $1`,
    [user.id]
  );
  console.log('✅ SMTP config stored:', creds.rows[0]);
  console.log('\n🎯 All setup complete! Ready to send test email.');
  
} catch (err) {
  console.error('❌ Error:', err.message);
  process.exit(1);
} finally {
  await client.end();
}
