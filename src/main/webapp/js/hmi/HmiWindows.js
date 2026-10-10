/**
 * Run mode's window manager.
 *
 * A window is a page, and page coordinates are screen coordinates: a window at
 * (x, y) shows what is drawn at (x, y) on its page, which is what the frame on
 * the editor canvas (HmiFrame) shows while designing. Running opens the application's startup windows on a
 * simulated device screen of the configured resolution, each in its own graph
 * with its own HmiRuntime, positioned and stacked according to its window
 * properties. The editor's own graph is never animated: it is disabled and
 * covered for the duration, which keeps the runtime's never-touch-the-model
 * invariant trivially true for the document being edited.
 *
 * Every runtime needs a driver of its own, because a runtime subscribes,
 * unsubscribes and disconnects as it pleases. HmiDriverHub hands each one a
 * client and keeps the single real driver subscribed to the union of what the
 * open windows read.
 *
 * The hub also resolves indirect tags, so everything above it (windows, alarm
 * views, recipes, scripts) reads and writes them like any tag: a client's
 * indirect name is subscribed as its linked tag, the linked tag's changes are
 * delivered under the indirect name too, and writes go to the linked tag.
 * There is one set of links for the Run (LinkIndirectTag in any window).
 */
HmiDriverHub = function(driver, project)
{
	this.driver = driver;
	this.project = project || null;
	this.clients = [];
	// lower-case indirect name -> {indirect, target} (dictionary names)
	this.links = {};
};

HmiDriverHub.prototype.isIndirect = function(name)
{
	var tag = (this.project != null && name != null) ? this.project.getTag('' + name) : null;

	return tag != null && HmiTypes.isIndirect(tag.type);
};

/** The linked tag's name for an indirect name; null while unlinked; other names unchanged. */
HmiDriverHub.prototype.resolve = function(name)
{
	if (!this.isIndirect(name))
	{
		return name;
	}

	var link = this.links[('' + name).toLowerCase()];

	return (link != null) ? link.target : null;
};

/**
 * Points an indirect tag at a tag, replacing any earlier link (both checked
 * by the caller: HmiIndirect.check). Every client is sent the linked tag's
 * current value under the indirect name, so screens follow at once.
 */
HmiDriverHub.prototype.link = function(indirect, target)
{
	var itag = this.project.getTag(indirect);
	var ttag = this.project.getTag(target);
	this.links[itag.name.toLowerCase()] = {indirect: itag.name, target: ttag.name};
	this.resubscribe();

	var now = this.driver.get(ttag.name);
	var batch = {};
	batch[itag.name] = (now != null) ? now :
		{value: null, quality: HmiTypes.QUALITY_BAD, timestamp: Date.now()};

	for (var i = 0; i < this.clients.length; i++)
	{
		this.clients[i].emit('change', batch);
	}
};

/** A driver batch with each linked tag's value also under its indirect names. */
HmiDriverHub.prototype.alias = function(batch)
{
	var out = null;
	var lower = null;

	for (var key in this.links)
	{
		if (lower == null)
		{
			lower = {};

			for (var name in batch)
			{
				lower[name.toLowerCase()] = batch[name];
			}
		}

		var link = this.links[key];
		var v = lower[link.target.toLowerCase()];

		if (v !== undefined)
		{
			out = out || HmiDriverHub.copy(batch);
			out[link.indirect] = v;
		}
	}

	return out || batch;
};

HmiDriverHub.copy = function(batch)
{
	var out = {};

	for (var name in batch)
	{
		out[name] = batch[name];
	}

	return out;
};

HmiDriverHub.prototype.connect = function()
{
	this.driver.connect();
};

HmiDriverHub.prototype.disconnect = function()
{
	while (this.clients.length > 0)
	{
		this.clients[0].disconnect();
	}

	this.driver.unsubscribe();
	this.driver.disconnect();
	this.links = {};
};

HmiDriverHub.prototype.client = function()
{
	var client = new HmiDriverClient(this);
	this.clients.push(client);

	return client;
};

HmiDriverHub.prototype.remove = function(client)
{
	var i = mxUtils.indexOf(this.clients, client);

	if (i >= 0)
	{
		this.clients.splice(i, 1);
	}
};

