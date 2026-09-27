/**
 * The animation engine.
 *
 * Depends only on {graph, project, driver} -- never on EditorUi, Format or any
 * dialog -- so the standalone viewer can instantiate it unchanged.
 *
 * The invariant everything else rests on: THE RUNTIME NEVER TOUCHES THE MODEL.
 * No setValue, no setStyle, no setVisible. Animation is applied by decorating
 * graph.getCellStyle and repainting individual shapes, so undo stays clean and
 * the file is never marked modified by a value changing on a PLC.
 *
 * Two pieces of upstream behaviour dictate how the repaint works:
 *
 *  - mxShape.apply assigns `this.style = state.style`, the same object, so
 *    mxCellRenderer.redrawShape's change detector can never fire from mutating
 *    state.style. The shape must be pushed through resetStyles/configureShape/
 *    redraw explicitly.
 *  - mxGraphView.validateCellState and createState both reassign
 *    state.style = graph.getCellStyle(cell), so any direct mutation is wiped by
 *    zoom, pan or refresh. Decorating getCellStyle instead makes the override
 *    idempotent and revalidation-proof.
 */
HmiRuntime = function(config)
{
	this.graph = config.graph;
	this.project = config.project;
	this.driver = config.driver;

	this.running = false;
	this.bindings = {};
	this.reverseIndex = {};
	this.values = {};
	this.dirty = {};
	this.dirtyCount = 0;
	this.frame = null;
	this.blinkTimers = {};
	this.blinkPhase = {};
	this.repaintCount = 0;
};

// -------------------------------------------------------------- lifecycle

HmiRuntime.prototype.start = function()
{
	if (this.running)
	{
		return;
	}

	var graph = this.graph;

	graph.clearSelection();
	this.wasEnabled = graph.isEnabled();
	graph.setEnabled(false);

	this.installOverrides();
	this.bind();

	this.running = true;

	var that = this;

	this.onChange = function(batch) { that.applyBatch(batch); };
	this.driver.on('change', this.onChange);
	this.driver.connect();

	var paths = [];

	for (var name in this.reverseIndex)
	{
		paths.push(name);
	}

	this.driver.subscribe(paths, this.scanRateMs());

	this.installInput();
	this.startBlinkTimers();

	// One full repaint into the animated state.
	graph.refresh();
};

HmiRuntime.prototype.stop = function()
{
	if (!this.running)
	{
		return;
	}

	this.running = false;

	this.stopBlinkTimers();
	this.stopWhileDown();
	this.removeInput();

	if (this.onChange != null)
	{
		this.driver.off('change', this.onChange);
		this.onChange = null;
	}

	this.driver.unsubscribe();
	this.driver.disconnect();

	if (this.frame != null)
	{
		window.cancelAnimationFrame(this.frame);
		this.frame = null;
	}

	this.removeOverrides();

	this.bindings = {};
	this.reverseIndex = {};
	this.values = {};
	this.dirty = {};
	this.dirtyCount = 0;

	this.graph.setEnabled(this.wasEnabled);

	// Repaint from the pure model.
	this.graph.refresh();
};

/**
 * Rebinds to the cells currently on screen, after a page change.
 *
 * The subscription is reopened because a different page reads different tags,
 * and the driver sends a snapshot on subscribe, so the new page's objects have
 * values to render on their first frame rather than after their first change.
 */
HmiRuntime.prototype.rebind = function()
{
	if (!this.running)
	{
		return;
	}

	this.bind();

	var paths = [];

	for (var name in this.reverseIndex)
	{
		paths.push(name);
	}

	this.driver.unsubscribe();
	this.driver.subscribe(paths, this.scanRateMs());
	this.startBlinkTimers();
	this.graph.refresh();
};

/**
 * The rate the runtime asks for: the fastest device's scan rate. The driver
 * polls each device at its own rate (see HmiCommsDriver); this is what the
 * simulator and memory tags follow.
 */
HmiRuntime.prototype.scanRateMs = function()
{
	var rate = null;

	for (var i = 0; i < this.project.devices.length; i++)
	{
		var r = this.project.devices[i].scanMs;

		if (r > 0 && (rate == null || r < rate))
		{
			rate = r;
		}
	}

	return (rate != null) ? rate : 250;
};

// --------------------------------------------------------------- binding

HmiRuntime.prototype.bind = function()
{
	var graph = this.graph;
	var model = graph.getModel();
	var root = graph.getDefaultParent();

	this.bindings = {};
	this.reverseIndex = {};

	var cells = graph.getChildCells(root, true, true);

	// Nested cells inside groups animate too, so walk the whole subtree.
	var all = [];

	var walk = mxUtils.bind(this, function(parent)
	{
		var count = model.getChildCount(parent);

		for (var i = 0; i < count; i++)
		{
			var child = model.getChildAt(parent, i);
			all.push(child);
			walk(child);
		}
	});

	walk(root);

	for (var i = 0; i < all.length; i++)
	{
		var cell = all[i];
		var links = HmiProject.getCellLinks(graph, cell);
		var keys = Object.keys(links);

		if (keys.length === 0)
		{
			continue;
		}

		var binding = {cell: cell, links: links, visual: {}, deps: []};
		this.bindings[cell.id] = binding;

		for (var k = 0; k < keys.length; k++)
		{
			var deps = this.dependencies(links[keys[k]]);

			for (var d = 0; d < deps.length; d++)
			{
				if (mxUtils.indexOf(binding.deps, deps[d]) < 0)
				{
					binding.deps.push(deps[d]);
				}

				if (this.reverseIndex[deps[d]] == null)
				{
					this.reverseIndex[deps[d]] = [];
				}

				if (mxUtils.indexOf(this.reverseIndex[deps[d]], cell.id) < 0)
				{
					this.reverseIndex[deps[d]].push(cell.id);
				}
			}
		}

		this.markDirty(cell.id);
	}
};

