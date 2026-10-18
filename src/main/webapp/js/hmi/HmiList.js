/**
 * List Boxes: the List object (shape=hmiList) shows a list of text items at
 * Run, which scripts fill and the operator picks from. Its settings are the
 * hidden list link:
 *   name         the logical name scripts use, unique in the project
 *   title        heading text
 *   titleBar     whether the heading is drawn at all
 *   items        the starting items, one per line
 *   selectedTag  message tag the selection is written to
 *   upTag        discrete tag: a rising edge selects the item above
 *   downTag      discrete tag: a rising edge selects the one below
 *   arrows       up and down buttons in the title bar
 *   titleFill/titleColor, selFill/selColor   its own colors
 * Background, border, border width and font are the cell's own style, as the
 * other table objects take them (HmiRuntime.OBJECT_FRAME).
 *
 * One HmiListManager per Run holds every list's items and selection by name,
 * so a script can fill a list before any window shows it, two windows showing
 * one list agree, and the Selected item tag is written whether or not a
 * window is open. Scripts work the list with ListClear, ListAdd, ListRemove,
 * ListSelect, ListLoad and ListSort.
 */
HmiList = {};

HmiList.SHAPE = 'hmiList';
HmiList.LINK = 'list';
HmiList.STYLE = 'html=1;noLabel=1;shape=hmiList;fontSize=14;' + HmiRuntime.objectFrameStyle();

HmiList.FUNCTIONS = ['ListClear', 'ListAdd', 'ListRemove', 'ListSelect', 'ListLoad', 'ListSort'];

HmiList.MAX_NAME = 64;

/** As many items as a list may hold: past this the renderer suffers. */
HmiList.MAX_ITEMS = 5000;

/** The sort orders ListSort takes, in any case. */
HmiList.ORDERS = {'asc': 1, 'a': 1, 'desc': -1, 'd': -1};

HmiList.DEFAULTS = {name: '', title: '', titleBar: false, items: '', selectedTag: '',
	upTag: '', downTag: '', arrows: false, titleFill: '', titleColor: '', selFill: '', selColor: ''};

/**
 * The colors a List Box can be given, each a pair of list fields with the
 * built-in look as its default. The defaults are what css/hmi.css draws and
 * must stay in step with it: a field that is empty gets no inline style at
 * Run, so the style sheet still decides.
 */
HmiList.COLORS = {
	title: {label: 'Title bar', fill: 'titleFill', color: 'titleColor',
		fillDefault: '#263238', colorDefault: '#ffffff'},
	selected: {label: 'Selected row', fill: 'selFill', color: 'selColor',
		fillDefault: '#1a7fc1', colorDefault: '#ffffff'}
};

HmiList.COLOR_KEYS = ['title', 'selected'];

HmiList.isFunction = function(name)
{
	return mxUtils.indexOf(HmiList.FUNCTIONS, name) >= 0;
};

HmiList.isListCell = function(graph, cell)
{
	return cell != null && graph.getModel().isVertex(cell) &&
		graph.getCellStyle(cell)[mxConstants.STYLE_SHAPE] === HmiList.SHAPE;
};

/** List names: 1 to 64 characters, no control characters. */
HmiList.validName = function(name)
{
	return typeof name === 'string' && name.trim() !== '' && name.length <= HmiList.MAX_NAME &&
		!/[\x00-\x1f\x7f]/.test(name);
};

HmiList.truthy = function(v)
{
	return v === true || v === 'true' || v === 1 || v === '1';
};

/** The settings with defaults filled in. */
HmiList.normalize = function(cfg)
{
	cfg = cfg || {};
	var out = {};

	for (var key in HmiList.DEFAULTS)
	{
		out[key] = (cfg[key] != null) ? cfg[key] : HmiList.DEFAULTS[key];
	}

	out.name = String(out.name).trim();
	out.title = String(out.title);
	out.titleBar = HmiList.truthy(out.titleBar);
	out.arrows = HmiList.truthy(out.arrows);
	out.items = String(out.items);

	return out;
};

/** The starting items: the Items box, one per line, blank lines dropped. */
HmiList.startingItems = function(cfg)
{
	var text = (cfg != null && cfg.items != null) ? String(cfg.items) : '';
	var out = [];
	var lines = text.split(/\r?\n/);

	for (var i = 0; i < lines.length && out.length < HmiList.MAX_ITEMS; i++)
	{
		var line = lines[i].trim();

		if (line !== '')
		{
			out.push(line);
		}
	}

	return out;
};

