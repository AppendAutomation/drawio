/**
 * Trends: the Trend object (shape=hmiTrend) plots tag values over time at
 * Run. Its settings are the hidden trend link:
 *   name       the logical name scripts use, unique in the project
 *   title      heading ('' for none)
 *   spanSec    the time shown
 *   sampleMs   how often its pens are sampled
 *   refreshMs  how often the picture is redrawn
 *   gridColor  the grid
 *   pens       [{tag, min, max, color}]; min and max '' for the tag's range
 * The rest are the cell's own style: fillColor (background), strokeColor
 * (border), strokeWidth (pen lines), fontFamily, fontSize and fontColor
 * (axis labels).
 *
 * One HmiTrendManager per Run samples every pen of every trend from the
 * start, whether or not a window shows it, keeps the last day in memory and
 * writes the history to disk (src/main/trends/TrendLog.js). Each trend's
 * selected pen and paused or scrolled position belong to its name, so they
 * hold for every window showing it. The trend has no buttons of its own:
 * scripts move it with TrendSetPen, TrendPause, TrendPlay, TrendScrollBack
 * and TrendScrollForward.
 */
HmiTrend = {};

HmiTrend.SHAPE = 'hmiTrend';
HmiTrend.STYLE = 'html=1;noLabel=1;shape=hmiTrend;fontSize=11;fillColor=#ffffff;strokeColor=#607d8b;' +
	'strokeWidth=1;fontColor=#333333;';
HmiTrend.LINK = 'trend';

HmiTrend.FUNCTIONS = ['TrendSetPen', 'TrendPause', 'TrendPlay', 'TrendScrollBack', 'TrendScrollForward'];

HmiTrend.MAX_PENS = 8;
HmiTrend.MIN_SPAN_SEC = 10;
HmiTrend.MAX_SPAN_SEC = 24 * 3600;
HmiTrend.MIN_SAMPLE_MS = 100;
HmiTrend.MIN_REFRESH_MS = 100;
HmiTrend.HEARTBEAT_MS = 60000;
HmiTrend.FLUSH_MS = 5000;
HmiTrend.MEMORY_MS = 24 * 3600 * 1000;
HmiTrend.HISTORY_DAYS = 7;
HmiTrend.MAX_NAME = 64;

HmiTrend.DEFAULTS = {name: '', title: '', spanSec: 600, sampleMs: 1000, refreshMs: 1000,
	gridColor: '#dde3e8', pens: []};

/** Colors offered to new pens, in turn. */
HmiTrend.COLORS = ['#1f77b4', '#d62728', '#2ca02c', '#ff7f0e', '#9467bd', '#8c564b', '#e377c2', '#17becf'];

/** A discrete pen with no range of its own: its line sits in the middle half. */
HmiTrend.DISCRETE_RANGE = {min: -0.5, max: 1.5};

HmiTrend.isFunction = function(name)
{
	return mxUtils.indexOf(HmiTrend.FUNCTIONS, name) >= 0;
};

HmiTrend.isTrendStyle = function(style)
{
	return style != null && /(^|;)shape=hmiTrend(;|$)/.test(style);
};

HmiTrend.isTrendCell = function(graph, cell)
{
	return cell != null && graph.getModel().isVertex(cell) &&
		graph.getCellStyle(cell)[mxConstants.STYLE_SHAPE] === HmiTrend.SHAPE;
};

/** Trend names: 1 to 64 characters, no control characters. */
HmiTrend.validName = function(name)
{
	return typeof name === 'string' && name.trim() !== '' && name.length <= HmiTrend.MAX_NAME &&
		!/[\x00-\x1f\x7f]/.test(name);
};

HmiTrend.number = function(v, fallback)
{
	var n = (typeof v === 'number') ? v : parseFloat(v);

	return (isFinite(n)) ? n : fallback;
};

/** The settings with defaults filled in and numbers clamped. */
HmiTrend.normalize = function(cfg)
{
	cfg = cfg || {};
	var d = HmiTrend.DEFAULTS;
	var out = {
		name: (cfg.name != null) ? String(cfg.name).trim() : '',
		title: (cfg.title != null) ? String(cfg.title) : '',
		spanSec: Math.max(HmiTrend.MIN_SPAN_SEC, Math.min(HmiTrend.MAX_SPAN_SEC, HmiTrend.number(cfg.spanSec, d.spanSec))),
		sampleMs: Math.max(HmiTrend.MIN_SAMPLE_MS, HmiTrend.number(cfg.sampleMs, d.sampleMs)),
		refreshMs: Math.max(HmiTrend.MIN_REFRESH_MS, HmiTrend.number(cfg.refreshMs, d.refreshMs)),
		gridColor: cfg.gridColor || d.gridColor,
		pens: []
	};

	var pens = (Array.isArray(cfg.pens)) ? cfg.pens : [];

	for (var i = 0; i < pens.length && out.pens.length < HmiTrend.MAX_PENS; i++)
	{
		var p = pens[i] || {};
		var tag = (p.tag != null) ? String(p.tag).trim() : '';

		if (tag !== '')
		{
			out.pens.push({tag: tag, min: (p.min != null) ? p.min : '', max: (p.max != null) ? p.max : '',
				color: p.color || HmiTrend.COLORS[i % HmiTrend.COLORS.length]});
		}
	}

	return out;
};

