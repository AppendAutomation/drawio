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
					'hmiAccessNames', '-', 'hmiValidate', '-'], parent);

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
		var driver = new HmiSimulator(project);

		ui.hmiRuntime = new HmiRuntime({
			graph: ui.editor.graph,
			project: project,
			driver: driver
		});

		// The runtime is deliberately ignorant of dialogs, so user input is
		// injected here rather than reached for from inside the engine.
		ui.hmiRuntime.onUserInput = function(cfg, binding)
		{
			HmiDialogs.showUserInput(ui, cfg);
		};

		// A "window" in InTouch is a page here. Showing one selects it; hiding
		// returns to the page that was showing before, which is the closest
		// honest equivalent without a real popup window manager.
		ui.hmiRuntime.onWindow = function(action, name)
		{
			HmiLog.guard('window', function()
			{
				if (ui.pages == null)
				{
					return;
				}

				if (action === 'hide')
				{
					if (ui.hmiPreviousPage != null)
					{
						ui.selectPage(ui.hmiPreviousPage);
						ui.hmiPreviousPage = null;
					}

					return;
				}

				for (var i = 0; i < ui.pages.length; i++)
				{
					var page = ui.pages[i];
					var pageName = (page.getName != null) ? page.getName() : null;

					if (pageName === name && page !== ui.currentPage)
					{
						ui.hmiPreviousPage = ui.currentPage;
						ui.selectPage(page);

						// A new page means new cells, so rebind to them.
						ui.hmiRuntime.rebind();

						return;
					}
				}

				HmiLog.once('window:' + name, 'no page named "' + name + '"');
			});
		};

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

	HmiDialogs.showValidation(ui, problems);
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
