import { newId } from "./new-id.ts";
/** Идентификатор этой страницы: по нему сервер привязывает ресурсы (слежение за файлами) к потоку событий. */
export const pageClientId = newId();