/** Link config fields whose contents are expressions. */
HmiRuntime.EXPR_FIELDS = ['expr', 'enableExpr', 'min', 'max', 'rateMs'];

/**
 * Tag names a link config reads, taken from the compiled expressions rather
 * than pattern-matched out of the text, so a dependency cannot disagree with
 * what evaluation actually reads.
 */
HmiRuntime.prototype.dependencies = function(cfg)
{
	var deps = [];
	var that = this;

	function add(src)
	{
		if (src == null || src === '' || typeof src !== 'string')
		{
			return;
		}

		var found = HmiExpr.compile(src, {project: that.project}).deps;

		for (var i = 0; i < found.length; i++)
		{
			if (mxUtils.indexOf(deps, found[i]) < 0)
			{
				deps.push(found[i]);
			}
		}
	}

	for (var i = 0; i < HmiRuntime.EXPR_FIELDS.length; i++)
	{
		add(cfg[HmiRuntime.EXPR_FIELDS[i]]);
	}

	// A tag field holds a bare name, not an expression.
	if (cfg.tag != null && cfg.tag !== '' &&
		mxUtils.indexOf(deps, cfg.tag) < 0)
	{
		deps.push(cfg.tag);
	}

	if (cfg.bands != null)
	{
		for (var i = 0; i < cfg.bands.length; i++)
		{
			add(cfg.bands[i].max);
		}
	}

	return deps;
};

/** "Tag.Value" / "InTouch:Tag" -> "Tag"; anything else returns null. */
HmiRuntime.baseTag = function(src)
{
	var text = ('' + src).trim().replace(/^[Ii]n[Tt]ouch:/, '');
	var m = text.match(/^([A-Za-z_$][A-Za-z0-9_$]{0,62})(\.[A-Za-z]+)?$/);

	return (m != null) ? m[1] : null;
};

// ------------------------------------------------------------- evaluation

HmiRuntime.prototype.getValue = function(name)
{
	var v = this.values[('' + name).toLowerCase()];

	return (v != null) ? v :
		{value: null, quality: HmiTypes.QUALITY_BAD, timestamp: 0};
};

/**
 * Evaluates a source string through the expression engine.
 *
 * Compilation is cached by source and dictionary revision, so the hot path is
 * a tree walk, not a parse.
 */
HmiRuntime.prototype.evaluate = function(src)
{
	if (src == null || src === '')
	{
		return {value: null, quality: HmiTypes.QUALITY_BAD, timestamp: 0};
	}

	var compiled = HmiExpr.compile('' + src, {project: this.project});
	var result = compiled.eval(this.context());

	if (result.error != null)
	{
		HmiLog.once('expr:' + src, result.error + ' in "' + src + '"');
	}

	return result;
};

/** The evaluation context: how the engine reaches tag values. */
HmiRuntime.prototype.context = function()
{
	if (this.ctx == null)
	{
		var that = this;

		this.ctx = {
			read: function(name, field) { return that.readField(name, field); },
			write: function(name, value)
			{
				var writes = {};
				writes[name] = value;
				that.driver.write(writes);
			},
			now: function() { return Date.now(); }
		};
	}

	return this.ctx;
};

HmiRuntime.prototype.readField = function(name, field)
{
	var live = this.getValue(name);

	if (field == null || field === 'Value')
	{
		return live;
	}

	var tag = this.project.getTag(name);
	var good = {quality: HmiTypes.QUALITY_GOOD, timestamp: Date.now()};

	// Metadata reads are good quality even when the value itself is bad: they
	// describe the point, not its current reading.
	if (field === 'Quality')
	{
		return {value: live.quality, quality: good.quality, timestamp: good.timestamp};
	}

	if (field === 'TimeDate')
	{
		return {value: live.timestamp, quality: good.quality, timestamp: good.timestamp};
	}

	if (tag == null)
	{
		return {value: null, quality: HmiTypes.QUALITY_BAD, timestamp: 0};
	}

	// Alarm state is a later milestone; the fields answer false rather than
	// bad quality so an expression using them stays evaluable today.
	var map = {Name: tag.name, MinEU: tag.minEU, MaxEU: tag.maxEU,
		MinRaw: tag.minRaw, MaxRaw: tag.maxRaw, EngUnits: tag.engUnits,
		Comment: tag.comment, InAlarm: false, AlarmMostUrgentInAlarm: false,
		Acked: true};

	if (map[field] !== undefined)
	{
		return {value: map[field], quality: good.quality, timestamp: good.timestamp};
	}

	return {value: null, quality: HmiTypes.QUALITY_BAD, timestamp: 0};
};

HmiRuntime.truthy = function(value)
{
	if (value == null)
	{
		return false;
	}

	if (typeof value === 'string')
	{
		return value !== '' && value !== '0';
	}

	return !!value;
};

// ------------------------------------------------------------ value input

HmiRuntime.prototype.applyBatch = function(batch)
{
	for (var name in batch)
	{
		var key = name.toLowerCase();
		this.values[key] = batch[name];

		var cells = this.reverseIndex[name] || this.reverseIndex[key];

		if (cells != null)
		{
			for (var i = 0; i < cells.length; i++)
			{
				this.markDirty(cells[i]);
			}
		}
	}

	this.scheduleFlush();
};

HmiRuntime.prototype.markDirty = function(cellId)
{
	if (!this.dirty[cellId])
	{
		this.dirty[cellId] = true;
		this.dirtyCount++;
	}
};

/**
 * One animation frame for the whole application, not one per cell. A 250ms
 * scan is 4Hz; rAF coalesces bursts and caps repaints at display rate.
 */
HmiRuntime.prototype.scheduleFlush = function()
{
	if (this.frame != null || !this.running)
	{
		return;
	}

	var that = this;

	this.frame = window.requestAnimationFrame(function()
	{
		that.frame = null;
		that.flush();
	});
};

