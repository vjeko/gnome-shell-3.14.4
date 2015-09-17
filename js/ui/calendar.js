// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const St = imports.gi.St;
const Signals = imports.signals;
const Pango = imports.gi.Pango;
const Gettext_gtk30 = imports.gettext.domain('gtk30');
const Mainloop = imports.mainloop;
const Shell = imports.gi.Shell;

const MSECS_IN_DAY = 24 * 60 * 60 * 1000;
const SHOW_WEEKDATE_KEY = 'show-weekdate';
const ELLIPSIS_CHAR = '\u2026';

// alias to prevent xgettext from picking up strings translated in GTK+
const gtk30_ = Gettext_gtk30.gettext;

// in org.gnome.desktop.interface
const CLOCK_FORMAT_KEY        = 'clock-format';

function _sameYear(dateA, dateB) {
    return (dateA.getYear() == dateB.getYear());
}

function _sameMonth(dateA, dateB) {
    return _sameYear(dateA, dateB) && (dateA.getMonth() == dateB.getMonth());
}

function _sameDay(dateA, dateB) {
    return _sameMonth(dateA, dateB) && (dateA.getDate() == dateB.getDate());
}

/* TODO: maybe needs config - right now we assume that Saturday and
 * Sunday are non-work days (not true in e.g. Israel, it's Sunday and
 * Monday there)
 */
function _isWorkDay(date) {
    return date.getDay() != 0 && date.getDay() != 6;
}

function _getBeginningOfDay(date) {
    let ret = new Date(date.getTime());
    ret.setHours(0);
    ret.setMinutes(0);
    ret.setSeconds(0);
    ret.setMilliseconds(0);
    return ret;
}

function _getEndOfDay(date) {
    let ret = new Date(date.getTime());
    ret.setHours(23);
    ret.setMinutes(59);
    ret.setSeconds(59);
    ret.setMilliseconds(999);
    return ret;
}

function _formatEventTime(event, clockFormat, periodBegin, periodEnd) {
    let ret;
    let allDay = (event.allDay || (event.date <= periodBegin && event.end >= periodEnd));
    if (allDay) {
        /* Translators: Shown in calendar event list for all day events
         * Keep it short, best if you can use less then 10 characters
         */
        ret = C_("event list time", "All Day");
    } else {
        let date = event.date >= periodBegin ? event.date : event.end;
        switch (clockFormat) {
        case '24h':
            /* Translators: Shown in calendar event list, if 24h format,
               \u2236 is a ratio character, similar to : */
            ret = date.toLocaleFormat(C_("event list time", "%H\u2236%M"));
            break;

        default:
            /* explicit fall-through */
        case '12h':
            /* Translators: Shown in calendar event list, if 12h format,
               \u2236 is a ratio character, similar to : and \u2009 is
               a thin space */
            ret = date.toLocaleFormat(C_("event list time", "%l\u2236%M\u2009%p"));
            break;
        }
    }
    return ret;
}

function _getCalendarDayAbbreviation(dayNumber) {
    let abbreviations = [
        /* Translators: Calendar grid abbreviation for Sunday.
         *
         * NOTE: These grid abbreviations are always shown together
         * and in order, e.g. "S M T W T F S".
         */
        C_("grid sunday", "S"),
        /* Translators: Calendar grid abbreviation for Monday */
        C_("grid monday", "M"),
        /* Translators: Calendar grid abbreviation for Tuesday */
        C_("grid tuesday", "T"),
        /* Translators: Calendar grid abbreviation for Wednesday */
        C_("grid wednesday", "W"),
        /* Translators: Calendar grid abbreviation for Thursday */
        C_("grid thursday", "T"),
        /* Translators: Calendar grid abbreviation for Friday */
        C_("grid friday", "F"),
        /* Translators: Calendar grid abbreviation for Saturday */
        C_("grid saturday", "S")
    ];
    return abbreviations[dayNumber];
}

