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

// ================================================================= objects
//
// Alarm List (active and unacknowledged alarms) and Alarm History (events)
// are vertices with shape=hmiAlarmList / shape=hmiAlarmHistory. Their
// settings are style keys, so the design-time preview shows them:
//   hmiTitle      heading ('' for none)
//   hmiColumns    comma-separated column keys, in order
//   hmiMaxEvents  history only: how many events to show (default 200)
//   fontSize      as for any shape
// At Run an HTML table replaces the preview (HmiAlarmView).

HmiAlarms.LIST_SHAPE = 'hmiAlarmList';
HmiAlarms.HISTORY_SHAPE = 'hmiAlarmHistory';

HmiAlarms.COLUMNS = {
	time: 'Time', event: 'Event', tag: 'Tag', description: 'Description',
	condition: 'Condition', value: 'Value', limit: 'Limit', state: 'State'
};

HmiAlarms.LIST_COLUMNS = ['time', 'tag', 'description', 'condition', 'value', 'state'];
HmiAlarms.HISTORY_COLUMNS = ['time', 'event', 'tag', 'description', 'condition', 'value', 'limit'];

HmiAlarms.EVENT_LABELS = {ALM: 'Alarm', RTN: 'Return', ACK: 'Ack', CHG: 'Change'};

HmiAlarms.DEFAULT_MAX_EVENTS = 200;

/** 'list', 'history' or null for any other cell. */
HmiAlarms.objectKind = function(graph, cell)
{
	if (cell == null || !graph.getModel().isVertex(cell))
	{
		return null;
	}

	var shape = graph.getCellStyle(cell)[mxConstants.STYLE_SHAPE];

	return (shape === HmiAlarms.LIST_SHAPE) ? 'list' : ((shape === HmiAlarms.HISTORY_SHAPE) ? 'history' : null);
};

/** The object's columns from its style, falling back to the defaults. */
HmiAlarms.columnsOf = function(style, kind)
{
	var all = (kind === 'history') ? HmiAlarms.HISTORY_COLUMNS : HmiAlarms.LIST_COLUMNS;
	var text = (style != null) ? style.hmiColumns : null;

	if (text == null || text === '')
	{
		return all.slice(0);
	}

	return String(text).split(',').filter(function(c) { return mxUtils.indexOf(all, c) >= 0; });
};

HmiAlarms.titleOf = function(style, kind)
{
	return (style != null && style.hmiTitle != null) ? String(style.hmiTitle) :
		((kind === 'history') ? 'Alarm History' : 'Active Alarms');
};

HmiAlarms.install = function()
{
	HmiAlarms.installShapes();
	HmiAlarms.installPalette();
};

// ---------------------------------------------------------- preview shapes