/** ListLoad's text: comma separated, trimmed, empty entries dropped. */
HmiList.splitItems = function(text)
{
	var out = [];
	var parts = String((text != null) ? text : '').split(',');

	for (var i = 0; i < parts.length; i++)
	{
		var part = parts[i].trim();

		if (part !== '')
		{
			out.push(part);
		}
	}

	return out;
};

/** The first item matching text, ignoring case, or -1. */
HmiList.indexOf = function(items, text)
{
	var wanted = String((text != null) ? text : '').toLowerCase();

	for (var i = 0; i < items.length; i++)
	{
		if (items[i].toLowerCase() === wanted)
		{
			return i;
		}
	}

	return -1;
};

/** Alphabetical, ignoring case; same letters keep their ordinary order. */
HmiList.compare = function(a, b)
{
	var la = a.toLowerCase();
	var lb = b.toLowerCase();

	if (la !== lb)
	{
		return (la < lb) ? -1 : 1;
	}

	return (a === b) ? 0 : ((a < b) ? -1 : 1);
};

/** One of a list's own colors, or null when it is not set. */
HmiList.colorOf = function(cfg, group, which)
{
	var def = HmiList.COLORS[group];
	var c = (cfg != null && def != null) ? cfg[def[which]] : null;

	return (c != null && c !== '' && c !== mxConstants.NONE) ? String(c) : null;
};

/** The same, falling back to the built-in default: what the preview draws. */
HmiList.colorOr = function(cfg, group, which)
{
	return HmiList.colorOf(cfg, group, which) ||
		HmiList.COLORS[group][(which === 'fill') ? 'fillDefault' : 'colorDefault'];
};

/**
 * The list link of a cell, read straight from the model: the design-time
 * shape has no graph to ask, as a Trend's has not either
 * (HmiTrend.cellConfig).
 */
HmiList.cellConfig = function(cell)
{
	if (cell == null || cell.value == null || typeof cell.value.getAttribute !== 'function')
	{
		return {};
	}

	try
	{
		var raw = cell.value.getAttribute(HmiProject.CELL_ATTRIBUTE);
		var data = (raw) ? JSON.parse(raw) : null;

		return (data != null && data.links != null && data.links.list != null) ?
			data.links.list : {};
	}
	catch (e)
	{
		return {};
	}
};

/**
 * Every List Box in the project, on every page: [{page, cell, cfg}] where cfg
 * is the raw link (not normalized).
 */
