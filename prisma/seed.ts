import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';

const prisma = new PrismaClient();

async function main() {
  const testApiKey = 'ntfy_sk_dev_test123456789012345678901234567890';
  const apiKeyHash = createHash('sha256').update(testApiKey).digest('hex');

  await prisma.customer.upsert({
    where: { email: 'dev@notifyhub.local' },
    update: {},
    create: {
      email: 'dev@notifyhub.local',
      apiKey: testApiKey,
      apiKeyHash: apiKeyHash,
      plan: 'indie',
      monthlyLimit: 10000,
    },
  });

  console.log('Test customer created');
  console.log('API Key:', testApiKey);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