/** A pen's y range: its own, else the tag's (discrete tags: DISCRETE_RANGE). */
HmiTrend.penRange = function(project, pen)
{
	var tag = (project != null) ? project.getTag(pen.tag) : null;
	var discrete = tag != null && HmiTypes.isDiscrete(tag.type);
	var dmin = (discrete) ? HmiTrend.DISCRETE_RANGE.min : HmiTrend.number((tag != null) ? tag.minEU : null, 0);
	var dmax = (discrete) ? HmiTrend.DISCRETE_RANGE.max : HmiTrend.number((tag != null) ? tag.maxEU : null, 100);
	var min = HmiTrend.number(pen.min, dmin);
	var max = HmiTrend.number(pen.max, dmax);

	if (!(max > min))
	{
		min = dmin;
		max = (dmax > dmin) ? dmax : dmin + 1;
	}

	return {min: min, max: max, discrete: discrete};
};

/** Whether a tag can be a pen: analog or discrete, with a value of its own. */
HmiTrend.penProblem = function(project, name)
{
	var tag = (project != null) ? project.getTag(name) : null;

	if (tag == null)
	{
		return 'Unknown tag "' + name + '"';
	}

	if (HmiTypes.isIndirect(tag.type))
	{
		return '"' + tag.name + '" is an indirect tag; trend the tag it stands for';
	}

	if (!HmiTypes.isAnalog(tag.type) && !HmiTypes.isDiscrete(tag.type))
	{
		return '"' + tag.name + '" is a ' + tag.type + ' tag; pens must be analog or discrete tags';
	}

	return null;
};

/** What Validate reports for one trend's settings. */
HmiTrend.problems = function(project, raw)
{
	var errors = [];
	var cfg = HmiTrend.normalize(raw);
	var seen = {};

	if (!HmiTrend.validName(cfg.name))
	{
		errors.push((cfg.name === '') ? 'The trend has no name' : 'Trend names can have up to 64 characters');
	}

	if (raw != null && Array.isArray(raw.pens) && raw.pens.length > HmiTrend.MAX_PENS)
	{
		errors.push('A trend can have at most ' + HmiTrend.MAX_PENS + ' pens');
	}

	if (cfg.pens.length === 0)
	{
		errors.push('The trend has no pens');
	}

	var nums = {spanSec: 'Time span', sampleMs: 'Sample period', refreshMs: 'Refresh period'};

	for (var key in nums)
	{
		if (raw != null && raw[key] != null && raw[key] !== '' && !isFinite(parseFloat(raw[key])))
		{
			errors.push(nums[key] + ' must be a number');
		}
	}

	if (raw != null && HmiTrend.number(raw.spanSec, HmiTrend.DEFAULTS.spanSec) !== cfg.spanSec)
	{
		errors.push('Time span must be ' + HmiTrend.MIN_SPAN_SEC + ' to ' + HmiTrend.MAX_SPAN_SEC + ' seconds');
	}

	for (var i = 0; i < cfg.pens.length; i++)
	{
		var pen = cfg.pens[i];
		var problem = HmiTrend.penProblem(project, pen.tag);

		if (problem != null)
		{
			errors.push('Pen ' + (i + 1) + ': ' + problem);
		}
		else if (seen[pen.tag.toLowerCase()])
		{
			errors.push('Pen ' + (i + 1) + ': "' + pen.tag + '" is already a pen');
		}

		seen[pen.tag.toLowerCase()] = true;

		var hasMin = pen.min !== '' && pen.min != null;
		var hasMax = pen.max !== '' && pen.max != null;

		if ((hasMin && !isFinite(parseFloat(pen.min))) || (hasMax && !isFinite(parseFloat(pen.max))))
		{
			errors.push('Pen ' + (i + 1) + ': Min and Max must be numbers, or empty for the tag\'s range');
		}
		else if (hasMin && hasMax && !(parseFloat(pen.max) > parseFloat(pen.min)))
		{
			errors.push('Pen ' + (i + 1) + ': Max must be greater than Min');
		}
	}

	return errors;
};

// ------------------------------------------------------------ the project

/** A cell's trend settings, read from its hmi attribute (no graph needed). */
HmiTrend.cellConfig = function(cell)
{
	if (cell == null || !HmiTrend.isTrendStyle(cell.style) || cell.value == null ||
		typeof cell.value.getAttribute !== 'function')
	{
		return (cell != null && HmiTrend.isTrendStyle(cell.style)) ? {} : null;
	}

	try
	{
		var raw = cell.value.getAttribute(HmiProject.CELL_ATTRIBUTE);
		var data = (raw) ? JSON.parse(raw) : null;

		return (data != null && data.links != null && data.links.trend != null) ? data.links.trend : {};
	}
	catch (e)
	{
		return {};
	}
};

/**
 * Every Trend in the project, on every page: [{page, cell, cfg}] where cfg
 * is the raw link (not normalized).
 */
HmiTrend.collect = function(ui)
{
	var out = [];

	var walk = function(cell, page)
	{
		var cfg = HmiTrend.cellConfig(cell);

		if (cfg != null)
		{
			out.push({page: page, cell: cell, cfg: cfg});
		}

		for (var i = 0; cell.children != null && i < cell.children.length; i++)
		{
			walk(cell.children[i], page);
		}
	};

	if (ui.pages == null || ui.pages.length === 0)
	{
		walk(ui.editor.graph.getModel().getRoot(), null);

		return out;
	}

	for (var i = 0; i < ui.pages.length; i++)
	{
		var page = ui.pages[i];
		var root = null;

		if (page === ui.currentPage)
		{
			root = ui.editor.graph.getModel().getRoot();
		}
		else
		{
			HmiLog.guard('trend.pageRoot', function() { ui.updatePageRoot(page); });
			root = page.root;
		}

		if (root != null)
		{
			walk(root, page);
		}
	}

	return out;
};

