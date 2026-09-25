/**
 * Run mode's window manager.
 *
 * A window is a page. Running opens the application's startup windows on a
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
 */
HmiDriverHub = function(driver)
{
	this.driver = driver;
	this.clients = [];
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
			var key = ('' + c.paths[j]).toLowerCase();

			if (!seen[key])
			{
				seen[key] = true;
				paths.push(c.paths[j]);
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
	this.listeners.push({event: event, cb: cb});
	this.hub.driver.on(event, cb);
};

HmiDriverClient.prototype.off = function(event, cb)
{
	for (var i = this.listeners.length - 1; i >= 0; i--)
	{
		if (this.listeners[i].event === event && this.listeners[i].cb === cb)
		{
			this.listeners.splice(i, 1);
		}
	}

	this.hub.driver.off(event, cb);
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
	return this.hub.driver.read(paths);
};

HmiDriverClient.prototype.get = function(name)
{
	return this.hub.driver.get(name);
};

HmiDriverClient.prototype.write = function(writes)
{
	return this.hub.driver.write(writes);
};

// ------------------------------------------------------------ window manager

HmiWindowManager = function(ui, project, driver)
{
	this.ui = ui;
	this.project = project;
	this.hub = new HmiDriverHub(driver);
	this.driver = driver;
	this.windows = [];
	this.running = false;
	this.scale = 1;
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

/**
 * Fits the device screen into the diagram area. Scaled down when it does not
 * fit, never up: a 800x480 panel shown at 1:1 is what the operator will see.
 */
HmiWindowManager.prototype.layout = function()
{
	if (this.backdrop == null)
	{
		return;
	}

	var area = this.ui.diagramContainer.getBoundingClientRect();
	var b = this.backdrop.style;
	b.left = area.left + 'px';
	b.top = area.top + 'px';
	b.width = area.width + 'px';
	b.height = area.height + 'px';

	var res = this.project.settings;
	var pad = 16;
	var scale = Math.min(1, (area.width - pad * 2) / res.width,
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

/** ShowWindow by name, from a link or a script. */
HmiWindowManager.prototype.show = function(name)
{
	var page = this.findPage(name);

	if (page == null)
	{
		HmiLog.once('window:' + name, 'no window (page) named "' + name + '"');

		return null;
	}

	return this.showPage(page);
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

HmiWindowManager.prototype.showPage = function(page)
{
	if (!this.running)
	{
		return null;
	}

	var existing = this.windowFor(page);

	if (existing != null)
	{
		// Already open: bring it to the front of its layer.
		this.windows.splice(mxUtils.indexOf(this.windows, existing), 1);
		this.windows.push(existing);
		this.restack();

		return existing;
	}

	var props = this.project.getWindow(page.getId());

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
		mxUtils.write(close, '×');
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
		driver: this.hub.client()});

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

	if (win.graph != null && win.graph.view.scale !== s)
	{
		win.graph.view.scaleAndTranslate(s, 0, 0);
	}
	else if (win.graph != null)
	{
		win.graph.view.setTranslate(0, 0);
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

	if (win.runtime != null)
	{
		win.runtime.stop();
		win.runtime.driver.disconnect();
	}

	win.graph.destroy();

	if (win.div.parentNode != null)
	{
		win.div.parentNode.removeChild(win.div);
	}

	this.restack();
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
			topPopup = win;
			popupZ += 2;
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