/** Subscribes the real driver to everything any client still wants. */
HmiDriverHub.prototype.resubscribe = function()
{
	var seen = {};
	var paths = [];
	var rate = null;
	var any = false;

	for (var i = 0; i < this.clients.length; i++)
	{
		var c = this.clients[i];

		if (c.paths == null)
		{
			continue;
		}

		any = true;
		rate = (rate == null) ? c.rateMs : Math.min(rate, c.rateMs);

		for (var j = 0; j < c.paths.length; j++)
		{
			// An unlinked indirect tag reads nothing yet
			var path = this.resolve(c.paths[j]);
			var key = (path != null) ? ('' + path).toLowerCase() : null;

			if (key != null && !seen[key])
			{
				seen[key] = true;
				paths.push(path);
			}
		}
	}

	if (any)
	{
		this.driver.subscribe(paths, rate);
	}
	else
	{
		this.driver.unsubscribe();
	}
};

/** The driver interface HmiRuntime expects, multiplexed onto the hub. */
HmiDriverClient = function(hub)
{
	this.hub = hub;
	this.listeners = [];
	this.paths = null;
	this.rateMs = 250;
	this.id = hub.driver.id;
	this.displayName = hub.driver.displayName;
};

/** The hub connects the real driver once, for every client. */
HmiDriverClient.prototype.connect = function() {};

HmiDriverClient.prototype.disconnect = function()
{
	while (this.listeners.length > 0)
	{
		var l = this.listeners[0];
		this.off(l.event, l.cb);
	}

	this.unsubscribe();
	this.hub.remove(this);
};

HmiDriverClient.prototype.status = function()
{
	return this.hub.driver.status();
};

HmiDriverClient.prototype.on = function(event, cb)
{
	var hub = this.hub;
	var wrapped = (event === 'change') ? function(batch) { cb(hub.alias(batch)); } : cb;
	this.listeners.push({event: event, cb: cb, wrapped: wrapped});
	this.hub.driver.on(event, wrapped);
};

HmiDriverClient.prototype.off = function(event, cb)
{
	for (var i = this.listeners.length - 1; i >= 0; i--)
	{
		var l = this.listeners[i];

		if (l.event === event && l.cb === cb)
		{
			this.listeners.splice(i, 1);
			this.hub.driver.off(event, l.wrapped);
		}
	}
};

/** Delivers a batch from the hub itself (a new indirect link) to this client's listeners. */
HmiDriverClient.prototype.emit = function(event, batch)
{
	var list = this.listeners.slice(0);

	for (var i = 0; i < list.length; i++)
	{
		if (list[i].event === event)
		{
			list[i].cb(batch);
		}
	}
};

HmiDriverClient.prototype.subscribe = function(paths, rateMs)
{
	this.paths = paths.slice(0);
	this.rateMs = rateMs || 250;
	this.hub.resubscribe();

	return 'hub';
};

HmiDriverClient.prototype.unsubscribe = function()
{
	if (this.paths != null)
	{
		this.paths = null;
		this.hub.resubscribe();
	}
};

HmiDriverClient.prototype.read = function(paths)
{
	var hub = this.hub;

	return hub.driver.read(paths.map(function(p) { return hub.resolve(p); })
		.filter(function(p) { return p != null; }));
};

HmiDriverClient.prototype.get = function(name)
{
	var target = this.hub.resolve(name);

	return (target != null) ? this.hub.driver.get(target) : null;
};

/** Writes to an indirect tag go to its linked tag; while unlinked they go nowhere. */
HmiDriverClient.prototype.write = function(writes)
{
	var out = {};

	for (var name in writes)
	{
		var target = this.hub.resolve(name);

		if (target == null)
		{
			HmiLog.warn('write to ' + name + ' ignored: the indirect tag is not linked');
		}
		else
		{
			out[target] = writes[name];
		}
	}

	return this.hub.driver.write(out);
};

// ------------------------------------------------------------ window manager

/**
 * options.fit fills the whole browser window with the screen, scaling up as
 * well as down (the published runtime); otherwise the screen sits in the
 * diagram area at no more than 1:1.
 */