HmiAlarms.installShapes = function()
{
	function AlarmTableShape()
	{
		mxRectangleShape.call(this);
	}

	mxUtils.extend(AlarmTableShape, mxRectangleShape);

	AlarmTableShape.prototype.kind = 'list';

	AlarmTableShape.prototype.paintVertexShape = function(c, x, y, w, h)
	{
		var style = this.style || {};
		var fs = parseFloat(style[mxConstants.STYLE_FONTSIZE]) || 12;
		var cols = HmiAlarms.columnsOf(style, this.kind);
		var title = HmiAlarms.titleOf(style, this.kind);
		var rowH = fs * 1.8;
		var top = y;

		c.setFillColor('#ffffff');
		c.setStrokeColor('#607d8b');
		c.rect(x, y, w, h);
		c.fillAndStroke();

		c.setFontSize(fs);
		c.setFontFamily('Helvetica');

		if (title !== '')
		{
			c.setFillColor('#263238');
			c.rect(x, top, w, rowH);
			c.fill();
			c.setFontColor('#ffffff');
			c.setFontStyle(mxConstants.FONT_BOLD);
			c.text(x + 6, top + rowH / 2, 0, 0, title, mxConstants.ALIGN_LEFT, mxConstants.ALIGN_MIDDLE,
				false, '', null, false, 0, null);
			top += rowH;
		}

		// Column headings
		c.setFillColor('#cfd8dc');
		c.rect(x, top, w, rowH);
		c.fill();
		c.setFontColor('#263238');
		c.setFontStyle(mxConstants.FONT_BOLD);

		var colW = w / Math.max(1, cols.length);

		for (var i = 0; i < cols.length; i++)
		{
			c.text(x + i * colW + 4, top + rowH / 2, 0, 0, HmiAlarms.COLUMNS[cols[i]],
				mxConstants.ALIGN_LEFT, mxConstants.ALIGN_MIDDLE, false, '', null, false, 0, null);
		}

		top += rowH;

		// Sample rows, colored as they would be
		var samples = (this.kind === 'history') ? ['#fdecea', '#e8f5e9', '#e3f2fd'] :
			['#fdecea', '#fff8e1', '#eceff1'];
		c.setFontStyle(0);
		c.setFontColor('#90a4ae');

		for (var r = 0; top + rowH <= y + h && r < 12; r++)
		{
			c.setFillColor(samples[r % samples.length]);
			c.rect(x + 1, top, w - 2, rowH);
			c.fill();
			top += rowH;
		}
	};

	function AlarmListShape() { AlarmTableShape.call(this); }
	mxUtils.extend(AlarmListShape, AlarmTableShape);
	AlarmListShape.prototype.kind = 'list';

	function AlarmHistoryShape() { AlarmTableShape.call(this); }
	mxUtils.extend(AlarmHistoryShape, AlarmTableShape);
	AlarmHistoryShape.prototype.kind = 'history';

	mxCellRenderer.registerShape(HmiAlarms.LIST_SHAPE, AlarmListShape);
	mxCellRenderer.registerShape(HmiAlarms.HISTORY_SHAPE, AlarmHistoryShape);
};

// ----------------------------------------------------------------- palette

/** An HMI palette right after General, with the alarm objects. */
HmiAlarms.installPalette = function()
{
	var addGeneralPalette = Sidebar.prototype.addGeneralPalette;

	Sidebar.prototype.addGeneralPalette = function()
	{
		addGeneralPalette.apply(this, arguments);

		HmiLog.guard('alarms.palette', mxUtils.bind(this, function()
		{
			var sb = this;
			var base = 'html=1;fontSize=12;noLabel=1;';

			this.addPaletteFunctions('hmi', 'HMI', true, [
				this.createVertexTemplateEntry(base + 'shape=' + HmiAlarms.LIST_SHAPE + ';',
					480, 200, '', 'Alarm List', null, null, 'alarm list active alarms summary hmi'),
				this.createVertexTemplateEntry(base + 'shape=' + HmiAlarms.HISTORY_SHAPE + ';',
					560, 240, '', 'Alarm History', null, null, 'alarm history events log hmi')
			]);
		}));
	};
};

// ---------------------------------------------------------------- run view

/**
 * The live table for one Alarm List or Alarm History cell in a Run window:
 * an HTML overlay over the cell, following zoom and pan. The model is not
 * touched.
 */
HmiAlarmView = function(graph, cell, kind, alarms)
{
	this.graph = graph;
	this.cell = cell;
	this.kind = kind;
	this.alarms = alarms;
	this.style = graph.getCellStyle(cell);
	this.columns = HmiAlarms.columnsOf(this.style, kind);
	this.maxEvents = parseInt(this.style.hmiMaxEvents, 10) || HmiAlarms.DEFAULT_MAX_EVENTS;
	this.diskEvents = [];
};

