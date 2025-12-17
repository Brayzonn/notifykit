import { SetMetadata } from '@nestjs/common';

export const CacheResult = (ttl: number) => SetMetadata('cache-ttl', ttl);