/** base, or base with the lowest number after it that no name in taken has. */
HmiTrend.uniqueName = function(base, taken)
{
	var lower = {};

	for (var i = 0; i < taken.length; i++)
	{
		lower[String(taken[i]).toLowerCase()] = true;
	}

	var stem = String(base || '').replace(/\d+$/, '') || 'Trend';

	if (base && !lower[base.toLowerCase()])
	{
		return base;
	}

	for (var n = (base) ? 2 : 1; ; n++)
	{
		if (!lower[(stem + n).toLowerCase()])
		{
			return stem + n;
		}
	}
};

/**
 * Names trends just added to the editor (dropped, pasted, duplicated): an
 * empty name or one another trend has becomes the next free one.
 */
HmiTrend.nameNew = function(ui, graph, cells)
{
	var fresh = [];

	var find = function(cell)
	{
		if (HmiTrend.isTrendCell(graph, cell))
		{
			fresh.push(cell);
		}

		for (var i = 0; i < graph.getModel().getChildCount(cell); i++)
		{
			find(graph.getModel().getChildAt(cell, i));
		}
	};

	for (var i = 0; i < cells.length; i++)
	{
		find(cells[i]);
	}

	if (fresh.length === 0)
	{
		return;
	}

	var taken = HmiTrend.collect(ui).filter(function(t)
	{
		return mxUtils.indexOf(fresh, t.cell) < 0;
	}).map(function(t) { return HmiTrend.normalize(t.cfg).name; });

	for (var i = 0; i < fresh.length; i++)
	{
		var links = HmiProject.getCellLinks(graph, fresh[i]);
		var cfg = links.trend || HmiTypes.LINKS['trend'].defaults();
		var name = (cfg.name != null) ? String(cfg.name).trim() : '';
		var unique = HmiTrend.uniqueName(name, taken);

		if (unique !== cfg.name || links.trend == null)
		{
			cfg.name = unique;
			links.trend = cfg;
			HmiProject.setCellLinks(graph, fresh[i], links);
		}

		taken.push(unique);
	}
};

/** Duplicate names across the project: [{name, count}]. */
HmiTrend.duplicates = function(trends)
{
	var counts = {};
	var names = {};

	for (var i = 0; i < trends.length; i++)
	{
		var name = HmiTrend.normalize(trends[i].cfg).name;

		if (name !== '')
		{
			counts[name.toLowerCase()] = (counts[name.toLowerCase()] || 0) + 1;
			names[name.toLowerCase()] = name;
		}
	}

	var out = [];

	for (var key in counts)
	{
		if (counts[key] > 1)
		{
			out.push({name: names[key], count: counts[key]});
		}
	}

	return out;
};

// ---------------------------------------------------------------- install

HmiTrend.install = function()
{
	HmiTrend.installShape();

	var cellsAdded = Graph.prototype.cellsAdded;

	Graph.prototype.cellsAdded = function(cells)
	{
		cellsAdded.apply(this, arguments);

		if (this.hmiUi != null && cells != null)
		{
			var graph = this;

			HmiLog.guard('trend.name', function() { HmiTrend.nameNew(graph.hmiUi, graph, cells); });
		}
	};
};

/** The editor's preview: the frame, grid, axes and the pens as sample lines. */
HmiTrend.installShape = function()
{
	function TrendShape()
	{
		mxRectangleShape.call(this);
	}

	mxUtils.extend(TrendShape, mxRectangleShape);

	TrendShape.prototype.paintVertexShape = function(c, x, y, w, h)
	{
		var style = this.style || {};
		var cfg = HmiTrend.normalize((this.state != null) ? HmiTrend.cellConfig(this.state.cell) : null);
		var fs = parseFloat(style[mxConstants.STYLE_FONTSIZE]) || 11;
		var fill = style[mxConstants.STYLE_FILLCOLOR];
		var stroke = style[mxConstants.STYLE_STROKECOLOR];
		var font = style[mxConstants.STYLE_FONTCOLOR] || '#333333';
		var lineW = parseFloat(style[mxConstants.STYLE_STROKEWIDTH]) || 1;
		var top = y + 4;

		c.setFillColor((fill != null && fill !== mxConstants.NONE) ? fill : '#ffffff');
		c.setStrokeColor((stroke != null && stroke !== mxConstants.NONE) ? stroke : '#607d8b');
		c.setStrokeWidth(1);
		c.rect(x, y, w, h);
		c.fillAndStroke();

		c.setFontSize(fs);
		c.setFontFamily(style[mxConstants.STYLE_FONTFAMILY] || 'Helvetica');
		c.setFontColor(font);

		if (cfg.title !== '')
		{
			c.setFontStyle(mxConstants.FONT_BOLD);
			c.text(x + w / 2, top + fs * 0.8, 0, 0, cfg.title, mxConstants.ALIGN_CENTER, mxConstants.ALIGN_MIDDLE,
				false, '', null, false, 0, null);
			top += fs * 1.6;
		}

		c.setFontStyle(0);
		var left = x + fs * 4.5;
		var bottom = y + h - fs * 2;
		var right = x + w - 8;

		if (right - left < 20 || bottom - top < 20)
		{
			return;
		}

		c.setStrokeColor(cfg.gridColor);

		for (var i = 0; i <= 5; i++)
		{
			var gy = top + (bottom - top) * i / 5;
			c.begin();
			c.moveTo(left, gy);
			c.lineTo(right, gy);
			c.stroke();

			var gx = left + (right - left) * i / 5;
			c.begin();
			c.moveTo(gx, top);
			c.lineTo(gx, bottom);
			c.stroke();
		}

		var pen = cfg.pens[0];
		c.text(left - 4, top, 0, 0, '100', mxConstants.ALIGN_RIGHT, mxConstants.ALIGN_MIDDLE,
			false, '', null, false, 0, null);
		c.text(left - 4, bottom, 0, 0, '0', mxConstants.ALIGN_RIGHT, mxConstants.ALIGN_MIDDLE,
			false, '', null, false, 0, null);
		c.text(left, bottom + fs * 0.9, 0, 0, 'hh:mm:ss', mxConstants.ALIGN_LEFT, mxConstants.ALIGN_MIDDLE,
			false, '', null, false, 0, null);
		c.text(right, bottom + fs * 0.9, 0, 0, 'now', mxConstants.ALIGN_RIGHT, mxConstants.ALIGN_MIDDLE,
			false, '', null, false, 0, null);
		c.text(x + fs * 0.8, (top + bottom) / 2, 0, 0, (pen != null) ? pen.tag : 'Trend ' + (cfg.name || ''),
			mxConstants.ALIGN_CENTER, mxConstants.ALIGN_MIDDLE, false, '', null, false, -90, null);

		var count = Math.max(1, cfg.pens.length);

		for (var p = 0; p < count; p++)
		{
			c.setStrokeColor((cfg.pens[p] != null) ? cfg.pens[p].color : HmiTrend.COLORS[p]);
			c.setStrokeWidth(lineW + ((p === 0) ? 1 : 0));
			c.begin();

			for (var k = 0; k <= 40; k++)
			{
				var fx = left + (right - left) * k / 40;
				var fy = top + (bottom - top) * (0.5 + 0.3 * Math.sin(k / 6 + p * 1.7) * (1 - p * 0.15));

				if (k === 0)
				{
					c.moveTo(fx, fy);
				}
				else
				{
					c.lineTo(fx, fy);
				}
			}

			c.stroke();
		}
	};

	mxCellRenderer.registerShape(HmiTrend.SHAPE, TrendShape);
};

