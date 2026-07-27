// Re-export client
export { supabase } from './supabase/client';

// Re-export all services
export { boardsService, boardStagesService } from './supabase/boards';
export { contactsService, companiesService } from './supabase/contacts';
export { dealsService } from './supabase/deals';
export { activitiesService } from './supabase/activities';
export { productsService } from './supabase/products';
export { customFieldsService, deriveFieldKey } from './supabase/customFields';
export { settingsService, lifecycleStagesService } from './supabase/settings';

// Re-export Realtime hooks
export { useRealtimeSync, useRealtimeSyncAll, useRealtimeSyncKanban } from './realtime';
