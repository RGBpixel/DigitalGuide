import type { StudioDocument,DeliverySettings } from '@digitalguide/contracts';
export function deliveryDimensions(doc: StudioDocument,settings: DeliverySettings) {
  const long = settings.preset === 'uhd' ? 3840 : 1920,short = settings.preset === 'uhd' ? 2160 : 1080;
  return doc.canvas.width >= doc.canvas.height ? { width: long,height: short } : { width: short,height: long };
}