// ================================================================= manager

/**
 * @param project  the HmiProject
 * @param driver   a hub client of its own
 * @param options  {ui, store (null: no history on disk), trends: [raw link],
 *                 report(call, message) instead of the error window}
 */
HmiTrendManager = function(project, driver, options)
{
	this.project = project;
	this.driver = driver;
	this.options = options || {};
	this.listeners = {change: []};
	this.trends = {};
	this.states = {};
	this.series = {};
	this.latest = {};
	this.pending = [];
	this.disk = {};
	this.running = false;

	var list = this.options.trends || [];

	for (var i = 0; i < list.length; i++)
	{
		var cfg = HmiTrend.normalize(list[i]);
		var key = cfg.name.toLowerCase();

		// The first of a duplicated name wins (Validate reports the rest)
		if (cfg.name !== '' && this.trends[key] == null)
		{
			this.trends[key] = cfg;
			this.states[key] = {pen: 0, paused: false, end: 0};
		}
	}
};

HmiTrendManager.prototype.on = HmiAlarmManager.prototype.on;
HmiTrendManager.prototype.off = HmiAlarmManager.prototype.off;
HmiTrendManager.prototype.fire = HmiAlarmManager.prototype.fire;

/** The trend named name (any case), normalized, or null. */
HmiTrendManager.prototype.trend = function(name)
{
	return this.trends[String(name || '').trim().toLowerCase()] || null;
};

/** {pen, paused, end} of the trend named name, or null. */
HmiTrendManager.prototype.state = function(name)
{
	return this.states[String(name || '').trim().toLowerCase()] || null;
};

HmiTrendManager.prototype.now = function()
{
	return (this.options.now != null) ? this.options.now() : Date.now();
};

HmiTrendManager.prototype.start = function()
{
	var that = this;
	var tick = null;

	for (var key in this.trends)
	{
		var cfg = this.trends[key];

		for (var i = 0; i < cfg.pens.length; i++)
		{
			var tag = this.project.getTag(cfg.pens[i].tag);

			if (tag == null || HmiTrend.penProblem(this.project, tag.name) != null)
			{
				continue;
			}

			var lower = tag.name.toLowerCase();
			var s = this.series[lower];

			if (s == null)
			{
				s = this.series[lower] = {name: tag.name, t: [], v: [], period: cfg.sampleMs,
					lastSample: 0, last: null, held: null};
			}

			s.period = Math.min(s.period, cfg.sampleMs);
			tick = (tick == null) ? s.period : Math.min(tick, s.period);
		}
	}

	var names = Object.keys(this.series).map(function(k) { return that.series[k].name; });
	this.startTime = this.now();
	this.coverage = this.startTime;
	this.running = true;

	if (names.length === 0)
	{
		return;
	}

	this.tick = tick;
	this.onChange = function(batch) { that.applyBatch(batch); };
	this.driver.on('change', this.onChange);
	this.driver.subscribe(names, Math.min(250, tick));

	if (this.options.manual !== true)
	{
		this.timer = window.setInterval(function()
		{
			HmiLog.guard('trend.sample', function() { that.sample(that.now()); });
		}, tick);

		this.flushTimer = window.setInterval(function()
		{
			HmiLog.guard('trend.flush', function() { that.flush(); });
		}, HmiTrend.FLUSH_MS);
	}

	this.loadRecent();
};

HmiTrendManager.prototype.stop = function()
{
	if (!this.running)
	{
		return;
	}

	this.running = false;

	if (this.timer != null)
	{
		window.clearInterval(this.timer);
		window.clearInterval(this.flushTimer);
		this.timer = null;
		this.flushTimer = null;
	}

	if (this.onChange != null)
	{
		this.driver.off('change', this.onChange);
		this.driver.unsubscribe();
		this.onChange = null;
	}

	// A gap where the Run ended, so the next Run's line does not join it
	var now = this.now();

	for (var key in this.series)
	{
		var s = this.series[key];

		if (s.last != null && !isNaN(s.last.v))
		{
			this.record(s, now, NaN);
		}
	}

	this.flush();
};