function _getEventDayAbbreviation(dayNumber) {
    let abbreviations = [
        /* Translators: Event list abbreviation for Sunday.
         *
         * NOTE: These list abbreviations are normally not shown together
         * so they need to be unique (e.g. Tuesday and Thursday cannot
         * both be 'T').
         */
        C_("list sunday", "Su"),
        /* Translators: Event list abbreviation for Monday */
        C_("list monday", "M"),
        /* Translators: Event list abbreviation for Tuesday */
        C_("list tuesday", "T"),
        /* Translators: Event list abbreviation for Wednesday */
        C_("list wednesday", "W"),
        /* Translators: Event list abbreviation for Thursday */
        C_("list thursday", "Th"),
        /* Translators: Event list abbreviation for Friday */
        C_("list friday", "F"),
        /* Translators: Event list abbreviation for Saturday */
        C_("list saturday", "S")
    ];
    return abbreviations[dayNumber];
}

// Abstraction for an appointment/event in a calendar

const CalendarEvent = new Lang.Class({
    Name: 'CalendarEvent',

    _init: function(date, end, summary, allDay) {
        this.date = date;
        this.end = end;
        this.summary = summary;
        this.allDay = allDay;
    }
});

// Interface for appointments/events - e.g. the contents of a calendar
//

// First, an implementation with no events
const EmptyEventSource = new Lang.Class({
    Name: 'EmptyEventSource',

    _init: function() {
        this.isLoading = false;
        this.isDummy = true;
        this.hasCalendars = false;
    },

    destroy: function() {
    },

    requestRange: function(begin, end) {
    },

    getEvents: function(begin, end) {
        let result = [];
        return result;
    },

    hasEvents: function(day) {
        return false;
    }
});
Signals.addSignalMethods(EmptyEventSource.prototype);

const CalendarServerIface = '<node> \
<interface name="org.gnome.Shell.CalendarServer"> \
<method name="GetEvents"> \
    <arg type="x" direction="in" /> \
    <arg type="x" direction="in" /> \
    <arg type="b" direction="in" /> \
    <arg type="a(sssbxxa{sv})" direction="out" /> \
</method> \
<property name="HasCalendars" type="b" access="read" /> \
<signal name="Changed" /> \
</interface> \
</node>';

const CalendarServerInfo  = Gio.DBusInterfaceInfo.new_for_xml(CalendarServerIface);

function CalendarServer() {
    return new Gio.DBusProxy({ g_connection: Gio.DBus.session,
                               g_interface_name: CalendarServerInfo.name,
                               g_interface_info: CalendarServerInfo,
                               g_name: 'org.gnome.Shell.CalendarServer',
                               g_object_path: '/org/gnome/Shell/CalendarServer' });
}

function _datesEqual(a, b) {
    if (a < b)
        return false;
    else if (a > b)
        return false;
    return true;
}

function _dateIntervalsOverlap(a0, a1, b0, b1)
{
    if (a1 <= b0)
        return false;
    else if (b1 <= a0)
        return false;
    else
        return true;
}

