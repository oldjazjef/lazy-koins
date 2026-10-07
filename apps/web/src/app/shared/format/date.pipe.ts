import { Pipe, type PipeTransform } from '@angular/core';
import { type DateMode, formatDate } from './locale-format';

/**
 * `{{ iso | lkDate }}` = `31.12.2025` (or the profile's format, F11.2); `lkDate: 'dateTime'` adds
 * `14:05`, `'dateTimeSeconds'` `14:05:09`; a second argument `'UTC'` shows the UTC day. Replaces
 * Angular's DatePipe, whose locale is fixed at start. Impure: it reads the active format.
 */
@Pipe({ name: 'lkDate', pure: false })
export class LkDatePipe implements PipeTransform {
  transform(
    value: string | number | Date | null | undefined,
    mode: DateMode = 'date',
    timeZone?: string,
  ): string {
    return formatDate(value, mode, timeZone);
  }
}