HmiTrendManager.prototype.applyBatch = function(batch)
{
	for (var name in batch)
	{
		this.latest[name.toLowerCase()] = batch[name];
	}
};

/** A tag's value now as a number; NaN for bad quality or no value. */
HmiTrendManager.prototype.valueOf = function(s)
{
	var v = this.latest[s.name.toLowerCase()];

	if (v == null && this.driver.get != null)
	{
		v = this.driver.get(s.name);
	}

	if (v == null || v.value == null || v.value === '' || !(v.quality > HmiTypes.QUALITY_BAD))
	{
		return NaN;
	}

	var n = (v.value === true) ? 1 : ((v.value === false) ? 0 : Number(v.value));

	return (isFinite(n)) ? n : NaN;
};

/**
 * Samples every series that is due. A value is recorded when it changes, or
 * after HEARTBEAT_MS; the last unchanged sample is recorded before a change,
 * so a line holds flat up to the moment it moved.
 */
HmiTrendManager.prototype.sample = function(now)
{
	var half = (this.tick || 0) / 2;

	for (var key in this.series)
	{
		var s = this.series[key];

		if (now - s.lastSample < s.period - half)
		{
			continue;
		}

		s.lastSample = now;
		var v = this.valueOf(s);
		var changed = s.last == null || isNaN(v) !== isNaN(s.last.v) || (!isNaN(v) && v !== s.last.v);

		if (changed || now - s.last.t >= HmiTrend.HEARTBEAT_MS)
		{
			if (changed && s.held != null && s.held.t > s.last.t)
			{
				this.record(s, s.held.t, s.held.v);
			}

			this.record(s, now, v);
			s.held = null;
		}
		else
		{
			s.held = {t: now, v: v};
		}
	}

	this.trim(now);
};

HmiTrendManager.prototype.record = function(s, t, v)
{
	s.t.push(t);
	s.v.push(v);
	s.last = {t: t, v: v};

	if (this.options.store)
	{
		this.pending.push([t, s.name, (isNaN(v)) ? null : v]);
	}
};

/** Memory keeps MEMORY_MS; older points are read back from disk. */
HmiTrendManager.prototype.trim = function(now)
{
	var cut = now - HmiTrend.MEMORY_MS;

	for (var key in this.series)
	{
		var s = this.series[key];

		// In chunks, not on every sample
		if (s.t.length > 0 && s.t[0] < cut - 60000)
		{
			var n = HmiTrendManager.search(s.t, cut);
			s.t.splice(0, n);
			s.v.splice(0, n);
		}
	}

	this.coverage = Math.max(this.coverage, cut);
};

/** Index of the first time >= t in a sorted array. */
HmiTrendManager.search = function(times, t)
{
	var lo = 0;
	var hi = times.length;

	while (lo < hi)
	{
		var mid = (lo + hi) >> 1;

		if (times[mid] < t)
		{
			lo = mid + 1;
		}
		else
		{
			hi = mid;
		}
	}

	return lo;
};

HmiTrendManager.prototype.canPersist = function()
{
	return !!this.options.store && window.electron != null && typeof window.electron.request === 'function';
};

/** Writes the recorded samples to the history files. */
HmiTrendManager.prototype.flush = function()
{
	if (this.pending.length === 0)
	{
		return;
	}

	var samples = this.pending;
	this.pending = [];

	if (!this.canPersist())
	{
		return;
	}

	for (var i = 0; i < samples.length; i += 20000)
	{
		window.electron.request({action: 'hmiTrends.append', store: this.options.store,
			samples: samples.slice(i, i + 20000)}, function() {}, function(message)
		{
			HmiLog.once('trends.append', 'trend history not written: ' + message);
		});
	}
};

/** The history before this Run, as far back as the longest trend shows. */
HmiTrendManager.prototype.loadRecent = function()
{
	if (!this.canPersist())
	{
		return;
	}

	var span = 0;

	for (var key in this.trends)
	{
		span = Math.max(span, this.trends[key].spanSec * 1000);
	}

	var that = this;
	var to = this.startTime;
	var from = to - span;
	var names = Object.keys(this.series).map(function(k) { return that.series[k].name; });

	this.query(names, from, to, function(data)
	{
		if (data == null)
		{
			return;
		}

		for (var name in data)
		{
			var s = that.series[name.toLowerCase()];
			var points = data[name];

			if (s == null)
			{
				continue;
			}

			var t = [];
			var v = [];

			for (var i = 0; i < points.length; i++)
			{
				if (points[i][0] < that.startTime)
				{
					t.push(points[i][0]);
					v.push((points[i][1] == null) ? NaN : points[i][1]);
				}
			}

			// A Run that ended without its gap still does not join this one
			if (t.length > 0 && !isNaN(v[v.length - 1]))
			{
				t.push(that.startTime - 1);
				v.push(NaN);
			}

			s.t = t.concat(s.t);
			s.v = v.concat(s.v);
		}

		that.coverage = Math.min(that.coverage, from);

		for (var key in that.trends)
		{
			that.fire('change', that.trends[key].name);
		}
	});
};

HmiTrendManager.prototype.query = function(tags, from, to, fn)
{
	if (!this.canPersist() || tags.length === 0)
	{
		fn(null);

		return;
	}

	window.electron.request({action: 'hmiTrends.query', store: this.options.store, tags: tags,
		from: Math.floor(from), to: Math.ceil(to), maxPoints: 4000}, function(data)
	{
		fn(data || null);
	}, function(message)
	{
		HmiLog.once('trends.query', 'trend history not read: ' + message);
		fn(null);
	});
};

