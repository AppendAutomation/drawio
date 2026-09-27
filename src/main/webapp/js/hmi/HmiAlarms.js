/**
 * The alarm system: one HmiAlarmManager per Run watches every alarmed tag,
 * whether or not a window shows it, and keeps each alarm's state. Windows read
 * it through dotfields (.InAlarm, .Acked) and the system tags (_AlarmsActive,
 * _AlarmsUnacked, _AckAll), and the Alarm List and Alarm History objects show
 * it. Events go to the history files through the main process.
 *
 * Acknowledgement follows ISA-18.2: an alarm stays listed until it has
 * returned to normal and been acknowledged. Escalating (Hi to HiHi, Lo to
 * LoLo) needs acknowledging again; easing back (HiHi to Hi) does not.
 *
 * The tag's comment is the alarm's description. No EditorUi dependency: the
 * published runtime uses this unchanged.
 */
HmiAlarms = function() {};

/** Display names of the alarm conditions. */
HmiAlarms.CONDITIONS = {hiHi: 'HiHi', high: 'Hi', low: 'Lo', loLo: 'LoLo', on: 'On', off: 'Off'};

HmiAlarms.SEVERITY = {hiHi: 2, loLo: 2, high: 1, low: 1, on: 1, off: 1};

HmiAlarms.SIDE = {hiHi: 'high', high: 'high', low: 'low', loLo: 'low'};

/** Events kept in memory for the Alarm History object. */
HmiAlarms.HISTORY_SIZE = 1000;

/** True when the tag has an alarm configured. */
HmiAlarms.isAlarmed = function(tag)
{
	var a = (tag != null) ? tag.alarms : null;

	if (a == null)
	{
		return false;
	}

	if (HmiTypes.isDiscrete(tag.type))
	{
		return a.state === 'on' || a.state === 'off';
	}

	return HmiTypes.isAnalog(tag.type) && (HmiAlarms.num(a.hiHi) != null ||
		HmiAlarms.num(a.high) != null || HmiAlarms.num(a.low) != null ||
		HmiAlarms.num(a.loLo) != null);
};

HmiAlarms.num = function(v)
{
	var n = parseFloat(v);

	return (v == null || v === '' || isNaN(n)) ? null : n;
};

/**
 * The alarm condition for a value, or null when normal. prev is the current
 * condition: a limit already crossed holds until the value is back inside it
 * by the deadband, so a value hovering at a limit does not chatter.
 */
HmiAlarms.condition = function(tag, value, prev)
{
	var a = tag.alarms || {};

	if (HmiTypes.isDiscrete(tag.type))
	{
		var on = HmiRuntime.truthy(value);

		return (a.state === 'on' && on) ? 'on' : ((a.state === 'off' && !on) ? 'off' : null);
	}

	var v = parseFloat(value);

	if (isNaN(v))
	{
		return prev || null;
	}

	var db = Math.abs(HmiAlarms.num(a.deadband) || 0);
	var hiHi = HmiAlarms.num(a.hiHi);
	var high = HmiAlarms.num(a.high);
	var low = HmiAlarms.num(a.low);
	var loLo = HmiAlarms.num(a.loLo);

	// Outermost first; the deadband applies to a limit already crossed
	if (hiHi != null && v >= hiHi - ((prev === 'hiHi') ? db : 0)) { return 'hiHi'; }
	if (loLo != null && v <= loLo + ((prev === 'loLo') ? db : 0)) { return 'loLo'; }
	if (high != null && v >= high - ((prev === 'high' || prev === 'hiHi') ? db : 0)) { return 'high'; }
	if (low != null && v <= low + ((prev === 'low' || prev === 'loLo') ? db : 0)) { return 'low'; }

	return null;
};

HmiAlarms.limitFor = function(tag, condition)
{
	var a = tag.alarms || {};

	return (HmiAlarms.SIDE[condition] != null) ? HmiAlarms.num(a[condition]) : null;
};

/**
 * @param project  the HmiProject
 * @param driver   a driver or hub client (on/off, subscribe/unsubscribe, get)
 * @param options  {store, persist: function(events)}: where events are logged
 */
HmiAlarmManager = function(project, driver, options)
{
	this.project = project;
	this.driver = driver;
	this.options = options || {};
	this.records = {};
	this.events = [];
	this.listeners = {change: [], event: [], names: []};
	this.running = false;
};

HmiAlarmManager.prototype.on = function(name, fn)
{
	this.listeners[name].push(fn);
};

HmiAlarmManager.prototype.off = function(name, fn)
{
	var i = mxUtils.indexOf(this.listeners[name], fn);

	if (i >= 0)
	{
		this.listeners[name].splice(i, 1);
	}
};

