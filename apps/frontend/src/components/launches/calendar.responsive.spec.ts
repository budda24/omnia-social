import {
  getResponsiveCalendarDisplay,
  NARROW_CALENDAR_MAX_WIDTH,
} from './calendar.responsive';

describe('getResponsiveCalendarDisplay', () => {
  it('uses the readable day view at the narrow breakpoint', () => {
    expect(getResponsiveCalendarDisplay(636, 'week')).toBe('day');
    expect(
      getResponsiveCalendarDisplay(NARROW_CALENDAR_MAX_WIDTH, 'month')
    ).toBe('day');
  });

  it('keeps an explicit narrow view and wide calendar views', () => {
    expect(getResponsiveCalendarDisplay(636, 'list')).toBe('list');
    expect(getResponsiveCalendarDisplay(636, 'day')).toBe('day');
    expect(
      getResponsiveCalendarDisplay(NARROW_CALENDAR_MAX_WIDTH + 1, 'week')
    ).toBe('week');
  });
});
