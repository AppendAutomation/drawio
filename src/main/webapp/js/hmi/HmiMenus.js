/**
 * The HMI menu, its actions, and the Run/Stop lifecycle.
 *
 * Actions and menus are registered by wrapping the upstream constructors
 * rather than editing Menus.js or Actions.js, keeping both out of the rebase
 * surface.
 */
HmiMenus = function() {};

HmiMenus.install = function()
{
	HmiMenus.installActions();
	HmiMenus.installMenu();
	HmiMenus.installKeys();
	HmiMenus.installContextMenu();
	HmiMenus.installPageMenu();
};

// --------------------------------------------------------- context menu

/**
 * Animation clipboard.
 *
 * Deliberately separate from the system clipboard and from drawio's own cell
 * clipboard: copying a shape already carries its animation with it, so this is
 * for the other case -- taking the animation off one object and putting it on
 * a different one without disturbing either shape.
 */
HmiClipboard = {links: null};

HmiMenus.installContextMenu = function()
{
	if (typeof Menus === 'undefined' ||
		Menus.prototype.addPopupMenuCellItems == null)
	{
		HmiLog.warn('addPopupMenuCellItems missing; context menu skipped');

		return;
	}

	var addPopupMenuCellItems = Menus.prototype.addPopupMenuCellItems;

	Menus.prototype.addPopupMenuCellItems = function(menu, cell, evt)
	{
		addPopupMenuCellItems.apply(this, arguments);

		HmiLog.guard('contextMenu', mxUtils.bind(this, function()
		{
			HmiMenus.addAnimationItems(this.editorUi, menu, cell);
		}));
	};
};

/** The cells a context-menu action applies to. */
HmiMenus.targetCells = function(ui, cell)
{
	var graph = ui.editor.graph;
	var cells = graph.getSelectionCells();

	// Right-clicking outside the selection acts on what was clicked, which is
	// what every other item in this menu does.
	if (cell != null && mxUtils.indexOf(cells, cell) < 0)
	{
		return [cell];
	}

	return cells;
};

HmiMenus.addAnimationItems = function(ui, menu, cell)
{
	var graph = ui.editor.graph;
	var cells = HmiMenus.targetCells(ui, cell);

	if (cells.length === 0)
	{
		return;
	}

	var withLinks = 0;

	for (var i = 0; i < cells.length; i++)
	{
		if (Object.keys(HmiProject.getCellLinks(graph, cells[i])).length > 0)
		{
			withLinks++;
		}
	}

	menu.addSeparator();

	menu.addItem(mxResources.get('hmiCopyAnimation'), null, function()
	{
		HmiMenus.copyAnimation(ui, cells);
	}, null, null, withLinks > 0);

	menu.addItem(mxResources.get('hmiPasteAnimation'), null, function()
	{
		HmiMenus.pasteAnimation(ui, cells);
	}, null, null, HmiClipboard.links != null);

	menu.addItem(mxResources.get('hmiDeleteAnimation'), null, function()
	{
		HmiMenus.deleteAnimation(ui, cells);
	}, null, null, withLinks > 0);
};

HmiMenus.copyAnimation = function(ui, cells)
{
	var graph = ui.editor.graph;

	for (var i = 0; i < cells.length; i++)
	{
		var links = HmiProject.getCellLinks(graph, cells[i]);

		if (Object.keys(links).length > 0)
		{
			// Deep copy, so editing the source afterwards cannot reach into
			// what is waiting on the clipboard.
			HmiClipboard.links = JSON.parse(JSON.stringify(links));
			HmiLog.log('copied ' + Object.keys(links).length +
				' animation link(s)');

			return;
		}
	}
};

/**
 * Merges the clipboard onto each target rather than replacing.
 *
 * Replacing would silently discard animation the target already had, which is
 * a destructive reading of the word "paste". A link of the same type is
 * overwritten, and a conflicting colour link is removed for the same reason
 * the panel removes it: Discrete and Analog both drive one property, so
 * holding both would make the result depend on evaluation order.
 */
