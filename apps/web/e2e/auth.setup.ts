import { test as setup } from '@playwright/test';
import { ADMIN_STATE, signIn } from './helpers';

setup('sign in as kali', async ({ page }) => {
  await signIn(page);
  await page.context().storageState({ path: ADMIN_STATE });
});
