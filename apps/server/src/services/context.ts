import type { TenantScope } from '../db/repository.js';

/** Who is acting and in which tenant. Passed to every service function. */
export interface ServiceContext {
  scope: TenantScope;
  userId: string | null;
}