HmiMenus.pasteAnimation = function(ui, cells)
{
	if (HmiClipboard.links == null)
	{
		return;
	}

	var graph = ui.editor.graph;
	var model = graph.getModel();

	model.beginUpdate();

	try
	{
		for (var i = 0; i < cells.length; i++)
		{
			var links = HmiProject.getCellLinks(graph, cells[i]);

			for (var key in HmiClipboard.links)
			{
				var def = HmiTypes.LINKS[key];

				if (def != null)
				{
					var conflicts = HmiFormatPanel.conflictsWith(def);

					for (var c = 0; c < conflicts.length; c++)
					{
						delete links[conflicts[c]];
					}
				}

				links[key] = JSON.parse(JSON.stringify(HmiClipboard.links[key]));
			}

			HmiProject.setCellLinks(graph, cells[i], links);
		}
	}
	finally
	{
		model.endUpdate();
	}

	if (ui.format != null)
	{
		ui.format.refresh();
	}
};

HmiMenus.deleteAnimation = function(ui, cells)
{
	var graph = ui.editor.graph;
	var model = graph.getModel();

	model.beginUpdate();

	try
	{
		for (var i = 0; i < cells.length; i++)
		{
			HmiProject.setCellLinks(graph, cells[i], {});
		}
	}
	finally
	{
		model.endUpdate();
	}

	if (ui.format != null)
	{
		ui.format.refresh();
	}
};

// -------------------------------------------------------------- actions

HmiMenus.installActions = function()
{
	var actionsInit = Actions.prototype.init;

	Actions.prototype.init = function()
	{
		actionsInit.apply(this, arguments);

		HmiLog.guard('actions', mxUtils.bind(this, function()
		{
			var ui = this.editorUi;

			this.addAction('hmiTagDictionary...', function()
			{
				HmiMenus.showTagDictionary(ui);
			});

			this.addAction('hmiDevices...', function()
			{
				HmiMenus.showDevices(ui);
			});

			this.addAction('hmiAppSettings...', function()
			{
				HmiDialogs.showAppSettings(ui);
			});

			this.addAction('hmiWindowProps...', function()
			{
				HmiDialogs.showWindowProps(ui, ui.currentPage);
			});

			this.addAction('hmiValidate', function()
			{
				HmiMenus.validate(ui);
			});

			this.addAction('hmiPublish...', function()
			{
				HmiDialogs.showPublish(ui);
			});

			this.addAction('hmiRun', function()
			{
				HmiMenus.start(ui);
			}, null, null, 'F5');

			this.addAction('hmiStop', function()
			{
				HmiMenus.stop(ui);
			}, null, null, 'Shift+F5');

			this.addAction('hmiRuntimeLog...', function()
			{
				HmiMenus.showLog(ui);
			});
		}));
	};
};

// ----------------------------------------------------------------- menu

HmiMenus.installMenu = function()
{
	var menusInit = Menus.prototype.init;

	Menus.prototype.init = function()
	{
		menusInit.apply(this, arguments);

		HmiLog.guard('menu', mxUtils.bind(this, function()
		{
			var ui = this.editorUi;

			// Action keys here must be the STRIPPED form: addAction removes a
			// trailing '...' before storing, while addMenuItem looks the key
			// up verbatim. Passing 'hmiTagDictionary...' finds nothing and
			// the item is skipped silently, leaving an empty menu.
			this.put('hmi', new Menu(mxUtils.bind(this, function(menu, parent)
			{
				this.addMenuItems(menu, ['hmiTagDictionary',
					'hmiDevices', '-', 'hmiAppSettings', 'hmiWindowProps',
					'-', 'hmiValidate', 'hmiPublish', '-'], parent);

				this.addMenuItems(menu,
					[(HmiMenus.isRunning(ui)) ? 'hmiStop' : 'hmiRun'], parent);

				this.addMenuItems(menu, ['-', 'hmiRuntimeLog'], parent);
			})));
		}));
	};

	// Splice the menu in before Help. Done on the prototype so it applies
	// however the menubar is assembled.
	var items = Menus.prototype.defaultMenuItems;

	if (mxUtils.indexOf(items, 'hmi') < 0)
	{
		var at = mxUtils.indexOf(items, 'help');
		var next = items.slice(0);
		next.splice((at >= 0) ? at : next.length, 0, 'hmi');
		Menus.prototype.defaultMenuItems = next;
	}
};

