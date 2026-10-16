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

			this.addAction('hmiFindReplaceTags...', function()
			{
				HmiDialogs.showFindReplaceTags(ui);
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

			this.addAction('hmiClearRetentive...', function()
			{
				HmiMenus.clearRetentive(ui);
			});

			this.addAction('hmiUsers...', function()
			{
				HmiDialogs.showUsers(ui);
			});

			this.addAction('hmiRecipes...', function()
			{
				HmiDialogs.showRecipes(ui);
			});

			this.addAction('hmiQuickFunctions...', function()
			{
				HmiDialogs.showQuickFunctions(ui);
			});

			this.addAction('hmiClearRuntimeRecipes...', function()
			{
				HmiMenus.clearRuntimeRecipes(ui);
			});

			this.addAction('hmiClearRuntimeUsers...', function()
			{
				HmiMenus.clearRuntimeUsers(ui);
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
					'hmiDevices', 'hmiUsers', 'hmiRecipes', 'hmiQuickFunctions', '-', 'hmiAppSettings', 'hmiWindowProps',
					'-', 'hmiValidate', 'hmiPublish', '-'], parent);

				this.addMenuItems(menu,
					[(HmiMenus.isRunning(ui)) ? 'hmiStop' : 'hmiRun'], parent);

				this.addMenuItems(menu, ['-', 'hmiRuntimeLog', 'hmiClearRetentive', 'hmiClearRuntimeUsers', 'hmiClearRuntimeRecipes'], parent);
			})));

			HmiMenus.extendEditMenu(this);
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

/**
 * Find/Replace Tag References joins the upstream Edit menu, beside its own
 * Find/Replace. The menu's builder is wrapped rather than replaced, so
 * whatever upstream adds to Edit later still appears.
 */
HmiMenus.extendEditMenu = function(menus)
{
	var edit = menus.get('edit');

	if (edit == null || edit.funct == null || edit.hmiExtended)
	{
		return;
	}

	var funct = edit.funct;
	edit.hmiExtended = true;

	edit.funct = function(menu, parent)
	{
		funct(menu, parent);
		menus.addMenuItems(menu, ['-', 'hmiFindReplaceTags'], parent);
	};
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

	// Retentive tags' saved values and the users changed at run time
	// (ShowUserManager) are read first; with nowhere to read them from (the
	// self tests, a browser), the Run starts at once as it always has
	var store = HmiMenus.alarmStore(ui, runtime);

	if (store != null && HmiRetentive.available())
	{
		if (ui.hmiStarting)
		{
			return;
		}

		ui.hmiStarting = true;

		var retained = {};
		var users = null;
		var recipes = null;
		var pending = 3;

		var ready = function()
		{
			if (--pending > 0)
			{
				return;
			}

			ui.hmiStarting = false;

			if (!HmiMenus.isRunning(ui) && ui.hmiProject === project)
			{
				HmiMenus.startWith(ui, project, runtime, store, retained, users, recipes);
			}
		};

		if (HmiRetentive.tags(project).length > 0)
		{
			HmiRetentive.load(store, function(values) { retained = values; ready(); });
		}
		else
		{
			ready();
		}

		HmiSecurity.loadUsers(store, function(list) { users = list; ready(); });
		HmiRecipes.load(store, function(books) { recipes = books; ready(); });

		return;
	}

	HmiMenus.startWith(ui, project, runtime, store, {}, null);
};

HmiMenus.startWith = function(ui, project, runtime, store, retained, users, recipes)
{
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
		driver.preset(retained);

		driver.on('status', function(devices)
		{
			HmiMenus.updateDeviceStatus(ui, devices);
		});

		ui.hmiRunOnly = runtime;
		ui.hmiRuntime = new HmiWindowManager(ui, project, driver, {fit: runtime,
			alarmStore: store, retentiveStore: store, retained: retained, users: users, recipes: recipes});
		ui.hmiRuntime.start();
		HmiMenus.setRunning(ui, true);
	});
};

