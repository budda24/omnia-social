export type CalendarDisplay = 'week' | 'month' | 'day' | 'list';

export const NARROW_CALENDAR_MAX_WIDTH = 1023;

export function getResponsiveCalendarDisplay(
  viewportWidth: number,
  display: CalendarDisplay
): CalendarDisplay {
  if (
    viewportWidth <= NARROW_CALENDAR_MAX_WIDTH &&
    (display === 'week' || display === 'month')
  ) {
    return 'day';
  }

  return display;
}