// ------------------------------------------------------------ page menu

/**
 * Window Properties on a page tab's context menu, for the page right-clicked
 * rather than the one showing.
 */
HmiMenus.installPageMenu = function()
{
	var createPageMenu = EditorUi.prototype.createPageMenu;

	if (createPageMenu == null)
	{
		return;
	}

	EditorUi.prototype.createPageMenu = function(page, label)
	{
		var fn = createPageMenu.apply(this, arguments);
		var ui = this;

		return function(menu, parent)
		{
			fn.apply(this, arguments);

			HmiLog.guard('pageMenu', function()
			{
				if (ui.editor.graph.isEnabled())
				{
					menu.addSeparator(parent);
					menu.addItem(mxResources.get('hmiWindowProps') + '...', null,
						function()
						{
							HmiDialogs.showWindowProps(ui, page);
						}, parent);
				}
			});
		};
	};
};

// ------------------------------------------------------------------ keys

HmiMenus.installKeys = function()
{
	var createKeyHandler = EditorUi.prototype.createKeyHandler;

	EditorUi.prototype.createKeyHandler = function(editor)
	{
		var keyHandler = createKeyHandler.apply(this, arguments);

		HmiLog.guard('keys', function()
		{
			if (keyHandler != null && keyHandler.bindAction != null)
			{
				keyHandler.bindAction(116, false, 'hmiRun');        // F5
				keyHandler.bindAction(116, false, 'hmiStop', true); // Shift+F5
			}
		});

		return keyHandler;
	};
};

// ------------------------------------------------------------- lifecycle

HmiMenus.isRunning = function(ui)
{
	return ui.hmiRuntime != null && ui.hmiRuntime.running;
};

/**
 * options.runtime is the published package (HmiRuntimeApp): the screen fills
 * the window, there is no banner or Stop, and a project without tags still
 * shows its screens.
 */
HmiMenus.start = function(ui, options)
{
	if (HmiMenus.isRunning(ui))
	{
		return;
	}

	var runtime = options != null && options.runtime === true;
	var project = ui.hmiProject;

	if (project == null || (project.tags.length === 0 && !runtime))
	{
		ui.showError(mxResources.get('error'),
			mxResources.get('hmiNoTags'), mxResources.get('ok'));

		return;
	}

	HmiLog.guard('run.start', function()
	{
		// Pages deleted since their properties were set must not linger in
		// the startup list, where they would silently open nothing.
		if (ui.pages != null)
		{
			var ids = [];

			for (var i = 0; i < ui.pages.length; i++)
			{
				ids.push(ui.pages[i].getId());
			}

			project.prunePages(ids);
		}

		// Simulated tags stay in the HMI; tags on real devices go to the
		// comms server. The runtime sees one driver.
		var driver = new HmiCommsDriver(project);

		driver.on('status', function(devices)
		{
			HmiMenus.updateDeviceStatus(ui, devices);
		});

		ui.hmiRunOnly = runtime;
		ui.hmiRuntime = new HmiWindowManager(ui, project, driver, {fit: runtime,
			alarmStore: HmiMenus.alarmStore(ui, runtime)});
		ui.hmiRuntime.start();
		HmiMenus.setRunning(ui, true);
	});
};

/**
 * Which alarm history a Run writes to: a published runtime's product, or
 * the project's file name in the editor.
 */
HmiMenus.alarmStore = function(ui, runtime)
{
	// The self tests' Runs must not add to anyone's alarm history
	if (urlParams['hmitest'] == '1' || urlParams['hmilive'] == '1' || urlParams['hmifile'] != null)
	{
		return null;
	}

	if (runtime && typeof HmiRuntimeApp !== 'undefined' && HmiRuntimeApp.info != null)
	{
		return HmiRuntimeApp.info.productName;
	}

	var file = (ui.getCurrentFile != null) ? ui.getCurrentFile() : null;
	var title = (file != null) ? file.getTitle().replace(/\.(ahmi|drawio-hmi|drawio)$/i, '') : '';

	return title || 'Untitled';
};