HmiAlarmManager.prototype.fire = function(name, arg)
{
	var list = this.listeners[name].slice(0);

	for (var i = 0; i < list.length; i++)
	{
		HmiLog.guard('alarms.' + name, function() { list[i](arg); });
	}
};

/** The names of the alarmed tags. */
HmiAlarmManager.prototype.alarmedTags = function()
{
	var names = [];

	for (var i = 0; i < this.project.tags.length; i++)
	{
		if (HmiAlarms.isAlarmed(this.project.tags[i]))
		{
			names.push(this.project.tags[i].name);
		}
	}

	return names;
};

HmiAlarmManager.prototype.start = function()
{
	if (this.running)
	{
		return;
	}

	this.running = true;

	var that = this;
	this.onChange = function(batch) { that.applyBatch(batch); };
	this.driver.on('change', this.onChange);

	var names = this.alarmedTags();

	if (names.length > 0)
	{
		this.driver.subscribe(names, 250);
	}

	// Values already known (the simulator answers at once)
	var initial = {};

	for (var i = 0; i < names.length; i++)
	{
		var v = this.driver.get(names[i]);

		if (v != null)
		{
			initial[names[i]] = v;
		}
	}

	this.applyBatch(initial);
};

HmiAlarmManager.prototype.stop = function()
{
	if (!this.running)
	{
		return;
	}

	this.running = false;

	if (this.onChange != null)
	{
		this.driver.off('change', this.onChange);
		this.onChange = null;
	}

	this.driver.unsubscribe();
};

HmiAlarmManager.prototype.record = function(name)
{
	return this.records[('' + name).toLowerCase()] || null;
};

/** Evaluates the alarmed tags in a change batch. */
HmiAlarmManager.prototype.applyBatch = function(batch)
{
	var events = [];
	var changed = [];

	for (var name in batch)
	{
		var tag = this.project.getTag(name);

		if (tag != null && HmiAlarms.isAlarmed(tag))
		{
			if (this.evaluate(tag, batch[name], events))
			{
				changed.push(tag.name);
			}
		}
	}

	this.publish(events, changed);
};

/**
 * One tag's new value against its alarm. Returns true when the alarm state
 * (not just the value shown) changed.
 */
HmiAlarmManager.prototype.evaluate = function(tag, v, events)
{
	var key = tag.name.toLowerCase();
	var rec = this.records[key];

	// Bad quality holds the alarm as it is; the lists show the value as bad
	if (v == null || v.quality <= HmiTypes.QUALITY_BAD)
	{
		if (rec != null)
		{
			rec.bad = true;
		}

		return false;
	}

	var time = v.timestamp || Date.now();
	var prev = (rec != null && rec.active) ? rec.condition : null;
	var cond = HmiAlarms.condition(tag, v.value, prev);

	if (rec != null)
	{
		rec.value = v.value;
		rec.bad = false;
	}

	if (cond === prev)
	{
		return false;
	}

	if (cond != null && prev == null)
	{
		// A new alarm, or a cleared-but-unacknowledged one coming back
		rec = {tag: tag.name, condition: cond, active: true, acked: false,
			value: v.value, alarmTime: time, ackTime: null, rtnTime: null, bad: false};
		this.records[key] = rec;
		events.push(this.event('ALM', tag, rec, time));
	}
	else if (cond != null)
	{
		var escalated = HmiAlarms.SEVERITY[cond] > HmiAlarms.SEVERITY[prev] ||
			HmiAlarms.SIDE[cond] !== HmiAlarms.SIDE[prev];

		rec.condition = cond;

		if (escalated)
		{
			rec.acked = false;
			rec.ackTime = null;
			rec.alarmTime = time;
			events.push(this.event('ALM', tag, rec, time));
		}
		else
		{
			events.push(this.event('CHG', tag, rec, time));
		}
	}
	else
	{
		rec.active = false;
		rec.rtnTime = time;
		events.push(this.event('RTN', tag, rec, time));

		if (rec.acked)
		{
			delete this.records[key];
		}
	}

	return true;
};

HmiAlarmManager.prototype.event = function(kind, tag, rec, time)
{
	var limit = HmiAlarms.limitFor(tag, rec.condition);

	return {time: time, event: kind, tag: tag.name,
		description: tag.comment || tag.name,
		condition: HmiAlarms.CONDITIONS[rec.condition] || rec.condition,
		value: (rec.value != null) ? rec.value : '',
		limit: (limit != null) ? limit : ''};
};

