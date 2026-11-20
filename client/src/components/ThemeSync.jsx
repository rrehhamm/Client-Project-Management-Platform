// D-45: once signed in, the user's own appearance (System / Light / Dark, stored on the
// server) and the workspace brand colour (contrast-protected) apply to the whole app.
import { useEffect } from 'react';
import { applyAppearance, storedAppearance } from '@/lib/appearance';
import { applyBrand } from '@/lib/brand';

export function useThemeSync(me) {
  const appearance = me?.principal?.appearance ?? storedAppearance();
  const brand = me?.workspace?.brand_color ?? null;
  useEffect(() => {
    applyAppearance(appearance);
  }, [appearance]);
  useEffect(() => {
    applyBrand(brand);
  }, [brand]);
}