HmiMenus.stop = function(ui)
{
	// A published package runs until it exits
	if (!HmiMenus.isRunning(ui) || ui.hmiRunOnly)
	{
		return;
	}

	HmiLog.guard('run.stop', function()
	{
		ui.hmiRuntime.stop();
		ui.hmiRuntime = null;
		HmiMenus.setRunning(ui, false);
	});
};

/**
 * Run mode hides the editing chrome, so the screen is seen as an operator
 * would see it. Nothing here touches the model.
 */
HmiMenus.setRunning = function(ui, running)
{
	var container = ui.container;

	if (container != null)
	{
		if (running)
		{
			container.classList.add('hmiRunning');
		}
		else
		{
			container.classList.remove('hmiRunning');
		}
	}

	if (ui.format != null)
	{
		ui.format.refresh();
	}

	ui.fireEvent(new mxEventObject('hmiRunStateChanged', 'running', running));
	HmiMenus.updateBanner(ui, running);
};

/**
 * A persistent banner, because an operator screen and an editor canvas can
 * look identical and confusing the two is how live equipment gets touched by
 * accident.
 */
HmiMenus.updateBanner = function(ui, running)
{
	if (ui.hmiBanner != null && ui.hmiBanner.parentNode != null)
	{
		ui.hmiBanner.parentNode.removeChild(ui.hmiBanner);
		ui.hmiBanner = null;
	}

	if (!running)
	{
		return;
	}

	// The runtime's screen is the whole window: only communication faults
	// show, in a corner
	if (ui.hmiRunOnly)
	{
		var status = document.createElement('div');
		status.className = 'hmiRuntimeStatus';
		status.style.display = 'none';
		document.body.appendChild(status);
		ui.hmiBanner = status;
		ui.hmiBannerFaults = status;

		return;
	}

	var banner = document.createElement('div');
	banner.className = 'hmiBanner';

	var text = document.createElement('span');
	mxUtils.write(text, mxResources.get('hmiRunningBanner'));
	banner.appendChild(text);

	var stop = document.createElement('button');
	stop.className = 'hmiBannerStop';
	mxUtils.write(stop, mxResources.get('hmiStop'));

	mxEvent.addListener(stop, 'click', function(evt)
	{
		mxEvent.consume(evt);
		HmiMenus.stop(ui);
	});

	banner.appendChild(stop);

	var faults = document.createElement('span');
	faults.className = 'hmiBannerFaults';
	faults.style.display = 'none';
	banner.insertBefore(faults, stop);
	ui.hmiBannerFaults = faults;

	document.body.appendChild(banner);
	ui.hmiBanner = banner;
};

/**
 * Devices that are not communicating are named in the run banner: a screen
 * full of stale values should say so without anyone opening the log.
 */
HmiMenus.updateDeviceStatus = function(ui, devices)
{
	var faults = ui.hmiBannerFaults;

	if (faults == null)
	{
		return;
	}

	var down = [];

	for (var name in devices)
	{
		var d = devices[name];

		if (d.state === 'backoff' || d.state === 'disconnected' && d.lastError)
		{
			down.push(name + ': ' + (d.lastError || d.state));
		}
	}

	faults.innerText = '';

	if (down.length === 0)
	{
		faults.style.display = 'none';

		return;
	}

	faults.style.display = '';
	mxUtils.write(faults, (down.length === 1) ? '\u26A0 ' + down[0].split(':')[0] + ' not communicating' :
		'\u26A0 ' + down.length + ' devices not communicating');
	faults.setAttribute('title', down.join('\n'));
};

// ------------------------------------------------------------- commands

HmiMenus.showTagDictionary = function(ui)
{
	HmiDialogs.showTagDictionary(ui);
};

HmiMenus.showDevices = function(ui)
{
	HmiDialogs.showDevices(ui);
};