/**
 * A tag's points from `from` to `to` as {t, v}, with one point before and
 * one after so lines reach the edges. Older than memory holds, they come
 * from disk: the first ask starts a read and gives what memory has, and
 * 'change' fires for trendName when the rest is there.
 */
HmiTrendManager.prototype.points = function(trendName, tag, from, to)
{
	var s = this.series[String(tag).toLowerCase()];

	if (s == null)
	{
		return {t: [], v: []};
	}

	var mem = HmiTrendManager.slice(s.t, s.v, from, to);

	if (from >= this.coverage || !this.canPersist())
	{
		return mem;
	}

	var key = String(trendName).toLowerCase();
	var d = this.disk[key];

	if (d == null || d.from !== from || d.to !== to)
	{
		this.loadDisk(key, from, to);
		d = this.disk[key];
	}

	var past = (d.data != null) ? d.data[s.name] : null;

	if (past == null)
	{
		return mem;
	}

	// Disk before memory's coverage, memory after
	var out = {t: [], v: []};

	for (var i = 0; i < past.length; i++)
	{
		if (past[i][0] < this.coverage)
		{
			out.t.push(past[i][0]);
			out.v.push((past[i][1] == null) ? NaN : past[i][1]);
		}
	}

	var start = HmiTrendManager.search(mem.t, this.coverage);

	return {t: out.t.concat(mem.t.slice(start)), v: out.v.concat(mem.v.slice(start))};
};

HmiTrendManager.slice = function(times, values, from, to)
{
	var a = Math.max(0, HmiTrendManager.search(times, from) - 1);
	var b = Math.min(times.length, HmiTrendManager.search(times, to) + 1);

	return {t: times.slice(a, b), v: values.slice(a, b)};
};

HmiTrendManager.prototype.loadDisk = function(key, from, to)
{
	var cfg = this.trends[key];
	var that = this;
	var entry = {from: from, to: to, data: null};
	this.disk[key] = entry;

	if (cfg == null)
	{
		return;
	}

	var tags = [];

	for (var i = 0; i < cfg.pens.length; i++)
	{
		var s = this.series[cfg.pens[i].tag.toLowerCase()];

		if (s != null)
		{
			tags.push(s.name);
		}
	}

	this.query(tags, from, to, function(data)
	{
		if (that.disk[key] === entry)
		{
			entry.data = data || {};
			that.fire('change', cfg.name);
		}
	});
};

// --------------------------------------------------------- the functions

/**
 * TrendSetPen(trend, tag), TrendPause(trend), TrendPlay(trend),
 * TrendScrollBack(trend), TrendScrollForward(trend): 1, or 0 with the
 * reason shown to the operator.
 */
HmiTrendManager.prototype.call = function(name, args)
{
	var texts = args.map(function(a) { return HmiExpr.text(a); });
	var call = HmiRecipes.describeCall(name, texts);
	var trendName = (texts[0] || '').trim();
	var cfg = this.trend(trendName);
	var problem = null;

	if (trendName === '')
	{
		problem = 'The trend name is empty.';
	}
	else if (cfg == null)
	{
		problem = 'There is no trend named "' + trendName + '".';
	}

	if (problem == null)
	{
		var state = this.state(trendName);
		var now = this.now();
		var half = cfg.spanSec * 500;

		switch (name)
		{
			case 'TrendSetPen':
			{
				var tag = (texts[1] || '').trim();
				var index = -1;

				for (var i = 0; i < cfg.pens.length; i++)
				{
					if (cfg.pens[i].tag.toLowerCase() === tag.toLowerCase())
					{
						index = i;
					}
				}

				if (tag === '')
				{
					problem = 'The pen\'s tag name is empty.';
				}
				else if (index < 0)
				{
					problem = 'The trend "' + cfg.name + '" has no pen for "' + tag + '".';
				}
				else
				{
					state.pen = index;
				}

				break;
			}
			case 'TrendPause':
				if (!state.paused)
				{
					state.paused = true;
					state.end = now;
				}

				break;
			case 'TrendPlay':
				state.paused = false;
				break;
			case 'TrendScrollBack':
				if (!state.paused)
				{
					state.paused = true;
					state.end = now;
				}

				state.end = Math.max(now - HmiTrend.HISTORY_DAYS * 24 * 3600 * 1000, state.end - half);
				break;
			case 'TrendScrollForward':
				// Live is as far forward as a trend goes
				if (state.paused)
				{
					state.end = Math.min(now, state.end + half);
				}

				break;
		}
	}

	if (problem != null)
	{
		HmiLog.warn('trend: ' + call + ' failed: ' + problem);

		if (typeof HmiRuntimeApp !== 'undefined' && HmiRuntimeApp.isActive())
		{
			HmiRuntimeApp.log('warn', call + ' failed: ' + problem);
		}

		if (this.options.report != null)
		{
			this.options.report(call, problem);
		}
		else if (this.options.ui != null)
		{
			HmiDialogs.queueFunctionError(this.options.ui, call, problem);
		}

		return 0;
	}

	this.fire('change', cfg.name);

	return 1;
};

// ---------------------------------------------------------------- run view

/**
 * The live plot of one Trend cell in a Run window: a canvas over the cell,
 * following zoom and pan, redrawn every refreshMs while live and whenever
 * its state changes.
 */
HmiTrendView = function(runtime, cell, cfg)
{
	this.runtime = runtime;
	this.graph = runtime.graph;
	this.cell = cell;
	this.cfg = HmiTrend.normalize(cfg);
	this.style = this.graph.getCellStyle(cell);
	this.trends = runtime.trends;
	this.project = runtime.project;
};