HmiRuntime.prototype.flush = function()
{
	if (!this.running)
	{
		return;
	}

	var ids = Object.keys(this.dirty);
	this.dirty = {};
	this.dirtyCount = 0;

	for (var i = 0; i < ids.length; i++)
	{
		var binding = this.bindings[ids[i]];

		if (binding != null)
		{
			this.update(binding);
		}
	}
};

/**
 * Recomputes a binding's visual outcome and repaints only if it changed.
 * Most tags move without crossing a colour band, so this diff removes the
 * great majority of DOM work.
 */
HmiRuntime.prototype.update = function(binding)
{
	var next = this.computeVisual(binding);

	if (HmiRuntime.sameVisual(binding.visual, next))
	{
		return;
	}

	binding.visual = next;
	this.repaint(binding.cell);
};

HmiRuntime.prototype.computeVisual = function(binding)
{
	var visual = {};
	var links = binding.links;

	for (var key in links)
	{
		var cfg = links[key];

		HmiLog.guard('link.' + key, mxUtils.bind(this, function()
		{
			this.applyLink(key, cfg, visual, binding);
		}));
	}

	return visual;
};

HmiRuntime.prototype.applyLink = function(key, cfg, visual, binding)
{
	if (key === 'fillColor.discrete' || key === 'lineColor.discrete' ||
		key === 'textColor.discrete')
	{
		var r = this.evaluate(cfg.expr);

		if (r.quality > HmiTypes.QUALITY_BAD)
		{
			visual[HmiRuntime.COLOR_TARGET[key]] =
				(HmiRuntime.truthy(r.value)) ? cfg.on : cfg.off;
		}
	}
	else if (key === 'fillColor.analog' || key === 'lineColor.analog' ||
		key === 'textColor.analog')
	{
		var color = this.pickBand(cfg);

		if (color != null)
		{
			visual[HmiRuntime.COLOR_TARGET[key]] = color;
		}
	}
	else if (key === 'fillColor.discreteAlarm' ||
		key === 'lineColor.discreteAlarm' || key === 'textColor.discreteAlarm')
	{
		var target = HmiRuntime.ALARM_TARGET[key];

		if (cfg.tag)
		{
			visual[target] = (this.inAlarm(cfg.tag)) ? cfg.on : cfg.off;
		}
	}
	else if (key === 'fillColor.analogAlarm' ||
		key === 'lineColor.analogAlarm' || key === 'textColor.analogAlarm')
	{
		var target = HmiRuntime.ALARM_TARGET[key];

		if (cfg.tag)
		{
			var band = this.alarmState(cfg.tag);

			if (band != null && cfg[band] != null)
			{
				visual[target] = cfg[band];
			}
		}
	}
	else if (key === 'visibility')
	{
		var r = this.evaluate(cfg.expr);
		var on = HmiRuntime.truthy(r.value);
		visual.visible = (cfg.sense === 'invisible') ? !on : on;
	}
	else if (key === 'blink')
	{
		this.applyBlink(cfg, visual);
	}
	else if (key === 'valueDisplay')
	{
		visual.label = this.formatValue(cfg);
	}
	else if (key === 'disable')
	{
		var r = this.evaluate(cfg.expr);
		visual.disabled = HmiRuntime.truthy(r.value);
	}
	else if (key === 'orientation')
	{
		var angle = this.mapValue(cfg, 'angleMin', 'angleMax', 0, 360);

		if (angle != null)
		{
			// InTouch counts clockwise from the design orientation, and so
			// does mxGraph's rotation style, so no sign flip is needed.
			visual.rotation = angle;

			// mxGraph turns a shape about its own centre. About any other
			// point the centre also travels round that point, so the shape
			// is moved by o - R(angle)o, o being the point's offset from the
			// centre (screen axes, y down, clockwise).
			var o = HmiRuntime.pivotOffset(cfg);

			if (o != null)
			{
				var a = angle * Math.PI / 180;
				var cos = Math.cos(a);
				var sin = Math.sin(a);

				visual.rotDx = o.x - (o.x * cos - o.y * sin);
				visual.rotDy = o.y - (o.x * sin + o.y * cos);
			}
		}
	}
	else if (key === 'location.horizontal' || key === 'location.vertical')
	{
		var offset = this.mapValue(cfg, 'offsetMin', 'offsetMax', 0, 100);

		if (offset != null)
		{
			if (key === 'location.horizontal') { visual.dx = offset; }
			else { visual.dy = offset; }
		}
	}
	else if (key === 'size.width' || key === 'size.height')
	{
		var pct = this.mapValue(cfg, 'pctMin', 'pctMax', 0, 100);

		if (pct != null)
		{
			// Percent of the design size, as InTouch expresses it.
			if (key === 'size.width')
			{
				visual.scaleX = pct / 100;
				visual.anchorX = cfg.anchor || 'left';
			}
			else
			{
				visual.scaleY = pct / 100;
				visual.anchorY = cfg.anchor || 'top';
			}
		}
	}
	else if (key === 'percentFill.horizontal' || key === 'percentFill.vertical')
	{
		var pct = this.mapValue(cfg, 'pctMin', 'pctMax', 0, 100);

		if (pct != null)
		{
			visual.fillPct = pct;
			visual.fillDir = (key === 'percentFill.horizontal') ? 'h' : 'v';
		}
	}
	else if (key === 'slider.horizontal' || key === 'slider.vertical')
	{
		// Sliders are input only; their visual position comes from the tag,
		// which the author expresses with a Location or Percent Fill link.
	}
};

/**
 * The centre of rotation of an Orientation link as an offset from the object's
 * centre, in diagram units, or null for the object's own centre. Stored as an
 * offset (pivotDx, pivotDy), so the point moves with the object when it is
 * moved in the editor or by a Location link.
 */