HmiWindowManager = function(ui, project, driver, options)
{
	this.ui = ui;
	this.project = project;
	this.hub = new HmiDriverHub(driver, project);
	this.driver = driver;
	// LinkIndirectTag: one set of links for every window of the Run
	this.indirect = new HmiIndirect(project, this.hub, {ui: ui});
	this.windows = [];
	this.running = false;
	this.scale = 1;
	this.fit = options != null && options.fit === true;

	// How the screen fills the window in a runtime (fit): see setView
	this.view = 'fit';

	// options.alarmStore names the alarm history (the project, or a
	// published runtime's product)
	var store = (options != null) ? options.alarmStore : null;

	this.alarms = new HmiAlarmManager(project, this.hub.client(), {store: store,
		persist: function(events) { HmiAlarms.persist(store, events); }});

	// Who is logged in; options.users is the runtime's saved user list
	this.security = new HmiSecurityManager(project, {ui: ui,
		store: (options != null) ? options.retentiveStore : null,
		users: (options != null) ? options.users : null});

	// Retentive tags' values are saved while the Run goes on
	// Recipes: options.recipes are the ones saved on this PC
	this.recipes = new HmiRecipeManager(project, this.hub.client(), {ui: ui,
		store: (options != null) ? options.retentiveStore : null,
		saved: (options != null) ? options.recipes : null});

	this.retentive = new HmiRetentiveKeeper(project, this.hub.client(), {
		store: (options != null) ? options.retentiveStore : null,
		values: (options != null) ? options.retained : null});
};

HmiWindowManager.prototype.start = function()
{
	if (this.running)
	{
		return;
	}

	var ui = this.ui;
	var graph = ui.editor.graph;

	graph.clearSelection();
	this.editorWasEnabled = graph.isEnabled();
	graph.setEnabled(false);

	this.createScreen();
	this.hub.connect();
	this.running = true;

	// Before any window: alarms are watched whether or not a window shows them
	this.alarms.start();
	this.retentive.start();
	this.security.start();
	this.recipes.start();

	var pages = this.startupPages();

	for (var i = 0; i < pages.length; i++)
	{
		this.showPage(pages[i]);
	}

	var that = this;
	this.resizeListener = function() { that.layout(); };
	mxEvent.addListener(window, 'resize', this.resizeListener);
};

HmiWindowManager.prototype.stop = function()
{
	if (!this.running)
	{
		return;
	}

	this.running = false;

	while (this.windows.length > 0)
	{
		this.close(this.windows[this.windows.length - 1]);
	}

	this.security.stop();
	this.recipes.stop();
	this.recipes.driver.disconnect();

	// The last values are saved as the Run ends
	this.retentive.stop();
	this.retentive.driver.disconnect();
	this.alarms.stop();
	this.alarms.driver.disconnect();
	this.hub.disconnect();

	if (this.resizeListener != null)
	{
		mxEvent.removeListener(window, 'resize', this.resizeListener);
		this.resizeListener = null;
	}

	if (this.backdrop != null && this.backdrop.parentNode != null)
	{
		this.backdrop.parentNode.removeChild(this.backdrop);
	}

	this.backdrop = null;
	this.screen = null;
	this.blocker = null;

	this.ui.editor.graph.setEnabled(this.editorWasEnabled);
};

// ------------------------------------------------------------------ pages

HmiWindowManager.prototype.pages = function()
{
	return this.ui.pages || [];
};

HmiWindowManager.pageName = function(page)
{
	return (page.getName != null) ? page.getName() : '';
};

/**
 * Window names match exactly first, then without regard to case, as tag
 * names do.
 */
HmiWindowManager.prototype.findPage = function(name)
{
	var pages = this.pages();
	var lower = ('' + name).toLowerCase();
	var loose = null;

	for (var i = 0; i < pages.length; i++)
	{
		var n = HmiWindowManager.pageName(pages[i]);

		if (n === name)
		{
			return pages[i];
		}

		if (loose == null && ('' + n).toLowerCase() === lower)
		{
			loose = pages[i];
		}
	}

	return loose;
};

/**
 * The configured startup windows, in page order. With none configured the page
 * being edited opens, so Run always shows something.
 */