/** Records events, logs them, and tells the windows what changed. */
HmiAlarmManager.prototype.publish = function(events, changed)
{
	if (events.length > 0)
	{
		for (var i = 0; i < events.length; i++)
		{
			this.events.unshift(events[i]);
			HmiLog.log('alarm ' + events[i].event + ' ' + events[i].tag + ' ' + events[i].condition +
				' = ' + events[i].value);
		}

		if (this.events.length > HmiAlarms.HISTORY_SIZE)
		{
			this.events.length = HmiAlarms.HISTORY_SIZE;
		}

		if (this.options.persist != null)
		{
			this.options.persist(events);
		}

		this.fire('event', events);
	}

	if (changed.length > 0)
	{
		// The system tags change with any alarm state change
		this.fire('names', changed.concat(['_AlarmsActive', '_AlarmsUnacked']));
		this.fire('change', changed);
	}
	else if (events.length > 0)
	{
		this.fire('change', []);
	}
};

// ------------------------------------------------------------------ queries

/** Listed alarms (active or unacknowledged), newest first. */
HmiAlarmManager.prototype.active = function()
{
	var list = [];

	for (var key in this.records)
	{
		list.push(this.records[key]);
	}

	list.sort(function(a, b) { return b.alarmTime - a.alarmTime; });

	return list;
};

/** Events, newest first. */
HmiAlarmManager.prototype.history = function()
{
	return this.events;
};

HmiAlarmManager.prototype.isActive = function(name)
{
	var rec = this.record(name);

	return rec != null && rec.active;
};

/** True unless the tag has an unacknowledged alarm. */
HmiAlarmManager.prototype.isAcked = function(name)
{
	var rec = this.record(name);

	return rec == null || rec.acked;
};

/** The active condition ('hiHi', 'high', 'low', 'loLo', 'on', 'off') or null. */
HmiAlarmManager.prototype.condition = function(name)
{
	var rec = this.record(name);

	return (rec != null && rec.active) ? rec.condition : null;
};

HmiAlarmManager.prototype.counts = function()
{
	var active = 0;
	var unacked = 0;

	for (var key in this.records)
	{
		if (this.records[key].active) { active++; }
		if (!this.records[key].acked) { unacked++; }
	}

	return {active: active, unacked: unacked};
};

/** A system tag's value, as the expression engine reads it. */
HmiAlarmManager.prototype.readSystem = function(name)
{
	var c = this.counts();
	var map = {'_AlarmsActive': c.active, '_AlarmsUnacked': c.unacked, '_AckAll': 0};

	return {value: (map[name] != null) ? map[name] : null,
		quality: (map[name] != null) ? HmiTypes.QUALITY_GOOD : HmiTypes.QUALITY_BAD,
		timestamp: Date.now()};
};

// ---------------------------------------------------------- acknowledgement

HmiAlarmManager.prototype.ack = function(name)
{
	var events = [];
	var changed = [];

	this.ackOne(this.record(name), events, changed);
	this.publish(events, changed);

	return events.length > 0;
};

HmiAlarmManager.prototype.ackAll = function()
{
	var events = [];
	var changed = [];
	var list = this.active();

	for (var i = 0; i < list.length; i++)
	{
		this.ackOne(list[i], events, changed);
	}

	this.publish(events, changed);

	return events.length;
};

HmiAlarmManager.prototype.ackOne = function(rec, events, changed)
{
	if (rec == null || rec.acked)
	{
		return;
	}

	var tag = this.project.getTag(rec.tag);
	var time = Date.now();

	rec.acked = true;
	rec.ackTime = time;
	events.push(this.event('ACK', tag || {name: rec.tag, alarms: {}}, rec, time));
	changed.push(rec.tag);

	if (!rec.active)
	{
		delete this.records[rec.tag.toLowerCase()];
	}
};

// ----------------------------------------------------------- history files

/**
 * Appends events to the history files (main process). Outside the desktop
 * app there is nowhere to write, and the in-memory history still works.
 */
HmiAlarms.persist = function(store, events)
{
	if (window.electron == null || typeof window.electron.request !== 'function' || !store)
	{
		return;
	}

	window.electron.request({action: 'hmiAlarms.append', store: store, events: events},
		function() {}, function(message)
	{
		HmiLog.once('alarms.persist', 'alarm history not written: ' + message);
	});
};

/** The newest logged events, newest first, to fn(events). */
HmiAlarms.loadRecent = function(store, limit, fn)
{
	if (window.electron == null || typeof window.electron.request !== 'function' || !store)
	{
		fn([]);

		return;
	}

	window.electron.request({action: 'hmiAlarms.recent', store: store, limit: limit},
		function(events) { fn(events || []); }, function(message)
	{
		HmiLog.once('alarms.recent', 'alarm history not read: ' + message);
		fn([]);
	});
};