HmiTrendView.prototype.start = function()
{
	var that = this;

	this.node = document.createElement('canvas');
	this.node.className = 'hmiTrendView';
	this.node.setAttribute('data-hmi-trend', this.cfg.name);
	this.graph.container.appendChild(this.node);

	this.onView = function() { that.place(); };
	this.graph.view.addListener(mxEvent.SCALE, this.onView);
	this.graph.view.addListener(mxEvent.TRANSLATE, this.onView);
	this.graph.view.addListener(mxEvent.SCALE_AND_TRANSLATE, this.onView);

	this.onTrend = function(name)
	{
		if (String(name).toLowerCase() === that.cfg.name.toLowerCase())
		{
			that.render();
		}
	};

	if (this.trends != null)
	{
		this.trends.on('change', this.onTrend);
	}

	this.timer = window.setInterval(function()
	{
		var state = that.state();

		if (state == null || !state.paused)
		{
			HmiLog.guard('trend.render', function() { that.render(); });
		}
	}, this.cfg.refreshMs);

	this.place();
};

HmiTrendView.prototype.stop = function()
{
	if (this.node == null)
	{
		return;
	}

	window.clearInterval(this.timer);
	this.graph.view.removeListener(this.onView);

	if (this.trends != null)
	{
		this.trends.off('change', this.onTrend);
	}

	if (this.node.parentNode != null)
	{
		this.node.parentNode.removeChild(this.node);
	}

	this.node = null;
};

HmiTrendView.prototype.state = function()
{
	return (this.trends != null) ? this.trends.state(this.cfg.name) : null;
};

HmiTrendView.prototype.place = function()
{
	var state = this.graph.view.getState(this.cell);

	if (this.node == null || state == null)
	{
		return;
	}

	var ratio = window.devicePixelRatio || 1;
	var s = this.node.style;
	s.left = Math.round(state.x) + 'px';
	s.top = Math.round(state.y) + 'px';
	s.width = Math.round(state.width) + 'px';
	s.height = Math.round(state.height) + 'px';
	this.node.width = Math.max(1, Math.round(state.width * ratio));
	this.node.height = Math.max(1, Math.round(state.height * ratio));
	this.ratio = ratio;
	this.render();
};

/** Labels for a range: as many decimals as its size needs. */
HmiTrendView.formatTick = function(v, range)
{
	var decimals = Math.max(0, Math.min(4, 2 - Math.floor(Math.log(Math.abs(range) || 1) / Math.LN10)));

	return (Math.abs(v) < 1e-9) ? '0' : v.toFixed(decimals);
};

HmiTrendView.TIME_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200];

HmiTrendView.timeLabel = function(ms, step)
{
	var d = new Date(ms);
	var p = HmiAlarmView.pad;

	return p(d.getHours()) + ':' + p(d.getMinutes()) + ((step < 60000) ? ':' + p(d.getSeconds()) : '');
};

HmiTrendView.prototype.color = function(key, fallback)
{
	var c = this.style[key];

	return (c != null && c !== '' && c !== mxConstants.NONE) ? c : fallback;
};