HmiWindowManager.prototype.startupPages = function()
{
	var pages = this.pages();
	var wanted = {};
	var res = [];

	for (var i = 0; i < this.project.settings.startup.length; i++)
	{
		wanted[this.project.settings.startup[i]] = true;
	}

	for (var i = 0; i < pages.length; i++)
	{
		if (wanted[pages[i].getId()])
		{
			res.push(pages[i]);
		}
	}

	if (res.length === 0 && this.ui.currentPage != null)
	{
		res.push(this.ui.currentPage);
	}

	return res;
};

/**
 * A private copy of a page's model. The current page's live model is encoded
 * rather than shared, so nothing the window's graph does can reach the
 * document; cell ids survive the round trip.
 */
HmiWindowManager.prototype.modelForPage = function(page)
{
	return HmiWindowManager.modelForPage(this.ui, page);
};

HmiWindowManager.modelForPage = function(ui, page)
{
	var root = null;

	if (page === ui.currentPage)
	{
		root = ui.editor.graph.getModel().getRoot();
	}
	else
	{
		ui.updatePageRoot(page);
		root = page.root;
	}

	var holder = new mxGraphModel();
	holder.root = root;

	var node = new mxCodec(mxUtils.createXmlDocument()).encode(holder);
	var model = new mxGraphModel();
	new mxCodec(node.ownerDocument).decode(node, model);

	return model;
};

HmiWindowManager.prototype.backgroundFor = function(page)
{
	var bg = null;

	if (page === this.ui.currentPage)
	{
		bg = this.ui.editor.graph.background;
	}
	else if (page.viewState != null)
	{
		bg = page.viewState.background;
	}

	if (bg != null && bg !== mxConstants.NONE)
	{
		return bg;
	}

	// No page background: show the canvas colour the page was designed on,
	// since default shape colours follow the editor's theme and would read
	// wrongly on anything else.
	var canvas = window.getComputedStyle(this.ui.diagramContainer).backgroundColor;

	return (canvas && canvas !== 'rgba(0, 0, 0, 0)' && canvas !== 'transparent') ?
		canvas : '#ffffff';
};

// ----------------------------------------------------------------- screen

HmiWindowManager.prototype.createScreen = function()
{
	this.backdrop = document.createElement('div');
	this.backdrop.className = 'hmiScreenBackdrop';

	this.screen = document.createElement('div');
	this.screen.className = 'hmiScreen';

	this.backdrop.appendChild(this.screen);
	document.body.appendChild(this.backdrop);

	this.layout();
};

/** The runtime's view modes (setView). */
HmiWindowManager.VIEWS = ['fit', 'fill', 'original'];

/**
 * How a runtime's screen fills its window:
 *   fit       the whole screen, as large as fits, keeping its proportions
 *   fill      stretched to fill the window (proportions not kept)
 *   original  1:1, with scroll bars when the window is smaller
 * The editor's Run always fits the diagram area.
 */
HmiWindowManager.prototype.setView = function(view)
{
	if (mxUtils.indexOf(HmiWindowManager.VIEWS, view) >= 0 && view !== this.view)
	{
		this.view = view;
		this.layout();
	}
};

/**
 * Fits the device screen into the diagram area. Scaled down when it does not
 * fit, never up: a 800x480 panel shown at 1:1 is what the operator will see.
 * The runtime (fit) fills the window instead, since there it is the panel.
 */
HmiWindowManager.prototype.layout = function()
{
	if (this.backdrop == null)
	{
		return;
	}

	if (this.designLayout)
	{
		this.layoutDesign();

		return;
	}

	if (this.fit && this.view !== 'fit')
	{
		this.layoutView();

		return;
	}

	this.clearStretch();

	var area = (this.fit) ? {left: 0, top: 0, width: window.innerWidth,
		height: window.innerHeight} : this.ui.diagramContainer.getBoundingClientRect();
	var b = this.backdrop.style;
	b.left = area.left + 'px';
	b.top = area.top + 'px';
	b.width = area.width + 'px';
	b.height = area.height + 'px';

	var res = this.project.settings;
	var pad = (this.fit) ? 0 : 16;
	var scale = Math.min((this.fit) ? Infinity : 1, (area.width - pad * 2) / res.width,
		(area.height - pad * 2) / res.height);
	this.scale = Math.max(0.1, scale);

	var w = Math.round(res.width * this.scale);
	var h = Math.round(res.height * this.scale);
	var s = this.screen.style;
	s.width = w + 'px';
	s.height = h + 'px';
	s.left = Math.max(0, Math.round((area.width - w) / 2)) + 'px';
	s.top = Math.max(0, Math.round((area.height - h) / 2)) + 'px';

	for (var i = 0; i < this.windows.length; i++)
	{
		this.place(this.windows[i]);
	}
};