HmiRuntime.pivotOffset = function(cfg)
{
	if (cfg == null || cfg.pivot !== 'point')
	{
		return null;
	}

	var x = parseFloat(cfg.pivotDx);
	var y = parseFloat(cfg.pivotDy);

	x = isNaN(x) ? 0 : x;
	y = isNaN(y) ? 0 : y;

	return (x === 0 && y === 0) ? null : {x: x, y: y};
};

/**
 * Maps the link's driving value from its input range onto an output range,
 * clamped at both ends.
 *
 * Every one of the six bounds is an expression, so a range can track the
 * dictionary -- AtMax of Tank_Level.MaxEU keeps a bargraph correct when the
 * engineering range is edited.
 */
HmiRuntime.prototype.mapValue = function(cfg, outMinKey, outMaxKey,
	outMinDefault, outMaxDefault)
{
	var r = this.evaluate(cfg.expr);

	if (r.quality <= HmiTypes.QUALITY_BAD)
	{
		return null;
	}

	var value = parseFloat(r.value);

	if (isNaN(value))
	{
		return null;
	}

	var lo = this.number(cfg.atMin, 0);
	var hi = this.number(cfg.atMax, 100);
	var a = this.number(cfg[outMinKey], outMinDefault);
	var b = this.number(cfg[outMaxKey], outMaxDefault);

	if (hi === lo)
	{
		return a;
	}

	var t = (value - lo) / (hi - lo);
	t = Math.max(0, Math.min(1, t));

	return a + (b - a) * t;
};

/** Evaluates an expression to a number, falling back when it cannot. */
HmiRuntime.prototype.number = function(src, fallback)
{
	if (src == null || src === '')
	{
		return fallback;
	}

	var r = this.evaluate(src);
	var n = parseFloat(r.value);

	return (isNaN(n)) ? fallback : n;
};

HmiRuntime.ALARM_TARGET = {
	'fillColor.discreteAlarm': 'fillColor', 'fillColor.analogAlarm': 'fillColor',
	'lineColor.discreteAlarm': 'strokeColor', 'lineColor.analogAlarm': 'strokeColor',
	'textColor.discreteAlarm': 'fontColor', 'textColor.analogAlarm': 'fontColor'
};

/**
 * Alarm state from the tag's own limits in the dictionary, so a limit edited
 * once is honoured by every link that colours on it.
 */
HmiRuntime.prototype.alarmState = function(name)
{
	var tag = this.project.getTag(name);
	var live = this.getValue(name);

	if (tag == null || live.quality <= HmiTypes.QUALITY_BAD)
	{
		return null;
	}

	var limits = tag.alarms;
	var value = parseFloat(live.value);

	if (limits == null || isNaN(value))
	{
		return 'normal';
	}

	// Checked outermost first, so overlapping limits resolve to the most
	// urgent rather than to whichever was tested first.
	if (limits.hiHi != null && value >= limits.hiHi) { return 'hiHi'; }
	if (limits.loLo != null && value <= limits.loLo) { return 'loLo'; }
	if (limits.high != null && value >= limits.high) { return 'high'; }
	if (limits.low != null && value <= limits.low) { return 'low'; }

	return 'normal';
};

HmiRuntime.prototype.inAlarm = function(name)
{
	var tag = this.project.getTag(name);

	if (tag != null && HmiTypes.isDiscrete(tag.type))
	{
		var live = this.getValue(name);

		return live.quality > HmiTypes.QUALITY_BAD &&
			HmiRuntime.truthy(live.value);
	}

	var state = this.alarmState(name);

	return state != null && state !== 'normal';
};

HmiRuntime.COLOR_TARGET = {
	'fillColor.discrete': 'fillColor', 'fillColor.analog': 'fillColor',
	'lineColor.discrete': 'strokeColor', 'lineColor.analog': 'strokeColor',
	'textColor.discrete': 'fontColor', 'textColor.analog': 'fontColor'
};

/**
 * First band whose upper bound the value is below wins; the terminal band has
 * a null bound and always matches. Array length is the band count, so unlike
 * InTouch's fixed ten-slot array there is no ambiguity between a configured
 * black band and an unused slot.
 */
HmiRuntime.prototype.pickBand = function(cfg)
{
	var r = this.evaluate(cfg.expr);

	if (r.quality <= HmiTypes.QUALITY_BAD || cfg.bands == null)
	{
		return null;
	}

	var value = parseFloat(r.value);

	if (isNaN(value))
	{
		return null;
	}

	for (var i = 0; i < cfg.bands.length; i++)
	{
		var band = cfg.bands[i];

		if (band.max == null || band.max === '')
		{
			return band.color;
		}

		var bound = this.evaluate(band.max);
		var limit = parseFloat(bound.value);

		if (!isNaN(limit) && value < limit)
		{
			return band.color;
		}
	}

	return null;
};

HmiRuntime.prototype.applyBlink = function(cfg, visual)
{
	var r = this.evaluate(cfg.expr);

	if (!HmiRuntime.truthy(r.value))
	{
		return;
	}

	var rate = this.blinkRate(cfg);

	if (!this.blinkPhase[rate])
	{
		return;
	}

	var attrs = cfg.attrs || [];

	for (var i = 0; i < attrs.length; i++)
	{
		if (attrs[i] === 'fill')
		{
			visual.fillColor = (cfg.blank) ? 'none' : cfg.fill;
		}
		else if (attrs[i] === 'line')
		{
			visual.strokeColor = (cfg.blank) ? 'none' : cfg.line;
		}
		else if (attrs[i] === 'text')
		{
			visual.fontColor = (cfg.blank) ? 'none' : cfg.text;
		}
	}
};

HmiRuntime.prototype.blinkRate = function(cfg)
{
	var r = this.evaluate(cfg.rateMs);
	var rate = parseFloat((r.value != null) ? r.value : cfg.rateMs);

	return (!isNaN(rate) && rate >= 50) ? Math.round(rate) : 500;
};