HmiTrendView.prototype.render = function()
{
	if (this.node == null || this.ratio == null)
	{
		return;
	}

	var g = this.node.getContext('2d');
	var scale = this.graph.view.scale * this.ratio;
	var W = this.node.width;
	var H = this.node.height;
	var cfg = this.cfg;
	var state = this.state() || {pen: 0, paused: false, end: 0};
	var now = (this.trends != null) ? this.trends.now() : Date.now();
	var end = (state.paused) ? state.end : now;
	var span = cfg.spanSec * 1000;
	var start = end - span;
	var fs = (parseFloat(this.style[mxConstants.STYLE_FONTSIZE]) || 11) * scale;
	var family = this.style[mxConstants.STYLE_FONTFAMILY] || 'Helvetica';
	var fontColor = this.color(mxConstants.STYLE_FONTCOLOR, '#333333');
	var lineW = (parseFloat(this.style[mxConstants.STYLE_STROKEWIDTH]) || 1) * scale;
	var pad = 6 * scale;

	g.setTransform(1, 0, 0, 1, 0, 0);
	g.clearRect(0, 0, W, H);
	g.fillStyle = this.color(mxConstants.STYLE_FILLCOLOR, 'rgba(0,0,0,0)');
	g.fillRect(0, 0, W, H);

	g.font = fs + 'px ' + family;
	g.textBaseline = 'middle';
	g.fillStyle = fontColor;

	var top = pad;

	if (cfg.title !== '' || state.paused)
	{
		if (cfg.title !== '')
		{
			g.font = 'bold ' + fs + 'px ' + family;
			g.textAlign = 'left';
			g.fillText(cfg.title, pad, top + fs * 0.6);
			g.font = fs + 'px ' + family;
		}

		if (state.paused)
		{
			var d0 = new Date(start);
			var p = HmiAlarmView.pad;
			g.textAlign = 'right';
			g.fillText('Paused · ' + d0.getFullYear() + '-' + p(d0.getMonth() + 1) + '-' + p(d0.getDate()) + ' ' +
				HmiTrendView.timeLabel(start, 1000) + ' – ' + HmiTrendView.timeLabel(end, 1000), W - pad, top + fs * 0.6);
		}

		top += fs * 1.6;
	}

	var pens = cfg.pens;
	var sel = (pens.length > 0) ? pens[Math.min(state.pen, pens.length - 1)] : null;
	var range = (sel != null) ? HmiTrend.penRange(this.project, sel) : {min: 0, max: 100};
	var ticks = [];

	for (var i = 0; i <= 5; i++)
	{
		ticks.push(HmiTrendView.formatTick(range.min + (range.max - range.min) * i / 5, range.max - range.min));
	}

	var labelW = 0;

	for (var i = 0; i < ticks.length; i++)
	{
		labelW = Math.max(labelW, g.measureText(ticks[i]).width);
	}

	var plot = {x: pad + fs * 1.6 + labelW + 4 * scale, y: top + fs * 0.5};
	plot.w = Math.max(1, W - pad - plot.x);
	plot.h = Math.max(1, H - pad - fs * 1.4 - plot.y);

	// Grid and the y axis of the selected pen
	g.strokeStyle = cfg.gridColor;
	g.lineWidth = Math.max(1, scale * 0.75);
	g.textAlign = 'right';

	for (var i = 0; i <= 5; i++)
	{
		var gy = Math.round(plot.y + plot.h - plot.h * i / 5) + 0.5;
		g.beginPath();
		g.moveTo(plot.x, gy);
		g.lineTo(plot.x + plot.w, gy);
		g.stroke();
		g.fillText(ticks[i], plot.x - 4 * scale, gy);
	}

	// Time: the finest step that leaves room for its labels
	var labelSpace = g.measureText('00:00:00').width * 1.6;
	var step = HmiTrendView.TIME_STEPS[HmiTrendView.TIME_STEPS.length - 1] * 1000;

	for (var i = 0; i < HmiTrendView.TIME_STEPS.length; i++)
	{
		if (HmiTrendView.TIME_STEPS[i] * 1000 / span * plot.w >= labelSpace)
		{
			step = HmiTrendView.TIME_STEPS[i] * 1000;
			break;
		}
	}

	// Steps fall on the local clock (whole minutes, hours ...)
	var offset = new Date(start).getTimezoneOffset() * 60000;
	g.textAlign = 'center';

	for (var t = Math.ceil((start - offset) / step) * step + offset; t <= end; t += step)
	{
		var gx = Math.round(plot.x + (t - start) / span * plot.w) + 0.5;
		g.beginPath();
		g.moveTo(gx, plot.y);
		g.lineTo(gx, plot.y + plot.h);
		g.stroke();

		// A label that would run off either side of the trend is left out
		var label = HmiTrendView.timeLabel(t, step);
		var half = g.measureText(label).width / 2;

		if (gx - half >= 0 && gx + half <= W)
		{
			g.fillText(label, gx, plot.y + plot.h + fs * 0.8);
		}
	}

	g.strokeRect(plot.x + 0.5, plot.y + 0.5, plot.w - 1, plot.h - 1);

	if (sel != null)
	{
		var tag = this.project.getTag(sel.tag);
		var units = (tag != null && tag.engUnits) ? ' (' + tag.engUnits + ')' : '';
		g.save();
		g.translate(pad + fs * 0.6, plot.y + plot.h / 2);
		g.rotate(-Math.PI / 2);
		g.fillStyle = sel.color;
		g.textAlign = 'center';
		g.fillText(((tag != null) ? tag.name : sel.tag) + units, 0, 0);
		g.restore();
	}
	else
	{
		g.textAlign = 'center';
		g.fillText('No pens', plot.x + plot.w / 2, plot.y + plot.h / 2);
	}

	// The pens, the selected one last and a pixel thicker
	g.save();
	g.beginPath();
	g.rect(plot.x, plot.y, plot.w, plot.h);
	g.clip();
	g.lineJoin = 'round';

	var order = [];

	for (var i = 0; i < pens.length; i++)
	{
		if (pens[i] !== sel)
		{
			order.push(pens[i]);
		}
	}

	if (sel != null)
	{
		order.push(sel);
	}

	for (var i = 0; i < order.length; i++)
	{
		this.drawPen(g, order[i], plot, start, end, now, (order[i] === sel) ? lineW + scale : lineW, state.paused);
	}

	g.restore();
};

HmiTrendView.prototype.drawPen = function(g, pen, plot, start, end, now, width, paused)
{
	if (this.trends == null)
	{
		return;
	}

	var range = HmiTrend.penRange(this.project, pen);
	var data = this.trends.points(this.cfg.name, pen.tag, start, end);
	var span = end - start;
	var t = data.t;
	var v = data.v;
	var down = false;
	var lastY = 0;

	// Snapped to the pixel grid, so flat lines are crisp
	var snap = (Math.round(width) % 2 === 1) ? 0.5 : 0;
	var X = function(time) { return Math.round(plot.x + (time - start) / span * plot.w) + snap; };
	var Y = function(value) { return Math.round(plot.y + plot.h - (value - range.min) / (range.max - range.min) * plot.h) + snap; };

	g.strokeStyle = pen.color;
	g.lineWidth = width;
	g.beginPath();

	for (var i = 0; i < t.length; i++)
	{
		if (isNaN(v[i]))
		{
			down = false;
			continue;
		}

		var x = X(t[i]);
		var y = Y(v[i]);

		if (!down)
		{
			g.moveTo(x, y);
			down = true;
		}
		else if (range.discrete)
		{
			g.lineTo(x, lastY);
			g.lineTo(x, y);
		}
		else
		{
			g.lineTo(x, y);
		}

		lastY = y;
	}

	// The newest value holds until now
	var series = this.trends.series[pen.tag.toLowerCase()];

	if (down && series != null && series.last != null && t.length > 0 && t[t.length - 1] === series.last.t &&
		this.trends.running)
	{
		g.lineTo(X(Math.min(end, now)), lastY);
	}

	g.stroke();
};