/** The runtime's fill and original views (setView). */
HmiWindowManager.prototype.layoutView = function()
{
	var width = window.innerWidth;
	var height = window.innerHeight;
	var res = this.project.settings;
	var b = this.backdrop.style;
	b.left = '0px';
	b.top = '0px';
	b.width = width + 'px';
	b.height = height + 'px';

	// Both draw the screen at 1:1; fill then stretches it as a whole
	this.scale = 1;

	var s = this.screen.style;
	s.width = res.width + 'px';
	s.height = res.height + 'px';

	if (this.view === 'fill')
	{
		var sx = width / res.width;
		var sy = height / res.height;
		b.overflow = 'hidden';
		s.left = '0px';
		s.top = '0px';
		s.transformOrigin = '0 0';
		s.transform = 'scale(' + sx + ', ' + sy + ')';
		this.screen.hmiStretch = {x: sx, y: sy};
		HmiWindowManager.installStretchedPoints();
	}
	else
	{
		this.clearStretch();
		b.overflow = 'auto';
		s.left = Math.max(0, Math.round((width - res.width) / 2)) + 'px';
		s.top = Math.max(0, Math.round((height - res.height) / 2)) + 'px';
	}

	for (var i = 0; i < this.windows.length; i++)
	{
		this.place(this.windows[i]);
	}
};

/**
 * Runs fn with the screen laid out at its design size (scale 1), then lays
 * it out again. Both happen in the same task, so nothing is painted at that
 * size: ScreenToPDF copies the screen this way.
 */
HmiWindowManager.prototype.atDesignSize = function(fn)
{
	this.designLayout = true;

	try
	{
		this.layout();

		return fn();
	}
	finally
	{
		this.designLayout = false;
		this.layout();
	}
};

HmiWindowManager.prototype.layoutDesign = function()
{
	var res = this.project.settings;
	this.clearStretch();
	this.scale = 1;

	var s = this.screen.style;
	s.width = res.width + 'px';
	s.height = res.height + 'px';

	for (var i = 0; i < this.windows.length; i++)
	{
		this.place(this.windows[i]);
	}
};

HmiWindowManager.prototype.clearStretch = function()
{
	if (this.screen != null)
	{
		this.screen.style.transform = '';
		this.screen.hmiStretch = null;
	}

	if (this.backdrop != null)
	{
		this.backdrop.style.overflow = '';
	}
};

/**
 * mxGraph maps a pointer's page position into a graph by the container's
 * offset alone, which is wrong under the fill view's CSS stretch: taps would
 * land beside their objects. Inside a stretched screen, distances from the
 * container's corner are divided by the stretch.
 */
HmiWindowManager.installStretchedPoints = function()
{
	if (HmiWindowManager.convertPoint != null)
	{
		return;
	}

	var convert = mxUtils.convertPoint;
	HmiWindowManager.convertPoint = convert;

	mxUtils.convertPoint = function(container, x, y)
	{
		var pt = convert.apply(this, arguments);
		var node = container;

		while (node != null && node.hmiStretch == null)
		{
			node = node.parentNode;
		}

		if (node != null && node.hmiStretch != null && container.getBoundingClientRect != null)
		{
			var r = container.getBoundingClientRect();
			var dx = x - r.left;
			var dy = y - r.top;
			pt.x += dx / node.hmiStretch.x - dx;
			pt.y += dy / node.hmiStretch.y - dy;
		}

		return pt;
	};
};

// ---------------------------------------------------------------- windows

HmiWindowManager.prototype.isOpen = function(page)
{
	return this.windowFor(page) != null;
};

HmiWindowManager.prototype.windowFor = function(page)
{
	for (var i = 0; i < this.windows.length; i++)
	{
		if (this.windows[i].page === page)
		{
			return this.windows[i];
		}
	}

	return null;
};

