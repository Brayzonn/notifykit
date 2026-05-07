import { PrismaClient, CustomerPlan, EmailProviderType, AuthProvider, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

// ─── Credentials (shown once here, use these to log in) ──────────────────────
const SEED_EMAIL = 'admin@notifykit.dev';
const SEED_PASSWORD = 'Seed1234!';
const SEED_PLAN = CustomerPlan.INDIE;
// ─────────────────────────────────────────────────────────────────────────────

// Replicates EncryptionService.encrypt using the local ENCRYPTION_KEY env var
function encrypt(text: string): string {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length !== 64) throw new Error('ENCRYPTION_KEY must be a 64-char hex string');
  const keyBuf = Buffer.from(key, 'hex');
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', keyBuf, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function generateApiKey(): string {
  return `nh_${crypto.randomBytes(32).toString('hex')}`;
}

async function main() {
  console.log('Seeding database...');

  // ── User ──────────────────────────────────────────────────────────────────
  const hashedPassword = await argon2.hash(SEED_PASSWORD);

  const user = await prisma.user.upsert({
    where: { email: SEED_EMAIL },
    update: {},
    create: {
      email: SEED_EMAIL,
      password: hashedPassword,
      name: 'Seed Admin',
      role: UserRole.USER,
      emailVerified: true,
      provider: AuthProvider.EMAIL,
    },
  });

  console.log(`User created: ${user.email}`);

  // ── Customer ──────────────────────────────────────────────────────────────
  const monthlyLimit = SEED_PLAN === CustomerPlan.INDIE ? 4000 : SEED_PLAN === CustomerPlan.STARTUP ? 15000 : 100;

  const customer = await prisma.customer.upsert({
    where: { userId: user.id },
    update: {},
    create: {
      userId: user.id,
      email: user.email,
      plan: SEED_PLAN,
      monthlyLimit,
      usageCount: 0,
      usageResetAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      isActive: true,
    },
  });

  console.log(`Customer created: plan=${customer.plan}`);

  // ── API Key ───────────────────────────────────────────────────────────────
  const apiKey = generateApiKey();
  const apiKeyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
  const apiKeyLastFour = apiKey.slice(-4);

  await prisma.customer.update({
    where: { id: customer.id },
    data: {
      apiKey,
      apiKeyHash,
      apiKeyLastFour,
    },
  });

  console.log(`API key generated: ${apiKey}`);

  // ── Email Provider (SendGrid) ─────────────────────────────────────────────
  const dummySendgridKey = 'SG.seed_dummy_key_not_real';

  await prisma.customerEmailProvider.upsert({
    where: { customerId_provider: { customerId: customer.id, provider: EmailProviderType.SENDGRID } },
    update: {},
    create: {
      customerId: customer.id,
      provider: EmailProviderType.SENDGRID,
      apiKey: encrypt(dummySendgridKey),
      priority: 1,
    },
  });

  console.log('SendGrid provider configured (dummy key)');

  // ── Sending Domain ────────────────────────────────────────────────────────
  await prisma.customerSendingDomain.upsert({
    where: { customerId_domain_provider: { customerId: customer.id, domain: 'notifykit.dev', provider: EmailProviderType.SENDGRID } },
    update: {},
    create: {
      customerId: customer.id,
      domain: 'notifykit.dev',
      provider: EmailProviderType.SENDGRID,
      verified: true,
      requestedAt: new Date(),
      verifiedAt: new Date(),
    },
  });

  console.log('Sending domain configured: notifykit.dev (verified)');

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n─────────────────────────────────');
  console.log('Seed complete. Login credentials:');
  console.log(`  Email:    ${SEED_EMAIL}`);
  console.log(`  Password: ${SEED_PASSWORD}`);
  console.log(`  API key:  ${apiKey}`);
  console.log('─────────────────────────────────\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
