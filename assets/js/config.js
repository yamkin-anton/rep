/* ==========================================================================
   Настройки подключения к Supabase.

   Эти два значения публичные — они и должны лежать в открытом коде сайта.
   Ключ publishable сам по себе не даёт прав ни на что: всё разграничение
   доступа живёт в политиках RLS на стороне базы (см. db/schema.sql).
   А вот ключ secret / service_role сюда вставлять нельзя никогда.
   ========================================================================== */

export const SUPABASE_URL = 'https://rykgtpgjohdekdiefnww.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_9FKR7F9FKwNCgYn89K7Jgg_oy3t2Vr4';

/* Имена хранилищ файлов — менять не нужно, они создаются скриптом db/schema.sql */
export const BUCKET_COVERS = 'covers';
export const BUCKET_MATERIALS = 'materials';

/* Контакты — используются в тексте «как получить доступ» */
export const CONTACT_TELEGRAM = 'https://t.me/it_school_73';
