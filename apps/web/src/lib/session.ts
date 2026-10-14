/**
 * Remembers that the last sign-out was caused by an expired session (an API call returned 401),
 * so the auth guard can show "Your session expired" on the sign-in page.
 */
let expired = false;

export const markSessionExpired = () => {
  expired = true;
};
export const clearSessionExpired = () => {
  expired = false;
};
export const isSessionExpired = () => expired;