/**
 * Which alarm history and retentive values a Run uses: a published
 * runtime's product, or the project's file name in the editor.
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

/** Forgets the saved retentive values, so the next Run starts from initial values. */
HmiMenus.clearRetentive = function(ui)
{
	var store = HmiMenus.alarmStore(ui, false);

	if (store == null || !HmiRetentive.available())
	{
		return;
	}

	// A Run would save them again as it stops
	if (HmiMenus.isRunning(ui))
	{
		ui.showError(mxResources.get('hmiClearRetentive'), 'Stop the Run first.', mxResources.get('ok'));

		return;
	}

	ui.confirm('Forget the retentive tags\' saved values? The next Run starts them at their initial values.',
		function()
		{
			HmiRetentive.clear(store, function(error)
			{
				if (error != null)
				{
					ui.showError(mxResources.get('error'), error, mxResources.get('ok'));
				}
			});
		}, null, 'Clear', mxResources.get('cancel'));
};

/**
 * Forgets user changes made at run time with ShowUserManager(), so the next
 * Run uses the project's users again.
 */
HmiMenus.clearRuntimeUsers = function(ui)
{
	var store = HmiMenus.alarmStore(ui, false);

	if (store == null || window.electron == null || typeof window.electron.request !== 'function')
	{
		return;
	}

	if (HmiMenus.isRunning(ui))
	{
		ui.showError(mxResources.get('hmiClearRuntimeUsers'), 'Stop the Run first.', mxResources.get('ok'));

		return;
	}

	ui.confirm('Forget the user changes made at run time on this computer? The next Run uses ' +
		'the users defined in HMI > Users.', function()
	{
		window.electron.request({action: 'hmiUsers.clear', store: store}, function() {}, function(message)
		{
			ui.showError(mxResources.get('error'), message, mxResources.get('ok'));
		});
	}, null, 'Clear', mxResources.get('cancel'));
};

/**
 * Forgets the recipes saved at run time on this computer, so the next Run
 * uses the starting recipes in HMI > Recipes again.
 */