// an implementation that reads data from a session bus service
const DBusEventSource = new Lang.Class({
    Name: 'DBusEventSource',

    _init: function() {
        this._resetCache();
        this.isLoading = false;
        this.isDummy = false;

        this._initialized = false;
        this._dbusProxy = new CalendarServer();
        this._dbusProxy.init_async(GLib.PRIORITY_DEFAULT, null, Lang.bind(this, function(object, result) {
            let loaded = false;

            try {
                this._dbusProxy.init_finish(result);
                loaded = true;
            } catch(e) {
                if (e.matches(Gio.DBusError, Gio.DBusError.TIMED_OUT)) {
                    // Ignore timeouts and install signals as normal, because with high
                    // probability the service will appear later on, and we will get a
                    // NameOwnerChanged which will finish loading
                    //
                    // (But still _initialized to false, because the proxy does not know
                    // about the HasCalendars property and would cause an exception trying
                    // to read it)
                } else {
                    log('Error loading calendars: ' + e.message);
                    return;
                }
            }

            this._dbusProxy.connectSignal('Changed', Lang.bind(this, this._onChanged));

            this._dbusProxy.connect('notify::g-name-owner', Lang.bind(this, function() {
                if (this._dbusProxy.g_name_owner)
                    this._onNameAppeared();
                else
                    this._onNameVanished();
            }));

            this._dbusProxy.connect('g-properties-changed', Lang.bind(this, function() {
                this.emit('notify::has-calendars');
            }));

            this._initialized = loaded;
            if (loaded) {
                this.emit('notify::has-calendars');
                this._onNameAppeared();
            }
        }));
    },

    destroy: function() {
        this._dbusProxy.run_dispose();
    },

    get hasCalendars() {
        if (this._initialized)
            return this._dbusProxy.HasCalendars;
        else
            return false;
    },

    _resetCache: function() {
        this._events = [];
        this._lastRequestBegin = null;
        this._lastRequestEnd = null;
    },

    _onNameAppeared: function(owner) {
        this._initialized = true;
        this._resetCache();
        this._loadEvents(true);
    },

    _onNameVanished: function(oldOwner) {
        this._resetCache();
        this.emit('changed');
    },

    _onChanged: function() {
        this._loadEvents(false);
    },

    _onEventsReceived: function(results, error) {
        let newEvents = [];
        let appointments = results ? results[0] : null;
        if (appointments != null) {
            for (let n = 0; n < appointments.length; n++) {
                let a = appointments[n];
                let date = new Date(a[4] * 1000);
                let end = new Date(a[5] * 1000);
                let summary = a[1];
                let allDay = a[3];
                let event = new CalendarEvent(date, end, summary, allDay);
                newEvents.push(event);
            }
            newEvents.sort(function(event1, event2) {
                return event1.date.getTime() - event2.date.getTime();
            });
        }

        this._events = newEvents;
        this.isLoading = false;
        this.emit('changed');
    },

    _loadEvents: function(forceReload) {
        // Ignore while loading
        if (!this._initialized)
            return;

        if (this._curRequestBegin && this._curRequestEnd){
            this._dbusProxy.GetEventsRemote(this._curRequestBegin.getTime() / 1000,
                                            this._curRequestEnd.getTime() / 1000,
                                            forceReload,
                                            Lang.bind(this, this._onEventsReceived),
                                            Gio.DBusCallFlags.NONE);
        }
    },

    requestRange: function(begin, end) {
        if (!(_datesEqual(begin, this._lastRequestBegin) && _datesEqual(end, this._lastRequestEnd))) {
            this.isLoading = true;
            this._lastRequestBegin = begin;
            this._lastRequestEnd = end;
            this._curRequestBegin = begin;
            this._curRequestEnd = end;
            this._loadEvents(false);
        }
    },

    getEvents: function(begin, end) {
        let result = [];
        for(let n = 0; n < this._events.length; n++) {
            let event = this._events[n];
            if (_dateIntervalsOverlap (event.date, event.end, begin, end)) {
                result.push(event);
            }
        }
        result.sort(function(event1, event2) {
            // sort events by end time on ending day
            let d1 = event1.date < begin && event1.end <= end ? event1.end : event1.date;
            let d2 = event2.date < begin && event2.end <= end ? event2.end : event2.date;
            return d1.getTime() - d2.getTime();
        });
        return result;
    },

    hasEvents: function(day) {
        let dayBegin = _getBeginningOfDay(day);
        let dayEnd = _getEndOfDay(day);

        let events = this.getEvents(dayBegin, dayEnd);

        if (events.length == 0)
            return false;

        return true;
    }
});
Signals.addSignalMethods(DBusEventSource.prototype);