HmiRuntime.prototype.formatValue = function(cfg)
{
	var r = this.evaluate(cfg.expr);

	if (r.quality <= HmiTypes.QUALITY_BAD)
	{
		return '####';
	}

	var text;

	if (cfg.kind === 'discrete')
	{
		// The link's own text wins, then the tag's messages, then a plain
		// default. The link has to be able to override: the expression need
		// not be a bare tag at all -- "Level > 50" has no messages to borrow --
		// and one bit can read Open/Closed on one object and Running/Stopped
		// on another.
		var tag = this.project.getTag(HmiRuntime.baseTag(cfg.expr));
		var on = (cfg.onText) ? cfg.onText :
			((tag != null && tag.onMsg) ? tag.onMsg : 'On');
		var off = (cfg.offText) ? cfg.offText :
			((tag != null && tag.offMsg) ? tag.offMsg : 'Off');

		text = (HmiRuntime.truthy(r.value)) ? on : off;
	}
	else if (cfg.kind === 'string')
	{
		text = (r.value != null) ? '' + r.value : '';
	}
	else
	{
		text = HmiRuntime.formatNumber(r.value, cfg.format);
	}

	return (cfg.prefix || '') + text + (cfg.suffix || '');
};

/** InTouch-style picture formats: the count of digits after the point wins. */
HmiRuntime.formatNumber = function(value, format)
{
	var n = parseFloat(value);

	if (isNaN(n))
	{
		return '####';
	}

	if (format == null || format === '')
	{
		return '' + n;
	}

	var dot = format.indexOf('.');
	var decimals = (dot >= 0) ? format.length - dot - 1 : 0;
	var text = n.toFixed(decimals);

	// Leading-zero padding, as "000" implies.
	var intDigits = (dot >= 0) ? dot : format.length;
	var parts = text.split('.');
	var sign = '';

	if (parts[0].charAt(0) === '-')
	{
		sign = '-';
		parts[0] = parts[0].substring(1);
	}

	while (parts[0].length < intDigits)
	{
		parts[0] = '0' + parts[0];
	}

	return sign + parts.join('.');
};

HmiRuntime.sameVisual = function(a, b)
{
	var keys = ['fillColor', 'strokeColor', 'fontColor', 'visible', 'label',
		'rotation', 'rotDx', 'rotDy', 'dx', 'dy', 'scaleX', 'scaleY', 'anchorX', 'anchorY',
		'fillPct', 'fillDir', 'disabled'];

	for (var i = 0; i < keys.length; i++)
	{
		if (a[keys[i]] !== b[keys[i]])
		{
			return false;
		}
	}

	return true;
};

// ------------------------------------------------------------- rendering

HmiRuntime.prototype.installOverrides = function()
{
	var that = this;
	var graph = this.graph;

	this.origGetCellStyle = graph.getCellStyle;

	// mxGraph.getCellStyle always returns a fresh object (it clones the
	// default style when the cell has no style string), so mutating the
	// result is safe and cannot tint other cells sharing a style name.
	graph.getCellStyle = function(cell, resolve)
	{
		var style = that.origGetCellStyle.apply(this, arguments);

		return (that.running && cell != null) ?
			that.decorateStyle(cell, style) : style;
	};

	this.origGetLabel = graph.getLabel;

	// cell is not always present: upstream calls getLabel from several places
	// (tooltips, label bounds) where it may be undefined, so guard rather than
	// assume, or the override throws inside a render path.
	graph.getLabel = function(cell)
	{
		if (that.running && cell != null)
		{
			var binding = that.bindings[cell.id];

			if (binding != null && binding.visual.label != null)
			{
				return binding.visual.label;
			}
		}

		return that.origGetLabel.apply(this, arguments);
	};

	// Visibility cannot ride on the style the way colour does -- there is no
	// style key for it, and mxShape.redraw writes node.style.visibility from
	// its own `visible` flag. Applying it only in repaint() is not enough:
	// zoom, pan and refresh rebuild the shape node, and because the visual
	// itself has not changed the diff correctly skips a repaint, so nothing
	// reapplies it. Hooking validateCellState makes it idempotent and
	// revalidation-proof, exactly as decorating getCellStyle does for colour.
	// Location and Size are not style, they are geometry. updateCellState is
	// where the view computes a cell's bounds, and validateCellState redraws
	// immediately afterwards -- so adjusting the bounds here lands in the very
	// next paint and, because it runs on every validation, survives zoom, pan
	// and refresh for free. The model is never touched.
	this.origUpdateCellState = graph.view.updateCellState;

	graph.view.updateCellState = function(state)
	{
		that.origUpdateCellState.apply(this, arguments);

		if (that.running && state != null)
		{
			that.applyGeometry(state);
		}
	};

	this.origValidateCellState = graph.view.validateCellState;

	graph.view.validateCellState = function(cell, recurse)
	{
		var state = that.origValidateCellState.apply(this, arguments);

		if (that.running && state != null)
		{
			that.applyVisibility(cell, state);
			that.applyFill(cell, state);
		}

		return state;
	};
};

HmiRuntime.prototype.removeOverrides = function()
{
	if (this.origGetCellStyle != null)
	{
		this.graph.getCellStyle = this.origGetCellStyle;
		this.origGetCellStyle = null;
	}

	if (this.origGetLabel != null)
	{
		this.graph.getLabel = this.origGetLabel;
		this.origGetLabel = null;
	}

	if (this.origValidateCellState != null)
	{
		this.graph.view.validateCellState = this.origValidateCellState;
		this.origValidateCellState = null;
	}

	if (this.origUpdateCellState != null)
	{
		this.graph.view.updateCellState = this.origUpdateCellState;
		this.origUpdateCellState = null;
	}

	HmiRuntime.clearClips(this.graph);
};