HmiAlarmView.prototype.start = function()
{
	var that = this;

	this.node = document.createElement('div');
	this.node.className = 'hmiAlarmView hmiAlarmView-' + this.kind;
	this.node.setAttribute('data-hmi-alarm-view', this.kind);
	this.graph.container.appendChild(this.node);

	this.onView = function() { that.place(); };
	this.graph.view.addListener(mxEvent.SCALE, this.onView);
	this.graph.view.addListener(mxEvent.TRANSLATE, this.onView);
	this.graph.view.addListener(mxEvent.SCALE_AND_TRANSLATE, this.onView);

	this.onChange = function() { that.render(); };

	if (this.alarms != null)
	{
		this.alarms.on((this.kind === 'history') ? 'event' : 'change', this.onChange);

		if (this.kind === 'history')
		{
			HmiAlarms.loadRecent(this.alarms.options.store, this.maxEvents, function(events)
			{
				that.diskEvents = events;
				that.render();
			});
		}
	}

	this.place();
	this.render();
};

HmiAlarmView.prototype.stop = function()
{
	if (this.node == null)
	{
		return;
	}

	this.graph.view.removeListener(this.onView);

	if (this.alarms != null)
	{
		this.alarms.off('event', this.onChange);
		this.alarms.off('change', this.onChange);
	}

	if (this.node.parentNode != null)
	{
		this.node.parentNode.removeChild(this.node);
	}

	this.node = null;
};

HmiAlarmView.prototype.place = function()
{
	var state = this.graph.view.getState(this.cell);

	if (this.node == null || state == null)
	{
		return;
	}

	var s = this.node.style;
	s.left = Math.round(state.x) + 'px';
	s.top = Math.round(state.y) + 'px';
	s.width = Math.round(state.width) + 'px';
	s.height = Math.round(state.height) + 'px';
	s.fontSize = ((parseFloat(this.style[mxConstants.STYLE_FONTSIZE]) || 12) * this.graph.view.scale) + 'px';
};

HmiAlarmView.pad = function(n)
{
	return (n < 10 ? '0' : '') + n;
};

HmiAlarmView.formatTime = function(ms, withDate)
{
	if (!(ms > 0))
	{
		return '';
	}

	var d = new Date(ms);
	var p = HmiAlarmView.pad;
	var t = p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());

	return (withDate) ? d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + t : t;
};

HmiAlarmView.formatValue = function(v)
{
	var n = parseFloat(v);

	return (v === '' || v == null) ? '' : ((isNaN(n)) ? String(v) :
		String(Math.round(n * 1000) / 1000));
};

/** The rows shown: listed alarms, or events (newest first). */
HmiAlarmView.prototype.rows = function()
{
	if (this.alarms == null)
	{
		return [];
	}

	if (this.kind === 'list')
	{
		return this.alarms.active();
	}

	// Logged events, then those since that are not on disk yet
	var disk = this.diskEvents;
	var newest = (disk.length > 0) ? disk[0].time : 0;
	var live = this.alarms.history().filter(function(e) { return e.time > newest; });

	return live.concat(disk).slice(0, this.maxEvents);
};

HmiAlarmView.prototype.render = function()
{
	if (this.node == null)
	{
		return;
	}

	var that = this;
	var node = this.node;
	var title = HmiAlarms.titleOf(this.style, this.kind);
	node.innerHTML = '';

	var head = document.createElement('div');
	head.className = 'hmiAlarmHead';

	var label = document.createElement('span');
	label.className = 'hmiAlarmTitle';
	mxUtils.write(label, title);
	head.appendChild(label);

	if (this.kind === 'list' && this.alarms != null)
	{
		var c = this.alarms.counts();
		var counts = document.createElement('span');
		counts.className = 'hmiAlarmCounts';
		counts.setAttribute('data-hmi-field', 'counts');
		mxUtils.write(counts, c.active + ' active, ' + c.unacked + ' unacknowledged');
		head.appendChild(counts);

		var ackAll = document.createElement('button');
		ackAll.className = 'hmiAlarmAckAll';
		ackAll.setAttribute('data-hmi-field', 'ackAll');
		ackAll.disabled = c.unacked === 0;
		mxUtils.write(ackAll, 'Ack All');
		mxEvent.addListener(ackAll, 'click', function(evt)
		{
			mxEvent.consume(evt);
			that.alarms.ackAll();
		});
		head.appendChild(ackAll);
	}

	node.appendChild(head);

	var scroll = document.createElement('div');
	scroll.className = 'hmiAlarmScroll';

	var table = document.createElement('table');
	table.className = 'hmiAlarmTable';

	var tr = document.createElement('tr');

	for (var i = 0; i < this.columns.length; i++)
	{
		var th = document.createElement('th');
		mxUtils.write(th, HmiAlarms.COLUMNS[this.columns[i]]);
		tr.appendChild(th);
	}

	if (this.kind === 'list')
	{
		tr.appendChild(document.createElement('th'));
	}

	var thead = document.createElement('thead');
	thead.appendChild(tr);
	table.appendChild(thead);

	var tbody = document.createElement('tbody');
	var rows = this.rows();

	for (var r = 0; r < rows.length; r++)
	{
		tbody.appendChild((this.kind === 'list') ? this.listRow(rows[r]) : this.historyRow(rows[r]));
	}

	table.appendChild(tbody);
	scroll.appendChild(table);
	node.appendChild(scroll);

	if (rows.length === 0)
	{
		var empty = document.createElement('div');
		empty.className = 'hmiAlarmEmpty';
		mxUtils.write(empty, (this.kind === 'list') ? 'No active alarms' : 'No alarm events');
		node.appendChild(empty);
	}
};