HmiMenus.clearRuntimeRecipes = function(ui)
{
	var store = HmiMenus.alarmStore(ui, false);

	if (store == null || !HmiRecipes.available())
	{
		return;
	}

	if (HmiMenus.isRunning(ui))
	{
		ui.showError(mxResources.get('hmiClearRuntimeRecipes'), 'Stop the Run first.', mxResources.get('ok'));

		return;
	}

	ui.confirm('Forget the recipes saved at run time on this computer? The next Run uses the starting ' +
		'recipes in HMI > Recipes.', function()
	{
		HmiRecipes.clear(store, function(message)
		{
			if (message != null)
			{
				ui.showError(mxResources.get('error'), message, mxResources.get('ok'));
			}
		});
	}, null, 'Clear', mxResources.get('cancel'));
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
	var trendDuplicates = HmiTrend.duplicates(HmiTrend.collect(ui));

	var walk = function(parent, pageName)
	{
		var count = model.getChildCount(parent);

		for (var i = 0; i < count; i++)
		{
			var cell = model.getChildAt(parent, i);
			var links = HmiProject.getCellLinks(graph, cell);

			if (links.trend == null && HmiTrend.isTrendCell(graph, cell))
			{
				problems.push({page: pageName, cell: cell, link: 'Trend', message: 'The trend has no name or pens'});
			}

			for (var key in links)
			{
				var errors = HmiMenus.checkLink(project, links[key], key);

				if ((key === 'showWindow' || key === 'hideWindow') &&
					links[key].window && ui.pages != null &&
					!HmiMenus.hasPage(ui, links[key].window))
				{
					errors.push('No window (page) named "' +
						links[key].window + '"');
				}

				if (key === 'trend')
				{
					var trendName = HmiTrend.normalize(links[key]).name;
					errors = errors.concat(HmiTrend.problems(project, links[key]));

					for (var d = 0; d < trendDuplicates.length; d++)
					{
						if (trendDuplicates[d].name.toLowerCase() === trendName.toLowerCase())
						{
							errors.push(trendDuplicates[d].count + ' trends are named "' + trendName + '"; trend names must be unique');
						}
					}
				}

				if (key === 'pushbutton.action')
				{
					errors = errors.concat(HmiMenus.scriptWindowProblems(ui, links[key].onDown),
						HmiMenus.scriptWindowProblems(ui, links[key].whileDown),
						HmiMenus.scriptWindowProblems(ui, links[key].onUp));
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

			var props = project.getWindow(ui.pages[i].getId());
			var scripts = HmiMenus.checkWindowScripts(project,
				ui.pages[i].getId()).concat(HmiMenus.scriptWindowProblems(ui, props.onShow),
				HmiMenus.scriptWindowProblems(ui, props.whileShowing), HmiMenus.scriptWindowProblems(ui, props.onHide));

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

	var appScripts = HmiMenus.checkAppScripts(project);
	var sc = project.settings.scripts;

	for (var i = 0; i < HmiProject.APP_SCRIPTS.length; i++)
	{
		appScripts = appScripts.concat(HmiMenus.scriptWindowProblems(ui, sc[HmiProject.APP_SCRIPTS[i]]));
	}

	for (var i = 0; i < appScripts.length; i++)
	{
		problems.push({page: mxResources.get('hmiAppSettings'), cell: null,
			link: 'Application script', message: appScripts[i]});
	}

	for (var i = 0; i < project.recipeBooks.length; i++)
	{
		var bookProblems = HmiRecipes.bookProblems(project, project.recipeBooks[i]);

		for (var j = 0; j < bookProblems.length; j++)
		{
			problems.push({page: 'Recipes', cell: null, link: 'Recipe book ' + project.recipeBooks[i].name,
				message: bookProblems[j]});
		}
	}

	var quickProblems = HmiMenus.checkQuickFunctions(project);

	for (var i = 0; i < quickProblems.length; i++)
	{
		problems.push({page: mxResources.get('hmiQuickFunctions'), cell: null,
			link: 'QuickFunction ' + quickProblems[i].name,
			message: quickProblems[i].message});
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

/** ShowWindow("Name") in a script, where no page has that name. */
HmiMenus.scriptWindowProblems = function(ui, src)
{
	var out = [];

	if (src == null || src === '' || ui.pages == null || ui.hmiProject == null)
	{
		return out;
	}

	var compiled = HmiExpr.compile('' + src, {project: ui.hmiProject, mode: 'script'});

	(function find(n)
	{
		if (n == null || typeof n !== 'object')
		{
			return;
		}

		if (n.type === 'call' && n.name === 'ShowWindow' && n.args.length > 0 && n.args[0].type === 'literal' &&
			typeof n.args[0].value === 'string' && n.args[0].value.trim() !== '' &&
			!HmiMenus.hasPage(ui, n.args[0].value.trim()))
		{
			out.push('ShowWindow: no window (page) named "' + n.args[0].value + '"');
		}

		if (n.type === 'call' && HmiTrend.isFunction(n.name) && n.args.length > 0 && n.args[0].type === 'literal' &&
			typeof n.args[0].value === 'string' && n.args[0].value.trim() !== '')
		{
			var problem = HmiMenus.trendCallProblem(ui, n);

			if (problem != null)
			{
				out.push(problem);
			}
		}

		for (var k in n)
		{
			find(n[k]);
		}
	})(compiled.ast);

	return out;
};

/** A trend function's literal trend name (and TrendSetPen's pen) checked against the pages. */
HmiMenus.trendCallProblem = function(ui, n)
{
	var name = n.args[0].value.trim();
	var found = null;
	var trends = HmiTrend.collect(ui);

	for (var i = 0; i < trends.length && found == null; i++)
	{
		var cfg = HmiTrend.normalize(trends[i].cfg);

		if (cfg.name.toLowerCase() === name.toLowerCase())
		{
			found = cfg;
		}
	}

	if (found == null)
	{
		return n.name + ': no trend named "' + name + '"';
	}

	var pen = n.args[1];

	if (n.name === 'TrendSetPen' && pen != null && pen.type === 'literal' && typeof pen.value === 'string' &&
		pen.value.trim() !== '' && !found.pens.some(function(p) { return p.tag.toLowerCase() === pen.value.trim().toLowerCase(); }))
	{
		return 'TrendSetPen: the trend "' + found.name + '" has no pen for "' + pen.value.trim() + '"';
	}

	return null;
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

/**
 * Problems with the project's QuickFunctions: [{name, message}].
 *
 * The rules live in HmiQuickFn, so the dialog, the command line and this
 * report cannot drift apart.
 */
HmiMenus.checkQuickFunctions = function(project)
{
	var found = [];

	if (project == null)
	{
		return found;
	}

	var list = HmiQuickFn.listOf(project);

	for (var i = 0; i < list.length; i++)
	{
		var messages = HmiQuickFn.problems(project, list, list[i]);

		for (var m = 0; m < messages.length; m++)
		{
			found.push({name: list[i].name, message: messages[m]});
		}
	}

	return found;
};

HmiMenus.APP_SCRIPT_LABELS = {onStart: 'On start', whileRunning: 'While running', onShutdown: 'On shutdown'};

/** Compile errors in the application scripts, labelled by which script. */
HmiMenus.checkAppScripts = function(project)
{
	var sc = project.settings.scripts;
	var errors = [];

	for (var key in HmiMenus.APP_SCRIPT_LABELS)
	{
		if (sc[key])
		{
			var compiled = HmiExpr.compile(sc[key], {project: project, mode: 'script'});

			for (var i = 0; i < compiled.errors.length; i++)
			{
				errors.push(HmiMenus.APP_SCRIPT_LABELS[key] + ': ' + compiled.errors[i].message);
			}
		}
	}

	var every = HmiMenus.checkLink(project, {rateMs: sc.everyMs});

	for (var i = 0; i < every.length; i++)
	{
		errors.push(every[i].replace(/^Rate/, 'While running every (ms)'));
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

/**
 * Fields HMI > Validate reports elsewhere, with a better message: a trend's
 * pens come from HmiTrend.problems, which also knows about their types.
 */
HmiMenus.CHECKED_ELSEWHERE = {'trend.pens': true};

/** What a field is called in a problem message. */
HmiMenus.FIELD_LABELS = {
	'expr': 'Expression', 'enableExpr': 'Enable expression',
	'min': 'Minimum', 'max': 'Maximum', 'rateMs': 'Rate',
	'atMin': 'Input at minimum', 'atMax': 'Input at maximum',
	'offsetMin': 'Offset at minimum', 'offsetMax': 'Offset at maximum',
	'pctMin': 'Percent at minimum', 'pctMax': 'Percent at maximum',
	'angleMin': 'Angle at minimum', 'angleMax': 'Angle at maximum',
	'travelMin': 'Travel at minimum', 'travelMax': 'Travel at maximum',
	'everyMs': 'Every (ms)', 'onDown': 'On down', 'whileDown': 'While down',
	'onUp': 'On up'
};

/** What an unknown tag in a bare-name field is called. */
HmiMenus.TAG_LABELS = {
	'tag': 'Unknown tag', 'selectedTag': 'Selected recipe: unknown tag',
	'upTag': 'Select up: unknown tag', 'downTag': 'Select down: unknown tag'
};

/**
 * Problems with one animation link, as messages. Which of its fields hold a
 * tag name or an expression comes from the link registry (HmiTagRefs), so a
 * field added to a link is checked without touching this.
 *
 * The link key is optional: a caller that assembles a config of its own (a
 * window's or the application's everyMs) passes none, and the field names
 * then stand on their own.
 */
HmiMenus.checkLink = function(project, cfg, key)
{
	var errors = [];

	function label(site)
	{
		var band = site.path.match(/^bands\[(\d+)\]/);

		if (band != null)
		{
			return 'Band ' + (parseInt(band[1], 10) + 1);
		}

		return HmiMenus.FIELD_LABELS[site.field] || site.field;
	}

	function checkExpr(src, name, mode)
	{
		if (typeof HmiExpr !== 'undefined')
		{
			var compiled = HmiExpr.compile(src, {project: project, mode: mode});

			for (var i = 0; i < compiled.errors.length; i++)
			{
				errors.push(name + ': ' + compiled.errors[i].message);
			}

			return;
		}

		// Until the parser lands, only tag existence is checkable.
		var base = HmiRuntime.baseTag(src);

		if (base != null && project != null && project.getTag(base) == null)
		{
			errors.push(name + ': unknown tag "' + base + '"');
		}
	}

	HmiTagRefs.eachField(cfg, {key: key, exclude: HmiMenus.CHECKED_ELSEWHERE},
		function(site)
	{
		var src = site.holder[site.field];

		if (site.role === 'tag')
		{
			if (project != null && project.getTag(src) == null &&
				HmiTypes.systemTag(src) == null)
			{
				errors.push((HmiMenus.TAG_LABELS[site.field] || 'Unknown tag') +
					' "' + src + '"');
			}

			return;
		}

		checkExpr(src, label(site), (site.role === 'script') ? 'script' : null);
	});

	if (cfg.book != null && cfg.book !== '' && project != null && project.recipeBooks != null &&
		HmiRecipes.findBook(project.recipeBooks, cfg.book) == null)
	{
		errors.push('No recipe book named "' + cfg.book + '"');
	}

	return errors;
};