/**
 * ShowWindow by name, from a link or a script. options {x, y, modal}
 * override the window's own properties for this showing: the position for
 * any window, modal for a popup (false lets the windows beneath be touched).
 */
HmiWindowManager.prototype.show = function(name, options)
{
	var page = this.findPage(name);

	if (page == null)
	{
		HmiLog.once('window:' + name, 'no window (page) named "' + name + '"');

		return null;
	}

	return this.showPage(page, options);
};

/** A window's properties for one showing: its own, with options applied (a copy). */
HmiWindowManager.propsWith = function(props, options)
{
	var out = {};

	for (var key in props)
	{
		out[key] = props[key];
	}

	// What the window shows stays the part of its page it is defined over:
	// a window moved by ShowWindow shows the same objects somewhere else
	if (out.pageX == null) { out.pageX = out.x; }
	if (out.pageY == null) { out.pageY = out.y; }

	if (options != null)
	{
		if (options.x != null) { out.x = options.x; }
		if (options.y != null) { out.y = options.y; }
		if (options.modal != null && out.type === 'popup') { out.modal = options.modal; }
	}

	return out;
};

/**
 * ShowWindow(name[, left, top[, modal[, wait]]]) from a script. done(1) once
 * the window is shown, or, with wait, once it has closed; done(0) when it
 * cannot be shown, with the reason in the function error window.
 */
HmiWindowManager.prototype.callShowWindow = function(args, done)
{
	var name = HmiExpr.text(args[0]).trim();
	var that = this;
	var fail = function(message)
	{
		HmiWindowManager.reportShowWindow(that.ui, args, message);
		done(0);
	};

	if (name === '')
	{
		fail('The window name is empty.');

		return;
	}

	var page = this.findPage(name);

	if (page == null)
	{
		fail('There is no window named "' + name + '".');

		return;
	}

	var coord = function(v, what)
	{
		if (v == null || v === '')
		{
			return null;
		}

		var n = (typeof v === 'number') ? v : parseFloat(v);

		if (typeof v === 'boolean' || isNaN(n) || !isFinite(n))
		{
			throw what + ' must be a number of pixels, not "' + HmiExpr.text(v) + '".';
		}

		return Math.round(n);
	};

	var options = {};

	try
	{
		options.x = coord(args[1], 'Left');
		options.y = coord(args[2], 'Top');
	}
	catch (message)
	{
		fail(message);

		return;
	}

	options.modal = (args[3] == null || args[3] === '') ? null : HmiRuntime.truthy(args[3]);
	var wait = HmiRuntime.truthy(args[4]);
	var props = HmiWindowManager.propsWith(this.project.getWindow(page.getId()), options);
	var screen = this.project.settings;

	if (props.x >= screen.width || props.y >= screen.height || props.x + props.width <= 0 || props.y + props.height <= 0)
	{
		fail('At ' + props.x + ', ' + props.y + ' the window "' + HmiWindowManager.pageName(page) +
			'" would be off the ' + screen.width + ' × ' + screen.height + ' screen.');

		return;
	}

	var win = this.showPage(page, options);

	if (win == null)
	{
		fail('The window "' + name + '" could not be shown.');

		return;
	}

	if (!wait)
	{
		done(1);

		return;
	}

	// Not when the Run stops: everything closes then, and nothing carries on
	(win.onClosed = win.onClosed || []).push(function()
	{
		if (that.running)
		{
			done(1);
		}
	});
};

/** A failed ShowWindow: logged and shown to the operator after the script. */
HmiWindowManager.reportShowWindow = function(ui, args, message)
{
	var shown = [];

	for (var i = 0; i < args.length; i++)
	{
		shown.push((typeof args[i] === 'string' || typeof args[i] === 'number') ? args[i] : HmiExpr.text(args[i]));
	}

	var call = HmiRecipes.describeCall('ShowWindow', shown);
	HmiLog.warn('window: ' + call + ' failed: ' + message);

	if (typeof HmiRuntimeApp !== 'undefined' && HmiRuntimeApp.isActive())
	{
		HmiRuntimeApp.log('warn', call + ' failed: ' + message);
	}

	if (ui != null)
	{
		HmiDialogs.queueFunctionError(ui, call, message);
	}
};