HmiList.collect = function(ui)
{
	var out = [];
	var graph = ui.editor.graph;

	var walk = function(cell, page)
	{
		if (HmiList.isListCell(graph, cell))
		{
			out.push({page: page, cell: cell, cfg: HmiList.cellConfig(cell)});
		}

		for (var i = 0; cell.children != null && i < cell.children.length; i++)
		{
			walk(cell.children[i], page);
		}
	};

	if (ui.pages == null || ui.pages.length === 0)
	{
		walk(graph.getModel().getRoot(), null);

		return out;
	}

	for (var i = 0; i < ui.pages.length; i++)
	{
		var page = ui.pages[i];
		var root = null;

		if (page === ui.currentPage)
		{
			root = graph.getModel().getRoot();
		}
		else
		{
			HmiLog.guard('list.pageRoot', function() { ui.updatePageRoot(page); });
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
HmiList.uniqueName = function(base, taken)
{
	var lower = {};

	for (var i = 0; i < taken.length; i++)
	{
		lower[String(taken[i]).toLowerCase()] = true;
	}

	var stem = String(base || '').replace(/\d+$/, '') || 'List';

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
 * Names List Boxes just added to the editor (dropped, pasted, duplicated): an
 * empty name or one another list has becomes the next free one.
 */
HmiList.nameNew = function(ui, graph, cells)
{
	var fresh = [];

	var find = function(cell)
	{
		if (HmiList.isListCell(graph, cell))
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

	var taken = HmiList.collect(ui).filter(function(l)
	{
		return mxUtils.indexOf(fresh, l.cell) < 0;
	}).map(function(l) { return HmiList.normalize(l.cfg).name; });

	for (var i = 0; i < fresh.length; i++)
	{
		var links = HmiProject.getCellLinks(graph, fresh[i]);
		var cfg = links.list || HmiTypes.LINKS['list'].defaults();
		var name = (cfg.name != null) ? String(cfg.name).trim() : '';
		var unique = HmiList.uniqueName(name, taken);

		if (unique !== cfg.name || links.list == null)
		{
			cfg.name = unique;
			links.list = cfg;
			HmiProject.setCellLinks(graph, fresh[i], links);
		}

		taken.push(unique);
	}
};

/** Duplicate names across the project: [{name, count}]. */
HmiList.duplicates = function(lists)
{
	var counts = {};
	var names = {};

	for (var i = 0; i < lists.length; i++)
	{
		var name = HmiList.normalize(lists[i].cfg).name;

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

HmiList.install = function()
{
	HmiList.installShape();

	var cellsAdded = Graph.prototype.cellsAdded;

	Graph.prototype.cellsAdded = function(cells)
	{
		cellsAdded.apply(this, arguments);

		if (this.hmiUi != null && cells != null)
		{
			var graph = this;

			HmiLog.guard('list.name', function() { HmiList.nameNew(graph.hmiUi, graph, cells); });
		}
	};
};

/** The editor's preview: the frame, the title bar if it is on, and the items. */
HmiList.installShape = function()
{
	function ListShape()
	{
		mxRectangleShape.call(this);
	}

	mxUtils.extend(ListShape, mxRectangleShape);

	ListShape.prototype.paintVertexShape = function(c, x, y, w, h)
	{
		var style = this.style || {};
		var cfg = HmiList.normalize((this.state != null) ? HmiList.cellConfig(this.state.cell) : null);
		var frame = HmiRuntime.stateFrame(this.state);
		var fs = parseFloat(style[mxConstants.STYLE_FONTSIZE]) || 14;
		var rows = (frame.fill != null) ? frame.fill : '#ffffff';
		var text = (frame.text != null) ? frame.text : '#263238';
		var rowH = fs * 2;
		var top = y;

		c.setStrokeWidth(frame.width);

		if (frame.fill != null)
		{
			c.setFillColor(frame.fill);
		}

		if (frame.stroke != null)
		{
			c.setStrokeColor(frame.stroke);
		}

		c.rect(x, y, w, h);

		if (frame.fill != null && frame.stroke != null)
		{
			c.fillAndStroke();
		}
		else if (frame.fill != null)
		{
			c.fill();
		}
		else if (frame.stroke != null)
		{
			c.stroke();
		}

		c.setFontSize(fs);
		c.setFontFamily(frame.family);

		if (cfg.titleBar)
		{
			c.setFillColor(HmiList.colorOr(cfg, 'title', 'fill'));
			c.rect(x, top, w, rowH);
			c.fill();
			c.setFontColor(HmiList.colorOr(cfg, 'title', 'color'));
			c.setFontStyle(mxConstants.FONT_BOLD);
			c.text(x + 8, top + rowH / 2, 0, 0, (cfg.title !== '') ? cfg.title : (cfg.name || 'List'),
				mxConstants.ALIGN_LEFT, mxConstants.ALIGN_MIDDLE, false, '', null, false, 0, null);
			top += rowH;
			c.setFontStyle(0);
		}

		// The starting items are what a Run would show; with none, enough
		// placeholders to make the object read as a list
		var items = HmiList.startingItems(cfg);
		var sample = items.length > 0;

		for (var r = 0; top + rowH <= y + h && r < 20; r++)
		{
			if (sample && r >= items.length)
			{
				break;
			}

			var picked = r === ((sample) ? 0 : 1);
			c.setFillColor((picked) ? HmiList.colorOr(cfg, 'selected', 'fill') : rows);
			c.rect(x + 1, top, w - 2, rowH);
			c.fill();
			c.setFontColor((picked) ? HmiList.colorOr(cfg, 'selected', 'color') : text);
			c.text(x + 8, top + rowH / 2, 0, 0, (sample) ? items[r] : 'Item ' + (r + 1),
				mxConstants.ALIGN_LEFT, mxConstants.ALIGN_MIDDLE, false, '', null, false, 0, null);
			top += rowH;
		}
	};

	mxCellRenderer.registerShape(HmiList.SHAPE, ListShape);
};

// ================================================================== manager

/**
 * Every list of the Run: its items, its selection and the Selected item tags
 * the project's cells declare for it. The views render what this holds; the
 * script functions change it.
 *
 * @param project  the HmiProject
 * @param driver   a hub client of its own: the Selected item tag is written
 *                 through it, so the tag follows the selection with no window
 *                 open
 * @param options  {ui, lists: [raw link], report(call, message) instead of the
 *                 error window}
 */
HmiListManager = function(project, driver, options)
{
	this.project = project;
	this.driver = driver;
	this.options = options || {};
	this.listeners = {change: []};
	this.lists = {};

	var defined = this.options.lists || [];

	for (var i = 0; i < defined.length; i++)
	{
		var cfg = HmiList.normalize(defined[i]);

		if (cfg.name === '')
		{
			continue;
		}

		var key = cfg.name.toLowerCase();
		var state = this.lists[key];

		// Two objects may show one list: the first defines it, and each adds
		// its own Selected item tag (Validate reports duplicate names)
		if (state == null)
		{
			state = this.lists[key] = {name: cfg.name, items: HmiList.startingItems(cfg),
				selected: '', tags: []};
		}

		if (cfg.selectedTag !== '' && mxUtils.indexOf(state.tags, cfg.selectedTag) < 0)
		{
			state.tags.push(cfg.selectedTag);
		}
	}
};

HmiListManager.prototype.on = HmiAlarmManager.prototype.on;
HmiListManager.prototype.off = HmiAlarmManager.prototype.off;
HmiListManager.prototype.fire = HmiAlarmManager.prototype.fire;

/** The list named name (any case), or null. */
HmiListManager.prototype.state = function(name)
{
	return this.lists[String(name || '').trim().toLowerCase()] || null;
};

/** Its items, a copy, for a view to draw. */
HmiListManager.prototype.items = function(name)
{
	var state = this.state(name);

	return (state != null) ? state.items.slice() : [];
};

/** Its selected item, '' for none. */
HmiListManager.prototype.selected = function(name)
{
	var state = this.state(name);

	return (state != null) ? state.selected : '';
};

HmiListManager.prototype.start = function()
{
	// Every list starts with its selection written out, so a screen opened
	// later and a script reading the tag agree with what is drawn
	for (var key in this.lists)
	{
		this.writeTags(this.lists[key]);
	}
};

HmiListManager.prototype.stop = function()
{
};

/** The selection to the cells' Selected item tags. */
HmiListManager.prototype.writeTags = function(state)
{
	if (this.driver == null || state.tags.length === 0)
	{
		return;
	}

	var writes = {};

	for (var i = 0; i < state.tags.length; i++)
	{
		writes[state.tags[i]] = state.selected;
	}

	HmiLog.guard('list.write', mxUtils.bind(this, function()
	{
		this.driver.write(writes);
	}));
};

/**
 * The selection, from a touch, the arrows or ListSelect. An item that is not
 * in the list clears it.
 */
HmiListManager.prototype.select = function(name, item)
{
	var state = this.state(name);

	if (state == null)
	{
		return false;
	}

	var found = HmiList.indexOf(state.items, item);
	var next = (found >= 0) ? state.items[found] : '';

	if (next !== state.selected)
	{
		state.selected = next;
		this.writeTags(state);
		this.fire('change', state.name);
	}

	return found >= 0;
};

// ------------------------------------------------------------- functions

/** The script functions (HmiRuntime.context routes them here). */
HmiListManager.prototype.call = function(name, args)
{
	var texts = args.map(function(a) { return HmiExpr.text(a); });
	var call = HmiRecipes.describeCall(name, texts);
	var listName = (texts[0] || '').trim();
	var state = this.state(listName);
	var problem = null;

	if (listName === '')
	{
		problem = 'The list name is empty.';
	}
	else if (state == null)
	{
		problem = 'There is no list named "' + listName + '".';
	}

	if (problem == null)
	{
		var changed = true;

		switch (name)
		{
			case 'ListClear':
				state.items = [];
				state.selected = '';
				break;

			case 'ListAdd':
			{
				var item = texts[1].trim();

				if (item === '')
				{
					problem = 'The item is empty.';
				}
				else if (state.items.length >= HmiList.MAX_ITEMS)
				{
					problem = 'The list "' + state.name + '" is full (' + HmiList.MAX_ITEMS + ' items).';
				}
				else
				{
					state.items.push(item);
				}

				break;
			}

			case 'ListRemove':
			{
				// Not finding it is not a failure: the call is silent
				var at = HmiList.indexOf(state.items, texts[1].trim());

				if (at < 0)
				{
					changed = false;
				}
				else
				{
					var gone = state.items.splice(at, 1)[0];

					if (gone === state.selected && HmiList.indexOf(state.items, gone) < 0)
					{
						state.selected = '';
					}
				}

				break;
			}

			case 'ListSelect':
				// Silent too: an item the list has not got leaves it alone
				if (HmiList.indexOf(state.items, texts[1].trim()) < 0)
				{
					changed = false;
				}
				else
				{
					this.select(state.name, texts[1].trim());
					changed = false;
				}

				break;

			case 'ListLoad':
			{
				var loaded = HmiList.splitItems(texts[1]);

				if (state.items.length + loaded.length > HmiList.MAX_ITEMS)
				{
					problem = 'The list "' + state.name + '" would hold more than ' +
						HmiList.MAX_ITEMS + ' items.';
				}
				else
				{
					state.items = state.items.concat(loaded);
				}

				break;
			}

			case 'ListSort':
			{
				var order = HmiList.ORDERS[texts[1].trim().toLowerCase()];

				if (order == null)
				{
					problem = 'The sort order must be ASC, DESC, A or D, not "' + texts[1] + '".';
				}
				else
				{
					// The selection is kept; the view scrolls it back into
					// sight when it redraws
					state.items.sort(function(a, b) { return order * HmiList.compare(a, b); });
				}

				break;
			}
		}

		if (problem == null)
		{
			if (state.selected !== '' && HmiList.indexOf(state.items, state.selected) < 0)
			{
				state.selected = '';
			}

			if (changed)
			{
				this.writeTags(state);
				this.fire('change', state.name);
			}

			return 1;
		}
	}

	HmiLog.warn('list: ' + call + ' failed: ' + problem);

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
};

// ---------------------------------------------------------------- run view

/**
 * The live list of a List Box cell in a Run window: an HTML overlay over the
 * cell, following zoom and pan. What it draws belongs to the manager, so
 * every window showing the list shows the same thing.
 */
HmiListView = function(runtime, cell, cfg)
{
	this.runtime = runtime;
	this.graph = runtime.graph;
	this.cell = cell;
	this.cfg = HmiList.normalize(cfg);
	this.style = this.graph.getCellStyle(cell);
	this.frame = HmiRuntime.objectFrame(this.graph, cell);
	this.lists = runtime.lists;
	this.edges = {};
};

HmiListView.prototype.start = function()
{
	var that = this;

	this.node = document.createElement('div');
	this.node.className = 'hmiListView';
	this.node.setAttribute('data-hmi-list', this.cfg.name);
	HmiRuntime.applyObjectStyle(this.node, this.frame);
	this.graph.container.appendChild(this.node);

	// Pointer presses stay in the list: the window's touch links must not
	// see them
	mxEvent.addListener(this.node, 'pointerdown', function(evt) { evt.stopPropagation(); });
	mxEvent.addListener(this.node, 'mousedown', function(evt) { evt.stopPropagation(); });

	this.onView = function() { that.place(); };
	this.graph.view.addListener(mxEvent.SCALE, this.onView);
	this.graph.view.addListener(mxEvent.TRANSLATE, this.onView);
	this.graph.view.addListener(mxEvent.SCALE_AND_TRANSLATE, this.onView);

	this.onChange = function(name)
	{
		if (String(name || '').toLowerCase() === that.cfg.name.toLowerCase())
		{
			that.render();
		}
	};

	if (this.lists != null)
	{
		this.lists.on('change', this.onChange);
	}

	// The up/down tags' present state is not an edge
	this.edges.up = HmiRuntime.truthy(this.value(this.cfg.upTag));
	this.edges.down = HmiRuntime.truthy(this.value(this.cfg.downTag));

	this.place();
	this.render();
};

HmiListView.prototype.stop = function()
{
	if (this.node == null)
	{
		return;
	}

	this.graph.view.removeListener(this.onView);

	if (this.lists != null)
	{
		this.lists.off('change', this.onChange);
	}

	if (this.node.parentNode != null)
	{
		this.node.parentNode.removeChild(this.node);
	}

	this.node = null;
};

HmiListView.prototype.place = function()
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
	s.fontSize = ((parseFloat(this.style[mxConstants.STYLE_FONTSIZE]) || 14) * this.graph.view.scale) + 'px';
	HmiRuntime.placeObjectBorder(this.node, this.frame, this.graph.view.scale);
};

/**
 * One of the list's own colors onto an element, and nothing at all when it is
 * not set: css/hmi.css then keeps its say.
 */
HmiListView.prototype.paint = function(node, group)
{
	var fill = HmiList.colorOf(this.cfg, group, 'fill');
	var color = HmiList.colorOf(this.cfg, group, 'color');

	if (fill != null)
	{
		node.style.backgroundColor = fill;
	}

	if (color != null)
	{
		node.style.color = color;
	}

	return node;
};

HmiListView.prototype.value = function(tag)
{
	return (tag) ? this.runtime.getValue(tag).value : null;
};

HmiListView.prototype.items = function()
{
	return (this.lists != null) ? this.lists.items(this.cfg.name) : [];
};

HmiListView.prototype.selected = function()
{
	return (this.lists != null) ? this.lists.selected(this.cfg.name) : '';
};

/** New values (HmiRuntime.applyBatch): the up/down edges. */
HmiListView.prototype.applyBatch = function(batch)
{
	var lower = {};

	for (var name in batch)
	{
		lower[name.toLowerCase()] = batch[name];
	}

	var dirs = {up: this.cfg.upTag, down: this.cfg.downTag};

	for (var dir in dirs)
	{
		var v = dirs[dir] ? lower[dirs[dir].toLowerCase()] : null;

		if (v != null)
		{
			var on = HmiRuntime.truthy(v.value);

			if (on && !this.edges[dir])
			{
				this.move((dir === 'up') ? -1 : 1);
			}

			this.edges[dir] = on;
		}
	}
};

/** One step up (-1) or down (1); with nothing selected, Down picks the first, Up the last. */
HmiListView.prototype.move = function(step)
{
	var items = this.items();

	if (items.length === 0)
	{
		return;
	}

	var i = HmiList.indexOf(items, this.selected());
	var next = (i < 0) ? ((step > 0) ? 0 : items.length - 1) :
		Math.max(0, Math.min(items.length - 1, i + step));

	this.select(items[next]);
};

HmiListView.prototype.select = function(item)
{
	if (this.lists != null)
	{
		this.lists.select(this.cfg.name, item);
	}
};

HmiListView.prototype.render = function()
{
	if (this.node == null)
	{
		return;
	}

	var that = this;
	var items = this.items();
	var selected = this.selected();

	this.node.innerHTML = '';

	if (this.cfg.titleBar)
	{
		var head = this.paint(document.createElement('div'), 'title');
		head.className = 'hmiListHead';
		var title = document.createElement('span');
		title.className = 'hmiListTitle';
		mxUtils.write(title, (this.cfg.title !== '') ? this.cfg.title : this.cfg.name);
		head.appendChild(title);

		if (this.cfg.arrows)
		{
			[['up', '▲', -1], ['down', '▼', 1]].forEach(function(a)
			{
				var btn = document.createElement('button');
				btn.setAttribute('data-hmi-list-move', a[0]);
				btn.setAttribute('title', (a[0] === 'up') ? 'Select the item above' : 'Select the item below');
				mxUtils.write(btn, a[1]);
				mxEvent.addListener(btn, 'click', function(evt)
				{
					mxEvent.consume(evt);
					that.move(a[2]);
				});
				head.appendChild(btn);
			});
		}

		this.node.appendChild(head);
	}

	var rows = document.createElement('div');
	rows.className = 'hmiListRows';

	for (var i = 0; i < items.length; i++)
	{
		(function(item)
		{
			var row = document.createElement('div');
			var picked = item === selected;
			row.className = 'hmiListRow' + ((picked) ? ' hmiListSelected' : '');
			row.setAttribute('data-hmi-list-item', item);

			if (picked)
			{
				that.paint(row, 'selected');
			}

			mxUtils.write(row, item);
			mxEvent.addListener(row, 'click', function(evt)
			{
				mxEvent.consume(evt);
				that.select(item);
			});
			rows.appendChild(row);
		})(items[i]);
	}

	this.node.appendChild(rows);

	// After a sort, a removal or an arrow, the selected row must still be in
	// sight
	var sel = rows.querySelector('.hmiListSelected');

	if (sel != null && sel.scrollIntoView != null)
	{
		sel.scrollIntoView({block: 'nearest'});
	}
};