HmiMenus.showLog = function(ui)
{
	HmiDialogs.showLog(ui);
};

/**
 * Compiles every expression in the project and reports the failures, each row
 * selecting the offending cell. This is what keeps a large application
 * maintainable, and it is nearly free once the links are addressable.
 */
HmiMenus.validate = function(ui)
{
	HmiMenus.collectProblems(ui, function(problems)
	{
		HmiDialogs.showValidation(ui, problems);
	});
};

/** What Validate reports, handed to fn(problems) once addresses are checked. */
HmiMenus.collectProblems = function(ui, fn)
{
	var graph = ui.editor.graph;
	var project = ui.hmiProject;
	var problems = [];

	var model = graph.getModel();

	var walk = function(parent, pageName)
	{
		var count = model.getChildCount(parent);

		for (var i = 0; i < count; i++)
		{
			var cell = model.getChildAt(parent, i);
			var links = HmiProject.getCellLinks(graph, cell);

			for (var key in links)
			{
				var errors = HmiMenus.checkLink(project, links[key]);

				if ((key === 'showWindow' || key === 'hideWindow') &&
					links[key].window && ui.pages != null &&
					!HmiMenus.hasPage(ui, links[key].window))
				{
					errors.push('No window (page) named "' +
						links[key].window + '"');
				}

				for (var e = 0; e < errors.length; e++)
				{
					problems.push({page: pageName, cell: cell,
						link: (HmiTypes.LINKS[key] != null) ?
							HmiTypes.LINKS[key].label : key,
						message: errors[e]});
				}
			}

			walk(cell, pageName);
		}
	};

	var pageName = (ui.currentPage != null && ui.currentPage.getName != null) ?
		ui.currentPage.getName() : 'Page';
	walk(graph.getDefaultParent(), pageName);

	if (project != null && ui.pages != null)
	{
		for (var i = 0; i < ui.pages.length; i++)
		{
			var msg = HmiMenus.checkWindow(project, ui.pages[i].getId());

			if (msg != null)
			{
				problems.push({page: ui.pages[i].getName(), cell: null,
					link: mxResources.get('hmiWindowProps'), message: msg});
			}

			var scripts = HmiMenus.checkWindowScripts(project,
				ui.pages[i].getId());

			for (var j = 0; j < scripts.length; j++)
			{
				problems.push({page: ui.pages[i].getName(), cell: null,
					link: 'Window script', message: scripts[j]});
			}
		}
	}

	if (project == null)
	{
		fn(problems);

		return;
	}

	var pending = HmiMenus.checkTags(project, problems);

	if (pending.length === 0 || !HmiComms.available())
	{
		fn(problems);

		return;
	}

	// Addresses are checked by the comms server, which owns the grammars:
	// one request per device, then the results.
	var left = pending.length;

	var done = function()
	{
		if (--left === 0)
		{
			fn(problems);
		}
	};

	for (var i = 0; i < pending.length; i++)
	{
		(function(job)
		{
			HmiComms.validate(job.device, job.tags.map(function(t) { return t.address; }), null,
				function(results, error)
				{
					for (var j = 0; j < job.tags.length; j++)
					{
						var r = (results != null) ? results[j] : null;

						if (error != null)
						{
							problems.push(HmiMenus.tagProblem(job.tags[j], 'Address not checked: ' + error));
						}
						else if (r != null && !r.ok)
						{
							problems.push(HmiMenus.tagProblem(job.tags[j], r.error));
						}
					}

					done();
				});
		})(pending[i]);
	}
};

HmiMenus.tagProblem = function(tag, message)
{
	return {page: 'Tags', cell: null, link: tag.name, message: message};
};

/**
 * Checks each I/O tag's device binding. Adds what is wrong to problems and
 * returns, per device, the tags whose addresses the server should check.
 */
