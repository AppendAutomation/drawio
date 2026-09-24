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

HmiRuntime.prototype.scanRateMs = function()
{
	var rate = 250;

	for (var i = 0; i < this.project.accessNames.length; i++)
	{
		var r = this.project.accessNames[i].rateMs;

		if (r > 0 && r < rate)
		{
			rate = r;
		}
	}

	return rate;
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
		var tag = this.project.getTag(HmiRuntime.baseTag(cfg.expr));
		text = (HmiRuntime.truthy(r.value)) ?
			((tag != null && tag.onMsg) ? tag.onMsg : 'On') :
			((tag != null && tag.offMsg) ? tag.offMsg : 'Off');
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
	var keys = ['fillColor', 'strokeColor', 'fontColor', 'visible', 'label'];

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
	this.origValidateCellState = graph.view.validateCellState;

	graph.view.validateCellState = function(cell, recurse)
	{
		var state = that.origValidateCellState.apply(this, arguments);

		if (that.running && state != null)
		{
			that.applyVisibility(cell, state);
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
	this.repaintCount++;
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

			if (cell != null)
			{
				that.handleTouch(cell, 'down');
			}
		},
		mouseMove: function() {},
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

	// An object hidden by a visibility link is not touchable, as in InTouch.
	if (binding.visual.visible === false)
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
};