/** HideWindow by name. Hiding a window that is not open does nothing. */
HmiWindowManager.prototype.hide = function(name)
{
	var page = this.findPage(name);
	var win = (page != null) ? this.windowFor(page) : null;

	if (win != null)
	{
		this.close(win);
	}
};

HmiWindowManager.prototype.showPage = function(page, options)
{
	if (!this.running)
	{
		return null;
	}

	var existing = this.windowFor(page);

	if (existing != null)
	{
		// Already open: bring it to the front of its layer, where asked
		if (options != null)
		{
			existing.props = HmiWindowManager.propsWith(existing.props, options);
			this.place(existing);
		}

		this.windows.splice(mxUtils.indexOf(this.windows, existing), 1);
		this.windows.push(existing);
		this.restack();

		return existing;
	}

	var props = HmiWindowManager.propsWith(this.project.getWindow(page.getId()), options);

	if (props.type === 'replace')
	{
		for (var i = this.windows.length - 1; i >= 0; i--)
		{
			if (HmiWindowManager.overlaps(props, this.windows[i].props))
			{
				this.close(this.windows[i]);
			}
		}
	}

	var win = this.createWindow(page, props);
	this.windows.push(win);
	this.restack();

	return win;
};

HmiWindowManager.overlaps = function(a, b)
{
	return a.x < b.x + b.width && b.x < a.x + a.width &&
		a.y < b.y + b.height && b.y < a.y + a.height;
};

HmiWindowManager.prototype.createWindow = function(page, props)
{
	var ui = this.ui;
	var that = this;
	var name = HmiWindowManager.pageName(page);

	var div = document.createElement('div');
	div.className = 'hmiWindow' + ((props.type === 'popup') ?
		' hmiWindowPopup' : '');
	div.setAttribute('data-hmi-window', name);

	var title = null;

	if (props.titleBar)
	{
		title = document.createElement('div');
		title.className = 'hmiWindowTitle';

		var label = document.createElement('span');
		label.className = 'hmiWindowTitleText';
		mxUtils.write(label, name);
		title.appendChild(label);

		var close = document.createElement('span');
		close.className = 'hmiWindowClose';
		close.setAttribute('title', mxResources.get('close'));
		mxUtils.write(close, '\u00D7');
		title.appendChild(close);

		mxEvent.addListener(close, 'click', function(evt)
		{
			mxEvent.consume(evt);
			that.hide(name);
		});

		div.appendChild(title);
	}

	var content = document.createElement('div');
	content.className = 'hmiWindowContent';
	content.style.backgroundColor = this.backgroundFor(page);
	div.appendChild(content);
	this.screen.appendChild(div);

	var graph = new Graph(content, this.modelForPage(page), null,
		ui.editor.graph.getStylesheet());
	graph.resetViewOnRootChange = false;
	graph.setConnectable(false);
	graph.setPanning(false);
	graph.setTooltips(false);
	graph.gridEnabled = false;
	graph.autoScroll = false;
	graph.foldingEnabled = false;

	var win = {page: page, name: name, props: props, div: div, title: title,
		content: content, graph: graph, runtime: null};

	this.place(win);

	var runtime = new HmiRuntime({graph: graph, project: this.project,
		driver: this.hub.client(), alarms: this.alarms, security: this.security, recipes: this.recipes,
		indirect: this.indirect, scripts: [props.onShow, props.whileShowing, props.onHide], windows: this});

	runtime.onUserInput = function(cfg, binding)
	{
		HmiDialogs.showUserInput(ui, cfg, runtime);
	};

	// Deferred: the handler runs inside this window's own mouse dispatch, and
	// a replace window may close the very window that was clicked.
	runtime.onWindow = function(action, target)
	{
		window.setTimeout(function()
		{
			HmiLog.guard('window', function()
			{
				if (action === 'hide')
				{
					that.hide(target);
				}
				else
				{
					that.show(target);
				}
			});
		}, 0);
	};

	win.runtime = runtime;
	runtime.start();

	// Window scripts run in the window's own runtime, so they read the same
	// values its objects show and write through the same shared driver.
	runtime.runScript(props.onShow);

	if (props.whileShowing)
	{
		var rate = Math.max(50, runtime.number(props.everyMs, 1000));

		win.whileTimer = window.setInterval(function()
		{
			HmiLog.guard('window.whileShowing', function()
			{
				runtime.runScript(props.whileShowing);
			});
		}, rate);
	}

	return win;
};