HmiMenus.checkTags = function(project, problems)
{
	var byDevice = {};
	var jobs = [];

	for (var i = 0; i < project.tags.length; i++)
	{
		var tag = project.tags[i];

		if (!HmiTypes.isIO(tag.type))
		{
			continue;
		}

		if (!tag.device)
		{
			problems.push(HmiMenus.tagProblem(tag, 'I/O tag has no device'));

			continue;
		}

		var device = project.getDevice(tag.device);

		if (device == null)
		{
			problems.push(HmiMenus.tagProblem(tag, 'No device named "' + tag.device + '"'));

			continue;
		}

		if (device.protocol === 'simulator')
		{
			continue;
		}

		if (!tag.address)
		{
			problems.push(HmiMenus.tagProblem(tag, 'No address on ' + device.name));

			continue;
		}

		var key = device.name.toLowerCase();

		if (byDevice[key] == null)
		{
			byDevice[key] = {device: device, tags: []};
			jobs.push(byDevice[key]);
		}

		byDevice[key].tags.push(tag);
	}

	return jobs;
};

HmiMenus.hasPage = function(ui, name)
{
	var lower = ('' + name).toLowerCase();

	for (var i = 0; i < ui.pages.length; i++)
	{
		if (('' + ui.pages[i].getName()).toLowerCase() === lower)
		{
			return true;
		}
	}

	return false;
};

/** Compile errors in a window's scripts, labelled by which script. */
HmiMenus.checkWindowScripts = function(project, pageId)
{
	var w = project.getWindow(pageId);
	var labels = {onShow: 'On show', whileShowing: 'While showing',
		onHide: 'On hide'};
	var errors = [];

	for (var key in labels)
	{
		if (w[key])
		{
			var compiled = HmiExpr.compile(w[key],
				{project: project, mode: 'script'});

			for (var i = 0; i < compiled.errors.length; i++)
			{
				errors.push(labels[key] + ': ' + compiled.errors[i].message);
			}
		}
	}

	var every = HmiMenus.checkLink(project, {rateMs: w.everyMs});

	for (var i = 0; i < every.length; i++)
	{
		errors.push(every[i].replace(/^Rate/, 'Every (ms)'));
	}

	return errors;
};

/** A window that does not fit on the target screen, or null. */
HmiMenus.checkWindow = function(project, pageId)
{
	var w = project.getWindow(pageId);
	var res = project.settings;

	if (w.width <= 0 || w.height <= 0)
	{
		return 'Window has no area (' + w.width + ' x ' + w.height + ')';
	}

	if (w.x < 0 || w.y < 0 || w.x + w.width > res.width ||
		w.y + w.height > res.height)
	{
		return 'Window (' + w.x + ', ' + w.y + ', ' + w.width + ' x ' +
			w.height + ') extends past the ' + res.width + ' x ' +
			res.height + ' screen';
	}

	return null;
};

HmiMenus.checkLink = function(project, cfg)
{
	var errors = [];

	function checkExpr(src, label)
	{
		if (src == null || src === '')
		{
			return;
		}

		if (typeof HmiExpr !== 'undefined')
		{
			var compiled = HmiExpr.compile(src, {project: project});

			for (var i = 0; i < compiled.errors.length; i++)
			{
				errors.push(label + ': ' + compiled.errors[i].message);
			}

			return;
		}

		// Until the parser lands, only tag existence is checkable.
		var base = HmiRuntime.baseTag(src);

		if (base != null && project != null && project.getTag(base) == null)
		{
			errors.push(label + ': unknown tag "' + base + '"');
		}
	}

	checkExpr(cfg.expr, 'Expression');
	checkExpr(cfg.enableExpr, 'Enable expression');
	checkExpr(cfg.min, 'Minimum');
	checkExpr(cfg.max, 'Maximum');
	checkExpr(cfg.rateMs, 'Rate');

	if (cfg.tag != null && cfg.tag !== '' && project != null &&
		project.getTag(cfg.tag) == null)
	{
		errors.push('Unknown tag "' + cfg.tag + '"');
	}

	if (cfg.bands != null)
	{
		for (var i = 0; i < cfg.bands.length; i++)
		{
			checkExpr(cfg.bands[i].max, 'Band ' + (i + 1));
		}
	}

	return errors;
};