HmiRuntime.prototype.decorateStyle = function(cell, style)
{
	var binding = this.bindings[cell.id];

	if (binding == null)
	{
		return style;
	}

	var v = binding.visual;

	if (v.fillColor != null) { style[mxConstants.STYLE_FILLCOLOR] = v.fillColor; }
	if (v.strokeColor != null) { style[mxConstants.STYLE_STROKECOLOR] = v.strokeColor; }
	if (v.fontColor != null) { style[mxConstants.STYLE_FONTCOLOR] = v.fontColor; }

	// Rotation is a style key, so orientation needs no separate mechanism.
	if (v.rotation != null) { style[mxConstants.STYLE_ROTATION] = v.rotation; }

	return style;
};

/**
 * Targeted repaint of one cell: O(1) DOM work, no view revalidation, no
 * layout. Runs the same three calls mxCellRenderer.redrawShape runs in its
 * force branch, because mxShape.apply aliases state.style and so the renderer's
 * own change detector cannot see a mutation.
 */
HmiRuntime.prototype.repaint = function(cell)
{
	var state = this.graph.view.getState(cell);

	// Null for cells that are off-screen or on another page.
	if (state == null || state.shape == null)
	{
		return;
	}

	// Geometry cannot be corrected in place: applyGeometry adds offsets to the
	// bounds the view computed, so applying it to an already-adjusted state
	// would accumulate. Instead the state is invalidated and revalidated,
	// which recomputes the design bounds and re-applies the offset exactly
	// once. Targeted at the one cell, so it stays O(1).
	if (this.hasGeometry(cell))
	{
		this.graph.view.invalidate(cell, false, false);
		this.graph.view.validateCellState(cell, false);

		state = this.graph.view.getState(cell);

		if (state == null || state.shape == null)
		{
			return;
		}

		// Revalidating keeps the old style, so colour and rotation are
		// applied below as for any other change (Orientation about a point
		// changes both geometry and rotation)
	}

	this.decorateStyle(cell, state.style);

	state.shape.resetStyles();
	this.graph.cellRenderer.configureShape(state);
	state.shape.redraw();

	// redrawLabel rather than poking state.text: a shape drawn without a label
	// has no text shape at all, so a Value Display link on it would render
	// nothing. redrawLabel reads through graph.getLabel -- which this runtime
	// decorates -- and creates the text shape when there is now a value.
	this.graph.cellRenderer.redrawLabel(state, true);

	this.applyVisibility(cell, state);
	this.applyFill(cell, state);
	this.repaintCount++;
};

/**
 * Applies Location and Size to a cell's computed bounds.
 *
 * Runs inside updateCellState, before the shape is drawn, so the displacement
 * is part of the normal paint rather than a correction applied afterwards.
 * The model keeps its design-time geometry throughout.
 */
/** True when a binding displaces or resizes its cell. */
HmiRuntime.prototype.hasGeometry = function(cell)
{
	var binding = this.bindings[cell.id];

	if (binding == null)
	{
		return false;
	}

	var v = binding.visual;

	return v.dx != null || v.dy != null || v.scaleX != null || v.scaleY != null ||
		v.rotDx != null || v.rotDy != null;
};

HmiRuntime.prototype.applyGeometry = function(state)
{
	var binding = (state.cell != null) ? this.bindings[state.cell.id] : null;

	if (binding == null)
	{
		return;
	}

	var v = binding.visual;
	var scale = this.graph.view.scale;

	// Size scales about the chosen edge. state.width/height still hold the
	// design size at this point, so the opposite edge is held still by moving
	// the origin by whatever the object lost.
	if (v.scaleX != null)
	{
		var w0 = state.width;
		state.width = w0 * v.scaleX;

		if (v.anchorX === 'right') { state.x += (w0 - state.width); }
		else if (v.anchorX === 'center') { state.x += (w0 - state.width) / 2; }
	}

	if (v.scaleY != null)
	{
		var h0 = state.height;
		state.height = h0 * v.scaleY;

		if (v.anchorY === 'bottom') { state.y += (h0 - state.height); }
		else if (v.anchorY === 'center') { state.y += (h0 - state.height) / 2; }
	}

	// Offsets are authored in diagram units, so they follow the zoom.
	if (v.dx != null)
	{
		state.x += v.dx * scale;
	}

	if (v.dy != null)
	{
		state.y += v.dy * scale;
	}

	// Orientation about a point other than the centre (see applyLink)
	if (v.rotDx != null)
	{
		state.x += v.rotDx * scale;
		state.y += v.rotDy * scale;
	}
};

// ------------------------------------------------------------- percent fill

/**
 * Percent fill, via an SVG clip path on the shape node.
 *
 * drawio has no partial-fill primitive. A clip keeps the object's own shape --
 * a tank outline stays a tank outline as it fills -- which an overlaid
 * rectangle would not. objectBoundingBox units are used so the clip needs no
 * knowledge of the cell's position, size or the current zoom, and therefore
 * survives pan and zoom without recomputation.
 */
HmiRuntime.prototype.applyFill = function(cell, state)
{
	var binding = this.bindings[cell.id];

	if (binding == null || state.shape == null || state.shape.node == null)
	{
		return;
	}

	var pct = binding.visual.fillPct;

	if (pct == null)
	{
		if (state.shape.node.getAttribute('clip-path') != null)
		{
			state.shape.node.removeAttribute('clip-path');
		}

		return;
	}

	var dir = binding.visual.fillDir || 'v';
	var f = Math.max(0, Math.min(1, pct / 100));
	var id = 'hmiClip-' + cell.id;
	var defs = HmiRuntime.clipDefs(this.graph);

	if (defs == null)
	{
		return;
	}

	var clip = document.getElementById(id);

	if (clip == null)
	{
		clip = document.createElementNS(mxConstants.NS_SVG, 'clipPath');
		clip.setAttribute('id', id);
		clip.setAttribute('clipPathUnits', 'objectBoundingBox');
		clip.appendChild(document.createElementNS(mxConstants.NS_SVG, 'rect'));
		defs.appendChild(clip);
	}

	var rect = clip.firstChild;

	// Horizontal fills from the left, vertical from the bottom -- a tank
	// fills upwards, which is the only reading anyone expects.
	if (dir === 'h')
	{
		rect.setAttribute('x', 0);
		rect.setAttribute('y', 0);
		rect.setAttribute('width', (f > 0) ? f : 0.0001);
		rect.setAttribute('height', 1);
	}
	else
	{
		rect.setAttribute('x', 0);
		rect.setAttribute('y', 1 - f);
		rect.setAttribute('width', 1);
		rect.setAttribute('height', (f > 0) ? f : 0.0001);
	}

	state.shape.node.setAttribute('clip-path', 'url(#' + id + ')');
};