const Calendar = new Lang.Class({
    Name: 'Calendar',

    _init: function() {
        this._weekStart = Shell.util_get_week_start();
        this._settings = new Gio.Settings({ schema_id: 'org.gnome.shell.calendar' });

        this._settings.connect('changed::' + SHOW_WEEKDATE_KEY, Lang.bind(this, this._onSettingsChange));
        this._useWeekdate = this._settings.get_boolean(SHOW_WEEKDATE_KEY);

        // Find the ordering for month/year in the calendar heading
        this._headerFormatWithoutYear = '%B';
        switch (gtk30_('calendar:MY')) {
        case 'calendar:MY':
            this._headerFormat = '%B %Y';
            break;
        case 'calendar:YM':
            this._headerFormat = '%Y %B';
            break;
        default:
            log('Translation of "calendar:MY" in GTK+ is not correct');
            this._headerFormat = '%B %Y';
            break;
        }

        // Start off with the current date
        this._selectedDate = new Date();

        this._shouldDateGrabFocus = false;

        this.actor = new St.Widget({ style_class: 'calendar',
                                     layout_manager: new Clutter.GridLayout(),
                                     reactive: true });

        this.actor.connect('scroll-event',
                           Lang.bind(this, this._onScroll));

        this._buildHeader ();
    },

    // @eventSource: is an object implementing the EventSource API, e.g. the
    // requestRange(), getEvents(), hasEvents() methods and the ::changed signal.
    setEventSource: function(eventSource) {
        this._eventSource = eventSource;
        this._eventSource.connect('changed', Lang.bind(this, function() {
            this._rebuildCalendar();
            this._update();
        }));
        this._rebuildCalendar();
        this._update();
    },

    // Sets the calendar to show a specific date
    setDate: function(date) {
        if (_sameDay(date, this._selectedDate))
            return;

        this._selectedDate = date;
        this._update();
        this.emit('selected-date-changed', new Date(this._selectedDate));
    },

    _buildHeader: function() {
        let layout = this.actor.layout_manager;
        let offsetCols = this._useWeekdate ? 1 : 0;
        this.actor.destroy_all_children();

        // Top line of the calendar '<| September 2009 |>'
        this._topBox = new St.BoxLayout();
        layout.attach(this._topBox, 0, 0, offsetCols + 7, 1);

        this._backButton = new St.Button({ style_class: 'calendar-change-month-back',
                                           accessible_name: _("Previous month"),
                                           can_focus: true });
        this._topBox.add(this._backButton);
        this._backButton.connect('clicked', Lang.bind(this, this._onPrevMonthButtonClicked));

        this._monthLabel = new St.Label({style_class: 'calendar-month-label',
                                         can_focus: true });
        this._topBox.add(this._monthLabel, { expand: true, x_fill: false, x_align: St.Align.MIDDLE });

        this._forwardButton = new St.Button({ style_class: 'calendar-change-month-forward',
                                              accessible_name: _("Next month"),
                                              can_focus: true });
        this._topBox.add(this._forwardButton);
        this._forwardButton.connect('clicked', Lang.bind(this, this._onNextMonthButtonClicked));

        // Add weekday labels...
        //
        // We need to figure out the abbreviated localized names for the days of the week;
        // we do this by just getting the next 7 days starting from right now and then putting
        // them in the right cell in the table. It doesn't matter if we add them in order
        let iter = new Date(this._selectedDate);
        iter.setSeconds(0); // Leap second protection. Hah!
        iter.setHours(12);
        for (let i = 0; i < 7; i++) {
            // Could use iter.toLocaleFormat('%a') but that normally gives three characters
            // and we want, ideally, a single character for e.g. S M T W T F S
            let customDayAbbrev = _getCalendarDayAbbreviation(iter.getDay());
            let label = new St.Label({ style_class: 'calendar-day-base calendar-day-heading',
                                       text: customDayAbbrev });
            let col;
            if (this.actor.get_text_direction() == Clutter.TextDirection.RTL)
                col = 6 - (7 + iter.getDay() - this._weekStart) % 7;
            else
                col = offsetCols + (7 + iter.getDay() - this._weekStart) % 7;
            layout.attach(label, col, 1, 1, 1);
            iter.setTime(iter.getTime() + MSECS_IN_DAY);
        }

        // All the children after this are days, and get removed when we update the calendar
        this._firstDayIndex = this.actor.get_n_children();
    },

    _onScroll : function(actor, event) {
        switch (event.get_scroll_direction()) {
        case Clutter.ScrollDirection.UP:
        case Clutter.ScrollDirection.LEFT:
            this._onPrevMonthButtonClicked();
            break;
        case Clutter.ScrollDirection.DOWN:
        case Clutter.ScrollDirection.RIGHT:
            this._onNextMonthButtonClicked();
            break;
        }
        return Clutter.EVENT_PROPAGATE;
    },

    _onPrevMonthButtonClicked: function() {
        let newDate = new Date(this._selectedDate);
        let oldMonth = newDate.getMonth();
        if (oldMonth == 0) {
            newDate.setMonth(11);
            newDate.setFullYear(newDate.getFullYear() - 1);
            if (newDate.getMonth() != 11) {
                let day = 32 - new Date(newDate.getFullYear() - 1, 11, 32).getDate();
                newDate = new Date(newDate.getFullYear() - 1, 11, day);
            }
        }
        else {
            newDate.setMonth(oldMonth - 1);
            if (newDate.getMonth() != oldMonth - 1) {
                let day = 32 - new Date(newDate.getFullYear(), oldMonth - 1, 32).getDate();
                newDate = new Date(newDate.getFullYear(), oldMonth - 1, day);
            }
        }

        this._backButton.grab_key_focus();

        this.setDate(newDate);
    },

    _onNextMonthButtonClicked: function() {
        let newDate = new Date(this._selectedDate);
        let oldMonth = newDate.getMonth();
        if (oldMonth == 11) {
            newDate.setMonth(0);
            newDate.setFullYear(newDate.getFullYear() + 1);
            if (newDate.getMonth() != 0) {
                let day = 32 - new Date(newDate.getFullYear() + 1, 0, 32).getDate();
                newDate = new Date(newDate.getFullYear() + 1, 0, day);
            }
        }
        else {
            newDate.setMonth(oldMonth + 1);
            if (newDate.getMonth() != oldMonth + 1) {
                let day = 32 - new Date(newDate.getFullYear(), oldMonth + 1, 32).getDate();
                newDate = new Date(newDate.getFullYear(), oldMonth + 1, day);
            }
        }

        this._forwardButton.grab_key_focus();

        this.setDate(newDate);
    },

    _onSettingsChange: function() {
        this._useWeekdate = this._settings.get_boolean(SHOW_WEEKDATE_KEY);
        this._buildHeader();
        this._rebuildCalendar();
        this._update();
    },

    _rebuildCalendar: function() {
        let now = new Date();

        // Remove everything but the topBox and the weekday labels
        let children = this.actor.get_children();
        for (let i = this._firstDayIndex; i < children.length; i++)
            children[i].destroy();

        this._buttons = [];

        // Start at the beginning of the week before the start of the month
        //
        // We want to show always 6 weeks (to keep the calendar menu at the same
        // height if there are no events), so we pad it according to the following
        // policy:
        //
        // 1 - If a month has 6 weeks, we place no padding (example: Dec 2012)
        // 2 - If a month has 5 weeks and it starts on week start, we pad one week
        //     before it (example: Apr 2012)
        // 3 - If a month has 5 weeks and it starts on any other day, we pad one week
        //     after it (example: Nov 2012)
        // 4 - If a month has 4 weeks, we pad one week before and one after it
        //     (example: Feb 2010)
        //
        // Actually computing the number of weeks is complex, but we know that the
        // problematic categories (2 and 4) always start on week start, and that
        // all months at the end have 6 weeks.
        let beginDate = new Date(this._selectedDate);
        beginDate.setDate(1);
        beginDate.setSeconds(0);
        beginDate.setHours(12);

        this._calendarBegin = new Date(beginDate);
        this._markedAsToday = now;

        let year = beginDate.getYear();

        let daysToWeekStart = (7 + beginDate.getDay() - this._weekStart) % 7;
        let startsOnWeekStart = daysToWeekStart == 0;
        let weekPadding = startsOnWeekStart ? 7 : 0;

        beginDate.setTime(beginDate.getTime() - (weekPadding + daysToWeekStart) * MSECS_IN_DAY);

        let layout = this.actor.layout_manager;
        let iter = new Date(beginDate);
        let row = 2;
        // nRows here means 6 weeks + one header + one navbar
        let nRows = 8;
        while (row < 8) {
            let button = new St.Button({ label: iter.getDate().toString(),
                                         can_focus: true });
            let rtl = button.get_text_direction() == Clutter.TextDirection.RTL;

            if (this._eventSource.isDummy)
                button.reactive = false;

            button._date = new Date(iter);
            button.connect('clicked', Lang.bind(this, function() {
                this._shouldDateGrabFocus = true;
                this.setDate(button._date);
                this._shouldDateGrabFocus = false;
            }));

            let hasEvents = this._eventSource.hasEvents(iter);
            let styleClass = 'calendar-day-base calendar-day';

            if (_isWorkDay(iter))
                styleClass += ' calendar-work-day';
            else
                styleClass += ' calendar-nonwork-day';

            // Hack used in lieu of border-collapse - see gnome-shell.css
            if (row == 2)
                styleClass = 'calendar-day-top ' + styleClass;

            let leftMost = rtl ? iter.getDay() == (this._weekStart + 6) % 7
                               : iter.getDay() == this._weekStart;
            if (leftMost)
                styleClass = 'calendar-day-left ' + styleClass;

            if (_sameDay(now, iter))
                styleClass += ' calendar-today';
            else if (iter.getMonth() != this._selectedDate.getMonth())
                styleClass += ' calendar-other-month-day';

            if (hasEvents)
                styleClass += ' calendar-day-with-events';

            button.style_class = styleClass;

            let offsetCols = this._useWeekdate ? 1 : 0;
            let col;
            if (rtl)
                col = 6 - (7 + iter.getDay() - this._weekStart) % 7;
            else
                col = offsetCols + (7 + iter.getDay() - this._weekStart) % 7;
            layout.attach(button, col, row, 1, 1);

            this._buttons.push(button);

            if (this._useWeekdate && iter.getDay() == 4) {
                let label = new St.Label({ text: iter.toLocaleFormat('%V'),
                                           style_class: 'calendar-day-base calendar-week-number'});
                layout.attach(label, rtl ? 7 : 0, row, 1, 1);
            }

            iter.setTime(iter.getTime() + MSECS_IN_DAY);

            if (iter.getDay() == this._weekStart)
                row++;
        }

        // Signal to the event source that we are interested in events
        // only from this date range
        this._eventSource.requestRange(beginDate, iter);
    },

    _update: function() {
        let now = new Date();

        if (_sameYear(this._selectedDate, now))
            this._monthLabel.text = this._selectedDate.toLocaleFormat(this._headerFormatWithoutYear);
        else
            this._monthLabel.text = this._selectedDate.toLocaleFormat(this._headerFormat);

        if (!this._calendarBegin || !_sameMonth(this._selectedDate, this._calendarBegin) || !_sameDay(now, this._markedAsToday))
            this._rebuildCalendar();

        this._buttons.forEach(Lang.bind(this, function(button) {
            if (_sameDay(button._date, this._selectedDate)) {
                button.add_style_pseudo_class('active');
                if (this._shouldDateGrabFocus)
                    button.grab_key_focus();
            }
            else
                button.remove_style_pseudo_class('active');
        }));
    }
});