HmiAlarmView.prototype.addCell = function(tr, text)
{
	var td = document.createElement('td');
	mxUtils.write(td, (text != null) ? String(text) : '');
	tr.appendChild(td);

	return td;
};

HmiAlarmView.prototype.listRow = function(rec)
{
	var that = this;
	var tag = this.alarms.project.getTag(rec.tag);
	var tr = document.createElement('tr');
	var state = (rec.active) ? ((rec.acked) ? 'acked' : 'unacked') : 'cleared';

	tr.className = 'hmiAlarmRow hmiAlarm-' + state +
		((rec.active && HmiAlarms.SEVERITY[rec.condition] > 1) ? ' hmiAlarm-severe' : '') +
		((rec.bad) ? ' hmiAlarm-bad' : '');
	tr.setAttribute('data-hmi-alarm', rec.tag);

	var values = {
		time: HmiAlarmView.formatTime(rec.alarmTime, false),
		tag: rec.tag,
		description: (tag != null && tag.comment) ? tag.comment : rec.tag,
		condition: HmiAlarms.CONDITIONS[rec.condition] || rec.condition,
		value: (rec.bad) ? '?' : HmiAlarmView.formatValue(rec.value) + ((tag != null && tag.engUnits) ? ' ' + tag.engUnits : ''),
		limit: HmiAlarmView.formatValue((tag != null) ? HmiAlarms.limitFor(tag, rec.condition) : ''),
		state: {acked: 'Acknowledged', unacked: 'Unacknowledged', cleared: 'Cleared, unacknowledged'}[state],
		event: ''
	};

	for (var i = 0; i < this.columns.length; i++)
	{
		this.addCell(tr, values[this.columns[i]]);
	}

	var td = document.createElement('td');

	if (!rec.acked)
	{
		var ack = document.createElement('button');
		ack.className = 'hmiAlarmAck';
		mxUtils.write(ack, 'Ack');
		mxEvent.addListener(ack, 'click', function(evt)
		{
			mxEvent.consume(evt);
			that.alarms.ack(rec.tag);
		});
		td.appendChild(ack);
	}

	tr.appendChild(td);

	return tr;
};

HmiAlarmView.prototype.historyRow = function(e)
{
	var tr = document.createElement('tr');
	tr.className = 'hmiAlarmRow hmiAlarmEvent-' + e.event;

	var values = {
		time: HmiAlarmView.formatTime(e.time, true),
		event: HmiAlarms.EVENT_LABELS[e.event] || e.event,
		tag: e.tag,
		description: e.description,
		condition: e.condition,
		value: HmiAlarmView.formatValue(e.value),
		limit: HmiAlarmView.formatValue(e.limit),
		state: ''
	};

	for (var i = 0; i < this.columns.length; i++)
	{
		this.addCell(tr, values[this.columns[i]]);
	}

	return tr;
};