/** Positions a window on the screen at the current scale. */
HmiWindowManager.prototype.place = function(win)
{
	var s = this.scale;
	var p = win.props;
	var style = win.div.style;

	style.left = Math.round(p.x * s) + 'px';
	style.top = Math.round(p.y * s) + 'px';
	style.width = Math.round(p.width * s) + 'px';
	style.height = Math.round(p.height * s) + 'px';

	// The title bar is part of the window's height, as it is on the device.
	var tb = (win.title != null) ?
		Math.round(HmiProject.TITLE_BAR_HEIGHT * s) : 0;

	if (win.title != null)
	{
		win.title.style.height = tb + 'px';
		win.title.style.lineHeight = tb + 'px';
		win.title.style.fontSize = Math.max(9, Math.round(13 * s)) + 'px';
	}

	win.content.style.top = tb + 'px';

	// Page coordinates are screen coordinates, so the content area shows the
	// part of the page under it: the window's rectangle, less the title bar.
	if (win.graph != null)
	{
		var tx = -((p.pageX != null) ? p.pageX : p.x);
		var ty = -(((p.pageY != null) ? p.pageY : p.y) + ((win.title != null) ? HmiProject.TITLE_BAR_HEIGHT : 0));
		var view = win.graph.view;

		if (view.scale !== s || view.translate.x !== tx || view.translate.y !== ty)
		{
			view.scaleAndTranslate(s, tx, ty);
		}
	}
};

HmiWindowManager.prototype.close = function(win)
{
	var i = mxUtils.indexOf(this.windows, win);

	if (i < 0)
	{
		return;
	}

	this.windows.splice(i, 1);

	if (win.whileTimer != null)
	{
		window.clearInterval(win.whileTimer);
		win.whileTimer = null;
	}

	if (win.runtime != null)
	{
		// Before the runtime stops, while it can still write.
		win.runtime.runScript(win.props.onHide);
		win.runtime.stop();
		win.runtime.driver.disconnect();
	}

	win.graph.destroy();

	if (win.div.parentNode != null)
	{
		win.div.parentNode.removeChild(win.div);
	}

	this.restack();

	// Scripts waiting in ShowWindow(..., wait) carry on
	var waiting = win.onClosed || [];
	win.onClosed = null;

	for (var w = 0; w < waiting.length; w++)
	{
		waiting[w]();
	}
};

/**
 * Popups always sit above ordinary windows, and the topmost popup has a
 * blocker beneath it that swallows every touch meant for what it covers.
 */
HmiWindowManager.prototype.restack = function()
{
	var z = 10;
	var popupZ = 1001;
	var topPopup = null;

	for (var i = 0; i < this.windows.length; i++)
	{
		var win = this.windows[i];

		if (win.props.type === 'popup')
		{
			win.div.style.zIndex = popupZ;
			popupZ += 2;

			// A popup shown with modal false blocks nothing
			if (win.props.modal !== false)
			{
				topPopup = win;
			}
		}
		else
		{
			win.div.style.zIndex = z++;
		}
	}

	if (topPopup != null)
	{
		if (this.blocker == null)
		{
			this.blocker = document.createElement('div');
			this.blocker.className = 'hmiModalBlocker';

			mxEvent.addGestureListeners(this.blocker, function(evt)
			{
				mxEvent.consume(evt);
			});
		}

		if (this.blocker.parentNode !== this.screen && this.screen != null)
		{
			this.screen.appendChild(this.blocker);
		}

		this.blocker.style.zIndex = parseInt(topPopup.div.style.zIndex, 10) - 1;
	}
	else if (this.blocker != null && this.blocker.parentNode != null)
	{
		this.blocker.parentNode.removeChild(this.blocker);
	}
};

/** True when a modal popup covers the given window. */
HmiWindowManager.prototype.isBlocked = function(win)
{
	if (this.blocker == null || this.blocker.parentNode == null)
	{
		return false;
	}

	return parseInt(win.div.style.zIndex, 10) <
		parseInt(this.blocker.style.zIndex, 10);
};