HmiRuntime.clipDefs = function(graph)
{
	var canvas = (graph.view != null) ? graph.view.getCanvas() : null;

	if (canvas == null)
	{
		return null;
	}

	var svg = canvas.ownerSVGElement || canvas;
	var defs = svg.getElementsByTagName('defs')[0];

	if (defs == null)
	{
		defs = document.createElementNS(mxConstants.NS_SVG, 'defs');
		svg.insertBefore(defs, svg.firstChild);
	}

	return defs;
};

/** Drops every clip path this runtime created, on stop. */
HmiRuntime.clearClips = function(graph)
{
	var defs = HmiRuntime.clipDefs(graph);

	if (defs == null)
	{
		return;
	}

	var clips = defs.getElementsByTagName('clipPath');

	for (var i = clips.length - 1; i >= 0; i--)
	{
		if (('' + clips[i].getAttribute('id')).indexOf('hmiClip-') === 0)
		{
			defs.removeChild(clips[i]);
		}
	}
};

/**
 * mxShape.redraw sets node.style.visibility from this.visible, so setting the
 * DOM alone is clobbered by the next redraw. Both are set, and
 * visibility:hidden is used rather than display:none because it preserves
 * layout and hit-testing and is what mxShape itself uses.
 */
HmiRuntime.prototype.applyVisibility = function(cell, state)
{
	var binding = this.bindings[cell.id];
	var visible = (binding == null || binding.visual.visible !== false);

	if (state.shape != null)
	{
		state.shape.visible = visible;

		if (state.shape.node != null)
		{
			state.shape.node.style.visibility = (visible) ? '' : 'hidden';
		}
	}

	if (state.text != null && state.text.node != null)
	{
		state.text.node.style.visibility = (visible) ? '' : 'hidden';
	}
};

// ---------------------------------------------------------------- blink

/**
 * One timer per distinct rate for the whole application. InTouch offers three
 * speeds, so this is at most three timers however many cells blink.
 */
HmiRuntime.prototype.startBlinkTimers = function()
{
	// Rebinding calls this again, so clear before arming or a page change
	// would leave the old page's timers running.
	this.stopBlinkTimers();

	var rates = {};

	for (var id in this.bindings)
	{
		var cfg = this.bindings[id].links['blink'];

		if (cfg != null)
		{
			rates[this.blinkRate(cfg)] = true;
		}
	}

	for (var rate in rates)
	{
		this.startBlinkTimer(parseInt(rate, 10));
	}
};

HmiRuntime.prototype.startBlinkTimer = function(rate)
{
	var that = this;
	this.blinkPhase[rate] = false;

	this.blinkTimers[rate] = window.setInterval(function()
	{
		that.blinkPhase[rate] = !that.blinkPhase[rate];

		for (var id in that.bindings)
		{
			var cfg = that.bindings[id].links['blink'];

			if (cfg != null && that.blinkRate(cfg) === rate)
			{
				that.markDirty(id);
			}
		}

		that.scheduleFlush();
	}, rate);
};

HmiRuntime.prototype.stopBlinkTimers = function()
{
	for (var rate in this.blinkTimers)
	{
		window.clearInterval(this.blinkTimers[rate]);
	}

	this.blinkTimers = {};
	this.blinkPhase = {};
};

// ---------------------------------------------------------------- input

/**
 * Touch input.
 *
 * Deliberately NOT built on mxEvent.CLICK. Stock mxGraph.click fires that
 * event before its isEnabled() guard, which would have been ideal here, but
 * Graph.prototype.addClickHandler replaces the method outright:
 *
 *   // Ignores built-in click handling
 *   graph.click = function(me) {};
 *
 * so in drawio no mouse gesture ever produces a CLICK event. A listener on it
 * looks correct, tests green against a hand-fired event, and never once fires
 * in the running application.
 *
 * Mouse listeners are dispatched normally with the graph disabled, so the
 * click is derived here: a press and release on the same cell. Listeners are
 * added on start and removed on stop, so edit mode is untouched.
 */
HmiRuntime.prototype.installInput = function()
{
	var that = this;

	this.mouseListener = {
		mouseDown: function(sender, me)
		{
			var cell = me.getCell();
			that.downCell = cell;
			that.downAt = {x: me.getGraphX(), y: me.getGraphY()};

			if (cell != null)
			{
				that.beginDrag(cell, me);
				that.handleTouch(cell, 'down');
			}
		},
		mouseMove: function(sender, me) { that.handleDrag(me); },
		mouseUp: function(sender, me)
		{
			var cell = me.getCell();

			if (cell != null)
			{
				that.handleTouch(cell, 'up');

				// Released on the cell it was pressed on: that is a click.
				if (cell === that.downCell)
				{
					that.handleTouch(cell, 'click');
				}
			}

			that.downCell = null;
			that.stopWhileDown();
		}
	};

	this.graph.addMouseListener(this.mouseListener);
};

HmiRuntime.prototype.removeInput = function()
{
	if (this.mouseListener != null)
	{
		this.graph.removeMouseListener(this.mouseListener);
		this.mouseListener = null;
	}

	this.downCell = null;
};