Signals.addSignalMethods(Calendar.prototype);

const EventsList = new Lang.Class({
    Name: 'EventsList',

    _init: function() {
        let layout = new Clutter.GridLayout({ orientation: Clutter.Orientation.VERTICAL });
        this.actor = new St.Widget({ style_class: 'events-table',
                                     layout_manager: layout });
        layout.hookup_style(this.actor);
        this._date = new Date();
        this._desktopSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
        this._desktopSettings.connect('changed', Lang.bind(this, this._update));
        this._weekStart = Shell.util_get_week_start();
    },

    setEventSource: function(eventSource) {
        this._eventSource = eventSource;
        this._eventSource.connect('changed', Lang.bind(this, this._update));
    },

    _addEvent: function(event, index, includeDayName, periodBegin, periodEnd) {
        let eventBox = new St.BoxLayout();
        eventBox.set_vertical(false);
        let dayString;
        if (includeDayName) {
            if (event.date >= periodBegin)
                dayString = _getEventDayAbbreviation(event.date.getDay());
            else /* show event end day if it began earlier */
                dayString = _getEventDayAbbreviation(event.end.getDay());
        } else {
            dayString = '';
        }

        let dayLabel = new St.Label({ style_class: 'events-day-dayname',
                                      text: dayString,
                                      x_align: Clutter.ActorAlign.END,
                                      y_align: Clutter.ActorAlign.START });
        dayLabel.clutter_text.line_wrap = false;
        dayLabel.clutter_text.ellipsize = false;

        let rtl = this.actor.get_text_direction() == Clutter.TextDirection.RTL;

        let layout = this.actor.layout_manager;
        eventBox.add_actor(dayLabel);
        let clockFormat = this._desktopSettings.get_string(CLOCK_FORMAT_KEY);
        let timeString = _formatEventTime(event, clockFormat, periodBegin, periodEnd);
        let timeLabel = new St.Label({ style_class: 'events-day-time',
                                       text: timeString,
                                       y_align: Clutter.ActorAlign.START });
        timeLabel.clutter_text.line_wrap = false;
        timeLabel.clutter_text.ellipsize = false;

        let preEllipsisLabel = new St.Label({ style_class: 'events-day-time-ellipses',
                                              text: ELLIPSIS_CHAR,
                                              y_align: Clutter.ActorAlign.START });
        let postEllipsisLabel = new St.Label({ style_class: 'events-day-time-ellipses',
                                               text: ELLIPSIS_CHAR,
                                               y_align: Clutter.ActorAlign.START });
        if (event.allDay || event.date >= periodBegin)
            preEllipsisLabel.opacity = 0;
        if (event.allDay || event.end <= periodEnd)
            postEllipsisLabel.opacity = 0;

        let timeLabelBoxLayout = new St.BoxLayout({ x_align: Clutter.ActorAlign.START });
        timeLabelBoxLayout.add(preEllipsisLabel);
        timeLabelBoxLayout.add(timeLabel);
        timeLabelBoxLayout.add(postEllipsisLabel);
        timeLabelBoxLayout.set_size(50, 1);
        eventBox.add_actor(timeLabelBoxLayout);

        let titleLabel = new St.Label({ style_class: 'events-day-task',
                                        text: event.summary,
                                        x_expand: true });
        titleLabel.clutter_text.line_wrap = true;
        titleLabel.clutter_text.ellipsize = false;

        eventBox.add_actor(titleLabel);
        this._eventListBox.add_actor(eventBox);
    },

    _addPeriod: function(header, index, periodBegin, periodEnd, includeDayName, showNothingScheduled) {
        let events = this._eventSource.getEvents(periodBegin, periodEnd);

        if (events.length == 0 && !showNothingScheduled)
            return index;

        let label = new St.Label({ style_class: 'events-day-header', text: header });
        this._eventListBox.add_actor(label);
        index++;

        for (let n = 0; n < events.length; n++) {
            this._addEvent(events[n], index, includeDayName, periodBegin, periodEnd);
            index++;
        }

        if (events.length == 0 && showNothingScheduled) {
            /* Translators: Text to show if there are no events */
            let nothingEvent = new CalendarEvent(periodBegin, periodBegin, _("Nothing Scheduled"), true);
            this._addEvent(nothingEvent, index, false, periodBegin, periodEnd);
            index++;
        }

        return index;
    },

    _showOtherDay: function(day) {
        let dayBegin = _getBeginningOfDay(day);
        let dayEnd = _getEndOfDay(day);

        let dayString;
        let now = new Date();
        if (_sameYear(day, now))
            /* Translators: Shown on calendar heading when selected day occurs on current year */
            dayString = day.toLocaleFormat(C_("calendar heading", "%A, %B %d"));
        else
            /* Translators: Shown on calendar heading when selected day occurs on different year */
            dayString = day.toLocaleFormat(C_("calendar heading", "%A, %B %d, %Y"));
        this._addPeriod(dayString, 0, dayBegin, dayEnd, false, true);
    },

    _showToday: function() {
        let index = 0;

        let now = new Date();
        let dayBegin = _getBeginningOfDay(now);
        let dayEnd = _getEndOfDay(now);
        index = this._addPeriod(_("Today"), index, dayBegin, dayEnd, false, true);

        let tomorrowBegin = new Date(dayBegin.getTime() + 86400 * 1000);
        let tomorrowEnd = new Date(dayEnd.getTime() + 86400 * 1000);
        index = this._addPeriod(_("Tomorrow"), index, tomorrowBegin, tomorrowEnd, false, true);

        let dayInWeek = (dayEnd.getDay() - this._weekStart + 7) % 7;

        if (dayInWeek < 5) {
            /* If now is within the first 5 days we show "This week" and
             * include events up until and including Saturday/Sunday
             * (depending on whether a week starts on Sunday/Monday).
             */
            let thisWeekBegin = new Date(dayBegin.getTime() + 2 * 86400 * 1000);
            let thisWeekEnd = new Date(dayEnd.getTime() + (6 - dayInWeek) * 86400 * 1000);
            index = this._addPeriod(_("This week"), index, thisWeekBegin, thisWeekEnd, true, false);
        } else {
            /* otherwise it's one of the two last days of the week ... show
             * "Next week" and include events up until and including *next*
             * Saturday/Sunday
             */
            let nextWeekBegin = new Date(dayBegin.getTime() + 2 * 86400 * 1000);
            let nextWeekEnd = new Date(dayEnd.getTime() + (13 - dayInWeek) * 86400 * 1000);
            index = this._addPeriod(_("Next week"), index, nextWeekBegin, nextWeekEnd, true, false);
        }
    },

    // Sets the event list to show events from a specific date
    setDate: function(date) {
        if (!_sameDay(date, this._date)) {
            this._date = date;
            this._update();
        }
    },

    _update: function() {
        if (this._eventSource.isLoading)
            return;

        this.actor.destroy_all_children();

        let layout = this.actor.layout_manager;

        this._eventListContainer = new St.BoxLayout({ x_expand: true, y_expand: true });
        this._eventListContainer.set_vertical(true);

        this._eventListBox = new St.BoxLayout();
        this._eventListBox.set_vertical(true);

        let eventScrollView = new St.ScrollView({style_class: 'vfade',
                                                hscrollbar_policy: Gtk.PolicyType.NEVER,
                                                vscrollbar_policy: Gtk.PolicyType.AUTOMATIC});
        eventScrollView.add_actor(this._eventListBox);
        this._eventListContainer.add_actor(eventScrollView);

        layout.attach(this._eventListContainer, 0, 0, 1, 1);

        let today = new Date();
        if (_sameDay (this._date, today)) {
            this._showToday();
        } else {
            this._showOtherDay(this._date);
        }
    }
});
