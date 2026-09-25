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

			this.addAction('hmiAccessNames...', function()
			{
				HmiMenus.showAccessNames(ui);
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
					'hmiAccessNames', '-', 'hmiAppSettings', 'hmiWindowProps',
					'-', 'hmiValidate', '-'], parent);

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

HmiMenus.start = function(ui)
{
	if (HmiMenus.isRunning(ui))
	{
		return;
	}

	var project = ui.hmiProject;

	if (project == null || project.tags.length === 0)
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

		ui.hmiRuntime = new HmiWindowManager(ui, project,
			new HmiSimulator(project));
		ui.hmiRuntime.start();
		HmiMenus.setRunning(ui, true);
	});
};

HmiMenus.stop = function(ui)
{
	if (!HmiMenus.isRunning(ui))
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
	document.body.appendChild(banner);
	ui.hmiBanner = banner;
};

// ------------------------------------------------------------- commands

HmiMenus.showTagDictionary = function(ui)
{
	HmiDialogs.showTagDictionary(ui);
};

HmiMenus.showAccessNames = function(ui)
{
	HmiDialogs.showAccessNames(ui);
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
		}
	}

	HmiDialogs.showValidation(ui, problems);
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