HmiRuntime.prototype.handleTouch = function(cell, phase)
{
	var binding = this.bindings[cell.id];

	if (binding == null)
	{
		return;
	}

	// Hidden or disabled objects are not touchable, as in InTouch.
	if (binding.visual.visible === false || binding.visual.disabled === true)
	{
		return;
	}

	var push = binding.links['pushbutton'];

	if (push != null && push.tag)
	{
		if (push.enableExpr)
		{
			var en = this.evaluate(push.enableExpr);

			if (!HmiRuntime.truthy(en.value))
			{
				return;
			}
		}

		var momentary = (push.action === 'direct');

		if (momentary && (phase === 'down' || phase === 'up'))
		{
			this.driver.write(mxUtils.bind(this, function()
			{
				var w = {};
				w[push.tag] = (phase === 'down') ? 1 : 0;

				return w;
			})());
		}
		else if (!momentary && phase === 'click')
		{
			var current = this.getValue(push.tag).value;
			var next = (push.action === 'set') ? 1 :
				((push.action === 'reset') ? 0 :
					(HmiRuntime.truthy(current) ? 0 : 1));
			var w = {};
			w[push.tag] = next;
			this.driver.write(w);
		}
	}

	var input = binding.links['userInput'];

	if (input != null && input.tag && phase === 'click' &&
		this.onUserInput != null)
	{
		this.onUserInput(input, binding);
	}

	// Window navigation. The runtime stays ignorant of pages and dialogs; the
	// host injects a handler, exactly as it does for user input.
	if (phase === 'click' && this.onWindow != null)
	{
		var show = binding.links['showWindow'];
		var hide = binding.links['hideWindow'];

		if (show != null && show.window && this.enabled(show))
		{
			this.onWindow('show', show.window);
		}

		if (hide != null && hide.window && this.enabled(hide))
		{
			this.onWindow('hide', hide.window);
		}
	}

	// Action scripts.
	var action = binding.links['pushbutton.action'];

	if (action != null)
	{
		if (phase === 'down')
		{
			this.runScript(action.onDown);
			this.startWhileDown(cell, action);
		}
		else if (phase === 'up')
		{
			this.stopWhileDown();
			this.runScript(action.onUp);
		}
	}
};

/** True when a link has no enable expression, or it evaluates true. */
HmiRuntime.prototype.enabled = function(cfg)
{
	if (cfg.enableExpr == null || cfg.enableExpr === '')
	{
		return true;
	}

	return HmiRuntime.truthy(this.evaluate(cfg.enableExpr).value);
};

HmiRuntime.prototype.runScript = function(src)
{
	if (src == null || src === '')
	{
		return;
	}

	var compiled = HmiExpr.compile('' + src,
		{project: this.project, mode: 'script'});

	if (compiled.errors.length > 0)
	{
		HmiLog.once('script:' + src, compiled.errors[0].message);

		return;
	}

	var res = compiled.eval(this.context());

	if (res.error != null)
	{
		HmiLog.once('script:' + src, res.error);
	}
};

HmiRuntime.prototype.startWhileDown = function(cell, action)
{
	this.stopWhileDown();

	if (action.whileDown == null || action.whileDown === '')
	{
		return;
	}

	var rate = this.number(action.everyMs, 1000);
	var that = this;

	this.whileDownTimer = window.setInterval(function()
	{
		that.runScript(action.whileDown);
	}, Math.max(50, rate));
};

HmiRuntime.prototype.stopWhileDown = function()
{
	if (this.whileDownTimer != null)
	{
		window.clearInterval(this.whileDownTimer);
		this.whileDownTimer = null;
	}
};

/**
 * Slider dragging.
 *
 * Travel is measured in diagram units from where the press landed, mapped back
 * onto the tag's value range -- the same mapping the movement links use, run
 * in reverse.
 */
HmiRuntime.prototype.handleDrag = function(me)
{
	if (this.downCell == null)
	{
		return;
	}

	var binding = this.bindings[this.downCell.id];

	if (binding == null || binding.visual.disabled === true)
	{
		return;
	}

	var cfg = binding.links['slider.horizontal'] ||
		binding.links['slider.vertical'];

	if (cfg == null || !cfg.tag)
	{
		return;
	}

	var horizontal = (binding.links['slider.horizontal'] != null);
	var scale = this.graph.view.scale;
	var moved = (horizontal) ?
		(me.getGraphX() - this.downAt.x) : (me.getGraphY() - this.downAt.y);
	moved = moved / scale;

	var t1 = this.number(cfg.travelMin, 0);
	var t2 = this.number(cfg.travelMax, 100);
	var v1 = this.number(cfg.atMin, 0);
	var v2 = this.number(cfg.atMax, 100);

	if (t2 === t1)
	{
		return;
	}

	// Screen y grows downwards, so a vertical slider counts travel upwards.
	var travel = this.dragBase + ((horizontal) ? moved : -moved);
	var f = (travel - t1) / (t2 - t1);
	f = Math.max(0, Math.min(1, f));

	var value = v1 + (v2 - v1) * f;
	var writes = {};
	writes[cfg.tag] = value;
	this.driver.write(writes);
};

/** Where the slider's travel stood when the press landed. */
HmiRuntime.prototype.beginDrag = function(cell, me)
{
	var binding = this.bindings[cell.id];

	if (binding == null)
	{
		return;
	}

	var cfg = binding.links['slider.horizontal'] ||
		binding.links['slider.vertical'];

	if (cfg == null || !cfg.tag)
	{
		return;
	}

	var v1 = this.number(cfg.atMin, 0);
	var v2 = this.number(cfg.atMax, 100);
	var t1 = this.number(cfg.travelMin, 0);
	var t2 = this.number(cfg.travelMax, 100);
	var current = parseFloat(this.getValue(cfg.tag).value);

	if (isNaN(current) || v2 === v1)
	{
		this.dragBase = t1;

		return;
	}

	var f = Math.max(0, Math.min(1, (current - v1) / (v2 - v1)));
	this.dragBase = t1 + (t2 - t1) * f;
	this.downAt = {x: me.getGraphX(), y: me.getGraphY()};
};
